import { useState, useMemo } from "react";
import { useAppCollection, type WhereClause } from "@rootcx/sdk";
import {
  PageHeader, DataTable, EmptyState, FormDialog, ConfirmDialog, Button, toast, type SortingState,
} from "@rootcx/ui";
import { IconPlus, IconEdit, IconTrash, IconUsers } from "@tabler/icons-react";
import type { ColumnDef } from "@tanstack/react-table";
import type { Customer } from "../types";
import { CUSTOMER_FORM_FIELDS } from "../types";
import {
  FilterBar, conditionToWhereClause,
  type Condition, type FieldDef,
} from "../components/FilterSystem";

const APP_ID   = "billing";
const PAGE_SIZE = 20;

// ─── Field definitions ────────────────────────────────────────────────────────

const FIELD_DEFS: FieldDef[] = [
  { key: "company_name",  label: "Company",       type: "text" },
  { key: "contact_name",  label: "Contact",        type: "text" },
  { key: "contact_email", label: "Email",          type: "text" },
  { key: "vat_number",    label: "VAT Number",     type: "text" },
  { key: "city",          label: "City",           type: "text" },
  { key: "country_code",  label: "Country Code",   type: "text" },
  { key: "postal_code",   label: "Postal Code",    type: "text" },
];

// ─── Columns ──────────────────────────────────────────────────────────────────

const columns: ColumnDef<Customer, unknown>[] = [
  { accessorKey: "company_name",  header: "Company" },
  { accessorKey: "contact_name",  header: "Contact" },
  { accessorKey: "contact_email", header: "Email" },
  { accessorKey: "vat_number",    header: "VAT Number" },
  {
    accessorKey: "city",
    header: "Location",
    cell: ({ row }) => {
      const loc = [row.original.city, row.original.country_code].filter(Boolean).join(", ");
      return loc || <span className="text-muted-foreground">—</span>;
    },
  },
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function CustomersView() {
  const [conditions, setConditions]       = useState<Condition[]>([]);
  const [search, setSearch]               = useState("");
  const [pageIndex, setPageIndex]         = useState(0);
  const [orderBy, setOrderBy]             = useState("company_name");
  const [order, setOrder]                 = useState<"asc" | "desc">("asc");
  const [createOpen, setCreateOpen]       = useState(false);
  const [editCustomer, setEditCustomer]   = useState<Customer | null>(null);
  const [deleteCustomer, setDeleteCustomer] = useState<Customer | null>(null);

  // ── Where clause ──────────────────────────────────────────────────────────
  const where = useMemo<WhereClause | undefined>(() => {
    const clauses: WhereClause[] = [];

    if (search) {
      clauses.push({
        $or: [
          { company_name:   { $ilike: `%${search}%` } },
          { contact_name:   { $ilike: `%${search}%` } },
          { contact_email:  { $ilike: `%${search}%` } },
          { vat_number:     { $ilike: `%${search}%` } },
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

  const { data: customers, total, loading, create, update, remove } =
    useAppCollection<Customer>(APP_ID, "customer", {
      where, orderBy, order, limit: PAGE_SIZE, offset: pageIndex * PAGE_SIZE,
    });

  const hasAny = conditions.length > 0 || !!search;

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleCreate = async (values: Record<string, any>) => {
    try { await create(values); toast.success("Customer created"); setCreateOpen(false); }
    catch (e: any) { toast.error(e.message); }
  };

  const handleUpdate = async (values: Record<string, any>) => {
    try { await update(editCustomer!.id, values); toast.success("Customer updated"); setEditCustomer(null); }
    catch (e: any) { toast.error(e.message); }
  };

  const handleDelete = async () => {
    try { await remove(deleteCustomer!.id); toast.success("Customer deleted"); setDeleteCustomer(null); }
    catch (e: any) { toast.error(e.message); }
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col flex-1 p-6 gap-5 min-h-0 overflow-hidden">
      <PageHeader
        title="Customers"
        description="Manage your customer directory"
        actions={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <IconPlus className="h-4 w-4 mr-1.5" />New Customer
          </Button>
        }
      />

      <FilterBar
        fieldDefs={FIELD_DEFS}
        conditions={conditions}
        search={search}
        onSearch={(v) => { setSearch(v); setPageIndex(0); }}
        onAdd={(cond) => { setConditions(prev => [...prev, cond]); setPageIndex(0); }}
        onUpdate={(id, patch) => { setConditions(prev => prev.map(c => c.id === id ? { ...c, ...patch } : c)); setPageIndex(0); }}
        onRemove={(id) => { setConditions(prev => prev.filter(c => c.id !== id)); setPageIndex(0); }}
        onClearAll={() => { setSearch(""); setConditions([]); setPageIndex(0); }}
        searchPlaceholder="Search customers…"
        totalLabel={!loading ? (total === 0 ? "No customers found" : `${total} customer${total !== 1 ? "s" : ""}${hasAny ? " matching filters" : ""}`) : undefined}
      />

      <DataTable
        className="flex-1 min-h-0"
        data={customers ?? []}
        columns={columns}
        loading={loading}
        pageSize={PAGE_SIZE}
        rowCount={total}
        onPaginationChange={({ pageIndex: pi }) => setPageIndex(pi)}
        onSortingChange={(s: SortingState) => {
          if (s[0]) { setOrderBy(s[0].id); setOrder(s[0].desc ? "desc" : "asc"); }
          else      { setOrderBy("company_name"); setOrder("asc"); }
          setPageIndex(0);
        }}
        rowActions={[
          { label: "Edit",   icon: <IconEdit  className="h-4 w-4" />, onClick: setEditCustomer },
          { label: "Delete", icon: <IconTrash className="h-4 w-4" />, onClick: setDeleteCustomer, destructive: true },
        ]}
        emptyState={
          <EmptyState
            icon={<IconUsers className="h-8 w-8" />}
            title={hasAny ? "No matching customers" : "No customers yet"}
            description={hasAny ? "Try adjusting your search or filters" : "Add your first customer to get started"}
            action={!hasAny ? (
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <IconPlus className="h-4 w-4 mr-1.5" />New Customer
              </Button>
            ) : undefined}
          />
        }
      />

      <FormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="New Customer"
        description="Add a new customer to your directory."
        fields={CUSTOMER_FORM_FIELDS}
        onSubmit={handleCreate}
        submitLabel="Create Customer"
      />

      <FormDialog
        open={!!editCustomer}
        onOpenChange={(open) => { if (!open) setEditCustomer(null); }}
        title="Edit Customer"
        description="Update customer information."
        fields={CUSTOMER_FORM_FIELDS}
        defaultValues={editCustomer ?? {}}
        onSubmit={handleUpdate}
        submitLabel="Save Changes"
      />

      <ConfirmDialog
        open={!!deleteCustomer}
        onOpenChange={(open) => { if (!open) setDeleteCustomer(null); }}
        title="Delete customer?"
        description={`"${deleteCustomer?.company_name}" will be permanently deleted.`}
        onConfirm={handleDelete}
      />
    </div>
  );
}
