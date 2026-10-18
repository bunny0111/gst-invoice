import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Building2, Pencil, Plus, RotateCcw, Trash2, UserRound, Users } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Avatar, EmptyState, PageHeader, Pagination, Skeleton, UpgradePrompt } from '@/components/ui/Bits'
import { Button, IconButton } from '@/components/ui/Button'
import { Field, Select, SearchInput, Textarea, TextInput } from '@/components/ui/Form'
import { ConfirmDialog, Modal } from '@/components/ui/Modal'
import { ApiError, del, get, patch, post, qs } from '@/lib/api'
import { useDebounce, useMeta, useRefreshUsage, useSubscription } from '@/lib/hooks'
import type { Customer, Paginated } from '@/lib/types'

const empty = { name: '', customer_type: 'b2c' as 'b2b' | 'b2c', gstin: '', state: '', phone: '', email: '', address: '', city: '', pincode: '' }

export default function Customers() {
  const qc = useQueryClient()
  const refreshUsage = useRefreshUsage()
  const sub = useSubscription().data
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<'active' | 'inactive' | 'all'>('active')
  const [page, setPage] = useState(1)
  const dq = useDebounce(q)
  const [editing, setEditing] = useState<Customer | 'new' | null>(null)
  const [removing, setRemoving] = useState<Customer | null>(null)

  useEffect(() => setPage(1), [dq, status])
  const list = useQuery({
    queryKey: ['customers', dq, status, page],
    queryFn: () => get<Paginated<Customer>>(`/api/customers/${qs({ q: dq, status, page })}`),
    placeholderData: keepPreviousData,
  })

  const limit = sub?.limits.customers ?? null
  const used = sub?.usage.customers ?? 0
  const atLimit = limit !== null && used >= limit

  const refresh = () => { qc.invalidateQueries({ queryKey: ['customers'] }); refreshUsage() }
  const remove = useMutation({
    mutationFn: (c: Customer) => del(`/api/customers/${c.id}/`),
    onSuccess: () => { toast.success('Customer removed'); setRemoving(null); refresh() },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not remove customer'),
  })
  const restore = useMutation({
    mutationFn: (c: Customer) => post(`/api/customers/${c.id}/restore/`),
    onSuccess: () => { toast.success('Customer restored'); refresh() },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not restore customer'),
  })

  const rows = list.data?.results ?? []
  return (
    <>
      <PageHeader
        title="Customers"
        subtitle={sub ? `${used}${limit !== null ? ` of ${limit}` : ''} customers on your ${sub.plan_name} plan` : 'Your customer database'}
        actions={<Button onClick={() => setEditing('new')} disabled={atLimit} icon={<Plus className="size-[18px]" strokeWidth={2.6} />}>Add customer</Button>}
      />
      {atLimit && sub && limit !== null && <div className="mb-6"><UpgradePrompt resource="customers" limit={limit} plans={sub.plans} planName={sub.plan_name} /></div>}

      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-line p-4">
          <SearchInput value={q} onChange={setQ} placeholder="Search by name, GSTIN or phone" className="min-w-64 flex-1" />
          <Select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className="!w-40" aria-label="Filter by status">
            <option value="active">Active</option><option value="inactive">Removed</option><option value="all">All</option>
          </Select>
        </div>

        {list.isLoading ? (
          <div className="space-y-3 p-5">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
        ) : rows.length === 0 ? (
          <EmptyState icon={<Users className="size-8" />} title={dq ? 'No matching customers' : 'No customers yet'} message={dq ? 'Try a different name, GSTIN or phone number.' : 'Add your first customer — their state decides whether CGST + SGST or IGST applies on invoices.'}
            action={!dq && !atLimit && <Button onClick={() => setEditing('new')} icon={<Plus className="size-4" />}>Add your first customer</Button>} />
        ) : (
          <div className={clsx('overflow-x-auto scroll-thin transition-opacity', list.isPlaceholderData && 'opacity-60')}>
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead><tr className="border-b border-line bg-surface-2 text-[11.5px] font-bold uppercase tracking-wider text-muted">
                <th className="px-5 py-3.5">Customer</th><th className="px-3">GSTIN</th><th className="px-3">State</th><th className="px-3">Phone</th><th className="px-3 text-right">Invoices</th><th className="px-5" />
              </tr></thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} className={clsx('group border-b border-line last:border-0 transition-colors hover:bg-surface-2 hover:shadow-[inset_3px_0_0_var(--brand)]', !c.is_active && 'opacity-60')}>
                    <td className="px-5 py-3.5"><div className="flex items-center gap-3"><Avatar name={c.name} /><div className="min-w-0"><p className="truncate font-semibold text-ink">{c.name}</p><p className="truncate text-xs text-muted">{c.email || c.city || '—'}</p></div></div></td>
                    <td className="px-3"><div className="flex flex-col items-start gap-1">
                      {c.customer_type === 'b2b'
                        ? <span className="inline-flex items-center gap-1.5 rounded-md bg-info-soft px-2 py-1 text-xs font-semibold text-info-ink"><Building2 className="size-3" />B2B</span>
                        : <span className="inline-flex items-center gap-1.5 rounded-md bg-[var(--neutral-soft)] px-2 py-1 text-xs font-semibold text-[var(--neutral-ink)]"><UserRound className="size-3" />B2C</span>}
                      {c.gstin && <span className="num text-[11.5px] text-muted">{c.gstin}</span>}
                    </div></td>
                    <td className="px-3 text-ink-2">{c.state_name}</td>
                    <td className="num px-3 text-ink-2">{c.phone || '—'}</td>
                    <td className="num px-3 text-right font-semibold text-ink-2">{c.invoice_count}</td>
                    <td className="px-5"><div className="flex justify-end gap-0.5 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                      {c.is_active ? (<><IconButton label="Edit customer" onClick={() => setEditing(c)}><Pencil className="size-4" /></IconButton><IconButton label="Remove customer" onClick={() => setRemoving(c)} className="hover:!bg-crit-soft hover:!text-crit-ink"><Trash2 className="size-4" /></IconButton></>)
                        : <IconButton label="Restore customer" onClick={() => restore.mutate(c)}><RotateCcw className="size-4" /></IconButton>}
                    </div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {list.data && <Pagination page={page} count={list.data.count} onPage={setPage} />}
      </div>

      <CustomerModal customer={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh() }} />
      <ConfirmDialog open={!!removing} onClose={() => setRemoving(null)} danger loading={remove.isPending} confirmLabel="Remove customer"
        onConfirm={() => removing && remove.mutate(removing)} title="Remove this customer?"
        message={<>{removing?.name} will be hidden from your customer list{removing?.invoice_count ? ', but their existing invoices stay exactly as they are' : ''}. You can restore them later.</>} />
    </>
  )
}

