import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { motion } from 'framer-motion'
import {
  ArrowLeft, Ban, Banknote, CircleDollarSign, Download, Eye, Landmark, Lock, Mail, MessageCircle, Pencil, ReceiptText, Send, Smartphone, Trash2, Wallet,
} from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { PageLoader, StatusBadge } from '@/components/ui/Bits'
import { Button, IconButton } from '@/components/ui/Button'
import { Field, Textarea, TextInput, inputCls } from '@/components/ui/Form'
import { ConfirmDialog, Modal } from '@/components/ui/Modal'
import { ApiError, del, get, post } from '@/lib/api'
import { fmtDate, fmtDateTime, inr, inrPlain, todayISO, trimZero } from '@/lib/format'
import { useRefreshUsage } from '@/lib/hooks'
import { openPendingWindow, sendToEmail, sendToWhatsApp } from '@/lib/share'
import { EditPaymentModal, PaymentDetailsModal, UndoPaymentDialog, receiptHref } from '@/components/payments/PaymentDialogs'
import type { InvoiceDetail, Payment, PaymentRecord } from '@/lib/types'

const MODES = [
  { code: 'cash', label: 'Cash', icon: Banknote },
  { code: 'upi', label: 'UPI', icon: Smartphone },
  { code: 'bank_transfer', label: 'Bank transfer', icon: Landmark },
  { code: 'cheque', label: 'Cheque', icon: ReceiptText },
] as const

