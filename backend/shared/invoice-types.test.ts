import { describe, expect, it } from "vitest";
import { computeDocumentTotals, computeVatBreakdown, type DocumentAllowance, type LineItem } from "./invoice-types";

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

describe("computeDocumentTotals", () => {
  it("sums the lines when there is nothing else", () => {
    expect(computeDocumentTotals([line(), line({ id: "2", unit_price: 500, tax_rate: 6 })])).toEqual({
      subtotal: 1500,
      allowanceTotal: 0,
      taxableAmount: 1500,
      totalTax: 240, // 210 + 30
      total: 1740,
      prepaidAmount: 0,
      amountDue: 1740,
    });
  });

  it("applies the line discount before the VAT", () => {
    const totals = computeDocumentTotals([line({ quantity: 2, unit_price: 100, discount: 10 })]);
    expect(totals.subtotal).toBe(180);
    expect(totals.totalTax).toBe(37.8);
  });

  it("reduces the VAT base at the rate of each discount, not globally", () => {
    // The real case: a deposit invoiced across two rates.
    const allowances: DocumentAllowance[] = [
      { id: "a", amount: 4107.5, tax_rate: 6, reason: "Deposit (6%)" },
      { id: "b", amount: 1000, tax_rate: 21, reason: "Deposit (21%)" },
    ];
    const totals = computeDocumentTotals(
      [line({ unit_price: 9507, tax_rate: 6 }), line({ id: "2", unit_price: 4381.57, tax_rate: 21 })],
      allowances,
    );

    expect(totals.subtotal).toBe(13888.57);
    expect(totals.allowanceTotal).toBe(5107.5);
    expect(totals.taxableAmount).toBe(8781.07);
    // 6%: 5399.50 → 323.97 ; 21%: 3381.57 → 710.13
    expect(totals.totalTax).toBe(1034.1);
    expect(totals.total).toBe(9815.17);
  });

  it("subtracts what was already paid from the amount due, VAT included", () => {
    const totals = computeDocumentTotals([line({ unit_price: 5000 })], [], 1210);
    expect(totals.total).toBe(6050);
    expect(totals.amountDue).toBe(4840);
    // The taxable base and the VAT are untouched by a payment.
    expect(totals.taxableAmount).toBe(5000);
    expect(totals.totalTax).toBe(1050);
  });

  it("keeps two decimals on every figure", () => {
    const totals = computeDocumentTotals([line({ quantity: 3, unit_price: 33.333, tax_rate: 21 })]);
    for (const value of Object.values(totals)) {
      expect(value).toBe(Math.round(value * 100) / 100);
    }
  });

  // The UBL breakdown computes the VAT once per rate, on the summed base. Doing
  // it line by line drifts a cent and the sent document no longer matches the
  // invoice the user approved (EN16931 BR-S-08/BR-CO-14).
  it("computes the VAT on the total of each rate, not line by line", () => {
    const totals = computeDocumentTotals([line({ quantity: 7, unit_price: 1.115 })]);
    expect(totals.subtotal).toBe(7.81);
    expect(totals.totalTax).toBe(1.64); // 21% of 7.81, rounded once
    expect(totals.total).toBe(9.45);
  });

  // BR-CO-11: the discount total is the sum of the amounts as they are written,
  // each already rounded — 0.125 twice is 0.26, not 0.25.
  it("rounds each discount before summing them", () => {
    const allowances: DocumentAllowance[] = [
      { id: "a", amount: 0.125, tax_rate: 21, reason: "Rebate A" },
      { id: "b", amount: 0.125, tax_rate: 21, reason: "Rebate B" },
    ];
    expect(computeDocumentTotals([line()], allowances).allowanceTotal).toBe(0.26);
  });

  it("handles an empty document and missing optional arguments", () => {
    expect(computeDocumentTotals([])).toMatchObject({ subtotal: 0, total: 0, amountDue: 0 });
  });
});

describe("computeVatBreakdown", () => {
  // What the PDF prints as "VAT 6% on …" and what the UBL breakdown carries: one
  // base per rate, the discount taken off its own rate only, lowest rate first.
  it("groups the lines by rate and deducts each discount from its own rate", () => {
    const breakdown = computeVatBreakdown(
      [line({ unit_price: 4381.57, tax_rate: 21 }), line({ id: "2", unit_price: 9507, tax_rate: 6 })],
      [{ id: "a", amount: 4107.5, tax_rate: 6, reason: "Down payment (6%)" }],
    );

    expect(breakdown).toEqual([
      { taxRate: 6, taxableAmount: 5399.5, taxAmount: 323.97 },
      { taxRate: 21, taxableAmount: 4381.57, taxAmount: 920.13 },
    ]);
  });

  it("keeps a zero-rated group so an exempt document still shows its base", () => {
    expect(computeVatBreakdown([line({ tax_rate: 0 })])).toEqual([
      { taxRate: 0, taxableAmount: 1000, taxAmount: 0 },
    ]);
  });
});
