import { describe, it, expect } from "vitest";
import { cleanVat, deriveReceiverPeppolId } from "./vat";

describe("cleanVat", () => {
  it.each([
    // Real-world messy BE variants the user reported.
    ["BE 0431677318",     "BE0431677318"],
    ["BE 04 31677.318",   "BE0431677318"],
    ["BE0 431.677.318",   "BE0431677318"],
    ["  be0431677318  ",  "BE0431677318"],
    // Non-BE VATs contain letters — those must survive.
    ["ATU 1234 5678",     "ATU12345678"],
  ])("normalizes %j to %j", (raw, expected) => {
    expect(cleanVat(raw)).toBe(expected);
  });

  it("returns empty string for empty / nullish input", () => {
    expect(cleanVat("")).toBe("");
    expect(cleanVat(undefined)).toBe("");
    expect(cleanVat(null)).toBe("");
  });
});

describe("deriveReceiverPeppolId", () => {
  // Dokapi's contract — the whole reason this module exists.
  const DOKAPI_REGEX = /^\d{4}:[A-Za-z0-9._~-]{1,50}$/;

  it.each([
    ["BE 0431677318",     "BE"],
    ["BE 04 31677.318",   "BE"],
    ["BE0 431.677.318",   "BE"],
  ])("builds a Dokapi-valid id from messy BE VAT %j", (raw, country) => {
    const id = deriveReceiverPeppolId(raw, country);
    expect(id).toBe("0208:0431677318");
    expect(id).toMatch(DOKAPI_REGEX);
  });

  it("falls back to scheme 9925 for unknown country codes", () => {
    expect(deriveReceiverPeppolId("XX123456", "XX")).toBe("9925:123456");
  });

  it("returns empty string when VAT is empty", () => {
    expect(deriveReceiverPeppolId("", "BE")).toBe("");
  });
});
