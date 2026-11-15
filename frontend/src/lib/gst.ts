/** Client mirror of the server GST engine (backend/billing/calc.py) for the live invoice preview
 *  (PRD US-05 AC4). The server always recomputes on save - it is the source of truth. */
import Decimal from 'decimal.js'

Decimal.set({ rounding: Decimal.ROUND_HALF_UP })

export type Supply = 'intrastate' | 'interstate' | 'export'
const D = (v: unknown) => {
  try {
    const d = new Decimal(String(v ?? '').trim() === '' ? 0 : String(v))
    return d.isFinite() ? d : new Decimal(0)
  } catch {
    return new Decimal(0)
  }
}
const money = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP)

export interface LineIn { quantity: string; unit_price: string; discount_percent: string; gst_rate: string }
export interface LineOut { gross: Decimal; discount: Decimal; taxable: Decimal; cgst: Decimal; sgst: Decimal; igst: Decimal; total: Decimal }

export function detectSupply(businessState: string | undefined, customerState: string | undefined): Supply | null {
  if (!businessState || !customerState) return null
  return businessState === customerState ? 'intrastate' : 'interstate'
}

export function calcLine(l: LineIn, supply: Supply): LineOut {
  const gross = money(D(l.quantity).mul(D(l.unit_price)))
  const discount = money(gross.mul(D(l.discount_percent)).div(100))
  const taxable = gross.sub(discount)
  const rate = D(l.gst_rate)
  let cgst = new Decimal(0)
  let sgst = new Decimal(0)
  let igst = new Decimal(0)
  if (supply === 'intrastate') {
    cgst = money(taxable.mul(rate.div(2)).div(100))
    sgst = cgst
  } else if (supply === 'interstate') {
    igst = money(taxable.mul(rate).div(100))
  }
  return { gross, discount, taxable, cgst, sgst, igst, total: taxable.add(cgst).add(sgst).add(igst) }
}

export interface Totals {
  subtotal: Decimal; discount: Decimal; taxable: Decimal; cgst: Decimal; sgst: Decimal; igst: Decimal
  roundOff: Decimal; grand: Decimal; lines: LineOut[]
}

export function calcInvoice(items: LineIn[], supply: Supply): Totals {
  const lines = items.map((i) => calcLine(i, supply))
  const sum = (f: (l: LineOut) => Decimal) => lines.reduce((a, l) => a.add(f(l)), new Decimal(0))
  const taxable = sum((l) => l.taxable)
  const cgst = sum((l) => l.cgst)
  const sgst = sum((l) => l.sgst)
  const igst = sum((l) => l.igst)
  const raw = taxable.add(cgst).add(sgst).add(igst)
  const grand = raw.toDecimalPlaces(0, Decimal.ROUND_HALF_UP) // nearest rupee (AC10)
  return { subtotal: sum((l) => l.gross), discount: sum((l) => l.discount), taxable, cgst, sgst, igst, roundOff: grand.sub(raw), grand, lines }
}

/** Phone fields take digits only, at most 10 (the server stores Indian numbers as exactly 10 digits). */
export const phoneInput = (v: string) => v.replace(/\D/g, '').slice(0, 10)

/** Customer phone: an Indian number (10 digits), or a foreign one typed with "+" and its country code (export
 *  customers) - then up to 15 digits after the "+". */
export function customerPhoneInput(v: string): string {
  const t = v.trim()
  if (!t.startsWith('+') || t.replace(/\D/g, '').startsWith('91')) return phoneInput(t.startsWith('+91') ? t.slice(3) : t)
  return '+' + t.replace(/\D/g, '').slice(0, 15)
}

/** GSTIN fields: uppercase letters/digits only, at most 15. */
export const gstinInput = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 15)

/** The state a GSTIN belongs to - its first two digits are the GST state code (07 = Delhi). */
export function stateFromGstin(gstin: string, states: { code: string; gst_code: string }[] | undefined): string | undefined {
  if (!states || gstin.length < 2) return undefined
  return states.find((s) => s.gst_code === gstin.slice(0, 2))?.code
}

/** Characters 3-12 of a GSTIN are the holder's PAN. */
export const panFromGstin = (gstin: string) => (gstin.length === 15 ? gstin.slice(2, 12) : '')
