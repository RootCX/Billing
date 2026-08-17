import type { Invoice } from "../types";
import { IconAlertCircle, IconCircleCheck } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { buildCompliance } from "@/lib/invoiceCompliance";

interface Props {
  draft: Partial<Invoice>;
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
              ? "Ready to send"
              : `${totalIssues} issue${totalIssues === 1 ? "" : "s"} to fix`}
          </p>
          <p className="text-xs mt-0.5 opacity-80">
            {totalIssues === 0
              ? "Everything Peppol requires is in place."
              : "Peppol refuses the document until these are resolved."}
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
                  {issues} to fix
                </span>
              )}
            </div>
            <div className="space-y-1.5">
              {section.items
                .filter((i) => !i.ok)
                .map((item) => (
                  <div
                    key={item.label}
                    className="flex items-start gap-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded px-2.5 py-1.5"
                  >
                    <IconAlertCircle className="h-3.5 w-3.5 shrink-0 text-amber-600 mt-0.5" />
                    <div>
                      <p>{item.label}</p>
                      {/* The hint says what to do instead — a rule name alone helps nobody. */}
                      {item.hint && <p className="text-xs opacity-80 mt-0.5">{item.hint}</p>}
                    </div>
                  </div>
                ))}
              {issues === 0 && (
                <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded px-2.5 py-1.5">
                  <IconCircleCheck className="h-3.5 w-3.5 shrink-0 text-green-600" />
                  All good
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
