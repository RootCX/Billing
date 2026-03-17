import { useState } from "react";
import { useAppCollection } from "@rootcx/sdk";
import { PageHeader, EmptyState, LoadingState } from "@rootcx/ui";
import {
  IconNetwork, IconCircleCheck, IconClock, IconCircleX, IconChevronDown,
} from "@tabler/icons-react";
import type { OutgoingStatus } from "../types";
import { cn } from "@/lib/utils";

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; border: string; icon: React.ReactNode }> = {
  sent:      { label: "Sent",      color: "text-blue-600",    bg: "bg-blue-50",    border: "border-blue-200",   icon: <IconCircleCheck className="h-4 w-4 text-blue-500" />  },
  delivered: { label: "Delivered", color: "text-emerald-600", bg: "bg-emerald-50", border: "border-emerald-200",icon: <IconCircleCheck className="h-4 w-4 text-emerald-500" />},
  pending:   { label: "Pending",   color: "text-amber-600",   bg: "bg-amber-50",   border: "border-amber-200",  icon: <IconClock className="h-4 w-4 text-amber-500" />        },
  failed:    { label: "Failed",    color: "text-red-600",     bg: "bg-red-50",     border: "border-red-200",    icon: <IconCircleX className="h-4 w-4 text-red-500" />        },
};

function timeAgo(ts: string) {
  const diff = Date.now() - new Date(ts).getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(mins / 60);
  const days  = Math.floor(hours / 24);
  if (days > 0)  return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (mins > 0)  return `${mins}m ago`;
  return "just now";
}

function formatTs(ts: string) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

function shortUlid(ulid: string) {
  if (!ulid) return "—";
  return ulid.slice(0, 8) + "…" + ulid.slice(-4);
}

export default function PeppolTransmissionsView() {
  const { data, loading } = useAppCollection<OutgoingStatus>("peppol", "outgoing_status");
  const [openId, setOpenId] = useState<string | null>(null);

  if (loading) return <LoadingState variant="spinner" />;

  const items = [...(data ?? [])].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  return (
    <div className="flex flex-col flex-1 px-6 pt-8 pb-6 gap-6 overflow-y-auto">
      <PageHeader
        title="Outgoing Logs"
        description="All invoices sent via the Peppol network"
      />

      {items.length === 0 ? (
        <EmptyState
          icon={<IconNetwork className="h-10 w-10 text-muted-foreground" />}
          title="No transmissions yet"
          description="Peppol sends will appear here once you send an invoice"
        />
      ) : (
        <div className="max-w-lg border rounded-xl divide-y bg-white shadow-sm overflow-hidden">
          {items.map((item) => {
            const cfg = STATUS_CONFIG[item.status] ?? STATUS_CONFIG.pending;
            const isOpen = openId === item.id;
            return (
              <div key={item.id}>
                {/* Row */}
                <button
                  className="w-full flex items-center gap-4 px-5 py-3.5 hover:bg-muted/40 transition-colors text-left"
                  onClick={() => setOpenId(isOpen ? null : item.id)}
                >
                  <div className="shrink-0">{cfg.icon}</div>
                  <div className="flex-1 min-w-0">
                    <span className={cn("text-sm font-medium", cfg.color)}>{cfg.label}</span>
                    <span className="text-sm text-muted-foreground"> · </span>
                    <span className="font-mono text-xs text-muted-foreground">{shortUlid(item.document_ulid)}</span>
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">{timeAgo(item.created_at)}</span>
                  <IconChevronDown className={cn("h-4 w-4 text-muted-foreground/40 shrink-0 transition-transform", isOpen && "rotate-180")} />
                </button>

                {/* Accordion content */}
                {isOpen && (
                  <div className={cn("px-5 pb-4 pt-1 space-y-2 border-t", cfg.bg)}>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                      <span className="text-muted-foreground">Sent at</span>
                      <span className="text-right font-medium">{formatTs(item.created_at)}</span>

                      {item.delivered_at && (
                        <>
                          <span className="text-muted-foreground">Delivered at</span>
                          <span className="text-right font-medium">{formatTs(item.delivered_at)}</span>
                        </>
                      )}

                      <span className="text-muted-foreground">Document ULID</span>
                      <span className="text-right font-mono text-xs break-all">{item.document_ulid}</span>

                      {item.as4_message_id && (
                        <>
                          <span className="text-muted-foreground">AS4 Message ID</span>
                          <span className="text-right font-mono text-xs break-all">{item.as4_message_id}</span>
                        </>
                      )}
                    </div>

                    {item.error_message && (
                      <p className="text-xs text-muted-foreground italic border-t pt-2 mt-2 leading-relaxed">
                        {item.error_message}
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
