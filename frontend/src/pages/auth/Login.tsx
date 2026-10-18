import { useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { Eye, EyeOff, Lock, Mail } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Field, TextInput } from '@/components/ui/Form'
import { ApiError, post } from '@/lib/api'
import { isStandalone } from '@/lib/pwa'
import type { Me } from '@/lib/types'
import AuthLayout from './AuthLayout'

const KEEP_KEY = 'gst-keep-signed-in'
/** Remembers the last choice; first time, it's pre-ticked only inside the installed app (a personal device). */
function initialKeep(): boolean {
  try { const v = localStorage.getItem(KEEP_KEY); if (v !== null) return v === '1' } catch { /* private mode */ }
  return isStandalone()
}

export default function Login() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [keep, setKeep] = useState(initialKeep)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!email || !password) return setError('Enter your email and password.')
    setBusy(true); setError('')
    try {
      const me = await post<Me>('/api/auth/login/', { email, password, remember: keep })
      try { localStorage.setItem(KEEP_KEY, keep ? '1' : '0') } catch { /* ignore */ }
      qc.setQueryData(['me'], me)
      navigate((location.state as { from?: string } | null)?.from || '/', { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not log in. Please try again.')
    } finally { setBusy(false) }
  }

  return (
    <AuthLayout>
      <motion.form onSubmit={submit} noValidate initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="font-display text-3xl font-extrabold tracking-tight text-ink">Log in</h1>
        <p className="mt-2 text-muted">Welcome back — let's get you billing.</p>
        <div className="mt-8 space-y-5">
          <Field label="Email" htmlFor="email">
            <TextInput id="email" type="email" autoFocus autoComplete="username" value={email} onChange={(e) => { setEmail(e.target.value); setError('') }} placeholder="you@business.com" left={<Mail className="size-4" />} className="!pl-10" invalid={!!error} />
          </Field>
          <Field label="Password" htmlFor="pw" error={error}>
            <div className="relative">
              <TextInput id="pw" type={show ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => { setPassword(e.target.value); setError('') }} placeholder="Your password" left={<Lock className="size-4" />} className="!pl-10 !pr-11" invalid={!!error} />
              <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'} className="absolute right-1 top-1/2 -translate-y-1/2 rounded-md p-2.5 text-muted hover:text-brand-ink">{show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button>
            </div>
          </Field>
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <label className="-my-1 flex min-h-11 cursor-pointer select-none items-center gap-2.5 text-sm font-semibold text-ink-2">
              <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} className="size-[18px] shrink-0 cursor-pointer rounded accent-[var(--brand)]" />
              <span>Keep me signed in<span className="block text-xs font-normal text-muted">30 days · not on a shared device</span></span>
            </label>
            <Link to="/forgot-password" className="-my-2 py-2 text-sm font-semibold text-brand-ink hover:underline">Forgot password?</Link>
          </div>
        </div>
        <Button type="submit" size="lg" className="mt-7 w-full" loading={busy}>Log in</Button>
        <p className="mt-6 text-center text-sm text-muted">Wrong business? <a href={`${window.location.protocol}//${window.location.host.split('.').slice(1).join('.')}/login`} className="font-bold text-brand-ink hover:underline">Find your workspace</a></p>
      </motion.form>
    </AuthLayout>
  )
}
