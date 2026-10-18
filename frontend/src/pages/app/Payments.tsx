import { keepPreviousData, useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { CalendarDays, Download, Eye, FilterX, Hash, Pencil, Trash2, Wallet } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { EditPaymentModal, PaymentDetailsModal, UndoPaymentDialog, receiptHref, useRefreshPayments } from '@/components/payments/PaymentDialogs'
import { EmptyState, PageHeader, Pagination, Skeleton, StatTile } from '@/components/ui/Bits'
import { LinkButton } from '@/components/ui/Button'
import { IconButton } from '@/components/ui/Button'
import { SearchInput, Select, inputCls } from '@/components/ui/Form'
import { get, qs } from '@/lib/api'
import { fmtDate, inr, inrWholeRupees } from '@/lib/format'
import { useDebounce, useMeta } from '@/lib/hooks'
import type { Paginated, PaymentRecord } from '@/lib/types'

const MODE_TONE: Record<string, string> = {
  cash: 'bg-warn-soft text-warn-ink', upi: 'bg-info-soft text-info-ink', bank_transfer: 'bg-good-soft text-good-ink', cheque: 'bg-brand-soft text-brand-ink',
}

export default function Payments() {
  const meta = useMeta().data
  const [params] = useSearchParams()
  const [q, setQ] = useState(params.get('q') ?? '')
  const [mode, setMode] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)
  const dq = useDebounce(q)
  const refresh = useRefreshPayments()

  const [viewing, setViewing] = useState<PaymentRecord | null>(null)
  const [editing, setEditing] = useState<PaymentRecord | null>(null)
  const [undoing, setUndoing] = useState<PaymentRecord | null>(null)

  useEffect(() => setPage(1), [dq, mode, from, to])
  const filters = { q: dq, mode, date_from: from, date_to: to }
  const list = useQuery({
    queryKey: ['payments', dq, mode, from, to, page],
    queryFn: () => get<Paginated<PaymentRecord>>(`/api/payments/${qs({ ...filters, page })}`),
    placeholderData: keepPreviousData,
  })
  const summary = useQuery({
    queryKey: ['payments-summary', dq, mode, from, to],
    queryFn: () => get<{ count: number; total: string; this_month: string }>(`/api/payments/summary/${qs(filters)}`),
    placeholderData: keepPreviousData,
  })

  const rows = list.data?.results ?? []
  const filtered = !!(dq || mode || from || to)
  const clear = () => { setQ(''); setMode(''); setFrom(''); setTo('') }

  return (
    <>
      <PageHeader title="Payment details" subtitle="Every payment you've recorded — view it, correct it, undo it, or generate a receipt." />

      <div className="mb-6 grid gap-5 sm:grid-cols-3">
        <StatTile label={filtered ? 'Received (filtered)' : 'Total received'} value={inrWholeRupees(summary.data?.total ?? 0)} icon={<Wallet className="size-[18px]" />} tone="good" />
        <StatTile label="Received this month" value={inrWholeRupees(summary.data?.this_month ?? 0)} icon={<CalendarDays className="size-[18px]" />} tone="info" delay={0.05} />
        <StatTile label="Payments recorded" value={summary.data?.count ?? 0} icon={<Hash className="size-[18px]" />} tone="brand" delay={0.1} />
      </div>

      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-line p-4">
          <SearchInput value={q} onChange={setQ} placeholder="Search customer, invoice, receipt no. or reference" className="min-w-64 flex-1" />
          <Select value={mode} onChange={(e) => setMode(e.target.value)} className="!w-44" aria-label="Payment mode">
            <option value="">All modes</option>
            {(meta?.payment_modes ?? []).map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}
          </Select>
          <label className="flex items-center gap-2 text-[13px] font-semibold text-muted">From<input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className={clsx(inputCls, 'h-11 !w-40')} aria-label="From date" /></label>
          <label className="flex items-center gap-2 text-[13px] font-semibold text-muted">To<input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className={clsx(inputCls, 'h-11 !w-40')} aria-label="To date" /></label>
          {filtered && <button onClick={clear} className="inline-flex h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-muted hover:bg-brand-soft hover:text-brand-ink"><FilterX className="size-4" />Clear</button>}
        </div>

        {list.isLoading ? (
          <div className="space-y-3 p-5">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
        ) : rows.length === 0 ? (
          <EmptyState icon={<Wallet className="size-8" />} title={filtered ? 'No payments match' : 'No payments yet'}
            message={filtered ? 'Try a different search, mode or date range.' : 'When you record a payment against an invoice it shows up here, with its receipt.'}
            action={!filtered && <LinkButton to="/invoices?status=pending" size="sm">Go to unpaid invoices</LinkButton>} />
        ) : (
          <div className={clsx('overflow-x-auto scroll-thin transition-opacity', list.isPlaceholderData && 'opacity-60')}>
            <table className="w-full min-w-[960px] text-left text-sm">
              <thead><tr className="border-b border-line bg-surface-2 text-[11.5px] font-bold uppercase tracking-wider text-muted">
                <th className="px-5 py-3.5">Receipt</th><th className="px-3">Date</th><th className="px-3">Invoice</th><th className="px-3">Customer</th><th className="px-3">Mode</th><th className="px-3">Reference</th><th className="px-3 text-right">Amount</th><th className="px-5 text-right">Actions</th>
              </tr></thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id} className="group border-b border-line transition-colors last:border-0 hover:bg-surface-2 hover:shadow-[inset_3px_0_0_var(--brand)]">
                    <td className="num px-5 py-3.5 font-bold text-ink">{p.receipt_number}</td>
                    <td className="num px-3 text-muted">{fmtDate(p.payment_date)}</td>
                    <td className="px-3"><Link to={`/invoices/${p.invoice}`} className="num font-semibold text-brand-ink hover:underline">{p.invoice_number}</Link></td>
                    <td className="px-3 font-medium text-ink-2">{p.customer_name}</td>
                    <td className="px-3"><span className={clsx('rounded-full px-2.5 py-1 text-xs font-semibold', MODE_TONE[p.mode] ?? 'bg-[var(--neutral-soft)] text-[var(--neutral-ink)]')}>{p.mode_label}</span></td>
                    <td className="num max-w-40 truncate px-3 text-muted" title={p.reference}>{p.reference || '—'}</td>
                    <td className="num px-3 text-right font-bold text-ink">{inr(p.amount)}</td>
                    <td className="px-5"><div className="flex justify-end gap-0.5">
                      <IconButton label="View details" onClick={() => setViewing(p)}><Eye className="size-4" /></IconButton>
                      <IconButton label="Edit payment" onClick={() => setEditing(p)}><Pencil className="size-4" /></IconButton>
                      <a href={receiptHref(p.id)} download aria-label="Generate receipt" title="Generate receipt" className="inline-grid size-9 place-items-center rounded-lg text-ink-2 transition-colors hover:bg-brand-soft hover:text-brand-ink"><Download className="size-4" /></a>
                      <IconButton label="Delete payment" onClick={() => setUndoing(p)} className="hover:!bg-crit-soft hover:!text-crit-ink"><Trash2 className="size-4" /></IconButton>
                    </div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {list.data && <Pagination page={page} count={list.data.count} onPage={setPage} />}
      </div>

      <PaymentDetailsModal payment={viewing} onClose={() => setViewing(null)} onEdit={(p) => { setViewing(null); setEditing(p) }} />
      <EditPaymentModal payment={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh() }} />
      <UndoPaymentDialog payment={undoing} onClose={() => setUndoing(null)} onDone={() => { setUndoing(null); refresh() }} />
    </>
  )
}
