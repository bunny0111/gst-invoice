import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { AnimatePresence, motion, useInView } from 'framer-motion'
import {
  ArrowRight, BadgeCheck, BarChart3, Calculator, Check, ChevronDown, Clock, FileDown, FileText, Gauge, IndianRupee,
  Lock, Minus, Package, Repeat, ShieldCheck, Smartphone, Sparkles, Store, Users, Wallet, Zap,
} from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'
import { LinkButton } from '@/components/ui/Button'
import { Select } from '@/components/ui/Form'
import { get } from '@/lib/api'
import { inr, inrPlain, trimZero } from '@/lib/format'
import { calcLine, detectSupply } from '@/lib/gst'
import { useMeta } from '@/lib/hooks'
import type { ComparisonRow, Plan } from '@/lib/types'

const fade = { hidden: { opacity: 0, y: 24 }, show: { opacity: 1, y: 0 } }

function Reveal({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  const ref = useRef(null)
  const inView = useInView(ref, { once: true, margin: '-60px' })
  return (
    <motion.div ref={ref} variants={fade} initial="hidden" animate={inView ? 'show' : 'hidden'} transition={{ duration: 0.55, delay, ease: 'easeOut' }} className={className}>
      {children}
    </motion.div>
  )
}

function SectionHead({ eyebrow, title, sub }: { eyebrow: string; title: ReactNode; sub?: string }) {
  return (
    <Reveal className="mx-auto max-w-2xl text-center">
      <span className="inline-block rounded-full bg-brand-soft px-3.5 py-1.5 text-xs font-bold uppercase tracking-[0.14em] text-brand-ink">{eyebrow}</span>
      <h2 className="mt-5 font-display text-3xl font-extrabold leading-tight tracking-tight text-ink sm:text-[40px]">{title}</h2>
      {sub && <p className="mt-4 text-lg leading-relaxed text-muted">{sub}</p>}
    </Reveal>
  )
}

/* ---------------------------------------------------------------- hero */
function HeroInvoice() {
  return (
    <div className="relative mx-auto w-full max-w-[460px] pb-14">
      <div className="absolute -inset-10 -z-10 rounded-full bg-gradient-to-tr from-[#7a68ff]/40 via-[#c05af0]/25 to-[#ff8a5c]/30 blur-3xl" />
      <motion.div
        initial={{ opacity: 0, y: 40, rotate: 6 }} animate={{ opacity: 1, y: 0, rotate: 2.5 }} transition={{ duration: 0.9, delay: 0.2, ease: 'easeOut' }}
        className="animate-float-slow relative"
      >
        <div className="card relative overflow-hidden p-6 shadow-pop">
          <div className="absolute inset-x-0 top-0 h-1.5 gradient-brand" />
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <span className="grid size-11 place-items-center rounded-xl bg-gradient-to-br from-[#ffb84d] to-[#ff7a59] font-display text-lg font-extrabold text-white">R</span>
              <div>
                <p className="font-display text-[15px] font-bold text-ink">Ramesh Electronics</p>
                <p className="text-xs text-muted">GSTIN 07AABCR1234F1Z5</p>
              </div>
            </div>
            <div className="text-right">
              <p className="font-display text-sm font-extrabold tracking-wider text-brand-ink">TAX INVOICE</p>
              <p className="num text-xs text-muted">INV/2026-27/042</p>
            </div>
          </div>
          <div className="mt-5 overflow-hidden rounded-xl border border-line text-[13px]">
            <div className="grid grid-cols-[1fr_auto] bg-brand-soft px-3.5 py-2 text-[11px] font-bold uppercase tracking-wider text-brand-ink"><span>Item</span><span>Amount</span></div>
            {[['LED Monitor 24" × 2', '₹18,000.00'], ['HDMI Cable × 1', '₹250.50']].map(([a, b]) => (
              <div key={a} className="grid grid-cols-[1fr_auto] border-t border-line px-3.5 py-2.5 text-ink-2"><span>{a}</span><span className="num font-semibold text-ink">{b}</span></div>
            ))}
          </div>
          <div className="mt-4 space-y-1.5 text-[13px]">
            <div className="flex justify-between text-muted"><span>CGST @ 9%</span><span className="num">₹1,642.55</span></div>
            <div className="flex justify-between text-muted"><span>SGST @ 9%</span><span className="num">₹1,642.55</span></div>
            <div className="flex items-baseline justify-between border-t border-dashed border-line-strong pt-3">
              <span className="font-bold text-ink">Grand total</span>
              <span className="font-display text-2xl font-extrabold text-brand-ink">₹21,536</span>
            </div>
          </div>
          <p className="mt-3 rounded-lg bg-surface-2 px-3 py-2 text-[11.5px] text-muted">Rupees Twenty One Thousand Five Hundred Thirty Six Only</p>
        </div>
        <motion.div
            initial={{ scale: 2.4, opacity: 0, rotate: -30 }} animate={{ scale: 1, opacity: 1, rotate: 10 }} transition={{ delay: 1.3, type: 'spring', damping: 12 }}
            className="absolute -right-3 -top-3 rounded-lg border-[3px] border-good bg-surface px-3 py-0.5 font-display text-lg font-extrabold tracking-widest text-good shadow-lg"
        >
            PAID
          </motion.div>
      </motion.div>

      <motion.div initial={{ opacity: 0, x: -30 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.9 }} className="absolute bottom-0 left-2 hidden sm:block">
        <div className="animate-float card flex items-center gap-3 px-4 py-3 shadow-pop">
          <span className="grid size-9 place-items-center rounded-lg bg-good-soft text-good-ink"><Zap className="size-[18px]" /></span>
          <div><p className="text-[13px] font-bold text-ink">GST auto-calculated</p><p className="text-xs text-muted">CGST 9% + SGST 9%</p></div>
        </div>
      </motion.div>
      <motion.div initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 1.1 }} className="absolute bottom-1 right-0 hidden sm:block">
        <div className="animate-float-slow card flex items-center gap-3 px-4 py-3 shadow-pop">
          <span className="grid size-9 place-items-center rounded-lg bg-info-soft text-info-ink"><FileDown className="size-[18px]" /></span>
          <div><p className="text-[13px] font-bold text-ink">PDF ready</p><p className="text-xs text-muted">in under 5 seconds</p></div>
        </div>
      </motion.div>
    </div>
  )
}

