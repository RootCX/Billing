import { useState, useEffect } from "react";
import { useAppRecord, useAppCollection } from "@rootcx/sdk";
import {
  Button, Tabs, TabsList, TabsTrigger, TabsContent,
  toast, LoadingState, ErrorState, ConfirmDialog,
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@rootcx/ui";
import {
  IconArrowLeft, IconDeviceFloppy, IconSend, IconNetwork,
  IconPrinter, IconDotsVertical, IconCircleCheck,
  IconCircleX, IconAlertTriangle,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import type { Invoice, InvoiceStatus, LineItem, PeppolRegistration, SellerSettings } from "../types";
import { computeTotals } from "../types";
import InvoiceDetailsTab, { FIELD_NONE } from "../components/InvoiceDetailsTab";
import InvoiceComplianceTab from "../components/InvoiceComplianceTab";
import InvoicePreview from "../components/InvoicePreview";
import PeppolSendDialog from "../components/PeppolSendDialog";
import { downloadInvoicePdf } from "../lib/downloadInvoicePdf";

const APP_ID = "billing";

// ─── Status config ──────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<InvoiceStatus, { label: string; className: string }> = {
  draft:     { label: "Draft",     className: "bg-zinc-100 text-zinc-600 border-zinc-200" },
  sent:      { label: "Sent",      className: "bg-blue-50 text-blue-700 border-blue-200" },
  paid:      { label: "Paid",      className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  overdue:   { label: "Overdue",   className: "bg-red-50 text-red-700 border-red-200" },
  cancelled: { label: "Cancelled", className: "bg-zinc-100 text-zinc-400 border-zinc-200" },
};

// Allowed transitions per status — order matters (first = primary button)
const TRANSITIONS: Record<InvoiceStatus, InvoiceStatus[]> = {
  draft:     ["sent"],
  sent:      ["paid", "overdue", "cancelled"],
  overdue:   ["paid", "cancelled"],
  paid:      [],
  cancelled: [],
};

interface TransitionDef {
  to: InvoiceStatus;
  label: string;
  icon: React.ReactNode;
  confirm: { title: string; description: string };
  destructive?: boolean;
}

function getTransitionDef(to: InvoiceStatus, invoiceNumber: string): TransitionDef {
  const defs: Record<InvoiceStatus, TransitionDef> = {
    sent: {
      to: "sent",
      label: "Send Invoice",
      icon: <IconSend className="h-4 w-4 mr-2" />,
      confirm: {
        title: "Send invoice?",
        description: `${invoiceNumber} will be marked as Sent. You won't be able to edit it afterwards.`,
      },
    },
    paid: {
      to: "paid",
      label: "Mark as Paid",
      icon: <IconCircleCheck className="h-4 w-4 mr-2" />,
      confirm: {
        title: "Mark invoice as paid?",
        description: `${invoiceNumber} will be marked as Paid. This action cannot be undone.`,
      },
    },
    overdue: {
      to: "overdue",
      label: "Mark as Overdue",
      icon: <IconAlertTriangle className="h-4 w-4 mr-2" />,
      confirm: {
        title: "Mark invoice as overdue?",
        description: `${invoiceNumber} will be marked as Overdue.`,
      },
    },
    cancelled: {
      to: "cancelled",
      label: "Cancel Invoice",
      icon: <IconCircleX className="h-4 w-4 mr-2" />,
      destructive: true,
      confirm: {
        title: "Cancel invoice?",
        description: `${invoiceNumber} will be cancelled. This action cannot be undone.`,
      },
    },
    // draft is never a transition target in TRANSITIONS — included for type completeness only
    draft: {
      to: "draft",
      label: "Revert to Draft",
      icon: null,
      confirm: { title: "", description: "" },
    },
  };
  return defs[to];
}

// ─── Build payload helper (avoids duplication between save & transition) ────────

function buildPayload(draft: Partial<Invoice>, status: InvoiceStatus, seller?: SellerSettings) {
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
    internal_notes: draft.internal_notes === FIELD_NONE
      ? FIELD_NONE
      : (draft.internal_notes || seller?.default_notes || ""),
    terms: draft.terms === FIELD_NONE
      ? FIELD_NONE
      : (draft.terms || seller?.default_terms || ""),
    subtotal:  draft.subtotal  ?? 0,
    total_tax: draft.total_tax ?? 0,
    total:     draft.total     ?? 0,
  };
}

// ─── Props ──────────────────────────────────────────────────────────────────────

interface Props { invoiceId: string; onBack: () => void; }

// ─── Component ──────────────────────────────────────────────────────────────────

export default function InvoiceDetailView({ invoiceId, onBack }: Props) {
  const { data: peppolRegs }     = useAppCollection<PeppolRegistration>(APP_ID, "peppol_registration");
  const { data: sellerSettings } = useAppCollection<SellerSettings>(APP_ID, "seller_settings");
  const seller      = sellerSettings?.[0];
  const peppolActive = peppolRegs?.[0]?.status === "active";

  const { data: invoice, loading, error, update } = useAppRecord<Invoice>(APP_ID, "invoice", invoiceId);

  const [draft, setDraft]   = useState<Partial<Invoice>>({});
  const [saving, setSaving] = useState(false);
  const [pendingTransition, setPendingTransition] = useState<TransitionDef | null>(null);
  const [peppolDialogOpen, setPeppolDialogOpen]   = useState(false);

  // Sync draft whenever the server record changes (covers first load + external updates)
  useEffect(() => {
    if (invoice) {
      setDraft({
        ...invoice,
        line_items: invoice.line_items ?? [],
        references: invoice.references ?? [],
      });
    }
  }, [invoice]);

  const updateDraft = (patch: Partial<Invoice>) =>
    setDraft((prev) => {
      const next = { ...prev, ...patch };
      const { subtotal, totalTax, total } = computeTotals(
        (patch.line_items ?? prev.line_items ?? []) as LineItem[],
      );
      return { ...next, subtotal, total_tax: totalTax, total };
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

  const handleTransition = async (targetStatus: InvoiceStatus) => {
    if (saving) return;
    setSaving(true);
    try {
      await update(buildPayload(draft, targetStatus, seller));
      // Update local draft status immediately — don't wait for refetch
      setDraft((prev) => ({ ...prev, status: targetStatus }));
      toast.success(`Invoice marked as ${STATUS_CONFIG[targetStatus].label}`);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const triggerTransition = (t: TransitionDef) => setPendingTransition(t);

  // ── Derived state ────────────────────────────────────────────────────────────

  if (loading) return <LoadingState variant="spinner" />;
  if (error)   return <ErrorState message={(error as any)?.message ?? String(error)} />;

  const currentStatus  = (draft.status ?? "draft") as InvoiceStatus;
  const statusCfg      = STATUS_CONFIG[currentStatus];
  const allowedTargets = TRANSITIONS[currentStatus];
  const isDraft        = currentStatus === "draft";

  const transitions = allowedTargets.map((s) =>
    getTransitionDef(s, draft.invoice_number ?? ""),
  );
  const primaryTransition    = transitions[0] ?? null;
  const secondaryTransitions = transitions.slice(1);

  const totalIssues =
    [draft.client_company, draft.client_vat, draft.client_street, draft.client_city, draft.client_postal]
      .filter((v) => !v).length +
    ((draft.line_items ?? []).length === 0 ? 1 : 0);

  // Peppol replaces the primary "Send Invoice" button when active + draft + no issues
  const showPeppol = isDraft && peppolActive && totalIssues === 0;

  return (
    <div className="flex flex-col h-full">
      {/* ── Top bar ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-6 py-3 border-b bg-background shrink-0">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack}>
            <IconArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <p className="font-semibold text-sm">{draft.invoice_number}</p>
            <span className={cn(
              "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium mt-0.5",
              statusCfg.className,
            )}>
              {statusCfg.label}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">

          {/* Peppol — replaces Send when active + draft + compliant */}
          {showPeppol && (
            <Button
              size="sm" disabled={saving}
              className="bg-blue-600 hover:bg-blue-700 text-white"
              onClick={() => setPeppolDialogOpen(true)}
            >
              <IconNetwork className="h-4 w-4 mr-2" />Send via Peppol
            </Button>
          )}

          {/* Primary transition (Send Invoice on draft-no-peppol, Mark as Paid on sent/overdue) */}
          {primaryTransition && !(isDraft && peppolActive) && (
            <Button
              size="sm"
              variant={primaryTransition.destructive ? "destructive" : isDraft ? "outline" : "default"}
              disabled={saving}
              onClick={() => triggerTransition(primaryTransition)}
            >
              {primaryTransition.icon}{primaryTransition.label}
            </Button>
          )}

          {/* ⋯ dropdown — secondary transitions + print */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" disabled={saving}>
                <IconDotsVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {secondaryTransitions.map((t) => (
                <DropdownMenuItem
                  key={t.to}
                  onClick={() => triggerTransition(t)}
                  className={cn(t.destructive && "text-destructive focus:text-destructive")}
                >
                  {t.icon}{t.label}
                </DropdownMenuItem>
              ))}
              {secondaryTransitions.length > 0 && <div className="h-px bg-border my-1" />}
              <DropdownMenuItem onClick={() => downloadInvoicePdf(draft as Invoice, seller)}>
                <IconPrinter className="h-4 w-4 mr-2" />Print / Export PDF
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Save — only when editable (draft) */}
          {isDraft && (
            <Button size="sm" onClick={handleSave} disabled={saving}>
              <IconDeviceFloppy className="h-4 w-4 mr-2" />{saving ? "Saving…" : "Save"}
            </Button>
          )}
        </div>
      </div>

      {/* ── Body ────────────────────────────────────────────────────────────── */}
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
                onChange={isDraft ? updateDraft : () => {}}
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
          <InvoicePreview invoice={draft as Invoice} />
        </div>
      </div>

      {/* ── Confirm dialog ──────────────────────────────────────────────────── */}
      <ConfirmDialog
        open={!!pendingTransition}
        onOpenChange={(open) => { if (!open) setPendingTransition(null); }}
        title={pendingTransition?.confirm.title ?? ""}
        description={pendingTransition?.confirm.description ?? ""}
        onConfirm={() => {
          if (pendingTransition) {
            handleTransition(pendingTransition.to);
            setPendingTransition(null);
          }
        }}
      />

      {/* ── Peppol send dialog ──────────────────────────────────────────────── */}
      {isDraft && (
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
    </div>
  );
}
