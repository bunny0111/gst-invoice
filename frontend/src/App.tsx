import { useQueryClient } from '@tanstack/react-query'
import { lazy, Suspense, useEffect, type ReactElement } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Toaster } from 'sonner'
import { Logo } from './components/ui/Bits'
import { Button } from './components/ui/Button'
import { PageLoader } from './components/ui/Bits'
// Every page is its own chunk: a phone opening the login page downloads the login page, not the whole app.
const pages = {
  AppShell: () => import('./layouts/AppShell'),
  PublicLayout: () => import('./layouts/PublicLayout'),
  ForgotPassword: () => import('./pages/auth/ForgotPassword'),
  Login: () => import('./pages/auth/Login'),
  Customers: () => import('./pages/app/Customers'),
  Dashboard: () => import('./pages/app/Dashboard'),
  InvoiceEditor: () => import('./pages/app/InvoiceEditor'),
  InvoiceView: () => import('./pages/app/InvoiceView'),
  Invoices: () => import('./pages/app/Invoices'),
  Payments: () => import('./pages/app/Payments'),
  Products: () => import('./pages/app/Products'),
  Settings: () => import('./pages/app/Settings'),
  Subscription: () => import('./pages/app/Subscription'),
  FindBusiness: () => import('./pages/public/FindBusiness'),
  Landing: () => import('./pages/public/Landing'),
  Register: () => import('./pages/public/Register'),
}
const AppShell = lazy(pages.AppShell)
const PublicLayout = lazy(pages.PublicLayout)
const ForgotPassword = lazy(pages.ForgotPassword)
const Login = lazy(pages.Login)
const Customers = lazy(pages.Customers)
const Dashboard = lazy(pages.Dashboard)
const InvoiceEditor = lazy(pages.InvoiceEditor)
const InvoiceView = lazy(pages.InvoiceView)
const Invoices = lazy(pages.Invoices)
const Payments = lazy(pages.Payments)
const Products = lazy(pages.Products)
const Settings = lazy(pages.Settings)
const Subscription = lazy(pages.Subscription)
const FindBusiness = lazy(pages.FindBusiness)
const Landing = lazy(pages.Landing)
const Register = lazy(pages.Register)

/** A moment after the screen is up, fetch the pages the person will open next in the background so moving between
 *  them stays instant: on the login page just the dashboard, once signed in the whole workspace.
 *  Skipped on metered "save data" connections. */