function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div className="bg-grid-pattern absolute inset-0 -z-10" />
      <div className="animate-blob absolute -left-32 top-10 -z-10 size-[420px] rounded-full bg-[#7a68ff]/25 blur-3xl" />
      <div className="animate-blob absolute -right-20 top-40 -z-10 size-[360px] rounded-full bg-[#ff8a5c]/20 blur-3xl [animation-delay:-6s]" />
      <div className="mx-auto grid max-w-7xl items-center gap-14 px-5 pb-20 pt-12 sm:px-8 lg:grid-cols-[1.05fr_0.95fr] lg:pb-28 lg:pt-20">
        <div>
          <motion.span initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="inline-flex items-center gap-2 rounded-full border border-brand/25 bg-surface px-4 py-2 text-[13px] font-semibold text-brand-ink shadow-sm">
            <Sparkles className="size-4 text-[#ff8a5c]" /> Built for India · Free to start
          </motion.span>
          <motion.h1 initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }} className="mt-6 font-display text-[44px] font-extrabold leading-[1.04] tracking-tight text-ink sm:text-6xl lg:text-[68px]">
            GST invoices in <span className="gradient-text">under 2 minutes.</span>
          </motion.h1>
          <motion.p initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.16 }} className="mt-6 max-w-xl text-lg leading-relaxed text-ink-2 sm:text-xl">
            The simple, affordable billing app for Indian shopkeepers, freelancers and traders. CGST, SGST and IGST calculated for you — so you can bill, get paid and stop worrying about mistakes.
          </motion.p>
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.24 }} className="mt-9 flex flex-wrap items-center gap-4">
            <LinkButton to="/register" size="lg" icon={<Sparkles className="size-5" />}>Start free — no card needed</LinkButton>
            <a href="/#calculator" onClick={(e) => { e.preventDefault(); document.getElementById('calculator')?.scrollIntoView({ behavior: 'smooth' }) }} className="group inline-flex items-center gap-2 px-2 py-3 text-[15px] font-bold text-ink-2 transition hover:text-brand-ink">
              Try the GST calculator <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
            </a>
          </motion.div>
          <motion.ul initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }} className="mt-10 flex flex-wrap gap-x-7 gap-y-3 text-sm font-semibold text-ink-2">
            {['10 free invoices every month', 'No accounting knowledge needed', 'Your data stays private'].map((t) => (
              <li key={t} className="flex items-center gap-2"><span className="grid size-5 place-items-center rounded-full bg-good-soft text-good-ink"><Check className="size-3.5" strokeWidth={3} /></span>{t}</li>
            ))}
          </motion.ul>
        </div>
        <HeroInvoice />
      </div>
    </section>
  )
}

