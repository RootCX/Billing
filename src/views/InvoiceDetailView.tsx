import { useState, useEffect, useCallback } from "react";
import { useAppCollection, useAppRecord } from "@rootcx/sdk";
import {
  PageHeader, Button, Tabs, TabsList, TabsTrigger, TabsContent,
  toast, LoadingState, ErrorState, ConfirmDialog,
} from "@rootcx/ui";
import { IconArrowLeft, IconDeviceFloppy, IconSend, IconNetwork } from "@tabler/icons-react";
import type { Invoice, LineItem, InvoiceReference, PeppolRegistration } from "../types";
import {
  computeTotals, generateInvoiceNumber, todayISO, addDays,
} from "../types";
import InvoiceDetailsTab from "../components/InvoiceDetailsTab";
import InvoiceComplianceTab from "../components/InvoiceComplianceTab";
import InvoicePreview from "../components/InvoicePreview";
import PeppolSendDialog from "../components/PeppolSendDialog";

const APP_ID = "billing";

interface Props {
  invoiceId: string | null;
  onBack: () => void;
}

function buildDefaultInvoice(): Partial<Invoice> {
  const today = todayISO();
  return {
    invoice_number: generateInvoiceNumber("INV"),
    status: "draft",
    invoice_date: today,
    due_date: addDays(today, 30),
    currency: "EUR",
    vat_treatment: "standard",
    client_company: "",
    client_vat: "",
    client_street: "",
    client_city: "",
    client_postal: "",
    client_country: "BE",
    client_contact_name: "",
    client_contact_email: "",
    line_items: [],
    references: [],
    internal_notes: "",
    terms: "",
    subtotal: 0,
    total_tax: 0,
    total: 0,
  };
}

export default function InvoiceDetailView({ invoiceId, onBack }: Props) {
  const isNew = invoiceId === null;

  const { create } = useAppCollection<Invoice>(APP_ID, "invoice");
  const { data: peppolRegs } = useAppCollection<PeppolRegistration>(APP_ID, "peppol_registration");
  const peppolActive = peppolRegs?.[0]?.status === "active";
  const {
    data: existingInvoice,
    loading,
    error,
    update,
  } = useAppRecord<Invoice>(APP_ID, "invoice", invoiceId ?? "__new__");

  const [draft, setDraft] = useState<Partial<Invoice>>(buildDefaultInvoice());
  const [saving, setSaving] = useState(false);
  const [confirmSentOpen, setConfirmSentOpen] = useState(false);
  const [peppolDialogOpen, setPeppolDialogOpen] = useState(false);
  const [initialized, setInitialized] = useState(false);

  // Load existing invoice into draft
  useEffect(() => {
    if (!isNew && existingInvoice && !initialized) {
      setDraft({
        ...existingInvoice,
        line_items: existingInvoice.line_items ?? [],
        references: existingInvoice.references ?? [],
      });
      setInitialized(true);
    }
    if (isNew && !initialized) {
      setInitialized(true);
    }
  }, [existingInvoice, isNew, initialized]);

  // Keep totals in sync
  const updateDraft = useCallback((patch: Partial<Invoice>) => {
    setDraft((prev) => {
      const next = { ...prev, ...patch };
      const items = (patch.line_items ?? prev.line_items ?? []) as LineItem[];
      const { subtotal, totalTax, total } = computeTotals(items);
      return { ...next, subtotal, total_tax: totalTax, total };
    });
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {
        invoice_number: draft.invoice_number ?? "",
        status: draft.status ?? "draft",
        invoice_date: draft.invoice_date ?? todayISO(),
        due_date: draft.due_date ?? addDays(todayISO(), 30),
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
        internal_notes: draft.internal_notes ?? "",
        terms: draft.terms ?? "",
        subtotal: draft.subtotal ?? 0,
        total_tax: draft.total_tax ?? 0,
        total: draft.total ?? 0,
      };

      if (isNew) {
        await create(payload);
        toast.success("Invoice created successfully");
        onBack();
      } else {
        await update(payload);
        toast.success("Invoice saved");
      }
    } catch (e: any) {
      toast.error("Failed to save invoice: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleMarkSent = async () => {
    setSaving(true);
    try {
      const { id, created_at, updated_at, ...fields } = draft as any;
      await update({ ...fields, status: "sent" });
      updateDraft({ status: "sent" });
      toast.success("Invoice marked as sent");
    } catch (e: any) {
      toast.error("Failed to update: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  if (!isNew && loading) return <LoadingState variant="spinner" />;
  if (!isNew && error) return <ErrorState message={typeof error === "string" ? error : (error as any)?.message ?? "Unknown error"} />;

  // Count compliance issues
  const missingClientFields = [
    draft.client_company,
    draft.client_vat,
    draft.client_street,
    draft.client_city,
    draft.client_postal,
  ].filter((v) => !v).length;

  const lineItemIssues = (draft.line_items ?? []).length === 0 ? 1 : 0;
  const totalIssues = missingClientFields + lineItemIssues;
  const isCompliant = totalIssues === 0;

  return (
    <div className="flex flex-col h-full">
      {/* Top bar */}
      <div className="flex items-center justify-between px-6 py-3 border-b bg-background shrink-0">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack}>
            <IconArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <p className="font-semibold text-sm">{draft.invoice_number}</p>
            <p className="text-xs text-muted-foreground capitalize">{draft.status}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {draft.status === "draft" && peppolActive && isCompliant && (
            <Button variant="default" size="sm" onClick={() => setPeppolDialogOpen(true)} disabled={saving} className="bg-blue-600 hover:bg-blue-700 text-white">
              <IconNetwork className="h-4 w-4 mr-2" />
              Send via Peppol
            </Button>
          )}
          {draft.status === "draft" && !peppolActive && (
            <Button variant="outline" size="sm" onClick={() => setConfirmSentOpen(true)} disabled={saving}>
              <IconSend className="h-4 w-4 mr-2" />
              Mark as Sent
            </Button>
          )}
          <Button size="sm" onClick={handleSave} disabled={saving}>
            <IconDeviceFloppy className="h-4 w-4 mr-2" />
            {saving ? "Saving…" : isNew ? "Create Invoice" : "Save"}
          </Button>
        </div>
      </div>

      {/* Main split layout */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left panel — 25% */}
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
              <InvoiceDetailsTab draft={draft} onChange={updateDraft} />
            </TabsContent>

            <TabsContent value="compliance" className="flex-1 overflow-y-auto min-h-0 mt-0 p-4">
              <InvoiceComplianceTab draft={draft} />
            </TabsContent>
          </Tabs>
        </div>

        {/* Right panel — 75% live preview */}
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

      {!isNew && draft.status === "draft" && (
        <PeppolSendDialog
          open={peppolDialogOpen}
          onOpenChange={setPeppolDialogOpen}
          invoice={draft as Invoice}
          onSent={async () => {
            await update({ ...(draft as any), status: "sent" });
            updateDraft({ status: "sent" });
          }}
        />
      )}
    </div>
  );
}
