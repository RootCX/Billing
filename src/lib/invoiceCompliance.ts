/**
 * What has to be true before a document can go on the Peppol network.
 *
 * Two kinds of checks live here:
 *  - missing data (no VAT number, no address, no line) — the document is simply
 *    incomplete;
 *  - rule violations (a negative unit price, a discount without a reason) — the
 *    document is complete but the network will reject it.
 *
 * Both block the send. Keeping them in one place is what makes the Compliance
 * tab and the "Send via Peppol" button agree; when they disagreed, the user got a
 * document accepted by the app and refused by the network with no explanation.
 */
import type { DocumentAllowance, Invoice, LineItem } from "../types";
import { computeDocumentTotals, computeLineItem } from "../types";

export interface ComplianceItem {
  label: string;
  ok: boolean;
  /** Shown under the label when the check fails: why, and what to do instead. */
  hint?: string;
}

export interface ComplianceSection {
  title: string;
  items: ComplianceItem[];
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/**
 * A check whose label says how many rows fail it, so the user knows the size of
 * the problem before opening the section.
 */
function countedCheck(failures: number, okLabel: string, failLabel: (count: string) => string, hint: string): ComplianceItem {
  return {
    label: failures === 0 ? okLabel : failLabel(plural(failures, "discount")),
    ok: failures === 0,
    hint,
  };
}

function prepaidCheck(prepaidAmount: number, amountDue: number): ComplianceItem {
  if (prepaidAmount < 0) {
    return {
      label: "Already paid must be a positive amount",
      ok: false,
      hint: "Enter what the customer has paid, not a deduction — it is subtracted for you.",
    };
  }
  // Only compared to the total when something was actually paid — otherwise an
  // excessive discount would report itself twice.
  const ok = prepaidAmount === 0 || amountDue >= 0;
  return {
    label: ok ? "Already paid does not exceed the total" : "Already paid exceeds the document total",
    ok,
    hint: "The paid amount is VAT-inclusive and cannot be more than the total.",
  };
}

function negativePriceCheck(lines: LineItem[]): ComplianceItem {
  const offenders = lines.filter((item) => Number(item.unit_price) < 0);
  const hint =
    "Peppol refuses a negative unit price. A down payment you already invoiced is a discount; money simply received goes in “Already paid”.";
  if (offenders.length === 0) {
    return { label: "No negative unit prices", ok: true, hint };
  }
  const names = offenders.map((line) => line.product || line.description || "untitled line").join(", ");
  return {
    label: `Negative unit price on ${offenders.length === 1 ? "a line" : `${offenders.length} lines`}`,
    ok: false,
    hint: `${hint} Affected: ${names}.`,
  };
}

/**
 * A discount reduces the VAT base of its own rate, so it cannot exceed the lines
 * at that rate — even when the document total stays positive. Left unchecked the
 * document goes out with a negative VAT base at that rate, which is nonsense for
 * the accountant on the other side even where the network tolerates it.
 */
function perRateCheck(lines: LineItem[], allowances: DocumentAllowance[]): ComplianceItem {
  const baseByRate = new Map<number, number>();
  for (const item of lines) {
    const rate = Number(item.tax_rate) || 0;
    baseByRate.set(rate, (baseByRate.get(rate) ?? 0) + computeLineItem(item).subtotal);
  }
  for (const allowance of allowances) {
    const rate = Number(allowance.tax_rate) || 0;
    baseByRate.set(rate, (baseByRate.get(rate) ?? 0) - (Number(allowance.amount) || 0));
  }
  const overdrawn = [...baseByRate.entries()].filter(([, base]) => base < -0.005).map(([rate]) => `${rate}%`);
  const hint = "A discount reduces the VAT base of its own rate; it cannot be larger than the lines at that rate.";
  if (overdrawn.length === 0) {
    return { label: "Discounts fit within their own VAT rate", ok: true, hint };
  }
  return {
    label: `Discounts exceed the lines at ${overdrawn.join(", ")}`,
    ok: false,
    hint,
  };
}

export function buildCompliance(draft: Partial<Invoice>): ComplianceSection[] {
  const currency = (draft.currency ?? "EUR").toUpperCase();
  const lines = (draft.line_items ?? []) as LineItem[];
  const allowances = (draft.allowances ?? []) as DocumentAllowance[];
  const totals = computeDocumentTotals(lines, allowances, draft.prepaid_amount ?? 0);

  const needsAccountingTaxCurrency =
    currency !== "EUR"
    && draft.vat_treatment === "standard"
    && Number(draft.total_tax ?? 0) > 0;

  const lineRates = new Set(lines.map((item) => Number(item.tax_rate) || 0));

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
        { label: "At least one line item is required", ok: lines.length > 0 },
        negativePriceCheck(lines),
      ],
    },
  ];

  if (allowances.length > 0 || (draft.prepaid_amount ?? 0) !== 0) {
    const missingReason = allowances.filter((a) => !a.reason?.trim()).length;
    const badAmount = allowances.filter((a) => !(Number(a.amount) > 0)).length;
    const unknownRate = allowances.filter((a) => !lineRates.has(Number(a.tax_rate) || 0)).length;

    sections.push({
      title: "Discounts & Payments",
      items: [
        countedCheck(
          missingReason,
          "Every discount has a reason",
          (count) => `${count} without a reason`,
          "Peppol requires a reason for each discount, e.g. “Deposit invoiced on INV-2026-001”.",
        ),
        countedCheck(
          badAmount,
          "Every discount amount is positive",
          (count) => `${count} with an invalid amount`,
          "Enter the discount as a positive amount — it is subtracted for you.",
        ),
        countedCheck(
          unknownRate,
          "Discount VAT rates match the lines",
          (count) => `${count} at a VAT rate no line uses`,
          "A discount reduces the VAT base of its own rate, so that rate must appear on a line.",
        ),
        {
          label: totals.taxableAmount >= 0 ? "Discounts do not exceed the lines" : "Discounts exceed the line total",
          ok: totals.taxableAmount >= 0,
          hint: "Reduce the discounts, or issue a credit note instead.",
        },
        perRateCheck(lines, allowances),
        prepaidCheck(totals.prepaidAmount, totals.amountDue),
      ],
    });
  }

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

/** How many checks a document fails. Zero is the condition for sending. */
export function countComplianceIssues(draft: Partial<Invoice>): number {
  return buildCompliance(draft).reduce(
    (acc, section) => acc + section.items.filter((item) => !item.ok).length,
    0,
  );
}
