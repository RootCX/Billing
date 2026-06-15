import { useState, useMemo } from "react";
import { useAppCollection, type WhereClause } from "@rootcx/sdk";
import {
  PageHeader, DataTable, EmptyState, Button, Badge, type SortingState,
} from "@rootcx/ui";
import { IconPlus, IconFileInvoice, IconNetwork, IconDownload, IconLoader2 } from "@tabler/icons-react";
import type { Invoice, InvoiceStatus, VatTreatment, PeppolSendLog } from "../types";
import { formatCurrency, formatDate, isCreditNote } from "../types";
import {
  FilterBar, conditionToWhereClause,
  type Condition, type FieldDef,
} from "../components/FilterSystem";
import ExportInvoicesDialog, { useInvoiceExport } from "../components/ExportInvoicesDialog";

const APP_ID   = "billing";
const PAGE_SIZE = 20;

// ─── Enums ────────────────────────────────────────────────────────────────────

const STATUSES: { value: InvoiceStatus; label: string; color: string }[] = [
  { value: "draft",     label: "Draft",     color: "bg-zinc-400"    },
  { value: "sent",      label: "Sent",      color: "bg-blue-500"    },
  { value: "paid",      label: "Paid",      color: "bg-emerald-500" },
  { value: "overdue",   label: "Overdue",   color: "bg-red-500"     },
  { value: "cancelled", label: "Cancelled", color: "bg-zinc-300"    },
];

const VAT_OPTIONS: { value: VatTreatment; label: string }[] = [
  { value: "standard",       label: "Standard"       },
  { value: "exempt",         label: "Exempt"         },
  { value: "reverse_charge", label: "Reverse Charge" },
  { value: "intra_eu",       label: "Intra-EU"       },
  { value: "export",         label: "Export"         },
];

const CURRENCIES = ["EUR", "USD", "GBP", "CHF", "CAD", "AUD", "JPY"];

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "secondary", sent: "default", paid: "outline",
  overdue: "destructive", cancelled: "secondary",
};

// ─── Field definitions ────────────────────────────────────────────────────────

