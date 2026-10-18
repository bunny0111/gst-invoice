import { useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, CreditCard, Crown, Download, FlaskConical, Lock, Minus, PartyPopper, ShieldCheck, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { PageHeader, PageLoader, UsageMeter } from '@/components/ui/Bits'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog, Modal } from '@/components/ui/Modal'
import { ApiError, post } from '@/lib/api'
import { fmtDate, inr } from '@/lib/format'
import { useSubscription } from '@/lib/hooks'
import type { PlanKey, Plan, Subscription as Sub } from '@/lib/types'

declare global { interface Window { Razorpay?: any } }

interface Checkout { mode: 'mock' | 'razorpay'; plan: PlanKey; amount: number; subscription_id: string; key_id?: string; business_name?: string; prefill?: { email: string } }

function loadRazorpay(): Promise<boolean> {
  if (window.Razorpay) return Promise.resolve(true)
  return new Promise((resolve) => {
    const s = document.createElement('script')
    s.src = 'https://checkout.razorpay.com/v1/checkout.js'
    s.onload = () => resolve(true)
    s.onerror = () => resolve(false)
    document.body.appendChild(s)
  })
}

const fmtLimit = (v: number | null) => (v === null ? 'Unlimited' : String(v))
const RANK: Record<PlanKey, number> = { free: 0, starter: 1, pro: 2 }

