import { useState } from "react";
import { useAppCollection } from "@rootcx/sdk";
import { PageHeader, DataTable, EmptyState, FormDialog, ConfirmDialog, Button, toast } from "@rootcx/ui";
import { IconPlus, IconEdit, IconTrash, IconUsers } from "@tabler/icons-react";
import type { ColumnDef } from "@tanstack/react-table";
import type { Customer } from "../types";
import { CUSTOMER_FORM_FIELDS } from "../types";

const APP_ID = "billing";

const columns: ColumnDef<Customer, unknown>[] = [
  { accessorKey: "company_name", header: "Company" },
  { accessorKey: "contact_name", header: "Contact" },
  { accessorKey: "contact_email", header: "Email" },
  { accessorKey: "vat_number", header: "VAT Number" },
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
  const { data: customers, loading, create, update, remove } =
    useAppCollection<Customer>(APP_ID, "customer");

  const [createOpen, setCreateOpen] = useState(false);
  const [editCustomer, setEditCustomer] = useState<Customer | null>(null);
  const [deleteCustomer, setDeleteCustomer] = useState<Customer | null>(null);

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

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Customers"
        description="Manage your customer directory"
        actions={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <IconPlus className="h-4 w-4 mr-1.5" />New Customer
          </Button>
        }
      />

      <div className="flex-1 overflow-auto p-6 pt-0">
        <DataTable
          data={customers ?? []}
          columns={columns}
          loading={loading}
          searchable
          pagination
          pageSize={20}
          rowActions={[
            { label: "Edit",   icon: <IconEdit  className="h-4 w-4" />, onClick: setEditCustomer },
            { label: "Delete", icon: <IconTrash className="h-4 w-4" />, onClick: setDeleteCustomer, destructive: true },
          ]}
          emptyState={
            <EmptyState
              icon={<IconUsers className="h-8 w-8" />}
              title="No customers yet"
              description="Add your first customer to get started"
              action={
                <Button size="sm" onClick={() => setCreateOpen(true)}>
                  <IconPlus className="h-4 w-4 mr-1.5" />New Customer
                </Button>
              }
            />
          }
        />
      </div>

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
