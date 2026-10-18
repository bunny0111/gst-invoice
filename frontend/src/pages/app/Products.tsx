import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Package, Pencil, Plus, RotateCcw, Trash2, Wrench } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { mobileAct, mobileActDanger } from '@/components/ui/mobile'
import { EmptyState, PageHeader, Pagination, Skeleton, UpgradePrompt } from '@/components/ui/Bits'
import { Button, IconButton } from '@/components/ui/Button'
import { Field, SearchInput, Select, Textarea, TextInput } from '@/components/ui/Form'
import { ConfirmDialog, Modal } from '@/components/ui/Modal'
import { ApiError, del, get, patch, post, qs } from '@/lib/api'
import { inr, trimZero } from '@/lib/format'
import { useDebounce, useMeta, useRefreshUsage, useSubscription } from '@/lib/hooks'
import type { Paginated, Product } from '@/lib/types'

const empty = { name: '', description: '', item_type: 'goods', hsn_sac_code: '', unit: 'pcs', selling_price: '', gst_rate: '18' }

export default function Products() {
  const qc = useQueryClient()
  const refreshUsage = useRefreshUsage()
  const sub = useSubscription().data
  const [q, setQ] = useState('')
  const [type, setType] = useState('')
  const [status, setStatus] = useState<'active' | 'inactive' | 'all'>('active')
  const [page, setPage] = useState(1)
  const dq = useDebounce(q)
  const [editing, setEditing] = useState<Product | 'new' | null>(null)
  const [removing, setRemoving] = useState<Product | null>(null)

  useEffect(() => setPage(1), [dq, type, status])
  const list = useQuery({
    queryKey: ['products', dq, type, status, page],
    queryFn: () => get<Paginated<Product>>(`/api/products/${qs({ q: dq, item_type: type, status, page })}`),
    placeholderData: keepPreviousData,
  })

  const limit = sub?.limits.products ?? null
  const used = sub?.usage.products ?? 0
  const atLimit = limit !== null && used >= limit
  const refresh = () => { qc.invalidateQueries({ queryKey: ['products'] }); refreshUsage() }

  const remove = useMutation({
    mutationFn: (p: Product) => del(`/api/products/${p.id}/`),
    onSuccess: () => { toast.success('Item removed'); setRemoving(null); refresh() },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not remove item'),
  })
  const restore = useMutation({
    mutationFn: (p: Product) => post(`/api/products/${p.id}/restore/`),
    onSuccess: () => { toast.success('Item restored'); refresh() },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not restore item'),
  })

  const rows = list.data?.results ?? []
  return (
    <>
      <PageHeader
        title="Products & services"
        subtitle={sub ? `${used}${limit !== null ? ` of ${limit}` : ''} items on your ${sub.plan_name} plan` : 'Your catalogue'}
        actions={<Button onClick={() => setEditing('new')} disabled={atLimit} icon={<Plus className="size-[18px]" strokeWidth={2.6} />}>Add item</Button>}
      />
      {atLimit && sub && limit !== null && <div className="mb-6"><UpgradePrompt resource="products" limit={limit} plans={sub.plans} planName={sub.plan_name} /></div>}

      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-line p-4">
          <SearchInput value={q} onChange={setQ} placeholder="Search name or HSN/SAC" className="w-full min-w-0 sm:min-w-64 sm:flex-1" />
          <Select value={type} onChange={(e) => setType(e.target.value)} className="!w-[calc(50%-0.375rem)] sm:!w-36" aria-label="Type"><option value="">All types</option><option value="goods">Goods</option><option value="service">Services</option></Select>
          <Select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className="!w-[calc(50%-0.375rem)] sm:!w-36" aria-label="Status"><option value="active">Active</option><option value="inactive">Removed</option><option value="all">All</option></Select>
        </div>

        {list.isLoading ? (
          <div className="space-y-3 p-5">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
        ) : rows.length === 0 ? (
          <EmptyState icon={<Package className="size-8" />} title={dq ? 'No matching items' : 'Your catalogue is empty'} message={dq ? 'Try another name or HSN/SAC code.' : 'Add what you sell once — with its HSN/SAC code and GST rate — and reuse it on every invoice.'}
            action={!dq && !atLimit && <Button onClick={() => setEditing('new')} icon={<Plus className="size-4" />}>Add your first item</Button>} />
        ) : (
          <>
          <ul className={clsx('divide-y divide-line md:hidden', list.isPlaceholderData && 'opacity-60')}>
            {rows.map((p) => (
              <li key={p.id} className={clsx('px-4 py-4', !p.is_active && 'opacity-60')}>
                <div className="flex items-start gap-3">
                  <span className={clsx('grid size-10 shrink-0 place-items-center rounded-xl', p.item_type === 'goods' ? 'bg-brand-soft text-brand' : 'bg-info-soft text-info-ink')}>{p.item_type === 'goods' ? <Package className="size-[18px]" /> : <Wrench className="size-[18px]" />}</span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-ink">{p.name}</p>
                    <p className="line-clamp-2 text-xs text-muted">{p.description || (p.item_type === 'goods' ? 'Goods' : 'Service')}</p>
                  </div>
                  <span className="num shrink-0 rounded-md bg-brand-soft px-2 py-1 text-xs font-bold text-brand-ink">{trimZero(p.gst_rate)}%</span>
                </div>
                <dl className="mt-3 grid grid-cols-3 gap-x-4 text-xs">
                  <div><dt className="text-muted">Price</dt><dd className="num font-bold text-ink">{inr(p.selling_price)}</dd></div>
                  <div><dt className="text-muted">HSN / SAC</dt><dd className="num font-medium text-ink-2">{p.hsn_sac_code || '—'}</dd></div>
                  <div><dt className="text-muted">Unit</dt><dd className="font-medium text-ink-2">{p.unit}</dd></div>
                </dl>
                <div className="mt-3 flex gap-2">
                  {p.is_active ? (<>
                    <button onClick={() => setEditing(p)} className={mobileAct}><Pencil className="size-4 shrink-0" />Edit</button>
                    <button onClick={() => setRemoving(p)} className={mobileActDanger}><Trash2 className="size-4 shrink-0" />Remove</button>
                  </>) : <button onClick={() => restore.mutate(p)} className={mobileAct}><RotateCcw className="size-4 shrink-0" />Restore</button>}
                </div>
              </li>
            ))}
          </ul>
          <div className={clsx('hidden overflow-x-auto scroll-thin transition-opacity md:block', list.isPlaceholderData && 'opacity-60')}>
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead><tr className="border-b border-line bg-surface-2 text-[11.5px] font-bold uppercase tracking-wider text-muted">
                <th className="px-5 py-3.5">Item</th><th className="px-3">HSN / SAC</th><th className="px-3">Unit</th><th className="px-3 text-right">Price</th><th className="px-3 text-right">GST</th><th className="px-5" />
              </tr></thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id} className={clsx('group border-b border-line last:border-0 transition-colors hover:bg-surface-2 hover:shadow-[inset_3px_0_0_var(--brand)]', !p.is_active && 'opacity-60')}>
                    <td className="px-5 py-3.5"><div className="flex items-center gap-3">
                      <span className={clsx('grid size-9 shrink-0 place-items-center rounded-xl', p.item_type === 'goods' ? 'bg-brand-soft text-brand' : 'bg-info-soft text-info-ink')}>{p.item_type === 'goods' ? <Package className="size-[18px]" /> : <Wrench className="size-[18px]" />}</span>
                      <div className="min-w-0"><p className="truncate font-semibold text-ink">{p.name}</p><p className="truncate text-xs text-muted">{p.description || (p.item_type === 'goods' ? 'Goods' : 'Service')}</p></div></div></td>
                    <td className="num px-3 text-ink-2">{p.hsn_sac_code || '—'}</td>
                    <td className="px-3 text-ink-2">{p.unit}</td>
                    <td className="num px-3 text-right font-semibold text-ink">{inr(p.selling_price)}</td>
                    <td className="px-3 text-right"><span className="num rounded-md bg-brand-soft px-2 py-1 text-xs font-bold text-brand-ink">{trimZero(p.gst_rate)}%</span></td>
                    <td className="px-5"><div className="flex justify-end gap-0.5 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                      {p.is_active ? (<><IconButton label="Edit item" onClick={() => setEditing(p)}><Pencil className="size-4" /></IconButton><IconButton label="Remove item" onClick={() => setRemoving(p)} className="hover:!bg-crit-soft hover:!text-crit-ink"><Trash2 className="size-4" /></IconButton></>)
                        : <IconButton label="Restore item" onClick={() => restore.mutate(p)}><RotateCcw className="size-4" /></IconButton>}
                    </div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
        {list.data && <Pagination page={page} count={list.data.count} onPage={setPage} />}
      </div>

      <ProductModal product={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh() }} />
      <ConfirmDialog open={!!removing} onClose={() => setRemoving(null)} danger loading={remove.isPending} confirmLabel="Remove item" onConfirm={() => removing && remove.mutate(removing)}
        title="Remove this item?" message={<>{removing?.name} will no longer appear in your catalogue. Past invoices keep their own copy of the price and GST rate, so they don't change.</>} />
    </>
  )
}

