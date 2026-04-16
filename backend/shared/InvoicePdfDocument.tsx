import React from "react";
import { Document, Page, View, Text, Image, StyleSheet, Font } from "@react-pdf/renderer";
import type { Invoice, LineItem, SellerSettings } from "./invoice-types";
import { computeLineItem, formatCurrency, formatDate, FIELD_NONE, VAT_TREATMENT_LABELS, STATUS_STYLES } from "./invoice-types";

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
  totalsBox: { width: 200 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  totalLabel: { fontSize: 9, color: C.muted },
  totalValue: { fontSize: 9, color: C.muted },
  totalDivider: { borderTopWidth: 2, borderTopColor: C.ink, paddingTop: 6, marginTop: 2 },
  totalMainLabel: { fontSize: 10, fontFamily: "Helvetica-Bold", color: C.ink },
  totalMainValue: { fontSize: 13, fontFamily: "Helvetica-Bold", color: C.ink },

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
}

export default function InvoicePdfDocument({ invoice, seller }: Props) {
  const lineItems: LineItem[] = invoice.line_items ?? [];
  const references = invoice.references ?? [];
  const currency = invoice.currency || "EUR";
  const statusStyle = STATUS_STYLES[invoice.status] ?? STATUS_STYLES.draft;

  const rows = lineItems.map((item) => ({ item, ...computeLineItem(item) }));
  const subtotal = rows.reduce((a, r) => a + r.subtotal, 0);
  const totalTax = rows.reduce((a, r) => a + r.tax, 0);
  const total = subtotal + totalTax;

  const notes = invoice.internal_notes === FIELD_NONE ? null : (invoice.internal_notes || seller?.default_notes);
  const terms = invoice.terms === FIELD_NONE ? null : (invoice.terms || seller?.default_terms);

  const footerParts = [
    seller?.company_name,
    seller?.vat_number ? `VAT ${seller.vat_number}` : "",
    seller?.email,
  ].filter(Boolean);

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
            <Text style={s.invoiceTitle}>INVOICE</Text>
            <Text style={s.invoiceNumber}>{invoice.invoice_number || "INV-XXXXXX"}</Text>
            <View style={[s.statusPill, { backgroundColor: statusStyle.bg }]}>
              <Text style={[s.statusText, { color: statusStyle.text }]}>{statusStyle.label}</Text>
            </View>
          </View>
        </View>

        <View style={s.datesRow}>
          {([
            { label: "Invoice Date", value: formatDate(invoice.invoice_date) || "\u2014" },
            { label: "Due Date", value: formatDate(invoice.due_date) || "\u2014" },
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
            rows.map(({ item, total: rowTotal }) => (
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
                <Text style={[s.cellBold, { width: COL_W.total, textAlign: "right" }]}>{formatCurrency(rowTotal, currency)}</Text>
              </View>
            ))
          )}
        </View>

        <View style={s.totalsWrap}>
          <View style={s.totalsBox}>
            <View style={s.totalRow}>
              <Text style={s.totalLabel}>Subtotal</Text>
              <Text style={s.totalValue}>{formatCurrency(subtotal, currency)}</Text>
            </View>
            {totalTax > 0 && (
              <View style={s.totalRow}>
                <Text style={s.totalLabel}>VAT</Text>
                <Text style={s.totalValue}>{formatCurrency(totalTax, currency)}</Text>
              </View>
            )}
            <View style={s.totalDivider}>
              <View style={[s.totalRow, { marginBottom: 0 }]}>
                <Text style={s.totalMainLabel}>Total ({currency})</Text>
                <Text style={s.totalMainValue}>{formatCurrency(total, currency)}</Text>
              </View>
            </View>
          </View>
        </View>

        {(seller?.iban || seller?.bic) && (
          <View style={s.sectionDivider}>
            <Text style={s.sectionLabel}>Bank Details</Text>
            <View style={s.bankRow}>
              {seller.iban && (
                <View>
                  <Text style={s.bankLabel}>IBAN</Text>
                  <Text style={s.bankValue}>{seller.iban}</Text>
                </View>
              )}
              {seller.bic && (
                <View>
                  <Text style={s.bankLabel}>BIC</Text>
                  <Text style={s.bankValue}>{seller.bic}</Text>
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

        {terms && (
          <View style={s.sectionDivider}>
            <Text style={s.sectionLabel}>Terms & Conditions</Text>
            <Text style={s.termsText}>{terms}</Text>
          </View>
        )}

        <View style={s.footer} fixed>
          <Text style={s.footerText}>{footerParts.join(" \u00B7 ")}</Text>
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
      <Text style={[s.thText, { width: COL_W.tax, textAlign: "right" }]}>Tax</Text>
      <Text style={[s.thText, { width: COL_W.total, textAlign: "right" }]}>Total</Text>
    </View>
  );
}
