import { useState, useMemo } from "react";
import { useAppCollection, type WhereClause } from "@rootcx/sdk";
import {
  PageHeader, DataTable, EmptyState, FormDialog, ConfirmDialog, Button,
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  Badge, Separator, toast, type SortingState,
} from "@rootcx/ui";
import {
  IconPlus, IconEdit, IconTrash, IconUsers, IconUser, IconChevronDown, IconChevronUp,
  IconStar, IconStarFilled,
} from "@tabler/icons-react";
import type { ColumnDef } from "@tanstack/react-table";
import type { Customer, Contact } from "../types";
import { CUSTOMER_FORM_FIELDS, CONTACT_FORM_FIELDS, contactDisplayName } from "../types";
import {
  FilterBar, conditionToWhereClause,
  type Condition, type FieldDef,
} from "../components/FilterSystem";

const APP_ID   = "billing";
const PAGE_SIZE = 20;

const FIELD_DEFS: FieldDef[] = [
  { key: "company_name",  label: "Company",     type: "text" },
  { key: "vat_number",    label: "VAT Number",  type: "text" },
  { key: "city",          label: "City",        type: "text" },
  { key: "country_code",  label: "Country Code",type: "text" },
  { key: "postal_code",   label: "Postal Code", type: "text" },
];

// ─── Contacts panel (shown inside the customer detail dialog) ──────────────────

interface ContactsPanelProps {
  customer: Customer;
}

