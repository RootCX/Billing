import { useState } from "react";
import { useAppCollection } from "@rootcx/sdk";
import {
  PageHeader, DataTable, EmptyState, Badge, Button,
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@rootcx/ui";
import {
  IconNetwork, IconCircleCheck, IconAlertCircle, IconClock,
  IconFileText, IconCopy, IconExternalLink,
} from "@tabler/icons-react";
import type { ColumnDef } from "@tanstack/react-table";
import type { PeppolSendLog, PeppolSendStatus } from "../types";
import { formatCurrency } from "../types";
import { cn } from "@/lib/utils";

const APP_ID = "billing";
const PAGE_SIZE = 25;

const STATUS_CONFIG: Record<PeppolSendStatus, { label: string; icon: React.ReactNode; className: string }> = {
  pending:   { label: "Pending",   icon: <IconClock className="h-3.5 w-3.5" />,        className: "border-amber-200 bg-amber-50 text-amber-700" },
  sent:      { label: "Sent",      icon: <IconCircleCheck className="h-3.5 w-3.5" />,  className: "border-blue-200 bg-blue-50 text-blue-700" },
  delivered: { label: "Delivered", icon: <IconCircleCheck className="h-3.5 w-3.5" />,  className: "border-green-200 bg-green-50 text-green-700" },
  failed:    { label: "Failed",    icon: <IconAlertCircle className="h-3.5 w-3.5" />,  className: "border-red-200 bg-red-50 text-red-700" },
};

function StatusPill({ status }: { status: PeppolSendStatus }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium", cfg.className)}>
      {cfg.icon}
      {cfg.label}
    </span>
  );
}

interface Props {
  onOpenInvoice?: (id: string) => void;
}

