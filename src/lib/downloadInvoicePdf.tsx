import { createRoot } from "react-dom/client";
import type { Invoice, LineItem, SellerSettings } from "../types";
import { computeLineItem, formatCurrency, formatDate } from "../types";
import { cn } from "@/lib/utils";

const VAT_TREATMENT_LABELS: Record<string, string> = {
  standard: "Standard", exempt: "Exempt", reverse_charge: "Reverse Charge",
  intra_eu: "Intra-EU", export: "Export",
};

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  draft:     { bg: "bg-gray-100",  text: "text-gray-600",  label: "DRAFT" },
  sent:      { bg: "bg-blue-100",  text: "text-blue-700",  label: "SENT" },
  paid:      { bg: "bg-green-100", text: "text-green-700", label: "PAID" },
  overdue:   { bg: "bg-red-100",   text: "text-red-700",   label: "OVERDUE" },
  cancelled: { bg: "bg-gray-100",  text: "text-gray-500",  label: "CANCELLED" },
};

const lbl: React.CSSProperties = {
  fontSize: 10, fontWeight: 600, textTransform: "uppercase",
  letterSpacing: "0.1em", color: "#94a3b8", marginBottom: 6,
};

const sec: React.CSSProperties = { borderTop: "1px solid #f1f5f9", paddingTop: 24, marginTop: 24 };

