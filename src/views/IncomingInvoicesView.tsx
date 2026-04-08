import { useState, useMemo, useEffect } from "react";
import { useAppCollection, useIntegration, type WhereClause } from "@rootcx/sdk";
import {
  PageHeader, DataTable, EmptyState, Badge, Button, toast,
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
  Textarea,
  type SortingState,
} from "@rootcx/ui";
import {
  IconInbox, IconArrowLeft, IconFileText, IconCopy, IconCheck,
  IconBan, IconLoader2,
} from "@tabler/icons-react";
import type { ColumnDef } from "@tanstack/react-table";
import type { IncomingDocument, PeppolRegistration, SellerSettings } from "../types";
import { formatCurrency, formatDate } from "../types";
import {
  FilterBar, conditionToWhereClause,
  type Condition, type FieldDef,
} from "../components/FilterSystem";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 20;

// ─── Field defs ───────────────────────────────────────────────────────────────

const APP_ID = "billing";

const STATUSES = [
  { value: "new",       label: "New",       color: "bg-blue-500"    },
  { value: "read",      label: "Read",      color: "bg-slate-400"   },
  { value: "processed", label: "Processed", color: "bg-emerald-500" },
  { value: "rejected",  label: "Rejected",  color: "bg-red-500"     },
  { value: "failed",    label: "Failed",    color: "bg-red-500"     },
];

const STATUS_STYLES: Record<string, { bg: string; text: string; dot: string }> = {
  new:       { bg: "bg-blue-50",    text: "text-blue-700",    dot: "bg-blue-500"    },
  read:      { bg: "bg-slate-50",   text: "text-slate-600",   dot: "bg-slate-400"   },
  processed: { bg: "bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-500" },
  rejected:  { bg: "bg-red-50",     text: "text-red-700",     dot: "bg-red-500"     },
  failed:    { bg: "bg-red-50",     text: "text-red-700",     dot: "bg-red-500"     },
};

const REASON_CODES = [
  { value: "REF", label: "Reference issue" },
  { value: "LEG", label: "Legal issue" },
  { value: "QUA", label: "Quality issue" },
  { value: "PRI", label: "Incorrect price" },
  { value: "QTY", label: "Incorrect quantity" },
  { value: "ITM", label: "Wrong item" },
  { value: "PAY", label: "Payment issue" },
  { value: "DEL", label: "Delivery issue" },
  { value: "REC", label: "Unknown receiver" },
  { value: "UNR", label: "Unrecognized" },
  { value: "FIN", label: "Financial issue" },
  { value: "OTH", label: "Other" },
];

const FIELD_DEFS: FieldDef[] = [
  { key: "status",          label: "Status",       type: "text"  },
  { key: "document_type",   label: "Type",         type: "text"  },
  { key: "document_number", label: "Document #",   type: "text"  },
  { key: "sender_name",     label: "Sender",       type: "text"  },
  { key: "sender_vat",      label: "Sender VAT",   type: "text"  },
  { key: "sender_peppol_id",label: "Sender Peppol ID", type: "text" },
  { key: "currency",        label: "Currency",     type: "text"  },
  { key: "amount",          label: "Amount",       type: "number"},
  { key: "issue_date",      label: "Issue Date",   type: "date"  },
  { key: "due_date",        label: "Due Date",     type: "date"  },
  { key: "created_at",      label: "Received",     type: "date"  },
];

// ─── StatusPill ───────────────────────────────────────────────────────────────

function StatusPill({ status }: { status: string }) {
  const s = STATUS_STYLES[status] ?? STATUS_STYLES.read;
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium", s.bg, s.text)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", s.dot)} />
      {STATUSES.find(x => x.value === status)?.label ?? status}
    </span>
  );
}

// ─── RejectDialog ────────────────────────────────────────────────────────────

