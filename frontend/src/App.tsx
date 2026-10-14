import { useQueryClient } from '@tanstack/react-query'
import { useEffect, type ReactElement } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Toaster } from 'sonner'
import { Logo } from './components/ui/Bits'
import { Button } from './components/ui/Button'
import { PageLoader } from './components/ui/Bits'
import AppShell from './layouts/AppShell'
import PublicLayout from './layouts/PublicLayout'
import ForgotPassword from './pages/auth/ForgotPassword'
import Login from './pages/auth/Login'
import Customers from './pages/app/Customers'
import Dashboard from './pages/app/Dashboard'
import InvoiceEditor from './pages/app/InvoiceEditor'
import InvoiceView from './pages/app/InvoiceView'
import Invoices from './pages/app/Invoices'
import Products from './pages/app/Products'
import Settings from './pages/app/Settings'
import Subscription from './pages/app/Subscription'
import FindBusiness from './pages/public/FindBusiness'
import Landing from './pages/public/Landing'
import Register from './pages/public/Register'
import { ensureCsrf } from './lib/api'
import { useMe, useTenantInfo } from './lib/hooks'
import { useNoIndex } from './lib/seo'
import { useTheme } from './lib/theme'

export default function App() {
  const { theme } = useTheme()
  const tenant = useTenantInfo()
  useEffect(() => { ensureCsrf() }, [])

  let body
  if (tenant.isLoading) {
    body = <div className="grid min-h-screen place-items-center"><div className="flex flex-col items-center gap-5"><Logo /><PageLoader /></div></div>
  } else if (tenant.isError || !tenant.data) {
    body = <WorkspaceNotFound />
  } else if (tenant.data.is_public) {
    body = <PublicRoutes />
  } else if (tenant.data.active === false) {
    body = <Disabled />
  } else {
    body = <TenantRoutes />
  }
  return (
    <>
      {body}
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

  if (me.isLoading) return <PageLoader />
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
