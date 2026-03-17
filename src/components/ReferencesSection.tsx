import { useState } from "react";
import {
  Button, Input, Label, Separator,
  Select, SelectTrigger, SelectContent, SelectItem, SelectValue,
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@rootcx/ui";
import { IconPlus, IconTrash } from "@tabler/icons-react";
import type { InvoiceReference, ReferenceType } from "../types";
import { REFERENCE_TYPE_LABELS } from "../types";

interface Props {
  references: InvoiceReference[];
  onChange: (refs: InvoiceReference[]) => void;
}

const REF_TYPES: ReferenceType[] = [
  "purchase_order",
  "contract_number",
  "cost_center",
  "project_reference",
  "custom",
];

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">
      {children}
    </p>
  );
}

export default function ReferencesSection({ references, onChange }: Props) {
  const [addOpen, setAddOpen] = useState(false);
  const [selectedType, setSelectedType] = useState<ReferenceType>("purchase_order");
  const [customLabel, setCustomLabel] = useState("");
  const [customValue, setCustomValue] = useState("");

  const handleAdd = () => {
    if (selectedType === "custom" && !customLabel.trim()) return;
    const label = selectedType === "custom"
      ? customLabel.trim()
      : REFERENCE_TYPE_LABELS[selectedType];
    onChange([
      ...references,
      { id: crypto.randomUUID(), type: selectedType, label, value: customValue.trim() },
    ]);
    setAddOpen(false);
    setSelectedType("purchase_order");
    setCustomLabel("");
    setCustomValue("");
  };

  const updateValue = (id: string, value: string) => {
    onChange(references.map((r) => (r.id === id ? { ...r, value } : r)));
  };

  const remove = (id: string) => {
    onChange(references.filter((r) => r.id !== id));
  };

  return (
    <div>
      <SectionTitle>References</SectionTitle>

      <div className="space-y-2 mb-3">
        {references.map((ref) => (
          <div key={ref.id} className="space-y-1">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-medium text-muted-foreground">{ref.label}</Label>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 text-muted-foreground hover:text-destructive"
                onClick={() => remove(ref.id)}
              >
                <IconTrash className="h-3 w-3" />
              </Button>
            </div>
            <Input
              value={ref.value}
              onChange={(e) => updateValue(ref.id, e.target.value)}
              className="h-7 text-xs"
              placeholder={`Enter ${ref.label.toLowerCase()}…`}
            />
          </div>
        ))}
      </div>

      <Button
        variant="outline"
        size="sm"
        className="w-full text-xs"
        onClick={() => setAddOpen(true)}
      >
        <IconPlus className="h-3.5 w-3.5 mr-2" />
        Add Reference
      </Button>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Add Reference</DialogTitle>
            <DialogDescription>
              Choose a reference type to add to this invoice.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-sm">Reference Type</Label>
              <Select value={selectedType} onValueChange={(v) => setSelectedType(v as ReferenceType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REF_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{REFERENCE_TYPE_LABELS[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedType === "custom" && (
              <div className="space-y-1.5">
                <Label className="text-sm">Field Name</Label>
                <Input
                  value={customLabel}
                  onChange={(e) => setCustomLabel(e.target.value)}
                  placeholder="e.g., Campaign ID"
                />
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-sm">Value</Label>
              <Input
                value={customValue}
                onChange={(e) => setCustomValue(e.target.value)}
                placeholder={selectedType === "custom" ? "Enter value…" : `Enter ${REFERENCE_TYPE_LABELS[selectedType].toLowerCase()}…`}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button
              onClick={handleAdd}
              disabled={selectedType === "custom" && !customLabel.trim()}
            >
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
