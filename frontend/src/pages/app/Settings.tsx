import { useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { motion } from 'framer-motion'
import { Building2, CheckCircle2, ImagePlus, Landmark, ReceiptText, Save, Trash2, Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { PageHeader, PageLoader } from '@/components/ui/Bits'
import { Button } from '@/components/ui/Button'
import { Field, Select, Textarea, TextInput } from '@/components/ui/Form'
import { ApiError, api, del, patch } from '@/lib/api'
import { financialYear, todayISO } from '@/lib/format'
import { useMeta, useProfile } from '@/lib/hooks'
import type { Profile } from '@/lib/types'

const TABS = [
  { key: 'business', label: 'Business', icon: Building2, hint: 'Identity & address' },
  { key: 'logo', label: 'Logo', icon: ImagePlus, hint: 'Shown on invoices' },
  { key: 'bank', label: 'Bank details', icon: Landmark, hint: 'For payment instructions' },
  { key: 'invoice', label: 'Invoice settings', icon: ReceiptText, hint: 'Numbering & defaults' },
] as const
type Tab = (typeof TABS)[number]['key']

const LABELS: Record<string, string> = { business_name: 'Business name', state: 'State', address_line1: 'Address', city: 'City', pincode: 'Pincode', phone: 'Phone' }
const FIELD_TAB: Record<string, Tab> = { business_name: 'business', state: 'business', address_line1: 'business', city: 'business', pincode: 'business', phone: 'business' }

type Form = Omit<Profile, 'is_complete' | 'missing_fields' | 'logo_url'>

export default function Settings() {
  const qc = useQueryClient()
  const meta = useMeta().data
  const { data: profile, isLoading } = useProfile()
  const [tab, setTab] = useState<Tab>('business')
  const [f, setF] = useState<Form | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [logo, setLogo] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const [drag, setDrag] = useState(false)

  useEffect(() => {
    if (!profile) return
    const { is_complete, missing_fields, logo_url, ...rest } = profile
    setF(rest); setLogo(logo_url)
  }, [profile])

  if (isLoading || !f || !profile) return <PageLoader />
  const set = (k: keyof Form, v: string | number) => { setF((p) => (p ? { ...p, [k]: v } : p)); setErrors((e) => ({ ...e, [k]: '' })) }
  const missing = profile.missing_fields
  const total = 6
  const doneCount = total - missing.length

  const refreshMe = () => { qc.invalidateQueries({ queryKey: ['profile'] }); qc.invalidateQueries({ queryKey: ['me'] }) }

  const save = async () => {
    const errs: Record<string, string> = {}
    for (const k of Object.keys(LABELS)) if (!String((f as any)[k] ?? '').trim()) errs[k] = `${LABELS[k]} is required to generate invoices.`
    setBusy(true)
    try {
      await patch('/api/profile/', f)
      refreshMe()
      setErrors(errs)
      if (Object.keys(errs).length) { toast.warning('Saved — but some required details are still missing.'); setTab(FIELD_TAB[Object.keys(errs)[0]] ?? 'business') }
      else toast.success('Profile saved ✓')
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors({ ...errs, ...err.fieldErrors })
        const first = Object.keys(err.fieldErrors)[0]
        if (first) setTab(['bank_name', 'account_holder_name', 'account_number', 'ifsc_code'].includes(first) ? 'bank' : ['invoice_prefix', 'default_payment_terms', 'default_notes', 'default_terms'].includes(first) ? 'invoice' : 'business')
        toast.error(first ? 'Please fix the highlighted fields.' : err.message)
      }
    } finally { setBusy(false) }
  }

  const upload = async (file?: File) => {
    if (!file) return
    if (!['image/png', 'image/jpeg'].includes(file.type)) return toast.error('Only PNG and JPG logos are allowed.')
    if (file.size > 2 * 1024 * 1024) return toast.error('Logo must be 2 MB or smaller.')
    setUploading(true)
    try {
      const form = new FormData(); form.append('logo', file)
      const p = await api<Profile>('/api/profile/logo/', { form })
      setLogo(p.logo_url ? `${p.logo_url}?v=${Date.now()}` : null); refreshMe(); toast.success('Logo updated')
    } catch (err) { toast.error(err instanceof ApiError ? (err.fieldErrors.logo ?? err.message) : 'Upload failed') }
    finally { setUploading(false) }
  }
  const removeLogo = async () => { await del('/api/profile/logo/'); setLogo(null); refreshMe(); toast.success('Logo removed') }

  const nextNumber = `${f.invoice_prefix || 'INV'}/${financialYear(todayISO())}/001`

  return (
    <>
      <PageHeader title="Business profile" subtitle="This information appears on every invoice you create." />
      <div className="grid items-start gap-6 lg:grid-cols-[280px_1fr]">
        <aside className="space-y-4 lg:sticky lg:top-24">
          <div className="card p-5">
            <div className="flex items-center gap-4">
              <div className="relative size-16">
                <svg viewBox="0 0 36 36" className="size-16 -rotate-90"><circle cx="18" cy="18" r="15.5" fill="none" stroke="var(--line)" strokeWidth="3.5" /><motion.circle cx="18" cy="18" r="15.5" fill="none" stroke={missing.length ? 'var(--brand)' : 'var(--good)'} strokeWidth="3.5" strokeLinecap="round" strokeDasharray="97.4" initial={{ strokeDashoffset: 97.4 }} animate={{ strokeDashoffset: 97.4 * (1 - doneCount / total) }} transition={{ duration: 0.8 }} /></svg>
                <span className="absolute inset-0 grid place-items-center font-display text-sm font-extrabold text-ink">{doneCount}/{total}</span>
              </div>
              <div><p className="font-display text-[15px] font-bold text-ink">{missing.length ? 'Almost there' : 'Profile complete'}</p><p className="text-xs text-muted">{missing.length ? `${missing.length} required detail${missing.length > 1 ? 's' : ''} missing` : 'You can generate invoices'}</p></div>
            </div>
            {missing.length > 0 && <ul className="mt-4 space-y-1.5">{missing.map((m) => <li key={m}><button onClick={() => setTab(FIELD_TAB[m] ?? 'business')} className="text-left text-[13px] font-semibold text-warn-ink hover:underline">• {LABELS[m] ?? m}</button></li>)}</ul>}
          </div>
          <nav className="card p-2" aria-label="Settings sections">
            {TABS.map((t) => (
              <button key={t.key} onClick={() => setTab(t.key)} aria-current={tab === t.key} className={clsx('relative flex w-full items-center gap-3 rounded-xl px-3.5 py-3 text-left transition-colors', tab === t.key ? 'text-brand-ink' : 'text-ink-2 hover:bg-surface-2')}>
                {tab === t.key && <motion.span layoutId="settings-tab" className="absolute inset-0 rounded-xl bg-brand-soft" />}
                <t.icon className="relative size-[18px]" /><span className="relative"><span className="block text-sm font-bold">{t.label}</span><span className="block text-xs font-normal text-muted">{t.hint}</span></span>
              </button>
            ))}
          </nav>
        </aside>

        <motion.section key={tab} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} className="card p-6 sm:p-8">
          {tab === 'business' && (
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Business name" required error={errors.business_name} className="sm:col-span-2"><TextInput value={f.business_name} onChange={(e) => set('business_name', e.target.value)} invalid={!!errors.business_name} /></Field>
              <Field label="GSTIN" error={errors.gstin} hint="15 characters. Leave empty if unregistered."><TextInput value={f.gstin} onChange={(e) => set('gstin', e.target.value.toUpperCase())} maxLength={15} className="num uppercase" invalid={!!errors.gstin} placeholder="07AABCS1234F1Z5" /></Field>
              <Field label="PAN" error={errors.pan} hint="10 characters"><TextInput value={f.pan} onChange={(e) => set('pan', e.target.value.toUpperCase())} maxLength={10} className="num uppercase" invalid={!!errors.pan} placeholder="AABCS1234F" /></Field>
              <Field label="State" required error={errors.state} hint="Drives CGST + SGST vs IGST on every invoice" className="sm:col-span-2"><Select value={f.state} onChange={(e) => set('state', e.target.value)} invalid={!!errors.state}><option value="">Select your state…</option>{meta?.states.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}</Select></Field>
              <Field label="Address line 1" required error={errors.address_line1} className="sm:col-span-2"><TextInput value={f.address_line1} onChange={(e) => set('address_line1', e.target.value)} invalid={!!errors.address_line1} placeholder="Shop / building, street" /></Field>
              <Field label="Address line 2" error={errors.address_line2} className="sm:col-span-2"><TextInput value={f.address_line2} onChange={(e) => set('address_line2', e.target.value)} placeholder="Area, landmark (optional)" /></Field>
              <Field label="City" required error={errors.city}><TextInput value={f.city} onChange={(e) => set('city', e.target.value)} invalid={!!errors.city} /></Field>
              <Field label="Pincode" required error={errors.pincode}><TextInput value={f.pincode} onChange={(e) => set('pincode', e.target.value)} inputMode="numeric" maxLength={6} className="num" invalid={!!errors.pincode} /></Field>
              <Field label="Phone" required error={errors.phone}><TextInput value={f.phone} onChange={(e) => set('phone', e.target.value)} inputMode="tel" invalid={!!errors.phone} placeholder="98765 43210" /></Field>
              <Field label="Business email" error={errors.email}><TextInput type="email" value={f.email} onChange={(e) => set('email', e.target.value)} invalid={!!errors.email} /></Field>
            </div>
          )}

          {tab === 'logo' && (
            <div>
              <h2 className="font-display text-lg font-bold text-ink">Your logo</h2>
              <p className="mt-1 text-sm text-muted">PNG or JPG, up to 2 MB. It appears at the top of your invoices and PDFs.</p>
              <div onDragOver={(e) => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files[0]) }}
                className={clsx('mt-6 grid place-items-center rounded-2xl border-2 border-dashed p-10 text-center transition-colors', drag ? 'border-brand bg-brand-soft' : 'border-line-strong bg-surface-2')}>
                {logo ? <img src={logo} alt="Business logo" className="max-h-28 max-w-56 rounded-lg object-contain" /> : <span className="grid size-20 place-items-center rounded-2xl bg-brand-soft text-brand"><ImagePlus className="size-9" /></span>}
                <p className="mt-4 text-sm font-semibold text-ink-2">{logo ? 'Looking good!' : 'Drag & drop your logo here'}</p>
                <div className="mt-4 flex flex-wrap justify-center gap-3">
                  <Button variant="secondary" loading={uploading} onClick={() => fileRef.current?.click()} icon={<Upload className="size-4" />}>{logo ? 'Replace logo' : 'Choose file'}</Button>
                  {logo && <Button variant="ghost" onClick={removeLogo} icon={<Trash2 className="size-4" />}>Remove</Button>}
                </div>
                <input ref={fileRef} type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => { upload(e.target.files?.[0]); e.target.value = '' }} />
              </div>
              <p className="mt-4 text-xs text-muted">Logos are saved immediately. Invoices you have already finalized keep the logo they were issued with.</p>
            </div>
          )}

          {tab === 'bank' && (
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="sm:col-span-2"><h2 className="font-display text-lg font-bold text-ink">Bank details</h2><p className="mt-1 text-sm text-muted">Printed on invoices so customers know where to pay.</p></div>
              <Field label="Account holder name" error={errors.account_holder_name} className="sm:col-span-2"><TextInput value={f.account_holder_name} onChange={(e) => set('account_holder_name', e.target.value)} /></Field>
              <Field label="Bank name" error={errors.bank_name}><TextInput value={f.bank_name} onChange={(e) => set('bank_name', e.target.value)} placeholder="e.g. HDFC Bank" /></Field>
              <Field label="IFSC" error={errors.ifsc_code} hint="11 characters"><TextInput value={f.ifsc_code} onChange={(e) => set('ifsc_code', e.target.value.toUpperCase())} maxLength={11} className="num uppercase" invalid={!!errors.ifsc_code} placeholder="HDFC0001234" /></Field>
              <Field label="Account number" error={errors.account_number} className="sm:col-span-2"><TextInput value={f.account_number} onChange={(e) => set('account_number', e.target.value.replace(/\D/g, ''))} inputMode="numeric" className="num" invalid={!!errors.account_number} /></Field>
            </div>
          )}

          {tab === 'invoice' && (
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="sm:col-span-2"><h2 className="font-display text-lg font-bold text-ink">Invoice settings</h2><p className="mt-1 text-sm text-muted">Defaults applied to every new invoice.</p></div>
              <Field label="Invoice prefix" error={errors.invoice_prefix} hint="1–4 letters or digits. GST allows at most 16 characters in an invoice number.">
                <TextInput value={f.invoice_prefix} onChange={(e) => set('invoice_prefix', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} maxLength={4} className="num uppercase" invalid={!!errors.invoice_prefix} />
              </Field>
              <Field label="Default payment terms" error={errors.default_payment_terms} hint="Days until an invoice is due">
                <TextInput value={f.default_payment_terms} onChange={(e) => set('default_payment_terms', Number(e.target.value.replace(/\D/g, '')) || 0)} inputMode="numeric" className="num" invalid={!!errors.default_payment_terms} />
              </Field>
              <div className="rounded-2xl border border-brand/25 bg-brand-soft p-5 sm:col-span-2">
                <p className="text-xs font-bold uppercase tracking-widest text-brand-ink">Your next invoice number</p>
                <p className="num mt-1 font-display text-2xl font-extrabold text-brand-ink">{nextNumber}</p>
                <p className="mt-1 text-xs text-ink-2">Format: PREFIX / financial year (April–March) / running number. Numbers are assigned in order when you finalize.</p>
              </div>
              <Field label="Default notes" className="sm:col-span-2" error={errors.default_notes}><Textarea value={f.default_notes} onChange={(e) => set('default_notes', e.target.value)} placeholder="Thank you for your business!" /></Field>
              <Field label="Default terms & conditions" className="sm:col-span-2" error={errors.default_terms}><Textarea rows={4} value={f.default_terms} onChange={(e) => set('default_terms', e.target.value)} placeholder="Payment due within 30 days. Goods once sold will not be taken back." /></Field>
            </div>
          )}

          {tab !== 'logo' && (
            <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-6">
              <p className="flex items-center gap-2 text-sm text-muted">{profile.is_complete ? <><CheckCircle2 className="size-4 text-good-ink" />All required details are filled in.</> : 'Fields marked * are needed before you can create invoices.'}</p>
              <Button onClick={save} loading={busy} icon={<Save className="size-4" />}>Save changes</Button>
            </div>
          )}
        </motion.section>
      </div>
    </>
  )
}
