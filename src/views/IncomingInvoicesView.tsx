import { useState, useMemo } from "react";
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
  const { call } = useIntegration(APP_ID, "peppol");

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

// ─── IncomingDocumentPreview ──────────────────────────────────────────────────

function IncomingDocumentPreview({ doc }: { doc: IncomingDocument }) {
  const [showXml, setShowXml] = useState(false);
  const [copied, setCopied]   = useState(false);

  const handleCopy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const currency = doc.currency || "EUR";
  const s = STATUS_STYLES[doc.status] ?? STATUS_STYLES.read;

  return (
    <div className="max-w-3xl mx-auto">
      <div className="bg-white shadow-md rounded-lg overflow-hidden">

        {/* Header band */}
        <div className="bg-white border-b border-slate-200 px-10 py-8">
          <div className="flex items-start justify-between">
            {/* Sender info */}
            <div>
              <p className="text-xl font-bold tracking-tight text-slate-900">{doc.sender_name || "Unknown Sender"}</p>
              {doc.sender_vat && (
                <p className="text-slate-500 text-xs mt-0.5">VAT: {doc.sender_vat}</p>
              )}
              {doc.sender_peppol_id && (
                <p className="font-mono text-slate-400 text-xs mt-1">Peppol: {doc.sender_peppol_id}</p>
              )}
            </div>

            {/* Document identity */}
            <div className="text-right">
              <p className="text-2xl font-black tracking-tight mb-1 text-slate-900">
                {doc.document_type === "CreditNote" ? "CREDIT NOTE" : "INVOICE"}
              </p>
              <p className="font-mono text-slate-500 text-sm">{doc.document_number || "—"}</p>
              <span className={cn("inline-flex items-center gap-1.5 mt-2 px-2.5 py-0.5 rounded-full text-xs font-bold", s.bg, s.text)}>
                <span className={cn("h-1.5 w-1.5 rounded-full", s.dot)} />
                {STATUSES.find(x => x.value === doc.status)?.label?.toUpperCase() ?? doc.status?.toUpperCase()}
              </span>
            </div>
          </div>
        </div>

        <div className="px-10 py-8 space-y-8">

          {/* Dates row */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-0.5">Issue Date</p>
              <p className="text-sm font-medium text-slate-800">{doc.issue_date ? formatDate(doc.issue_date) : "—"}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-0.5">Due Date</p>
              <p className="text-sm font-medium text-slate-800">{doc.due_date ? formatDate(doc.due_date) : "—"}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-0.5">Received</p>
              <p className="text-sm font-medium text-slate-800">
                {new Date(doc.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
              </p>
            </div>
          </div>

          {/* From / To */}
          <div className="grid grid-cols-2 gap-8">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-2">From</p>
              <p className="font-semibold text-slate-900">{doc.sender_name || "—"}</p>
              {doc.sender_vat && <p className="text-slate-500 text-xs mt-0.5">VAT: {doc.sender_vat}</p>}
              {doc.sender_peppol_id && (
                <p className="font-mono text-slate-400 text-xs mt-1">{doc.sender_peppol_id}</p>
              )}
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-2">To</p>
              <p className="font-semibold text-slate-900">{doc.receiver_name || "—"}</p>
              {doc.receiver_peppol_id && (
                <p className="font-mono text-slate-400 text-xs mt-1">{doc.receiver_peppol_id}</p>
              )}
            </div>
          </div>

          {/* Amount summary */}
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
                    {doc.amount != null ? formatCurrency(doc.amount, currency) : "—"}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Total */}
          <div className="flex justify-end">
            <div className="w-64 space-y-2">
              <div className="border-t-2 border-slate-900 pt-2 flex justify-between font-bold text-slate-900">
                <span>Total ({currency})</span>
                <span className="tabular-nums text-lg">
                  {doc.amount != null ? formatCurrency(doc.amount, currency) : "—"}
                </span>
              </div>
            </div>
          </div>

          {/* References */}
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
            {doc.currency ? ` · ${doc.currency}` : ""}
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
  const [orderBy, setOrderBy]       = useState("created_at");
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
          else      { setOrderBy("created_at"); setOrder("desc"); }
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
