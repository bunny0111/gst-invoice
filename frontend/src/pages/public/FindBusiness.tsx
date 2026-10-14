import { motion } from 'framer-motion'
import { ArrowRight, Compass, Store } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Field, TextInput } from '@/components/ui/Form'
import { ApiError, get } from '@/lib/api'
import { useSEO } from '@/lib/seo'

/** Each business lives on its own subdomain, so "Log in" on the main site asks WHICH business first. */
export default function FindBusiness() {
  useSEO({
    title: 'Log in',
    description: 'Find your GST Billing workspace and log in to your business account.',
    path: '/login',
  })
  const [q, setQ] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!q.trim()) return setError('Enter your business name or workspace address.')
    setBusy(true); setError('')
    try {
      const r = await get<{ found: boolean; login_url?: string }>(`/api/public/find-business/?q=${encodeURIComponent(q.trim())}`)
      if (r.found && r.login_url) window.location.href = r.login_url
      else setError("We couldn't find a business with that name. Check the spelling or create a new account.")
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')
    } finally { setBusy(false) }
  }

  return (
    <div className="relative grid min-h-[calc(100vh-72px)] place-items-center overflow-hidden px-5 py-14">
      <div className="bg-grid-pattern absolute inset-0 -z-10" />
      <div className="animate-blob absolute left-1/4 top-10 -z-10 size-96 rounded-full bg-[#7a68ff]/20 blur-3xl" />
      <motion.form onSubmit={submit} noValidate initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="card w-full max-w-md p-8 sm:p-10">
        <span className="gradient-brand grid size-14 place-items-center rounded-2xl text-white shadow-lg"><Compass className="size-7" /></span>
        <h1 className="mt-6 font-display text-3xl font-extrabold tracking-tight text-ink">Welcome back</h1>
        <p className="mt-2 text-muted">Which business would you like to log in to?</p>
        <div className="mt-8">
          <Field label="Business name or workspace address" htmlFor="q" error={error} hint="e.g. Sharma Electronics or sharma-electronics.app.techcognixium.com">
            <TextInput id="q" autoFocus value={q} onChange={(e) => { setQ(e.target.value); setError('') }} placeholder="Your business name" invalid={!!error} left={<Store className="size-4" />} className="!pl-10" />
          </Field>
        </div>
        <Button type="submit" size="lg" className="mt-7 w-full" loading={busy} icon={!busy && <ArrowRight className="size-5" />}>Continue to login</Button>
        <p className="mt-6 text-center text-sm text-muted">New here? <Link to="/register" className="font-bold text-brand-ink hover:underline">Create a free account</Link></p>
      </motion.form>
    </div>
  )
}
