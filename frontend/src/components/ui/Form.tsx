import clsx from 'clsx'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertCircle, ChevronDown, Loader2, Search, X } from 'lucide-react'
import {
  forwardRef, useEffect, useId, useRef, useState,
  type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes,
} from 'react'
import { useDebounce } from '@/lib/hooks'

export const inputCls =
  'w-full rounded-xl border border-line-strong bg-surface px-3.5 text-base text-ink sm:text-sm placeholder:text-muted/80 ' +
  'transition-[border-color,box-shadow] duration-150 focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/15 ' +
  'disabled:bg-surface-2 disabled:text-muted'

interface FieldProps {
  label?: string
  hint?: ReactNode
  error?: string
  required?: boolean
  children: ReactNode
  className?: string
  htmlFor?: string
}

export function Field({ label, hint, error, required, children, className, htmlFor }: FieldProps) {
  return (
    <div className={clsx('block', className)}>
      {label && (
        <label htmlFor={htmlFor} className="mb-1.5 block text-[13px] font-semibold text-ink-2">
          {label}
          {required && <span className="ml-0.5 text-crit">*</span>}
        </label>
      )}
      {children}
      <AnimatePresence initial={false}>
        {error ? (
          <motion.p
            key="e"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-1.5 flex items-start gap-1.5 text-xs font-medium text-crit-ink"
            role="alert"
          >
            <AlertCircle className="mt-px size-3.5 shrink-0" />
            {error}
          </motion.p>
        ) : hint ? (
          <p key="h" className="mt-1.5 text-xs text-muted">{hint}</p>
        ) : null}
      </AnimatePresence>
    </div>
  )
}

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean; left?: ReactNode }>(
  ({ className, invalid, left, ...rest }, ref) => (
    <div className="relative">
      {left && <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-medium text-muted">{left}</span>}
      <input
        ref={ref}
        className={clsx(inputCls, 'h-11', left && 'pl-8', invalid && 'border-crit focus:border-crit focus:ring-crit/15', className)}
        aria-invalid={invalid || undefined}
        {...rest}
      />
    </div>
  ),
)
TextInput.displayName = 'TextInput'

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(
  ({ className, invalid, ...rest }, ref) => (
    <textarea ref={ref} rows={3} className={clsx(inputCls, 'py-2.5 leading-relaxed', invalid && 'border-crit', className)} {...rest} />
  ),
)
Textarea.displayName = 'Textarea'

export function Select({ className, invalid, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }) {
  return (
    <div className="relative">
      <select
        className={clsx(inputCls, 'h-11 appearance-none pr-9', invalid && 'border-crit', className)}
        {...rest}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
    </div>
  )
}

export function SearchInput({ value, onChange, placeholder = 'Search…', className }: {
  value: string; onChange: (v: string) => void; placeholder?: string; className?: string
}) {
  return (
    <div className={clsx('relative', className)}>
      <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={clsx(inputCls, 'h-11 pl-10 pr-9')}
        aria-label={placeholder}
      />
      {value && (
        <button onClick={() => onChange('')} aria-label="Clear search" className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted hover:bg-brand-soft hover:text-brand-ink">
          <X className="size-4" />
        </button>
      )}
    </div>
  )
}

/** Searchable, async, keyboard friendly picker (customers, products). */
export function Combobox<T>({
  search, onSelect, renderItem, placeholder, selectedLabel, invalid, footer, disabled,
}: {
  search: (q: string) => Promise<T[]>
  onSelect: (item: T) => void
  renderItem: (item: T) => ReactNode
  placeholder: string
  selectedLabel?: ReactNode
  invalid?: boolean
  footer?: ReactNode
  disabled?: boolean
}) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [items, setItems] = useState<T[]>([])
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState(0)
  const dq = useDebounce(q, 200)
  const box = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    let live = true
    setLoading(true)
    search(dq)
      .then((r) => { if (live) { setItems(r); setActive(0) } })
      .catch(() => live && setItems([]))
      .finally(() => live && setLoading(false))
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dq, open])

  useEffect(() => {
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  const pick = (item: T) => { onSelect(item); setOpen(false); setQ('') }
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, items.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter' && items[active]) { e.preventDefault(); pick(items[active]) }
    else if (e.key === 'Escape') setOpen(false)
  }

  return (
    <div ref={box} className="relative">
      {!open && selectedLabel ? (
        <button
          type="button" disabled={disabled}
          onClick={() => { setOpen(true); setTimeout(() => input.current?.focus(), 0) }}
          className={clsx(inputCls, 'flex h-11 items-center justify-between text-left', invalid && 'border-crit')}
        >
          <span className="min-w-0 truncate">{selectedLabel}</span>
          <ChevronDown className="size-4 shrink-0 text-muted" />
        </button>
      ) : (
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <input
            ref={input} value={q} disabled={disabled}
            onChange={(e) => { setQ(e.target.value); setOpen(true) }}
            onFocus={() => setOpen(true)} onKeyDown={onKey}
            placeholder={placeholder} role="combobox" aria-expanded={open} aria-controls={id} autoComplete="off"
            className={clsx(inputCls, 'h-11 pl-10', invalid && 'border-crit')}
          />
        </div>
      )}
      <AnimatePresence>
        {open && (
          <motion.div
            id={id} role="listbox"
            initial={{ opacity: 0, y: -6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.14 }}
            className="absolute z-40 mt-2 max-h-72 w-full min-w-64 overflow-auto rounded-xl border border-line bg-surface p-1.5 shadow-pop scroll-thin"
          >
            {loading && <div className="flex items-center gap-2 px-3 py-3 text-sm text-muted"><Loader2 className="size-4 animate-spin" />Searching…</div>}
            {!loading && items.length === 0 && <div className="px-3 py-3 text-sm text-muted">No matches found.</div>}
            {items.map((it, i) => (
              <button
                key={i} type="button" role="option" aria-selected={i === active}
                onMouseEnter={() => setActive(i)} onClick={() => pick(it)}
                className={clsx('block w-full rounded-lg px-3 py-2 text-left text-sm', i === active ? 'bg-brand-soft text-brand-ink' : 'hover:bg-surface-2')}
              >
                {renderItem(it)}
              </button>
            ))}
            {footer && <div className="mt-1 border-t border-line pt-1">{footer}</div>}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
