import { useState } from "react";
import { useAppCollection } from "@rootcx/sdk";
import {
  Input, Label, Textarea, Button, Separator, Badge,
  Select, SelectTrigger, SelectContent, SelectItem, SelectValue,
  Popover, PopoverTrigger, PopoverContent,
  FormDialog, toast,
} from "@rootcx/ui";
import {
  IconPlus, IconSearch, IconLink, IconLinkOff, IconUser, IconChevronDown,
  IconEdit, IconX, IconFileText, IconTrash,
} from "@tabler/icons-react";

// sentinel: field explicitly cleared — nothing printed on invoice
export const FIELD_NONE = "__none__";

interface OverrideFieldProps {
  label: string;
  value: string;        // raw stored value ("" | FIELD_NONE | custom text)
  defaultValue: string;
  placeholder: string;
  emptyHint: string;
  minH?: string;
  onChange: (v: string) => void;
}

const OverrideField = ({ label, value, defaultValue, placeholder, emptyHint, minH = "min-h-[72px]", onChange }: OverrideFieldProps) => {
  const isNone     = value === FIELD_NONE;
  const isOverride = value && !isNone;

  return (
    <div className="space-y-1 mb-3">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
        <div className="flex items-center gap-2">
          {isOverride && (
            <button onClick={() => onChange("")} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors">
              <IconX className="h-3 w-3" />Reset to default
            </button>
          )}
          {!isOverride && !isNone && (
            <button onClick={() => onChange(defaultValue || " ")} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors">
              <IconEdit className="h-3 w-3" />Override
            </button>
          )}
          {!isNone && (
            <button onClick={() => onChange(FIELD_NONE)} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-destructive transition-colors">
              <IconTrash className="h-3 w-3" />Remove
            </button>
          )}
          {isNone && (
            <button onClick={() => onChange("")} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors">
              <IconX className="h-3 w-3" />Restore
            </button>
          )}
        </div>
      </div>

      {isNone ? (
        <div className="rounded-md border border-dashed bg-muted/20 px-3 py-2.5 text-xs text-muted-foreground italic">
          Removed — will not appear on invoice
        </div>
      ) : isOverride ? (
        <Textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
          className={cn("text-sm resize-none ring-1 ring-amber-400/60", minH)} autoFocus />
      ) : (
        <div className={cn("rounded-md border bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground", !defaultValue && "italic")}>
          {defaultValue
            ? <span className="whitespace-pre-line line-clamp-3">{defaultValue}</span>
            : <span className="flex items-center gap-1.5"><IconFileText className="h-3.5 w-3.5 shrink-0" />{emptyHint}</span>
          }
        </div>
      )}
    </div>
  );
};
import type { Invoice, LineItem, InvoiceReference, Customer, Contact } from "../types";
import {
  formatCurrency, applyCustomerToDraft, CUSTOMER_FORM_FIELDS, CONTACT_FORM_FIELDS,
  contactDisplayName,
} from "../types";
import LineItemDialog from "./LineItemDialog";
import ReferencesSection from "./ReferencesSection";
import LineItemRow from "./LineItemRow";
import { cn } from "@/lib/utils";

const APP_ID = "billing";

const CURRENCIES = ["EUR", "USD", "GBP", "CHF", "CAD", "AUD", "JPY"];
const VAT_TREATMENTS = [
  { value: "standard",       label: "Standard" },
  { value: "exempt",         label: "Exempt" },
  { value: "reverse_charge", label: "Reverse Charge" },
  { value: "intra_eu",       label: "Intra-EU" },
  { value: "export",         label: "Export" },
];
const STATUS_OPTIONS = [
  { value: "draft",     label: "Draft" },
  { value: "sent",      label: "Sent" },
  { value: "paid",      label: "Paid" },
  { value: "overdue",   label: "Overdue" },
  { value: "cancelled", label: "Cancelled" },
];

const SectionTitle = ({ children }: { children: React.ReactNode }) => (
  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-3 mt-5 first:mt-0">
    {children}
  </p>
);

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="space-y-1 mb-3">
    <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
    {children}
  </div>
);

interface Props {
  draft: Partial<Invoice>;
  onChange: (patch: Partial<Invoice>) => void;
  sellerDefaultTerms?: string;
  sellerDefaultNotes?: string;
}

