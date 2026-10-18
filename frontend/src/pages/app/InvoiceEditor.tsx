import { useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, ArrowLeft, BadgeCheck, CalendarDays, Globe2, Lock, Mail, MessageCircle, Package, Plus, Save, Send, Trash2, UserPlus } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { PageHeader, PageLoader, UpgradePrompt } from '@/components/ui/Bits'
import { Button } from '@/components/ui/Button'
import { Combobox, Field, Select, Textarea, TextInput, inputCls } from '@/components/ui/Form'
import { ConfirmDialog } from '@/components/ui/Modal'
import { ApiError, get, post, put, qs } from '@/lib/api'
import { addDaysISO, amountInWords, financialYear, inr, inrPlain, todayISO, trimZero } from '@/lib/format'
import { calcInvoice, detectSupply, type Supply } from '@/lib/gst'
import { openPendingWindow, sendToEmail, sendToWhatsApp } from '@/lib/share'
import { useMe, useMeta, useProfile, useRefreshUsage, useSubscription } from '@/lib/hooks'
import type { Customer, InvoiceDetail, Paginated, Product } from '@/lib/types'
import { CustomerModal } from './Customers'

interface Row {
  key: string; item_name: string; description: string; hsn_sac_code: string; unit: string
  quantity: string; unit_price: string; discount_percent: string; gst_rate: string
}
let seq = 0
const blank = (): Row => ({ key: `r${++seq}`, item_name: '', description: '', hsn_sac_code: '', unit: 'pcs', quantity: '1', unit_price: '', discount_percent: '0', gst_rate: '18' })
const num = (v: string) => v.replace(/[^\d.]/g, '')

