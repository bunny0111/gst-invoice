import { useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowRight, Crown, FileText, LayoutDashboard, LogOut, Menu, Package, Plus, Wallet, Settings as SettingsIcon, TriangleAlert, Users, X,
} from 'lucide-react'
import { useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Avatar, Logo, ThemeToggle, UsageMeter } from '@/components/ui/Bits'
import { LinkButton } from '@/components/ui/Button'
import { post } from '@/lib/api'
import { useMe, useSubscription } from '@/lib/hooks'

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/invoices', label: 'Invoices', icon: FileText },
  { to: '/payments', label: 'Payment details', icon: Wallet },
  { to: '/customers', label: 'Customers', icon: Users },
  { to: '/products', label: 'Products & services', icon: Package },
  { to: '/settings', label: 'Business profile', icon: SettingsIcon },
  { to: '/subscription', label: 'Plan & billing', icon: Crown },
]

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const me = useMe().data!
  const sub = useSubscription().data
  const qc = useQueryClient()
  const navigate = useNavigate()

  const logout = async () => {
    await post('/api/auth/logout/').catch(() => {})
    qc.clear()
    qc.setQueryData(['me'], null)
    navigate('/login')
    toast.success('Signed out. See you soon!')
  }
  const invLimit = sub?.limits.invoices_per_month ?? null

  return (
    <div className="flex h-full flex-col text-white">
      <div className="px-5 pb-2 pt-6"><Logo light /></div>
      <div className="px-4 pt-5">
        <LinkButton to="/invoices/new" onClick={onNavigate} variant="white" className="w-full" icon={<Plus className="size-[18px]" strokeWidth={2.6} />}>
          New invoice
        </LinkButton>
      </div>
      <nav className="mt-6 flex-1 space-y-1 overflow-y-auto px-3">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to} to={to} end={end} onClick={onNavigate}
            className={({ isActive }) => clsx(
              'group relative flex items-center gap-3 overflow-hidden rounded-xl px-3.5 py-2.5 text-sm font-semibold transition-colors',
              isActive ? 'text-white' : 'text-white/65 hover:bg-white/8 hover:text-white',
            )}
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <motion.span
                    layoutId="nav-pill"
                    className="absolute inset-0 rounded-xl bg-gradient-to-r from-white/16 to-white/5 ring-1 ring-white/10"
                    transition={{ type: 'spring', damping: 28, stiffness: 320 }}
                  />
                )}
                {isActive && (
                  <motion.span
                    layoutId="nav-accent"
                    className="absolute inset-y-2 left-0 w-1 rounded-full bg-[#ffb84d] shadow-[0_0_10px_1px_rgba(255,184,77,0.7)]"
                    transition={{ type: 'spring', damping: 28, stiffness: 320 }}
                  />
                )}
                <Icon className="relative size-[18px]" strokeWidth={isActive ? 2.4 : 2} />
                <span className="relative">{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="space-y-3 p-4">
        {sub && (
          <NavLink to="/subscription" onClick={onNavigate} className="group relative block overflow-hidden rounded-2xl bg-white/[0.07] p-4 ring-1 ring-white/10 transition hover:bg-white/[0.11] hover:ring-white/20">
            <div className="pointer-events-none absolute -right-8 -top-10 size-32 rounded-full bg-[#ffb84d]/20 blur-2xl transition-opacity duration-300 group-hover:opacity-80" />
            <div className="relative mb-3 flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-white/60">Current plan</span>
              <span className="rounded-full bg-gradient-to-r from-[#ffcf7a] to-[#ffb84d] px-2.5 py-0.5 text-[11px] font-extrabold text-[#3a2600] shadow-sm">{sub.plan_name}</span>
            </div>
            <UsageMeter used={sub.usage.invoices_per_month} limit={invLimit} onDark />
            <p className="mt-2 flex items-center justify-between text-xs text-white/70">
              <span>{sub.usage.invoices_per_month}{invLimit !== null ? ` of ${invLimit}` : ''} invoices this month</span>
              {sub.plan === 'free' && <ArrowRight className="size-3.5" />}
            </p>
          </NavLink>
        )}
        <div className="flex items-center gap-3 rounded-2xl bg-black/15 p-3">
          <Avatar name={me.business_name || me.email} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-bold">{me.business_name}</p>
            <p className="truncate text-xs text-white/60">{me.email}</p>
          </div>
          <button onClick={logout} aria-label="Sign out" title="Sign out" className="rounded-lg p-2 text-white/70 transition hover:bg-white/10 hover:text-white">
            <LogOut className="size-[18px]" />
          </button>
        </div>
      </div>
    </div>
  )
}

