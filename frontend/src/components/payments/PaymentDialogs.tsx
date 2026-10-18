import { useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Banknote, Download, ExternalLink, Landmark, ReceiptText, Smartphone } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { StatusBadge } from '@/components/ui/Bits'
import { Button } from '@/components/ui/Button'
import { Field, Textarea, TextInput, inputCls } from '@/components/ui/Form'
import { ConfirmDialog, Modal } from '@/components/ui/Modal'
import { ApiError, del, patch } from '@/lib/api'
import { fmtDate, fmtDateTime, inr, todayISO } from '@/lib/format'
import type { PaymentRecord } from '@/lib/types'

export const MODES = [
  { code: 'cash', label: 'Cash', icon: Banknote },
  { code: 'upi', label: 'UPI', icon: Smartphone },
  { code: 'bank_transfer', label: 'Bank transfer', icon: Landmark },
  { code: 'cheque', label: 'Cheque', icon: ReceiptText },
] as const

export const receiptHref = (id: number, inline = false) => `/api/payments/${id}/receipt/${inline ? '?inline=1' : ''}`

/** Everything that depends on payments - call after an edit / undo so lists, balances and the dashboard refresh. */
export function useRefreshPayments() {
  const qc = useQueryClient()
  return () => {
    for (const key of ['payments', 'payments-summary', 'invoices', 'invoice-summary', 'invoice', 'dashboard']) qc.invalidateQueries({ queryKey: [key] })
  }
}

/* ------------------------------------------------------------------ view details */
export function PaymentDetailsModal({ payment, onClose, onEdit }: { payment: PaymentRecord | null; onClose: () => void; onEdit?: (p: PaymentRecord) => void }) {
  const p = payment
  return (
    <Modal open={!!p} onClose={onClose} title="Payment details" subtitle={p ? `${p.receipt_number} · ${p.customer_name}` : undefined}
      footer={p && <>
        {onEdit && <Button variant="secondary" onClick={() => onEdit(p)}>Edit payment</Button>}
        <a href={receiptHref(p.id)} download><Button icon={<Download className="size-4" />}>Generate receipt</Button></a>
      </>}>
      {p && (
        <div className="space-y-5">
          <div className="rounded-2xl bg-good-soft p-5">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-good-ink">Amount received</p>
            <p className="num mt-1 font-display text-4xl font-extrabold tracking-tight text-ink">{inr(p.amount)}</p>
          </div>
          <dl className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
            {([
              ['Receipt no.', p.receipt_number], ['Payment date', fmtDate(p.payment_date)], ['Payment mode', p.mode_label],
              ['Reference', p.reference || '—'], ['Customer', p.customer_name], ['Recorded on', fmtDateTime(p.created_at)],
            ] as const).map(([k, v]) => <div key={k}><dt className="text-xs font-semibold uppercase tracking-wider text-muted">{k}</dt><dd className="num mt-0.5 font-semibold text-ink">{v}</dd></div>)}
            {p.notes && <div className="sm:col-span-2"><dt className="text-xs font-semibold uppercase tracking-wider text-muted">Notes</dt><dd className="mt-0.5 text-ink-2">{p.notes}</dd></div>}
          </dl>
          <div className="rounded-2xl border border-line bg-surface-2 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-bold uppercase tracking-wider text-muted">Against invoice</p>
              <StatusBadge status={p.invoice_status} />
            </div>
            <Link to={`/invoices/${p.invoice}`} onClick={onClose} className="num mt-1 inline-flex items-center gap-1.5 font-display text-lg font-extrabold text-brand-ink hover:underline">{p.invoice_number}<ExternalLink className="size-4" /></Link>
            <dl className="mt-3 grid grid-cols-3 gap-3 text-sm">
              {([['Invoice total', p.invoice_total], ['Received so far', p.invoice_paid], ['Balance due', p.invoice_balance]] as const).map(([k, v]) => <div key={k}><dt className="text-xs text-muted">{k}</dt><dd className="num font-bold text-ink">{inr(v)}</dd></div>)}
            </dl>
          </div>
        </div>
      )}
    </Modal>
  )
}

/* ------------------------------------------------------------------ edit */
export function EditPaymentModal({ payment, onClose, onSaved }: { payment: PaymentRecord | null; onClose: () => void; onSaved: (p: PaymentRecord) => void }) {
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(todayISO())
  const [mode, setMode] = useState('upi')
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!payment) return
    setAmount(String(Number(payment.amount))); setDate(payment.payment_date); setMode(payment.mode)
    setReference(payment.reference); setNotes(payment.notes); setError('')
  }, [payment])

  // the most this payment can be raised to without the invoice being over-paid
  const room = payment ? Number(payment.invoice_total) - (Number(payment.invoice_paid) - Number(payment.amount)) : 0

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!payment) return
    if (!(Number(amount) > 0)) return setError('Enter an amount greater than zero.')
    if (Number(amount) > room + 0.001) return setError(`This invoice can take at most ${inr(room)} in total from this payment.`)
    setBusy(true); setError('')
    try {
      const saved = await patch<PaymentRecord>(`/api/payments/${payment.id}/`, { amount, payment_date: date, mode, reference, notes })
      toast.success('Payment updated')
      onSaved(saved)
    } catch (err) { setError(err instanceof ApiError ? (err.fieldErrors.amount ?? err.message) : 'Could not save the payment.') }
    finally { setBusy(false) }
  }

  return (
    <Modal open={!!payment} onClose={onClose} title="Edit payment" subtitle={payment ? `${payment.receipt_number} · ${payment.invoice_number} · ${payment.customer_name}` : undefined}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={busy}>Save changes</Button></>}>
      <form onSubmit={submit} noValidate className="space-y-5">
        <Field label="Amount received" error={error} hint={payment && <>Invoice total {inr(payment.invoice_total)} · you can enter up to <b className="num text-ink-2">{inr(room)}</b></>}>
          <TextInput value={amount} onChange={(e) => { setAmount(e.target.value.replace(/[^\d.]/g, '')); setError('') }} inputMode="decimal" left="₹" className="num !text-lg !font-bold" invalid={!!error} autoFocus />
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

/* ------------------------------------------------------------------ undo (always confirmed first) */
export function UndoPaymentDialog({ payment, onClose, onDone }: { payment: PaymentRecord | null; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const go = async () => {
    if (!payment) return
    setBusy(true)
    try {
      await del(`/api/payments/${payment.id}/`)
      toast.success(`Payment of ${inr(payment.amount)} undone`)
      onDone()
    } catch (err) { toast.error(err instanceof ApiError ? err.message : 'Could not undo the payment.') }
    finally { setBusy(false) }
  }
  return (
    <ConfirmDialog open={!!payment} onClose={onClose} onConfirm={go} loading={busy} danger title="Undo this payment?" confirmLabel="Yes, undo payment"
      message={payment && <>
        <b className="num">{inr(payment.amount)}</b> received on {fmtDate(payment.payment_date)} via {payment.mode_label} will be removed from invoice <b>{payment.invoice_number}</b>{' '}
        ({payment.customer_name}). The invoice balance goes up by the same amount and its status is recalculated. This can't be undone — you'd have to record the payment again.
      </>} />
  )
}
