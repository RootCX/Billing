import { useState, useEffect } from "react";
import { useAppRecord, useAppCollection } from "@rootcx/sdk";
import {
  Button, Tabs, TabsList, TabsTrigger, TabsContent,
  toast, LoadingState, ErrorState, ConfirmDialog,
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@rootcx/ui";
import { IconArrowLeft, IconDeviceFloppy, IconSend, IconNetwork, IconPrinter, IconDotsVertical } from "@tabler/icons-react";
import type { Invoice, LineItem, PeppolRegistration, SellerSettings } from "../types";
import { computeTotals } from "../types";
import InvoiceDetailsTab, { FIELD_NONE } from "../components/InvoiceDetailsTab";
import InvoiceComplianceTab from "../components/InvoiceComplianceTab";
import InvoicePreview from "../components/InvoicePreview";
import PeppolSendDialog from "../components/PeppolSendDialog";
import { downloadInvoicePdf } from "../lib/downloadInvoicePdf";

const APP_ID = "billing";

interface Props { invoiceId: string; onBack: () => void; }

export default function InvoiceDetailView({ invoiceId, onBack }: Props) {
  const { data: peppolRegs } = useAppCollection<PeppolRegistration>(APP_ID, "peppol_registration");
  const { data: sellerSettings } = useAppCollection<SellerSettings>(APP_ID, "seller_settings");
  const seller = sellerSettings?.[0];
  const peppolActive = peppolRegs?.[0]?.status === "active";
  const { data: invoice, loading, error, update } = useAppRecord<Invoice>(APP_ID, "invoice", invoiceId);

  const [draft, setDraft] = useState<Partial<Invoice>>({});
  const [saving, setSaving] = useState(false);
  const [confirmSentOpen, setConfirmSentOpen] = useState(false);
  const [peppolDialogOpen, setPeppolDialogOpen] = useState(false);

  useEffect(() => {
    if (invoice && !draft.id)
      setDraft({ ...invoice, line_items: invoice.line_items ?? [], references: invoice.references ?? [] });
  }, [invoice]);

  const updateDraft = (patch: Partial<Invoice>) =>
    setDraft((prev) => {
      const next = { ...prev, ...patch };
      const { subtotal, totalTax, total } = computeTotals((patch.line_items ?? prev.line_items ?? []) as LineItem[]);
      return { ...next, subtotal, total_tax: totalTax, total };
    });

  const withSave = (fn: () => Promise<void>) => async () => {
    setSaving(true);
    try { await fn(); }
    catch (e: any) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  const handleSave = withSave(async () => {
    await update({
      invoice_number: draft.invoice_number ?? "",
      status: draft.status ?? "draft",
      invoice_date: draft.invoice_date ?? "",
      due_date: draft.due_date ?? "",
      currency: draft.currency ?? "EUR",
      vat_treatment: draft.vat_treatment ?? "standard",
      client_company: draft.client_company ?? "",
      client_vat: draft.client_vat ?? "",
      client_street: draft.client_street ?? "",
      client_city: draft.client_city ?? "",
      client_postal: draft.client_postal ?? "",
      client_country: draft.client_country ?? "",
      client_contact_name: draft.client_contact_name ?? "",
      client_contact_email: draft.client_contact_email ?? "",
      line_items: draft.line_items ?? [],
      references: draft.references ?? [],
      // FIELD_NONE = explicitly removed; "" = inherit seller default then freeze
      internal_notes: draft.internal_notes === FIELD_NONE ? FIELD_NONE : (draft.internal_notes || seller?.default_notes || ""),
      terms: draft.terms === FIELD_NONE ? FIELD_NONE : (draft.terms || seller?.default_terms || ""),
      subtotal: draft.subtotal ?? 0,
      total_tax: draft.total_tax ?? 0,
      total: draft.total ?? 0,
    });
    toast.success("Invoice saved");
  });

  const handleMarkSent = withSave(async () => {
    await update({ ...draft, status: "sent" } as any);
    updateDraft({ status: "sent" });
    toast.success("Invoice marked as sent");
  });

  if (loading) return <LoadingState variant="spinner" />;
  if (error) return <ErrorState message={(error as any)?.message ?? String(error)} />;

  const totalIssues =
    [draft.client_company, draft.client_vat, draft.client_street, draft.client_city, draft.client_postal].filter((v) => !v).length +
    ((draft.line_items ?? []).length === 0 ? 1 : 0);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-3 border-b bg-background shrink-0">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack}><IconArrowLeft className="h-4 w-4" /></Button>
          <div>
            <p className="font-semibold text-sm">{draft.invoice_number}</p>
            <p className="text-xs text-muted-foreground capitalize">{draft.status}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {draft.status === "draft" && peppolActive && totalIssues === 0 && (
            <Button variant="default" size="sm" onClick={() => setPeppolDialogOpen(true)} disabled={saving} className="bg-blue-600 hover:bg-blue-700 text-white">
              <IconNetwork className="h-4 w-4 mr-2" />Send via Peppol
            </Button>
          )}
          {draft.status === "draft" && !peppolActive && (
            <Button variant="outline" size="sm" onClick={() => setConfirmSentOpen(true)} disabled={saving}>
              <IconSend className="h-4 w-4 mr-2" />Mark as Sent
            </Button>
          )}
          <Button size="sm" onClick={handleSave} disabled={saving}>
            <IconDeviceFloppy className="h-4 w-4 mr-2" />{saving ? "Saving…" : "Save"}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon"><IconDotsVertical className="h-4 w-4" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => downloadInvoicePdf(draft as Invoice, seller)}>
                <IconPrinter className="h-4 w-4 mr-2" />Print
              </DropdownMenuItem>
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
              <InvoiceDetailsTab draft={draft} onChange={updateDraft} sellerDefaultTerms={seller?.default_terms ?? ""} sellerDefaultNotes={seller?.default_notes ?? ""} />
            </TabsContent>
            <TabsContent value="compliance" className="flex-1 overflow-y-auto min-h-0 mt-0 p-4">
              <InvoiceComplianceTab draft={draft} />
            </TabsContent>
          </Tabs>
        </div>
        <div className="flex-1 overflow-y-auto bg-muted/30 p-6">
          <InvoicePreview invoice={draft as Invoice} />
        </div>
      </div>

      <ConfirmDialog
        open={confirmSentOpen}
        onOpenChange={setConfirmSentOpen}
        title="Mark invoice as sent?"
        description={`This will change the status of ${draft.invoice_number} to Sent and save it immediately. This action cannot be undone from this button.`}
        onConfirm={handleMarkSent}
      />

      {draft.status === "draft" && (
        <PeppolSendDialog
          open={peppolDialogOpen}
          onOpenChange={setPeppolDialogOpen}
          invoice={draft as Invoice}
          onSent={async () => { await update({ ...(draft as any), status: "sent" }); updateDraft({ status: "sent" }); }}
        />
      )}
    </div>
  );
}
