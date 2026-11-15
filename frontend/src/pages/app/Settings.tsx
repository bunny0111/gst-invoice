import { useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { motion } from 'framer-motion'
import { Building2, CheckCircle2, ImagePlus, Landmark, Mail, ReceiptText, Save, Send, Trash2, Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { PageHeader, PageLoader } from '@/components/ui/Bits'
import { Button } from '@/components/ui/Button'
import { Field, Select, Textarea, TextInput } from '@/components/ui/Form'
import { ApiError, api, del, patch, post } from '@/lib/api'
import { GSTIN_TYPO, gstinChecksumOk, gstinInput, panFromGstin, phoneInput, stateFromGstin } from '@/lib/gst'
import { useMeta, useProfile } from '@/lib/hooks'
import type { Profile } from '@/lib/types'

const TABS = [
  { key: 'business', label: 'Business', icon: Building2, hint: 'Identity & address' },
  { key: 'logo', label: 'Logo & signature', icon: ImagePlus, hint: 'Shown on invoices' },
  { key: 'bank', label: 'Bank & payments', icon: Landmark, hint: 'Bank, UPI & QR code' },
  { key: 'invoice', label: 'Invoice settings', icon: ReceiptText, hint: 'Numbering, GST & defaults' },
  { key: 'email', label: 'Email (SMTP)', icon: Mail, hint: 'Send from your own address' },
] as const
type Tab = (typeof TABS)[number]['key']

const LABELS: Record<string, string> = { business_name: 'Business name', state: 'State', address_line1: 'Address', city: 'City', pincode: 'Pincode', phone: 'Phone' }
const FIELD_TAB: Record<string, Tab> = { business_name: 'business', state: 'business', address_line1: 'business', city: 'business', pincode: 'business', phone: 'business' }

type Form = Omit<Profile, 'is_complete' | 'missing_fields' | 'logo_url' | 'signature_url' | 'payment_qr_url' | 'smtp_password_set' | 'next_invoice_preview'>

/** Which tab a server-side field error belongs to (so a failed save opens the right tab). */
const ERROR_TAB: Record<string, Tab> = {
  signatory_name: 'logo',
  bank_name: 'bank', bank_branch: 'bank', account_type: 'bank', account_holder_name: 'bank', account_number: 'bank', ifsc_code: 'bank', upi_id: 'bank', payment_instructions: 'bank',
  invoice_prefix: 'invoice', invoice_number_format: 'invoice', next_invoice_number: 'invoice', default_gst_rate: 'invoice', default_payment_terms: 'invoice', default_notes: 'invoice', default_terms: 'invoice',
  smtp_enabled: 'email', smtp_host: 'email', smtp_port: 'email', smtp_security: 'email', smtp_username: 'email', smtp_password: 'email', smtp_from_email: 'email', smtp_from_name: 'email',
}

const SMTP_PRESETS = [
  { name: 'Gmail', host: 'smtp.gmail.com', port: 587, security: 'starttls' as const },
  { name: 'Outlook / Microsoft 365', host: 'smtp.office365.com', port: 587, security: 'starttls' as const },
  { name: 'Zoho Mail', host: 'smtp.zoho.in', port: 465, security: 'ssl' as const },
]

/** One image uploader (logo, signature, payment QR): drag & drop or pick, saved straight away. */
function ImageDrop({ url, label, hint, endpoint, field, onChange }: {
  url: string | null; label: string; hint: string; endpoint: string; field: string; onChange: () => void
}) {
  const [drag, setDrag] = useState(false)
  const [busy, setBusy] = useState(false)
  const [shown, setShown] = useState(url)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => setShown(url), [url])
  const upload = async (file?: File) => {
    if (!file) return
    if (!['image/png', 'image/jpeg'].includes(file.type)) return toast.error('Only PNG and JPG images are allowed.')
    if (file.size > 2 * 1024 * 1024) return toast.error('The image must be 2 MB or smaller.')
    setBusy(true)
    try {
      const form = new FormData(); form.append(field, file)
      await api<Profile>(endpoint, { form })
      onChange(); toast.success(`${label} updated`)
    } catch (err) { toast.error(err instanceof ApiError ? (err.fieldErrors[field] ?? err.message) : 'Upload failed') }
    finally { setBusy(false) }
  }
  const remove = async () => { await del(endpoint); setShown(null); onChange(); toast.success(`${label} removed`) }
  return (
    <div onDragOver={(e) => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files[0]) }}
      className={clsx('relative grid place-items-center overflow-hidden rounded-2xl border-2 border-dashed p-6 text-center transition-all duration-200 sm:p-8', drag ? 'scale-[1.01] border-brand bg-brand-soft' : 'border-line-strong bg-surface-2')}>
      <div className="bg-grid-pattern pointer-events-none absolute inset-0 opacity-50" />
      {shown ? <img src={shown} alt={label} className="relative max-h-28 max-w-56 rounded-lg bg-white object-contain p-1 drop-shadow-md" /> : <span className="icon-badge relative grid size-16 place-items-center rounded-2xl text-white"><ImagePlus className="size-8" /></span>}
      <p className="relative mt-3 text-sm font-semibold text-ink-2">{shown ? label : `Drag & drop, or choose a file`}</p>
      <p className="relative mt-0.5 text-xs text-muted">{hint}</p>
      <div className="relative mt-4 flex flex-wrap justify-center gap-3">
        <Button variant="secondary" loading={busy} onClick={() => ref.current?.click()} icon={<Upload className="size-4" />}>{shown ? 'Replace' : 'Choose file'}</Button>
        {shown && <Button variant="ghost" onClick={remove} icon={<Trash2 className="size-4" />}>Remove</Button>}
      </div>
      <input ref={ref} type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => { upload(e.target.files?.[0]); e.target.value = '' }} />
    </div>
  )
}