function InvoicePrintContent({ invoice, seller }: { invoice: Invoice; seller: SellerSettings | undefined }) {
  const lineItems: LineItem[] = invoice.line_items ?? [];
  const references = invoice.references ?? [];
  const currency = invoice.currency || "EUR";
  const rows = lineItems.map((item) => ({ item, ...computeLineItem(item) }));
  const subtotal = rows.reduce((a, r) => a + r.subtotal, 0);
  const totalTax = rows.reduce((a, r) => a + r.tax, 0);
  const total = subtotal + totalTax;
  const statusStyle = STATUS_STYLES[invoice.status] ?? STATUS_STYLES.draft;

  // Single root div — no nested block containers — so browser paginates content naturally
  return (
    <div style={{ fontFamily: "system-ui, -apple-system, sans-serif", color: "#1e293b", background: "white", padding: "24px 32px", WebkitPrintColorAdjust: "exact", printColorAdjust: "exact" as any }}>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", paddingBottom: 24, marginBottom: 24, borderBottom: "1px solid #e2e8f0" }}>
        <div>
          {seller?.logo && <img src={seller.logo} alt="Logo" style={{ height: 40, objectFit: "contain", marginBottom: 12, display: "block" }} />}
          <div style={{ fontSize: 22, fontWeight: 900, color: "#0f172a" }}>{seller?.company_name || "Your Company"}</div>
          {seller?.vat_number && <div style={{ color: "#94a3b8", fontSize: 12, marginTop: 2 }}>VAT: {seller.vat_number}</div>}
          {seller?.street && (
            <div style={{ color: "#94a3b8", fontSize: 12, marginTop: 4 }}>
              {seller.street}{seller.city ? `, ${seller.city}` : ""}{seller.postal_code ? ` ${seller.postal_code}` : ""}{seller.country_code ? `, ${seller.country_code}` : ""}
            </div>
          )}
          {seller?.email && <div style={{ color: "#94a3b8", fontSize: 12, marginTop: 2 }}>{seller.email}</div>}
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 26, fontWeight: 900, color: "#0f172a", marginBottom: 4 }}>INVOICE</div>
          <div style={{ fontFamily: "monospace", color: "#64748b", fontSize: 14 }}>{invoice.invoice_number || "INV-XXXXXX"}</div>
          <div style={{ marginTop: 8 }}>
            <span className={cn("inline-block px-2.5 py-0.5 rounded-full text-xs font-bold", statusStyle.bg, statusStyle.text)}>
              {statusStyle.label}
            </span>
          </div>
        </div>
      </div>

      {/* Dates */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 24 }}>
        {[
          { label: "Invoice Date", value: formatDate(invoice.invoice_date) || "—" },
          { label: "Due Date",     value: formatDate(invoice.due_date) || "—" },
          { label: "VAT Treatment", value: VAT_TREATMENT_LABELS[invoice.vat_treatment] || "—" },
        ].map(({ label, value }) => (
          <div key={label}>
            <div style={lbl}>{label}</div>
            <div style={{ fontSize: 13, fontWeight: 500, color: "#1e293b" }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Bill To + References */}
      <div style={{ display: "grid", gridTemplateColumns: references.length > 0 ? "1fr 1fr" : "1fr", gap: 32, marginBottom: 24 }}>
        <div>
          <div style={lbl}>Bill To</div>
          <div style={{ fontWeight: 600, color: "#0f172a", fontSize: 14 }}>{invoice.client_company || <span style={{ color: "#94a3b8", fontStyle: "italic" }}>Company name</span>}</div>
          {invoice.client_vat           && <div style={{ color: "#64748b", fontSize: 12, marginTop: 2 }}>VAT: {invoice.client_vat}</div>}
          {invoice.client_street        && <div style={{ color: "#475569", fontSize: 13, marginTop: 4 }}>{invoice.client_street}</div>}
          {(invoice.client_city || invoice.client_postal) && <div style={{ color: "#475569", fontSize: 13 }}>{[invoice.client_postal, invoice.client_city].filter(Boolean).join(" ")}</div>}
          {invoice.client_country       && <div style={{ color: "#475569", fontSize: 13 }}>{invoice.client_country}</div>}
          {invoice.client_contact_name  && <div style={{ color: "#64748b", fontSize: 12, marginTop: 8 }}>{invoice.client_contact_name}</div>}
          {invoice.client_contact_email && <div style={{ color: "#64748b", fontSize: 12 }}>{invoice.client_contact_email}</div>}
        </div>
        {references.length > 0 && (
          <div>
            <div style={lbl}>References</div>
            {references.map((ref) => (
              <div key={ref.id} style={{ display: "flex", gap: 8, fontSize: 13, marginBottom: 4 }}>
                <span style={{ color: "#94a3b8" }}>{ref.label}:</span>
                <span style={{ color: "#334155", fontWeight: 500 }}>{ref.value || "—"}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Line items */}
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: "2px solid #0f172a" }}>
            {["Description", "Qty", "Unit", "Price", "Disc.", "Tax", "Total"].map((h, i) => (
              <th key={h} style={{ textAlign: i === 0 ? "left" : "right", padding: i === 0 ? "8px 16px 8px 0" : "8px", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.1em", color: "#64748b", width: i === 0 ? "38%" : undefined }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={7} style={{ padding: 24, textAlign: "center", color: "#9ca3af", fontStyle: "italic" }}>No line items</td></tr>
          ) : rows.map(({ item, total: rowTotal }) => (
            <tr key={item.id}>
              <td style={{ padding: "10px 16px 10px 0", borderBottom: "1px solid #f1f5f9", verticalAlign: "top" }}>
                <div style={{ fontWeight: 600, color: "#1e293b" }}>{item.product}</div>
                {item.description && <div style={{ color: "#94a3b8", fontSize: 11, marginTop: 2 }}>{item.description}</div>}
              </td>
              <td style={{ padding: "10px 8px", borderBottom: "1px solid #f1f5f9", textAlign: "right", color: "#475569" }}>{item.quantity}</td>
              <td style={{ padding: "10px 8px", borderBottom: "1px solid #f1f5f9", textAlign: "right", color: "#475569" }}>{item.unit}</td>
              <td style={{ padding: "10px 8px", borderBottom: "1px solid #f1f5f9", textAlign: "right", color: "#475569", fontVariantNumeric: "tabular-nums" }}>{formatCurrency(item.unit_price, currency)}</td>
              <td style={{ padding: "10px 8px", borderBottom: "1px solid #f1f5f9", textAlign: "right", color: "#475569" }}>{item.discount > 0 ? `${item.discount}%` : "—"}</td>
              <td style={{ padding: "10px 8px", borderBottom: "1px solid #f1f5f9", textAlign: "right", color: "#475569" }}>{item.tax_rate > 0 ? `${item.tax_rate}%` : "—"}</td>
              <td style={{ padding: "10px 0 10px 8px", borderBottom: "1px solid #f1f5f9", textAlign: "right", fontWeight: 600, color: "#1e293b", fontVariantNumeric: "tabular-nums" }}>{formatCurrency(rowTotal, currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Totals */}
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
        <div style={{ width: 240 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#475569", marginBottom: 8 }}>
            <span>Subtotal</span><span style={{ fontVariantNumeric: "tabular-nums" }}>{formatCurrency(subtotal, currency)}</span>
          </div>
          {totalTax > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#475569", marginBottom: 8 }}>
              <span>VAT</span><span style={{ fontVariantNumeric: "tabular-nums" }}>{formatCurrency(totalTax, currency)}</span>
            </div>
          )}
          <div style={{ borderTop: "2px solid #0f172a", paddingTop: 8, display: "flex", justifyContent: "space-between", fontWeight: 700, color: "#0f172a" }}>
            <span>Total ({currency})</span>
            <span style={{ fontSize: 16, fontVariantNumeric: "tabular-nums" }}>{formatCurrency(total, currency)}</span>
          </div>
        </div>
      </div>

      {/* Bank details */}
      {(seller?.iban || seller?.bic) && (
        <div style={sec}>
          <div style={lbl}>Bank Details</div>
          <div style={{ display: "flex", gap: 32 }}>
            {seller.iban && <div><div style={{ color: "#94a3b8", fontSize: 11 }}>IBAN</div><div style={{ fontFamily: "monospace", color: "#334155" }}>{seller.iban}</div></div>}
            {seller.bic  && <div><div style={{ color: "#94a3b8", fontSize: 11 }}>BIC</div><div style={{ fontFamily: "monospace", color: "#334155" }}>{seller.bic}</div></div>}
          </div>
        </div>
      )}

      {/* Notes */}
      {invoice.internal_notes && (
        <div style={sec}>
          <div style={lbl}>Notes</div>
          <div style={{ fontSize: 13, color: "#475569", whiteSpace: "pre-wrap" }}>{invoice.internal_notes}</div>
        </div>
      )}

      {/* Terms & Conditions */}
      {(invoice.terms || seller?.default_terms) && (
        <div style={sec}>
          <div style={lbl}>Terms & Conditions</div>
          <div style={{ fontSize: 11, color: "#64748b", whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{invoice.terms || seller?.default_terms}</div>
        </div>
      )}

      {/* Footer */}
      <div style={{ borderTop: "1px solid #e2e8f0", marginTop: 24, paddingTop: 16, textAlign: "center" }}>
        <span style={{ fontSize: 11, color: "#94a3b8" }}>
          {seller?.company_name || "Your Company"}
          {seller?.vat_number ? ` · VAT ${seller.vat_number}` : ""}
          {seller?.email ? ` · ${seller.email}` : ""}
        </span>
      </div>

    </div>
  );
}

export function downloadInvoicePdf(invoice: Invoice, seller: SellerSettings | undefined) {
  let printRoot = document.getElementById("print-root");
  if (!printRoot) {
    printRoot = document.createElement("div");
    printRoot.id = "print-root";
    document.body.appendChild(printRoot);
  }

  const root = createRoot(printRoot);
  root.render(<InvoicePrintContent invoice={invoice} seller={seller} />);

  setTimeout(() => {
    window.print();
    setTimeout(() => root.unmount(), 1000);
  }, 100);
}
