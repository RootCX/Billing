import { describe, expect, it } from "vitest";
import { ublToIncomingPdfData, type ParsedUbl } from "./incoming-types";

const doc = { id: "doc-1", document_type: "Invoice", document_number: "FALLBACK-1", amount: 999 };

describe("ublToIncomingPdfData", () => {
  it("keeps only the supplier's discounts, never its charges", () => {
    const ubl: ParsedUbl = {
      allowanceCharges: [
        { chargeIndicator: false, amount: 100, reason: "Acompte", taxPercent: 6 },
        { chargeIndicator: true, amount: 50, reason: "Freight", taxPercent: 21 },
      ],
    };
    const { invoice } = ublToIncomingPdfData(ubl, doc);
    expect(invoice.allowances).toEqual([{ id: "allowance-0", amount: 100, tax_rate: 6, reason: "Acompte" }]);
  });

  it("carries the amount already paid so the rendered total follows from its rows", () => {
    const { invoice } = ublToIncomingPdfData(
      { monetaryTotal: { lineExtensionAmount: 5000, taxInclusiveAmount: 6050, prepaidAmount: 1210 }, taxTotal: { taxAmount: 1050 } },
      doc,
    );
    expect(invoice.subtotal).toBe(5000);
    expect(invoice.total_tax).toBe(1050);
    expect(invoice.total).toBe(6050);
    expect(invoice.prepaid_amount).toBe(1210);
  });

  it.each<[string, ParsedUbl["monetaryTotal"], number]>([
    ["the gross total when stated", { taxInclusiveAmount: 121, payableAmount: 100 }, 121],
    ["the payable amount when there is no gross total", { payableAmount: 100 }, 100],
    ["the amount Core recorded when the document states none", {}, 999],
  ])("reproduces %s", (_what, monetaryTotal, expected) => {
    expect(ublToIncomingPdfData({ monetaryTotal }, doc).invoice.total).toBe(expected);
  });

  it("falls back to the line amount when a line carries no unit price", () => {
    const { invoice } = ublToIncomingPdfData(
      { lines: [{ description: "Service", lineAmount: 240 }, { description: "Goods", quantity: 2, unitPrice: 30, lineAmount: 60 }] },
      doc,
    );
    expect(invoice.line_items.map((l) => [l.unit_price, l.quantity])).toEqual([[240, 1], [30, 2]]);
  });

  it("applies the first tax rate of the breakdown to every line", () => {
    // Incoming UBL states VAT per document, not per line; a zero default would
    // render a VAT-free document while the total says otherwise.
    const { invoice } = ublToIncomingPdfData(
      { lines: [{ description: "A" }, { description: "B" }], taxTotal: { subtotals: [{ percent: 6 }, { percent: 21 }] } },
      doc,
    );
    expect(invoice.line_items.map((l) => l.tax_rate)).toEqual([6, 6]);
  });

  it("titles a credit note as such", () => {
    expect(ublToIncomingPdfData({}, { ...doc, document_type: "CreditNote" }).documentTitle).toBe("CREDIT NOTE");
    expect(ublToIncomingPdfData({}, doc).documentTitle).toBe("INVOICE");
  });

  it("renders an empty document without inventing anything", () => {
    const { invoice, seller, paymentInfo } = ublToIncomingPdfData({}, { id: "doc-2" });
    expect(invoice.line_items).toEqual([]);
    expect(invoice.allowances).toEqual([]);
    expect(invoice.prepaid_amount).toBe(0);
    expect(invoice.total).toBe(0);
    expect(invoice.currency).toBe("EUR");
    expect(seller.company_name).toBe("");
    expect(paymentInfo).toBeUndefined();
  });

  it("offers bank details only when an IBAN was received", () => {
    expect(ublToIncomingPdfData({ paymentMeans: [{ iban: "BE68539007547034", bic: "GKCCBEBB" }] }, doc).paymentInfo)
      .toEqual({ iban: "BE68539007547034", bic: "GKCCBEBB" });
    expect(ublToIncomingPdfData({ paymentMeans: [{ paymentId: "REF-1" }] }, doc).paymentInfo).toBeUndefined();
  });
});
