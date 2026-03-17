import { useState, useEffect } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  DialogDescription,
  Button, Input, Label, Separator,
  Select, SelectTrigger, SelectContent, SelectItem, SelectValue,
  Textarea,
} from "@rootcx/ui";
import type { LineItem } from "../types";
import { computeLineItem, formatCurrency } from "../types";
import { cn } from "@/lib/utils";

const UNITS = ["Each", "Hour", "Day", "Month", "Year", "kg", "g", "L", "m", "m²", "m³"];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialItem: LineItem | null;
  currency: string;
  onSave: (item: LineItem) => void;
}

function buildDefault(): Omit<LineItem, "id"> {
  return {
    product: "",
    description: "",
    quantity: 1,
    unit: "Each",
    unit_price: 0,
    discount: 0,
    tax_rate: 0,
  };
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-medium">
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
      </Label>
      {children}
    </div>
  );
}

export default function LineItemDialog({ open, onOpenChange, initialItem, currency, onSave }: Props) {
  const [form, setForm] = useState<Omit<LineItem, "id">>(buildDefault());
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open) {
      if (initialItem) {
        const { id, ...rest } = initialItem;
        setForm(rest);
      } else {
        setForm(buildDefault());
      }
      setErrors({});
    }
  }, [open, initialItem]);

  const patch = (p: Partial<Omit<LineItem, "id">>) => setForm((f) => ({ ...f, ...p }));

  const { subtotal, total } = computeLineItem({ id: "", ...form });

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.product.trim()) e.product = "Product / Service is required";
    if (form.quantity <= 0) e.quantity = "Quantity must be > 0";
    return e;
  };

  const handleSave = () => {
    const errs = validate();
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    onSave({
      id: initialItem?.id ?? crypto.randomUUID(),
      ...form,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{initialItem ? "Edit Line Item" : "Add Line Item"}</DialogTitle>
          <DialogDescription>
            Fill in the details for this line item.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <Field label="Product / Service" required>
            <Input
              value={form.product}
              onChange={(e) => patch({ product: e.target.value })}
              placeholder="e.g., Website Development"
              className={cn(errors.product && "border-destructive")}
            />
            {errors.product && <p className="text-xs text-destructive">{errors.product}</p>}
          </Field>

          <Field label="Description">
            <Textarea
              value={form.description}
              onChange={(e) => patch({ description: e.target.value })}
              placeholder="Optional description"
              className="min-h-[60px] resize-none text-sm"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Quantity">
              <Input
                type="number"
                min={0}
                step="0.01"
                value={form.quantity}
                onChange={(e) => patch({ quantity: parseFloat(e.target.value) || 0 })}
                className={cn(errors.quantity && "border-destructive")}
              />
              {errors.quantity && <p className="text-xs text-destructive">{errors.quantity}</p>}
            </Field>

            <Field label="Unit">
              <Select value={form.unit} onValueChange={(v) => patch({ unit: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {UNITS.map((u) => (
                    <SelectItem key={u} value={u}>{u}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <Field label={`Unit Price (${currency})`}>
            <Input
              type="number"
              min={0}
              step="0.01"
              value={form.unit_price}
              onChange={(e) => patch({ unit_price: parseFloat(e.target.value) || 0 })}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Discount (%)">
              <Input
                type="number"
                min={0}
                max={100}
                step="0.01"
                value={form.discount}
                onChange={(e) => patch({ discount: parseFloat(e.target.value) || 0 })}
              />
            </Field>

            <Field label="Tax Rate (%)">
              <Input
                type="number"
                min={0}
                max={100}
                step="0.01"
                value={form.tax_rate}
                onChange={(e) => patch({ tax_rate: parseFloat(e.target.value) || 0 })}
              />
            </Field>
          </div>

          <Separator />

          <div className="space-y-1 text-sm">
            <div className="flex justify-between text-muted-foreground">
              <span>Subtotal:</span>
              <span className="font-mono font-medium">{formatCurrency(subtotal, currency)}</span>
            </div>
            <div className="flex justify-between font-semibold">
              <span>Total:</span>
              <span className="font-mono">{formatCurrency(total, currency)}</span>
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
