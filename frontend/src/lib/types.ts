export type PlanKey = 'free' | 'starter' | 'pro'

export interface TenantInfo {
  is_public: boolean
  base_domain: string
  name?: string
  slug?: string
  active?: boolean
}

export interface Me {
  id: number
  email: string
  business: { name: string; slug: string; plan: PlanKey }
  profile_complete: boolean
  missing_fields: string[]
  logo_url: string | null
  business_name: string
}

export interface Meta {
  states: { code: string; name: string; gst_code: string }[]
  gst_rates: number[]
  units: { code: string; name: string }[]
  payment_modes: { code: string; name: string }[]
}

export interface Paginated<T> { count: number; next: string | null; previous: string | null; results: T[] }

export interface Customer {
  id: number; name: string; customer_type: 'b2b' | 'b2c'; gstin: string; email: string; phone: string; address: string; city: string
  pincode: string; state: string; state_name: string; is_active: boolean; invoice_count: number; created_at: string
}

export interface Product {
  id: number; name: string; description: string; item_type: 'goods' | 'service'; hsn_sac_code: string
  unit: string; selling_price: string; gst_rate: string; is_active: boolean; created_at: string
}

export type InvoiceStatus = 'draft' | 'sent' | 'partial' | 'paid' | 'overdue' | 'cancelled'
export type SupplyType = 'intrastate' | 'interstate' | 'export'

export interface InvoiceRow {
  id: number; invoice_number: string | null; customer: number; customer_name: string; invoice_date: string
  due_date: string; supply_type: SupplyType; grand_total: string; amount_paid: string; balance_due: string
  status: InvoiceStatus; stored_status: string; created_at: string
}

export interface LineItem {
  id?: number; item_name: string; description: string; hsn_sac_code: string; unit: string; quantity: string
  unit_price: string; discount_percent: string; gst_rate: string
  gross_amount?: string; discount_amount?: string; taxable_amount?: string
  cgst_rate?: string; cgst_amount?: string; sgst_rate?: string; sgst_amount?: string
  igst_rate?: string; igst_amount?: string; line_total?: string
}

export interface Payment {
  id: number; receipt_number: string; amount: string; payment_date: string; mode: string; mode_label: string; reference: string; notes: string; created_at: string
}

export interface InvoiceDetail extends InvoiceRow {
  financial_year: string; place_of_supply: string; place_of_supply_name: string; notes: string; terms: string
  subtotal: string; discount_total: string; taxable_amount: string; cgst_amount: string; sgst_amount: string
  igst_amount: string; round_off: string; finalized_at: string | null; cancelled_at: string | null
  items: LineItem[]; payments: Payment[]; amount_in_words: string; is_editable: boolean
  bill_from: Record<string, any> & { logo_url: string | null }
  bill_to: Record<string, any>
}

export interface PaymentRecord {
  id: number; receipt_number: string; amount: string; payment_date: string; mode: string; mode_label: string
  reference: string; notes: string; created_at: string
  invoice: number; invoice_number: string; invoice_status: InvoiceStatus; invoice_total: string
  invoice_paid: string; invoice_balance: string; customer_name: string
}

export interface Profile {
  business_name: string; gstin: string; pan: string; state: string; address_line1: string; address_line2: string
  city: string; pincode: string; phone: string; email: string; logo_url: string | null; bank_name: string
  account_holder_name: string; account_number: string; ifsc_code: string; invoice_prefix: string
  default_payment_terms: number; default_notes: string; default_terms: string; is_complete: boolean
  missing_fields: string[]
}

export interface Plan {
  key: PlanKey; name: string; price: number; tagline: string
  limits: { invoices_per_month: number | null; customers: number | null; products: number | null }
}
export interface ComparisonRow { feature: string; free: string | boolean; starter: string | boolean; pro: string | boolean; soon?: boolean }

export interface Usage { invoices_per_month: number; customers: number; products: number }

export interface Subscription {
  plan: PlanKey; plan_name: string; plan_expires_on: string | null; cancel_at_period_end: boolean
  has_subscription: boolean; limits: Plan['limits']; usage: Usage; plans: Plan[]; comparison: ComparisonRow[]
  razorpay: { mock: boolean; configured: boolean; key_id: string }
  receipts: { id: number; receipt_number: string; plan: PlanKey; plan_name: string; amount: string; paid_at: string; is_demo: boolean; status: string }[]
}

export interface Dashboard {
  revenue: { this_month: string; last_month: string; change_percent: number | null; collected_this_month: string }
  counts: { total: number; paid: number; pending: number; overdue: number; draft: number }
  outstanding: string
  overdue_amount: string
  recent_invoices: InvoiceRow[]
  top_customers: { customer_id: number; name: string; revenue: string; invoices: number }[]
  trend: { month: string; year: number; revenue: string }[]
  month_label: string
}
