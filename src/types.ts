export type InvoiceStatus = "draft" | "sent" | "paid" | "overdue" | "cancelled";
export type VatTreatment = "standard" | "exempt" | "reverse_charge" | "intra_eu" | "export";
export type ReferenceType = "purchase_order" | "contract_number" | "cost_center" | "project_reference" | "custom";
export type PeppolRegStatus = "not_registered" | "pending" | "active" | "failed";
export type PeppolSendStatus = "pending" | "sent" | "delivered" | "failed";

export interface PeppolRegistration {
  id: string;
  peppol_id: string;
  dokapi_ulid: string;
  status: PeppolRegStatus;
  document_types_registered: boolean;
  business_card_pushed: boolean;
  error_message: string;
  created_at: string;
  updated_at: string;
}

export interface PeppolSendLog {
  id: string;
  invoice_id: string;
  invoice_number: string;
  status: PeppolSendStatus;
  dokapi_ulid: string;
  sender_peppol_id: string;
  receiver_peppol_id: string;
  ubl_xml: string;
  error_message: string;
  sent_at: string;
  created_at: string;
  updated_at: string;
}


export interface Customer {
  id: string;
  company_name: string;
  vat_number: string;
  street: string;
  city: string;
  postal_code: string;
  country_code: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface Contact {
  id: string;
  customer_id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  job_title: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

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
  type: ReferenceType;
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
  total: number;
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

export interface OutgoingStatus {
  id: string;
  document_ulid: string;
  status: string;
  as4_message_id: string;
  error_message: string;
  delivered_at: string;
  created_at: string;
  updated_at: string;
}

export interface IncomingDocument {
  id: string;
  document_ulid: string;
  document_type: string;
  document_number: string;
  issue_date: string;
  due_date: string;
  currency: string;
  amount: number;
  sender_peppol_id: string;
  sender_name: string;
  sender_vat: string;
  receiver_peppol_id: string;
  receiver_name: string;
  status: string;
  instance_identifier: string;
  as4_message_id: string;
  xml: string;
  attachments: unknown[];
  created_at: string;
  updated_at: string;
}

export function applyCustomerToDraft(c: Customer, contact?: Contact): Partial<Invoice> {
  return {
    client_company: c.company_name,
    client_vat: c.vat_number ?? "",
    client_street: c.street ?? "",
    client_city: c.city ?? "",
    client_postal: c.postal_code ?? "",
    client_country: c.country_code ?? "",
    client_contact_name: contact ? `${contact.first_name} ${contact.last_name ?? ""}`.trim() : "",
    client_contact_email: contact?.email ?? "",
  };
}

export const CUSTOMER_FORM_FIELDS = [
  { name: "company_name", label: "Company Name", type: "text" as const, required: true },
  { name: "vat_number",   label: "VAT Number",   type: "text" as const },
  { name: "street",       label: "Street",       type: "text" as const },
  { name: "city",         label: "City",         type: "text" as const },
  { name: "postal_code",  label: "Postal Code",  type: "text" as const },
  { name: "country_code", label: "Country Code", type: "text" as const },
  { name: "notes",        label: "Notes",        type: "textarea" as const },
];

export const CONTACT_FORM_FIELDS = [
  { name: "first_name",  label: "First Name",  type: "text" as const, required: true },
  { name: "last_name",   label: "Last Name",   type: "text" as const },
  { name: "email",       label: "Email",       type: "text" as const },
  { name: "phone",       label: "Phone",       type: "text" as const },
  { name: "job_title",   label: "Job Title",   type: "text" as const },
];

export function contactDisplayName(c: Contact): string {
  return `${c.first_name} ${c.last_name ?? ""}`.trim();
}

export function computeLineItem(item: LineItem) {
  const gross = item.quantity * item.unit_price;
  const discounted = gross * (1 - item.discount / 100);
  const tax = discounted * (item.tax_rate / 100);
  return { subtotal: discounted, tax, total: discounted + tax };
}

export function computeTotals(items: LineItem[]) {
  let subtotal = 0;
  let totalTax = 0;
  for (const item of items) {
    const { subtotal: s, tax: t } = computeLineItem(item);
    subtotal += s;
    totalTax += t;
  }
  return { subtotal, totalTax, total: subtotal + totalTax };
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

export const REFERENCE_TYPE_LABELS: Record<ReferenceType, string> = {
  purchase_order: "Purchase Order",
  contract_number: "Contract Number",
  cost_center: "Cost Center",
  project_reference: "Project Reference",
  custom: "Custom Field",
};

export function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

export function todayISO(): string {
  return new Date().toISOString().split("T")[0];
}