const sidebarBg = 'bg-[linear-gradient(180deg,#2a1d78_0%,#1d1458_55%,#150e42_100%)]'

export default function AppShell() {
  const me = useMe().data!
  const [open, setOpen] = useState(false)
  const location = useLocation()

  return (
    <div className="min-h-screen lg:pl-72">
      <aside className={clsx('fixed inset-y-0 left-0 z-30 hidden w-72 overflow-hidden lg:block', sidebarBg)}>
        <div className="bg-grid-pattern-invert pointer-events-none absolute inset-0" />
        <div className="pointer-events-none absolute -left-16 top-1/3 size-64 rounded-full bg-[#7a68ff]/25 blur-3xl" />
        <div className="pointer-events-none absolute -right-20 bottom-0 size-56 rounded-full bg-[#ff8a5c]/10 blur-3xl" />
        <div className="relative h-full"><SidebarContent /></div>
      </aside>

      <AnimatePresence>
        {open && (
          <>
            <motion.div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen(false)} />
            <motion.aside
              className={clsx('fixed inset-y-0 left-0 z-50 w-72 overflow-hidden lg:hidden', sidebarBg)}
              initial={{ x: -300 }} animate={{ x: 0 }} exit={{ x: -300 }} transition={{ type: 'spring', damping: 30, stiffness: 320 }}
            >
              <div className="bg-grid-pattern-invert pointer-events-none absolute inset-0" />
              <div className="pointer-events-none absolute -left-16 top-1/3 size-64 rounded-full bg-[#7a68ff]/25 blur-3xl" />
              <button onClick={() => setOpen(false)} aria-label="Close menu" className="absolute right-3 top-5 z-10 rounded-lg p-2 text-white/80 hover:bg-white/10"><X className="size-5" /></button>
              <div className="relative h-full"><SidebarContent onNavigate={() => setOpen(false)} /></div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b border-line bg-canvas/80 px-4 backdrop-blur-xl sm:px-8">
        <div className="flex items-center gap-3">
          <button onClick={() => setOpen(true)} aria-label="Open menu" className="grid size-10 place-items-center rounded-xl border border-line bg-surface text-ink-2 lg:hidden"><Menu className="size-5" /></button>
          <div className="lg:hidden"><Logo compact /></div>
          <p className="hidden text-sm text-muted lg:block">Workspace <span className="font-semibold text-ink">{me.business.slug}</span></p>
        </div>
        <div className="flex items-center gap-2.5">
          <LinkButton to="/invoices/new" size="sm" className="lg:hidden" icon={<Plus className="size-4" />}>New</LinkButton>
          <ThemeToggle />
        </div>
      </header>

      <AnimatePresence>
        {!me.profile_complete && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-warn/30 bg-warn-soft px-4 py-3 sm:px-8">
              <TriangleAlert className="size-[18px] shrink-0 text-warn-ink" />
              <p className="flex-1 text-sm font-semibold text-warn-ink">Complete your profile to generate invoices</p>
              <NavLink to="/settings" className="inline-flex items-center gap-1.5 rounded-lg bg-warn-ink/10 px-3 py-1.5 text-[13px] font-bold text-warn-ink hover:bg-warn-ink/15">
                Finish setup <ArrowRight className="size-3.5" />
              </NavLink>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-8">
        <motion.div key={location.pathname} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28, ease: 'easeOut' }}>
          <Outlet />
        </motion.div>
      </main>
    </div>
  )
}