function RejectDialog({
  open, onOpenChange, doc, onRejected,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  doc: IncomingDocument;
  onRejected: () => void;
}) {
  const { data: regs } = useAppCollection<PeppolRegistration>(APP_ID, "peppol_registration");
  const { data: sellers } = useAppCollection<SellerSettings>(APP_ID, "seller_settings");
  const { update } = useAppCollection<IncomingDocument>("peppol", "incoming_documents");
  const { call } = useIntegration("peppol");

  const [reasonCode, setReasonCode] = useState("OTH");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const reg = regs?.[0];
  const seller = sellers?.[0];

  const handleReject = async () => {
    if (!reg?.peppol_id || !seller?.company_name) {
      toast.error("Peppol registration or seller settings missing");
      return;
    }
    if (!reason.trim()) {
      toast.error("Please provide a reason");
      return;
    }
    setBusy(true);
    try {
      await call("reject_invoice", {
        senderPeppolId: reg.peppol_id,
        senderName: seller.company_name,
        receiverPeppolId: doc.sender_peppol_id,
        receiverName: doc.sender_name,
        originalInvoiceNumber: doc.document_number,
        originalInvoiceDate: doc.issue_date,
        countryCode: seller.country_code ?? "BE",
        reason: reason.trim(),
        reasonCode,
      });
      await update(doc.id, { status: "rejected" });
      toast.success("Invoice rejected — response sent via Peppol");
      onOpenChange(false);
      onRejected();
    } catch (e: any) {
      toast.error("Rejection failed: " + e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Reject Invoice</DialogTitle>
          <DialogDescription>
            Send an official rejection to {doc.sender_name || "the sender"} for invoice {doc.document_number || "—"} via the Peppol network.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Reason category</label>
            <Select value={reasonCode} onValueChange={setReasonCode}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REASON_CODES.map(rc => (
                  <SelectItem key={rc.value} value={rc.value}>{rc.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Reason</label>
            <Textarea
              placeholder="Explain why this invoice is being rejected…"
              value={reason}
              onChange={e => setReason(e.target.value)}
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleReject} disabled={busy || !reason.trim()}>
            {busy && <IconLoader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
            Reject Invoice
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}



function fmtAmt(v: number | undefined, currency: string): string {
  if (v == null) return "—";
  return new Intl.NumberFormat("fr-BE", { style: "currency", currency }).format(v);
}

// ─── IncomingDocumentPreview ──────────────────────────────────────────────────

function IncomingDocumentPreview({ doc }: { doc: IncomingDocument }) {
  const [showXml, setShowXml] = useState(false);
  const [copied, setCopied]   = useState(false);

  const handleCopy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const { call } = useIntegration("peppol");
  const [ubl, setUbl] = useState<any>(null);
  useEffect(() => {
    if (!doc.xml) return;
    call("parse_ubl", { xml: doc.xml }).then(setUbl).catch(() => setUbl(null));
  }, [doc.xml, call]);
  const currency = ubl?.currency || doc.currency || "EUR";
  const s = STATUS_STYLES[doc.status] ?? STATUS_STYLES.read;

  // Prefer UBL-parsed totals over doc.amount (which may store PayableAmount=0)
  const totalAmount = ubl?.monetaryTotal?.taxInclusiveAmount ?? ubl?.monetaryTotal?.payableAmount ?? doc.amount;

  return (
    <div className="max-w-3xl mx-auto">
      <div className="bg-white shadow-md rounded-lg overflow-hidden">

        {/* Header band */}
        <div className="bg-white border-b border-slate-200 px-10 py-8">
          <div className="flex items-start justify-between gap-6">
            {/* Supplier info from UBL */}
            <div>
              <p className="text-xl font-bold tracking-tight text-slate-900">
                {ubl?.seller?.name || doc.sender_name || "Unknown Sender"}
              </p>
              {(ubl?.seller?.address?.street || ubl?.seller?.address?.city) && (
                <p className="text-slate-500 text-xs mt-0.5">
                  {[ubl.seller.address.street, ubl.seller.address.postalZone ? `${ubl.seller.address.postalZone} ${ubl.seller.address.city}` : ubl.seller.address.city]
                    .filter(Boolean).join(", ")}
                  {ubl.seller.address.countryCode && `, ${ubl.seller.address.countryCode === "BE" ? "Belgium" : ubl.seller.address.countryCode}`}
                </p>
              )}
              {(ubl?.seller?.vatNumber || doc.sender_vat) && (
                <p className="text-slate-500 text-xs mt-0.5">nº TVA/BTW: {ubl?.seller?.vatNumber || doc.sender_vat}</p>
              )}
              {ubl?.seller?.companyId && (
                <p className="text-slate-500 text-xs">KBO/CBE: {ubl.seller.companyId.replace(/^0+/, "")}</p>
              )}
              {ubl?.seller?.contact?.email && (
                <p className="text-slate-400 text-xs mt-1">{ubl.seller.contact.email}</p>
              )}
              {ubl?.seller?.contact?.name && (
                <p className="text-slate-400 text-xs">{ubl.seller.contact.name}</p>
              )}
              {ubl?.seller?.contact?.phone && (
                <p className="text-slate-400 text-xs">{ubl.seller.contact.phone}</p>
              )}
            </div>

            {/* Document identity */}
            <div className="text-right shrink-0">
              <p className="text-2xl font-black tracking-tight mb-1 text-slate-900">
                {doc.document_type === "CreditNote" ? "CREDIT NOTE" : "INVOICE"}
              </p>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-0.5">Invoice number</p>
              <p className="font-mono text-slate-700 text-sm font-semibold">{ubl?.documentNumber || doc.document_number || "—"}</p>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mt-2 mb-0.5">Date</p>
              <p className="text-sm text-slate-700">{ubl?.issueDate || doc.issue_date || "—"}</p>
              {(ubl?.dueDate || doc.due_date) && (
                <>
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mt-2 mb-0.5">Due date</p>
                  <p className="text-sm text-slate-700">{ubl?.dueDate || doc.due_date}</p>
                </>
              )}
              <span className={cn("inline-flex items-center gap-1.5 mt-3 px-2.5 py-0.5 rounded-full text-xs font-bold", s.bg, s.text)}>
                <span className={cn("h-1.5 w-1.5 rounded-full", s.dot)} />
                {STATUSES.find(x => x.value === doc.status)?.label?.toUpperCase() ?? doc.status?.toUpperCase()}
              </span>
            </div>
          </div>
        </div>

        <div className="px-10 py-8 space-y-8">

          {/* From / To */}
          <div className="grid grid-cols-2 gap-8">
            {/* Supplier (From) */}
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-2">From</p>
              <p className="font-semibold text-slate-900">{ubl?.seller?.name || doc.sender_name || "—"}</p>
              {ubl?.seller?.address?.street && <p className="text-slate-600 text-sm">{ubl.seller.address.street}</p>}
              {(ubl?.seller?.address?.postalZone || ubl?.seller?.address?.city) && (
                <p className="text-slate-600 text-sm">
                  {[ubl.seller.address.postalZone, ubl.seller.address.city].filter(Boolean).join(" ")}
                </p>
              )}
              {ubl?.seller?.address?.countryCode && (
                <p className="text-slate-500 text-sm">
                  {ubl.seller.address.countryCode === "BE" ? "Belgium" : ubl.seller.address.countryCode}
                </p>
              )}
              {(ubl?.seller?.vatNumber || doc.sender_vat) && (
                <p className="text-slate-400 text-xs mt-1">nº TVA/BTW: {ubl?.seller?.vatNumber || doc.sender_vat}</p>
              )}
              {ubl?.seller?.companyId && (
                <p className="text-slate-400 text-xs">KBO/CBE: {ubl.seller.companyId.replace(/^0+/, "")}</p>
              )}
            </div>

            {/* Customer (To) */}
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-2">To</p>
              <p className="font-semibold text-slate-900">{ubl?.buyer?.name || doc.receiver_name || "—"}</p>
              {ubl?.buyer?.address?.street && <p className="text-slate-600 text-sm">{ubl.buyer.address.street}</p>}
              {(ubl?.buyer?.address?.postalZone || ubl?.buyer?.address?.city) && (
                <p className="text-slate-600 text-sm">
                  {[ubl.buyer.address.postalZone, ubl.buyer.address.city].filter(Boolean).join(" ")}
                </p>
              )}
              {ubl?.buyer?.address?.countryCode && (
                <p className="text-slate-500 text-sm">
                  {ubl.buyer.address.countryCode === "BE" ? "Belgium" : ubl.buyer.address.countryCode}
                </p>
              )}
              {ubl?.buyer?.vatNumber && (
                <p className="text-slate-400 text-xs mt-1">nº TVA/BTW: {ubl.buyer.vatNumber}</p>
              )}
              {ubl?.buyer?.companyId && (
                <p className="text-slate-400 text-xs">KBO/CBE: {ubl.buyer.companyId.replace(/^0+/, "")}</p>
              )}
            </div>
          </div>

          {/* Delivery info */}
          {(ubl?.delivery?.date || ubl?.delivery?.address || ubl?.delivery?.partyName) && (
            <div className="bg-slate-50 rounded-md px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-2">Delivery information</p>
              <div className="text-sm text-slate-600 space-y-0.5">
                {ubl.delivery.date && <p>Delivery date: {ubl.delivery.date}</p>}
                {ubl.delivery.partyName && <p className="font-medium text-slate-800">{ubl.delivery.partyName}</p>}
                {ubl.delivery.address?.street && <p>{ubl.delivery.address.street}</p>}
                {(ubl.delivery.address?.postalZone || ubl.delivery.address?.city) && (
                  <p>{[ubl.delivery.address.postalZone, ubl.delivery.address.city].filter(Boolean).join(" ")}</p>
                )}
                {ubl.delivery.address?.countryCode && (
                  <p>{ubl.delivery.address.countryCode === "BE" ? "Belgium" : ubl.delivery.address.countryCode}</p>
                )}
              </div>
            </div>
          )}

          {/* References */}
          {(ubl?.despatchDocumentReference || ubl?.buyerReference) && (
            <div className="grid grid-cols-2 gap-4 text-sm">
              {ubl.despatchDocumentReference && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-0.5">Despatch number</p>
                  <p className="font-mono text-slate-700">{ubl.despatchDocumentReference}</p>
                </div>
              )}
              {ubl.buyerReference && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-0.5">Buyer Reference</p>
                  <p className="font-mono text-slate-700">{ubl.buyerReference}</p>
                </div>
              )}
            </div>
          )}

          {/* Line items */}
          {ubl && ubl.lines.length > 0 ? (
            <div>
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b-2 border-slate-900">
                    <th className="text-left py-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Product or service</th>
                    <th className="text-right py-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500 w-16">Qty</th>
                    <th className="text-right py-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500 w-28">Unit price</th>
                    <th className="text-right py-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500 w-28">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {ubl.lines.map((line: any) => (
                    <tr key={line.id} className="border-b border-slate-100">
                      <td className="py-3 pr-4">
                        <p className="text-slate-800 font-medium">{line.description || "—"}</p>
                        {line.sellersItemId && (
                          <p className="text-xs text-slate-400 mt-0.5">Seller product ID: {line.sellersItemId}</p>
                        )}
                      </td>
                      <td className="py-3 text-right text-slate-600 tabular-nums">
                        {line.quantity} {line.unitCode || "unit"}
                      </td>
                      <td className="py-3 text-right text-slate-600 tabular-nums">
                        {fmtAmt(line.unitPrice, currency)}
                      </td>
                      <td className="py-3 text-right font-semibold text-slate-800 tabular-nums">
                        {fmtAmt(line.lineAmount, currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            /* Fallback: single-line summary */
            <div>
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b-2 border-slate-900">
                    <th className="text-left py-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Description</th>
                    <th className="text-right py-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-slate-100">
                    <td className="py-3 text-slate-700">
                      {doc.document_type === "CreditNote" ? "Credit Note" : "Invoice"}{" "}
                      {doc.document_number && <span className="font-mono text-slate-400">{doc.document_number}</span>}
                    </td>
                    <td className="py-3 text-right font-semibold text-slate-800 tabular-nums">
                      {totalAmount != null ? fmtAmt(totalAmount, currency) : "—"}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {/* Totals */}
          <div className="flex justify-end">
            <div className="w-64 space-y-1.5 text-sm">
              {ubl?.monetaryTotal?.lineExtensionAmount != null && (
                <div className="flex justify-between text-slate-600">
                  <span>Subtotal</span>
                  <span className="tabular-nums">{fmtAmt(ubl.monetaryTotal.lineExtensionAmount, currency)}</span>
                </div>
              )}
              {ubl?.taxTotal?.taxAmount != null && (
                <div className="flex justify-between text-slate-600">
                  <span>VAT {ubl.taxTotal.subtotals?.[0]?.percent != null ? `${ubl.taxTotal.subtotals[0].percent.toLocaleString("fr-BE")}%` : ""}</span>
                  <span className="tabular-nums">{fmtAmt(ubl.taxTotal.taxAmount, currency)}</span>
                </div>
              )}
              <div className="border-t-2 border-slate-900 pt-2 flex justify-between font-bold text-slate-900">
                <span>Total amount</span>
                <span className="tabular-nums text-lg">
                  {fmtAmt(ubl?.monetaryTotal?.taxInclusiveAmount ?? ubl?.monetaryTotal?.payableAmount ?? totalAmount, currency)}
                </span>
              </div>
              {ubl?.monetaryTotal?.prepaidAmount != null && ubl.monetaryTotal.prepaidAmount > 0 && (
                <div className="flex justify-between text-slate-500 text-xs">
                  <span>Already paid</span>
                  <span className="tabular-nums">−{fmtAmt(ubl.monetaryTotal.prepaidAmount, currency)}</span>
                </div>
              )}
              {ubl?.monetaryTotal?.payableAmount != null && ubl?.monetaryTotal?.prepaidAmount != null && ubl.monetaryTotal.prepaidAmount > 0 && (
                <div className="flex justify-between font-semibold text-slate-800 border-t border-slate-200 pt-1.5 mt-1">
                  <span>Balance due</span>
                  <span className="tabular-nums">{fmtAmt(ubl.monetaryTotal.payableAmount, currency)}</span>
                </div>
              )}
            </div>
          </div>

          {/* Payment info */}
          {(ubl?.paymentMeans?.[0]?.paymentId || ubl?.paymentMeans?.[0]?.iban) && (
            <div className="bg-slate-50 rounded-md px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-2">Payment</p>
              <div className="text-sm text-slate-600 space-y-0.5">
                {ubl.paymentMeans[0].paymentId && <p>Remittance information: <span className="font-mono">{ubl.paymentMeans[0].paymentId}</span></p>}
                {ubl.paymentMeans[0].iban && (
                  <p>
                    {ubl.paymentMeans[0].accountName && <span className="font-medium text-slate-800 mr-2">{ubl.paymentMeans[0].accountName}</span>}
                    <span className="font-mono">{ubl.paymentMeans[0].iban}</span>
                    {ubl.paymentMeans[0].bic && <span className="text-slate-400 ml-2">({ubl.paymentMeans[0].bic})</span>}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Technical References */}
          {(doc.document_ulid || doc.as4_message_id || doc.instance_identifier) && (
            <div className="border-t border-slate-100 pt-6">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-2">Technical References</p>
              <div className="space-y-1">
                {doc.document_ulid && (
                  <div className="flex gap-2 text-sm">
                    <span className="text-slate-400 shrink-0">Document ULID:</span>
                    <span className="font-mono text-slate-600 text-xs">{doc.document_ulid}</span>
                  </div>
                )}
                {doc.as4_message_id && (
                  <div className="flex gap-2 text-sm">
                    <span className="text-slate-400 shrink-0">AS4 Message ID:</span>
                    <span className="font-mono text-slate-600 text-xs">{doc.as4_message_id}</span>
                  </div>
                )}
                {doc.instance_identifier && (
                  <div className="flex gap-2 text-sm">
                    <span className="text-slate-400 shrink-0">Instance ID:</span>
                    <span className="font-mono text-slate-600 text-xs">{doc.instance_identifier}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* UBL XML */}
          {doc.xml && (
            <div className="border-t border-slate-100 pt-6 space-y-3">
              <div className="flex items-center justify-between">
                <button
                  className="flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
                  onClick={() => setShowXml(v => !v)}
                >
                  <IconFileText className="h-3.5 w-3.5" />
                  {showXml ? "Hide" : "View"} UBL XML
                </button>
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => handleCopy(doc.xml)}>
                  {copied
                    ? <><IconCheck className="h-3.5 w-3.5 mr-1 text-emerald-600" />Copied!</>
                    : <><IconCopy className="h-3.5 w-3.5 mr-1" />Copy XML</>
                  }
                </Button>
              </div>
              {showXml && (
                <pre className="max-h-80 overflow-auto rounded-md border bg-slate-50 p-3 text-[11px] leading-relaxed font-mono text-slate-500 whitespace-pre-wrap break-all">
                  {doc.xml}
                </pre>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="bg-slate-50 border-t border-slate-200 px-10 py-4">
          <p className="text-center text-xs text-slate-400">
            Received via Peppol network
            {doc.document_type ? ` · ${doc.document_type}` : ""}
            {currency ? ` · ${currency}` : ""}
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Main view ────────────────────────────────────────────────────────────────

export default function IncomingInvoicesView() {
  const [conditions, setConditions] = useState<Condition[]>([]);
  const [search, setSearch]         = useState("");
  const [pageIndex, setPageIndex]   = useState(0);
  const [orderBy, setOrderBy]       = useState("issue_date");
  const [order, setOrder]           = useState<"asc" | "desc">("desc");
  const [selected, setSelected]     = useState<IncomingDocument | null>(null);

  // ── Where clause ────────────────────────────────────────────────────────────
  const where = useMemo<WhereClause | undefined>(() => {
    const clauses: WhereClause[] = [];

    if (search) {
      clauses.push({
        $or: [
          { document_number: { $ilike: `%${search}%` } },
          { sender_name:     { $ilike: `%${search}%` } },
          { sender_vat:      { $ilike: `%${search}%` } },
          { sender_peppol_id:{ $ilike: `%${search}%` } },
        ],
      });
    }

    for (const cond of conditions) {
      const clause = conditionToWhereClause(cond, FIELD_DEFS);
      if (clause) clauses.push(clause);
    }

    return clauses.length === 0 ? undefined
         : clauses.length === 1 ? clauses[0]
         : { $and: clauses };
  }, [search, conditions]);

  const { data: docs, total, loading } = useAppCollection<IncomingDocument>("peppol", "incoming_documents", {
    where, orderBy, order, limit: PAGE_SIZE, offset: pageIndex * PAGE_SIZE,
  });

  const hasAny = conditions.length > 0 || !!search;

  // ── Columns ─────────────────────────────────────────────────────────────────
  const columns: ColumnDef<IncomingDocument, unknown>[] = [
    {
      accessorKey: "document_number",
      header: "Document #",
      cell: ({ row }) => (
        <span className="font-mono text-sm font-medium">{row.original.document_number || "—"}</span>
      ),
    },
    {
      accessorKey: "sender_name",
      header: "Sender",
      cell: ({ row }) => (
        <div>
          <p className="font-medium leading-none">{row.original.sender_name || <span className="text-muted-foreground italic">—</span>}</p>
          {row.original.sender_peppol_id && (
            <p className="font-mono text-xs text-muted-foreground mt-0.5">{row.original.sender_peppol_id}</p>
          )}
        </div>
      ),
    },
    {
      accessorKey: "amount",
      header: "Amount",
      cell: ({ row }) => (
        <span className="font-semibold tabular-nums text-sm">
          {row.original.amount != null ? formatCurrency(row.original.amount, row.original.currency || "EUR") : "—"}
        </span>
      ),
    },
    {
      accessorKey: "issue_date",
      header: "Issue Date",
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">{row.original.issue_date ? formatDate(row.original.issue_date) : "—"}</span>
      ),
    },
    {
      accessorKey: "due_date",
      header: "Due Date",
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">{row.original.due_date ? formatDate(row.original.due_date) : "—"}</span>
      ),
    },
    {
      accessorKey: "document_type",
      header: "Type",
      cell: ({ row }) => (
        <Badge variant="outline" className="font-mono text-xs">{row.original.document_type || "—"}</Badge>
      ),
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => <StatusPill status={row.original.status} />,
    },
    {
      accessorKey: "created_at",
      header: "Received",
      cell: ({ row }) => {
        const d = new Date(row.original.created_at);
        return (
          <span className="text-sm text-muted-foreground">
            {d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
            {" "}
            <span className="text-xs opacity-70">
              {d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
            </span>
          </span>
        );
      },
    },
  ];

  // ── Detail view ─────────────────────────────────────────────────────────────
  const [rejectOpen, setRejectOpen] = useState(false);

  if (selected) {
    const canReject = selected.status !== "rejected";
    return (
      <div className="flex flex-col h-full">
        {/* Top bar */}
        <div className="flex items-center justify-between px-6 py-3 border-b bg-background shrink-0">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => setSelected(null)}>
              <IconArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <p className="font-semibold text-sm">{selected.document_number || "Incoming Document"}</p>
              <p className="text-xs text-muted-foreground">{selected.sender_name || "—"}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {canReject && (
              <Button variant="outline" size="sm" onClick={() => setRejectOpen(true)} className="text-destructive border-destructive/30 hover:bg-destructive/5">
                <IconBan className="h-3.5 w-3.5 mr-1.5" />
                Reject
              </Button>
            )}
            <StatusPill status={selected.status} />
          </div>
        </div>

        {/* Preview */}
        <div className="flex-1 overflow-y-auto bg-muted/30 p-6">
          <IncomingDocumentPreview doc={selected} />
        </div>

        {canReject && (
          <RejectDialog
            open={rejectOpen}
            onOpenChange={setRejectOpen}
            doc={selected}
            onRejected={() => setSelected({ ...selected, status: "rejected" })}
          />
        )}
      </div>
    );
  }

  // ── List view ───────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col flex-1 p-6 gap-5 min-h-0 overflow-hidden">
      <PageHeader
        title="Incoming Invoices"
        description="Invoices received via the Peppol network"
      />

      <FilterBar
        fieldDefs={FIELD_DEFS}
        conditions={conditions}
        search={search}
        onSearch={v => { setSearch(v); setPageIndex(0); }}
        onAdd={cond => { setConditions(prev => [...prev, cond]); setPageIndex(0); }}
        onUpdate={(id, patch) => { setConditions(prev => prev.map(c => c.id === id ? { ...c, ...patch } : c)); setPageIndex(0); }}
        onRemove={id => { setConditions(prev => prev.filter(c => c.id !== id)); setPageIndex(0); }}
        onClearAll={() => { setSearch(""); setConditions([]); setPageIndex(0); }}
        searchPlaceholder="Search documents…"
        totalLabel={!loading
          ? (total === 0
            ? "No documents found"
            : `${total} document${total !== 1 ? "s" : ""}${hasAny ? " matching filters" : ""}`)
          : undefined
        }
      />

      <DataTable
        className="flex-1 min-h-0"
        data={docs ?? []}
        columns={columns}
        loading={loading}
        pageSize={PAGE_SIZE}
        rowCount={total}
        onPaginationChange={({ pageIndex: pi }) => setPageIndex(pi)}
        onSortingChange={(s: SortingState) => {
          if (s[0]) { setOrderBy(s[0].id); setOrder(s[0].desc ? "desc" : "asc"); }
          else      { setOrderBy("issue_date"); setOrder("desc"); }
          setPageIndex(0);
        }}
        onRowClick={row => setSelected(row)}
        emptyState={
          <EmptyState
            icon={<IconInbox className="h-10 w-10 text-muted-foreground" />}
            title={hasAny ? "No matching documents" : "No incoming invoices yet"}
            description={hasAny ? "Try adjusting your search or filters" : "Invoices received via Peppol will appear here"}
          />
        }
      />
    </div>
  );
}
