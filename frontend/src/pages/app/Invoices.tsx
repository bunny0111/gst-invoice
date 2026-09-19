import { keepPreviousData, useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { motion } from 'framer-motion'
import { ChevronRight, FileText, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { EmptyState, PageHeader, Pagination, Skeleton, StatusBadge, UpgradePrompt } from '@/components/ui/Bits'
import { LinkButton } from '@/components/ui/Button'
import { SearchInput } from '@/components/ui/Form'
import { get, qs } from '@/lib/api'
import { fmtDate, inr } from '@/lib/format'
import { useDebounce, useSubscription } from '@/lib/hooks'
import type { InvoiceRow, Paginated } from '@/lib/types'

const TABS = [
  { key: '', label: 'All', count: 'all' },
  { key: 'paid', label: 'Paid', count: 'paid' },
  { key: 'pending', label: 'Pending', count: 'pending' },
  { key: 'overdue', label: 'Overdue', count: 'overdue' },
  { key: 'draft', label: 'Draft', count: 'draft' },
] as const

export default function Invoices() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const status = params.get('status') ?? ''
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const dq = useDebounce(q)
  const sub = useSubscription().data

  useEffect(() => setPage(1), [status, dq])
  const counts = useQuery({ queryKey: ['invoice-summary'], queryFn: () => get<Record<string, number>>('/api/invoices/summary/') })
  const list = useQuery({
    queryKey: ['invoices', status, dq, page],
    queryFn: () => get<Paginated<InvoiceRow>>(`/api/invoices/${qs({ status, q: dq, page })}`),
    placeholderData: keepPreviousData,
  })

  const limit = sub?.limits.invoices_per_month ?? null
  const used = sub?.usage.invoices_per_month ?? 0
  const atLimit = limit !== null && used >= limit
  const rows = list.data?.results ?? []

  return (
    <>
      <PageHeader
        title="Invoices"
        subtitle={sub ? `${used}${limit !== null ? ` of ${limit}` : ''} invoices created this month` : undefined}
        actions={atLimit
          ? <button disabled className="inline-flex h-11 cursor-not-allowed items-center gap-2 rounded-xl bg-line px-5 text-sm font-semibold text-muted"><Plus className="size-[18px]" />New invoice</button>
          : <LinkButton to="/invoices/new" icon={<Plus className="size-[18px]" strokeWidth={2.6} />}>New invoice</LinkButton>}
      />
      {atLimit && sub && limit !== null && <div className="mb-6"><UpgradePrompt resource="invoices_per_month" limit={limit} plans={sub.plans} planName={sub.plan_name} /></div>}

      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4">
          <div className="scroll-thin flex gap-1 overflow-x-auto rounded-xl bg-surface-2 p-1" role="tablist">
            {TABS.map((t) => {
              const active = status === t.key
              const n = counts.data?.[t.count]
              return (
                <button key={t.key} role="tab" aria-selected={active} onClick={() => setParams(t.key ? { status: t.key } : {})}
                  className={clsx('relative flex items-center gap-2 whitespace-nowrap rounded-lg px-4 py-2 text-[13px] font-bold transition-colors', active ? 'text-brand-ink' : 'text-muted hover:text-ink')}>
                  {active && <motion.span layoutId="tab-pill" className="absolute inset-0 rounded-lg bg-surface shadow-sm ring-1 ring-line" />}
                  <span className="relative">{t.label}</span>
                  {n !== undefined && <span className={clsx('num relative rounded-full px-1.5 py-0.5 text-[11px]', t.key === 'overdue' && n > 0 ? 'bg-crit-soft text-crit-ink' : 'bg-line text-muted')}>{n}</span>}
                </button>
              )
            })}
          </div>
          <SearchInput value={q} onChange={setQ} placeholder="Search invoice # or customer" className="w-full sm:w-72" />
        </div>

        {list.isLoading ? (
          <div className="space-y-3 p-5">{Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
        ) : rows.length === 0 ? (
          <EmptyState icon={<FileText className="size-8" />} title={dq || status ? 'No invoices match' : 'No invoices yet'} message={dq || status ? 'Try another filter or search term.' : 'Create your first GST invoice — it takes under two minutes.'}
            action={!dq && !status && !atLimit && <LinkButton to="/invoices/new" icon={<Plus className="size-4" />}>Create first invoice</LinkButton>} />
        ) : (
          <div className={clsx('overflow-x-auto scroll-thin transition-opacity', list.isPlaceholderData && 'opacity-60')}>
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead><tr className="border-b border-line bg-surface-2 text-[11.5px] font-bold uppercase tracking-wider text-muted">
                <th className="px-5 py-3.5">Invoice</th><th className="px-3">Customer</th><th className="px-3">Date</th><th className="px-3">Due</th><th className="px-3 text-right">Amount</th><th className="px-3 text-right">Balance</th><th className="px-3">Status</th><th className="w-10" />
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} onClick={() => navigate(`/invoices/${r.id}`)} className="group cursor-pointer border-b border-line transition-colors last:border-0 hover:bg-surface-2">
                    <td className="num px-5 py-4 font-bold text-ink">{r.invoice_number ?? <span className="font-semibold italic text-muted">Draft #{r.id}</span>}</td>
                    <td className="px-3 font-medium text-ink-2">{r.customer_name}</td>
                    <td className="num px-3 text-muted">{fmtDate(r.invoice_date)}</td>
                    <td className={clsx('num px-3', r.status === 'overdue' ? 'font-semibold text-crit-ink' : 'text-muted')}>{fmtDate(r.due_date)}</td>
                    <td className="num px-3 text-right font-bold text-ink">{inr(r.grand_total)}</td>
                    <td className={clsx('num px-3 text-right', Number(r.balance_due) > 0 && r.stored_status !== 'draft' && r.stored_status !== 'cancelled' ? 'font-semibold text-ink-2' : 'text-muted')}>{r.stored_status === 'draft' || r.stored_status === 'cancelled' ? '—' : inr(r.balance_due)}</td>
                    <td className="px-3"><StatusBadge status={r.status} /></td>
                    <td className="pr-4 text-muted"><ChevronRight className="size-4 transition-transform group-hover:translate-x-1 group-hover:text-brand" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {list.data && <Pagination page={page} count={list.data.count} onPage={setPage} />}
      </div>
    </>
  )
}
