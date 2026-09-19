import { motion } from 'framer-motion'
import { AlertCircle, CheckCircle2, Clock } from 'lucide-react'
import { Link } from 'react-router-dom'
import { inrWholeRupees } from '@/lib/format'
import type { Dashboard } from '@/lib/types'

/**
 * Part-to-whole of billable invoices as ONE stacked bar (not a donut - close values read badly in a
 * donut). Segment colours mean good / warning / critical, so they come from the fixed status palette
 * and each is paired with an icon + label (never colour alone). A 2px surface gap separates segments.
 */
export default function StatusBar({ counts, outstanding, overdueAmount }: { counts: Dashboard['counts']; outstanding: string; overdueAmount: string }) {
  const parts = [
    { key: 'paid', label: 'Paid', n: counts.paid, color: 'var(--good)', icon: CheckCircle2, to: '/invoices?status=paid', note: '' },
    { key: 'pending', label: 'Pending', n: counts.pending, color: 'var(--warn)', icon: Clock, to: '/invoices?status=pending', note: 'Not yet due' },
    { key: 'overdue', label: 'Overdue', n: counts.overdue, color: 'var(--crit)', icon: AlertCircle, to: '/invoices?status=overdue', note: `${inrWholeRupees(overdueAmount)} late` },
  ]
  const total = parts.reduce((a, p) => a + p.n, 0)

  return (
    <div>
      <h3 className="font-display text-base font-bold text-ink">Invoice status</h3>
      <p className="mt-0.5 text-[13px] text-muted">{total} billable invoice{total === 1 ? '' : 's'} · {inrWholeRupees(outstanding)} outstanding</p>

      <div className="mt-6 flex h-3.5 gap-0.5 overflow-hidden rounded-[7px] bg-line" role="img" aria-label={parts.map((p) => `${p.label} ${p.n}`).join(', ')}>
        {total > 0 && parts.filter((p) => p.n > 0).map((p, i) => (
          <motion.div key={p.key} initial={{ width: 0 }} animate={{ width: `${(p.n / total) * 100}%` }} transition={{ duration: 0.7, delay: i * 0.1, ease: 'easeOut' }}
            className="h-full first:rounded-l-[7px] last:rounded-r-[7px]" style={{ background: p.color }} />
        ))}
      </div>

      <ul className="mt-5 space-y-1.5">
        {parts.map((p) => (
          <li key={p.key}>
            <Link to={p.to} className="group flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-surface-2">
              <span className="size-3 shrink-0 rounded-[4px]" style={{ background: p.color }} />
              <p.icon className="size-4 shrink-0 text-muted" />
              <span className="flex-1 text-sm font-semibold text-ink-2">{p.label}{p.note && <span className="ml-2 text-xs font-medium text-muted">{p.note}</span>}</span>
              <span className="num text-sm font-bold text-ink">{p.n}</span>
              <span className="num w-10 text-right text-xs text-muted">{total ? Math.round((p.n / total) * 100) : 0}%</span>
            </Link>
          </li>
        ))}
      </ul>
      {counts.draft > 0 && <Link to="/invoices?status=draft" className="mt-3 block rounded-xl bg-surface-2 px-3.5 py-2.5 text-[13px] text-muted transition hover:text-brand-ink"><b className="text-ink-2">{counts.draft}</b> draft{counts.draft === 1 ? '' : 's'} not yet finalized →</Link>}
    </div>
  )
}
