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
import { formatCurrency } from "../types";

const APP_ID = "billing";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  invoice: Invoice;
  onSent: () => void;
}

type Step = "confirm" | "sending" | "success" | "error";

export default function PeppolSendDialog({ open, onOpenChange, invoice, onSent }: Props) {
  const [step, setStep] = useState<Step>("confirm");
  const [dokapiUlid, setDokapiUlid] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [ublXml, setUblXml] = useState("");
  const [showXml, setShowXml] = useState(false);

  const { data: regs } = useAppCollection<PeppolRegistration>(APP_ID, "peppol_registration");
  const { data: sellers } = useAppCollection<SellerSettings>(APP_ID, "seller_settings");
  const { create: createLog } = useAppCollection<PeppolSendLog>(APP_ID, "peppol_send_log");
  const { call } = useIntegration("peppol");

  const reg = regs?.[0];
  const seller = sellers?.[0];

  const senderPeppolId = reg?.peppol_id ?? "";
  const receiverPeppolId = invoice.client_vat
    ? deriveReceiverPeppolId(invoice.client_vat, invoice.client_country ?? "BE")
    : "";

  const handleSend = async () => {
    setStep("sending");
    setErrorMsg("");

    try {
      const lines = (invoice.line_items ?? []).map((item: LineItem, idx: number) => ({
        id: String(idx + 1),
        description: item.description || item.product || `Line ${idx + 1}`,
        quantity: item.quantity,
        unitPrice: item.unit_price,
        taxPercent: item.tax_rate ?? 0,
        lineAmount: item.quantity * item.unit_price * (1 - (item.discount ?? 0) / 100),
      }));

      const refs = (invoice.references ?? []) as InvoiceReference[];
      const poRef = refs.find((r) => r.type === "purchase_order")?.value;
      const contractRef = refs.find((r) => r.type === "contract_number")?.value;
      const projectRef = refs.find((r) => r.type === "project_reference")?.value;
      const buyerRef = refs.find((r) => r.type === "cost_center")?.value;

      const invoiceParams = {
        invoiceNumber: invoice.invoice_number,
        issueDate: invoice.invoice_date,
        dueDate: invoice.due_date,
        currency: invoice.currency ?? "EUR",
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
        ...(seller?.iban ? { paymentInfo: { iban: seller.iban, bic: seller.bic ?? "" } } : {}),
        ...(poRef ? { orderReference: poRef } : {}),
        ...(contractRef ? { contractReference: contractRef } : {}),
        ...(projectRef ? { projectReference: projectRef } : {}),
        ...(buyerRef ? { buyerReference: buyerRef } : {}),
        ...(invoice.internal_notes ? { note: invoice.internal_notes } : {}),
      };

      // Generate UBL for storage
      let xml = "";
      try {
        const ublRes = await call("generate_ubl", { invoiceParams }) as { xml: string };
        xml = ublRes.xml ?? "";
        setUblXml(xml);
      } catch { /* non-blocking */ }

      // Send
      const result = await call("send_invoice", {
        senderPeppolId,
        receiverPeppolId,
        invoiceParams,
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
        sent_at: new Date().toISOString(),
      });

      setStep("success");
      toast.success(`Invoice ${invoice.invoice_number} sent via Peppol`);
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
            Send via Peppol
          </DialogTitle>
        </DialogHeader>

        {/* CONFIRM */}
        {step === "confirm" && (
          <>
            <div className="space-y-4 py-1">
              {/* Invoice summary */}
              <div className="rounded-lg border bg-muted/30 p-3 space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Invoice</span>
                  <span className="font-mono font-semibold">{invoice.invoice_number}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Client</span>
                  <span className="font-medium">{invoice.client_company}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Amount</span>
                  <span className="font-semibold">{formatCurrency(invoice.total ?? 0, invoice.currency ?? "EUR")}</span>
                </div>
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
              {(!senderPeppolId || !receiverPeppolId) && (
                <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                  <IconAlertCircle className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
                  <span>
                    {!senderPeppolId && "Your Peppol registration is not active. "}
                    {!receiverPeppolId && "Client VAT number is required to derive their Peppol ID."}
                  </span>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>Cancel</Button>
              <Button
                onClick={handleSend}
                disabled={!senderPeppolId || !receiverPeppolId}
              >
                <IconSend className="h-4 w-4 mr-2" />
                Send via Peppol
              </Button>
            </DialogFooter>
          </>
        )}

        {/* SENDING */}
        {step === "sending" && (
          <div className="flex flex-col items-center gap-4 py-8">
            <IconLoader2 className="h-10 w-10 text-primary animate-spin" />
            <div className="text-center space-y-1">
              <p className="font-semibold">Sending…</p>
              <p className="text-sm text-muted-foreground">Submitting to the Peppol network</p>
            </div>
          </div>
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
