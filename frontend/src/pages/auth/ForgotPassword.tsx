import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, CheckCircle2, KeyRound, Lock, Mail } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Field, TextInput } from '@/components/ui/Form'
import { ApiError, post } from '@/lib/api'
import AuthLayout from './AuthLayout'

/** Password reset by email OTP: 1) ask for email  2) enter 6-digit code + new password  3) done. */
export default function ForgotPassword() {
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [email, setEmail] = useState('')
  const [otp, setOtp] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  const sendCode = async (e?: FormEvent) => {
    e?.preventDefault()
    if (!/^\S+@\S+\.\S+$/.test(email)) return setErrors({ email: 'Enter a valid email address.' })
    setBusy(true); setErrors({})
    try {
      await post('/api/auth/forgot-password/', { email })
      setStep(2)
      toast.success('If that email is registered, a 6-digit code is on its way.')
    } catch (err) { setErrors({ email: err instanceof ApiError ? err.message : 'Could not send the code.' }) }
    finally { setBusy(false) }
  }

  const reset = async (e: FormEvent) => {
    e.preventDefault()
    const errs: Record<string, string> = {}
    if (!/^\d{6}$/.test(otp)) errs.otp = 'Enter the 6-digit code from your email.'
    if (password.length < 8) errs.new_password = 'Password must be at least 8 characters.'
    setErrors(errs)
    if (Object.keys(errs).length) return
    setBusy(true)
    try {
      await post('/api/auth/reset-password/', { email, otp, new_password: password })
      setStep(3)
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fieldErrors.new_password ? { new_password: err.fieldErrors.new_password } : { otp: err.message })
    } finally { setBusy(false) }
  }

  return (
    <AuthLayout>
      <AnimatePresence mode="wait">
        {step === 1 && (
          <motion.form key="1" onSubmit={sendCode} noValidate initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }}>
            <span className="gradient-brand grid size-14 place-items-center rounded-2xl text-white shadow-lg"><KeyRound className="size-7" /></span>
            <h1 className="mt-6 font-display text-3xl font-extrabold tracking-tight text-ink">Reset your password</h1>
            <p className="mt-2 text-muted">We'll email you a 6-digit code.</p>
            <div className="mt-8"><Field label="Email" htmlFor="email" error={errors.email}>
              <TextInput id="email" type="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@business.com" left={<Mail className="size-4" />} className="!pl-10" invalid={!!errors.email} />
            </Field></div>
            <Button type="submit" size="lg" className="mt-7 w-full" loading={busy}>Send code</Button>
            <Link to="/login" className="mt-6 flex items-center justify-center gap-2 text-sm font-semibold text-muted hover:text-brand-ink"><ArrowLeft className="size-4" />Back to login</Link>
          </motion.form>
        )}
        {step === 2 && (
          <motion.form key="2" onSubmit={reset} noValidate initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }}>
            <span className="gradient-brand grid size-14 place-items-center rounded-2xl text-white shadow-lg"><Mail className="size-7" /></span>
            <h1 className="mt-6 font-display text-3xl font-extrabold tracking-tight text-ink">Check your email</h1>
            <p className="mt-2 text-muted">Enter the code we sent to <b className="text-ink">{email}</b> and choose a new password.</p>
            <div className="mt-8 space-y-5">
              <Field label="6-digit code" htmlFor="otp" error={errors.otp}>
                <TextInput id="otp" inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} placeholder="123456" className="num !text-center !font-display !text-2xl !font-bold !tracking-[0.5em]" invalid={!!errors.otp} />
              </Field>
              <Field label="New password" htmlFor="npw" error={errors.new_password}>
                <TextInput id="npw" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" left={<Lock className="size-4" />} className="!pl-10" invalid={!!errors.new_password} />
              </Field>
            </div>
            <Button type="submit" size="lg" className="mt-7 w-full" loading={busy}>Update password</Button>
            <button type="button" onClick={() => sendCode()} disabled={busy} className="mt-5 w-full text-center text-sm font-semibold text-brand-ink hover:underline">Didn't get it? Send a new code</button>
          </motion.form>
        )}
        {step === 3 && (
          <motion.div key="3" initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} className="text-center">
            <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', damping: 10 }} className="mx-auto grid size-20 place-items-center rounded-full bg-good-soft text-good-ink"><CheckCircle2 className="size-10" /></motion.span>
            <h1 className="mt-6 font-display text-3xl font-extrabold text-ink">Password updated</h1>
            <p className="mt-2 text-muted">You can now log in with your new password.</p>
            <Link to="/login"><Button size="lg" className="mt-8 w-full">Back to login</Button></Link>
          </motion.div>
        )}
      </AnimatePresence>
    </AuthLayout>
  )
}