export default function Settings() {
  const qc = useQueryClient()
  const meta = useMeta().data
  const { data: profile, isLoading } = useProfile()
  const [tab, setTab] = useState<Tab>('business')
  const [f, setF] = useState<Form | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [testing, setTesting] = useState(false)
  const sectionRef = useRef<HTMLElement>(null)
  // on phones the tab list sits above the form: bring the chosen section into view
  const openTab = (t: Tab) => {
    setTab(t)
    if (window.matchMedia('(max-width: 1023px)').matches) setTimeout(() => sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }

  useEffect(() => {
    if (!profile) return
    const { is_complete, missing_fields, logo_url, signature_url, payment_qr_url, smtp_password_set, next_invoice_preview, ...rest } = profile
    setF({ ...rest, smtp_password: '' })
  }, [profile])

  if (isLoading || !f || !profile) return <PageLoader />
  const set = (k: keyof Form, v: string | number | boolean) => { setF((p) => (p ? { ...p, [k]: v } : p)); setErrors((e) => ({ ...e, [k]: '' })) }
  /** Typing a GSTIN fills in the state and PAN it encodes (only where they are still empty / different). */
  const setGstin = (raw: string) => {
    const gstin = gstinInput(raw)
    setF((p) => {
      if (!p) return p
      const next = { ...p, gstin }
      const st = stateFromGstin(gstin, meta?.states)
      if (gstin.length >= 2 && st) next.state = st
      if (gstin.length === 15 && !p.pan) next.pan = panFromGstin(gstin)
      return next
    })
    setErrors((e) => ({ ...e, gstin: gstin.length === 15 && !gstinChecksumOk(gstin) ? GSTIN_TYPO : '', state: '' }))
  }
  const missing = profile.missing_fields
  const total = 6
  const doneCount = total - missing.length

  const refreshMe = () => { qc.invalidateQueries({ queryKey: ['profile'] }); qc.invalidateQueries({ queryKey: ['me'] }) }

  const save = async () => {
    const errs: Record<string, string> = {}
    for (const k of Object.keys(LABELS)) if (!String((f as any)[k] ?? '').trim()) errs[k] = `${LABELS[k]} is required to generate invoices.`
    setBusy(true)
    try {
      const payload: Partial<Form> = { ...f }
      if (f.next_invoice_number === profile.next_invoice_number) delete payload.next_invoice_number  // only send a real change
      if (!f.smtp_password) delete payload.smtp_password  // blank = keep the saved password
      await patch('/api/profile/', payload)
      setF((p) => (p ? { ...p, smtp_password: '' } : p))
      refreshMe()
      setErrors(errs)
      if (Object.keys(errs).length) { toast.warning('Saved — but some required details are still missing.'); setTab(FIELD_TAB[Object.keys(errs)[0]] ?? 'business') }
      else toast.success('Profile saved ✓')
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors({ ...errs, ...err.fieldErrors })
        const first = Object.keys(err.fieldErrors)[0]
        if (first) setTab(ERROR_TAB[first] ?? 'business')
        toast.error(first ? 'Please fix the highlighted fields.' : err.message)
      }
    } finally { setBusy(false) }
  }

  const testEmail = async () => {
    setTesting(true)
    try { toast.success((await post<{ detail: string }>('/api/profile/smtp-test/', f)).detail) }
    catch (err) { toast.error(err instanceof ApiError ? err.message : 'The test email failed.', { duration: 9000 }) }
    finally { setTesting(false) }
  }

  const prefixMax = f.invoice_number_format === 'running' ? 10 : 4
  const fy = profile.next_invoice_preview.split('/')[1]
  const nextNumber = f.invoice_number_format === 'running'
    ? `${f.invoice_prefix || 'INV'}-${String(f.next_invoice_number).padStart(4, '0')}`
    : `${f.invoice_prefix || 'INV'}/${fy ?? '2026-27'}/${String(f.next_invoice_number).padStart(3, '0')}`

  return (
    <>
      <PageHeader title="Business profile" subtitle="This information appears on every invoice you create." />
      <div className="grid items-start gap-6 lg:grid-cols-[280px_1fr]">
        <aside className="space-y-4 lg:sticky lg:top-24">
          <div className="card relative overflow-hidden p-5">
            <div className={clsx('pointer-events-none absolute -right-10 -top-12 size-36 rounded-full blur-2xl', missing.length ? 'bg-brand/15' : 'bg-good/15')} />
            <div className="relative flex items-center gap-4">
              <div className="relative size-16">
                <svg viewBox="0 0 36 36" className="size-16 -rotate-90"><circle cx="18" cy="18" r="15.5" fill="none" stroke="var(--line)" strokeWidth="3.5" /><motion.circle cx="18" cy="18" r="15.5" fill="none" stroke={missing.length ? 'var(--brand)' : 'var(--good)'} strokeWidth="3.5" strokeLinecap="round" strokeDasharray="97.4" initial={{ strokeDashoffset: 97.4 }} animate={{ strokeDashoffset: 97.4 * (1 - doneCount / total) }} transition={{ duration: 0.8 }} /></svg>
                <span className="absolute inset-0 grid place-items-center font-display text-sm font-extrabold text-ink">{doneCount}/{total}</span>
              </div>
              <div><p className="font-display text-[15px] font-bold text-ink">{missing.length ? 'Almost there' : 'Profile complete'}</p><p className="text-xs text-muted">{missing.length ? `${missing.length} required detail${missing.length > 1 ? 's' : ''} missing` : 'You can generate invoices'}</p></div>
            </div>
            {missing.length > 0 && <ul className="relative mt-4 space-y-1.5">{missing.map((m) => <li key={m}><button onClick={() => openTab(FIELD_TAB[m] ?? 'business')} className="text-left text-[13px] font-semibold text-warn-ink hover:underline">• {LABELS[m] ?? m}</button></li>)}</ul>}
            {!missing.length && (
              <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="relative mt-4 flex items-center gap-1.5 text-[13px] font-semibold text-good-ink">
                <CheckCircle2 className="size-4" /> Ready to invoice
              </motion.p>
            )}
          </div>
          <nav className="card p-2" aria-label="Settings sections">
            {TABS.map((t) => (
              <button key={t.key} onClick={() => openTab(t.key)} aria-current={tab === t.key} className={clsx('relative flex w-full items-center gap-3 rounded-xl px-3.5 py-3 text-left transition-colors', tab === t.key ? 'text-brand-ink' : 'text-ink-2 hover:bg-surface-2')}>
                {tab === t.key && <motion.span layoutId="settings-tab" className="absolute inset-0 rounded-xl bg-brand-soft" />}
                <t.icon className="relative size-[18px]" /><span className="relative"><span className="block text-sm font-bold">{t.label}</span><span className="block text-xs font-normal text-muted">{t.hint}</span></span>
              </button>
            ))}
          </nav>
        </aside>

        <motion.section ref={sectionRef} key={tab} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} className="card scroll-mt-20 p-6 sm:p-8">
          {tab === 'business' && (
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Business name" required error={errors.business_name} className="sm:col-span-2"><TextInput value={f.business_name} onChange={(e) => set('business_name', e.target.value)} invalid={!!errors.business_name} /></Field>
              <Field label="GSTIN" error={errors.gstin} hint={f.gstin ? '15 characters. Fills in your state and PAN.' : 'Leave empty if you are not GST-registered — your invoices will then be Bills of Supply with no GST.'}><TextInput value={f.gstin} onChange={(e) => setGstin(e.target.value)} maxLength={15} className="num uppercase" invalid={!!errors.gstin} placeholder="07AABCS1234F1ZT" autoCapitalize="characters" /></Field>
              <Field label="PAN" error={errors.pan} hint="10 characters"><TextInput value={f.pan} onChange={(e) => set('pan', e.target.value.toUpperCase())} maxLength={10} className="num uppercase" invalid={!!errors.pan} placeholder="AABCS1234F" /></Field>
              <Field label="State" required error={errors.state} hint="Drives CGST + SGST vs IGST on every invoice" className="sm:col-span-2"><Select value={f.state} onChange={(e) => set('state', e.target.value)} invalid={!!errors.state}><option value="">Select your state…</option>{meta?.states.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}</Select></Field>
              <Field label="Address line 1" required error={errors.address_line1} className="sm:col-span-2"><TextInput value={f.address_line1} onChange={(e) => set('address_line1', e.target.value)} invalid={!!errors.address_line1} placeholder="Shop / building, street" /></Field>
              <Field label="Address line 2" error={errors.address_line2} className="sm:col-span-2"><TextInput value={f.address_line2} onChange={(e) => set('address_line2', e.target.value)} placeholder="Area, landmark (optional)" /></Field>
              <Field label="City" required error={errors.city}><TextInput value={f.city} onChange={(e) => set('city', e.target.value)} invalid={!!errors.city} /></Field>
              <Field label="Pincode" required error={errors.pincode}><TextInput value={f.pincode} onChange={(e) => set('pincode', e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" maxLength={6} className="num" invalid={!!errors.pincode} /></Field>
              <Field label="Phone" required error={errors.phone} hint="10 digits"><TextInput value={f.phone} onChange={(e) => set('phone', phoneInput(e.target.value))} inputMode="numeric" maxLength={10} className="num" invalid={!!errors.phone} placeholder="9876543210" /></Field>
              <Field label="Business email" error={errors.email}><TextInput type="email" value={f.email} onChange={(e) => set('email', e.target.value)} invalid={!!errors.email} /></Field>
              <Field label="Website" error={errors.website} hint="Printed under your address"><TextInput value={f.website} onChange={(e) => set('website', e.target.value.trim())} inputMode="url" invalid={!!errors.website} placeholder="www.yourbusiness.in" /></Field>
              <Field label="Business type" error={errors.business_type} hint="Legal form, as on your registration"><Select value={f.business_type} onChange={(e) => set('business_type', e.target.value)}><option value="">Select…</option>{meta?.business_types?.map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}</Select></Field>
              <Field label="Nature of business" error={errors.business_nature} hint="What you mainly do"><Select value={f.business_nature} onChange={(e) => set('business_nature', e.target.value)}><option value="">Select…</option>{meta?.business_natures?.map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}</Select></Field>
            </div>
          )}

          {tab === 'logo' && (
            <div className="grid gap-8">
              <div>
                <h2 className="font-display text-lg font-bold text-ink">Your logo</h2>
                <p className="mt-1 text-sm text-muted">PNG or JPG, up to 2 MB. It appears on your invoices, PDFs and your login page.</p>
                <div className="mt-4"><ImageDrop url={profile.logo_url} label="Logo" hint="Saved as soon as you choose it" endpoint="/api/profile/logo/" field="logo" onChange={refreshMe} /></div>
              </div>
              <div className="border-t border-line pt-8">
                <h2 className="font-display text-lg font-bold text-ink">Authorised signatory</h2>
                <p className="mt-1 text-sm text-muted">Printed in the “Authorised Signatory” box at the bottom of every invoice.</p>
                <div className="mt-4 grid gap-5 sm:grid-cols-2">
                  <Field label="Signatory name" error={errors.signatory_name} hint="e.g. the owner or a partner"><TextInput value={f.signatory_name} onChange={(e) => set('signatory_name', e.target.value)} placeholder="Ramesh Sharma" /></Field>
                  <div className="sm:col-span-2"><ImageDrop url={profile.signature_url} label="Signature" hint="A clear signature on white paper, or a PNG with a transparent background" endpoint="/api/profile/signature/" field="signature" onChange={refreshMe} /></div>
                </div>
              </div>
              <p className="text-xs text-muted">Images are saved immediately. Invoices you have already finalized keep the logo and signature they were issued with.</p>
            </div>
          )}

          {tab === 'bank' && (
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="sm:col-span-2"><h2 className="font-display text-lg font-bold text-ink">Bank details</h2><p className="mt-1 text-sm text-muted">Printed on invoices so customers know where to pay.</p></div>
              <Field label="Account holder name" error={errors.account_holder_name} className="sm:col-span-2"><TextInput value={f.account_holder_name} onChange={(e) => set('account_holder_name', e.target.value)} /></Field>
              <Field label="Bank name" error={errors.bank_name}><TextInput value={f.bank_name} onChange={(e) => set('bank_name', e.target.value)} placeholder="e.g. HDFC Bank" /></Field>
              <Field label="Branch" error={errors.bank_branch}><TextInput value={f.bank_branch} onChange={(e) => set('bank_branch', e.target.value)} placeholder="e.g. Nehru Place, New Delhi" /></Field>
              <Field label="Account number" error={errors.account_number}><TextInput value={f.account_number} onChange={(e) => set('account_number', e.target.value.replace(/\D/g, ''))} inputMode="numeric" className="num" invalid={!!errors.account_number} /></Field>
              <Field label="Account type" error={errors.account_type}><Select value={f.account_type} onChange={(e) => set('account_type', e.target.value)}><option value="">Select…</option>{meta?.account_types?.map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}</Select></Field>
              <Field label="IFSC" error={errors.ifsc_code} hint="11 characters"><TextInput value={f.ifsc_code} onChange={(e) => set('ifsc_code', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} maxLength={11} className="num uppercase" invalid={!!errors.ifsc_code} placeholder="HDFC0001234" /></Field>

              <div className="border-t border-line pt-6 sm:col-span-2"><h2 className="font-display text-lg font-bold text-ink">UPI & payment settings</h2><p className="mt-1 text-sm text-muted">Customers can scan and pay straight from the invoice PDF.</p></div>
              <Field label="UPI ID" error={errors.upi_id} hint="We print a QR code for the amount due, so customers pay exactly the right amount"><TextInput value={f.upi_id} onChange={(e) => set('upi_id', e.target.value.trim())} invalid={!!errors.upi_id} placeholder="yourname@okhdfcbank" autoCapitalize="none" /></Field>
              <div className="sm:col-span-2">
                <p className="mb-1.5 text-[13px] font-semibold text-ink-2">Your own QR code <span className="font-normal text-muted">(optional)</span></p>
                <ImageDrop url={profile.payment_qr_url} label="Payment QR code" hint={f.upi_id ? 'Leave empty to use the QR we generate from your UPI ID' : 'Upload the QR from your bank or UPI app'} endpoint="/api/profile/payment-qr/" field="qr" onChange={refreshMe} />
              </div>
              <Field label="Default payment instructions" className="sm:col-span-2" error={errors.payment_instructions} hint="Printed next to your bank / UPI details on every invoice"><Textarea value={f.payment_instructions} onChange={(e) => set('payment_instructions', e.target.value)} placeholder="Please mention the invoice number when you pay. Cheques in favour of Sharma Furniture." /></Field>
            </div>
          )}

          {tab === 'invoice' && (
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="sm:col-span-2"><h2 className="font-display text-lg font-bold text-ink">Invoice settings</h2><p className="mt-1 text-sm text-muted">Defaults applied to every new invoice.</p></div>
              <Field label="Numbering sequence" className="sm:col-span-2" error={errors.invoice_number_format}>
                <div className="grid gap-2.5 sm:grid-cols-2" role="radiogroup" aria-label="Numbering sequence">
                  {([['fy', 'Restart every financial year', `${f.invoice_prefix || 'INV'}/${fy ?? '2026-27'}/001`], ['running', 'One running series', `${f.invoice_prefix || 'INV'}-0001`]] as const).map(([key, title, eg]) => (
                    <button key={key} type="button" role="radio" aria-checked={f.invoice_number_format === key}
                      onClick={() => { set('invoice_number_format', key); if (key === 'fy' && f.invoice_prefix.length > 4) set('invoice_prefix', f.invoice_prefix.slice(0, 4)) }}
                      className={clsx('rounded-xl border p-3.5 text-left transition-colors', f.invoice_number_format === key ? 'border-brand bg-brand-soft ring-2 ring-brand/20' : 'border-line-strong hover:bg-surface-2')}>
                      <span className="block text-sm font-bold text-ink">{title}</span><span className="num mt-0.5 block text-xs text-muted">e.g. {eg}</span>
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="Invoice prefix" error={errors.invoice_prefix} hint={`1–${prefixMax} letters or digits. GST allows at most 16 characters in an invoice number.`}>
                <TextInput value={f.invoice_prefix} onChange={(e) => set('invoice_prefix', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, prefixMax))} maxLength={prefixMax} className="num uppercase" invalid={!!errors.invoice_prefix} />
              </Field>
              <Field label="Next invoice number" error={errors.next_invoice_number} hint={`Start from a higher number to continue from your old billing software. It can't go below ${profile.next_invoice_number}.`}>
                <TextInput value={f.next_invoice_number || ''} onChange={(e) => set('next_invoice_number', Number(e.target.value.replace(/\D/g, '').slice(0, 6)) || 0)} inputMode="numeric" className="num" invalid={!!errors.next_invoice_number} />
              </Field>
              <div className="rounded-2xl border border-brand/25 bg-brand-soft p-5 sm:col-span-2">
                <p className="text-xs font-bold uppercase tracking-widest text-brand-ink">Your next invoice number</p>
                <p className="num mt-1 font-display text-2xl font-extrabold text-brand-ink">{nextNumber}</p>
                <p className="mt-1 text-xs text-ink-2">{f.invoice_number_format === 'running' ? 'One series that keeps counting up, year after year.' : 'Format: PREFIX / financial year (April–March) / running number. It restarts at 001 every April.'} Numbers are assigned in order when you finalize.</p>
              </div>
              <Field label="Default GST rate" error={errors.default_gst_rate} hint={profile.gstin ? 'Pre-selected for new products and invoice items' : 'Not used while you have no GSTIN — no GST is charged'}>
                <Select value={String(Number(f.default_gst_rate))} onChange={(e) => set('default_gst_rate', e.target.value)} disabled={!profile.gstin}>{meta?.gst_rates.map((r) => <option key={r} value={String(r)}>{r}%</option>)}</Select>
              </Field>
              <Field label="Default payment terms" error={errors.default_payment_terms} hint="Days until an invoice is due">
                <TextInput value={f.default_payment_terms} onChange={(e) => set('default_payment_terms', Number(e.target.value.replace(/\D/g, '')) || 0)} inputMode="numeric" className="num" invalid={!!errors.default_payment_terms} />
              </Field>
              <Field label="Default notes" className="sm:col-span-2" error={errors.default_notes}><Textarea value={f.default_notes} onChange={(e) => set('default_notes', e.target.value)} placeholder="Thank you for your business!" /></Field>
              <Field label="Default terms & conditions" className="sm:col-span-2" error={errors.default_terms}><Textarea rows={4} value={f.default_terms} onChange={(e) => set('default_terms', e.target.value)} placeholder="Payment due within 30 days. Goods once sold will not be taken back." /></Field>
            </div>
          )}

          {tab === 'email' && (
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="sm:col-span-2"><h2 className="font-display text-lg font-bold text-ink">Send invoices from your own email</h2><p className="mt-1 text-sm text-muted">Optional. Without this, invoices are emailed from GST Billing's address with replies going to your business email.</p></div>
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line-strong p-4 sm:col-span-2">
                <input type="checkbox" checked={f.smtp_enabled} onChange={(e) => set('smtp_enabled', e.target.checked)} className="mt-0.5 size-[18px] shrink-0 accent-[var(--brand)]" />
                <span><span className="block text-sm font-bold text-ink">Use my own mail server (SMTP)</span><span className="block text-xs text-muted">Customers see your address as the sender.</span></span>
              </label>
              {f.smtp_enabled && (<>
                <div className="flex flex-wrap items-center gap-2 sm:col-span-2"><span className="text-xs font-semibold text-muted">Quick fill:</span>
                  {SMTP_PRESETS.map((p) => <button key={p.name} type="button" onClick={() => { set('smtp_host', p.host); set('smtp_port', p.port); set('smtp_security', p.security) }} className="rounded-full border border-line-strong px-3 py-2 text-xs font-semibold text-ink-2 hover:bg-brand-soft hover:text-brand-ink">{p.name}</button>)}
                </div>
                <Field label="Server" required error={errors.smtp_host}><TextInput value={f.smtp_host} onChange={(e) => set('smtp_host', e.target.value.trim())} invalid={!!errors.smtp_host} placeholder="smtp.gmail.com" autoCapitalize="none" /></Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Port" error={errors.smtp_port}><TextInput value={f.smtp_port || ''} onChange={(e) => set('smtp_port', Number(e.target.value.replace(/\D/g, '').slice(0, 5)) || 0)} inputMode="numeric" className="num" invalid={!!errors.smtp_port} /></Field>
                  <Field label="Security" error={errors.smtp_security}><Select value={f.smtp_security} onChange={(e) => set('smtp_security', e.target.value)}><option value="starttls">STARTTLS</option><option value="ssl">SSL/TLS</option><option value="none">None</option></Select></Field>
                </div>
                <Field label="Username" error={errors.smtp_username} hint="Usually your full email address"><TextInput value={f.smtp_username} onChange={(e) => set('smtp_username', e.target.value.trim())} autoComplete="off" autoCapitalize="none" /></Field>
                <Field label="Password" error={errors.smtp_password} hint={profile.smtp_password_set ? 'Saved (hidden). Leave empty to keep it.' : 'For Gmail use an App Password, not your normal password'}><TextInput type="password" value={f.smtp_password ?? ''} onChange={(e) => set('smtp_password', e.target.value)} autoComplete="new-password" placeholder={profile.smtp_password_set ? '••••••••' : ''} /></Field>
                <Field label="From email" required error={errors.smtp_from_email}><TextInput type="email" value={f.smtp_from_email} onChange={(e) => set('smtp_from_email', e.target.value.trim())} invalid={!!errors.smtp_from_email} placeholder="billing@yourbusiness.in" /></Field>
                <Field label="From name" error={errors.smtp_from_name} hint="Defaults to your business name"><TextInput value={f.smtp_from_name} onChange={(e) => set('smtp_from_name', e.target.value)} placeholder={f.business_name} /></Field>
                <div className="flex flex-wrap items-center gap-3 rounded-xl bg-surface-2 p-4 sm:col-span-2">
                  <Button variant="secondary" loading={testing} onClick={testEmail} icon={<Send className="size-4" />}>Send a test email</Button>
                  <p className="text-xs text-muted">Sends a test to your login email using the settings above (before you save).</p>
                </div>
              </>)}
            </div>
          )}

          {(
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
