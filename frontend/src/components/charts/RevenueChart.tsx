import clsx from 'clsx'
import { motion } from 'framer-motion'
import { BarChart3, Table2 } from 'lucide-react'
import { useState } from 'react'
import { inr, inrCompact } from '@/lib/format'
import type { Dashboard } from '@/lib/types'

/** Axis step so that 4 equal intervals cover the data with CLEAN tick values (1 / 2 / 2.5 / 5 x 10^k). */
const INTERVALS = 4
function niceStep(v: number): number {
  if (v <= 0) return 250
  const raw = (v * 1.05) / INTERVALS
  const exp = Math.pow(10, Math.floor(Math.log10(raw)))
  for (const m of [1, 2, 2.5, 5, 10]) if (m * exp >= raw) return m * exp
  return 10 * exp
}

const PLOT_H = 190 // px of plot area; the x-axis band is added below so the card never scrolls

/**
 * Six-month revenue columns. Form = single series with emphasis: the current month carries the
 * accent hue, earlier months sit in the de-emphasis grey. No legend (one series - the title names it),
 * <=24px columns with a 4px rounded top and square baseline, hairline solid grid, one direct label
 * (the current month), tooltip on hover AND keyboard focus, and a table view as the accessible twin.
 */
export default function RevenueChart({ trend }: { trend: Dashboard['trend'] }) {
  const [view, setView] = useState<'chart' | 'table'>('chart')
  const [hover, setHover] = useState<number | null>(null)
  const values = trend.map((t) => Number(t.revenue))
  const step = niceStep(Math.max(...values, 0))
  const max = step * INTERVALS
  const ticks = Array.from({ length: INTERVALS + 1 }, (_, i) => step * i)
  const last = trend.length - 1
  const empty = values.every((v) => v === 0)

  return (
    <div>
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-base font-bold text-ink">Revenue, last 6 months</h3>
          <p className="mt-0.5 text-[13px] text-muted">Invoiced amount by month (excludes drafts and cancelled invoices)</p>
        </div>
        <div className="flex rounded-lg bg-surface-2 p-1" role="tablist" aria-label="Chart or table view">
          {([['chart', BarChart3, 'Chart'], ['table', Table2, 'Table']] as const).map(([k, Icon, label]) => (
            <button key={k} role="tab" aria-selected={view === k} aria-label={`${label} view`} onClick={() => setView(k)} className={clsx('grid size-8 place-items-center rounded-md transition', view === k ? 'bg-surface text-brand-ink shadow-sm ring-1 ring-line' : 'text-muted hover:text-ink')}><Icon className="size-4" /></button>
          ))}
        </div>
      </div>

      {view === 'table' ? (
        <table className="w-full text-sm">
          <thead><tr className="border-b border-line text-left text-[11.5px] font-bold uppercase tracking-wider text-muted"><th className="py-2.5">Month</th><th className="py-2.5 text-right">Revenue</th></tr></thead>
          <tbody>{trend.map((t) => <tr key={t.month + t.year} className="border-b border-line last:border-0"><td className="py-2.5 font-medium text-ink-2">{t.month} {t.year}</td><td className="num py-2.5 text-right font-semibold text-ink">{inr(t.revenue)}</td></tr>)}</tbody>
        </table>
      ) : (
        <div className="relative pl-12" style={{ height: PLOT_H + 34 }}>
          {/* y-axis + hairline gridlines */}
          {ticks.map((t, i) => (
            <div key={i} className="absolute left-0 right-0" style={{ bottom: 34 + (t / max) * PLOT_H }}>
              <span className="num absolute -top-2 left-0 w-10 text-right text-[11px] text-muted">{inrCompact(t)}</span>
              <div className="ml-12 h-px" style={{ background: i === 0 ? 'var(--line-strong)' : 'var(--grid)' }} />
            </div>
          ))}
          <div className="absolute bottom-[34px] left-12 right-0 flex" style={{ height: PLOT_H }}>
            {trend.map((t, i) => {
              const v = values[i]
              const h = max ? Math.max((v / max) * PLOT_H, v > 0 ? 3 : 0) : 0
              const current = i === last
              return (
                <button key={t.month + t.year} type="button" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}
                  aria-label={`${t.month} ${t.year}: ${inr(v)}`} className="group relative flex h-full flex-1 items-end justify-center outline-none focus-visible:bg-brand-soft/60">
                  {/* hover / focus tooltip */}
                  {hover === i && (
                    <div role="tooltip" className="pointer-events-none absolute z-10 whitespace-nowrap rounded-lg border border-line bg-surface px-3 py-2 text-left shadow-pop" style={{ bottom: Math.min(h + 14, PLOT_H - 40) }}>
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">{t.month} {t.year}</p>
                      <p className="num text-sm font-bold text-ink">{inr(v)}</p>
                    </div>
                  )}
                  {current && v > 0 && hover !== i && <span className="num absolute text-xs font-bold text-ink" style={{ bottom: h + 6 }}>{inrCompact(v)}</span>}
                  <motion.div
                    initial={{ height: 0 }} animate={{ height: h }} transition={{ duration: 0.7, delay: i * 0.06, ease: 'easeOut' }}
                    className="w-6 rounded-t-[4px] transition-[filter] group-hover:brightness-110"
                    style={{ background: current ? 'var(--brand)' : 'var(--muted)', opacity: current ? 1 : hover === i ? 0.9 : 0.55 }}
                  />
                  <span className="absolute -bottom-[26px] text-xs font-medium" style={{ color: current ? 'var(--ink)' : 'var(--muted)' }}>{t.month}</span>
                </button>
              )
            })}
          </div>
          {empty && <p className="absolute inset-x-12 top-1/2 -translate-y-1/2 text-center text-sm text-muted">No invoiced revenue in the last 6 months yet.</p>}
        </div>
      )}
    </div>
  )
}