export default function Subscription() {
  const qc = useQueryClient()
  const { data: sub, isLoading } = useSubscription()
  const [busyPlan, setBusyPlan] = useState<PlanKey | null>(null)
  const [demo, setDemo] = useState<Checkout | null>(null)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [celebrate, setCelebrate] = useState<string | null>(null)

  if (isLoading || !sub) return <PageLoader />

  const done = (s: Sub) => {
    qc.setQueryData(['subscription'], s)
    qc.invalidateQueries({ queryKey: ['me'] })
    setCelebrate(s.plan_name)
  }

  const choose = async (plan: PlanKey) => {
    if (plan === 'free') return setCancelOpen(true)
    setBusyPlan(plan)
    try {
      const co = await post<Checkout>('/api/subscription/checkout/', { plan })
      if (co.mode === 'mock') { setDemo(co); return }
      if (!(await loadRazorpay())) return toast.error("Couldn't load Razorpay checkout. Check your connection.")
      const rzp = new window.Razorpay({
        key: co.key_id, subscription_id: co.subscription_id, name: 'Tech Cognixium',
        description: `GST Billing ${sub.plans.find((p) => p.key === plan)?.name} plan`, prefill: co.prefill, theme: { color: '#5b45f0' },
        handler: async (resp: Record<string, string>) => {
          try { done(await post<Sub>('/api/subscription/verify/', { plan, ...resp })) }
          catch (e) { toast.error(e instanceof ApiError ? e.message : 'Payment verification failed') }
        },
      })
      rzp.open()
    } catch (e) { toast.error(e instanceof ApiError ? e.message : 'Could not start checkout') }
    finally { setBusyPlan(null) }
  }

  const cancel = async () => {
    setCancelling(true)
    try {
      const s = await post<Sub>('/api/subscription/cancel/')
      qc.setQueryData(['subscription'], s); setCancelOpen(false)
      toast.success(`Your ${s.plan_name} plan stays active until ${fmtDate(s.plan_expires_on)}, then moves to Free.`)
    } catch (e) { toast.error(e instanceof ApiError ? e.message : 'Could not cancel') }
    finally { setCancelling(false) }
  }

  const paid = sub.plan !== 'free'
  const current = sub.plans.find((p) => p.key === sub.plan)!

  return (
    <>
      <PageHeader title="Plan & billing" subtitle="Upgrade when you grow. Cancel any time — your data always stays yours." />

      {sub.razorpay.mock && (
        <div className="mb-6 flex items-start gap-3 rounded-2xl border border-info/30 bg-info-soft p-4 text-sm text-info-ink">
          <FlaskConical className="mt-0.5 size-5 shrink-0" />
          <p><b>Demo payments are on.</b> Razorpay keys in <code className="rounded bg-info/10 px-1.5 py-0.5 text-[12px]">.env</code> are still placeholders, so checkout is simulated and no money is charged. Add real keys to go live.</p>
        </div>
      )}

      {/* current plan */}
      <section className="card relative overflow-hidden p-6 sm:p-8">
        <div className="pointer-events-none absolute -right-20 -top-20 size-64 rounded-full bg-brand/10 blur-3xl" />
        <div className="relative grid gap-8 lg:grid-cols-[1fr_1.1fr]">
          <div>
            <div className="flex items-center gap-4">
              <span className="gradient-brand grid size-14 place-items-center rounded-2xl text-white shadow-lg"><Crown className="size-7" /></span>
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">Current plan</p>
                <h2 className="font-display text-3xl font-extrabold text-ink">{sub.plan_name}</h2>
              </div>
            </div>
            <p className="mt-5 text-[15px] text-ink-2">
              {paid ? (sub.cancel_at_period_end
                ? <>Cancels on <b>{fmtDate(sub.plan_expires_on)}</b> — you keep all {current.name} features until then, then move to Free.</>
                : <>{inr(current.price)} / month · renews on <b>{fmtDate(sub.plan_expires_on)}</b></>) : 'Free forever. Upgrade any time for higher limits.'}
            </p>
            {paid && !sub.cancel_at_period_end && <Button variant="ghost" size="sm" className="mt-4 !px-0 text-crit-ink hover:!bg-transparent hover:underline" onClick={() => setCancelOpen(true)}>Cancel subscription</Button>}
          </div>
          <div className="space-y-5">
            <UsageMeter label="Invoices this month" used={sub.usage.invoices_per_month} limit={sub.limits.invoices_per_month} />
            <UsageMeter label="Customers" used={sub.usage.customers} limit={sub.limits.customers} />
            <UsageMeter label="Products & services" used={sub.usage.products} limit={sub.limits.products} />
            <p className="text-xs text-muted">Invoices reset on the 1st of every month (drafts count). Customers and products are cumulative totals.</p>
          </div>
        </div>
      </section>

      {/* plans */}
      <div className="mt-8 grid gap-6 md:grid-cols-3">
        {sub.plans.map((p) => <PlanCard key={p.key} plan={p} current={p.key === sub.plan} cancelling={sub.cancel_at_period_end && p.key === sub.plan} busy={busyPlan === p.key} currentKey={sub.plan} onChoose={() => choose(p.key)} />)}
      </div>

      {/* comparison */}
      <section className="card mt-8 overflow-hidden">
        <div className="border-b border-line px-6 py-4"><h3 className="font-display text-base font-bold text-ink">Compare plans</h3></div>
        <div className="overflow-x-auto scroll-thin">
          <table className="w-full table-fixed text-left sm:table-auto text-[12.5px] sm:text-sm">
            <thead><tr className="border-b border-line bg-surface-2 text-[10.5px] font-bold uppercase tracking-normal text-muted sm:text-[12px] sm:tracking-wider"><th className="w-[34%] px-3 py-3.5 sm:w-auto sm:px-6">Feature</th>{sub.plans.map((p) => <th key={p.key} className={clsx('px-0.5 text-center sm:px-3', p.key === sub.plan && 'text-brand-ink')}>{p.name}</th>)}</tr></thead>
            <tbody>
              {sub.comparison.map((row) => (
                <tr key={row.feature} className="border-b border-line last:border-0">
                  <td className="px-3 py-3 font-semibold text-ink-2 sm:px-6 sm:py-3.5">{row.feature}{row.soon && <span className="ml-2 rounded-full bg-warn-soft px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide text-warn-ink">Coming soon</span>}</td>
                  {(['free', 'starter', 'pro'] as const).map((k) => <td key={k} className={clsx('px-0.5 text-center sm:px-3', k === sub.plan && 'bg-brand-soft/50')}>{row[k] === true ? <Check className="mx-auto size-[18px] text-good-ink" strokeWidth={3} /> : row[k] === false ? <Minus className="mx-auto size-4 text-muted/60" /> : <span className="text-[12px] font-semibold text-ink-2 sm:text-[13px]">{row[k]}</span>}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* receipts */}
      <section className="card mt-8 overflow-hidden">
        <div className="border-b border-line px-6 py-4"><h3 className="font-display text-base font-bold text-ink">Payment receipts</h3></div>
        {sub.receipts.length === 0 ? <p className="px-6 py-10 text-center text-sm text-muted">No subscription payments yet.</p> : (
          <ul>
            {sub.receipts.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-4 border-b border-line px-6 py-4 last:border-0">
                <span className="grid size-10 place-items-center rounded-xl bg-good-soft text-good-ink"><CreditCard className="size-5" /></span>
                <div className="min-w-0 flex-1"><p className="text-sm font-bold text-ink">{r.plan_name} plan{r.is_demo && <span className="ml-2 rounded-full bg-info-soft px-2 py-0.5 text-[10.5px] font-bold uppercase text-info-ink">Demo</span>}</p><p className="num text-xs text-muted">{r.receipt_number} · {fmtDate(r.paid_at)}</p></div>
                <span className="num font-bold text-ink">{inr(r.amount)}</span>
                <a href={`/api/subscription/receipts/${r.id}/pdf/`} download><Button variant="secondary" size="sm" icon={<Download className="size-4" />}>Receipt</Button></a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <DemoCheckout checkout={demo} plans={sub.plans} onClose={() => setDemo(null)} onPaid={(s) => { setDemo(null); done(s) }} />
      <ConfirmDialog open={cancelOpen} onClose={() => setCancelOpen(false)} onConfirm={cancel} loading={cancelling} danger confirmLabel={paid ? 'Cancel subscription' : 'OK'}
        title={paid ? 'Cancel your subscription?' : 'You are already on Free'}
        message={paid ? <>You'll keep <b>{sub.plan_name}</b> until <b>{fmtDate(sub.plan_expires_on)}</b>, then move to the Free plan (10 invoices/month, 10 customers, 20 products). Nothing you've created is deleted.</> : 'There is nothing to cancel.'} />
      <Celebrate name={celebrate} onClose={() => setCelebrate(null)} />
    </>
  )
}

function PlanCard({ plan, current, cancelling, busy, currentKey, onChoose }: { plan: Plan; current: boolean; cancelling: boolean; busy: boolean; currentKey: PlanKey; onChoose: () => void }) {
  const pop = plan.key === 'starter'
  const upgrade = RANK[plan.key] > RANK[currentKey]
  const label = current ? (cancelling ? 'Resume — choose again' : 'Your current plan') : plan.key === 'free' ? 'Downgrade to Free' : upgrade ? `Upgrade to ${plan.name}` : `Switch to ${plan.name}`
  return (
    <motion.div whileHover={{ y: -4 }} className={clsx('relative flex flex-col rounded-3xl p-7 transition-shadow', pop ? 'gradient-brand text-white shadow-[0_30px_60px_-22px_rgb(91_69_240/0.7)]' : 'card', current && !pop && 'ring-2 ring-brand')}>
      {pop && <span className="absolute -top-3.5 left-7 rounded-full bg-[#ffb84d] px-3.5 py-1 text-[11px] font-extrabold uppercase tracking-wider text-[#3a2600]">Most popular</span>}
      {current && <span className={clsx('absolute right-6 top-6 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold', pop ? 'bg-white/20' : 'bg-brand-soft text-brand-ink')}><Check className="size-3" strokeWidth={3.5} />Current</span>}
      <h3 className={clsx('font-display text-xl font-extrabold', !pop && 'text-ink')}>{plan.name}</h3>
      <p className={clsx('mt-1 text-sm', pop ? 'text-white/75' : 'text-muted')}>{plan.tagline}</p>
      <p className="mt-5 flex items-baseline gap-1.5"><span className={clsx('font-display text-5xl font-extrabold tracking-tight', !pop && 'text-ink')}>{plan.price === 0 ? '₹0' : `₹${plan.price}`}</span><span className={clsx('text-sm font-semibold', pop ? 'text-white/70' : 'text-muted')}>{plan.price === 0 ? 'forever' : '/ month'}</span></p>
      <ul className="mt-6 flex-1 space-y-3 text-sm">
        {[`${fmtLimit(plan.limits.invoices_per_month)} invoices / month`, `${fmtLimit(plan.limits.customers)} customers`, `${fmtLimit(plan.limits.products)} products & services`, 'GST PDF invoices'].map((b) => (
          <li key={b} className="flex items-center gap-3 font-medium"><span className={clsx('grid size-5 place-items-center rounded-full', pop ? 'bg-white/20' : 'bg-good-soft text-good-ink')}><Check className="size-3" strokeWidth={3.5} /></span><span className={pop ? 'text-white' : 'text-ink-2'}>{b}</span></li>
        ))}
      </ul>
      <Button onClick={onChoose} loading={busy} disabled={current && !cancelling} variant={pop ? 'secondary' : upgrade ? 'primary' : 'secondary'} className={clsx('mt-7 w-full', pop && '!border-transparent !text-[#3c27a8]')}>{label}</Button>
    </motion.div>
  )
}

/** Simulated Razorpay checkout - only reachable when keys are placeholders AND the server is in DEBUG. */
function DemoCheckout({ checkout, plans, onClose, onPaid }: { checkout: Checkout | null; plans: Plan[]; onClose: () => void; onPaid: (s: Sub) => void }) {
  const [busy, setBusy] = useState(false)
  const plan = plans.find((p) => p.key === checkout?.plan)
  const pay = async () => {
    if (!checkout) return
    setBusy(true)
    try {
      await new Promise((r) => setTimeout(r, 1200))
      onPaid(await post<Sub>('/api/subscription/verify/', { plan: checkout.plan, razorpay_subscription_id: checkout.subscription_id }))
    } catch (e) { toast.error(e instanceof ApiError ? e.message : 'Demo payment failed') }
    finally { setBusy(false) }
  }
  return (
    <Modal open={!!checkout} onClose={busy ? () => {} : onClose} title="Demo checkout" subtitle="Simulated Razorpay payment — no money is charged" size="sm"
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button onClick={pay} loading={busy} icon={<Lock className="size-4" />}>Pay {inr(checkout?.amount)}</Button></>}>
      <div className="rounded-2xl bg-brand-soft p-5"><div className="flex items-baseline justify-between"><span className="font-display font-bold text-brand-ink">GST Billing · {plan?.name}</span><span className="font-display text-2xl font-extrabold text-ink">{inr(checkout?.amount)}</span></div><p className="mt-1 text-xs text-muted">Billed monthly · cancel any time</p></div>
      <div className="mt-5 space-y-3 opacity-80">
        {[['Card number', '4111 1111 1111 1111'], ['Expiry', '12 / 30'], ['CVV', '•••']].map(([l, v]) => <div key={l}><p className="mb-1 text-xs font-semibold text-muted">{l}</p><div className="rounded-xl border border-line-strong bg-surface-2 px-3.5 py-2.5 text-sm text-ink-2">{v}</div></div>)}
      </div>
      <p className="mt-4 flex items-center gap-2 text-xs text-muted"><ShieldCheck className="size-4 text-good-ink" />Demo mode — the plan is activated for 30 days without a real charge.</p>
    </Modal>
  )
}

function Celebrate({ name, onClose }: { name: string | null; onClose: () => void }) {
  return (
    <AnimatePresence>
      {name && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 grid place-items-center bg-[#0d0a2b]/60 p-6 backdrop-blur-sm" onClick={onClose}>
          <motion.div initial={{ scale: 0.8, y: 30 }} animate={{ scale: 1, y: 0 }} transition={{ type: 'spring', damping: 14 }} onClick={(e) => e.stopPropagation()} className="card w-full max-w-sm p-9 text-center">
            <motion.div initial={{ rotate: -20, scale: 0 }} animate={{ rotate: 0, scale: 1 }} transition={{ delay: 0.15, type: 'spring' }} className="gradient-brand mx-auto grid size-20 place-items-center rounded-3xl text-white shadow-xl"><PartyPopper className="size-10" /></motion.div>
            <h2 className="mt-6 font-display text-2xl font-extrabold text-ink">You're on {name}!</h2>
            <p className="mt-2 text-sm text-muted">Your new limits are active right now. Happy billing!</p>
            <Button className="mt-7 w-full" onClick={onClose} icon={<Sparkles className="size-4" />}>Let's go</Button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
