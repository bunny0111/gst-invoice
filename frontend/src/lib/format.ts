const inrFmt = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const inrWhole = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 })

const n = (v: string | number | null | undefined) => (v === null || v === undefined || v === '' ? 0 : Number(v))

/** 1234567.5 -> "₹12,34,567.50" (Indian digit grouping) */
export const inr = (v: string | number | null | undefined) => `₹${inrFmt.format(n(v))}`
export const inrPlain = (v: string | number | null | undefined) => inrFmt.format(n(v))
export const inrWholeRupees = (v: string | number | null | undefined) => `₹${inrWhole.format(n(v))}`

/** Compact Indian units for tight spaces (axis ticks): 1.2K, 3.4L, 2Cr */
export function inrCompact(v: string | number): string {
  const x = Math.abs(n(v))
  const sign = n(v) < 0 ? '-' : ''
  const trim = (y: number) => String(Math.round(y * 10) / 10)
  if (x >= 1e7) return `${sign}₹${trim(x / 1e7)}Cr`
  if (x >= 1e5) return `${sign}₹${trim(x / 1e5)}L`
  if (x >= 1e3) return `${sign}₹${trim(x / 1e3)}K`
  return `${sign}₹${trim(x)}`
}

export function fmtDate(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso)
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}
export function fmtDateTime(iso?: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const pad = (x: number) => String(x).padStart(2, '0')
export const toISO = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const todayISO = () => toISO(new Date())
export function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`)
  d.setDate(d.getDate() + days)
  return toISO(d)
}
export function financialYear(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  const start = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1
  return `${start}-${String(start + 1).slice(-2)}`
}
export const trimZero = (v: string | number) => {
  const s = String(v)
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']
const below100 = (x: number) => (x < 20 ? ONES[x] : `${TENS[Math.floor(x / 10)]}${x % 10 ? ' ' + ONES[x % 10] : ''}`)
const below1000 = (x: number) => [x >= 100 ? `${ONES[Math.floor(x / 100)]} Hundred` : '', x % 100 ? below100(x % 100) : ''].filter(Boolean).join(' ')
function words(x: number): string {
  if (x === 0) return 'Zero'
  const parts: string[] = []
  for (const [div, name] of [[1e7, 'Crore'], [1e5, 'Lakh'], [1e3, 'Thousand']] as const) {
    const chunk = Math.floor(x / div)
    x %= div
    if (chunk) parts.push(`${chunk >= 100 && name === 'Crore' ? words(chunk) : below100(chunk)} ${name}`)
  }
  if (x) parts.push(below1000(x))
  return parts.join(' ')
}
/** 5200 -> "Rupees Five Thousand Two Hundred Only" (mirrors the server; used for the live preview) */
export function amountInWords(amount: number): string {
  const rounded = Math.round(amount * 100) / 100
  const rupees = Math.floor(rounded)
  const paise = Math.round((rounded - rupees) * 100)
  return `Rupees ${words(rupees)}${paise ? ` and ${words(paise)} Paise` : ''} Only`
}

export const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '?'