function usePrefetchPages(which: (keyof typeof pages)[] | null) {
  const key = which?.join(',')
  useEffect(() => {
    if (!which || (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData) return
    const t = window.setTimeout(() => which.forEach((name) => pages[name]().catch(() => { /* offline: loads on demand */ })), 2500)
    return () => window.clearTimeout(t)
  }, [key])  // `which` is a fresh array each render; its contents are what matter
}
const ALL_TENANT_PAGES = (Object.keys(pages) as (keyof typeof pages)[]).filter((k) => !['PublicLayout', 'FindBusiness', 'Landing', 'Register'].includes(k))
import { ApiError, ensureCsrf } from './lib/api'
import { useMe, useTenantInfo } from './lib/hooks'
import { useNoIndex } from './lib/seo'
import { useTheme } from './lib/theme'

export default function App() {
  const { theme } = useTheme()
  const tenant = useTenantInfo()
  useEffect(() => { ensureCsrf() }, [])

  let body
  if (tenant.isLoading) {
    body = <div className="grid min-h-screen place-items-center"><div className="flex flex-col items-center gap-5"><Logo /><PageLoader slowHint /></div></div>
  } else if (tenant.isError && !(tenant.error instanceof ApiError && tenant.error.status === 404)) {
    body = <ServerUnreachable onRetry={() => tenant.refetch()} />
  } else if (tenant.isError || !tenant.data) {
    body = <WorkspaceNotFound />
  } else if (tenant.data.is_public) {
    body = <PublicRoutes />
  } else if (tenant.data.active === false) {
    body = <Disabled />
  } else {
    body = <TenantRoutes />
  }
  const loader = <div className="grid min-h-screen place-items-center"><PageLoader /></div>
  return (
    <>
      <Suspense fallback={loader}>{body}</Suspense>
      <Toaster theme={theme} position="top-right" richColors closeButton toastOptions={{ style: { fontFamily: 'var(--font-sans)', borderRadius: '14px' } }} />
    </>
  )
}

function PublicRoutes() {
  return (
    <Routes>
      <Route element={<PublicLayout />}>
        <Route index element={<Landing />} />
        <Route path="register" element={<Register />} />
        <Route path="login" element={<FindBusiness />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}

function TenantRoutes() {
  const qc = useQueryClient()
  const me = useMe()
  const location = useLocation()
  // Every page on a tenant subdomain is a private workspace - never indexed (backstopped by
  // the host-level robots.txt in common/views.py, which blocks tenant subdomains outright).
  useNoIndex(me.data?.business_name)

  useEffect(() => {
    const out = () => qc.setQueryData(['me'], null)
    window.addEventListener('gst:unauthorized', out)
    return () => window.removeEventListener('gst:unauthorized', out)
  }, [qc])

  usePrefetchPages(me.isLoading || me.isError ? null : me.data ? ALL_TENANT_PAGES : ['AppShell', 'Dashboard'])

  if (me.isLoading) return <div className="grid min-h-screen place-items-center"><div className="flex flex-col items-center gap-5"><Logo /><PageLoader slowHint /></div></div>
  if (me.isError) return <ServerUnreachable onRetry={() => me.refetch()} />  // NOT a logout - the session is fine
  const authed = !!me.data
  const guest = (el: ReactElement) => (authed ? <Navigate to="/" replace /> : el)

  return (
    <Routes>
      <Route path="/login" element={guest(<Login />)} />
      <Route path="/forgot-password" element={guest(<ForgotPassword />)} />
      <Route element={authed ? <AppShell /> : <Navigate to="/login" replace state={{ from: location.pathname }} />}>
        <Route index element={<Dashboard />} />
        <Route path="invoices" element={<Invoices />} />
        <Route path="invoices/new" element={<InvoiceEditor />} />
        <Route path="invoices/:id" element={<InvoiceView />} />
        <Route path="invoices/:id/edit" element={<InvoiceEditor />} />
        <Route path="payments" element={<Payments />} />
        <Route path="customers" element={<Customers />} />
        <Route path="products" element={<Products />} />
        <Route path="settings" element={<Settings />} />
        <Route path="subscription" element={<Subscription />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}

function WorkspaceNotFound() {
  const hostParts = window.location.host.split('.')
  const publicUrl = hostParts.length > 1 ? `${window.location.protocol}//${hostParts.slice(1).join('.')}` : '/'
  return (
    <div className="grid min-h-screen place-items-center p-6 text-center">
      <div className="max-w-md">
        <div className="mb-8 flex justify-center"><Logo /></div>
        <h1 className="font-display text-3xl font-extrabold text-ink">We couldn't find that workspace</h1>
        <p className="mt-3 text-muted">The address may be mistyped, or the server isn't reachable right now. Check the URL from your registration email.</p>
        <div className="mt-8 flex justify-center gap-3">
          <Button variant="secondary" onClick={() => window.location.reload()}>Try again</Button>
          <a href={publicUrl}><Button>Go to home page</Button></a>
        </div>
      </div>
    </div>
  )
}

function Disabled() {
  return (
    <div className="grid min-h-screen place-items-center p-6 text-center">
      <div className="max-w-md">
        <div className="mb-8 flex justify-center"><Logo /></div>
        <h1 className="font-display text-3xl font-extrabold text-ink">This workspace is disabled</h1>
        <p className="mt-3 text-muted">Please contact info@techcognixium.com to get it re-activated.</p>
      </div>
    </div>
  )
}

function ServerUnreachable({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="grid min-h-screen place-items-center px-6 text-center">
      <div className="max-w-sm">
        <div className="mb-8 flex justify-center"><Logo /></div>
        <h1 className="font-display text-2xl font-extrabold text-ink">Can't reach GST Billing</h1>
        <p className="mt-2 text-sm text-ink-2">Check your internet connection. If it's working, the server may still be starting up — try again in a few seconds. You're still signed in.</p>
        <Button className="mt-6" onClick={onRetry}>Try again</Button>
      </div>
    </div>
  )
}
