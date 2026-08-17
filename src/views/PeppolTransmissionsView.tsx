import { useMemo, useState } from "react";
import { useAppCollection } from "@rootcx/sdk";
import { PageHeader, EmptyState, LoadingState, Button, SearchInput, toast } from "@rootcx/ui";
import {
  IconNetwork, IconCircleCheck, IconClock, IconAlertTriangle, IconChevronDown,
  IconSend, IconCopy, IconArrowRight, IconHelpCircle,
} from "@tabler/icons-react";
import type { Invoice, OutgoingStatus, PeppolSendLog } from "../types";
import { formatCurrency, isCreditNote, isSuccessfulPeppolSendStatus } from "../types";
import {
  describeOutgoingStatus, cleanStatusMessage, explainFailure, groupTransmissions,
  type OutgoingOutcome, type OutgoingTransmission,
} from "../lib/peppolOutgoing";
import { cn } from "@/lib/utils";

const APP_ID = "billing";

const OUTCOME_STYLES: Record<OutcomeKey, { text: string; bg: string; dot: string; panel: string; icon: React.ReactNode }> = {
  delivered:   { text: "text-emerald-700", bg: "bg-emerald-50", dot: "bg-emerald-500", panel: "bg-emerald-50/40", icon: <IconCircleCheck    className="h-5 w-5 text-emerald-500" /> },
  sent:        { text: "text-blue-700",    bg: "bg-blue-50",    dot: "bg-blue-500",    panel: "bg-blue-50/40",    icon: <IconSend           className="h-5 w-5 text-blue-500" />    },
  in_progress: { text: "text-amber-700",   bg: "bg-amber-50",   dot: "bg-amber-500",   panel: "bg-amber-50/40",   icon: <IconClock          className="h-5 w-5 text-amber-500" />   },
  problem:     { text: "text-red-700",     bg: "bg-red-50",     dot: "bg-red-500",     panel: "bg-red-50/40",     icon: <IconAlertTriangle  className="h-5 w-5 text-red-500" />     },
};

type OutcomeKey = OutgoingOutcome;

const FILTERS: { key: "all" | OutcomeKey; label: string; hint: string }[] = [
  { key: "all",       label: "All",             hint: "Everything you sent through Peppol" },
  { key: "problem",   label: "Needs attention", hint: "Did not reach your customer" },
  { key: "in_progress", label: "In progress",   hint: "The network has not reported a result yet" },
  { key: "sent",      label: "On its way",      hint: "Left our system — delivery not confirmed by the customer's provider" },
  { key: "delivered", label: "Delivered",       hint: "Your customer received it" },
];

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

/** One line of the enriched list: a transmission plus what Billing knows about it. */
interface Row {
  transmission: OutgoingTransmission<OutgoingStatus>;
  log?: PeppolSendLog;
  invoice?: Invoice;
  documentNumber: string;
  customer: string;
  isCredit: boolean;
  amount: string;
  outcome: OutcomeKey;
  searchText: string;
}

function StatusPill({ status }: { status: string }) {
  const info = describeOutgoingStatus(status);
  const style = OUTCOME_STYLES[info.outcome];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium", style.bg, style.text)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", style.dot)} />
      {info.label}
    </span>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium break-words">{children}</span>
    </>
  );
}

