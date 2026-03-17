import type { Invoice, LineItem } from "../types";
import { computeLineItem, formatCurrency, formatDate, REFERENCE_TYPE_LABELS } from "../types";
import { useAppCollection } from "@rootcx/sdk";
import type { SellerSettings } from "../types";
import { cn } from "@/lib/utils";

const APP_ID = "billing";

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  draft:     { bg: "bg-gray-100",   text: "text-gray-600",  label: "DRAFT" },
  sent:      { bg: "bg-blue-100",   text: "text-blue-700",  label: "SENT" },
  paid:      { bg: "bg-green-100",  text: "text-green-700", label: "PAID" },
  overdue:   { bg: "bg-red-100",    text: "text-red-700",   label: "OVERDUE" },
  cancelled: { bg: "bg-gray-100",   text: "text-gray-500",  label: "CANCELLED" },
};

const VAT_TREATMENT_LABELS: Record<string, string> = {
  standard: "Standard",
  exempt: "Exempt",
  reverse_charge: "Reverse Charge",
  intra_eu: "Intra-EU",
  export: "Export",
};

interface Props {
  invoice: Invoice;
}

export default function InvoicePreview({ invoice }: Props) {
  const { data: settings } = useAppCollection<SellerSettings>(APP_ID, "seller_settings");
  const seller = settings?.[0];

  const lineItems: LineItem[] = invoice.line_items ?? [];
  const references = invoice.references ?? [];
  const statusStyle = STATUS_STYLES[invoice.status] ?? STATUS_STYLES.draft;
  const currency = invoice.currency || "EUR";

  // Compute totals per item
  const rows = lineItems.map((item) => ({
    item,
    ...computeLineItem(item),
  }));

  const subtotal = rows.reduce((a, r) => a + r.subtotal, 0);
  const totalTax = rows.reduce((a, r) => a + r.tax, 0);
  const total = subtotal + totalTax;

  return (
    <div className="max-w-3xl mx-auto">
      {/* Paper */}
      <div className="bg-white shadow-md rounded-lg overflow-hidden print:shadow-none" style={{ fontFamily: "'Inter', sans-serif" }}>
        {/* Header band */}
        <div className="bg-slate-900 px-10 py-8 text-white">
          <div className="flex items-start justify-between">
            {/* Seller info */}
            <div>
              {seller?.logo_url && (
                <img src={seller.logo_url} alt="Logo" className="h-10 mb-3 object-contain" />
              )}
              <p className="text-xl font-bold tracking-tight">{seller?.company_name || "Your Company"}</p>
              {seller?.vat_number && (
                <p className="text-slate-400 text-xs mt-0.5">VAT: {seller.vat_number}</p>
              )}
              {seller?.street && (
                <p className="text-slate-300 text-xs mt-1">
                  {seller.street}{seller.city ? `, ${seller.city}` : ""}{seller.postal_code ? ` ${seller.postal_code}` : ""}
                  {seller.country_code ? `, ${seller.country_code}` : ""}
                </p>
              )}
              {seller?.email && <p className="text-slate-400 text-xs mt-0.5">{seller.email}</p>}
            </div>

            {/* Invoice identity */}
            <div className="text-right">
              <p className="text-2xl font-black tracking-tight mb-1">INVOICE</p>
              <p className="font-mono text-slate-300 text-sm">{invoice.invoice_number || "INV-XXXXXX"}</p>
              <span className={cn("inline-block mt-2 px-2.5 py-0.5 rounded-full text-xs font-bold", statusStyle.bg, statusStyle.text)}>
                {statusStyle.label}
              </span>
            </div>
          </div>
        </div>

        <div className="px-10 py-8 space-y-8">
          {/* Dates row */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-0.5">Invoice Date</p>
              <p className="text-sm font-medium text-slate-800">{formatDate(invoice.invoice_date) || "—"}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-0.5">Due Date</p>
              <p className="text-sm font-medium text-slate-800">{formatDate(invoice.due_date) || "—"}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-0.5">VAT Treatment</p>
              <p className="text-sm font-medium text-slate-800">{VAT_TREATMENT_LABELS[invoice.vat_treatment] || "—"}</p>
            </div>
          </div>

          {/* Bill to */}
          <div className="grid grid-cols-2 gap-8">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-2">Bill To</p>
              <p className="font-semibold text-slate-900">{invoice.client_company || <span className="text-slate-400 italic">Company name</span>}</p>
              {invoice.client_vat && <p className="text-slate-500 text-xs mt-0.5">VAT: {invoice.client_vat}</p>}
              {invoice.client_street && <p className="text-slate-600 text-sm mt-1">{invoice.client_street}</p>}
              {(invoice.client_city || invoice.client_postal) && (
                <p className="text-slate-600 text-sm">
                  {[invoice.client_postal, invoice.client_city].filter(Boolean).join(" ")}
                </p>
              )}
              {invoice.client_country && <p className="text-slate-600 text-sm">{invoice.client_country}</p>}
              {invoice.client_contact_name && (
                <p className="text-slate-500 text-xs mt-2">{invoice.client_contact_name}</p>
              )}
              {invoice.client_contact_email && (
                <p className="text-slate-500 text-xs">{invoice.client_contact_email}</p>
              )}
            </div>

            {/* References */}
            {references.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-2">References</p>
                <div className="space-y-1">
                  {references.map((ref) => (
                    <div key={ref.id} className="flex gap-2 text-sm">
                      <span className="text-slate-400 min-w-0 shrink-0">{ref.label}:</span>
                      <span className="text-slate-700 font-medium">{ref.value || "—"}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Line items table */}
          <div>
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b-2 border-slate-900">
                  <th className="text-left py-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500 w-[40%]">Description</th>
                  <th className="text-right py-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Qty</th>
                  <th className="text-right py-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Unit</th>
                  <th className="text-right py-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Price</th>
                  <th className="text-right py-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Disc.</th>
                  <th className="text-right py-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Tax</th>
                  <th className="text-right py-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Total</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-400 text-sm italic">
                      No line items yet
                    </td>
                  </tr>
                ) : (
                  rows.map(({ item, subtotal: rowSub, total: rowTotal }) => (
                    <tr key={item.id} className="border-b border-slate-100">
                      <td className="py-3 pr-4">
                        <p className="font-medium text-slate-800">{item.product}</p>
                        {item.description && (
                          <p className="text-slate-400 text-xs mt-0.5">{item.description}</p>
                        )}
                      </td>
                      <td className="py-3 text-right text-slate-600 tabular-nums">{item.quantity}</td>
                      <td className="py-3 text-right text-slate-600">{item.unit}</td>
                      <td className="py-3 text-right text-slate-600 tabular-nums">{formatCurrency(item.unit_price, currency)}</td>
                      <td className="py-3 text-right text-slate-600">
                        {item.discount > 0 ? `${item.discount}%` : "—"}
                      </td>
                      <td className="py-3 text-right text-slate-600">
                        {item.tax_rate > 0 ? `${item.tax_rate}%` : "—"}
                      </td>
                      <td className="py-3 text-right font-semibold text-slate-800 tabular-nums">{formatCurrency(rowTotal, currency)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Totals */}
          <div className="flex justify-end">
            <div className="w-64 space-y-2">
              <div className="flex justify-between text-sm text-slate-600">
                <span>Subtotal</span>
                <span className="tabular-nums">{formatCurrency(subtotal, currency)}</span>
              </div>
              {totalTax > 0 && (
                <div className="flex justify-between text-sm text-slate-600">
                  <span>VAT</span>
                  <span className="tabular-nums">{formatCurrency(totalTax, currency)}</span>
                </div>
              )}
              <div className="border-t-2 border-slate-900 pt-2 flex justify-between font-bold text-slate-900">
                <span>Total ({currency})</span>
                <span className="tabular-nums text-lg">{formatCurrency(total, currency)}</span>
              </div>
            </div>
          </div>

          {/* Bank details */}
          {(seller?.iban || seller?.bic) && (
            <div className="border-t border-slate-100 pt-6">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-2">Bank Details</p>
              <div className="flex gap-8 text-sm">
                {seller.iban && (
                  <div>
                    <p className="text-slate-400 text-xs">IBAN</p>
                    <p className="font-mono text-slate-700">{seller.iban}</p>
                  </div>
                )}
                {seller.bic && (
                  <div>
                    <p className="text-slate-400 text-xs">BIC</p>
                    <p className="font-mono text-slate-700">{seller.bic}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Notes & Terms */}
          {(invoice.internal_notes || invoice.terms) && (
            <div className="border-t border-slate-100 pt-6 grid grid-cols-2 gap-8">
              {invoice.internal_notes && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-1.5">Notes</p>
                  <p className="text-sm text-slate-600 whitespace-pre-line">{invoice.internal_notes}</p>
                </div>
              )}
              {invoice.terms && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-1.5">Terms &amp; Conditions</p>
                  <p className="text-sm text-slate-600 whitespace-pre-line">{invoice.terms}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="bg-slate-50 border-t border-slate-200 px-10 py-4">
          <p className="text-center text-xs text-slate-400">
            {seller?.company_name || "Your Company"}
            {seller?.vat_number ? ` · VAT ${seller.vat_number}` : ""}
            {seller?.email ? ` · ${seller.email}` : ""}
          </p>
        </div>
      </div>
    </div>
  );
}
