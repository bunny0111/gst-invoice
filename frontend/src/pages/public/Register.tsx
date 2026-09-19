import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowRight, Check, Copy, Eye, EyeOff, Globe, Loader2, Lock, Mail, PartyPopper, ShieldCheck, Store, XCircle } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { Logo } from '@/components/ui/Bits'
import { Button } from '@/components/ui/Button'
import { Field, TextInput } from '@/components/ui/Form'
import { ApiError, get, post } from '@/lib/api'
import { useDebounce, useTenantInfo } from '@/lib/hooks'

interface Registered { business: { name: string; slug: string }; subdomain_url: string; login_url: string; email: string }
const STEPS = ['Reserving your workspace address', 'Creating your private database', 'Setting up your account']

function strength(pw: string) {
  let s = 0
  if (pw.length >= 8) s++
  if (pw.length >= 12) s++
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) s++
  return Math.min(s, 4)
}

export default function Register() {
  const tenant = useTenantInfo().data
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [step, setStep] = useState(0)
  const [done, setDone] = useState<Registered | null>(null)
  const dName = useDebounce(name.trim(), 350)

  const check = useQuery({
    queryKey: ['check-name', dName],
    enabled: dName.length > 1,
    queryFn: () => get<{ slug: string; available: boolean; reason: string | null }>(`/api/public/check-name/?name=${encodeURIComponent(dName)}`),
    staleTime: 10_000,
  })

  useEffect(() => {
    if (!busy) return
    const t = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 700)
    return () => clearInterval(t)
  }, [busy])

  const port = window.location.port ? `:${window.location.port}` : ''
  const host = `${check.data?.slug || 'your-business'}.${tenant?.base_domain ?? 'localhost'}${port}`
  const pwScore = strength(password)
  const checking = dName.length > 1 && (check.isFetching || dName !== name.trim())

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const errs: Record<string, string> = {}
    if (!name.trim()) errs.business_name = 'Enter your business name.'
    if (!/^\S+@\S+\.\S+$/.test(email)) errs.email = 'Enter a valid email address.'
    if (password.length < 8) errs.password = 'Password must be at least 8 characters.'
    setErrors(errs)
    if (Object.keys(errs).length) return
    setBusy(true); setStep(0)
    try {
      const [res] = await Promise.all([
        post<Registered>('/api/public/register/', { business_name: name.trim(), email: email.trim(), password }),
        new Promise((r) => setTimeout(r, 2100)), // let the setup animation breathe
      ])
      setDone(res)
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fieldErrors)
        if (!Object.keys(err.fieldErrors).length) toast.error(err.message)
      } else toast.error('Could not create the account. Please try again.')
    } finally { setBusy(false) }
  }

  const copy = async (text: string) => { await navigator.clipboard?.writeText(text).catch(() => {}); toast.success('Copied to clipboard') }

  return (
    <div className="grid min-h-[calc(100vh-72px)] lg:grid-cols-[0.9fr_1.1fr]">
      <aside className="relative hidden overflow-hidden bg-[linear-gradient(160deg,#2a1d78_0%,#4230c9_55%,#7a3fe0_100%)] p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="animate-blob absolute -right-24 top-1/4 size-80 rounded-full bg-[#ff8a5c]/30 blur-3xl" />
        <div className="animate-blob absolute -left-20 bottom-10 size-72 rounded-full bg-[#22c98a]/25 blur-3xl [animation-delay:-6s]" />
        <div className="relative" />
        <div className="relative">
          <h2 className="font-display text-4xl font-extrabold leading-tight">Get your own private billing workspace in seconds.</h2>
          <ul className="mt-9 space-y-5">
            {[
              [Globe, 'Your own address', 'yourname.app.techcognixium.com — just for your business.'],
              [Lock, 'Completely isolated data', 'A dedicated database schema. Nobody else can ever see your invoices.'],
              [ShieldCheck, 'Free plan, forever', '10 invoices a month, no credit card required.'],
            ].map(([Icon, t, d]: any) => (
              <li key={t} className="flex gap-4"><span className="grid size-11 shrink-0 place-items-center rounded-xl bg-white/15 ring-1 ring-white/20"><Icon className="size-5" /></span><div><p className="font-bold">{t}</p><p className="mt-0.5 text-sm text-white/70">{d}</p></div></li>
            ))}
          </ul>
        </div>
        <p className="relative text-sm text-white/60">Tech Cognixium · New Delhi, India</p>
      </aside>

      <main className="relative grid place-items-center px-5 py-12 sm:px-10">
        <AnimatePresence mode="wait">
          {done ? (
            <motion.div key="done" initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} className="w-full max-w-lg text-center">
              <motion.div initial={{ scale: 0, rotate: -90 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', damping: 10, delay: 0.1 }} className="gradient-brand mx-auto grid size-20 place-items-center rounded-3xl text-white shadow-[0_20px_40px_-12px_rgb(91_69_240/0.8)]">
                <PartyPopper className="size-10" />
              </motion.div>
              <h1 className="mt-7 font-display text-3xl font-extrabold text-ink">Your workspace is ready!</h1>
              <p className="mt-2 text-muted"><span className="font-semibold text-ink">{done.business.name}</span> has its own private billing account.</p>
              <div className="card mt-8 p-6 text-left">
                <p className="text-xs font-bold uppercase tracking-widest text-muted">Your workspace address</p>
                <div className="mt-2.5 flex items-center gap-3 rounded-xl border border-brand/30 bg-brand-soft px-4 py-3.5">
                  <Globe className="size-5 shrink-0 text-brand" />
                  <span className="min-w-0 flex-1 truncate font-display text-[15px] font-bold text-brand-ink">{done.subdomain_url.replace(/^https?:\/\//, '')}</span>
                  <button onClick={() => copy(done.subdomain_url)} aria-label="Copy address" className="rounded-lg p-2 text-brand hover:bg-brand/10"><Copy className="size-4" /></button>
                </div>
                <ol className="mt-5 space-y-3 text-sm text-ink-2">
                  {[`Open your address above (bookmark it!).`, <>Log in with <b className="text-ink">{done.email}</b> and the password you just chose.</>, 'Complete your business profile, then create your first invoice.'].map((t, i) => (
                    <li key={i} className="flex gap-3"><span className="grid size-6 shrink-0 place-items-center rounded-full bg-brand text-xs font-bold text-white">{i + 1}</span><span className="pt-0.5">{t}</span></li>
                  ))}
                </ol>
              </div>
              <a href={done.login_url}><Button size="lg" className="mt-8 w-full" icon={<ArrowRight className="size-5" />}>Go to my workspace</Button></a>
            </motion.div>
          ) : (
            <motion.form key="form" onSubmit={submit} noValidate initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="w-full max-w-md">
              <h1 className="font-display text-3xl font-extrabold tracking-tight text-ink">Create your free account</h1>
              <p className="mt-2 text-muted">Three fields and you're in. No credit card.</p>

              <div className="mt-8 space-y-5">
                <Field label="Business name" required htmlFor="biz" error={errors.business_name}
                  hint={!errors.business_name && <span className="flex items-center gap-1.5">
                    {checking ? <Loader2 className="size-3.5 animate-spin" /> : check.data && dName.length > 1 ? (check.data.available ? <Check className="size-3.5 text-good-ink" strokeWidth={3} /> : <XCircle className="size-3.5 text-crit" />) : <Globe className="size-3.5" />}
                    <span className={clsx(check.data && !check.data.available && !checking && 'text-crit-ink')}>
                      {!checking && check.data && !check.data.available ? check.data.reason : <>Your address: <b className="text-ink-2">{host}</b></>}
                    </span></span>}>
                  <TextInput id="biz" autoFocus autoComplete="organization" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sharma Electronics" invalid={!!errors.business_name} left={<Store className="size-4" />} className="!pl-10" />
                </Field>
                <Field label="Email" required htmlFor="email" error={errors.email}>
                  <TextInput id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@business.com" invalid={!!errors.email} left={<Mail className="size-4" />} className="!pl-10" />
                </Field>
                <Field label="Password" required htmlFor="pw" error={errors.password}>
                  <div className="relative">
                    <TextInput id="pw" type={show ? 'text' : 'password'} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" invalid={!!errors.password} left={<Lock className="size-4" />} className="!pl-10 !pr-11" />
                    <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'} className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted hover:text-brand-ink">{show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button>
                  </div>
                  <div className="mt-2.5 flex items-center gap-1.5" aria-hidden>
                    {[0, 1, 2, 3].map((i) => <span key={i} className={clsx('h-1.5 flex-1 rounded-full transition-colors duration-300', i < pwScore ? ['bg-crit', 'bg-warn', 'bg-info', 'bg-good'][pwScore - 1] : 'bg-line')} />)}
                    <span className="w-16 text-right text-xs font-semibold text-muted">{password ? ['Weak', 'Fair', 'Good', 'Strong'][Math.max(pwScore - 1, 0)] : ''}</span>
                  </div>
                </Field>
              </div>

              <Button type="submit" size="lg" className="mt-8 w-full" loading={busy}>Create my workspace</Button>
              <p className="mt-5 text-center text-sm text-muted">Already registered? <Link to="/login" className="font-bold text-brand-ink hover:underline">Log in</Link></p>
              <p className="mt-6 text-center text-xs leading-relaxed text-muted">By creating an account you agree to keep your GSTIN and business details accurate.</p>
            </motion.form>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {busy && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 z-10 grid place-items-center bg-canvas/85 backdrop-blur-md">
              <div className="w-full max-w-sm px-6 text-center">
                <div className="gradient-brand mx-auto grid size-16 animate-pulse place-items-center rounded-2xl text-white shadow-2xl"><Loader2 className="size-8 animate-spin" /></div>
                <h2 className="mt-6 font-display text-xl font-extrabold text-ink">Setting up your workspace…</h2>
                <ul className="mt-6 space-y-3 text-left">
                  {STEPS.map((s, i) => (
                    <li key={s} className={clsx('flex items-center gap-3 text-sm font-semibold transition-opacity', i > step ? 'opacity-35' : 'opacity-100')}>
                      <span className={clsx('grid size-6 place-items-center rounded-full', i < step ? 'bg-good text-white' : i === step ? 'bg-brand text-white' : 'bg-line text-muted')}>
                        {i < step ? <Check className="size-3.5" strokeWidth={3.5} /> : i === step ? <Loader2 className="size-3.5 animate-spin" /> : i + 1}
                      </span>
                      <span className="text-ink-2">{s}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  )
}