export default function PeppolTransmissionsView({ onOpenInvoice }: { onOpenInvoice?: (id: string) => void }) {
  const { data: events, loading } = useAppCollection<OutgoingStatus>("peppol", "outgoing_status");

  const transmissions = useMemo(() => groupTransmissions(events ?? []), [events]);
  const ulids = transmissions.map((t) => t.documentUlid);

  // Billing knows which document each Peppol ULID belongs to — that mapping is
  // what turns an opaque log into "credit note CN-2026… for Acme".
  const { data: logs } = useAppCollection<PeppolSendLog>(APP_ID, "peppol_send_log", {
    where: ulids.length > 0 ? { dokapi_ulid: { $in: ulids } } : { dokapi_ulid: { $eq: "none" } },
  });

  const invoiceIds = (logs ?? []).map((l) => l.invoice_id).filter(Boolean);
  const { data: invoices } = useAppCollection<Invoice>(APP_ID, "invoice", {
    where: invoiceIds.length > 0 ? { id: { $in: invoiceIds } } : { id: { $eq: "none" } },
  });

  const [filter, setFilter] = useState<"all" | OutcomeKey>("all");
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState<string | null>(null);

  const rows: Row[] = useMemo(() => {
    const logByUlid = new Map((logs ?? []).map((l) => [l.dokapi_ulid, l]));
    const invoiceById = new Map((invoices ?? []).map((i) => [i.id, i]));

    return transmissions.map((transmission) => {
      const log = logByUlid.get(transmission.documentUlid);
      const invoice = log ? invoiceById.get(log.invoice_id) : undefined;
      const documentNumber = invoice?.invoice_number || log?.invoice_number || "";
      const customer = invoice?.client_company || "";
      const isCredit = invoice
        ? isCreditNote(invoice)
        : log?.document_type === "credit_note";
      const amount = invoice ? formatCurrency(invoice.total ?? 0, invoice.currency) : "";
      const info = describeOutgoingStatus(transmission.latest.status);

      return {
        transmission, log, invoice, documentNumber, customer, isCredit, amount,
        outcome: info.outcome,
        searchText: [documentNumber, customer, info.label, transmission.documentUlid].join(" ").toLowerCase(),
      };
    });
  }, [transmissions, logs, invoices]);

  const counts = useMemo(() => {
    const base: Record<"all" | OutcomeKey, number> = { all: rows.length, delivered: 0, sent: 0, in_progress: 0, problem: 0 };
    for (const row of rows) base[row.outcome] += 1;
    return base;
  }, [rows]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows.filter(
      (row) =>
        (filter === "all" || row.outcome === filter) &&
        (!needle || row.searchText.includes(needle)),
    );
  }, [rows, filter, search]);

  const problemCount = counts.problem;

  const copyTechnical = (row: Row) => {
    const { transmission, log } = row;
    const lines = [
      `Document: ${row.documentNumber || "unknown"}`,
      `Status: ${transmission.latest.status}`,
      `Peppol document ID: ${transmission.documentUlid}`,
      `AS4 message ID: ${transmission.latest.as4_message_id || "—"}`,
      `Receiver Peppol address: ${log?.receiver_peppol_id || "—"}`,
      `Sender Peppol address: ${log?.sender_peppol_id || "—"}`,
      `First event: ${formatTs(transmission.firstSeenAt)}`,
      `Last event: ${formatTs(transmission.latest.created_at)}`,
      `Network message: ${transmission.latest.error_message || "—"}`,
    ];
    navigator.clipboard.writeText(lines.join("\n"));
    toast.success("Technical details copied — paste them to support");
  };

  if (loading) return <LoadingState variant="spinner" />;

  return (
    <div className="flex flex-col flex-1 px-6 pt-8 pb-6 gap-5 overflow-y-auto">
      <PageHeader
        title="Outgoing Logs"
        description="What happened to each document you sent over Peppol. Click a line for details."
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={<IconNetwork className="h-10 w-10 text-muted-foreground" />}
          title="Nothing sent yet"
          description="Documents you send over Peppol appear here with their delivery status."
        />
      ) : (
        <>
          {problemCount > 0 && (
            <div className="max-w-3xl flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
              <IconAlertTriangle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-medium text-red-800">
                  {problemCount === 1
                    ? "1 document never reached its customer"
                    : `${problemCount} documents never reached their customer`}
                </p>
                <p className="text-red-700/90 mt-0.5">Open the red {problemCount === 1 ? "line" : "lines"} below to fix and resend.</p>
              </div>
            </div>
          )}

          {/* Filters + search */}
          <div className="max-w-3xl flex flex-wrap items-center gap-2">
            {FILTERS.filter((f) => f.key === "all" || counts[f.key] > 0).map((f) => (
              <button
                key={f.key}
                title={f.hint}
                onClick={() => setFilter(f.key)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  filter === f.key
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
                )}
              >
                {f.label}
                <span className={cn("tabular-nums", filter === f.key ? "text-white/70" : "text-slate-400")}>
                  {counts[f.key]}
                </span>
              </button>
            ))}
            <div className="ml-auto w-56">
              <SearchInput value={search} onChange={setSearch} placeholder="Document or customer…" />
            </div>
          </div>

          {visible.length === 0 ? (
            <EmptyState
              icon={<IconNetwork className="h-10 w-10 text-muted-foreground" />}
              title="Nothing matches"
              description="Try another search or switch back to All."
            />
          ) : (
            <div className="max-w-3xl border rounded-xl divide-y bg-white shadow-sm overflow-hidden">
              {visible.map((row) => {
                const { transmission, log, invoice } = row;
                const info = describeOutgoingStatus(transmission.latest.status);
                const style = OUTCOME_STYLES[info.outcome];
                const isOpen = openId === transmission.documentUlid;
                const failure = info.outcome === "problem" ? explainFailure(transmission.latest.error_message) : null;
                const networkMessage = cleanStatusMessage(transmission.latest.error_message);
                // Billing never writes the failure back to the invoice, so a failed
                // document still reads as "sent" there. Say so instead of letting
                // the two screens contradict each other silently.
                const staleInBilling =
                  info.outcome === "problem" && !!log && isSuccessfulPeppolSendStatus(log.status);

                return (
                  <div key={transmission.documentUlid}>
                    <button
                      className="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-muted/40 transition-colors text-left"
                      onClick={() => setOpenId(isOpen ? null : transmission.documentUlid)}
                    >
                      <div className="shrink-0">{style.icon}</div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-mono text-sm font-medium">
                            {row.documentNumber || "Unknown document"}
                          </span>
                          {row.isCredit && (
                            <span className="inline-flex items-center rounded-full border border-purple-200 bg-purple-50 px-1.5 py-0.5 text-[10px] font-medium text-purple-700">
                              Credit Note
                            </span>
                          )}
                          <StatusPill status={transmission.latest.status} />
                        </div>
                        <p className="text-xs text-muted-foreground truncate mt-0.5">
                          {row.customer || "Customer unknown"}
                          {row.amount && <> · {row.amount}</>}
                        </p>
                      </div>

                      <span className="text-xs text-muted-foreground shrink-0" title={formatTs(transmission.latest.created_at)}>
                        {timeAgo(transmission.latest.created_at)}
                      </span>
                      <IconChevronDown className={cn("h-4 w-4 text-muted-foreground/40 shrink-0 transition-transform", isOpen && "rotate-180")} />
                    </button>

                    {isOpen && (
                      <div className={cn("px-5 pb-4 pt-3 space-y-3 border-t", style.panel)}>
                        {/* What it means, in one line */}
                        <p className="text-sm">
                          <span className="text-muted-foreground">{info.meaning}</span>
                          {info.nextStep && <span className="text-slate-700"> {info.nextStep}</span>}
                        </p>

                        {/* Why it failed, in words a non-technical user can act on */}
                        {failure && (
                          <div className="rounded-lg border border-red-200 bg-red-50/70 px-3 py-2 text-sm">
                            <p className="font-medium text-red-800">{failure.title}</p>
                            <p className="text-red-700/90">{failure.detail}</p>
                            <p className="flex items-start gap-1.5 text-red-800 mt-0.5">
                              <IconArrowRight className="h-4 w-4 shrink-0 mt-0.5 text-red-400" />
                              <span>{failure.nextStep}</span>
                            </p>
                          </div>
                        )}

                        {staleInBilling && (
                          <p className="flex items-start gap-1.5 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 leading-relaxed">
                            <IconHelpCircle className="h-4 w-4 shrink-0 mt-0.5 text-amber-500" />
                            <span>
                              Still shows as <span className="font-medium">Sent</span> on the invoice page. Peppol wins — treat it as not sent.
                            </span>
                          </p>
                        )}

                        {/* The facts a human cares about */}
                        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                          <Fact label="Document">{row.documentNumber || "—"}</Fact>
                          <Fact label="Type">{row.isCredit ? "Credit note" : "Invoice"}</Fact>
                          <Fact label="Customer">{row.customer || "—"}</Fact>
                          {row.amount && <Fact label="Amount">{row.amount}</Fact>}
                          {log?.receiver_peppol_id && (
                            <Fact label="Peppol address">
                              <span className="font-mono text-xs">{log.receiver_peppol_id}</span>
                            </Fact>
                          )}
                          <Fact label="Sent at">{formatTs(log?.sent_at || transmission.firstSeenAt)}</Fact>
                          {transmission.deliveredAt && (
                            <Fact label="Delivered at">{formatTs(transmission.deliveredAt)}</Fact>
                          )}
                        </div>

                        {/* Event history — one line per status the network reported */}
                        {transmission.events.length > 1 && (
                          <div className="border-t pt-2.5 space-y-1.5">
                            <p className="text-xs font-medium text-muted-foreground">History</p>
                            {transmission.events.map((event) => (
                              <div key={event.id} className="flex items-center gap-2 text-xs">
                                <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", OUTCOME_STYLES[describeOutgoingStatus(event.status).outcome].dot)} />
                                <span className="font-medium">{describeOutgoingStatus(event.status).label}</span>
                                <span className="text-muted-foreground ml-auto">{formatTs(event.created_at)}</span>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Actions */}
                        <div className="flex flex-wrap items-center gap-2 border-t pt-2.5">
                          {invoice && onOpenInvoice && (
                            <Button size="sm" variant="outline" onClick={() => onOpenInvoice(invoice.id)}>
                              Open document
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" onClick={() => copyTechnical(row)}>
                            <IconCopy className="h-4 w-4 mr-1.5" />
                            Copy for support
                          </Button>
                          <button
                            className="ml-auto text-xs text-muted-foreground hover:text-foreground underline decoration-dotted"
                            onClick={() =>
                              setShowRaw(showRaw === transmission.documentUlid ? null : transmission.documentUlid)
                            }
                          >
                            {showRaw === transmission.documentUlid ? "Hide technical details" : "Technical details"}
                          </button>
                        </div>

                        {showRaw === transmission.documentUlid && (
                          <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs border-t pt-2.5">
                            <span className="text-muted-foreground">Status code</span>
                            <span className="font-mono break-all">{transmission.latest.status}</span>

                            <span className="text-muted-foreground">Peppol document ID</span>
                            <span className="font-mono break-all">{transmission.documentUlid}</span>

                            {transmission.latest.as4_message_id && (
                              <>
                                <span className="text-muted-foreground">AS4 message ID</span>
                                <span className="font-mono break-all">{transmission.latest.as4_message_id}</span>
                              </>
                            )}

                            {log?.sender_peppol_id && (
                              <>
                                <span className="text-muted-foreground">Sender address</span>
                                <span className="font-mono break-all">{log.sender_peppol_id}</span>
                              </>
                            )}

                            {networkMessage && (
                              <>
                                <span className="text-muted-foreground">Network message</span>
                                <span className="font-mono break-all leading-relaxed">{networkMessage}</span>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
