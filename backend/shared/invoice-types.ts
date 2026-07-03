export type InvoiceStatus = "draft" | "sent" | "paid" | "overdue" | "cancelled";
export type VatTreatment = "standard" | "exempt" | "reverse_charge" | "intra_eu" | "export";
export type DocumentType = "invoice" | "credit_note";

export interface LineItem {
  id: string;
  product: string;
  description: string;
  quantity: number;
  unit: string;
  unit_price: number;
  discount: number;
  tax_rate: number;
}

export interface InvoiceReference {
  id: string;
  type: string;
  label: string;
  value: string;
}

export interface Invoice {
  id: string;
  invoice_number: string;
  status: InvoiceStatus;
  invoice_date: string;
  due_date: string;
  currency: string;
  vat_treatment: VatTreatment;
  client_company: string;
  client_vat: string;
  client_street: string;
  client_city: string;
  client_postal: string;
  client_country: string;
  client_contact_name: string;
  client_contact_email: string;
  line_items: LineItem[];
  references: InvoiceReference[];
  internal_notes: string;
  terms: string;
  subtotal: number;
  total_tax: number;
  tax_currency?: string;
  tax_amount_in_tax_currency?: number;
  tax_exchange_rate?: number;
  tax_exchange_rate_date?: string;
  total: number;
  // Credit-note support. `document_type` defaults to "invoice" when absent
  // (older records predate the field). For credit notes, the corrected_* fields
  // point at the invoice this document cancels/corrects.
  document_type?: DocumentType;
  corrected_invoice_id?: string;
  corrected_invoice_number?: string;
  corrected_invoice_date?: string;
  credit_reason?: string;
  created_at: string;
  updated_at: string;
}

export interface SellerSettings {
  id: string;
  company_name: string;
  vat_number: string;
  street: string;
  city: string;
  postal_code: string;
  country_code: string;
  email: string;
  phone: string;
  iban: string;
  bic: string;
  logo: string;
  default_currency: string;
  default_vat_rate: number;
  invoice_prefix: string;
  default_terms: string;
  default_notes: string;
}

export const FIELD_NONE = "__none__";

export const VAT_TREATMENT_LABELS: Record<string, string> = {
  standard: "Standard",
  exempt: "Exempt",
  reverse_charge: "Reverse Charge",
  intra_eu: "Intra-EU",
  export: "Export",
};

export const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  draft:     { bg: "#f3f4f6", text: "#4b5563", label: "DRAFT" },
  sent:      { bg: "#dbeafe", text: "#1d4ed8", label: "SENT" },
  paid:      { bg: "#dcfce7", text: "#15803d", label: "PAID" },
  overdue:   { bg: "#fee2e2", text: "#b91c1c", label: "OVERDUE" },
  cancelled: { bg: "#f3f4f6", text: "#6b7280", label: "CANCELLED" },
};

const round2 = (v: number) => Math.round(v * 100) / 100;

export function computeLineItem(item: LineItem) {
  const quantity = Number(item.quantity) || 0;
  const unitPrice = Number(item.unit_price) || 0;
  const discount = Number(item.discount) || 0;
  const taxRate = Number(item.tax_rate) || 0;
  const gross = round2(quantity * unitPrice);
  const discounted = round2(gross * (1 - discount / 100));
  const tax = round2(discounted * (taxRate / 100));
  return { subtotal: discounted, tax, total: round2(discounted + tax) };
}

export function formatCurrency(amount: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "EUR",
    minimumFractionDigits: 2,
  }).format(amount);
}

export function formatDate(dateStr: string) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export function invoicePdfFilename(invoice: { invoice_number?: string; id: string }): string {
  const base = (invoice.invoice_number || invoice.id).replace(/[^A-Za-z0-9._-]+/g, "_");
  return `${base}.pdf`;
}

export function isCreditNote(doc: { document_type?: DocumentType | string | null }): boolean {
  return doc?.document_type === "credit_note";
}

/** Title shown on the PDF / dialogs. Falls back to INVOICE for legacy records. */
export function documentTitleFor(doc: { document_type?: DocumentType | string | null }): string {
  return isCreditNote(doc) ? "CREDIT NOTE" : "INVOICE";
}
