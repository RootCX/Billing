import { useState, useEffect } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
  Button, Input, Label, Separator,
  Select, SelectTrigger, SelectContent, SelectItem, SelectValue,
  Textarea,
} from "@rootcx/ui";
import type { LineItem } from "../types";
import { computeLineItem, formatCurrency } from "../types";
import { cn } from "@/lib/utils";

const UNITS = ["Each", "Hour", "Day", "Month", "Year", "kg", "g", "L", "m", "m²", "m³"];

type NumField = "quantity" | "unit_price" | "discount" | "tax_rate";
type FormState = Omit<LineItem, "id" | NumField> & Record<NumField, number | null>;

const DEFAULT: FormState = { product: "", description: "", unit: "Each", quantity: 1, unit_price: 0, discount: 0, tax_rate: 0 };
const toSafe = (f: FormState, id = ""): LineItem => ({ ...f, id, quantity: f.quantity ?? 0, unit_price: f.unit_price ?? 0, discount: f.discount ?? 0, tax_rate: f.tax_rate ?? 0 });

const Field = ({ label, required, error, children }: { label: string; required?: boolean; error?: string; children: React.ReactNode }) => (
  <div className="space-y-1.5">
    <Label className="text-sm font-medium">{label}{required && <span className="text-destructive ml-0.5">*</span>}</Label>
    {children}
    {error && <p className="text-xs text-destructive">{error}</p>}
  </div>
);

interface Props { open: boolean; onOpenChange: (o: boolean) => void; initialItem: LineItem | null; currency: string; onSave: (item: LineItem) => void; }

export default function LineItemDialog({ open, onOpenChange, initialItem, currency, onSave }: Props) {
  const [form, setForm] = useState<FormState>(DEFAULT);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    const { id: _id, ...rest } = initialItem ?? { id: "", ...DEFAULT };
    setForm(rest as FormState);
    setErrors({});
  }, [open, initialItem]);

  const patch = (p: Partial<FormState>) => setForm(f => ({ ...f, ...p }));
  const patchNum = (field: NumField) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.valueAsNumber;
    patch({ [field]: Number.isNaN(v) ? null : v });
  };
  const selectAll = (e: React.FocusEvent<HTMLInputElement>) => e.target.select();

  const safe = toSafe(form);
  const { subtotal, total } = computeLineItem(safe);

  const handleSave = () => {
    const e: Record<string, string> = {};
    if (!form.product.trim()) e.product = "Product / Service is required";
    if ((form.quantity ?? 0) <= 0) e.quantity = "Quantity must be > 0";
    if (Object.keys(e).length) { setErrors(e); return; }
    onSave({ ...safe, id: initialItem?.id ?? crypto.randomUUID() });
    onOpenChange(false);
  };

  const numInput = (field: NumField, opts?: { max?: number; error?: string }) => (
    <Input type="number" min={0} max={opts?.max} step="0.01"
      value={form[field] ?? ""}
      onChange={patchNum(field)}
      onFocus={selectAll}
      className={cn(opts?.error && "border-destructive")}
    />
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{initialItem ? "Edit Line Item" : "Add Line Item"}</DialogTitle>
          <DialogDescription>Fill in the details for this line item.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <Field label="Product / Service" required error={errors.product}>
            <Input value={form.product} onChange={e => patch({ product: e.target.value })}
              placeholder="e.g., Website Development" className={cn(errors.product && "border-destructive")} />
          </Field>

          <Field label="Description">
            <Textarea value={form.description} onChange={e => patch({ description: e.target.value })}
              placeholder="Optional description" className="min-h-[60px] resize-none text-sm" />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Quantity" required error={errors.quantity}>
              {numInput("quantity", { error: errors.quantity })}
            </Field>
            <Field label="Unit">
              <Select value={form.unit} onValueChange={v => patch({ unit: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
          </div>

          <Field label={`Unit Price (${currency})`}>{numInput("unit_price")}</Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Discount (%)">{numInput("discount", { max: 100 })}</Field>
            <Field label="Tax Rate (%)">{numInput("tax_rate", { max: 100 })}</Field>
          </div>

          <Separator />

          <div className="space-y-1 text-sm">
            <div className="flex justify-between text-muted-foreground">
              <span>Subtotal:</span><span className="font-mono font-medium">{formatCurrency(subtotal, currency)}</span>
            </div>
            <div className="flex justify-between font-semibold">
              <span>Total:</span><span className="font-mono">{formatCurrency(total, currency)}</span>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