export default function PeppolTransmissionsView({ onOpenInvoice }: Props) {
  const [pageIndex, setPageIndex] = useState(0);
  const [selectedLog, setSelectedLog] = useState<PeppolSendLog | null>(null);
  const [showXml, setShowXml] = useState(false);
  const [copied, setCopied] = useState(false);

  const { data: logs, total, loading } = useAppCollection<PeppolSendLog>(APP_ID, "peppol_send_log", {
    orderBy: "sent_at", order: "desc", limit: PAGE_SIZE, offset: pageIndex * PAGE_SIZE,
  });

  const handleCopyXml = async (xml: string) => {
    await navigator.clipboard.writeText(xml);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const columns: ColumnDef<PeppolSendLog, unknown>[] = [
    {
      accessorKey: "invoice_number",
      header: "Invoice",
      cell: ({ row }) => (
        <span className="font-mono text-sm font-medium">{row.original.invoice_number || "—"}</span>
      ),
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => <StatusPill status={row.original.status} />,
    },
    {
      accessorKey: "sender_peppol_id",
      header: "From",
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground">{row.original.sender_peppol_id || "—"}</span>
      ),
    },
    {
      accessorKey: "receiver_peppol_id",
      header: "To",
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground">{row.original.receiver_peppol_id || "—"}</span>
      ),
    },
    {
      accessorKey: "dokapi_ulid",
      header: "Reference",
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground truncate max-w-[140px] block">
          {row.original.dokapi_ulid || "—"}
        </span>
      ),
    },
    {
      accessorKey: "sent_at",
      header: "Sent At",
      cell: ({ row }) => {
        if (!row.original.sent_at) return <span className="text-muted-foreground text-xs">—</span>;
        const d = new Date(row.original.sent_at);
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
    {
      id: "ubl",
      header: "",
      cell: ({ row }) =>
        row.original.ubl_xml ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-muted-foreground"
            onClick={(e) => { e.stopPropagation(); setSelectedLog(row.original); setShowXml(false); setCopied(false); }}
          >
            <IconFileText className="h-3.5 w-3.5 mr-1" />
            UBL
          </Button>
        ) : null,
    },
  ];

  return (
    <>
      <div className="flex flex-col flex-1 p-6 gap-5 min-h-0 overflow-hidden">
        <PageHeader
          title="Peppol Transmissions"
          description="All invoices sent via the Peppol network"
        />

        {/* Summary strip */}
        {!loading && (logs ?? []).length > 0 && (
          <div className="flex gap-4">
            {(["sent", "delivered", "failed", "pending"] as PeppolSendStatus[]).map((s) => {
              const count = (logs ?? []).filter((l) => l.status === s).length;
              if (count === 0) return null;
              const cfg = STATUS_CONFIG[s];
              return (
                <div key={s} className={cn("flex items-center gap-2 rounded-lg border px-3 py-2 text-sm", cfg.className)}>
                  {cfg.icon}
                  <span className="font-semibold">{count}</span>
                  <span className="opacity-70">{cfg.label}</span>
                </div>
              );
            })}
          </div>
        )}

        <DataTable
          className="flex-1 min-h-0"
          data={logs ?? []}
          columns={columns}
          loading={loading}
          pageSize={PAGE_SIZE}
          rowCount={total}
          onPaginationChange={({ pageIndex: pi }) => setPageIndex(pi)}
          onRowClick={(row) => { setSelectedLog(row); setShowXml(false); setCopied(false); }}
          emptyState={
            <EmptyState
              icon={<IconNetwork className="h-10 w-10 text-muted-foreground" />}
              title="No transmissions yet"
              description="Peppol sends will appear here once you send an invoice"
            />
          }
        />
      </div>

      {/* Detail dialog */}
      <Dialog open={!!selectedLog} onOpenChange={(v) => { if (!v) setSelectedLog(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <IconNetwork className="h-5 w-5 text-primary" />
              Transmission — {selectedLog?.invoice_number}
            </DialogTitle>
          </DialogHeader>

          {selectedLog && (
            <div className="space-y-4 text-sm">
              {/* Status */}
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Status</span>
                <StatusPill status={selectedLog.status} />
              </div>

              {/* Routing */}
              <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Routing</p>
                <div className="flex items-start justify-between gap-2">
                  <span className="text-muted-foreground shrink-0">From</span>
                  <span className="font-mono text-xs text-right break-all">{selectedLog.sender_peppol_id || "—"}</span>
                </div>
                <div className="flex items-start justify-between gap-2">
                  <span className="text-muted-foreground shrink-0">To</span>
                  <span className="font-mono text-xs text-right break-all">{selectedLog.receiver_peppol_id || "—"}</span>
                </div>
              </div>

              {/* Meta */}
              <div className="space-y-1.5">
                {selectedLog.dokapi_ulid && (
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-muted-foreground shrink-0">Dokapi ref</span>
                    <span className="font-mono text-xs text-right break-all">{selectedLog.dokapi_ulid}</span>
                  </div>
                )}
                {selectedLog.sent_at && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Sent at</span>
                    <span className="text-xs">
                      {new Date(selectedLog.sent_at).toLocaleString("en-US", {
                        dateStyle: "medium", timeStyle: "short",
                      })}
                    </span>
                  </div>
                )}
                {selectedLog.error_message && (
                  <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-2.5 text-xs text-red-800 mt-2">
                    <IconAlertCircle className="h-4 w-4 shrink-0 text-red-600 mt-0.5" />
                    {selectedLog.error_message}
                  </div>
                )}
              </div>

              {/* UBL XML */}
              {selectedLog.ubl_xml && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <button
                      className="flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
                      onClick={() => setShowXml((v) => !v)}
                    >
                      <IconFileText className="h-3.5 w-3.5" />
                      {showXml ? "Hide" : "View"} UBL 2.1 XML
                    </button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => handleCopyXml(selectedLog.ubl_xml)}
                    >
                      <IconCopy className="h-3.5 w-3.5 mr-1" />
                      {copied ? "Copied!" : "Copy XML"}
                    </Button>
                  </div>
                  {showXml && (
                    <pre className="max-h-64 overflow-auto rounded-md border bg-muted p-3 text-[11px] leading-relaxed font-mono text-muted-foreground whitespace-pre-wrap break-all">
                      {selectedLog.ubl_xml}
                    </pre>
                  )}
                </div>
              )}

              {/* Link to invoice */}
              {onOpenInvoice && selectedLog.invoice_id && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => { setSelectedLog(null); onOpenInvoice(selectedLog.invoice_id); }}
                >
                  <IconExternalLink className="h-3.5 w-3.5 mr-2" />
                  Open Invoice
                </Button>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
