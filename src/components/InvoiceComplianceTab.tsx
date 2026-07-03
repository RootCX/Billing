import type { Invoice } from "../types";
import { IconAlertCircle, IconCircleCheck } from "@tabler/icons-react";
import { cn } from "@/lib/utils";

interface Props {
  draft: Partial<Invoice>;
}

interface ComplianceItem {
  label: string;
  ok: boolean;
}

interface ComplianceSection {
  title: string;
  items: ComplianceItem[];
}

function buildCompliance(draft: Partial<Invoice>): ComplianceSection[] {
  const currency = (draft.currency ?? "EUR").toUpperCase();
  const needsAccountingTaxCurrency =
    currency !== "EUR"
    && draft.vat_treatment === "standard"
    && Number(draft.total_tax ?? 0) > 0;

  const sections: ComplianceSection[] = [
    {
      title: "Invoice Details",
      items: [
        { label: "Invoice Number", ok: !!draft.invoice_number?.trim() },
        { label: "Invoice Date", ok: !!draft.invoice_date },
        { label: "Due Date", ok: !!draft.due_date },
        { label: "Currency", ok: !!draft.currency },
      ],
    },
    {
      title: "Client Information",
      items: [
        { label: "Company Name", ok: !!draft.client_company?.trim() },
        { label: "VAT Number", ok: !!draft.client_vat?.trim() },
        { label: "Street Address", ok: !!draft.client_street?.trim() },
        { label: "City", ok: !!draft.client_city?.trim() },
        { label: "Postal Code", ok: !!draft.client_postal?.trim() },
      ],
    },
    {
      title: "Line Items",
      items: [
        { label: "At least one line item is required", ok: (draft.line_items ?? []).length > 0 },
      ],
    },
  ];

  if (needsAccountingTaxCurrency) {
    sections.push({
      title: "VAT Accounting Currency",
      items: [
        { label: "VAT accounting currency", ok: !!draft.tax_currency?.trim() },
        { label: "VAT amount in accounting currency", ok: Number(draft.tax_amount_in_tax_currency ?? 0) !== 0 },
        { label: "Exchange rate", ok: Number(draft.tax_exchange_rate ?? 0) > 0 },
        { label: "Exchange rate date", ok: !!draft.tax_exchange_rate_date },
      ],
    });
  }

  return sections;
}

export default function InvoiceComplianceTab({ draft }: Props) {
  const sections = buildCompliance(draft);

  const totalIssues = sections.reduce(
    (acc, s) => acc + s.items.filter((i) => !i.ok).length,
    0,
  );

  return (
    <div className="space-y-4 text-sm">
      {/* Summary */}
      <div className={cn(
        "rounded-md border p-3 flex items-start gap-3",
        totalIssues === 0
          ? "border-green-200 bg-green-50 text-green-800"
          : "border-amber-200 bg-amber-50 text-amber-800",
      )}>
        {totalIssues === 0 ? (
          <IconCircleCheck className="h-5 w-5 shrink-0 text-green-600 mt-0.5" />
        ) : (
          <IconAlertCircle className="h-5 w-5 shrink-0 text-amber-600 mt-0.5" />
        )}
        <div>
          <p className="font-semibold">
            {totalIssues === 0
              ? "Invoice is complete"
              : `${totalIssues} missing field${totalIssues === 1 ? "" : "s"}`}
          </p>
          <p className="text-xs mt-0.5 opacity-80">
            {totalIssues === 0
              ? "All required fields are filled in."
              : "Fill in the highlighted fields before sending."}
          </p>
        </div>
      </div>

      {sections.map((section) => {
        const issues = section.items.filter((i) => !i.ok).length;
        return (
          <div key={section.title} className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {section.title}
              </p>
              {issues > 0 && (
                <span className="text-[10px] font-semibold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded-full">
                  {issues} missing
                </span>
              )}
            </div>
            <div className="space-y-1.5">
              {section.items
                .filter((i) => !i.ok)
                .map((item) => (
                  <div
                    key={item.label}
                    className="flex items-center gap-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded px-2.5 py-1.5"
                  >
                    <IconAlertCircle className="h-3.5 w-3.5 shrink-0 text-amber-600" />
                    {item.label}
                  </div>
                ))}
              {section.items.filter((i) => !i.ok).length === 0 && (
                <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded px-2.5 py-1.5">
                  <IconCircleCheck className="h-3.5 w-3.5 shrink-0 text-green-600" />
                  All fields complete
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