function ProductModal({ product, onClose, onSaved }: { product: Product | 'new' | null; onClose: () => void; onSaved: () => void }) {
  const meta = useMeta().data
  const [f, setF] = useState(empty)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const isNew = product === 'new'

  useEffect(() => {
    if (!product) return
    setErrors({})
    setF(product === 'new' ? empty : { name: product.name, description: product.description, item_type: product.item_type, hsn_sac_code: product.hsn_sac_code, unit: product.unit, selling_price: product.selling_price, gst_rate: trimZero(product.gst_rate) })
  }, [product])

  const set = (k: keyof typeof empty) => (e: { target: { value: string } }) => { setF((p) => ({ ...p, [k]: e.target.value })); setErrors((p) => ({ ...p, [k]: '' })) }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const errs: Record<string, string> = {}
    if (!f.name.trim()) errs.name = 'Name is required.'
    if (f.selling_price === '' || Number(f.selling_price) < 0) errs.selling_price = 'Enter the selling price.'
    setErrors(errs)
    if (Object.keys(errs).length) return
    setBusy(true)
    try {
      const body = { ...f, gst_rate: Number(f.gst_rate) }
      if (isNew) await post('/api/products/', body); else await patch(`/api/products/${(product as Product).id}/`, body)
      toast.success(isNew ? 'Item added' : 'Item updated')
      onSaved()
    } catch (err) {
      if (err instanceof ApiError) { setErrors(err.fieldErrors); if (!Object.keys(err.fieldErrors).length) toast.error(err.message) }
    } finally { setBusy(false) }
  }

  return (
    <Modal open={!!product} onClose={onClose} title={isNew ? 'Add product or service' : 'Edit item'} subtitle="Saved prices and GST rates are copied onto invoices — later edits never change past invoices." size="lg"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={busy}>{isNew ? 'Add item' : 'Save changes'}</Button></>}>
      <form onSubmit={submit} noValidate className="grid gap-5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <p className="mb-1.5 text-[13px] font-semibold text-ink-2">Type</p>
          <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label="Item type">
            {([['goods', 'Goods', Package], ['service', 'Service', Wrench]] as const).map(([v, l, Icon]) => (
              <button key={v} type="button" role="radio" aria-checked={f.item_type === v} onClick={() => setF((p) => ({ ...p, item_type: v }))}
                className={clsx('flex items-center justify-center gap-2.5 rounded-xl border-2 py-3 text-sm font-bold transition', f.item_type === v ? 'border-brand bg-brand-soft text-brand-ink' : 'border-line text-ink-2 hover:border-brand/40')}><Icon className="size-[18px]" />{l}</button>
            ))}
          </div>
        </div>
        <Field label="Name" required error={errors.name} className="sm:col-span-2"><TextInput autoFocus value={f.name} onChange={set('name')} placeholder={f.item_type === 'goods' ? 'e.g. LED Monitor 24"' : 'e.g. Logo design'} invalid={!!errors.name} /></Field>
        <Field label="HSN / SAC code" error={errors.hsn_sac_code} hint="HSN for goods, SAC for services (2–8 digits)"><TextInput value={f.hsn_sac_code} onChange={set('hsn_sac_code')} inputMode="numeric" maxLength={8} className="num" invalid={!!errors.hsn_sac_code} /></Field>
        <Field label="Unit" error={errors.unit}><Select value={f.unit} onChange={set('unit')}>{meta?.units.map((u) => <option key={u.code} value={u.code}>{u.name} ({u.code})</option>)}</Select></Field>
        <Field label="Selling price" required error={errors.selling_price} hint="Excluding GST"><TextInput value={f.selling_price} onChange={(e) => set('selling_price')({ target: { value: e.target.value.replace(/[^\d.]/g, '') } })} inputMode="decimal" left="₹" className="num" invalid={!!errors.selling_price} /></Field>
        <Field label="GST rate" required error={errors.gst_rate}>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6" role="radiogroup" aria-label="GST rate">
            {[...(meta?.gst_rates ?? [0, 0.25, 3, 5, 18, 40]), ...(meta?.gst_rates?.includes(Number(f.gst_rate)) || !f.gst_rate ? [] : [Number(f.gst_rate)])].map((r) => (
              <button key={r} type="button" role="radio" aria-checked={f.gst_rate === String(r)} onClick={() => setF((p) => ({ ...p, gst_rate: String(r) }))}
                className={clsx('h-11 min-w-0 rounded-xl border px-0 text-[13px] font-bold transition', f.gst_rate === String(r) ? 'gradient-brand border-transparent text-white shadow-md' : 'border-line-strong text-ink-2 hover:border-brand/50')}>{r}%</button>
            ))}
          </div>
        </Field>
        <Field label="Description" className="sm:col-span-2"><Textarea rows={2} value={f.description} onChange={set('description')} placeholder="Optional — shown under the item name on invoices" /></Field>
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  )
}
