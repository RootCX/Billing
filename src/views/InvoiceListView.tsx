import { useAppCollection } from "@rootcx/sdk";
import {
  PageHeader, DataTable, StatusBadge, EmptyState, Button,
  Badge,
} from "@rootcx/ui";
import { IconPlus, IconFileInvoice } from "@tabler/icons-react";
import type { ColumnDef } from "@tanstack/react-table";
import type { Invoice } from "../types";
import { formatCurrency, formatDate } from "../types";

const APP_ID = "billing";

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  sent: "Sent",
  paid: "Paid",
  overdue: "Overdue",
  cancelled: "Cancelled",
};

const STATUS_COLOR: Record<string, string> = {
  draft: "secondary",
  sent: "default",
  paid: "outline",
  overdue: "destructive",
  cancelled: "secondary",
};

interface Props {
  onOpenInvoice: (id: string) => void;
  onNewInvoice: () => void;
}

export default function InvoiceListView({ onOpenInvoice, onNewInvoice }: Props) {
  const { data: invoices, loading, error } = useAppCollection<Invoice>(APP_ID, "invoice");

  const columns: ColumnDef<Invoice, unknown>[] = [
    {
      accessorKey: "invoice_number",
      header: "Invoice #",
      cell: ({ row }) => (
        <span className="font-mono text-sm font-medium">{row.original.invoice_number}</span>
      ),
    },
    {
      accessorKey: "client_company",
      header: "Client",
      cell: ({ row }) => (
        <span className="font-medium">{row.original.client_company || <span className="text-muted-foreground italic">No client</span>}</span>
      ),
    },
    {
      accessorKey: "invoice_date",
      header: "Invoice Date",
      cell: ({ row }) => <span className="text-sm">{formatDate(row.original.invoice_date)}</span>,
    },
    {
      accessorKey: "due_date",
      header: "Due Date",
      cell: ({ row }) => <span className="text-sm">{formatDate(row.original.due_date)}</span>,
    },
    {
      accessorKey: "total",
      header: "Total",
      cell: ({ row }) => (
        <span className="font-semibold tabular-nums">
          {formatCurrency(row.original.total || 0, row.original.currency || "EUR")}
        </span>
      ),
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => (
        <Badge variant={STATUS_COLOR[row.original.status] as any}>
          {STATUS_LABEL[row.original.status] || row.original.status}
        </Badge>
      ),
    },
  ];

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Invoices"
        description="Manage your invoices and track payments"
        actions={
          <Button onClick={onNewInvoice}>
            <IconPlus className="h-4 w-4 mr-2" />
            New Invoice
          </Button>
        }
      />

      <DataTable
        data={invoices ?? []}
        columns={columns}
        loading={loading}
        searchable
        pagination
        pageSize={20}
        onRowClick={(row) => onOpenInvoice(row.id)}
        emptyState={
          <EmptyState
            icon={<IconFileInvoice className="h-10 w-10 text-muted-foreground" />}
            title="No invoices yet"
            description="Create your first invoice to get started"
            action={
              <Button onClick={onNewInvoice}>
                <IconPlus className="h-4 w-4 mr-2" />
                New Invoice
              </Button>
            }
          />
        }
      />
    </div>
  );
}