/* ---------------------------------------------------------------- audience strip */
function Audience() {
  const items = ['Kirana & retail shops', 'Freelancers', 'Salons & service providers', 'Wholesale traders', 'Tiffin services & tutors', 'Small agencies', 'Electronics & clothing stores', 'Consultants']
  return (
    <section className="border-y border-line bg-surface/70 py-6">
      <p className="mb-4 text-center text-xs font-bold uppercase tracking-[0.18em] text-muted">Made for everyday Indian businesses</p>
      <div className="relative overflow-hidden [mask-image:linear-gradient(90deg,transparent,#000_12%,#000_88%,transparent)]">
        <motion.div className="flex w-max gap-4" animate={{ x: ['0%', '-50%'] }} transition={{ duration: 34, repeat: Infinity, ease: 'linear' }}>
          {[...items, ...items].map((t, i) => (
            <span key={i} className="flex items-center gap-2 whitespace-nowrap rounded-full border border-line bg-surface px-5 py-2.5 text-sm font-semibold text-ink-2"><Store className="size-4 text-brand" />{t}</span>
          ))}
        </motion.div>
      </div>
    </section>
  )
}

/* ---------------------------------------------------------------- problem -> solution */
function Problem() {
  const rows = [
    ['Excel & paper invoices full of errors', 'Auto-calculated, always-correct GST invoices', FileText],
    ['CGST vs SGST vs IGST confusion', 'Supply type detected from the customer\'s state', Calculator],
    ['Chasing who has paid and who hasn\'t', 'Paid / partial / overdue tracked automatically', Wallet],
    ['Expensive software that needs an accountant', 'Free to start, ₹199/month when you grow', IndianRupee],
  ] as const
  return (
    <section className="mx-auto max-w-7xl px-5 py-24 sm:px-8">
      <SectionHead eyebrow="Why GST Billing" title={<>Billing shouldn't need <span className="gradient-text">an accountant</span></>} sub="Tally is expensive. Zoho and ClearTax are complicated. We built the one that a shopkeeper can use on day one." />
      <div className="mx-auto mt-14 grid max-w-4xl gap-4">
        {rows.map(([pain, fix, Icon], i) => (
          <Reveal key={pain} delay={i * 0.06}>
            <div className="card grid items-center gap-4 p-5 sm:grid-cols-[1fr_auto_1fr] sm:p-6">
              <p className="flex items-center gap-3 text-[15px] font-semibold text-muted line-through decoration-crit/50"><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-crit-soft text-crit-ink no-underline"><Minus className="size-4" /></span><span>{pain}</span></p>
              <ArrowRight className="hidden size-5 text-brand sm:block" />
              <p className="flex items-center gap-3 text-[15px] font-bold text-ink"><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-good-soft text-good-ink"><Icon className="size-[18px]" /></span>{fix}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  )
}

/* ---------------------------------------------------------------- features */
const FEATURES = [
  { icon: Zap, title: 'GST that calculates itself', text: 'Pick a customer — we detect intra-state or inter-state and split CGST, SGST or IGST per line, live as you type.', c: 'from-[#7a68ff] to-[#5b45f0]' },
  { icon: FileDown, title: 'Professional PDF invoices', text: 'Logo, GSTIN, HSN table, tax summary, amount in words and bank details — one click, under 5 seconds.', c: 'from-[#ff8a5c] to-[#ef5d7e]' },
  { icon: Wallet, title: 'Payment tracking', text: 'Mark invoices paid or partially paid, record UPI / cash / bank / cheque, and see overdue at a glance.', c: 'from-[#22c98a] to-[#0c8f63]' },
  { icon: BarChart3, title: 'A dashboard that makes sense', text: 'Revenue vs last month, outstanding receivables, top customers and recent invoices — no digging.', c: 'from-[#3b9cff] to-[#2a5fd6]' },
  { icon: Users, title: 'Customers & catalogue', text: 'Save customers and products with HSN/SAC codes and GST rates once. Add them to invoices in seconds.', c: 'from-[#c05af0] to-[#8b3fd9]' },
  { icon: Lock, title: 'Your data is truly yours', text: 'Every business gets its own isolated database schema and subdomain. No one else can ever see your invoices.', c: 'from-[#f5b301] to-[#ef8a00]' },
  { icon: Repeat, title: 'Invoice numbering done right', text: 'Gapless, financial-year based numbers like INV/2026-27/001 — allocated when you finalize, as GST expects.', c: 'from-[#14b8c9] to-[#0e86a8]' },
  { icon: Smartphone, title: 'Works on every screen', text: 'Fast and mobile-friendly, so you can bill from the shop counter, your laptop or your phone.', c: 'from-[#ef5d7e] to-[#c02a5c]' },
]
function Features() {
  return (
    <section id="features" className="scroll-mt-20 bg-gradient-to-b from-transparent via-brand-soft/50 to-transparent py-24">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <SectionHead eyebrow="Features" title={<>Everything to bill, get paid<br className="hidden sm:block" /> and stay compliant</>} sub="Nothing extra, nothing confusing. Every feature earns its place." />
        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f, i) => (
            <Reveal key={f.title} delay={(i % 4) * 0.07}>
              <div className="card group h-full p-6 transition-all duration-300 hover:-translate-y-1.5 hover:border-brand/40 hover:shadow-pop">
                <span className={clsx('grid size-12 place-items-center rounded-2xl bg-gradient-to-br text-white shadow-lg transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-6', f.c)}><f.icon className="size-6" /></span>
                <h3 className="mt-5 font-display text-[17px] font-bold text-ink">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{f.text}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ---------------------------------------------------------------- live GST calculator */
function GstCalculator() {
  const { data: meta } = useMeta()
  const [amount, setAmount] = useState('10000')
  const [rate, setRate] = useState(18)
  const [biz, setBiz] = useState('DL')
  const [cust, setCust] = useState('DL')
  const supply = detectSupply(biz, cust) ?? 'intrastate'
  const r = calcLine({ quantity: '1', unit_price: amount || '0', discount_percent: '0', gst_rate: String(rate) }, supply)
  const states = meta?.states ?? []
  const name = (c: string) => states.find((s) => s.code === c)?.name ?? c

  return (
    <section id="calculator" className="mx-auto max-w-7xl scroll-mt-20 px-5 py-24 sm:px-8">
      <SectionHead eyebrow="Live demo" title={<>See the <span className="gradient-text">GST engine</span> work</>} sub="This is the same calculation every invoice uses. Change the states and watch CGST + SGST switch to IGST." />
      <Reveal className="mx-auto mt-14 max-w-5xl">
        <div className="card grid overflow-hidden lg:grid-cols-2">
          <div className="space-y-6 p-7 sm:p-9">
            <div>
              <label className="mb-2 block text-[13px] font-semibold text-ink-2" htmlFor="calc-amount">Invoice value (before tax)</label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 font-display text-xl font-bold text-muted">₹</span>
                <input id="calc-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} className="num h-14 w-full rounded-xl border border-line-strong bg-surface pl-10 pr-4 font-display text-2xl font-bold text-ink focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/15" />
              </div>
            </div>
            <div>
              <p className="mb-2 text-[13px] font-semibold text-ink-2">GST rate</p>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="GST rate">
                {[0, 5, 12, 18, 28].map((x) => (
                  <button key={x} role="radio" aria-checked={rate === x} onClick={() => setRate(x)} className={clsx('h-11 min-w-16 rounded-xl border px-4 text-sm font-bold transition', rate === x ? 'gradient-brand border-transparent text-white shadow-md' : 'border-line-strong bg-surface text-ink-2 hover:border-brand/50')}>{x}%</button>
                ))}
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div><label className="mb-2 block text-[13px] font-semibold text-ink-2" htmlFor="calc-biz">Your business state</label>
                <Select id="calc-biz" value={biz} onChange={(e) => setBiz(e.target.value)}>{states.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}</Select></div>
              <div><label className="mb-2 block text-[13px] font-semibold text-ink-2" htmlFor="calc-cust">Customer's state</label>
                <Select id="calc-cust" value={cust} onChange={(e) => setCust(e.target.value)}>{states.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}</Select></div>
            </div>
          </div>
          <div className="relative overflow-hidden bg-[linear-gradient(160deg,#2a1d78,#1d1458)] p-7 text-white sm:p-9">
            <div className="absolute -right-16 -top-16 size-64 rounded-full bg-[#7a68ff]/40 blur-3xl" />
            <div className="relative">
              <AnimatePresence mode="wait">
                <motion.div key={supply} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.25 }}>
                  <span className={clsx('inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-bold', supply === 'intrastate' ? 'bg-[#22c98a]/20 text-[#7df0bd]' : 'bg-[#ffb84d]/20 text-[#ffd58a]')}>
                    <BadgeCheck className="size-4" /> {supply === 'intrastate' ? 'Intra-state supply' : 'Inter-state supply'}
                  </span>
                  <p className="mt-3 text-sm text-white/70">{name(biz)} → {name(cust)}</p>
                  <div className="mt-6 space-y-3.5 text-[15px]">
                    <Row label="Taxable value" value={inr(r.taxable.toString())} />
                    {supply === 'intrastate' ? (<>
                      <Row label={`CGST @ ${trimZero(rate / 2)}%`} value={inr(r.cgst.toString())} accent />
                      <Row label={`SGST @ ${trimZero(rate / 2)}%`} value={inr(r.sgst.toString())} accent />
                    </>) : <Row label={`IGST @ ${rate}%`} value={inr(r.igst.toString())} accent />}
                  </div>
                  <div className="mt-6 border-t border-white/15 pt-5">
                    <p className="text-xs font-semibold uppercase tracking-widest text-white/60">Invoice total</p>
                    <p className="mt-1 font-display text-5xl font-extrabold tracking-tight">₹{inrPlain(Math.round(Number(r.total.toString())))}</p>
                    <p className="mt-2 text-xs text-white/60">Rounded to the nearest rupee, just like a real invoice.</p>
                  </div>
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  )
}
const Row = ({ label, value, accent }: { label: string; value: string; accent?: boolean }) => (
  <div className="flex items-center justify-between"><span className="text-white/75">{label}</span><span className={clsx('num font-bold', accent && 'text-[#ffd58a]')}>{value}</span></div>
)

/* ---------------------------------------------------------------- how it works */
function HowItWorks() {
  const steps = [
    { n: '1', title: 'Create your free account', text: 'Enter your business name, email and a password. You get your own private workspace address instantly.', icon: Sparkles },
    { n: '2', title: 'Set up once', text: 'Add your GSTIN, address, logo and bank details, then a few customers and products with their GST rates.', icon: Package },
    { n: '3', title: 'Bill in under 2 minutes', text: 'Choose a customer, add items, and download a perfect PDF. Track payments until the money lands.', icon: Clock },
  ]
  return (
    <section className="mx-auto max-w-7xl px-5 py-12 sm:px-8">
      <SectionHead eyebrow="How it works" title="From sign-up to first invoice in minutes" />
      <div className="relative mt-14 grid gap-6 md:grid-cols-3">
        <div className="absolute left-[16%] right-[16%] top-8 hidden h-0.5 bg-gradient-to-r from-brand/10 via-brand/50 to-brand/10 md:block" />
        {steps.map((s, i) => (
          <Reveal key={s.n} delay={i * 0.1} className="relative text-center">
            <div className="gradient-brand relative mx-auto grid size-16 place-items-center rounded-2xl text-white shadow-[0_14px_30px_-10px_rgb(91_69_240/0.8)]">
              <s.icon className="size-7" />
              <span className="absolute -right-2 -top-2 grid size-7 place-items-center rounded-full bg-[#ffb84d] text-xs font-extrabold text-[#3a2600] ring-4 ring-canvas">{s.n}</span>
            </div>
            <h3 className="mt-6 font-display text-lg font-bold text-ink">{s.title}</h3>
            <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-muted">{s.text}</p>
          </Reveal>
        ))}
      </div>
    </section>
  )
}

/* ---------------------------------------------------------------- personas */
function Personas() {
  const people = [
    { name: 'Ramesh', role: 'Electronics shop, Delhi', pain: '"I never understood CGST vs IGST — I kept making errors."', fix: 'Just picks the customer. The right tax is applied automatically.', c: 'from-[#ffb84d] to-[#ff7a59]' },
    { name: 'Priya', role: 'Freelance designer', pain: '"Corporate clients demand a GST invoice and I had no idea how."', fix: 'A professional PDF with GSTIN and HSN/SAC in two minutes.', c: 'from-[#7a68ff] to-[#c05af0]' },
    { name: 'Suresh', role: 'Wholesale cloth trader', pain: '"Selling across states, IGST vs SGST mix-ups cost me at filing."', fix: 'Every invoice is tagged intra- or inter-state, correctly, every time.', c: 'from-[#22c98a] to-[#14b8c9]' },
  ]
  return (
    <section className="mx-auto max-w-7xl px-5 py-20 sm:px-8">
      <SectionHead eyebrow="Real problems, solved" title="Built for people like Ramesh, Priya and Suresh" />
      <div className="mt-14 grid gap-5 md:grid-cols-3">
        {people.map((p, i) => (
          <Reveal key={p.name} delay={i * 0.08}>
            <div className="card h-full p-7">
              <div className="flex items-center gap-3.5">
                <span className={clsx('grid size-12 place-items-center rounded-full bg-gradient-to-br font-display text-lg font-extrabold text-white', p.c)}>{p.name[0]}</span>
                <div><p className="font-display font-bold text-ink">{p.name}</p><p className="text-[13px] text-muted">{p.role}</p></div>
              </div>
              <p className="mt-5 text-[15px] italic leading-relaxed text-ink-2">{p.pain}</p>
              <p className="mt-4 flex gap-2.5 rounded-xl bg-good-soft p-3.5 text-sm font-semibold leading-relaxed text-good-ink"><Check className="mt-0.5 size-4 shrink-0" strokeWidth={3} />{p.fix}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  )
}

/* ---------------------------------------------------------------- pricing */
function Cell({ v }: { v: string | boolean }) {
  if (v === true) return <Check className="mx-auto size-[18px] text-good-ink" strokeWidth={3} />
  if (v === false) return <Minus className="mx-auto size-4 text-muted/60" />
  return <span className="text-[13px] font-semibold text-ink-2">{v}</span>
}

function Pricing() {
  const { data } = useQuery({ queryKey: ['plans'], queryFn: () => get<{ plans: Plan[]; comparison: ComparisonRow[] }>('/api/plans/'), staleTime: Infinity })
  const [showAll, setShowAll] = useState(false)
  const plans = data?.plans ?? []
  const fmt = (v: number | null) => (v === null ? 'Unlimited' : v)
  const bullets = (p: Plan) => [
    `${fmt(p.limits.invoices_per_month)} invoices / month`,
    `${fmt(p.limits.customers)} customers`,
    `${fmt(p.limits.products)} products & services`,
    'GST PDF invoices',
    p.key === 'free' ? 'Basic dashboard' : p.key === 'starter' ? 'Monthly summary dashboard' : 'Full dashboard',
    p.key === 'free' ? 'Community support' : p.key === 'starter' ? 'Email support' : 'Email + chat support',
  ]
  return (
    <section id="pricing" className="scroll-mt-20 bg-gradient-to-b from-transparent via-brand-soft/50 to-transparent py-24">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <SectionHead eyebrow="Pricing" title={<>Start free. <span className="gradient-text">Upgrade only when you grow.</span></>} sub="No setup fees. No contracts. Cancel any time — your data stays with you." />
        <div className="mx-auto mt-14 grid max-w-5xl gap-6 md:grid-cols-3">
          {plans.map((p, i) => {
            const pop = p.key === 'starter'
            return (
              <Reveal key={p.key} delay={i * 0.08}>
                <div className={clsx('relative flex h-full flex-col rounded-3xl p-7 transition-all duration-300 hover:-translate-y-1', pop ? 'gradient-brand text-white shadow-[0_30px_60px_-20px_rgb(91_69_240/0.7)] md:-my-3 md:py-10' : 'card')}>
                  {pop && <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 rounded-full bg-[#ffb84d] px-4 py-1 text-xs font-extrabold uppercase tracking-wider text-[#3a2600]">Most popular</span>}
                  <h3 className={clsx('font-display text-xl font-extrabold', !pop && 'text-ink')}>{p.name}</h3>
                  <p className={clsx('mt-1 text-sm', pop ? 'text-white/75' : 'text-muted')}>{p.tagline}</p>
                  <p className="mt-6 flex items-baseline gap-1.5">
                    <span className={clsx('font-display text-5xl font-extrabold tracking-tight', !pop && 'text-ink')}>{p.price === 0 ? '₹0' : `₹${p.price}`}</span>
                    <span className={clsx('text-sm font-semibold', pop ? 'text-white/70' : 'text-muted')}>{p.price === 0 ? 'forever' : '/ month'}</span>
                  </p>
                  <ul className="mt-7 flex-1 space-y-3.5 text-sm">
                    {bullets(p).map((b) => (
                      <li key={b} className="flex items-start gap-3 font-medium"><span className={clsx('mt-0.5 grid size-5 shrink-0 place-items-center rounded-full', pop ? 'bg-white/20' : 'bg-good-soft text-good-ink')}><Check className="size-3" strokeWidth={3.5} /></span><span className={pop ? 'text-white' : 'text-ink-2'}>{b}</span></li>
                    ))}
                  </ul>
                  <LinkButton to="/register" variant={pop ? 'white' : 'primary'} className="mt-8 w-full">{p.price === 0 ? 'Start for free' : `Choose ${p.name}`}</LinkButton>
                </div>
              </Reveal>
            )
          })}
        </div>
        <div className="mt-10 text-center">
          <button onClick={() => setShowAll((s) => !s)} className="inline-flex items-center gap-2 text-sm font-bold text-brand-ink hover:underline">
            {showAll ? 'Hide' : 'Compare'} all plan features <ChevronDown className={clsx('size-4 transition-transform', showAll && 'rotate-180')} />
          </button>
        </div>
        <AnimatePresence>
          {showAll && data && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="mx-auto mt-6 max-w-4xl overflow-hidden">
              <div className="card overflow-x-auto scroll-thin">
                <table className="w-full min-w-[560px] text-left text-sm">
                  <thead><tr className="border-b border-line bg-surface-2 text-[12px] font-bold uppercase tracking-wider text-muted"><th className="px-5 py-3.5">Feature</th><th className="px-3 text-center">Free</th><th className="px-3 text-center">Starter</th><th className="px-3 text-center">Pro</th></tr></thead>
                  <tbody>
                    {data.comparison.map((row) => (
                      <tr key={row.feature} className="border-b border-line last:border-0">
                        <td className="px-5 py-3.5 font-semibold text-ink-2">{row.feature}{row.soon && <span className="ml-2 rounded-full bg-warn-soft px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide text-warn-ink">Coming soon</span>}</td>
                        <td className="px-3 text-center"><Cell v={row.free} /></td><td className="px-3 text-center"><Cell v={row.starter} /></td><td className="px-3 text-center"><Cell v={row.pro} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  )
}

/* ---------------------------------------------------------------- FAQ */
const FAQS = [
  ['Is it really free?', 'Yes. The Free plan gives you 10 invoices a month, 10 customers and 20 products — forever. Upgrade to Starter (₹199/mo) or Pro (₹499/mo) only when you need more.'],
  ['Do I need accounting knowledge?', 'No. You enter what you sold and to whom. We work out CGST, SGST or IGST, the round-off and the amount in words. Just double-check your GSTIN and HSN codes.'],
  ['How is my data kept private?', 'Every business gets its own isolated PostgreSQL schema and its own subdomain (yourname.app…). Your invoices are never stored alongside anyone else\'s.'],
  ['Can I edit an invoice after finalizing?', 'Finalized invoices are locked so they always match what your customer received. You can cancel one and issue a corrected invoice. Drafts are fully editable.'],
  ['Which GST rates are supported?', 'The slabs 0%, 5%, 12%, 18% and 28% — with intra-state (CGST + SGST), inter-state (IGST), exempt and export / SEZ zero-rated supplies.'],
  ['Are WhatsApp sharing and GSTR-1 export available?', 'They are planned for the next release (Phase 2) — sharing, automated reminders, expense tracking and GSTR-1 export. Today you get invoicing, PDFs, payments and the dashboard.'],
]
function Faq() {
  const [open, setOpen] = useState<number | null>(0)
  return (
    <section id="faq" className="mx-auto max-w-3xl scroll-mt-20 px-5 py-24 sm:px-8">
      <SectionHead eyebrow="FAQ" title="Questions, answered" />
      <div className="mt-12 space-y-3">
        {FAQS.map(([q, a], i) => (
          <Reveal key={q} delay={i * 0.04}>
            <div className={clsx('card overflow-hidden transition-colors', open === i && 'border-brand/40')}>
              <button onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i} className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left">
                <span className="font-display text-[16px] font-bold text-ink">{q}</span>
                <ChevronDown className={clsx('size-5 shrink-0 text-brand transition-transform duration-300', open === i && 'rotate-180')} />
              </button>
              <AnimatePresence initial={false}>
                {open === i && (
                  <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} transition={{ duration: 0.25 }} className="overflow-hidden">
                    <p className="px-6 pb-5 text-[15px] leading-relaxed text-muted">{a}</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  )
}

/* ---------------------------------------------------------------- CTA */
function FinalCta() {
  return (
    <section className="mx-auto max-w-7xl px-5 sm:px-8">
      <Reveal>
        <div className="relative overflow-hidden rounded-[2rem] bg-[linear-gradient(135deg,#3c27a8_0%,#5b45f0_50%,#a24df0_100%)] px-8 py-16 text-center text-white sm:px-16">
          <div className="animate-blob absolute -left-20 -top-20 size-72 rounded-full bg-[#ff8a5c]/40 blur-3xl" />
          <div className="animate-blob absolute -bottom-24 -right-16 size-80 rounded-full bg-[#22c98a]/25 blur-3xl [animation-delay:-5s]" />
          <div className="relative">
            <Gauge className="mx-auto size-10 text-[#ffd58a]" />
            <h2 className="mx-auto mt-5 max-w-2xl font-display text-3xl font-extrabold leading-tight sm:text-5xl">Your first GST invoice is two minutes away.</h2>
            <p className="mx-auto mt-4 max-w-lg text-lg text-white/80">Join small businesses across India who have stopped fighting with Excel.</p>
            <LinkButton to="/register" variant="white" size="lg" className="mt-9" icon={<ShieldCheck className="size-5" />}>Create your free account</LinkButton>
          </div>
        </div>
      </Reveal>
    </section>
  )
}

export default function Landing() {
  return (
    <>
      <Hero />
      <Audience />
      <Problem />
      <Features />
      <GstCalculator />
      <HowItWorks />
      <Personas />
      <Pricing />
      <Faq />
      <FinalCta />
    </>
  )
}
