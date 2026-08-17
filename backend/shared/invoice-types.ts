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

/**
 * A document level discount (EN16931 BG-20 "DOCUMENT LEVEL ALLOWANCES").
 *
 * This is how a deposit already invoiced, or any global rebate, is deducted.
 * The amount is always POSITIVE and VAT-exclusive: the direction is carried by
 * the construct itself, never by the sign. A "negative line" cannot be used for
 * this — EN16931 BR-27 forbids a negative item net price, and Peppol rejects the
 * document outright.
 */
export interface DocumentAllowance {
  id: string;
  /** BT-92, positive, VAT-exclusive. */
  amount: number;
  /** BT-96 — the VAT rate the discount is taken at; must match a rate used on the lines. */
  tax_rate: number;
  /** BT-97 — mandatory (BR-33): "Deposit invoiced on INV-…". */
  reason: string;
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
  /** BG-20 document level discounts. Absent on records created before 0.11.0. */
  allowances?: DocumentAllowance[];
  /** BT-113 — VAT-inclusive amount already paid (a deposit, a partial payment). */
  prepaid_amount?: number;
  /** Free text shown next to the paid amount, e.g. the deposit invoice number. */
  prepaid_reference?: string;
  /** BT-106 — sum of the line net amounts, before document level discounts. */
  subtotal: number;
  /** BT-110 — VAT total, already net of the VAT on the document level discounts. */
  total_tax: number;
  tax_currency?: string;
  tax_amount_in_tax_currency?: number;
  tax_exchange_rate?: number;
  tax_exchange_rate_date?: string;
  /** BT-112 — VAT-inclusive total, before deducting what was already paid. */
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

/** Every monetary figure of a document, in the vocabulary EN16931 uses. */
export interface DocumentTotals {
  /** BT-106 — sum of the line net amounts. */
  subtotal: number;
  /** BT-107 — sum of the document level discounts, positive. */
  allowanceTotal: number;
  /** BT-109 — what VAT is actually computed on: subtotal − discounts. */
  taxableAmount: number;
  /** BT-110 — VAT on the taxable amount, per rate. */
  totalTax: number;
  /** BT-112 — taxable amount + VAT. */
  total: number;
  /** BT-113 — already paid, VAT-inclusive. */
  prepaidAmount: number;
  /** BT-115 — what the customer still owes: total − already paid. */
  amountDue: number;
}

/** One line of the VAT breakdown a document carries, per rate. */
export interface VatBreakdownLine {
  /** BT-119 — the rate. */
  taxRate: number;
  /** BT-116 — the lines of that rate, minus the discounts of that rate. */
  taxableAmount: number;
  /** BT-117 — VAT on that base, rounded once. */
  taxAmount: number;
}

/**
 * The VAT breakdown, one entry per rate, ordered by rate.
 *
 * A discount reduces the VAT base of its own rate, not the document as a whole
 * (EN16931 BR-S-08: the taxable amount of a VAT breakdown line is the sum of the
 * line amounts of that rate, minus the discounts of that rate). Computing the VAT
 * rate by rate is what keeps the invoice, the PDF and the UBL in agreement.
 */
export function computeVatBreakdown(
  items: LineItem[],
  allowances: DocumentAllowance[] = [],
): VatBreakdownLine[] {
  const baseByRate = new Map<number, number>();
  const shiftBase = (rate: number, amount: number) => {
    baseByRate.set(rate, round2((baseByRate.get(rate) ?? 0) + amount));
  };

  for (const item of items) {
    shiftBase(Number(item.tax_rate) || 0, computeLineItem(item).subtotal);
  }
  for (const allowance of allowances) {
    shiftBase(Number(allowance.tax_rate) || 0, -round2(Number(allowance.amount) || 0));
  }

  return [...baseByRate]
    .sort(([a], [b]) => a - b)
    .map(([taxRate, taxableAmount]) => ({
      taxRate,
      taxableAmount,
      taxAmount: round2(taxableAmount * (taxRate / 100)),
    }));
}

/** Totals for a whole document, VAT computed rate by rate. */
export function computeDocumentTotals(
  items: LineItem[],
  allowances: DocumentAllowance[] = [],
  prepaidAmount = 0,
): DocumentTotals {
  let subtotal = 0;
  for (const item of items) {
    subtotal = round2(subtotal + computeLineItem(item).subtotal);
  }

  let allowanceTotal = 0;
  for (const allowance of allowances) {
    allowanceTotal = round2(allowanceTotal + round2(Number(allowance.amount) || 0));
  }

  let totalTax = 0;
  for (const { taxAmount } of computeVatBreakdown(items, allowances)) {
    totalTax = round2(totalTax + taxAmount);
  }

  const taxableAmount = round2(subtotal - allowanceTotal);
  const total = round2(taxableAmount + totalTax);
  const prepaid = round2(Number(prepaidAmount) || 0);

  return {
    subtotal,
    allowanceTotal,
    taxableAmount,
    totalTax,
    total,
    prepaidAmount: prepaid,
    amountDue: round2(total - prepaid),
  };
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
