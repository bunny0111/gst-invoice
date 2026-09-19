import clsx from 'clsx'
import { motion } from 'framer-motion'
import {
  AlertCircle, Ban, CheckCircle2, ChevronLeft, ChevronRight, FilePen, Loader2, Moon, PieChart, ReceiptIndianRupee,
  Send, Sparkles, Sun, TrendingUp,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useTheme } from '@/lib/theme'
import type { InvoiceStatus, Plan } from '@/lib/types'
import { LinkButton } from './Button'

export function Logo({ compact, light }: { compact?: boolean; light?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <span className="gradient-brand relative grid size-9 place-items-center rounded-xl shadow-[0_6px_16px_-6px_rgb(91_69_240/0.8)]">
        <ReceiptIndianRupee className="size-5 text-white" strokeWidth={2.2} />
        <span className="absolute -right-1 -top-1 size-2.5 rounded-full bg-[#ffb84d] ring-2 ring-white/90 dark:ring-[#17142e]" />
      </span>
      {!compact && (
        <span className="leading-none">
          <span className={clsx('block font-display text-[17px] font-extrabold tracking-tight', light ? 'text-white' : 'text-ink')}>GST Billing</span>
          <span className={clsx('mt-0.5 block text-[10.5px] font-semibold uppercase tracking-[0.14em]', light ? 'text-white/60' : 'text-muted')}>by Tech Cognixium</span>
        </span>
      )}
    </span>
  )
}

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggle } = useTheme()
  return (
    <button
      onClick={toggle}
      aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      className={clsx('grid size-10 place-items-center rounded-xl border border-line bg-surface text-ink-2 transition hover:border-brand/40 hover:text-brand-ink', className)}
    >
      {theme === 'dark' ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
    </button>
  )
}

const STATUS: Record<InvoiceStatus, { label: string; icon: typeof Send; cls: string }> = {
  draft: { label: 'Draft', icon: FilePen, cls: 'bg-[var(--neutral-soft)] text-[var(--neutral-ink)]' },
  sent: { label: 'Sent', icon: Send, cls: 'bg-info-soft text-info-ink' },
  partial: { label: 'Partially paid', icon: PieChart, cls: 'bg-warn-soft text-warn-ink' },
  paid: { label: 'Paid', icon: CheckCircle2, cls: 'bg-good-soft text-good-ink' },
  overdue: { label: 'Overdue', icon: AlertCircle, cls: 'bg-crit-soft text-crit-ink' },
  cancelled: { label: 'Cancelled', icon: Ban, cls: 'bg-[var(--neutral-soft)] text-[var(--neutral-ink)] line-through decoration-1' },
}

/** Colour-coded status pill - always icon + label, never colour alone. */
export function StatusBadge({ status, className }: { status: InvoiceStatus; className?: string }) {
  const s = STATUS[status] ?? STATUS.draft
  const Icon = s.icon
  return (
    <span className={clsx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold', s.cls, className)}>
      <Icon className="size-3.5" strokeWidth={2.4} />
      {s.label}
    </span>
  )
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={clsx('size-5 animate-spin text-brand', className)} />
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('skeleton', className)} />
}

export function PageLoader() {
  return (
    <div className="grid min-h-[50vh] place-items-center">
      <Spinner className="size-8" />
    </div>
  )
}

export function EmptyState({
  icon, title, message, action,
}: { icon: ReactNode; title: string; message: string; action?: ReactNode }) {
  return (
    <div className="grid place-items-center px-6 py-16 text-center">
      <div className="relative mb-5">
        <div className="absolute inset-0 -z-10 scale-150 rounded-full bg-brand/10 blur-2xl" />
        <div className="grid size-16 place-items-center rounded-2xl bg-brand-soft text-brand">{icon}</div>
      </div>
      <h3 className="font-display text-lg font-bold text-ink">{title}</h3>
      <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-muted">{message}</p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  )
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="font-display text-[26px] font-extrabold leading-tight tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
    </div>
  )
}

export function Pagination({ page, count, pageSize = 20, onPage }: { page: number; count: number; pageSize?: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(count / pageSize))
  if (pages <= 1) return null
  return (
    <div className="flex items-center justify-between border-t border-line px-5 py-3.5 text-sm text-muted">
      <span>
        Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, count)} of {count}
      </span>
      <div className="flex items-center gap-1.5">
        <button disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page" className="grid size-9 place-items-center rounded-lg border border-line text-ink-2 hover:bg-brand-soft disabled:opacity-40">
          <ChevronLeft className="size-4" />
        </button>
        <span className="px-2 font-semibold text-ink-2">{page} / {pages}</span>
        <button disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page" className="grid size-9 place-items-center rounded-lg border border-line text-ink-2 hover:bg-brand-soft disabled:opacity-40">
          <ChevronRight className="size-4" />
        </button>
      </div>
    </div>
  )
}

