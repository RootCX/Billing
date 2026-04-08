// ICD (scheme) codes used by Peppol for each country's national business register.
// BE uses KBO/CBE (0208); others fall back to EU VAT scheme 9925.
const ICD_BY_COUNTRY: Record<string, string> = {
  BE: "0208", NL: "0106", FR: "0009", DE: "0204", IT: "0211",
  SE: "0007", NO: "0192", DK: "0184", FI: "0037", AT: "9915",
  LU: "9938", PT: "9925", ES: "9920", PL: "9923",
};
const DEFAULT_ICD = "9925";

/**
 * Normalize a user-entered VAT number to a canonical form: uppercase,
 * no spaces, no punctuation. Handles the messy real-world variants users
 * paste from invoices, emails, or government databases.
 *
 * Examples:
 *   "BE 0431677318"    → "BE0431677318"
 *   "BE 04 31677.318"  → "BE0431677318"
 *   "be0 431.677.318"  → "BE0431677318"
 */
export function cleanVat(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

/**
 * Build a Peppol receiver id of the form "<ICD>:<value>" from a raw VAT
 * number. The value must satisfy Dokapi's regex: alphanumerics plus
 * `- . _ ~`, length 1..50. `cleanVat` guarantees alphanumerics only.
 */
export function deriveReceiverPeppolId(vat: string, countryCode: string): string {
  const cleaned = cleanVat(vat);
  if (!cleaned) return "";
  const code = (countryCode || "BE").toUpperCase();
  const icd = ICD_BY_COUNTRY[code] ?? DEFAULT_ICD;
  // Strip the 2-letter country prefix from the cleaned VAT if present.
  const value = cleaned.replace(/^[A-Z]{2}/, "");
  return `${icd}:${value}`;
}