export default function InvoiceDetailsTab({ draft, onChange, sellerDefaultTerms = "", sellerDefaultNotes = "" }: Props) {
  const [lineItemDialogOpen, setLineItemDialogOpen] = useState(false);
  const [editingItem, setEditingItem]               = useState<LineItem | null>(null);

  // Customer linking state
  const [searchOpen, setSearchOpen]             = useState(false);
  const [searchQuery, setSearchQuery]           = useState("");
  const [linkedCustomerId, setLinkedCustomerId] = useState<string | null>(null);
  const [linkedContactId, setLinkedContactId]   = useState<string | null>(null);
  const [contactPickerOpen, setContactPickerOpen] = useState(false);
  const [createCustomerOpen, setCreateCustomerOpen] = useState(false);
  const [addContactOpen, setAddContactOpen]     = useState(false);

  const { data: customers, create: createCustomer } =
    useAppCollection<Customer>(APP_ID, "customer");

  const { data: contacts, create: createContact } =
    useAppCollection<Contact>(APP_ID, "contact", {
      where: linkedCustomerId ? { customer_id: linkedCustomerId } : undefined,
      orderBy: "created_at", order: "asc",
    });

  const lineItems: LineItem[] = draft.line_items ?? [];
  const currency = draft.currency || "EUR";

  const linkedCustomer = linkedCustomerId
    ? (customers ?? []).find((c) => c.id === linkedCustomerId) ?? null
    : null;
  const linkedContact = linkedContactId
    ? (contacts ?? []).find((c) => c.id === linkedContactId) ?? null
    : null;

  const filteredCustomers = (customers ?? []).filter((c) => {
    const q = searchQuery.toLowerCase();
    return c.company_name?.toLowerCase().includes(q);
  });

  const linkCustomer = (c: Customer) => {
    setLinkedCustomerId(c.id);
    setLinkedContactId(null);
    setSearchOpen(false);
    setSearchQuery("");
    onChange(applyCustomerToDraft(c, undefined));
    // Defer so the search popover closes before the contact one opens
    setTimeout(() => setContactPickerOpen(true), 100);
  };

  const unlinkCustomer = () => {
    setLinkedCustomerId(null);
    setLinkedContactId(null);
  };

  const pickContact = (contact: Contact) => {
    setLinkedContactId(contact.id);
    setContactPickerOpen(false);
    if (linkedCustomer) onChange(applyCustomerToDraft(linkedCustomer, contact));
  };

  const handleCreateAndLink = async (values: Record<string, any>) => {
    try {
      const c = await createCustomer(values);
      setLinkedCustomerId(c.id);
      setLinkedContactId(null);
      setCreateCustomerOpen(false);
      onChange(applyCustomerToDraft(c, undefined));
      toast.success("Customer created and linked");
      setTimeout(() => setContactPickerOpen(true), 100);
    } catch (e: any) { toast.error(e.message); }
  };

  const handleCreateContact = async (values: Record<string, any>) => {
    if (!linkedCustomerId) return;
    try {
      const contact = await createContact({ ...values, customer_id: linkedCustomerId });
      setLinkedContactId(contact.id);
      setAddContactOpen(false);
      if (linkedCustomer) onChange(applyCustomerToDraft(linkedCustomer, contact));
      toast.success("Contact added and selected");
    } catch (e: any) { toast.error(e.message); }
  };

  const handleAddLineItem = (item: LineItem) => {
    onChange({
      line_items: editingItem
        ? lineItems.map((li) => (li.id === item.id ? item : li))
        : [...lineItems, item],
    });
    setEditingItem(null);
  };

  return (
    <div className="space-y-0.5 text-sm">
      <SectionTitle>Invoice Information</SectionTitle>

      <Field label="Invoice Number">
        <Input value={draft.invoice_number ?? ""} onChange={(e) => onChange({ invoice_number: e.target.value })}
          className="h-8 text-sm font-mono" placeholder="INV-20260317-0001" />
      </Field>

      <Field label="Status">
        <Select value={draft.status ?? "draft"} onValueChange={(v) => onChange({ status: v as any })}>
          <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </Field>

      <Field label="Invoice Date">
        <Input type="date" value={draft.invoice_date ?? ""} onChange={(e) => onChange({ invoice_date: e.target.value })}
          className="h-8 text-sm" />
      </Field>

      <Field label="Due Date">
        <Input type="date" value={draft.due_date ?? ""} onChange={(e) => onChange({ due_date: e.target.value })}
          className="h-8 text-sm" />
      </Field>

      <Field label="Currency">
        <Select value={draft.currency ?? "EUR"} onValueChange={(v) => onChange({ currency: v })}>
          <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            {CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </Field>

      <Field label="VAT Treatment">
        <Select value={draft.vat_treatment ?? "standard"} onValueChange={(v) => onChange({ vat_treatment: v as any })}>
          <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            {VAT_TREATMENTS.map((v) => <SelectItem key={v.value} value={v.value}>{v.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </Field>

      <Separator className="my-4" />

      {/* ── Client section ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-3 mt-5">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Client Information
        </p>
        <div className="flex items-center gap-1">
          {linkedCustomer ? (
            <button onClick={unlinkCustomer}
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors">
              <IconLinkOff className="h-3 w-3" />Unlink
            </button>
          ) : (
            <>
              <Popover open={searchOpen} onOpenChange={setSearchOpen}>
                <PopoverTrigger asChild>
                  <button className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors mr-2">
                    <IconLink className="h-3 w-3" />Link customer
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-64 p-2" align="end">
                  <div className="relative mb-2">
                    <IconSearch className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                    <input autoFocus value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search companies…"
                      className="w-full pl-7 pr-2 py-1.5 text-xs rounded-md border bg-background focus:outline-none focus:ring-1 focus:ring-ring" />
                  </div>
                  <div className="max-h-48 overflow-y-auto space-y-0.5">
                    {filteredCustomers.length === 0
                      ? <p className="text-xs text-muted-foreground text-center py-3">No customers found</p>
                      : filteredCustomers.map((c) => (
                          <button key={c.id} onClick={() => linkCustomer(c)}
                            className="w-full text-left px-2 py-1.5 rounded-sm text-xs hover:bg-accent transition-colors">
                            <span className="font-medium">{c.company_name}</span>
                            {c.city && <span className="text-muted-foreground ml-1.5">· {c.city}</span>}
                          </button>
                        ))
                    }
                  </div>
                  <Separator className="my-2" />
                  <button onClick={() => { setSearchOpen(false); setCreateCustomerOpen(true); }}
                    className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-sm text-xs text-primary hover:bg-accent transition-colors font-medium">
                    <IconPlus className="h-3.5 w-3.5" />Create new customer
                  </button>
                </PopoverContent>
              </Popover>

              <button onClick={() => setCreateCustomerOpen(true)}
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors">
                <IconPlus className="h-3 w-3" />New
              </button>
            </>
          )}
        </div>
      </div>

      {/* Linked customer badge */}
      {linkedCustomer && (
        <div className="flex items-center gap-2 mb-2 px-2.5 py-1.5 rounded-md bg-primary/8 border border-primary/20 text-xs">
          <IconUser className="h-3.5 w-3.5 text-primary shrink-0" />
          <span className="font-medium text-primary truncate">{linkedCustomer.company_name}</span>
          <span className="text-muted-foreground ml-auto shrink-0">linked</span>
        </div>
      )}

      {/* Contact picker (only visible when a customer is linked) */}
      {linkedCustomer && (
        <div className="mb-3">
          <Popover open={contactPickerOpen} onOpenChange={setContactPickerOpen}>
            <PopoverTrigger asChild>
              <button className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-md border text-xs hover:bg-accent transition-colors">
                <div className="flex items-center gap-2 min-w-0">
                  <IconUser className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  {linkedContact
                    ? <span className="font-medium truncate">{contactDisplayName(linkedContact)}{linkedContact.email ? ` · ${linkedContact.email}` : ""}</span>
                    : <span className="text-muted-foreground">Select a contact…</span>
                  }
                </div>
                <IconChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0 ml-2" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-64 p-2" align="start">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2 px-1">
                Contacts — {linkedCustomer.company_name}
              </p>
              <div className="max-h-48 overflow-y-auto space-y-0.5">
                {(!contacts || contacts.length === 0) && (
                  <p className="text-xs text-muted-foreground text-center py-3">No contacts yet</p>
                )}
                {(contacts ?? []).map((c) => (
                  <button key={c.id} onClick={() => pickContact(c)}
                    className="w-full text-left px-2 py-1.5 rounded-sm text-xs hover:bg-accent transition-colors">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium">{contactDisplayName(c)}</span>
                      {c.is_default && <Badge variant="secondary" className="text-[10px] px-1 py-0 leading-none">Default</Badge>}
                    </div>
                    {c.job_title && <span className="text-muted-foreground">{c.job_title}</span>}
                    {c.email     && <span className="block text-muted-foreground">{c.email}</span>}
                  </button>
                ))}
              </div>
              <Separator className="my-2" />
              <button onClick={() => { setContactPickerOpen(false); setAddContactOpen(true); }}
                className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-sm text-xs text-primary hover:bg-accent transition-colors font-medium">
                <IconPlus className="h-3.5 w-3.5" />Add new contact
              </button>
            </PopoverContent>
          </Popover>
        </div>
      )}

      <Field label="Company Name">
        <Input value={draft.client_company ?? ""} onChange={(e) => onChange({ client_company: e.target.value })}
          className="h-8 text-sm" placeholder="Company name" />
      </Field>

      <Field label="VAT Number">
        <Input value={draft.client_vat ?? ""} onChange={(e) => onChange({ client_vat: e.target.value })}
          className="h-8 text-sm" placeholder="e.g., BE0123456789" />
      </Field>

      <Field label="Street">
        <Input value={draft.client_street ?? ""} onChange={(e) => onChange({ client_street: e.target.value })}
          className="h-8 text-sm" placeholder="Street address" />
      </Field>

      <div className="grid grid-cols-2 gap-2 mb-3">
        <div className="space-y-1">
          <Label className="text-xs font-medium text-muted-foreground">City</Label>
          <Input value={draft.client_city ?? ""} onChange={(e) => onChange({ client_city: e.target.value })}
            className="h-8 text-sm" placeholder="City" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs font-medium text-muted-foreground">Postal Code</Label>
          <Input value={draft.client_postal ?? ""} onChange={(e) => onChange({ client_postal: e.target.value })}
            className="h-8 text-sm" placeholder="Postal code" />
        </div>
      </div>

      <Field label="Country Code">
        <Input value={draft.client_country ?? ""} onChange={(e) => onChange({ client_country: e.target.value })}
          className="h-8 text-sm" placeholder="BE" maxLength={2} />
      </Field>

      <Field label="Contact Name">
        <Input value={draft.client_contact_name ?? ""} onChange={(e) => onChange({ client_contact_name: e.target.value })}
          className="h-8 text-sm" placeholder="Contact name" />
      </Field>

      <Field label="Contact Email">
        <Input type="email" value={draft.client_contact_email ?? ""} onChange={(e) => onChange({ client_contact_email: e.target.value })}
          className="h-8 text-sm" placeholder="contact@example.com" />
      </Field>

      <Separator className="my-4" />

      <SectionTitle>Line Items</SectionTitle>

      <div className="space-y-2 mb-3">
        {lineItems.map((item) => (
          <LineItemRow key={item.id} item={item} currency={currency}
            onEdit={(item) => { setEditingItem(item); setLineItemDialogOpen(true); }}
            onDelete={(id) => onChange({ line_items: lineItems.filter((li) => li.id !== id) })} />
        ))}
      </div>

      {lineItems.length > 0 && (
        <div className="text-right text-xs space-y-1 mb-3 border rounded-md p-3 bg-muted/30">
          <div className="flex justify-between text-muted-foreground">
            <span>Subtotal</span><span className="font-mono">{formatCurrency(draft.subtotal ?? 0, currency)}</span>
          </div>
          <div className="flex justify-between text-muted-foreground">
            <span>Tax</span><span className="font-mono">{formatCurrency(draft.total_tax ?? 0, currency)}</span>
          </div>
          <Separator className="my-1" />
          <div className="flex justify-between font-semibold text-sm">
            <span>Total</span><span className="font-mono">{formatCurrency(draft.total ?? 0, currency)}</span>
          </div>
        </div>
      )}

      <Button variant="outline" size="sm" className="w-full"
        onClick={() => { setEditingItem(null); setLineItemDialogOpen(true); }}>
        <IconPlus className="h-3.5 w-3.5 mr-2" />Add Line Item
      </Button>

      <Separator className="my-4" />

      <ReferencesSection
        references={draft.references ?? []}
        onChange={(refs: InvoiceReference[]) => onChange({ references: refs })} />

      <Separator className="my-4" />

      <SectionTitle>Notes &amp; Terms</SectionTitle>

      <OverrideField
        label="Notes"
        value={draft.internal_notes ?? ""}
        defaultValue={sellerDefaultNotes}
        placeholder="Notes for this invoice…"
        emptyHint="No default notes — configure in Seller Settings."
        onChange={(v) => onChange({ internal_notes: v })}
      />

      <OverrideField
        label="Terms & Conditions"
        value={draft.terms ?? ""}
        defaultValue={sellerDefaultTerms}
        placeholder="Custom terms for this invoice…"
        emptyHint="No default terms — configure in Seller Settings."
        minH="min-h-[88px]"
        onChange={(v) => onChange({ terms: v })}
      />

      {/* Dialogs */}
      <LineItemDialog
        open={lineItemDialogOpen}
        onOpenChange={(open) => { setLineItemDialogOpen(open); if (!open) setEditingItem(null); }}
        initialItem={editingItem}
        currency={currency}
        onSave={handleAddLineItem} />

      <FormDialog
        open={createCustomerOpen}
        onOpenChange={setCreateCustomerOpen}
        title="New Customer"
        description="Create a new customer and link them to this invoice."
        fields={CUSTOMER_FORM_FIELDS}
        onSubmit={handleCreateAndLink}
        submitLabel="Create & Link" />

      <FormDialog
        open={addContactOpen}
        onOpenChange={setAddContactOpen}
        title="Add Contact"
        description={linkedCustomer ? `Add a contact for ${linkedCustomer.company_name}.` : ""}
        fields={CONTACT_FORM_FIELDS}
        onSubmit={handleCreateContact}
        submitLabel="Add & Select" />
    </div>
  );
}
