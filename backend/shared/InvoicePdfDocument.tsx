import React from "react";
import { Document, Page, View, Text, Image, StyleSheet, Font } from "@react-pdf/renderer";
import type { Invoice, LineItem, SellerSettings } from "./invoice-types";
import { computeLineItem, computeVatBreakdown, formatCurrency, formatDate, FIELD_NONE, VAT_TREATMENT_LABELS, STATUS_STYLES, isCreditNote, documentTitleFor } from "./invoice-types";

Font.registerHyphenationCallback((word) => [word]);

const C = {
  ink: "#0f172a",
  body: "#1e293b",
  strong: "#334155",
  muted: "#475569",
  softMuted: "#64748b",
  faint: "#94a3b8",
  line: "#e2e8f0",
  lineSoft: "#f1f5f9",
};

const s = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 10,
    color: C.body,
    backgroundColor: "#ffffff",
    paddingTop: 32,
    paddingBottom: 60,
    paddingHorizontal: 40,
  },

  headerBand: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: C.line,
    marginBottom: 20,
  },
  logo: { height: 32, maxWidth: 120, marginBottom: 8, objectFit: "contain" as any, alignSelf: "flex-start" as any },
  companyName: { fontSize: 18, fontFamily: "Helvetica-Bold", color: C.ink, letterSpacing: -0.3 },
  sellerDetail: { fontSize: 8, color: C.faint, marginTop: 2 },

  invoiceTitle: { fontSize: 22, fontFamily: "Helvetica-Bold", color: C.ink, textAlign: "right", letterSpacing: -0.3 },
  invoiceNumber: { fontFamily: "Courier", fontSize: 10, color: C.softMuted, textAlign: "right", marginTop: 2 },
  statusPill: { alignSelf: "flex-end", marginTop: 6, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  statusText: { fontSize: 7, fontFamily: "Helvetica-Bold" },

  datesRow: { flexDirection: "row", marginBottom: 20 },
  dateCol: { flex: 1 },
  sectionLabel: {
    fontSize: 7, fontFamily: "Helvetica-Bold", textTransform: "uppercase" as any,
    letterSpacing: 1.2, color: C.faint, marginBottom: 4,
  },
  dateValue: { fontSize: 10, fontFamily: "Helvetica", color: C.body },

  billRefRow: { flexDirection: "row", marginBottom: 20, gap: 24 },
  billCol: { flex: 1 },
  clientCompany: { fontSize: 11, fontFamily: "Helvetica-Bold", color: C.ink, marginBottom: 2 },
  clientDetail: { fontSize: 9, color: C.muted, marginTop: 1 },
  clientSubDetail: { fontSize: 8, color: C.softMuted, marginTop: 4 },
  refLabel: { fontSize: 8, color: C.faint },
  refValue: { fontSize: 9, fontFamily: "Helvetica-Bold", color: C.strong },
  refRow: { flexDirection: "row", gap: 4, marginBottom: 3 },

  table: { marginBottom: 12 },
  tableHeaderRow: {
    flexDirection: "row",
    borderBottomWidth: 2,
    borderBottomColor: C.ink,
    paddingBottom: 6,
    marginBottom: 6,
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: C.lineSoft,
    paddingVertical: 7,
  },
  thText: {
    fontSize: 7, fontFamily: "Helvetica-Bold", textTransform: "uppercase" as any,
    letterSpacing: 1, color: C.softMuted,
  },
  cellProduct: { fontSize: 9, fontFamily: "Helvetica-Bold", color: C.body },
  cellDesc: { fontSize: 7, color: C.faint, marginTop: 1 },
  cellText: { fontSize: 9, color: C.muted },
  cellBold: { fontSize: 9, fontFamily: "Helvetica-Bold", color: C.body },

  emptyRow: { paddingVertical: 20, alignItems: "center" },
  emptyText: { fontSize: 9, color: C.faint, fontStyle: "italic" },

  totalsWrap: { flexDirection: "row", justifyContent: "flex-end", marginTop: 8 },
  totalsBox: { width: 240 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  totalLabel: { fontSize: 9, color: C.muted, flex: 1, paddingRight: 8 },
  totalValue: { fontSize: 9, color: C.muted, flexShrink: 0 },
  totalDivider: { borderTopWidth: 2, borderTopColor: C.ink, paddingTop: 6, marginTop: 2 },
  totalMainLabel: { fontSize: 10, fontFamily: "Helvetica-Bold", color: C.ink, flex: 1, paddingRight: 8 },
  totalMainValue: { fontSize: 13, fontFamily: "Helvetica-Bold", color: C.ink, flexShrink: 0 },

  sectionDivider: { borderTopWidth: 0.5, borderTopColor: C.lineSoft, paddingTop: 16, marginTop: 16 },
  bankRow: { flexDirection: "row", gap: 32, marginTop: 6 },
  bankLabel: { fontSize: 7, color: C.faint },
  bankValue: { fontFamily: "Courier", fontSize: 9, color: C.strong, marginTop: 1 },
  notesText: { fontSize: 9, color: C.muted, marginTop: 4 },
  termsText: { fontSize: 8, color: C.softMuted, marginTop: 4, lineHeight: 1.5 },

  footer: {
    position: "absolute",
    bottom: 20,
    left: 40,
    right: 40,
    borderTopWidth: 0.5,
    borderTopColor: C.line,
    paddingTop: 8,
  },
  footerText: { fontSize: 7, color: C.faint, textAlign: "center" },
});

