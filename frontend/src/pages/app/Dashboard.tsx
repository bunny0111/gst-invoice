import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { motion } from 'framer-motion'
import {
  AlertCircle, ArrowDownRight, ArrowRight, ArrowUpRight, CheckCircle2, Circle, Clock, FilePlus2, FileText, HandCoins, Plus, Rocket,
  ReceiptIndianRupee, Trophy, Users,
} from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import RevenueChart from '@/components/charts/RevenueChart'
import StatusBar from '@/components/charts/StatusBar'
import { Avatar, EmptyState, Skeleton, StatTile, StatusBadge } from '@/components/ui/Bits'
import { LinkButton } from '@/components/ui/Button'
import { get } from '@/lib/api'
import { fmtDate, inr, inrWholeRupees } from '@/lib/format'
import { useCountUp, useMe, useSubscription } from '@/lib/hooks'
import type { Dashboard as DashboardData } from '@/lib/types'

function greeting() {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

export default function Dashboard() {
  const me = useMe().data!
  const sub = useSubscription().data
  const navigate = useNavigate()
  const { data, isLoading } = useQuery({ queryKey: ['dashboard'], queryFn: () => get<DashboardData>('/api/dashboard/') })
  const revenue = Number(data?.revenue.this_month ?? 0)
  const animated = useCountUp(revenue)

  if (isLoading || !data) return <DashboardSkeleton />
  const change = data.revenue.change_percent
  const up = (change ?? 0) >= 0
  const invoiceCount = data.counts.total + data.counts.draft
  const steps = [
    { done: me.profile_complete, label: 'Complete your business profile', hint: 'GSTIN, address and bank details appear on every invoice', to: '/settings' },
    { done: (sub?.usage.customers ?? 0) > 0, label: 'Add your first customer', hint: 'Their state decides CGST + SGST vs IGST', to: '/customers' },
    { done: (sub?.usage.products ?? 0) > 0, label: 'Add a product or service', hint: 'With its HSN/SAC code and GST rate', to: '/products' },
    { done: invoiceCount > 0, label: 'Create your first invoice', hint: 'It takes under two minutes', to: '/invoices/new' },
  ]
  const showOnboarding = invoiceCount === 0 && steps.some((s) => !s.done)
  const doneCount = steps.filter((s) => s.done).length

  return (
    <>
      <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-muted">{greeting()} 👋</p>
          <h1 className="font-display text-[28px] font-extrabold leading-tight tracking-tight text-ink">{me.business_name}</h1>
        </div>
        <LinkButton to="/invoices/new" className="hidden sm:inline-flex" icon={<Plus className="size-[18px]" strokeWidth={2.6} />}>New invoice</LinkButton>
      </div>

      {showOnboarding && (
        <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="card relative mb-6 overflow-hidden p-6 sm:p-7">
          <div className="pointer-events-none absolute -right-16 -top-16 size-56 rounded-full bg-brand/10 blur-3xl" />
          <div className="relative flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4"><span className="gradient-brand grid size-12 place-items-center rounded-2xl text-white shadow-lg"><Rocket className="size-6" /></span>
              <div><h2 className="font-display text-lg font-extrabold text-ink">Let's get you set up</h2><p className="text-sm text-muted">{doneCount} of {steps.length} steps done — you're minutes away from your first invoice.</p></div></div>
            <div className="h-2 w-48 overflow-hidden rounded-full bg-brand-soft"><motion.div className="h-full rounded-full bg-brand" initial={{ width: 0 }} animate={{ width: `${(doneCount / steps.length) * 100}%` }} transition={{ duration: 0.8 }} /></div>
          </div>
          <ol className="relative mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {steps.map((s, i) => (
              <li key={s.label}>
                <Link to={s.to} className={clsx('group flex h-full items-start gap-3 rounded-2xl border p-4 transition-all hover:-translate-y-0.5', s.done ? 'border-good/30 bg-good-soft' : 'border-line bg-surface-2 hover:border-brand/40')}>
                  {s.done ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-good-ink" /> : <Circle className="mt-0.5 size-5 shrink-0 text-muted" />}
                  <div><p className={clsx('text-sm font-bold', s.done ? 'text-good-ink line-through decoration-1' : 'text-ink')}>{i + 1}. {s.label}</p><p className="mt-0.5 text-xs text-muted">{s.hint}</p></div>
                </Link>
              </li>
            ))}
          </ol>
        </motion.section>
      )}

      {/* hero + headline tiles */}
      <div className="grid gap-5 lg:grid-cols-[1.35fr_1fr]">
        <motion.section initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} className="relative overflow-hidden rounded-2xl bg-[linear-gradient(135deg,#3c27a8_0%,#5b45f0_55%,#8b4bf0_100%)] p-7 text-white shadow-pop sm:p-9">
          <div className="animate-blob absolute -right-16 -top-20 size-72 rounded-full bg-[#ff8a5c]/30 blur-3xl" />
          <div className="relative">
            <p className="text-sm font-semibold text-white/75">Revenue · {data.month_label}</p>
            <p className="mt-3 font-display text-[56px] font-extrabold leading-none tracking-tight sm:text-[64px]">{inrWholeRupees(animated)}</p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              {change === null ? (
                <span className="rounded-full bg-white/15 px-3.5 py-1.5 text-[13px] font-semibold text-white/90">{revenue > 0 ? 'First month of revenue 🎉' : 'Create an invoice to start tracking'}</span>
              ) : (
                <span className={clsx('inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-bold', up ? 'bg-[#22c98a]/25 text-[#b6ffdf]' : 'bg-[#ff6b6b]/25 text-[#ffd0d0]')}>
                  {up ? <ArrowUpRight className="size-4" strokeWidth={2.6} /> : <ArrowDownRight className="size-4" strokeWidth={2.6} />}{up ? '+' : ''}{change}%
                </span>
              )}
              <span className="text-[13px] text-white/75">vs {inrWholeRupees(data.revenue.last_month)} last month</span>
            </div>
          </div>
        </motion.section>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          <StatTile label="Outstanding receivables" value={inrWholeRupees(data.outstanding)} icon={<HandCoins className="size-[18px]" />} tone="warn" delay={0.05}
            hint={Number(data.overdue_amount) > 0 ? <span className="font-semibold text-crit-ink">{inrWholeRupees(data.overdue_amount)} is overdue</span> : 'Nothing overdue — nice!'} to="/invoices?status=pending" />
          <StatTile label="Collected this month" value={inrWholeRupees(data.revenue.collected_this_month)} icon={<ReceiptIndianRupee className="size-[18px]" />} tone="good" delay={0.1} hint={`Payments received in ${data.month_label}`} to="/invoices?status=paid" />
        </div>
      </div>

      {/* count cards - each clickable to the filtered list (US-08 AC2) */}
      <div className="mt-5 grid grid-cols-2 gap-5 lg:grid-cols-4">
        <StatTile label="Total invoices" value={data.counts.total} icon={<FileText className="size-[18px]" />} tone="brand" delay={0.12} to="/invoices" hint={`${data.counts.draft} draft${data.counts.draft === 1 ? '' : 's'}`} />
        <StatTile label="Paid" value={data.counts.paid} icon={<CheckCircle2 className="size-[18px]" />} tone="good" delay={0.16} to="/invoices?status=paid" />
        <StatTile label="Pending" value={data.counts.pending} icon={<Clock className="size-[18px]" />} tone="info" delay={0.2} to="/invoices?status=pending" hint="Awaiting payment" />
        <StatTile label="Overdue" value={data.counts.overdue} icon={<AlertCircle className="size-[18px]" />} tone="crit" delay={0.24} to="/invoices?status=overdue" hint={data.counts.overdue ? 'Needs follow-up' : 'All on time'} />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1.6fr_1fr]">
        <div className="card p-6"><RevenueChart trend={data.trend} /></div>
        <div className="card p-6"><StatusBar counts={data.counts} outstanding={data.outstanding} overdueAmount={data.overdue_amount} /></div>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1.6fr_1fr]">
        <section className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-6 py-4">
            <h3 className="font-display text-base font-bold text-ink">Recent invoices</h3>
            <Link to="/invoices" className="inline-flex items-center gap-1 text-[13px] font-bold text-brand-ink hover:underline">View all <ArrowRight className="size-3.5" /></Link>
          </div>
          {data.recent_invoices.length === 0 ? (
            <EmptyState icon={<FilePlus2 className="size-8" />} title="No invoices yet" message="Your latest invoices will appear here with their payment status." action={<LinkButton to="/invoices/new" size="sm" icon={<Plus className="size-4" />}>Create invoice</LinkButton>} />
          ) : (
            <div className="overflow-x-auto scroll-thin">
              <table className="w-full min-w-[520px] text-left text-sm">
                <thead><tr className="border-b border-line bg-surface-2 text-[11.5px] font-bold uppercase tracking-wider text-muted"><th className="px-6 py-3">Invoice</th><th className="px-3">Customer</th><th className="px-3 text-right">Amount</th><th className="px-6">Status</th></tr></thead>
                <tbody>
                  {data.recent_invoices.map((r) => (
                    <tr key={r.id} onClick={() => navigate(`/invoices/${r.id}`)} className="cursor-pointer border-b border-line transition-colors last:border-0 hover:bg-surface-2">
                      <td className="num px-6 py-3.5 font-bold text-ink">{r.invoice_number ?? <span className="font-semibold italic text-muted">Draft #{r.id}</span>}<span className="block text-xs font-normal text-muted">{fmtDate(r.invoice_date)}</span></td>
                      <td className="px-3 font-medium text-ink-2">{r.customer_name}</td>
                      <td className="num px-3 text-right font-bold text-ink">{inr(r.grand_total)}</td>
                      <td className="px-6"><StatusBadge status={r.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="card p-6">
          <div className="flex items-center gap-2.5"><Trophy className="size-5 text-[#f5b301]" /><h3 className="font-display text-base font-bold text-ink">Top customers</h3></div>
          <p className="mt-0.5 text-[13px] text-muted">By revenue in {data.month_label}</p>
          {data.top_customers.length === 0 ? (
            <div className="mt-8 text-center text-sm text-muted"><Users className="mx-auto mb-3 size-8 text-muted/50" />Your best customers will show up here once you've invoiced this month.</div>
          ) : (
            <ol className="mt-5 space-y-4">
              {data.top_customers.map((c, i) => {
                const pct = (Number(c.revenue) / Number(data.top_customers[0].revenue)) * 100
                return (
                  <li key={c.customer_id}>
                    <div className="flex items-center gap-3">
                      <span className="num w-4 text-xs font-bold text-muted">{i + 1}</span><Avatar name={c.name} className="size-8" />
                      <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-ink">{c.name}</p><p className="text-xs text-muted">{c.invoices} invoice{c.invoices === 1 ? '' : 's'}</p></div>
                      <span className="num text-sm font-bold text-ink">{inrWholeRupees(c.revenue)}</span>
                    </div>
                    <div className="ml-[3.75rem] mt-2 h-1.5 overflow-hidden rounded-full bg-brand-soft"><motion.div className="h-full rounded-full bg-brand" initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.7, delay: 0.1 * i }} /></div>
                  </li>
                )
              })}
            </ol>
          )}
        </section>
      </div>
    </>
  )
}

function DashboardSkeleton() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-16 w-72" />
      <div className="grid gap-5 lg:grid-cols-[1.35fr_1fr]"><Skeleton className="h-56 !rounded-2xl" /><div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2"><Skeleton className="h-32 !rounded-2xl" /><Skeleton className="h-32 !rounded-2xl" /></div></div>
      <div className="grid grid-cols-2 gap-5 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28 !rounded-2xl" />)}</div>
      <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]"><Skeleton className="h-80 !rounded-2xl" /><Skeleton className="h-80 !rounded-2xl" /></div>
    </div>
  )
}