export function CustomerModal({ customer, onClose, onSaved }: { customer: Customer | 'new' | null; onClose: () => void; onSaved: (c: Customer) => void }) {
  const meta = useMeta().data
  const [f, setF] = useState(empty)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const isNew = customer === 'new'

  useEffect(() => {
    if (!customer) return
    setErrors({})
    setF(customer === 'new' ? empty : { name: customer.name, customer_type: customer.customer_type ?? (customer.gstin ? 'b2b' : 'b2c'), gstin: customer.gstin, state: customer.state, phone: customer.phone, email: customer.email, address: customer.address, city: customer.city, pincode: customer.pincode })
  }, [customer])

  const set = (k: keyof typeof empty) => (e: { target: { value: string } }) => { setF((p) => ({ ...p, [k]: e.target.value })); setErrors((p) => ({ ...p, [k]: '' })) }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const errs: Record<string, string> = {}
    if (!f.name.trim()) errs.name = 'Customer name is required.'
    if (!f.state) errs.state = 'Select the customer\'s state — it decides CGST/SGST vs IGST.'
    if (!f.phone.trim()) errs.phone = 'Phone number is required.'
    if (f.customer_type === 'b2b' && !f.gstin.trim()) errs.gstin = 'GST number is required for B2B customers.'
    else if (f.gstin.trim() && f.gstin.trim().length !== 15) errs.gstin = 'GST number must be exactly 15 letters/digits.'
    setErrors(errs)
    if (Object.keys(errs).length) return
    setBusy(true)
    try {
      const saved = isNew ? await post<Customer>('/api/customers/', f) : await patch<Customer>(`/api/customers/${(customer as Customer).id}/`, f)
      toast.success(isNew ? 'Customer added' : 'Customer updated')
      onSaved(saved)
    } catch (err) {
      if (err instanceof ApiError) { setErrors(err.fieldErrors); if (!Object.keys(err.fieldErrors).length) toast.error(err.message) }
    } finally { setBusy(false) }
  }

  return (
    <Modal open={!!customer} onClose={onClose} title={isNew ? 'Add customer' : 'Edit customer'} subtitle="Their state decides whether CGST + SGST or IGST is applied." size="lg"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={busy}>{isNew ? 'Add customer' : 'Save changes'}</Button></>}>
      <form onSubmit={submit} noValidate className="grid gap-5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <p className="mb-1.5 text-[13px] font-semibold text-ink-2">Customer type</p>
          <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label="Customer type">
            {([['b2b', 'B2B', 'GST-registered business', Building2], ['b2c', 'B2C', 'Individual / unregistered', UserRound]] as const).map(([v, label, sub, Icon]) => (
              <button key={v} type="button" role="radio" aria-checked={f.customer_type === v}
                onClick={() => { setF((p) => ({ ...p, customer_type: v })); setErrors((p) => ({ ...p, gstin: '' })) }}
                className={clsx('flex items-center gap-3 rounded-xl border-2 px-4 py-3 text-left transition', f.customer_type === v ? 'border-brand bg-brand-soft text-brand-ink' : 'border-line text-ink-2 hover:border-brand/40')}>
                <Icon className="size-5 shrink-0" /><span><span className="block text-sm font-bold">{label}</span><span className="block text-xs font-normal text-muted">{sub}</span></span>
              </button>
            ))}
          </div>
        </div>
        <Field label="Name" required error={errors.name} className="sm:col-span-2"><TextInput autoFocus value={f.name} onChange={set('name')} placeholder="Customer or company name" invalid={!!errors.name} /></Field>
        <Field label="GST number" required={f.customer_type === 'b2b'} error={errors.gstin} hint={f.customer_type === 'b2b' ? 'Required for B2B customers' : 'Optional for B2C customers'}><TextInput value={f.gstin} onChange={(e) => set('gstin')({ target: { value: e.target.value.toUpperCase() } })} maxLength={15} placeholder="15-character GSTIN" className="num uppercase" invalid={!!errors.gstin} /></Field>
        <Field label="State" required error={errors.state}><Select value={f.state} onChange={set('state')} invalid={!!errors.state}><option value="">Select state…</option>{meta?.states.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}</Select></Field>
        <Field label="Phone" required error={errors.phone} hint="Used to send invoices on WhatsApp"><TextInput value={f.phone} onChange={set('phone')} inputMode="tel" placeholder="98765 43210" invalid={!!errors.phone} /></Field>
        <Field label="Email" error={errors.email} hint="Optional — needed only to email invoices"><TextInput type="email" value={f.email} onChange={set('email')} placeholder="name@company.com" invalid={!!errors.email} /></Field>
        <Field label="Address" className="sm:col-span-2" error={errors.address}><Textarea rows={2} value={f.address} onChange={set('address')} placeholder="Street address" /></Field>
        <Field label="City" error={errors.city}><TextInput value={f.city} onChange={set('city')} /></Field>
        <Field label="Pincode" error={errors.pincode}><TextInput value={f.pincode} onChange={set('pincode')} inputMode="numeric" maxLength={6} className="num" invalid={!!errors.pincode} /></Field>
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  )
}