const round2 = (v: number) => Math.round(v * 100) / 100;

const COL_W = {
  desc: "38%",
  qty: "7%",
  unit: "8%",
  price: "15%",
  disc: "7%",
  tax: "7%",
  total: "18%",
} as const;

interface Props {
  invoice: Invoice;
  seller?: SellerSettings;
  documentTitle?: string;
  paymentInfo?: { iban?: string; bic?: string };
  footerText?: string;
}

export default function InvoicePdfDocument({ invoice, seller, documentTitle, paymentInfo, footerText }: Props) {
  const lineItems: LineItem[] = invoice.line_items ?? [];
  const references = invoice.references ?? [];
  const currency = invoice.currency || "EUR";
  const statusStyle = STATUS_STYLES[invoice.status] ?? STATUS_STYLES.draft;

  const creditNote = isCreditNote(invoice);
  const rows = lineItems.map((item) => ({ item, ...computeLineItem(item) }));
  // Document level totals stay authoritative — an incoming document's stated totals
  // must be reproduced, not recalculated from lines we reconstructed. The discount
  // and payment figures are derived from them, never the other way round.
  const allowances = invoice.allowances ?? [];
  const allowanceTotal = round2(allowances.reduce((sum, a) => sum + (Number(a.amount) || 0), 0));
  const subtotal = invoice.subtotal ?? rows.reduce((a, r) => a + r.subtotal, 0);
  const totalTax = invoice.total_tax ?? rows.reduce((a, r) => a + r.tax, 0);
  const taxableAmount = round2(subtotal - allowanceTotal);
  const total = invoice.total ?? round2(taxableAmount + totalTax);
  const prepaidAmount = round2(Number(invoice.prepaid_amount ?? 0));
  const amountDue = round2(total - prepaidAmount);
  // Recapped rate by rate only when several rates are in play — with one rate the
  // VAT column of the table already says which one it is. And only when the recap
  // adds up to the VAT of the document: on an incoming document, the stated total
  // wins and a breakdown that contradicts it would be worse than none.
  const vatBreakdown = computeVatBreakdown(lineItems, allowances).filter((line) => line.taxableAmount !== 0);
  const breakdownTax = round2(vatBreakdown.reduce((sum, line) => sum + line.taxAmount, 0));
  const showVatBreakdown = vatBreakdown.length > 1 && breakdownTax === round2(totalTax);

  const notes = invoice.internal_notes === FIELD_NONE ? null : (invoice.internal_notes || seller?.default_notes);
  const terms = invoice.terms === FIELD_NONE ? null : (invoice.terms || seller?.default_terms);
  const accountingTaxCurrency = invoice.tax_currency || "";
  const accountingTaxAmount = Number(invoice.tax_amount_in_tax_currency || 0);
  const iban = paymentInfo?.iban || seller?.iban;
  const bic = paymentInfo?.bic || seller?.bic;

  const defaultFooter = [
    seller?.company_name,
    seller?.vat_number ? `VAT ${seller.vat_number}` : "",
    seller?.email,
  ].filter(Boolean).join(" \u00B7 ");

  return (
    <Document>
      <Page size="A4" style={s.page}>
        <View style={s.headerBand} fixed>
          <View style={{ maxWidth: "55%" }}>
            {seller?.logo && <Image src={seller.logo} style={s.logo} />}
            <Text style={s.companyName}>{seller?.company_name || "Your Company"}</Text>
            {seller?.vat_number && <Text style={s.sellerDetail}>VAT: {seller.vat_number}</Text>}
            {seller?.street && (
              <Text style={s.sellerDetail}>
                {seller.street}
                {seller.city ? `, ${seller.city}` : ""}
                {seller.postal_code ? ` ${seller.postal_code}` : ""}
                {seller.country_code ? `, ${seller.country_code}` : ""}
              </Text>
            )}
            {seller?.email && <Text style={s.sellerDetail}>{seller.email}</Text>}
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={s.invoiceTitle}>{documentTitle || documentTitleFor(invoice)}</Text>
            <Text style={s.invoiceNumber}>{invoice.invoice_number || "—"}</Text>
            {creditNote && invoice.corrected_invoice_number ? (
              <Text style={s.sellerDetail}>
                Re: {invoice.corrected_invoice_number}
                {invoice.corrected_invoice_date ? ` (${formatDate(invoice.corrected_invoice_date)})` : ""}
              </Text>
            ) : null}
            <View style={[s.statusPill, { backgroundColor: statusStyle.bg }]}>
              <Text style={[s.statusText, { color: statusStyle.text }]}>{statusStyle.label}</Text>
            </View>
          </View>
        </View>

        <View style={s.datesRow}>
          {([
            { label: creditNote ? "Credit Note Date" : "Invoice Date", value: formatDate(invoice.invoice_date) || "\u2014" },
            creditNote
              ? { label: "Corrects Invoice", value: invoice.corrected_invoice_number || "\u2014" }
              : { label: "Due Date", value: formatDate(invoice.due_date) || "\u2014" },
            { label: "VAT Treatment", value: VAT_TREATMENT_LABELS[invoice.vat_treatment] || "\u2014" },
          ] as const).map((d) => (
            <View key={d.label} style={s.dateCol}>
              <Text style={s.sectionLabel}>{d.label}</Text>
              <Text style={s.dateValue}>{d.value}</Text>
            </View>
          ))}
        </View>

        <View style={s.billRefRow}>
          <View style={s.billCol}>
            <Text style={s.sectionLabel}>Bill To</Text>
            <Text style={s.clientCompany}>{invoice.client_company || "\u2014"}</Text>
            {invoice.client_vat ? <Text style={[s.clientDetail, { fontSize: 8 }]}>VAT: {invoice.client_vat}</Text> : null}
            {invoice.client_street ? <Text style={s.clientDetail}>{invoice.client_street}</Text> : null}
            {(invoice.client_postal || invoice.client_city) ? (
              <Text style={s.clientDetail}>
                {[invoice.client_postal, invoice.client_city].filter(Boolean).join(" ")}
              </Text>
            ) : null}
            {invoice.client_country ? <Text style={s.clientDetail}>{invoice.client_country}</Text> : null}
            {invoice.client_contact_name ? <Text style={s.clientSubDetail}>{invoice.client_contact_name}</Text> : null}
            {invoice.client_contact_email ? <Text style={[s.clientSubDetail, { marginTop: 1 }]}>{invoice.client_contact_email}</Text> : null}
          </View>

          {references.length > 0 && (
            <View style={s.billCol}>
              <Text style={s.sectionLabel}>References</Text>
              {references.map((ref) => (
                <View key={ref.id} style={s.refRow}>
                  <Text style={s.refLabel}>{ref.label}:</Text>
                  <Text style={s.refValue}>{ref.value || "\u2014"}</Text>
                </View>
              ))}
            </View>
          )}
        </View>

        <View style={s.table}>
          <TableHeader />
          {rows.length === 0 ? (
            <View style={s.emptyRow}>
              <Text style={s.emptyText}>No line items</Text>
            </View>
          ) : (
            // The amount column is the line net amount (EN16931 BT-131): VAT
            // excluded, so the column adds up to the subtotal below it.
            rows.map(({ item, subtotal: rowNet }) => (
              <View key={item.id} style={s.tableRow} wrap={false}>
                <View style={{ width: COL_W.desc, paddingRight: 8 }}>
                  <Text style={s.cellProduct}>{item.product || "\u2014"}</Text>
                  {item.description ? <Text style={s.cellDesc}>{item.description}</Text> : null}
                </View>
                <Text style={[s.cellText, { width: COL_W.qty, textAlign: "right" }]}>{String(item.quantity ?? 0)}</Text>
                <Text style={[s.cellText, { width: COL_W.unit, textAlign: "right" }]}>{item.unit || ""}</Text>
                <Text style={[s.cellText, { width: COL_W.price, textAlign: "right" }]}>{formatCurrency(item.unit_price || 0, currency)}</Text>
                <Text style={[s.cellText, { width: COL_W.disc, textAlign: "right" }]}>{item.discount > 0 ? `${item.discount}%` : "\u2014"}</Text>
                <Text style={[s.cellText, { width: COL_W.tax, textAlign: "right" }]}>{item.tax_rate > 0 ? `${item.tax_rate}%` : "\u2014"}</Text>
                <Text style={[s.cellBold, { width: COL_W.total, textAlign: "right" }]}>{formatCurrency(rowNet, currency)}</Text>
              </View>
            ))
          )}
        </View>

        <View style={s.totalsWrap}>
          <View style={s.totalsBox}>
            {/* The block reads top to bottom as the amount is built: net, what is
                taken off before VAT, the VAT, then what was already paid — which
                comes off after the VAT and never changes it. */}
            <View style={s.totalRow}>
              <Text style={s.totalLabel}>Subtotal excl. VAT</Text>
              <Text style={s.totalValue}>{formatCurrency(subtotal, currency)}</Text>
            </View>
            {allowances.map((allowance) => (
              <View key={allowance.id} style={s.totalRow}>
                <Text style={s.totalLabel}>Discount{allowance.reason ? ` — ${allowance.reason}` : ""}</Text>
                <Text style={s.totalValue}>-{formatCurrency(allowance.amount, currency)}</Text>
              </View>
            ))}
            {allowanceTotal > 0 && (
              <View style={s.totalRow}>
                <Text style={s.totalLabel}>Total excl. VAT</Text>
                <Text style={s.totalValue}>{formatCurrency(taxableAmount, currency)}</Text>
              </View>
            )}
            {showVatBreakdown && vatBreakdown.map((line) => (
              <View key={line.taxRate} style={s.totalRow}>
                <Text style={s.totalLabel}>
                  VAT {line.taxRate}% on {formatCurrency(line.taxableAmount, currency)}
                </Text>
                <Text style={s.totalValue}>{formatCurrency(line.taxAmount, currency)}</Text>
              </View>
            ))}
            {!showVatBreakdown && totalTax > 0 && (
              <View style={s.totalRow}>
                <Text style={s.totalLabel}>VAT</Text>
                <Text style={s.totalValue}>{formatCurrency(totalTax, currency)}</Text>
              </View>
            )}
            {accountingTaxCurrency && accountingTaxAmount !== 0 && accountingTaxCurrency !== currency && (
              <View style={s.totalRow}>
                <Text style={s.totalLabel}>VAT payable ({accountingTaxCurrency})</Text>
                <Text style={s.totalValue}>{formatCurrency(accountingTaxAmount, accountingTaxCurrency)}</Text>
              </View>
            )}
            {prepaidAmount > 0 && (
              <>
                <View style={s.totalRow}>
                  <Text style={s.totalLabel}>Total incl. VAT</Text>
                  <Text style={s.totalValue}>{formatCurrency(total, currency)}</Text>
                </View>
                <View style={s.totalRow}>
                  <Text style={s.totalLabel}>
                    Already paid{invoice.prepaid_reference ? ` — ${invoice.prepaid_reference}` : ""}
                  </Text>
                  <Text style={s.totalValue}>-{formatCurrency(prepaidAmount, currency)}</Text>
                </View>
              </>
            )}
            <View style={s.totalDivider}>
              <View style={[s.totalRow, { marginBottom: 0 }]}>
                <Text style={s.totalMainLabel}>{creditNote ? "Total credited" : "Amount due"} ({currency})</Text>
                <Text style={s.totalMainValue}>{formatCurrency(amountDue, currency)}</Text>
              </View>
            </View>
          </View>
        </View>

        {(iban || bic) && (
          <View style={s.sectionDivider}>
            <Text style={s.sectionLabel}>Bank Details</Text>
            <View style={s.bankRow}>
              {iban && (
                <View>
                  <Text style={s.bankLabel}>IBAN</Text>
                  <Text style={s.bankValue}>{iban}</Text>
                </View>
              )}
              {bic && (
                <View>
                  <Text style={s.bankLabel}>BIC</Text>
                  <Text style={s.bankValue}>{bic}</Text>
                </View>
              )}
            </View>
          </View>
        )}

        {notes && (
          <View style={s.sectionDivider}>
            <Text style={s.sectionLabel}>Notes</Text>
            <Text style={s.notesText}>{notes}</Text>
          </View>
        )}

        {accountingTaxCurrency && accountingTaxAmount !== 0 && invoice.tax_exchange_rate && invoice.tax_exchange_rate_date && (
          <View style={s.sectionDivider}>
            <Text style={s.sectionLabel}>VAT Accounting Currency</Text>
            <Text style={s.notesText}>
              VAT payable: {formatCurrency(accountingTaxAmount, accountingTaxCurrency)}. Exchange rate: {invoice.tax_exchange_rate} on {formatDate(invoice.tax_exchange_rate_date)}.
            </Text>
          </View>
        )}

        {terms && (
          <View style={s.sectionDivider}>
            <Text style={s.sectionLabel}>Terms & Conditions</Text>
            <Text style={s.termsText}>{terms}</Text>
          </View>
        )}

        <View style={s.footer} fixed>
          <Text style={s.footerText}>{footerText || defaultFooter}</Text>
        </View>
      </Page>
    </Document>
  );
}

function TableHeader() {
  return (
    <View style={s.tableHeaderRow} fixed>
      <Text style={[s.thText, { width: COL_W.desc, textAlign: "left" }]}>Description</Text>
      <Text style={[s.thText, { width: COL_W.qty, textAlign: "right" }]}>Qty</Text>
      <Text style={[s.thText, { width: COL_W.unit, textAlign: "right" }]}>Unit</Text>
      <Text style={[s.thText, { width: COL_W.price, textAlign: "right" }]}>Price</Text>
      <Text style={[s.thText, { width: COL_W.disc, textAlign: "right" }]}>Disc.</Text>
      <Text style={[s.thText, { width: COL_W.tax, textAlign: "right" }]}>VAT</Text>
      <Text style={[s.thText, { width: COL_W.total, textAlign: "right" }]}>Excl. VAT</Text>
    </View>
  );
}