export default function InvoiceView() {
  const { id } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const refreshUsage = useRefreshUsage()
  const [payOpen, setPayOpen] = useState(false)
  const [confirm, setConfirm] = useState<null | 'finalize' | 'cancel' | 'delete'>(null)
  const [viewing, setViewing] = useState<PaymentRecord | null>(null)
  const [editingPay, setEditingPay] = useState<PaymentRecord | null>(null)
  const [undoing, setUndoing] = useState<PaymentRecord | null>(null)
  const [sending, setSending] = useState<null | 'whatsapp' | 'email'>(null)

  const inv = useQuery({ queryKey: ['invoice', id], queryFn: () => get<InvoiceDetail>(`/api/invoices/${id}/`) })
  const refresh = (data?: InvoiceDetail) => {
    if (data) qc.setQueryData(['invoice', id], data)
    qc.invalidateQueries({ queryKey: ['invoices'] }); qc.invalidateQueries({ queryKey: ['invoice-summary'] }); qc.invalidateQueries({ queryKey: ['dashboard'] })
  }
  const act = useMutation({
    mutationFn: (kind: 'finalize' | 'cancel') => post<InvoiceDetail>(`/api/invoices/${id}/${kind}/`),
    onSuccess: (d, kind) => { refresh(d); setConfirm(null); toast.success(kind === 'finalize' ? `Invoice ${d.invoice_number} finalized` : 'Invoice cancelled') },
    onError: (e) => { setConfirm(null); toast.error(e instanceof ApiError ? e.message : 'Action failed') },
  })
  const remove = useMutation({
    mutationFn: () => del(`/api/invoices/${id}/`),
    onSuccess: () => { refresh(); refreshUsage(); toast.success('Draft deleted'); navigate('/invoices', { replace: true }) },
    onError: (e) => { setConfirm(null); toast.error(e instanceof ApiError ? e.message : 'Could not delete') },
  })
  const refreshAfterPaymentChange = () => {
    qc.invalidateQueries({ queryKey: ['invoice', id] }); qc.invalidateQueries({ queryKey: ['invoices'] }); qc.invalidateQueries({ queryKey: ['invoice-summary'] })
    qc.invalidateQueries({ queryKey: ['dashboard'] }); qc.invalidateQueries({ queryKey: ['payments'] }); qc.invalidateQueries({ queryKey: ['payments-summary'] })
  }
  // WhatsApp must open inside the click, before the network round trip (popup blockers)
  const sendWhatsApp = async () => {
    const popup = openPendingWindow()
    setSending('whatsapp')
    try {
      const r = await sendToWhatsApp(Number(id), popup)
      if (r.opened) toast.success(`WhatsApp opened for ${r.info.customer_name}`)
      else toast.warning('Your browser blocked the WhatsApp window — allow pop-ups for this site and try again.')
    } catch (e) { toast.error(e instanceof ApiError ? e.message : 'Could not prepare the WhatsApp message.') }
    finally { setSending(null) }
  }
  const sendEmail = async () => {
    setSending('email')
    try { const r = await sendToEmail(Number(id)); toast.success(`Invoice emailed to ${r.sent_to}`) }
    catch (e) { toast.error(e instanceof ApiError ? e.message : 'Could not send the email.') }
    finally { setSending(null) }
  }

  if (inv.isLoading) return <PageLoader />
  if (inv.isError || !inv.data) return <div className="card p-10 text-center text-muted">Invoice not found. <Link to="/invoices" className="font-semibold text-brand-ink">Back to invoices</Link></div>
  const d = inv.data
  const draft = d.stored_status === 'draft'
  const cancelled = d.stored_status === 'cancelled'
  const payable = ['sent', 'partial'].includes(d.stored_status)
  const balance = Number(d.balance_due)
  const pdf = `/api/invoices/${d.id}/pdf/`
  const toRecord = (p: Payment): PaymentRecord => ({
    ...p, invoice: d.id, invoice_number: d.invoice_number ?? '', invoice_status: d.status, invoice_total: d.grand_total,
    invoice_paid: d.amount_paid, invoice_balance: d.balance_due, customer_name: d.customer_name,
  })

  return (
    <>
      <Link to="/invoices" className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-brand-ink"><ArrowLeft className="size-4" />All invoices</Link>
      <div className="mb-7 flex flex-wrap items-center gap-4">
        <h1 className="font-display text-[26px] font-extrabold tracking-tight text-ink">{d.invoice_number ?? `Draft #${d.id}`}</h1>
        <StatusBadge status={d.status} className="!px-3 !py-1.5 !text-[13px]" />
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-[1fr_360px]">
        <Paper d={d} />

        <aside className="space-y-5 xl:sticky xl:top-24">
          <div className="card overflow-hidden">
            <div className={clsx('px-6 py-5', cancelled ? 'bg-[var(--neutral-soft)]' : d.status === 'paid' ? 'bg-good-soft' : d.status === 'overdue' ? 'bg-crit-soft' : 'bg-brand-soft')}>
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">{draft ? 'Total (draft)' : d.status === 'paid' ? 'Fully paid' : 'Balance due'}</p>
              <p className="mt-1 font-display text-4xl font-extrabold tracking-tight text-ink">{inr(draft || d.status === 'paid' ? d.grand_total : d.balance_due)}</p>
              {!draft && d.status !== 'paid' && Number(d.amount_paid) > 0 && <p className="mt-1 text-[13px] text-ink-2">{inr(d.amount_paid)} of {inr(d.grand_total)} received</p>}
              {payable && <p className={clsx('mt-1 text-[13px] font-semibold', d.status === 'overdue' ? 'text-crit-ink' : 'text-ink-2')}>Due {fmtDate(d.due_date)}</p>}
            </div>
            <div className="space-y-3 p-5">
              {draft && (<>
                <Button className="w-full" size="lg" onClick={() => setConfirm('finalize')} icon={<Send className="size-[18px]" />}>Finalize invoice</Button>
                <Button className="w-full" variant="secondary" onClick={() => navigate(`/invoices/${d.id}/edit`)} icon={<Pencil className="size-4" />}>Edit draft</Button>
                <Button className="w-full" variant="ghost" onClick={() => setConfirm('delete')} icon={<Trash2 className="size-4" />}>Delete draft</Button>
                <p className="flex gap-2 text-xs leading-relaxed text-muted"><Lock className="mt-0.5 size-3.5 shrink-0" />PDF download unlocks once the invoice is finalized.</p>
              </>)}
              {payable && (<>
                <Button className="w-full" size="lg" onClick={() => setPayOpen(true)} icon={<Wallet className="size-[18px]" />}>Record payment</Button>
              </>)}
              {!draft && (<div className="grid grid-cols-2 gap-3">
                <a href={pdf} download><Button className="w-full" variant={payable ? 'secondary' : 'primary'} icon={<Download className="size-4" />}>PDF</Button></a>
                <a href={`${pdf}?inline=1`} target="_blank" rel="noreferrer"><Button className="w-full" variant="secondary" icon={<Eye className="size-4" />}>Preview</Button></a>
              </div>)}
              {!draft && !cancelled && (<div className="space-y-2.5 rounded-2xl border border-line bg-surface-2 p-3">
                <p className="px-1 text-[11px] font-bold uppercase tracking-[0.12em] text-muted">Send to {d.customer_name}</p>
                <Button className="w-full" variant="whatsapp" onClick={sendWhatsApp} loading={sending === 'whatsapp'} disabled={!!sending} icon={<MessageCircle className="size-[18px]" />}>Send to WhatsApp</Button>
                <Button className="w-full" variant="secondary" onClick={sendEmail} loading={sending === 'email'} disabled={!!sending} icon={<Mail className="size-[18px]" />}>Send to Email</Button>
              </div>)}
              {!draft && !cancelled && <Button className="w-full" variant="ghost" onClick={() => setConfirm('cancel')} icon={<Ban className="size-4" />}>Cancel invoice</Button>}
            </div>
          </div>

          {d.payments.length > 0 && (
            <div className="card p-5">
              <div className="flex items-center justify-between gap-3"><h3 className="font-display text-[15px] font-bold text-ink">Payment details</h3>
                <Link to={`/payments?q=${encodeURIComponent(d.invoice_number ?? '')}`} className="text-[13px] font-bold text-brand-ink hover:underline">All payments →</Link></div>
              <ul className="mt-4 space-y-3">
                {d.payments.map((p) => (
                  <li key={p.id} className="flex items-center gap-3 rounded-xl bg-surface-2 p-3">
                    <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-good-soft text-good-ink"><CircleDollarSign className="size-[18px]" /></span>
                    <div className="min-w-0 flex-1"><p className="num text-sm font-bold text-ink">{inr(p.amount)}</p><p className="truncate text-xs text-muted">{p.receipt_number} · {fmtDate(p.payment_date)} · {p.mode_label}</p></div>
                    <div className="flex shrink-0 items-center">
                      <IconButton label="View details" onClick={() => setViewing(toRecord(p))} className="!size-8"><Eye className="size-4" /></IconButton>
                      <IconButton label="Edit payment" onClick={() => setEditingPay(toRecord(p))} className="!size-8"><Pencil className="size-4" /></IconButton>
                      <a href={receiptHref(p.id)} download aria-label="Generate receipt" title="Generate receipt" className="inline-grid size-8 place-items-center rounded-lg text-ink-2 transition-colors hover:bg-brand-soft hover:text-brand-ink"><Download className="size-4" /></a>
                      <IconButton label="Delete payment" onClick={() => setUndoing(toRecord(p))} className="!size-8 hover:!bg-crit-soft hover:!text-crit-ink"><Trash2 className="size-4" /></IconButton>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="card p-5">
            <h3 className="font-display text-[15px] font-bold text-ink">Details</h3>
            <dl className="mt-4 space-y-2.5 text-sm">
              {[['Invoice date', fmtDate(d.invoice_date)], ['Due date', fmtDate(d.due_date)], ['Supply type', d.supply_type === 'intrastate' ? 'Intra-state (CGST + SGST)' : d.supply_type === 'interstate' ? 'Inter-state (IGST)' : 'Export / SEZ (zero-rated)'], ['Place of supply', d.place_of_supply_name], ['Financial year', d.financial_year || '—'], ['Finalized', fmtDateTime(d.finalized_at)]].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4"><dt className="text-muted">{k}</dt><dd className="text-right font-semibold text-ink-2">{v}</dd></div>
              ))}
            </dl>
          </div>
        </aside>
      </div>

      <PaymentDetailsModal payment={viewing} onClose={() => setViewing(null)} onEdit={(p) => { setViewing(null); setEditingPay(p) }} />
      <EditPaymentModal payment={editingPay} onClose={() => setEditingPay(null)} onSaved={() => { setEditingPay(null); refreshAfterPaymentChange() }} />
      <UndoPaymentDialog payment={undoing} onClose={() => setUndoing(null)} onDone={() => { setUndoing(null); refreshAfterPaymentChange() }} />
      <PaymentModal open={payOpen} onClose={() => setPayOpen(false)} invoice={d} onDone={(x) => { refresh(x); setPayOpen(false) }} />
      <ConfirmDialog open={confirm === 'finalize'} onClose={() => setConfirm(null)} onConfirm={() => act.mutate('finalize')} loading={act.isPending} title="Finalize this invoice?" confirmLabel="Finalize & lock"
        message="An invoice number will be assigned and the invoice will be locked. You can still download the PDF and record payments." />
      <ConfirmDialog open={confirm === 'cancel'} onClose={() => setConfirm(null)} onConfirm={() => act.mutate('cancel')} loading={act.isPending} danger title="Cancel this invoice?" confirmLabel="Cancel invoice"
        message="The invoice number is kept for your records, but it will no longer count towards revenue or receivables. This can't be undone." />
      <ConfirmDialog open={confirm === 'delete'} onClose={() => setConfirm(null)} onConfirm={() => remove.mutate()} loading={remove.isPending} danger title="Delete this draft?" confirmLabel="Delete draft" message="The draft will be permanently removed. No invoice number has been used." />
    </>
  )
}

/* ------------------------------------------------------------------ payment modal */
function PaymentModal({ open, onClose, invoice, onDone }: { open: boolean; onClose: () => void; invoice: InvoiceDetail; onDone: (d: InvoiceDetail) => void }) {
  const balance = invoice.balance_due
  const [amount, setAmount] = useState(balance)
  const [date, setDate] = useState(todayISO())
  const [mode, setMode] = useState<string>('upi')
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (open) { setAmount(balance); setDate(todayISO()); setReference(''); setNotes(''); setError('') } }, [open, balance])
  const isFull = Number(amount) === Number(balance)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!(Number(amount) > 0)) return setError('Enter an amount greater than zero.')
    setBusy(true); setError('')
    try {
      const d = await post<InvoiceDetail>(`/api/invoices/${invoice.id}/payments/`, { amount, payment_date: date, mode, reference, notes })
      toast.success(d.status === 'paid' ? 'Invoice marked as paid 🎉' : 'Partial payment recorded')
      onDone(d)
    } catch (err) { setError(err instanceof ApiError ? (err.fieldErrors.amount ?? err.message) : 'Could not record the payment.') }
    finally { setBusy(false) }
  }
  return (
    <Modal open={open} onClose={onClose} title="Record payment" subtitle={`${invoice.invoice_number} · ${invoice.customer_name}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={busy}>{isFull ? 'Mark as paid' : 'Record partial payment'}</Button></>}>
      <form onSubmit={submit} noValidate className="space-y-5">
        <Field label="Amount received" error={error} hint={<>Outstanding balance: <b className="num text-ink-2">{inr(balance)}</b></>}>
          <TextInput value={amount} onChange={(e) => { setAmount(e.target.value.replace(/[^\d.]/g, '')); setError('') }} inputMode="decimal" left="₹" className="num !text-lg !font-bold" invalid={!!error} autoFocus />
          <div className="mt-2.5 flex gap-2">
            <button type="button" onClick={() => setAmount(balance)} className={clsx('rounded-lg px-3 py-1.5 text-xs font-bold transition', isFull ? 'bg-brand text-white' : 'bg-brand-soft text-brand-ink hover:brightness-95')}>Full balance</button>
            <button type="button" onClick={() => setAmount((Number(balance) / 2).toFixed(2))} className="rounded-lg bg-brand-soft px-3 py-1.5 text-xs font-bold text-brand-ink hover:brightness-95">Half</button>
          </div>
        </Field>
        <div>
          <p className="mb-1.5 text-[13px] font-semibold text-ink-2">Payment mode</p>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4" role="radiogroup" aria-label="Payment mode">
            {MODES.map(({ code, label, icon: Icon }) => (
              <button key={code} type="button" role="radio" aria-checked={mode === code} onClick={() => setMode(code)}
                className={clsx('flex flex-col items-center gap-2 rounded-xl border-2 px-2 py-3.5 text-xs font-bold transition', mode === code ? 'border-brand bg-brand-soft text-brand-ink' : 'border-line text-ink-2 hover:border-brand/40')}><Icon className="size-5" />{label}</button>
            ))}
          </div>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Payment date"><input type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} className={clsx(inputCls, 'h-11')} /></Field>
          <Field label="Reference" hint="UPI ref / cheque no. / txn id"><TextInput value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Optional" /></Field>
        </div>
        <Field label="Notes"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" /></Field>
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  )
}

/* ------------------------------------------------------------------ the invoice "paper" */
function Paper({ d }: { d: InvoiceDetail }) {
  const from = d.bill_from
  const to = d.bill_to
  const intra = d.supply_type === 'intrastate'
  const hasDiscount = d.items.some((it) => Number(it.discount_amount) > 0)
  const stamp = d.stored_status === 'cancelled' ? ['CANCELLED', 'text-[#d03b3b] border-[#d03b3b]'] : d.stored_status === 'draft' ? ['DRAFT', 'text-[#8380a6] border-[#8380a6]'] : d.status === 'paid' ? ['PAID', 'text-[#0ca30c] border-[#0ca30c]'] : null

  return (
    <motion.article initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} className="relative overflow-hidden rounded-2xl bg-white text-[#1e1b3a] shadow-[var(--shadow-pop)] ring-1 ring-black/5">
      <div className="h-1.5 gradient-brand" />
      {stamp && <div className={clsx('pointer-events-none absolute right-8 top-40 z-10 -rotate-[14deg] rounded-lg border-4 px-5 py-1 font-display text-4xl font-extrabold tracking-[0.15em] opacity-25', stamp[1])}>{stamp[0]}</div>}
      <div className="p-5 sm:p-8">
        <header className="flex flex-wrap items-start justify-between gap-6 border-b-2 border-[#e8e6f6] pb-6">
          <div>
            {from.logo_url && <img src={from.logo_url} alt="" className="mb-3 max-h-14 max-w-40 object-contain" />}
            <h2 className="font-display text-xl font-extrabold">{from.business_name}</h2>
            <p className="mt-1 text-[13px] leading-relaxed text-[#6b6890]">{from.address_line1}{from.address_line2 ? `, ${from.address_line2}` : ''}<br />{from.city}, {from.state_name} – {from.pincode}<br />{from.phone}{from.email ? ` · ${from.email}` : ''}</p>
            <p className="mt-2 text-[13px]"><b>GSTIN:</b> <span className="num">{from.gstin || '—'}</span>{from.pan ? <> &nbsp;·&nbsp; <b>PAN:</b> <span className="num">{from.pan}</span></> : null}</p>
          </div>
          <div className="text-right"><p className="font-display text-3xl font-extrabold tracking-wide text-[#4f3fe0]">TAX INVOICE</p>
            <p className="mt-1 text-xs text-[#6b6890]">{d.supply_type === 'export' ? 'Export / SEZ — zero-rated supply' : intra ? 'Intra-state supply' : 'Inter-state supply'}</p></div>
        </header>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-[#dcd9f5] p-4">
            <p className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-[#6b6890]">Bill to</p>
            <p className="mt-1 font-display text-base font-bold">{to.name}</p>
            <p className="mt-0.5 text-[13px] leading-relaxed text-[#6b6890]">{to.address ? <>{to.address}<br /></> : null}{to.city ? `${to.city}, ` : ''}{to.state_name}{to.pincode ? ` – ${to.pincode}` : ''}</p>
            <p className="mt-1.5 text-[13px]">{to.gstin ? <><b>GSTIN:</b> <span className="num">{to.gstin}</span></> : <span className="text-[#6b6890]">Unregistered (B2C)</span>}{to.phone ? <span className="text-[#6b6890]"> · {to.phone}</span> : null}</p>
          </div>
          <div className="rounded-xl border border-[#dcd9f5] p-4">
            <p className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-[#6b6890]">Invoice details</p>
            <dl className="mt-2 space-y-1 text-[13px]">
              {[['Invoice no.', d.invoice_number ?? 'Assigned on finalize'], ['Invoice date', fmtDate(d.invoice_date)], ['Due date', fmtDate(d.due_date)], ['Place of supply', `${d.place_of_supply_name} (${d.place_of_supply})`], ['Reverse charge', 'No']].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4"><dt className="text-[#6b6890]">{k}</dt><dd className="num text-right font-semibold">{v}</dd></div>
              ))}
            </dl>
          </div>
        </div>

        <div className="mt-6 overflow-x-auto scroll-thin rounded-xl border border-[#e8e6f6]">
          <table className="w-full text-[12.5px]">
            <thead><tr className="bg-[#4f3fe0] text-[10px] font-bold uppercase tracking-wider text-white">
              <th className="w-8 py-2.5 pl-3 text-left">#</th><th className="px-2 text-left">Item</th><th className="px-2 text-right">Qty</th><th className="px-2 text-right">Rate</th>
              {hasDiscount && <th className="px-2 text-right">Disc.</th>}<th className="px-2 text-right">Taxable</th><th className="px-2 text-right">GST</th><th className="py-2.5 pl-2 pr-3 text-right">Amount</th>
            </tr></thead>
            <tbody>
              {d.items.map((it, i) => (
                <tr key={i} className="border-t border-[#efedfb] align-top even:bg-[#faf9ff]">
                  <td className="py-3 pl-3 text-[#6b6890]">{i + 1}</td>
                  <td className="min-w-32 px-2 py-3"><p className="font-semibold leading-snug">{it.item_name}</p>
                    <p className="text-[11px] text-[#6b6890]">{it.hsn_sac_code ? `HSN/SAC ${it.hsn_sac_code}` : ''}{it.hsn_sac_code && it.description ? ' · ' : ''}{it.description}</p></td>
                  <td className="num whitespace-nowrap px-2 py-3 text-right">{trimZero(it.quantity)} <span className="text-[#6b6890]">{it.unit}</span></td>
                  <td className="num whitespace-nowrap px-2 py-3 text-right">{inrPlain(it.unit_price)}</td>
                  {hasDiscount && <td className="num whitespace-nowrap px-2 py-3 text-right">{Number(it.discount_amount) ? <>{inrPlain(it.discount_amount)}<span className="block text-[10.5px] text-[#6b6890]">({trimZero(it.discount_percent)}%)</span></> : '—'}</td>}
                  <td className="num whitespace-nowrap px-2 py-3 text-right">{inrPlain(it.taxable_amount)}</td>
                  <td className="num whitespace-nowrap px-2 py-3 text-right">{trimZero(it.gst_rate)}%</td>
                  <td className="num whitespace-nowrap py-3 pl-2 pr-3 text-right font-bold">{inrPlain(it.line_total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-6 grid gap-6 md:grid-cols-2">
          <div className="space-y-4 text-[13px]">
            <div className="rounded-xl bg-[#f3f1ff] p-3.5"><p className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-[#6b6890]">Amount in words</p><p className="mt-1 font-bold text-[#4f3fe0]">{d.amount_in_words}</p></div>
            {(from.bank_name || from.account_number) && (
              <div><p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-[0.14em] text-[#6b6890]">Bank details</p>
                <dl className="space-y-1">{[['A/c holder', from.account_holder_name], ['Bank', from.bank_name], ['A/c number', from.account_number], ['IFSC', from.ifsc_code]].filter(([, v]) => v).map(([k, v]) => <div key={k} className="flex gap-4"><dt className="w-20 text-[#6b6890]">{k}</dt><dd className="num font-semibold">{v}</dd></div>)}</dl></div>
            )}
            {d.notes && <div><p className="mb-1 text-[10.5px] font-bold uppercase tracking-[0.14em] text-[#6b6890]">Notes</p><p className="whitespace-pre-line">{d.notes}</p></div>}
            {d.terms && <div><p className="mb-1 text-[10.5px] font-bold uppercase tracking-[0.14em] text-[#6b6890]">Terms & conditions</p><p className="whitespace-pre-line text-[#6b6890]">{d.terms}</p></div>}
          </div>
          <div>
            <dl className="space-y-2.5 text-sm">
              <Tot k="Subtotal" v={d.subtotal} />
              {Number(d.discount_total) > 0 && <Tot k="Discount" v={`-${d.discount_total}`} />}
              <Tot k="Taxable amount" v={d.taxable_amount} />
              <Tot k="CGST" v={d.cgst_amount} /><Tot k="SGST" v={d.sgst_amount} /><Tot k="IGST" v={d.igst_amount} />
              {Number(d.round_off) !== 0 && <Tot k="Round off" v={`${Number(d.round_off) > 0 ? '+' : '-'}${Math.abs(Number(d.round_off))}`} />}
              <div className="flex items-baseline justify-between border-t-2 border-[#4f3fe0] pt-3"><dt className="font-display text-lg font-extrabold text-[#4f3fe0]">Grand total</dt><dd className="font-display text-2xl font-extrabold text-[#4f3fe0]">{inr(d.grand_total)}</dd></div>
              {Number(d.amount_paid) > 0 && (<><Tot k="Amount paid" v={d.amount_paid} green /><Tot k="Balance due" v={d.balance_due} bold /></>)}
            </dl>
            <div className="mt-10 text-right"><div className="ml-auto inline-block w-48 border-t border-[#1e1b3a] pt-1.5 text-xs text-[#6b6890]">Authorised signatory<br /><b className="text-[#1e1b3a]">{from.business_name}</b></div></div>
          </div>
        </div>
      </div>
    </motion.article>
  )
}
const Tot = ({ k, v, green, bold }: { k: string; v: string; green?: boolean; bold?: boolean }) => (
  <div className={clsx('flex justify-between', green && 'text-[#0f8a5f]', bold && 'font-extrabold')}><dt className={clsx(!green && !bold && 'text-[#6b6890]')}>{k}</dt><dd className="num font-semibold">{Number(v) < 0 ? '− ' : ''}{inr(Math.abs(Number(v)))}</dd></div>
)