const FIELD_DEFS: FieldDef[] = [
  { key: "status",         label: "Status",         type: "enum",   options: STATUSES.map(s => ({ value: s.value, label: s.label, color: s.color })) },
  { key: "currency",       label: "Currency",       type: "enum",   options: CURRENCIES.map(c => ({ value: c, label: c })) },
  { key: "vat_treatment",  label: "VAT Treatment",  type: "enum",   options: VAT_OPTIONS.map(v => ({ value: v.value, label: v.label })) },
  { key: "invoice_number", label: "Invoice #",      type: "text"  },
  { key: "client_company", label: "Client",         type: "text"  },
  { key: "client_country", label: "Client Country", type: "text"  },
  { key: "client_city",    label: "Client City",    type: "text"  },
  { key: "client_vat",     label: "Client VAT",     type: "text"  },
  { key: "internal_notes", label: "Notes", type: "text"  },
  { key: "invoice_date",   label: "Invoice Date",   type: "date"  },
  { key: "due_date",       label: "Due Date",       type: "date"  },
  { key: "total",          label: "Total",          type: "number"},
  { key: "subtotal",       label: "Subtotal",       type: "number"},
];

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  onOpenInvoice: (id: string) => void;
  onNewInvoice:  () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function InvoiceListView({ onOpenInvoice, onNewInvoice }: Props) {
  const [conditions, setConditions] = useState<Condition[]>([]);
  const [search, setSearch]         = useState("");
  const [pageIndex, setPageIndex]   = useState(0);
  const [orderBy, setOrderBy]       = useState("invoice_date");
  const [order, setOrder]           = useState<"asc" | "desc">("desc");

  // ── Where clause ──────────────────────────────────────────────────────────
  const where = useMemo<WhereClause | undefined>(() => {
    const clauses: WhereClause[] = [];

    if (search) {
      clauses.push({
        $or: [
          { invoice_number:       { $ilike: `%${search}%` } },
          { client_company:       { $ilike: `%${search}%` } },
          { client_contact_name:  { $ilike: `%${search}%` } },
          { client_contact_email: { $ilike: `%${search}%` } },
        ],
      });
    }

    for (const cond of conditions) {
      const clause = conditionToWhereClause(cond, FIELD_DEFS);
      if (clause) clauses.push(clause);
    }

    return clauses.length === 0 ? undefined :
           clauses.length === 1 ? clauses[0] :
           { $and: clauses };
  }, [search, conditions]);

  const { data: invoices, total, loading } = useAppCollection<Invoice>(APP_ID, "invoice", {
    where, orderBy, order, limit: PAGE_SIZE, offset: pageIndex * PAGE_SIZE,
  });

  const exporter = useInvoiceExport();
  const canExport = !loading && total > 0;

  // Fetch peppol send logs for current page to show badge
  const invoiceIds = (invoices ?? []).map((i) => i.id);
  const { data: peppolLogs } = useAppCollection<PeppolSendLog>(APP_ID, "peppol_send_log", {
    where: invoiceIds.length > 0 ? { invoice_id: { $in: invoiceIds } } : { invoice_id: { $eq: "none" } },
  });
  const sentInvoiceIds = useMemo(
    () => new Set((peppolLogs ?? []).filter((l) => l.status === "sent" || l.status === "delivered").map((l) => l.invoice_id)),
    [peppolLogs],
  );

  const hasAny = conditions.length > 0 || !!search;

  // ── Columns ────────────────────────────────────────────────────────────────
  const columns = [
    {
      accessorKey: "invoice_number", header: "Document #",
      cell: ({ row }: { row: { original: Invoice } }) => (
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-sm font-medium">{row.original.invoice_number}</span>
          {isCreditNote(row.original) && (
            <span className="inline-flex items-center rounded-full border border-purple-200 bg-purple-50 px-1.5 py-0.5 text-[10px] font-medium text-purple-700">
              Credit Note
            </span>
          )}
        </div>
      ),
    },
    {
      accessorKey: "client_company", header: "Client",
      cell: ({ row }: { row: { original: Invoice } }) => (
        <div>
          <p className="font-medium leading-none">
            {row.original.client_company || <span className="text-muted-foreground italic">—</span>}
          </p>
          {row.original.client_contact_email && (
            <p className="text-xs text-muted-foreground mt-0.5">{row.original.client_contact_email}</p>
          )}
        </div>
      ),
    },
    {
      accessorKey: "invoice_date", header: "Invoice Date",
      cell: ({ row }: { row: { original: Invoice } }) => (
        <span className="text-sm text-muted-foreground">{formatDate(row.original.invoice_date)}</span>
      ),
    },
    {
      accessorKey: "due_date", header: "Due Date",
      cell: ({ row }: { row: { original: Invoice } }) => (
        <span className="text-sm text-muted-foreground">{formatDate(row.original.due_date)}</span>
      ),
    },
    {
      accessorKey: "total", header: "Total",
      cell: ({ row }: { row: { original: Invoice } }) => (
        <span className="font-semibold tabular-nums text-sm">
          {formatCurrency(row.original.total ?? 0, row.original.currency ?? "EUR")}
        </span>
      ),
    },
    {
      accessorKey: "status", header: "Status",
      cell: ({ row }: { row: { original: Invoice } }) => (
        <div className="flex items-center gap-1.5 flex-wrap">
          <Badge variant={STATUS_VARIANT[row.original.status] ?? "secondary"}>
            {STATUSES.find(s => s.value === row.original.status)?.label ?? row.original.status}
          </Badge>
          {sentInvoiceIds.has(row.original.id) && (
            <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">
              <IconNetwork className="h-3 w-3" />
              Peppol
            </span>
          )}
        </div>
      ),
    },
  ];

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col flex-1 p-6 gap-5 min-h-0 overflow-hidden">
      <PageHeader
        title="Invoices"
        description="Manage your invoices and track payments"
        actions={
          <>
            <Button
              variant="outline"
              disabled={!canExport || exporter.starting}
              onClick={() => exporter.start({ where, orderBy, order })}
              title={canExport ? `Export ${total} invoice${total !== 1 ? "s" : ""} as ZIP` : "No invoices to export"}
            >
              {exporter.starting
                ? <IconLoader2 className="h-4 w-4 mr-2 animate-spin" />
                : <IconDownload className="h-4 w-4 mr-2" />}
              Export{canExport ? ` (${total})` : ""}
            </Button>
            <Button onClick={onNewInvoice}>
              <IconPlus className="h-4 w-4 mr-2" />
              New Invoice
            </Button>
          </>
        }
      />

      <ExportInvoicesDialog exportId={exporter.exportId} onClose={exporter.close} />

      <FilterBar
        fieldDefs={FIELD_DEFS}
        conditions={conditions}
        search={search}
        onSearch={(v) => { setSearch(v); setPageIndex(0); }}
        onAdd={(cond) => { setConditions(prev => [...prev, cond]); setPageIndex(0); }}
        onUpdate={(id, patch) => { setConditions(prev => prev.map(c => c.id === id ? { ...c, ...patch } : c)); setPageIndex(0); }}
        onRemove={(id) => { setConditions(prev => prev.filter(c => c.id !== id)); setPageIndex(0); }}
        onClearAll={() => { setSearch(""); setConditions([]); setPageIndex(0); }}
        searchPlaceholder="Search invoices…"
        totalLabel={!loading ? (total === 0 ? "No invoices found" : `${total} invoice${total !== 1 ? "s" : ""}${hasAny ? " matching filters" : ""}`) : undefined}
      />

      <DataTable
        className="flex-1 min-h-0"
        data={invoices ?? []}
        columns={columns}
        loading={loading}
        pageSize={PAGE_SIZE}
        rowCount={total}
        onPaginationChange={({ pageIndex: pi }) => setPageIndex(pi)}
        onSortingChange={(s: SortingState) => {
          if (s[0]) { setOrderBy(s[0].id); setOrder(s[0].desc ? "desc" : "asc"); }
          else      { setOrderBy("invoice_date"); setOrder("desc"); }
          setPageIndex(0);
        }}
        onRowClick={(row) => onOpenInvoice(row.id)}
        emptyState={
          <EmptyState
            icon={<IconFileInvoice className="h-10 w-10 text-muted-foreground" />}
            title={hasAny ? "No matching invoices" : "No invoices yet"}
            description={hasAny ? "Try adjusting your search or filters" : "Create your first invoice to get started"}
            action={!hasAny ? (
              <Button onClick={onNewInvoice}>
                <IconPlus className="h-4 w-4 mr-2" />
                New Invoice
              </Button>
            ) : undefined}
          />
        }
      />
    </div>
  );
}