/** Usage bar. The fill escalates accent -> warning -> critical as the limit nears (meter spec). */
export function UsageMeter({ used, limit, label, onDark }: { used: number; limit: number | null; label?: string; onDark?: boolean }) {
  const unlimited = limit === null
  const pct = unlimited ? Math.min(100, used * 4) : Math.min(100, (used / Math.max(limit, 1)) * 100)
  const tone = unlimited ? 'bg-brand' : pct >= 100 ? 'bg-crit' : pct >= 80 ? 'bg-warn' : 'bg-brand'
  return (
    <div>
      {label && (
        <div className="mb-1.5 flex items-baseline justify-between text-[13px]">
          <span className="font-semibold text-ink-2">{label}</span>
          <span className="num text-muted">{used} / {unlimited ? '∞' : limit}</span>
        </div>
      )}
      <div className={clsx('h-2 overflow-hidden rounded-full', onDark ? 'bg-white/20' : 'bg-brand-soft')}>
        <motion.div className={clsx('h-full rounded-full', onDark && tone === 'bg-brand' ? 'bg-[#ffb84d]' : tone)} initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.7, ease: 'easeOut' }} />
      </div>
    </div>
  )
}

const RESOURCE_LABEL: Record<string, string> = { customers: 'customers', products: 'products & services', invoices_per_month: 'invoices this month' }

/** PRD section 6: inline (never a popup) upgrade prompt with a plan comparison. */
export function UpgradePrompt({ resource, limit, plans, planName }: { resource: string; limit: number; plans?: Plan[]; planName: string }) {
  const paid = (plans ?? []).filter((p) => p.key !== 'free')
  const fmt = (v: number | null) => (v === null ? 'Unlimited' : v)
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
      className="relative overflow-hidden rounded-2xl border border-brand/25 bg-gradient-to-br from-brand-soft via-surface to-surface p-5"
    >
      <div className="pointer-events-none absolute -right-10 -top-10 size-40 rounded-full bg-brand/10 blur-2xl" />
      <div className="relative flex flex-wrap items-center gap-x-6 gap-y-4">
        <span className="gradient-brand grid size-11 shrink-0 place-items-center rounded-xl text-white shadow-lg"><Sparkles className="size-5" /></span>
        <div className="min-w-56 flex-1">
          <p className="font-display text-[15px] font-bold text-ink">
            You've reached the {planName} plan limit of {limit} {RESOURCE_LABEL[resource] ?? resource}
          </p>
          <p className="mt-0.5 text-sm text-muted">Upgrade to keep growing — your data and invoices stay exactly as they are.</p>
        </div>
        <div className="flex flex-wrap gap-2.5">
          {paid.map((p) => (
            <div key={p.key} className="rounded-xl border border-line bg-surface px-3.5 py-2 text-xs">
              <div className="font-bold text-ink">{p.name} <span className="font-medium text-muted">· ₹{p.price}/mo</span></div>
              <div className="mt-0.5 text-muted">{fmt(p.limits[resource as keyof Plan['limits']])} {RESOURCE_LABEL[resource]}</div>
            </div>
          ))}
        </div>
        <LinkButton to="/subscription" size="sm" icon={<TrendingUp className="size-4" />}>Upgrade plan</LinkButton>
      </div>
    </motion.div>
  )
}

export function StatTile({
  label, value, hint, icon, tone = 'brand', to, delay = 0,
}: {
  label: string; value: ReactNode; hint?: ReactNode; icon: ReactNode; tone?: 'brand' | 'good' | 'warn' | 'crit' | 'info'; to?: string; delay?: number
}) {
  const tones = {
    brand: 'bg-brand-soft text-brand', good: 'bg-good-soft text-good-ink', warn: 'bg-warn-soft text-warn-ink',
    crit: 'bg-crit-soft text-crit-ink', info: 'bg-info-soft text-info-ink',
  }
  const body = (
    <motion.div
      initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay, duration: 0.4 }}
      className={clsx('card group h-full p-5 transition-all duration-200', to && 'hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-pop')}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="text-[13px] font-semibold text-muted">{label}</span>
        <span className={clsx('grid size-9 place-items-center rounded-xl transition-transform group-hover:scale-110', tones[tone])}>{icon}</span>
      </div>
      <div className="mt-3 font-display text-[28px] font-extrabold leading-none tracking-tight text-ink">{value}</div>
      {hint && <div className="mt-2.5 text-xs text-muted">{hint}</div>}
    </motion.div>
  )
  return to ? <Link to={to} className="block h-full">{body}</Link> : body
}

export function Avatar({ name, className }: { name: string; className?: string }) {
  const hue = [...name].reduce((a, c) => a + c.charCodeAt(0), 0) % 360
  return (
    <span
      className={clsx('grid size-9 shrink-0 place-items-center rounded-full text-xs font-bold text-white', className)}
      style={{ background: `linear-gradient(135deg, hsl(${hue} 70% 58%), hsl(${(hue + 40) % 360} 70% 45%))` }}
    >
      {name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('')}
    </span>
  )
}
