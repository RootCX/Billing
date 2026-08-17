import { useState } from "react";
import { useAppCollection, useIntegration } from "@rootcx/sdk";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Button, Badge, Separator,
  toast,
} from "@rootcx/ui";
import {
  IconCircleCheck, IconAlertCircle, IconLoader2,
  IconSend, IconNetwork, IconFileText,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { cleanVat, deriveReceiverPeppolId } from "@/lib/vat";
import type { Invoice, PeppolRegistration, PeppolSendLog, SellerSettings, LineItem, InvoiceReference } from "../types";
import { computeLineItem, formatCurrency, isCreditNote } from "../types";

const APP_ID = "billing";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  invoice: Invoice;
  onSent: () => void;
}

type Step = "confirm" | "validating" | "sending" | "success" | "error" | "invalid";

export default function PeppolSendDialog({ open, onOpenChange, invoice, onSent }: Props) {
  const [step, setStep] = useState<Step>("confirm");
  const [dokapiUlid, setDokapiUlid] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [ublXml, setUblXml] = useState("");
  const [showXml, setShowXml] = useState(false);

  const { data: regs } = useAppCollection<PeppolRegistration>(APP_ID, "peppol_registration");
  const { data: sellers } = useAppCollection<SellerSettings>(APP_ID, "seller_settings");
  const { create: createLog } = useAppCollection<PeppolSendLog>(APP_ID, "peppol_send_log");
  const { call } = useIntegration("peppol");

  const reg = regs?.[0];
  const seller = sellers?.[0];
  const creditNote = isCreditNote(invoice);
  const docLabel = creditNote ? "Credit note" : "Invoice";
  const missingCorrectedRef = creditNote && !invoice.corrected_invoice_number;
  const documentCurrency = (invoice.currency ?? "EUR").toUpperCase();
  const taxCurrency = (invoice.tax_currency ?? "").toUpperCase();
  const needsAccountingTaxCurrency =
    (seller?.country_code ?? "BE").toUpperCase() === "BE"
    && documentCurrency !== "EUR"
    && invoice.vat_treatment === "standard"
    && Number(invoice.total_tax ?? 0) > 0;
  const missingAccountingTaxCurrency =
    needsAccountingTaxCurrency
    && (!taxCurrency || Number(invoice.tax_amount_in_tax_currency ?? 0) === 0);

  const allowances = invoice.allowances ?? [];
  const prepaidAmount = Number(invoice.prepaid_amount ?? 0);
  const amountDue = Math.round(((invoice.total ?? 0) - prepaidAmount) * 100) / 100;

  const senderPeppolId = reg?.peppol_id ?? "";
  const receiverPeppolId = invoice.client_vat
    ? deriveReceiverPeppolId(invoice.client_vat, invoice.client_country ?? "BE")
    : "";

  const handleSend = async () => {
    setStep("validating");
    setErrorMsg("");
    setValidationErrors([]);

    try {
      const lines = (invoice.line_items ?? []).map((item: LineItem, idx: number) => ({
        id: String(idx + 1),
        description: item.description || item.product || `Line ${idx + 1}`,
        quantity: item.quantity,
        unitPrice: item.unit_price,
        taxPercent: item.tax_rate ?? 0,
        // The same rounded net amount the invoice and the PDF show: the VAT
        // breakdown is built on the sum of these, so an unrounded value here
        // would put the document a cent away from itself (EN16931 BR-CO-10).
        lineAmount: computeLineItem(item).subtotal,
      }));

      const ublAllowances = allowances.map((allowance) => ({
        amount: Number(allowance.amount) || 0,
        taxPercent: Number(allowance.tax_rate) || 0,
        reason: allowance.reason,
      }));

      const refs = (invoice.references ?? []) as InvoiceReference[];
      const poRef = refs.find((r) => r.type === "purchase_order")?.value;
      const contractRef = refs.find((r) => r.type === "contract_number")?.value;
      const projectRef = refs.find((r) => r.type === "project_reference")?.value;
      const buyerRef = refs.find((r) => r.type === "cost_center")?.value;

      // Shared between invoice and credit note (identical UBL party/total shapes).
      const common = {
        currency: invoice.currency ?? "EUR",
        ...(taxCurrency && Number(invoice.tax_amount_in_tax_currency ?? 0) !== 0
          ? {
              taxCurrency,
              taxAmountInTaxCurrency: invoice.tax_amount_in_tax_currency,
            }
          : {}),
        supplier: {
          peppolId: senderPeppolId,
          name: seller?.company_name ?? "",
          vatNumber: cleanVat(seller?.vat_number),
          street: seller?.street ?? "",
          city: seller?.city ?? "",
          postalCode: seller?.postal_code ?? "",
          countryCode: seller?.country_code ?? "BE",
        },
        customer: {
          peppolId: receiverPeppolId,
          name: invoice.client_company ?? "",
          vatNumber: cleanVat(invoice.client_vat),
          street: invoice.client_street ?? "",
          city: invoice.client_city ?? "",
          postalCode: invoice.client_postal ?? "",
          countryCode: invoice.client_country ?? "BE",
        },
        lines,
        taxTotal: invoice.total_tax ?? 0,
        taxableAmount: invoice.subtotal ?? 0,
        payableAmount: invoice.total ?? 0,
        // A deposit or a rebate travels as BG-20 / BT-113, never as a negative
        // line: EN16931 BR-27 forbids a negative item net price.
        ...(ublAllowances.length > 0 ? { allowances: ublAllowances } : {}),
        ...(prepaidAmount > 0 ? { prepaidAmount } : {}),
        ...(seller?.iban ? { paymentInfo: { iban: seller.iban, bic: seller.bic ?? "" } } : {}),
        ...(poRef ? { orderReference: poRef } : {}),
        ...(contractRef ? { contractReference: contractRef } : {}),
        ...(buyerRef ? { buyerReference: buyerRef } : {}),
        // The note carries any statutory mention the user typed manually.
        ...(invoice.internal_notes ? { note: invoice.internal_notes } : {}),
      };

      // Invoice and credit note follow the same generate-then-send dance; only
      // the action names, the param key, and a few document-specific fields differ.
      // (The Send button is disabled when a credit note is missing its corrected
      // reference, and the worker validates it again.)
      const paramKey = creditNote ? "creditNoteParams" : "invoiceParams";
      const docParams = creditNote
        ? {
            creditNoteNumber: invoice.invoice_number,
            issueDate: invoice.invoice_date,
            correctedInvoiceNumber: invoice.corrected_invoice_number ?? "",
            ...(invoice.corrected_invoice_date ? { correctedInvoiceDate: invoice.corrected_invoice_date } : {}),
            ...common,
          }
        : {
            invoiceNumber: invoice.invoice_number,
            issueDate: invoice.invoice_date,
            dueDate: invoice.due_date,
            ...common,
            ...(projectRef ? { projectReference: projectRef } : {}),
          };
      const genAction = creditNote ? "generate_credit_note_ubl" : "generate_ubl";
      const sendAction = creditNote ? "send_credit_note" : "send_invoice";

      // Generate the UBL once (for storage/preview) and reuse it for the send so
      // the worker doesn't regenerate it. A generation failure is fatal on purpose:
      // the generator enforces the EN16931 rules the network would reject anyway,
      // and it says which rule and what to do instead.
      const ublRes = await call(genAction, { [paramKey]: docParams }) as { xml: string };
      const xml = ublRes.xml ?? "";
      setUblXml(xml);

      // Ask the network's own validator before sending. Without this the document
      // leaves, fails a Schematron rule somewhere in the network, and comes back as
      // a "sending_failed" log the user cannot act on.
      const validation = await call("validate_document", { xml }) as { valid: boolean; errors: string[] };
      if (!validation.valid) {
        const errors = validation.errors ?? [];
        // The action reports an unreachable validator the same way as an invalid
        // document. Not being able to check is no reason to block a valid send —
        // Dokapi validates again on receipt.
        const validatorDown = errors.length === 1 && /validation service unavailable/i.test(errors[0]);
        if (!validatorDown) {
          setValidationErrors(errors.length > 0 ? errors : ["The Peppol validator refused the document."]);
          setStep("invalid");
          return;
        }
      }

      setStep("sending");
      const result = await call(sendAction, {
        senderPeppolId,
        receiverPeppolId,
        [paramKey]: docParams,
        ...(xml ? { xml } : {}),
        countryCode: invoice.client_country ?? "BE",
      }) as { dokapiUlid: string; status: string };

      setDokapiUlid(result.dokapiUlid ?? "");

      // Persist log
      await createLog({
        invoice_id: invoice.id,
        invoice_number: invoice.invoice_number,
        status: "sent",
        dokapi_ulid: result.dokapiUlid ?? "",
        sender_peppol_id: senderPeppolId,
        receiver_peppol_id: receiverPeppolId,
        ubl_xml: xml,
        error_message: "",
        document_type: creditNote ? "credit_note" : "invoice",
        sent_at: new Date().toISOString(),
      });

      setStep("success");
      toast.success(`${docLabel} ${invoice.invoice_number} sent via Peppol`);
      onSent();
    } catch (e: any) {
      const msg = e.message ?? "Unknown error";
      setErrorMsg(msg);

      // Log the failure too
      try {
        await createLog({
          invoice_id: invoice.id,
          invoice_number: invoice.invoice_number,
          status: "failed",
          dokapi_ulid: "",
          sender_peppol_id: senderPeppolId,
          receiver_peppol_id: receiverPeppolId,
          ubl_xml: ublXml,
          error_message: msg,
          document_type: creditNote ? "credit_note" : "invoice",
          sent_at: new Date().toISOString(),
        });
      } catch { /* best effort */ }

      setStep("error");
    }
  };

  const handleClose = () => {
    setStep("confirm");
    setDokapiUlid("");
    setErrorMsg("");
    setValidationErrors([]);
    setUblXml("");
    setShowXml(false);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <IconNetwork className="h-5 w-5 text-primary" />
            Send {creditNote ? "credit note" : "invoice"} via Peppol
          </DialogTitle>
        </DialogHeader>

        {/* CONFIRM */}
        {step === "confirm" && (
          <>
            <div className="space-y-4 py-1">
              {/* Invoice summary */}
              <div className="rounded-lg border bg-muted/30 p-3 space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">{docLabel}</span>
                  <span className="font-mono font-semibold">{invoice.invoice_number}</span>
                </div>
                {creditNote && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Corrects invoice</span>
                    <span className="font-mono">{invoice.corrected_invoice_number || "—"}</span>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Client</span>
                  <span className="font-medium">{invoice.client_company}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Amount</span>
                  <span className="font-semibold">{formatCurrency(invoice.total ?? 0, invoice.currency ?? "EUR")}</span>
                </div>
                {allowances.length > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">
                      {allowances.length === 1 ? "Discount" : `${allowances.length} discounts`}
                    </span>
                    <span>
                      −{formatCurrency(
                        allowances.reduce((sum, a) => sum + (Number(a.amount) || 0), 0),
                        invoice.currency ?? "EUR",
                      )} excl. VAT
                    </span>
                  </div>
                )}
                {prepaidAmount > 0 && (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Already paid</span>
                      <span>−{formatCurrency(prepaidAmount, invoice.currency ?? "EUR")}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Amount due</span>
                      <span className="font-semibold">{formatCurrency(amountDue, invoice.currency ?? "EUR")}</span>
                    </div>
                  </>
                )}
              </div>

              <Separator />

              {/* Peppol routing */}
              <div className="space-y-2 text-sm">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Peppol Routing</p>
                <div className="space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-muted-foreground shrink-0">From</span>
                    <span className="font-mono text-xs text-right break-all">{senderPeppolId || "—"}</span>
                  </div>
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-muted-foreground shrink-0">To</span>
                    <div className="flex flex-col items-end gap-1">
                      <span className="font-mono text-xs text-right break-all">{receiverPeppolId || "—"}</span>
                      {!receiverPeppolId && (
                        <Badge variant="destructive" className="text-[10px]">Missing client VAT</Badge>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Warning if missing data */}
              {(!senderPeppolId || !receiverPeppolId || missingCorrectedRef || missingAccountingTaxCurrency) && (
                <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                  <IconAlertCircle className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
                  <span>
                    {!senderPeppolId && "Your Peppol registration is not active. "}
                    {!receiverPeppolId && "Client VAT number is required to derive their Peppol ID. "}
                    {missingCorrectedRef && "This credit note is missing the reference to the corrected invoice. "}
                    {missingAccountingTaxCurrency && "Belgian VAT in a non-EUR invoice requires the VAT amount in EUR before Peppol sending."}
                  </span>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>Cancel</Button>
              <Button
                onClick={handleSend}
                disabled={!senderPeppolId || !receiverPeppolId || missingCorrectedRef || missingAccountingTaxCurrency}
              >
                <IconSend className="h-4 w-4 mr-2" />
                Send via Peppol
              </Button>
            </DialogFooter>
          </>
        )}

        {/* VALIDATING / SENDING */}
        {(step === "validating" || step === "sending") && (
          <div className="flex flex-col items-center gap-4 py-8">
            <IconLoader2 className="h-10 w-10 text-primary animate-spin" />
            <div className="text-center space-y-1">
              <p className="font-semibold">{step === "validating" ? "Checking…" : "Sending…"}</p>
              <p className="text-sm text-muted-foreground">
                {step === "validating"
                  ? "Running the Peppol checks before anything leaves"
                  : "Submitting to the Peppol network"}
              </p>
            </div>
          </div>
        )}

        {/* INVALID — refused by the checks, nothing was sent */}
        {step === "invalid" && (
          <>
            <div className="space-y-3 py-2">
              <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                <IconAlertCircle className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
                <div>
                  <p className="font-semibold">Not sent — the Peppol checks refused it</p>
                  <p className="text-xs mt-0.5 opacity-90">
                    Nothing left your system. Fix the points below and try again.
                  </p>
                </div>
              </div>
              <ul className="space-y-1.5 max-h-56 overflow-y-auto">
                {validationErrors.map((error, idx) => (
                  <li key={idx} className="text-xs leading-relaxed rounded border bg-muted/30 px-2.5 py-1.5">
                    {error}
                  </li>
                ))}
              </ul>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>Close</Button>
              <Button onClick={() => { setStep("confirm"); setValidationErrors([]); }}>Back</Button>
            </DialogFooter>
          </>
        )}

        {/* SUCCESS */}
        {step === "success" && (
          <>
            <div className="space-y-4 py-2">
              <div className="flex flex-col items-center gap-3 py-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-green-100">
                  <IconCircleCheck className="h-8 w-8 text-green-600" />
                </div>
                <div className="text-center space-y-1">
                  <p className="font-semibold text-green-800">Successfully sent!</p>
                  <p className="text-sm text-muted-foreground">
                    {invoice.invoice_number} is on the Peppol network
                  </p>
                </div>
              </div>

              {dokapiUlid && (
                <div className="rounded-md border bg-muted/30 p-3 space-y-1 text-xs">
                  <p className="text-muted-foreground">Dokapi reference</p>
                  <p className="font-mono break-all">{dokapiUlid}</p>
                </div>
              )}

              {ublXml && (
                <div className="space-y-1.5">
                  <button
                    className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() => setShowXml((v) => !v)}
                  >
                    <IconFileText className="h-3.5 w-3.5" />
                    {showXml ? "Hide" : "View"} UBL XML
                  </button>
                  {showXml && (
                    <pre className="max-h-48 overflow-auto rounded-md border bg-muted p-3 text-[11px] leading-relaxed font-mono text-muted-foreground whitespace-pre-wrap break-all">
                      {ublXml}
                    </pre>
                  )}
                </div>
              )}
            </div>

            <DialogFooter>
              <Button onClick={handleClose}>Close</Button>
            </DialogFooter>
          </>
        )}

        {/* ERROR */}
        {step === "error" && (
          <>
            <div className="space-y-4 py-2">
              <div className="flex flex-col items-center gap-3 py-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-red-100">
                  <IconAlertCircle className="h-8 w-8 text-red-600" />
                </div>
                <div className="text-center space-y-1">
                  <p className="font-semibold text-red-800">Send failed</p>
                  <p className="text-sm text-muted-foreground max-w-xs">{errorMsg}</p>
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>Close</Button>
              <Button variant="destructive" onClick={() => { setStep("confirm"); setErrorMsg(""); }}>
                Try again
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