function ContactsPanel({ customer }: ContactsPanelProps) {
  const [addOpen, setAddOpen]         = useState(false);
  const [editContact, setEditContact] = useState<Contact | null>(null);
  const [deleteContact, setDeleteContact] = useState<Contact | null>(null);

  const { data: contacts, loading, create, update, remove } =
    useAppCollection<Contact>(APP_ID, "contact", {
      where: { customer_id: customer.id },
      orderBy: "created_at", order: "asc",
    });

  const handleCreate = async (values: Record<string, any>) => {
    try {
      await create({ ...values, customer_id: customer.id });
      toast.success("Contact added");
      setAddOpen(false);
    } catch (e: any) { toast.error(e.message); }
  };

  const handleUpdate = async (values: Record<string, any>) => {
    try {
      await update(editContact!.id, values);
      toast.success("Contact updated");
      setEditContact(null);
    } catch (e: any) { toast.error(e.message); }
  };

  const handleDelete = async () => {
    try {
      await remove(deleteContact!.id);
      toast.success("Contact deleted");
      setDeleteContact(null);
    } catch (e: any) { toast.error(e.message); }
  };

  const toggleDefault = async (c: Contact) => {
    try {
      // unset others, set this one
      for (const other of (contacts ?? []).filter((x) => x.id !== c.id && x.is_default)) {
        await update(other.id, { is_default: false });
      }
      await update(c.id, { is_default: !c.is_default });
    } catch (e: any) { toast.error(e.message); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-semibold">
          Contacts
          {contacts && contacts.length > 0 && (
            <Badge variant="secondary" className="ml-2 text-xs">{contacts.length}</Badge>
          )}
        </p>
        <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
          <IconPlus className="h-3.5 w-3.5 mr-1.5" />Add Contact
        </Button>
      </div>

      {loading && <p className="text-xs text-muted-foreground">Loading…</p>}

      {!loading && (!contacts || contacts.length === 0) && (
        <div className="flex flex-col items-center gap-2 py-6 text-center border rounded-lg bg-muted/30">
          <IconUser className="h-7 w-7 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">No contacts yet</p>
          <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
            <IconPlus className="h-3.5 w-3.5 mr-1.5" />Add first contact
          </Button>
        </div>
      )}

      <div className="space-y-2">
        {(contacts ?? []).map((c) => (
          <div key={c.id} className="flex items-start justify-between gap-3 px-3 py-2.5 rounded-lg border bg-background">
            <div className="flex items-start gap-2.5 min-w-0">
              <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                <IconUser className="h-3.5 w-3.5 text-primary" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-medium truncate">{contactDisplayName(c)}</span>
                  {c.is_default && (
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Default</Badge>
                  )}
                </div>
                {c.job_title && <p className="text-xs text-muted-foreground truncate">{c.job_title}</p>}
                {c.email    && <p className="text-xs text-muted-foreground truncate">{c.email}</p>}
                {c.phone    && <p className="text-xs text-muted-foreground">{c.phone}</p>}
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={() => toggleDefault(c)}
                title={c.is_default ? "Remove default" : "Set as default"}
                className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
                {c.is_default
                  ? <IconStarFilled className="h-3.5 w-3.5 text-amber-500" />
                  : <IconStar className="h-3.5 w-3.5" />}
              </button>
              <button onClick={() => setEditContact(c)}
                className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
                <IconEdit className="h-3.5 w-3.5" />
              </button>
              <button onClick={() => setDeleteContact(c)}
                className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors">
                <IconTrash className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>

      <FormDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        title="Add Contact"
        description={`Add a contact for ${customer.company_name}.`}
        fields={CONTACT_FORM_FIELDS}
        onSubmit={handleCreate}
        submitLabel="Add Contact"
      />

      <FormDialog
        open={!!editContact}
        onOpenChange={(o) => { if (!o) setEditContact(null); }}
        title="Edit Contact"
        fields={CONTACT_FORM_FIELDS}
        defaultValues={editContact ? (editContact as unknown as Record<string, unknown>) : {}}
        onSubmit={handleUpdate}
        submitLabel="Save"
      />

      <ConfirmDialog
        open={!!deleteContact}
        onOpenChange={(o) => { if (!o) setDeleteContact(null); }}
        title="Delete contact?"
        description={`"${deleteContact ? contactDisplayName(deleteContact) : ""}" will be permanently deleted.`}
        onConfirm={handleDelete}
      />
    </div>
  );
}

// ─── Main view ────────────────────────────────────────────────────────────────

const columns: ColumnDef<Customer, unknown>[] = [
  { accessorKey: "company_name", header: "Company" },
  { accessorKey: "vat_number",   header: "VAT Number" },
  {
    accessorKey: "city",
    header: "Location",
    cell: ({ row }) => {
      const loc = [row.original.city, row.original.country_code].filter(Boolean).join(", ");
      return loc || <span className="text-muted-foreground">—</span>;
    },
  },
];

export default function CustomersView() {
  const [conditions, setConditions]         = useState<Condition[]>([]);
  const [search, setSearch]                 = useState("");
  const [pageIndex, setPageIndex]           = useState(0);
  const [orderBy, setOrderBy]               = useState("company_name");
  const [order, setOrder]                   = useState<"asc" | "desc">("asc");
  const [createOpen, setCreateOpen]         = useState(false);
  const [editCustomer, setEditCustomer]     = useState<Customer | null>(null);
  const [deleteCustomer, setDeleteCustomer] = useState<Customer | null>(null);
  const [detailCustomer, setDetailCustomer] = useState<Customer | null>(null);

  const where = useMemo<WhereClause | undefined>(() => {
    const clauses: WhereClause[] = [];
    if (search) {
      clauses.push({ $or: [
        { company_name: { $ilike: `%${search}%` } },
        { vat_number:   { $ilike: `%${search}%` } },
        { city:         { $ilike: `%${search}%` } },
      ]});
    }
    for (const cond of conditions) {
      const clause = conditionToWhereClause(cond, FIELD_DEFS);
      if (clause) clauses.push(clause);
    }
    return clauses.length === 0 ? undefined : clauses.length === 1 ? clauses[0] : { $and: clauses };
  }, [search, conditions]);

  const { data: customers, total, loading, create, update, remove } =
    useAppCollection<Customer>(APP_ID, "customer", {
      where, orderBy, order, limit: PAGE_SIZE, offset: pageIndex * PAGE_SIZE,
    });

  const hasAny = conditions.length > 0 || !!search;

  const handleCreate = async (values: Record<string, any>) => {
    try { await create(values); toast.success("Customer created"); setCreateOpen(false); }
    catch (e: any) { toast.error(e.message); }
  };

  const handleUpdate = async (values: Record<string, any>) => {
    try {
      await update(editCustomer!.id, values);
      toast.success("Customer updated");
      // sync detail view if open
      if (detailCustomer?.id === editCustomer!.id) {
        setDetailCustomer({ ...detailCustomer!, ...values });
      }
      setEditCustomer(null);
    }
    catch (e: any) { toast.error(e.message); }
  };

  const handleDelete = async () => {
    try { await remove(deleteCustomer!.id); toast.success("Customer deleted"); setDeleteCustomer(null); }
    catch (e: any) { toast.error(e.message); }
  };

  return (
    <div className="flex flex-col flex-1 p-6 gap-5 min-h-0 overflow-hidden">
      <PageHeader
        title="Customers"
        description="Manage your customer directory and contacts"
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
        onRowClick={setDetailCustomer}
        rowActions={[
          { label: "Manage Contacts", icon: <IconUsers className="h-4 w-4" />, onClick: setDetailCustomer },
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

      {/* Customer detail + contacts dialog */}
      <Dialog open={!!detailCustomer} onOpenChange={(o) => { if (!o) setDetailCustomer(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{detailCustomer?.company_name}</DialogTitle>
            <DialogDescription>
              {[detailCustomer?.city, detailCustomer?.country_code].filter(Boolean).join(", ") || "Customer details"}
            </DialogDescription>
          </DialogHeader>

          {detailCustomer && (
            <div className="space-y-4">
              {/* Company info summary */}
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                {detailCustomer.vat_number && (
                  <>
                    <span className="text-muted-foreground">VAT</span>
                    <span className="font-mono">{detailCustomer.vat_number}</span>
                  </>
                )}
                {detailCustomer.street && (
                  <>
                    <span className="text-muted-foreground">Address</span>
                    <span>{[detailCustomer.street, detailCustomer.postal_code, detailCustomer.city].filter(Boolean).join(", ")}</span>
                  </>
                )}
              </div>

              <div className="flex justify-end">
                <Button size="sm" variant="outline" onClick={() => { setEditCustomer(detailCustomer); setDetailCustomer(null); }}>
                  <IconEdit className="h-3.5 w-3.5 mr-1.5" />Edit Company
                </Button>
              </div>

              <Separator />

              <ContactsPanel customer={detailCustomer} />
            </div>
          )}
        </DialogContent>
      </Dialog>

      <FormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="New Customer"
        description="Add a new company to your directory."
        fields={CUSTOMER_FORM_FIELDS}
        onSubmit={handleCreate}
        submitLabel="Create Customer"
      />

      <FormDialog
        open={!!editCustomer}
        onOpenChange={(open) => { if (!open) setEditCustomer(null); }}
        title="Edit Customer"
        description="Update company information."
        fields={CUSTOMER_FORM_FIELDS}
        defaultValues={editCustomer ? (editCustomer as unknown as Record<string, unknown>) : {}}
        onSubmit={handleUpdate}
        submitLabel="Save Changes"
      />

      <ConfirmDialog
        open={!!deleteCustomer}
        onOpenChange={(open) => { if (!open) setDeleteCustomer(null); }}
        title="Delete customer?"
        description={`"${deleteCustomer?.company_name}" and all its contacts will be permanently deleted.`}
        onConfirm={handleDelete}
      />
    </div>
  );
}
