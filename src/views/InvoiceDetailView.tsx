import { useState, useEffect, lazy, Suspense } from "react";
import { useAppRecord, useAppCollection, useRuntimeClient } from "@rootcx/sdk";
import {
  Button, Badge, Tabs, TabsList, TabsTrigger, TabsContent,
  toast, LoadingState, ErrorState,
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  Tooltip, TooltipTrigger, TooltipContent, TooltipProvider,
  ConfirmDialog,
} from "@rootcx/ui";
import { IconArrowLeft, IconDeviceFloppy, IconNetwork, IconPrinter, IconTag, IconDotsVertical, IconTrash, IconReceiptRefund } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import type { Invoice, InvoiceStatus, LineItem, PeppolRegistration, SellerSettings } from "../types";
import { computeTotals, FIELD_NONE, isCreditNote, todayISO } from "../types";
import InvoiceDetailsTab from "../components/InvoiceDetailsTab";
import InvoiceComplianceTab from "../components/InvoiceComplianceTab";
const InvoicePreview = lazy(() => import("../components/InvoicePreview"));
import PeppolSendDialog from "../components/PeppolSendDialog";

const APP_ID = "billing";

const STATUS_CONFIG: Record<InvoiceStatus, { label: string; className: string }> = {
  draft:     { label: "Draft",     className: "bg-zinc-100 text-zinc-600 border-zinc-200" },
  sent:      { label: "Sent",      className: "bg-blue-50 text-blue-700 border-blue-200" },
  paid:      { label: "Paid",      className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  overdue:   { label: "Overdue",   className: "bg-red-50 text-red-700 border-red-200" },
  cancelled: { label: "Cancelled", className: "bg-zinc-100 text-zinc-400 border-zinc-200" },
};

const STATUSES: InvoiceStatus[] = ["draft", "sent", "paid", "overdue", "cancelled"];

function buildPayload(draft: Partial<Invoice>, status: InvoiceStatus, seller?: SellerSettings) {
  const isCN = draft.document_type === "credit_note";
  return {
    invoice_number:       draft.invoice_number ?? "",
    status,
    invoice_date:         draft.invoice_date ?? "",
    due_date:             draft.due_date ?? "",
    currency:             draft.currency ?? "EUR",
    vat_treatment:        draft.vat_treatment ?? "standard",
    client_company:       draft.client_company ?? "",
    client_vat:           draft.client_vat ?? "",
    client_street:        draft.client_street ?? "",
    client_city:          draft.client_city ?? "",
    client_postal:        draft.client_postal ?? "",
    client_country:       draft.client_country ?? "",
    client_contact_name:  draft.client_contact_name ?? "",
    client_contact_email: draft.client_contact_email ?? "",
    line_items:           draft.line_items ?? [],
    references:           draft.references ?? [],
    internal_notes: draft.internal_notes === FIELD_NONE ? FIELD_NONE : (draft.internal_notes || seller?.default_notes || ""),
    terms:          draft.terms         === FIELD_NONE ? FIELD_NONE : (draft.terms         || seller?.default_terms || ""),
    subtotal:  draft.subtotal  ?? 0,
    total_tax: draft.total_tax ?? 0,
    total:     draft.total     ?? 0,
    document_type: isCN ? "credit_note" : "invoice",
    // Only emit the corrected-invoice link fields for credit notes — sending
    // empty strings into the entity_link / date fields could be rejected and
    // would needlessly touch every plain-invoice save.
    ...(isCN
      ? {
          corrected_invoice_id:     draft.corrected_invoice_id ?? "",
          corrected_invoice_number: draft.corrected_invoice_number ?? "",
          corrected_invoice_date:   draft.corrected_invoice_date ?? "",
          credit_reason:            draft.credit_reason ?? "",
        }
      : {}),
  };
}

interface Props { invoiceId: string; onBack: () => void; onDeleted?: () => void; onOpenInvoice?: (id: string) => void; }

export default function InvoiceDetailView({ invoiceId, onBack, onDeleted, onOpenInvoice }: Props) {
  const client = useRuntimeClient();
  const { create: createInvoice } = useAppCollection<Invoice>(APP_ID, "invoice");
  const { data: peppolRegs }     = useAppCollection<PeppolRegistration>(APP_ID, "peppol_registration");
  const { data: sellerSettings } = useAppCollection<SellerSettings>(APP_ID, "seller_settings");
  const seller       = sellerSettings?.[0];
  const peppolActive = peppolRegs?.[0]?.status === "active";

  const { data: invoice, loading, error, update, remove } = useAppRecord<Invoice>(APP_ID, "invoice", invoiceId);

  // Peppol-sent invoices are locked — never editable or deletable
  const { data: peppolLogs } = useAppCollection(APP_ID, "peppol_send_log", { where: { invoice_id: invoiceId }, limit: 1 });
  const isEditable = (peppolLogs?.length ?? 0) === 0;

  const [draft, setDraft]               = useState<Partial<Invoice>>({});
  const [saving, setSaving]             = useState(false);
  const [markAsOpen, setMarkAsOpen]     = useState(false);
  const [selectedStatus, setSelectedStatus] = useState<InvoiceStatus | "">("");
  const [peppolDialogOpen, setPeppolDialogOpen] = useState(false);
  const [deleteOpen, setDeleteOpen]     = useState(false);
  const [creatingCN, setCreatingCN]     = useState(false);

  useEffect(() => {
    if (invoice) setDraft({ ...invoice, line_items: invoice.line_items ?? [], references: invoice.references ?? [] });
  }, [invoice]);

  const updateDraft = (patch: Partial<Invoice>) =>
    setDraft((prev) => {
      const { subtotal, totalTax, total } = computeTotals((patch.line_items ?? prev.line_items ?? []) as LineItem[]);
      return { ...prev, ...patch, subtotal, total_tax: totalTax, total };
    });

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await update(buildPayload(draft, (draft.status ?? "draft") as InvoiceStatus, seller));
      toast.success("Invoice saved");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    try {
      await remove();
      toast.success("Invoice deleted");
      (onDeleted ?? onBack)();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleCreateCreditNote = async () => {
    if (creatingCN || !invoice) return;
    setCreatingCN(true);
    try {
      const today = todayISO();
      // Dedicated credit-note sequence: CN-YYYYMMDD-NNN (reuses the invoice
      // numbering RPC with a distinct prefix, so no collisions with invoices).
      const { invoice_number } = await client.rpc(
        APP_ID, "next_invoice_number", { prefix: "CN" },
      ) as { invoice_number: string };
      const cn = await createInvoice({
        invoice_number,
        status: "draft",
        document_type: "credit_note",
        corrected_invoice_id: invoice.id,
        corrected_invoice_number: invoice.invoice_number,
        corrected_invoice_date: invoice.invoice_date,
        credit_reason: "",
        invoice_date: today,
        due_date: today,
        currency: invoice.currency ?? "EUR",
        vat_treatment: invoice.vat_treatment ?? "standard",
        client_company: invoice.client_company ?? "",
        client_vat: invoice.client_vat ?? "",
        client_street: invoice.client_street ?? "",
        client_city: invoice.client_city ?? "",
        client_postal: invoice.client_postal ?? "",
        client_country: invoice.client_country ?? "",
        client_contact_name: invoice.client_contact_name ?? "",
        client_contact_email: invoice.client_contact_email ?? "",
        // Full copy of the original lines/refs — the user trims for partial credits.
        line_items: invoice.line_items ?? [],
        references: invoice.references ?? [],
        internal_notes: "",
        terms: "",
        subtotal: invoice.subtotal ?? 0,
        total_tax: invoice.total_tax ?? 0,
        total: invoice.total ?? 0,
      });
      toast.success(`Credit note ${invoice_number} created from ${invoice.invoice_number}`);
      if (onOpenInvoice) onOpenInvoice(cn.id);
      else onBack();
    } catch (e: any) {
      toast.error("Failed to create credit note: " + e.message);
    } finally {
      setCreatingCN(false);
    }
  };

  const handleMarkAs = async () => {
    if (!selectedStatus || saving) return;
    setSaving(true);
    try {
      await update(buildPayload(draft, selectedStatus, seller));
      setDraft((prev) => ({ ...prev, status: selectedStatus }));
      toast.success(`Invoice marked as ${STATUS_CONFIG[selectedStatus].label}`);
      setMarkAsOpen(false);
      setSelectedStatus("");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingState variant="spinner" />;
  if (error)   return <ErrorState message={(error as any)?.message ?? String(error)} />;

  const currentStatus = (draft.status ?? "draft") as InvoiceStatus;
  const statusCfg     = STATUS_CONFIG[currentStatus];
  const creditNote    = isCreditNote(draft);
  // A credit note corrects an already-issued (Peppol-locked) invoice. Offer the
  // action only on sent invoices, and never on a credit note itself.
  const canCreateCreditNote   = !creditNote && !isEditable;
  const createCnDisabledReason = !creditNote && isEditable ? "Send the invoice via Peppol first" : null;

  const totalIssues =
    [draft.client_company, draft.client_vat, draft.client_street, draft.client_city, draft.client_postal]
      .filter((v) => !v).length +
    ((draft.line_items ?? []).length === 0 ? 1 : 0);

  const showPeppol = isEditable && peppolActive && totalIssues === 0;
  const peppolDisabledReason = !isEditable        ? "Already sent via Peppol"
    : !peppolActive                               ? "Peppol is not activated"
    : totalIssues > 0                             ? "Fix compliance issues first"
    : null;

  // Only drafts can be deleted — sent/paid/overdue/cancelled are immutable records
  const isDeletable = currentStatus === "draft";

  return (
    <TooltipProvider>
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-3 border-b bg-background shrink-0">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack}>
            <IconArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <p className="font-semibold text-sm">{draft.invoice_number}</p>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium", statusCfg.className)}>
                {statusCfg.label}
              </span>
              {creditNote && (
                <Badge variant="outline" className="text-[10px] border-purple-200 bg-purple-50 text-purple-700">
                  Credit Note
                </Badge>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isEditable && (
            <Button size="sm" onClick={handleSave} disabled={saving}>
              <IconDeviceFloppy className="h-4 w-4 mr-2" />{saving ? "Saving…" : "Save"}
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" disabled={saving}>
                <IconDotsVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {isEditable && (
                <DropdownMenuItem onClick={() => { setSelectedStatus(""); setMarkAsOpen(true); }}>
                  <IconTag className="h-4 w-4 mr-2" />Mark as…
                </DropdownMenuItem>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <div>
                    <DropdownMenuItem
                      disabled={!showPeppol}
                      onClick={() => showPeppol && setPeppolDialogOpen(true)}
                    >
                      <IconNetwork className="h-4 w-4 mr-2" />Send via Peppol
                    </DropdownMenuItem>
                  </div>
                </TooltipTrigger>
                {peppolDisabledReason && (
                  <TooltipContent side="left">{peppolDisabledReason}</TooltipContent>
                )}
              </Tooltip>
              {!creditNote && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div>
                      <DropdownMenuItem
                        disabled={!canCreateCreditNote || creatingCN}
                        onClick={() => canCreateCreditNote && handleCreateCreditNote()}
                      >
                        <IconReceiptRefund className="h-4 w-4 mr-2" />
                        {creatingCN ? "Creating…" : "Create credit note"}
                      </DropdownMenuItem>
                    </div>
                  </TooltipTrigger>
                  {createCnDisabledReason && (
                    <TooltipContent side="left">{createCnDisabledReason}</TooltipContent>
                  )}
                </Tooltip>
              )}
              <DropdownMenuItem onClick={async () => {
                const { downloadInvoicePdf } = await import("../lib/downloadInvoicePdf");
                downloadInvoicePdf(draft as Invoice, seller);
              }}>
                <IconPrinter className="h-4 w-4 mr-2" />Export PDF
              </DropdownMenuItem>
              {isDeletable && (
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => setDeleteOpen(true)}
                >
                  <IconTrash className="h-4 w-4 mr-2" />Delete Invoice
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        <div className="w-[360px] shrink-0 border-r flex flex-col overflow-hidden">
          <Tabs defaultValue="details" className="flex flex-col flex-1 min-h-0">
            <TabsList className="mx-4 mt-3 shrink-0">
              <TabsTrigger value="details">Details</TabsTrigger>
              <TabsTrigger value="compliance" className="relative">
                Compliance
                {totalIssues > 0 && (
                  <span className="ml-1.5 inline-flex items-center justify-center rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold w-4 h-4">
                    {totalIssues}
                  </span>
                )}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="details" className="flex-1 overflow-y-auto min-h-0 mt-0 p-4">
              <InvoiceDetailsTab
                draft={draft}
                onChange={isEditable ? updateDraft : () => {}}
                sellerDefaultTerms={seller?.default_terms ?? ""}
                sellerDefaultNotes={seller?.default_notes ?? ""}
              />
            </TabsContent>
            <TabsContent value="compliance" className="flex-1 overflow-y-auto min-h-0 mt-0 p-4">
              <InvoiceComplianceTab draft={draft} />
            </TabsContent>
          </Tabs>
        </div>
        <div className="flex-1 overflow-y-auto bg-muted/30 p-6">
          <Suspense fallback={<div className="flex items-center justify-center h-full text-muted-foreground text-sm">Loading preview…</div>}>
            <InvoicePreview invoice={draft as Invoice} />
          </Suspense>
        </div>
      </div>

      <Dialog open={markAsOpen} onOpenChange={setMarkAsOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Mark as…</DialogTitle>
          </DialogHeader>
          <Select value={selectedStatus} onValueChange={(v) => setSelectedStatus(v as InvoiceStatus)}>
            <SelectTrigger>
              <SelectValue placeholder="Select a status" />
            </SelectTrigger>
            <SelectContent>
              {STATUSES.filter((s) => s !== currentStatus).map((s) => (
                <SelectItem key={s} value={s}>{STATUS_CONFIG[s].label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMarkAsOpen(false)}>Cancel</Button>
            <Button disabled={!selectedStatus || saving} onClick={handleMarkAs}>
              {saving ? "Saving…" : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {isEditable && (
        <PeppolSendDialog
          open={peppolDialogOpen}
          onOpenChange={setPeppolDialogOpen}
          invoice={draft as Invoice}
          onSent={async () => {
            await update(buildPayload(draft, "sent", seller));
            setDraft((prev) => ({ ...prev, status: "sent" }));
          }}
        />
      )}

      {isDeletable && (
        <ConfirmDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          title="Delete invoice?"
          description={`"${draft.invoice_number}" will be permanently deleted. This action cannot be undone.`}
          confirmLabel="Delete"
          onConfirm={handleDelete}
          destructive
        />
      )}
    </div>
    </TooltipProvider>
  );
}
