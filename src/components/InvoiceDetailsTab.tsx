import { useState } from "react";
import { useAppCollection } from "@rootcx/sdk";
import {
  Input, Label, Textarea, Button, Separator, Badge,
  Select, SelectTrigger, SelectContent, SelectItem, SelectValue,
  Popover, PopoverTrigger, PopoverContent,
  Tooltip, TooltipTrigger, TooltipContent,
  FormDialog, toast,
} from "@rootcx/ui";
import {
  IconPlus, IconSearch, IconLink, IconLinkOff, IconUser, IconChevronDown,
  IconEdit, IconX, IconFileText, IconTrash, IconInfoCircle,
} from "@tabler/icons-react";
import { CountrySelect } from "./CountrySelect";

import { FIELD_NONE } from "@shared/invoice-types";

interface OverrideFieldProps {
  label: string;
  value: string; // "" | FIELD_NONE | custom override
  defaultValue: string;
  placeholder: string;
  emptyHint: string;
  minH?: string;
  onChange: (v: string) => void;
}

const OverrideField = ({ label, value, defaultValue, placeholder, emptyHint, minH = "min-h-[72px]", onChange }: OverrideFieldProps) => {
  const isNone     = value === FIELD_NONE;
  const isOverride = !!value && !isNone;

  const actions = [
    isOverride  && { label: "Reset to default", icon: <IconX className="h-3 w-3" />,     fn: () => onChange(""),          cls: "hover:text-foreground" },
    !isOverride && !isNone && { label: "Override", icon: <IconEdit className="h-3 w-3" />, fn: () => onChange(defaultValue || " "), cls: "hover:text-foreground" },
    !isNone     && { label: "Remove",  icon: <IconTrash className="h-3 w-3" />,            fn: () => onChange(FIELD_NONE),  cls: "hover:text-destructive" },
    isNone      && { label: "Restore", icon: <IconX className="h-3 w-3" />,                fn: () => onChange(""),          cls: "hover:text-foreground" },
  ].filter(Boolean) as { label: string; icon: React.ReactNode; fn: () => void; cls: string }[];

  return (
    <div className="space-y-1 mb-3">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
        <div className="flex items-center gap-2">
          {actions.map(({ label, icon, fn, cls }) => (
            <button key={label} onClick={fn} className={cn("inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors", cls)}>
              {icon}{label}
            </button>
          ))}
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
import type { Invoice, LineItem, InvoiceReference, DocumentAllowance, Customer, Contact } from "../types";
import {
  formatCurrency, computeDocumentTotals, computeVatBreakdown, applyCustomerToDraft, CUSTOMER_FORM_FIELDS, CONTACT_FORM_FIELDS,
  contactDisplayName,
} from "../types";
import LineItemDialog from "./LineItemDialog";
import ReferencesSection from "./ReferencesSection";
import LineItemRow from "./LineItemRow";
import { cn } from "@/lib/utils";

const APP_ID = "billing";

/** Explanation on demand: the label carries the field, not a paragraph next to it. */
const HelpTip = ({ text }: { text: string }) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <button type="button" tabIndex={-1} className="text-muted-foreground/60 transition-colors hover:text-foreground">
        <IconInfoCircle className="h-3.5 w-3.5" />
      </button>
    </TooltipTrigger>
    <TooltipContent side="right" className="max-w-[240px] text-[11px] leading-relaxed">{text}</TooltipContent>
  </Tooltip>
);

const CURRENCIES = ["EUR", "USD", "GBP", "CHF", "CAD", "AUD", "JPY"];
const VAT_TREATMENTS = [
  { value: "standard",       label: "Standard" },
  { value: "exempt",         label: "Exempt" },
  { value: "reverse_charge", label: "Reverse Charge" },
  { value: "intra_eu",       label: "Intra-EU" },
  { value: "export",         label: "Export" },
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

const TotalRow = ({ label, amount, className }: { label: string; amount: string; className?: string }) => (
  <div className={cn("flex justify-between text-muted-foreground", className)}>
    <span>{label}</span>
    <span className="font-mono">{amount}</span>
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
  const allowances: DocumentAllowance[] = draft.allowances ?? [];
  const currency = draft.currency || "EUR";

  // Computed here rather than read from the draft so the box can never lag behind
  // an edit, and so it shows the discount/paid rows the stored fields don't carry.
  const totals = computeDocumentTotals(lineItems, allowances, draft.prepaid_amount ?? 0);

  // Recapped rate by rate only when several rates are in play — with one rate the
  // "VAT" row already says everything. Its point is to make visible that a discount
  // lowers the base of its own rate.
  const vatBreakdown = computeVatBreakdown(lineItems, allowances).filter((line) => line.taxableAmount !== 0);
  const showVatBreakdown = vatBreakdown.length > 1;

  // A discount reduces the VAT base of its own rate, so it can only use a rate the
  // lines actually charge — offering anything else would build an invalid document.
  const lineTaxRates = [...new Set(lineItems.map((item) => Number(item.tax_rate) || 0))].sort((a, b) => a - b);

  const patchAllowance = (id: string, patch: Partial<DocumentAllowance>) =>
    onChange({ allowances: allowances.map((a) => (a.id === id ? { ...a, ...patch } : a)) });

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

      <Field label="Country">
        <CountrySelect
          value={draft.client_country ?? ""}
          onChange={(code) => onChange({ client_country: code })}
        />
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

      <Button variant="outline" size="sm" className="w-full"
        onClick={() => { setEditingItem(null); setLineItemDialogOpen(true); }}>
        <IconPlus className="h-3.5 w-3.5 mr-2" />Add Line Item
      </Button>

      <Separator className="my-4" />

      {/* ── Discounts & payments ────────────────────────────────────────────────
          Two deductions that look alike and behave differently: a discount is taken
          off before the VAT, a payment after it. The difference lives in a tooltip
          and, above all, in the totals box below, where the VAT visibly moves or
          not. Neither may be typed as a negative line: Peppol rejects a negative
          unit price outright. */}
      <SectionTitle>Discounts &amp; Payments</SectionTitle>

      <div className="mb-3 space-y-2">
        <div className="flex items-center gap-1.5">
          <Label className="text-xs font-medium text-muted-foreground">Discount</Label>
          <HelpTip text="A rebate, or a down payment you have already invoiced. The VAT is recharged on the reduced amount, so pick the rate it applied to." />
        </div>

        {allowances.map((allowance) => (
          <div key={allowance.id} className="flex items-start gap-2 rounded-md border bg-muted/20 p-2">
            <div className="grid flex-1 grid-cols-[1fr_68px] gap-2">
              <Input
                type="number" step="0.01" min="0"
                value={allowance.amount || ""}
                onChange={(e) => patchAllowance(allowance.id, { amount: Number(e.target.value) || 0 })}
                className="h-8 text-sm font-mono" placeholder="0.00 excl. VAT"
              />
              <Select
                value={String(allowance.tax_rate)}
                onValueChange={(v) => patchAllowance(allowance.id, { tax_rate: Number(v) })}
              >
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {lineTaxRates.map((rate) => (
                    <SelectItem key={rate} value={String(rate)}>{rate}%</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                value={allowance.reason}
                onChange={(e) => patchAllowance(allowance.id, { reason: e.target.value })}
                className={cn("col-span-2 h-8 text-sm", !allowance.reason.trim() && "ring-1 ring-amber-400/60")}
                placeholder="Reason, printed on the invoice"
              />
            </div>
            <button
              onClick={() => onChange({ allowances: allowances.filter((a) => a.id !== allowance.id) })}
              className="mt-2 text-muted-foreground transition-colors hover:text-destructive"
              title="Remove discount"
            >
              <IconTrash className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}

        <Button
          variant="outline" size="sm" className="w-full"
          disabled={lineTaxRates.length === 0}
          title={lineTaxRates.length === 0 ? "Add a line item first — a discount follows the VAT rate of the lines" : undefined}
          onClick={() => onChange({
            allowances: [...allowances, { id: crypto.randomUUID(), amount: 0, tax_rate: lineTaxRates[0], reason: "" }],
          })}
        >
          <IconPlus className="h-3.5 w-3.5 mr-2" />Add discount
        </Button>
      </div>

      <div className="mb-3 space-y-2">
        <div className="flex items-center gap-1.5">
          <Label className="text-xs font-medium text-muted-foreground">Already paid</Label>
          <HelpTip text="Money already received for this invoice, VAT included. Only the amount due goes down — the VAT stays as invoiced." />
        </div>
        <Input
          type="number"
          step="0.01"
          min="0"
          value={draft.prepaid_amount ?? ""}
          onChange={(e) => onChange({ prepaid_amount: Number(e.target.value) || 0 })}
          className="h-8 text-sm font-mono"
          placeholder="0.00 incl. VAT"
        />
        {(draft.prepaid_amount ?? 0) > 0 && (
          <Input
            value={draft.prepaid_reference ?? ""}
            onChange={(e) => onChange({ prepaid_reference: e.target.value })}
            className="h-8 text-sm"
            placeholder="Payment reference, printed on the invoice"
          />
        )}
      </div>

      {lineItems.length > 0 && (
        <div className="text-right text-xs space-y-1 mt-4 mb-3 border rounded-md p-3 bg-muted/30">
          {/* Same wording, same order as the PDF and the Peppol document. */}
          <TotalRow label="Subtotal excl. VAT" amount={formatCurrency(totals.subtotal, currency)} />
          {totals.allowanceTotal > 0 && (
            <>
              <TotalRow label="Discounts" amount={`−${formatCurrency(totals.allowanceTotal, currency)}`} />
              <TotalRow label="Total excl. VAT" amount={formatCurrency(totals.taxableAmount, currency)} />
            </>
          )}
          {showVatBreakdown && vatBreakdown.map((line) => (
            <TotalRow
              key={line.taxRate}
              label={`VAT ${line.taxRate}% on ${formatCurrency(line.taxableAmount, currency)}`}
              amount={formatCurrency(line.taxAmount, currency)}
            />
          ))}
          {!showVatBreakdown && <TotalRow label="VAT" amount={formatCurrency(totals.totalTax, currency)} />}
          <Separator className="my-1" />
          {totals.prepaidAmount > 0 && (
            <>
              <TotalRow label="Total incl. VAT" amount={formatCurrency(totals.total, currency)} />
              <TotalRow label="Already paid" amount={`−${formatCurrency(totals.prepaidAmount, currency)}`} />
              <Separator className="my-1" />
            </>
          )}
          <TotalRow
            label="Amount due"
            amount={formatCurrency(totals.amountDue, currency)}
            className="text-sm font-semibold text-foreground"
          />
        </div>
      )}

      {currency !== "EUR" && (draft.vat_treatment ?? "standard") === "standard" && Number(draft.total_tax ?? 0) > 0 && (
        <div className="mb-3 rounded-md border p-3 bg-muted/20">
          <div className="mb-2 flex items-center justify-between">
            <Label className="text-xs font-medium text-muted-foreground">VAT Accounting Currency</Label>
            <Badge variant={draft.tax_currency && draft.tax_amount_in_tax_currency ? "secondary" : "outline"} className="text-[10px]">
              Peppol required
            </Badge>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Tax Currency">
              <Input
                value={draft.tax_currency ?? ""}
                onChange={(e) => onChange({ tax_currency: e.target.value.toUpperCase() })}
                className="h-8 text-sm font-mono"
                placeholder="EUR"
                maxLength={3}
              />
            </Field>
            <Field label="VAT Amount">
              <Input
                type="number"
                step="0.01"
                value={draft.tax_amount_in_tax_currency ?? ""}
                onChange={(e) => onChange({ tax_amount_in_tax_currency: Number(e.target.value) || 0 })}
                className="h-8 text-sm font-mono"
                placeholder="0.00"
              />
            </Field>
            <Field label="Exchange Rate">
              <Input
                type="number"
                step="0.000001"
                value={draft.tax_exchange_rate ?? ""}
                onChange={(e) => onChange({ tax_exchange_rate: Number(e.target.value) || 0 })}
                className="h-8 text-sm font-mono"
                placeholder="0.000000"
              />
            </Field>
            <Field label="Rate Date">
              <Input
                type="date"
                value={draft.tax_exchange_rate_date ?? ""}
                onChange={(e) => onChange({ tax_exchange_rate_date: e.target.value })}
                className="h-8 text-sm"
              />
            </Field>
          </div>
        </div>
      )}

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