export default function InvoiceEditor() {
  const { id } = useParams()
  const editing = !!id
  const navigate = useNavigate()
  const qc = useQueryClient()
  const refreshUsage = useRefreshUsage()
  const me = useMe().data
  const { data: profile } = useProfile()
  const meta = useMeta().data
  const sub = useSubscription().data

  const existing = useQuery({ queryKey: ['invoice', id], enabled: editing, queryFn: () => get<InvoiceDetail>(`/api/invoices/${id}/`) })

  const [customer, setCustomer] = useState<Customer | null>(null)
  const [invoiceDate, setInvoiceDate] = useState(todayISO())
  const [dueDate, setDueDate] = useState('')
  const [dueTouched, setDueTouched] = useState(false)
  const [isExport, setIsExport] = useState(false)
  const [notes, setNotes] = useState('')
  const [terms, setTerms] = useState('')
  const [rows, setRows] = useState<Row[]>([blank()])
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({})
  const [busy, setBusy] = useState<'draft' | 'final' | null>(null)
  const [confirm, setConfirm] = useState<null | 'finalize' | 'whatsapp' | 'email'>(null)
  const [addCustomer, setAddCustomer] = useState(false)
  const [limitHit, setLimitHit] = useState<{ limit: number; plan: string } | null>(null)
  const [hydrated, setHydrated] = useState(false)

  // ---- hydrate: defaults for a new invoice, or the saved draft
  useEffect(() => {
    if (hydrated) return
    if (editing) {
      const inv = existing.data
      if (!inv) return
      if (!inv.is_editable) { navigate(`/invoices/${inv.id}`, { replace: true }); return }
      setCustomer({ id: inv.customer, name: inv.customer_name, state: inv.bill_to.state, state_name: inv.bill_to.state_name, gstin: inv.bill_to.gstin, email: inv.bill_to.email ?? '', phone: inv.bill_to.phone ?? '' } as Customer)
      setInvoiceDate(inv.invoice_date); setDueDate(inv.due_date); setDueTouched(true)
      setIsExport(inv.supply_type === 'export'); setNotes(inv.notes); setTerms(inv.terms)
      setRows(inv.items.map((i) => ({ key: `r${++seq}`, item_name: i.item_name, description: i.description, hsn_sac_code: i.hsn_sac_code, unit: i.unit, quantity: String(Number(i.quantity)), unit_price: i.unit_price, discount_percent: String(Number(i.discount_percent)), gst_rate: String(Number(i.gst_rate)) })))
      setHydrated(true)
    } else if (profile) {
      setNotes(profile.default_notes); setTerms(profile.default_terms)
      setDueDate(addDaysISO(todayISO(), profile.default_payment_terms))
      setHydrated(true)
    }
  }, [editing, existing.data, profile, hydrated, navigate])

  useEffect(() => { if (!dueTouched && profile) setDueDate(addDaysISO(invoiceDate, profile.default_payment_terms)) }, [invoiceDate, dueTouched, profile])

  // ---- live GST maths (mirrors the server; the server recomputes on save)
  const detected = detectSupply(profile?.state, customer?.state)
  const supply: Supply = isExport ? 'export' : detected ?? 'intrastate'
  const totals = useMemo(() => calcInvoice(rows.map((r) => ({ quantity: r.quantity, unit_price: r.unit_price, discount_percent: r.discount_percent, gst_rate: r.gst_rate })), supply), [rows, supply])

  const patchRow = (key: string, p: Partial<Row>) => { setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r))); setRowErrors({}) }
  const addProduct = (p: Product) => {
    setRows((rs) => {
      const row: Row = { key: `r${++seq}`, item_name: p.name, description: p.description, hsn_sac_code: p.hsn_sac_code, unit: p.unit, quantity: '1', unit_price: p.selling_price, discount_percent: '0', gst_rate: String(Number(p.gst_rate)) }
      return rs.length === 1 && !rs[0].item_name && !rs[0].unit_price ? [row] : [...rs, row]  // copy, never reference (US-04 AC5)
    })
  }

  const usageLimit = sub?.limits.invoices_per_month ?? null
  const blockedByLimit = !editing && usageLimit !== null && (sub?.usage.invoices_per_month ?? 0) >= usageLimit
  const profileIncomplete = me ? !me.profile_complete : false
  const fy = financialYear(invoiceDate)

  const validate = () => {
    const e: Record<string, string> = {}
    const re: Record<number, string> = {}
    if (!customer) e.customer = 'Choose a customer.'
    if (!invoiceDate) e.invoice_date = 'Pick the invoice date.'
    if (dueDate && dueDate < invoiceDate) e.due_date = "Due date can't be before the invoice date."
    rows.forEach((r, i) => {
      if (!r.item_name.trim()) re[i] = 'Give this item a name.'
      else if (!(Number(r.quantity) > 0)) re[i] = 'Quantity must be more than zero.'
      else if (r.unit_price === '' || Number(r.unit_price) < 0) re[i] = 'Enter the rate.'
      else if (Number(r.discount_percent) > 100) re[i] = 'Discount can be at most 100%.'
    })
    setErrors(e); setRowErrors(re)
    return !Object.keys(e).length && !Object.keys(re).length
  }

  /** `via` = finalize AND send the customer their invoice (the WhatsApp / email buttons). */
  const save = async (finalize: boolean, via?: 'whatsapp' | 'email') => {
    if (!validate()) { toast.error('Please fix the highlighted fields.'); return }
    // WhatsApp opens in a new tab: it must be opened inside this click (before any await) or the popup blocker eats it.
    const popup = via === 'whatsapp' ? openPendingWindow() : null
    setBusy(finalize ? 'final' : 'draft'); setLimitHit(null)
    const body = {
      customer: customer!.id, invoice_date: invoiceDate, due_date: dueDate || undefined,
      supply_type: isExport ? 'export' : 'auto', notes, terms,
      items: rows.map((r) => ({ item_name: r.item_name.trim(), description: r.description, hsn_sac_code: r.hsn_sac_code, unit: r.unit, quantity: r.quantity, unit_price: r.unit_price, discount_percent: r.discount_percent || '0', gst_rate: Number(r.gst_rate) })),
    }
    try {
      let inv = editing ? await put<InvoiceDetail>(`/api/invoices/${id}/`, body) : await post<InvoiceDetail>('/api/invoices/', body)
      if (finalize) inv = await post<InvoiceDetail>(`/api/invoices/${inv.id}/finalize/`)
      qc.invalidateQueries({ queryKey: ['invoices'] }); qc.invalidateQueries({ queryKey: ['invoice-summary'] }); qc.invalidateQueries({ queryKey: ['invoice', String(inv.id)] })
      refreshUsage()
      if (finalize && via === 'whatsapp') {
        try {
          const r = await sendToWhatsApp(inv.id, popup)
          if (r.opened) toast.success(`Invoice ${inv.invoice_number} finalized — WhatsApp opened for ${r.info.customer_name}`)
          else toast.warning(`Invoice ${inv.invoice_number} finalized, but your browser blocked the WhatsApp window. Use "Send to WhatsApp" on the invoice page.`)
        } catch (e) {
          toast.warning(`Invoice ${inv.invoice_number} finalized, but WhatsApp couldn't be prepared: ${e instanceof ApiError ? e.message : 'please try again from the invoice page.'}`)
        }
      } else if (finalize && via === 'email') {
        try {
          const r = await sendToEmail(inv.id)
          toast.success(`Invoice ${inv.invoice_number} finalized and emailed to ${r.sent_to}`)
        } catch (e) {
          toast.warning(`Invoice ${inv.invoice_number} finalized, but the email wasn't sent: ${e instanceof ApiError ? e.message : 'please try again from the invoice page.'}`)
        }
      } else toast.success(finalize ? `Invoice ${inv.invoice_number} finalized` : 'Draft saved')
      navigate(`/invoices/${inv.id}`)
    } catch (err) {
      popup?.close()
      setConfirm(null)
      if (err instanceof ApiError) {
        if (err.isPlanLimit) setLimitHit({ limit: err.data.limit, plan: sub?.plan_name ?? 'Free' })
        else if (err.code === 'profile_incomplete') toast.error('Complete your profile to generate invoices.')
        else if (err.data?.items) {
          const re: Record<number, string> = {}
          ;(err.data.items as any[]).forEach((it, i) => { const first = it && Object.values(it)[0]; if (first) re[i] = `${Object.keys(it)[0].replace('_', ' ')}: ${Array.isArray(first) ? first[0] : first}` })
          setRowErrors(re); toast.error('Some line items need attention.')
        } else { setErrors(err.fieldErrors); toast.error(err.message) }
      } else toast.error('Could not save the invoice.')
    } finally { setBusy(null) }
  }

  const askToSend = (kind: 'finalize' | 'whatsapp' | 'email') => {
    if (validate()) setConfirm(kind)
    else toast.error('Please fix the highlighted fields.')
  }

  if ((editing && existing.isLoading) || !hydrated || !profile) return <PageLoader />
  if (editing && existing.isError) return <div className="card p-10 text-center text-muted">This invoice could not be found. <Link className="font-semibold text-brand-ink" to="/invoices">Back to invoices</Link></div>

  const disabled = blockedByLimit || profileIncomplete

  return (
    <>
      <Link to={editing ? `/invoices/${id}` : '/invoices'} className="mb-2 inline-flex items-center gap-1.5 py-2 text-sm font-semibold text-muted hover:text-brand-ink"><ArrowLeft className="size-4" />{editing ? 'Back to invoice' : 'All invoices'}</Link>
      <PageHeader title={editing ? 'Edit draft invoice' : 'New invoice'} subtitle={<>Invoice number is assigned when you finalize — format <b className="num text-ink-2">{profile.invoice_prefix}/{fy}/001</b></>} />

      <div className="mb-6 space-y-4">
        {profileIncomplete && (
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-warn/40 bg-warn-soft p-4 text-sm font-semibold text-warn-ink"><AlertTriangle className="size-5" />Complete your profile to generate invoices.<Link to="/settings" className="ml-auto rounded-lg bg-warn-ink/10 px-3 py-1.5 font-bold hover:bg-warn-ink/15">Open business profile</Link></div>
        )}
        {(blockedByLimit || limitHit) && sub && <UpgradePrompt resource="invoices_per_month" limit={limitHit?.limit ?? usageLimit!} plans={sub.plans} planName={sub.plan_name} />}
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          {/* ---- customer & dates */}
          <section className="card p-6">
            <h2 className="font-display text-base font-bold text-ink">Customer & dates</h2>
            <div className="mt-5 grid gap-5 md:grid-cols-2">
              <Field label="Customer" required error={errors.customer} className="md:col-span-2">
                <Combobox<Customer>
                  placeholder="Search customers…" invalid={!!errors.customer} disabled={disabled}
                  search={async (q) => (await get<Paginated<Customer>>(`/api/customers/${qs({ q, page_size: 8 })}`)).results}
                  onSelect={(c) => { setCustomer(c); setErrors((p) => ({ ...p, customer: '' })) }}
                  selectedLabel={customer && <span className="flex items-center gap-2"><b className="font-semibold text-ink">{customer.name}</b><span className="text-xs text-muted">{customer.state_name}{customer.gstin ? ` · ${customer.gstin}` : ' · B2C'}</span></span>}
                  renderItem={(c) => <div><p className="font-semibold">{c.name}</p><p className="text-xs text-muted">{c.state_name}{c.gstin ? ` · ${c.gstin}` : ' · Unregistered'}</p></div>}
                  footer={<button type="button" onClick={() => setAddCustomer(true)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-bold text-brand-ink hover:bg-brand-soft"><UserPlus className="size-4" />Add a new customer</button>}
                />
              </Field>
              <Field label="Invoice date" required error={errors.invoice_date}>
                <div className="relative"><CalendarDays className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" /><input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} className={clsx(inputCls, 'h-11 pl-10')} /></div>
              </Field>
              <Field label="Due date" error={errors.due_date} hint={!dueTouched ? `Auto-set from your ${profile.default_payment_terms}-day payment terms` : undefined}>
                <div className="relative"><CalendarDays className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" /><input type="date" min={invoiceDate} value={dueDate} onChange={(e) => { setDueDate(e.target.value); setDueTouched(true) }} className={clsx(inputCls, 'h-11 pl-10')} /></div>
              </Field>
            </div>

            {/* supply type banner */}
            <AnimatePresence mode="wait">
              <motion.div key={supply + String(!!customer)} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className={clsx('mt-5 flex flex-wrap items-center gap-3 rounded-xl border p-4', supply === 'export' ? 'border-info/30 bg-info-soft' : supply === 'intrastate' ? 'border-good/30 bg-good-soft' : 'border-warn/40 bg-warn-soft')}>
                <BadgeCheck className={clsx('size-5', supply === 'export' ? 'text-info-ink' : supply === 'intrastate' ? 'text-good-ink' : 'text-warn-ink')} />
                <div className="min-w-0 flex-1 basis-56 text-sm">
                  <p className="font-bold text-ink">{supply === 'export' ? 'Export / SEZ — zero-rated (under LUT)' : supply === 'intrastate' ? 'Intra-state supply — CGST + SGST' : 'Inter-state supply — IGST'}</p>
                  <p className="text-xs text-ink-2">{!customer ? 'Choose a customer and the right tax is applied automatically.' : supply === 'export' ? 'No GST is charged on this invoice.' : `Your state ${profile.state} ${detected === 'intrastate' ? '=' : '≠'} customer state ${customer.state}. Detected automatically.`}</p>
                </div>
                <label className="flex w-full cursor-pointer items-center gap-2.5 text-[13px] font-semibold text-ink-2 sm:w-auto">
                  <input type="checkbox" checked={isExport} onChange={(e) => setIsExport(e.target.checked)} className="size-4 accent-[var(--brand)]" /><Globe2 className="size-4" />Export / SEZ (zero-rated)
                </label>
              </motion.div>
            </AnimatePresence>
          </section>

          {/* ---- line items */}
          <section className="card p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-display text-base font-bold text-ink">Items</h2>
              <div className="flex items-center gap-2.5">
                <div className="w-72 max-w-full">
                  <Combobox<Product> placeholder="Add from catalogue…" disabled={disabled}
                    search={async (q) => (await get<Paginated<Product>>(`/api/products/${qs({ q, page_size: 8 })}`)).results}
                    onSelect={addProduct}
                    renderItem={(p) => <div className="flex items-center justify-between gap-3"><div className="min-w-0"><p className="truncate font-semibold">{p.name}</p><p className="text-xs text-muted">{p.hsn_sac_code ? `HSN ${p.hsn_sac_code} · ` : ''}GST {trimZero(p.gst_rate)}%</p></div><span className="num shrink-0 text-sm font-bold">{inr(p.selling_price)}</span></div>} />
                </div>
              </div>
            </div>

            <div className="mt-5 space-y-3.5">
              <AnimatePresence initial={false}>
                {rows.map((r, i) => {
                  const line = totals.lines[i]
                  return (
                    <motion.div key={r.key} layout initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                      <div className={clsx('rounded-2xl border bg-surface-2 p-4', rowErrors[i] ? 'border-crit/60' : 'border-line')}>
                        <div className="mb-3 flex items-center justify-between"><span className="grid size-6 place-items-center rounded-full bg-brand-soft text-xs font-bold text-brand-ink">{i + 1}</span>
                          <button type="button" onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((x) => x.key !== r.key) : [blank()]))} aria-label={`Remove item ${i + 1}`} className="rounded-lg p-2.5 text-muted hover:bg-crit-soft hover:text-crit-ink"><Trash2 className="size-4" /></button></div>
                        <div className="grid grid-cols-2 gap-3 md:grid-cols-6 xl:grid-cols-12">
                          <div className="col-span-2 md:col-span-4 xl:col-span-5"><label className="mb-1 block text-xs font-semibold text-muted">Item name</label>
                            <input value={r.item_name} onChange={(e) => patchRow(r.key, { item_name: e.target.value })} placeholder="What are you selling?" className={clsx(inputCls, 'h-10')} /></div>
                          <div className="col-span-1 md:col-span-2 xl:col-span-2"><label className="mb-1 block text-xs font-semibold text-muted">HSN / SAC</label>
                            <input value={r.hsn_sac_code} onChange={(e) => patchRow(r.key, { hsn_sac_code: e.target.value.replace(/\D/g, '') })} inputMode="numeric" maxLength={8} className={clsx(inputCls, 'num h-10')} /></div>
                          <div className="col-span-1 xl:col-span-2"><label className="mb-1 block text-xs font-semibold text-muted">Qty</label>
                            <input value={r.quantity} onChange={(e) => patchRow(r.key, { quantity: num(e.target.value) })} inputMode="decimal" className={clsx(inputCls, 'num h-10')} /></div>
                          <div className="col-span-1 xl:col-span-3"><label className="mb-1 block text-xs font-semibold text-muted">Unit</label>
                            <Select value={r.unit} onChange={(e) => patchRow(r.key, { unit: e.target.value })} className="!h-10">{meta?.units.map((u) => <option key={u.code} value={u.code}>{u.code}</option>)}</Select></div>
                          <div className="col-span-1 md:col-span-2 xl:col-span-4"><label className="mb-1 block text-xs font-semibold text-muted">Rate (₹)</label>
                            <input value={r.unit_price} onChange={(e) => patchRow(r.key, { unit_price: num(e.target.value) })} inputMode="decimal" placeholder="0.00" className={clsx(inputCls, 'num h-10')} /></div>
                          <div className="col-span-1 md:col-span-2 xl:col-span-4"><label className="mb-1 block text-xs font-semibold text-muted">Discount %</label>
                            <input value={r.discount_percent} onChange={(e) => patchRow(r.key, { discount_percent: num(e.target.value) })} inputMode="decimal" className={clsx(inputCls, 'num h-10')} /></div>
                          <div className="col-span-1 md:col-span-2 xl:col-span-4"><label className="mb-1 block text-xs font-semibold text-muted">GST rate</label>
                            <Select value={r.gst_rate} onChange={(e) => patchRow(r.key, { gst_rate: e.target.value })} className="!h-10">{[...(meta?.gst_rates ?? [0, 0.25, 3, 5, 18, 40]), ...(meta?.gst_rates?.includes(Number(r.gst_rate)) ? [] : [Number(r.gst_rate)])].map((g) => <option key={g} value={g}>{g}%</option>)}</Select></div>
                          <div className="col-span-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-xl bg-surface px-4 py-2.5 md:col-span-6 xl:col-span-12">
                            <div className="text-xs text-muted">Taxable <b className="num text-ink-2">{inrPlain(line?.taxable.toString())}</b>{supply !== 'export' && <> · Tax <b className="num text-ink-2">{inrPlain(line?.cgst.add(line.sgst).add(line.igst).toString())}</b></>}</div>
                            <div className="num font-display text-base font-extrabold text-ink">{inr(line?.total.toString())}</div>
                          </div>
                        </div>
                        {rowErrors[i] && <p className="mt-2.5 flex items-center gap-1.5 text-xs font-semibold text-crit-ink"><AlertTriangle className="size-3.5" />{rowErrors[i]}</p>}
                      </div>
                    </motion.div>
                  )
                })}
              </AnimatePresence>
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <Button variant="soft" onClick={() => setRows((rs) => [...rs, blank()])} icon={<Plus className="size-4" />} disabled={rows.length >= 100}>Add another item</Button>
              <Link to="/products" className="inline-flex h-11 items-center gap-2 rounded-xl px-4 text-sm font-semibold text-muted hover:text-brand-ink"><Package className="size-4" />Manage catalogue</Link>
            </div>
          </section>

          <section className="card grid gap-5 p-6 md:grid-cols-2">
            <Field label="Notes" hint="Shown on the invoice"><Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Thank you for your business!" /></Field>
            <Field label="Terms & conditions"><Textarea rows={3} value={terms} onChange={(e) => setTerms(e.target.value)} placeholder="Payment terms, warranty, returns…" /></Field>
          </section>
        </div>

        {/* ---- summary */}
        <aside className="xl:sticky xl:top-24">
          <div className="card overflow-hidden">
            <div className="gradient-brand px-6 py-5 text-white">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-white/70">Grand total</p>
              <motion.p key={totals.grand.toString()} initial={{ opacity: 0.4, y: 4 }} animate={{ opacity: 1, y: 0 }} className="mt-1 font-display text-4xl font-extrabold tracking-tight">{inr(totals.grand.toString())}</motion.p>
              <p className="mt-2 text-[13px] leading-snug text-white/75">{amountInWords(Number(totals.grand.toString()))}</p>
            </div>
            <dl className="space-y-3 px-6 py-5 text-sm">
              <Line label="Subtotal" value={totals.subtotal.toString()} />
              {!totals.discount.isZero() && <Line label="Discount" value={`-${totals.discount.toString()}`} />}
              <Line label="Taxable amount" value={totals.taxable.toString()} strong />
              <div className="my-1 border-t border-dashed border-line-strong" />
              {supply === 'intrastate' && <><Line label="CGST" value={totals.cgst.toString()} /><Line label="SGST" value={totals.sgst.toString()} /></>}
              {supply === 'interstate' && <Line label="IGST" value={totals.igst.toString()} />}
              {supply === 'export' && <p className="text-xs text-muted">Zero-rated — no GST applies.</p>}
              {!totals.roundOff.isZero() && <Line label="Round off" value={`${totals.roundOff.gt(0) ? '+' : ''}${totals.roundOff.toString()}`} muted />}
            </dl>
            <div className="space-y-3 border-t border-line bg-surface-2 p-5">
              <Button className="w-full" size="lg" variant="secondary" onClick={() => save(false)} loading={busy === 'draft'} disabled={!!busy || disabled} icon={<Save className="size-[18px]" />}>Save as draft</Button>
              <div className="space-y-2.5 rounded-2xl border border-line bg-surface p-3">
                <p className="px-1 text-[11px] font-bold uppercase tracking-[0.12em] text-muted">Send to customer</p>
                <Button className="w-full" variant="whatsapp" onClick={() => askToSend('whatsapp')} disabled={!!busy || disabled || !customer || !customer.phone} icon={<MessageCircle className="size-[18px]" />}>Send to WhatsApp</Button>
                <Button className="w-full" variant="secondary" onClick={() => askToSend('email')} disabled={!!busy || disabled || !customer || !customer.email} icon={<Mail className="size-[18px]" />}>Send to Email</Button>
                {!customer
                  ? <p className="px-1 text-xs text-muted">Choose a customer to enable sending.</p>
                  : (!customer.phone || !customer.email) && <p className="px-1 text-xs leading-relaxed text-muted">
                      {!customer.phone && 'This customer has no phone number, so WhatsApp is unavailable. '}
                      {!customer.email && 'This customer has no email address, so email is unavailable. '}
                      Add the missing detail on the <Link to="/customers" className="font-semibold text-brand-ink hover:underline">Customers</Link> page.
                    </p>}
                <p className="px-1 text-xs leading-relaxed text-muted">Sending finalizes &amp; locks the invoice first, so the customer always receives the final version.</p>
              </div>
              <Button className="w-full" size="lg" onClick={() => askToSend('finalize')} disabled={!!busy || disabled} icon={<Send className="size-[18px]" />}>Finalize invoice</Button>
              <p className="flex items-start gap-2 text-xs leading-relaxed text-muted"><Lock className="mt-0.5 size-3.5 shrink-0" />Finalizing assigns the invoice number and locks the invoice. Drafts stay editable.</p>
            </div>
          </div>
        </aside>
      </div>

      <ConfirmDialog open={confirm !== null} onClose={() => setConfirm(null)} onConfirm={() => save(true, confirm === 'whatsapp' || confirm === 'email' ? confirm : undefined)} loading={busy === 'final'}
        title={confirm === 'whatsapp' ? 'Finalize and send on WhatsApp?' : confirm === 'email' ? 'Finalize and email this invoice?' : 'Finalize this invoice?'}
        confirmLabel={confirm === 'whatsapp' ? 'Finalize & open WhatsApp' : confirm === 'email' ? 'Finalize & send email' : 'Finalize & lock'}
        message={<>The invoice number <b>{profile.invoice_prefix}/{fy}/…</b> will be assigned and the invoice will be <b>locked</b> — it can no longer be edited (you can cancel it and issue a new one). Total: <b>{inr(totals.grand.toString())}</b>.
          {confirm === 'whatsapp' && customer && <> WhatsApp will then open with a ready-to-send message for <b>{customer.name}</b> (<b>{customer.phone}</b>), including a link to the PDF.</>}
          {confirm === 'email' && customer && <> The invoice PDF will then be emailed to <b>{customer.name}</b> at <b>{customer.email}</b>.</>}</>} />
      <CustomerModal customer={addCustomer ? 'new' : null} onClose={() => setAddCustomer(false)} onSaved={(c) => { setCustomer(c); setAddCustomer(false); qc.invalidateQueries({ queryKey: ['customers'] }); refreshUsage() }} />
    </>
  )
}

function Line({ label, value, strong, muted }: { label: string; value: string; strong?: boolean; muted?: boolean }) {
  return <div className="flex items-center justify-between"><dt className={clsx(muted ? 'text-muted' : 'text-ink-2', strong && 'font-semibold')}>{label}</dt><dd className={clsx('num', strong ? 'font-bold text-ink' : muted ? 'text-muted' : 'font-semibold text-ink-2')}>{Number(value) < 0 ? '−' : ''}{inr(Math.abs(Number(value)))}</dd></div>
}
