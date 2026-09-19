import clsx from 'clsx'
import { Loader2 } from 'lucide-react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Link, type LinkProps } from 'react-router-dom'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'soft' | 'dark' | 'white'
type Size = 'sm' | 'md' | 'lg'

const base =
  'inline-flex shrink-0 items-center justify-center gap-2 font-semibold whitespace-nowrap select-none transition-all duration-200 ' +
  'active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none disabled:shadow-none'

const variants: Record<Variant, string> = {
  primary:
    'gradient-brand text-white shadow-[0_8px_20px_-8px_rgb(91_69_240/0.75)] hover:shadow-[0_12px_28px_-8px_rgb(91_69_240/0.9)] hover:-translate-y-px',
  secondary: 'bg-surface text-ink border border-line-strong hover:bg-surface-2 hover:border-brand/40',
  ghost: 'text-ink-2 hover:bg-brand-soft hover:text-brand-ink',
  soft: 'bg-brand-soft text-brand-ink hover:brightness-95',
  danger: 'bg-crit text-white hover:brightness-110 shadow-[0_8px_20px_-10px_rgb(208_59_59/0.8)]',
  dark: 'bg-ink text-canvas hover:opacity-90',
  white: 'bg-white text-[#3c27a8] shadow-[0_10px_24px_-10px_rgb(0_0_0/0.45)] hover:bg-white/95 hover:-translate-y-px',
}
const sizes: Record<Size, string> = {
  sm: 'h-9 px-3.5 text-[13px] rounded-lg',
  md: 'h-11 px-5 text-sm rounded-xl',
  lg: 'h-13 px-7 text-base rounded-2xl',
}

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
  icon?: ReactNode
}

export function Button({ variant = 'primary', size = 'md', loading, icon, className, children, disabled, ...rest }: Props) {
  return (
    <button className={clsx(base, variants[variant], sizes[size], className)} disabled={disabled || loading} {...rest}>
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  )
}

export function LinkButton({
  variant = 'primary', size = 'md', icon, className, children, ...rest
}: LinkProps & { variant?: Variant; size?: Size; icon?: ReactNode }) {
  return (
    <Link className={clsx(base, variants[variant], sizes[size], className)} {...rest}>
      {icon}
      {children}
    </Link>
  )
}

export function IconButton({ className, children, label, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={clsx(
        'inline-grid size-9 place-items-center rounded-lg text-ink-2 transition-colors hover:bg-brand-soft hover:text-brand-ink disabled:opacity-40',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
}
