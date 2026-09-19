import clsx from 'clsx'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, X } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Button } from './Button'

export function Modal({
  open, onClose, title, subtitle, children, footer, size = 'md',
}: {
  open: boolean; onClose: () => void; title: string; subtitle?: string; children: ReactNode; footer?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [open, onClose])

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 grid place-items-end sm:place-items-center">
          <motion.div
            className="absolute inset-0 bg-[#0d0a2b]/55 backdrop-blur-sm"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}
          />
          <motion.div
            role="dialog" aria-modal="true" aria-label={title}
            initial={{ opacity: 0, y: 24, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 24, scale: 0.97 }}
            transition={{ type: 'spring', damping: 26, stiffness: 320 }}
            className={clsx(
              'relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-3xl bg-surface shadow-pop sm:rounded-3xl',
              size === 'sm' && 'sm:max-w-md', size === 'md' && 'sm:max-w-xl', size === 'lg' && 'sm:max-w-3xl', size === 'xl' && 'sm:max-w-5xl',
            )}
          >
            <header className="flex items-start justify-between gap-4 border-b border-line px-6 py-5">
              <div>
                <h2 className="font-display text-lg font-bold text-ink">{title}</h2>
                {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
              </div>
              <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-muted hover:bg-brand-soft hover:text-brand-ink">
                <X className="size-5" />
              </button>
            </header>
            <div className="overflow-y-auto px-6 py-5 scroll-thin">{children}</div>
            {footer && <footer className="flex flex-wrap items-center justify-end gap-3 border-t border-line bg-surface-2 px-6 py-4">{footer}</footer>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

export function ConfirmDialog({
  open, onClose, onConfirm, title, message, confirmLabel = 'Confirm', danger, loading,
}: {
  open: boolean; onClose: () => void; onConfirm: () => void; title: string; message: ReactNode
  confirmLabel?: string; danger?: boolean; loading?: boolean
}) {
  return (
    <Modal
      open={open} onClose={onClose} title={title} size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Keep it</Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>{confirmLabel}</Button>
        </>
      }
    >
      <div className="flex gap-4">
        <span className={clsx('grid size-11 shrink-0 place-items-center rounded-full', danger ? 'bg-crit-soft text-crit' : 'bg-brand-soft text-brand')}>
          <AlertTriangle className="size-5" />
        </span>
        <div className="pt-1 text-sm leading-relaxed text-ink-2">{message}</div>
      </div>
    </Modal>
  )
}
