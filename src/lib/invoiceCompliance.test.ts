import { describe, expect, it } from "vitest";
import { buildCompliance, countComplianceIssues } from "./invoiceCompliance";
import type { DocumentAllowance, Invoice, LineItem } from "../types";

const line = (over: Partial<LineItem> = {}): LineItem => ({
  id: "1",
  product: "Prestation",
  description: "",
  quantity: 1,
  unit: "",
  unit_price: 1000,
  discount: 0,
  tax_rate: 21,
  ...over,
});

const complete = (over: Partial<Invoice> = {}): Partial<Invoice> => ({
  invoice_number: "INV-20260817-001",
  invoice_date: "2026-08-17",
  due_date: "2026-09-16",
  currency: "EUR",
  vat_treatment: "standard",
  client_company: "Arduenna Spirit Company",
  client_vat: "BE0764422950",
  client_street: "Poisson Moulin 72",
  client_city: "Vaux-sur-Sûre",
  client_postal: "6640",
  line_items: [line()],
  ...over,
});

const failing = (draft: Partial<Invoice>) =>
  buildCompliance(draft).flatMap((s) => s.items.filter((i) => !i.ok).map((i) => i.label));

describe("buildCompliance", () => {
  it("passes a complete invoice", () => {
    expect(countComplianceIssues(complete())).toBe(0);
  });

  it("reports each missing field once", () => {
    expect(failing(complete({ client_vat: "", client_city: "  " }))).toEqual(["VAT Number", "City"]);
  });

  it("blocks a negative unit price and names the offending line", () => {
    const issues = buildCompliance(
      complete({ line_items: [line(), line({ id: "2", product: "Déduction Acompte", unit_price: -1000 })] }),
    ).flatMap((s) => s.items.filter((i) => !i.ok));

    expect(issues).toHaveLength(1);
    expect(issues[0].label).toMatch(/Negative unit price on a line/);
    expect(issues[0].hint).toMatch(/Déduction Acompte/);
    expect(issues[0].hint).toMatch(/Already paid/);
  });

  it("counts several negative lines together", () => {
    expect(
      failing(complete({
        line_items: [line({ unit_price: -1 }), line({ id: "2", unit_price: -2 })],
      })),
    ).toEqual(["Negative unit price on 2 lines"]);
  });

  it("stays silent about deposits and discounts when there are none", () => {
    expect(buildCompliance(complete()).map((s) => s.title)).not.toContain("Discounts & Payments");
  });

  it("accepts a well-formed discount", () => {
    const allowances: DocumentAllowance[] = [
      { id: "a", amount: 500, tax_rate: 21, reason: "Deposit invoiced on INV-20260614-001" },
    ];
    expect(countComplianceIssues(complete({ allowances }))).toBe(0);
  });

  it("requires a reason, a positive amount and a rate used by a line", () => {
    const allowances: DocumentAllowance[] = [
      { id: "a", amount: 0, tax_rate: 6, reason: "" },
    ];
    expect(failing(complete({ allowances }))).toEqual([
      "1 discount without a reason",
      "1 discount with an invalid amount",
      "1 discount at a VAT rate no line uses",
    ]);
  });

  it("refuses discounts larger than the lines", () => {
    const allowances: DocumentAllowance[] = [{ id: "a", amount: 2000, tax_rate: 21, reason: "Rebate" }];
    expect(failing(complete({ allowances }))).toEqual([
      "Discounts exceed the line total",
      "Discounts exceed the lines at 21%",
    ]);
  });

  // A discount reduces the base of its own rate only, so it can overdraw that
  // rate while the document total stays comfortably positive.
  it("refuses a discount larger than the lines at its own rate", () => {
    const lines: LineItem[] = [
      line({ id: "1", unit_price: 100, tax_rate: 6 }),
      line({ id: "2", unit_price: 1000, tax_rate: 21 }),
    ];
    const allowances: DocumentAllowance[] = [{ id: "a", amount: 500, tax_rate: 6, reason: "Deposit" }];
    expect(failing(complete({ line_items: lines, allowances }))).toEqual(["Discounts exceed the lines at 6%"]);
  });

  it("refuses a paid amount larger than the total", () => {
    // 1000 + 21% = 1210 payable at most.
    expect(failing(complete({ prepaid_amount: 1500 }))).toEqual(["Already paid exceeds the document total"]);
    expect(countComplianceIssues(complete({ prepaid_amount: 1210 }))).toBe(0);
  });

  it("refuses a paid amount entered as a deduction", () => {
    expect(failing(complete({ prepaid_amount: -500 }))).toEqual(["Already paid must be a positive amount"]);
  });

  it("asks for the accounting VAT currency only on a non-EUR standard-VAT document", () => {
    const titles = (draft: Partial<Invoice>) => buildCompliance(draft).map((s) => s.title);
    expect(titles(complete({ currency: "USD", total_tax: 210 }))).toContain("VAT Accounting Currency");
    expect(titles(complete({ currency: "USD", total_tax: 0 }))).not.toContain("VAT Accounting Currency");
    expect(titles(complete({ total_tax: 210 }))).not.toContain("VAT Accounting Currency");
  });

  it("treats a document with nothing filled in as blocked, not as complete", () => {
    expect(countComplianceIssues({})).toBeGreaterThan(0);
  });
});
