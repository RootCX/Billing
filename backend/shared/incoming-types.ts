import type { Invoice, LineItem, SellerSettings } from "./invoice-types";

export interface ParsedUblAddress {
  street?: string;
  postalZone?: string;
  city?: string;
  countryCode?: string;
}

export interface ParsedUblParty {
  name?: string;
  vatNumber?: string;
  companyId?: string;
  address?: ParsedUblAddress;
  contact?: { email?: string; name?: string; phone?: string };
}

export interface ParsedUblLine {
  id?: string;
  description?: string;
  sellersItemId?: string;
  quantity?: number;
  unitCode?: string;
  unitPrice?: number;
  lineAmount?: number;
}

export interface ParsedUbl {
  currency?: string;
  documentNumber?: string;
  issueDate?: string;
  dueDate?: string;
  seller?: ParsedUblParty;
  buyer?: ParsedUblParty;
  lines?: ParsedUblLine[];
  monetaryTotal?: {
    lineExtensionAmount?: number;
    taxInclusiveAmount?: number;
    payableAmount?: number;
    prepaidAmount?: number;
  };
  taxTotal?: {
    taxAmount?: number;
    subtotals?: { percent?: number }[];
  };
  paymentMeans?: { paymentId?: string; iban?: string; bic?: string; accountName?: string }[];
  delivery?: { date?: string; partyName?: string; address?: ParsedUblAddress };
  despatchDocumentReference?: string;
  buyerReference?: string;
}

export interface IncomingPdfData {
  invoice: Invoice;
  seller: SellerSettings;
  documentTitle: string;
  paymentInfo?: { iban?: string; bic?: string };
  footerText: string;
}

export function ublToIncomingPdfData(
  ubl: ParsedUbl,
  doc: { id: string; document_type?: string; document_number?: string; issue_date?: string; due_date?: string; currency?: string; amount?: number; sender_name?: string; sender_vat?: string; receiver_name?: string; status?: string },
): IncomingPdfData {
  const currency = ubl.currency || doc.currency || "EUR";
  const taxRate = ubl.taxTotal?.subtotals?.[0]?.percent ?? 0;

  const lineItems: LineItem[] = (ubl.lines ?? []).map((line, i) => ({
    id: line.id || String(i),
    product: line.description || "\u2014",
    description: line.sellersItemId ? `Ref: ${line.sellersItemId}` : "",
    quantity: line.quantity ?? 1,
    unit: line.unitCode || "",
    unit_price: line.unitPrice ?? line.lineAmount ?? 0,
    discount: 0,
    tax_rate: taxRate,
  }));

  const references = [
    ubl.despatchDocumentReference ? { id: "desp", type: "custom" as const, label: "Despatch #", value: ubl.despatchDocumentReference } : null,
    ubl.buyerReference ? { id: "bref", type: "custom" as const, label: "Buyer Ref", value: ubl.buyerReference } : null,
  ].filter((r): r is NonNullable<typeof r> => r !== null);

  const invoice: Invoice = {
    id: doc.id,
    invoice_number: ubl.documentNumber || doc.document_number || "",
    status: "sent" as const,
    invoice_date: ubl.issueDate || doc.issue_date || "",
    due_date: ubl.dueDate || doc.due_date || "",
    currency,
    vat_treatment: "standard" as const,
    client_company: ubl.buyer?.name || doc.receiver_name || "",
    client_vat: ubl.buyer?.vatNumber || "",
    client_street: ubl.buyer?.address?.street || "",
    client_city: ubl.buyer?.address?.city || "",
    client_postal: ubl.buyer?.address?.postalZone || "",
    client_country: ubl.buyer?.address?.countryCode || "",
    client_contact_name: "",
    client_contact_email: "",
    line_items: lineItems,
    references,
    internal_notes: "",
    terms: "",
    subtotal: ubl.monetaryTotal?.lineExtensionAmount ?? 0,
    total_tax: ubl.taxTotal?.taxAmount ?? 0,
    total: ubl.monetaryTotal?.taxInclusiveAmount ?? ubl.monetaryTotal?.payableAmount ?? doc.amount ?? 0,
    created_at: "",
    updated_at: "",
  };

  const addr = ubl.seller?.address;
  const seller: SellerSettings = {
    id: "",
    company_name: ubl.seller?.name || doc.sender_name || "",
    vat_number: ubl.seller?.vatNumber || doc.sender_vat || "",
    street: addr?.street || "",
    city: addr?.city || "",
    postal_code: addr?.postalZone || "",
    country_code: addr?.countryCode || "",
    email: ubl.seller?.contact?.email || "",
    phone: ubl.seller?.contact?.phone || "",
    iban: "",
    bic: "",
    logo: "",
    default_currency: currency,
    default_vat_rate: taxRate,
    invoice_prefix: "",
    default_terms: "",
    default_notes: "",
  };

  const pm = ubl.paymentMeans?.[0];

  return {
    invoice,
    seller,
    documentTitle: doc.document_type === "CreditNote" ? "CREDIT NOTE" : "INVOICE",
    paymentInfo: pm?.iban ? { iban: pm.iban, bic: pm.bic } : undefined,
    footerText: `Received via Peppol${doc.document_type ? ` \u00B7 ${doc.document_type}` : ""}${currency ? ` \u00B7 ${currency}` : ""}`,
  };
}
