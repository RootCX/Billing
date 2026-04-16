import { useState } from "react";
import type { WhereClause } from "@rootcx/sdk";
import {
  Button, Input,
  Popover, PopoverTrigger, PopoverContent,
  ScrollArea,
} from "@rootcx/ui";
import { IconX, IconSearch, IconFilter, IconCheck } from "@tabler/icons-react";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

export type FieldType = "enum" | "text" | "date" | "number";

export interface FieldDef {
  key:      string;
  label:    string;
  type:     FieldType;
  options?: { value: string; label: string; color?: string }[];
}

export type OpKey =
  | "$in" | "$nin"
  | "$ilike" | "$not_ilike" | "$eq" | "$ne" | "$isNull" | "$isNotNull"
  | "$eq_date" | "$ne_date" | "$gt" | "$gte" | "$lt" | "$lte"
  | "$between";

export interface OpDef { key: OpKey; label: string; inputType: "none" | "single" | "multi" | "range" }

export interface Condition {
  id:    string;
  field: string;
  op:    OpKey;
  value: string;
}

// ─── Operators ────────────────────────────────────────────────────────────────

const OPS_ENUM: OpDef[] = [
  { key: "$in",        label: "is",           inputType: "multi"  },
  { key: "$nin",       label: "is not",       inputType: "multi"  },
  { key: "$isNull",    label: "is empty",     inputType: "none"   },
  { key: "$isNotNull", label: "is not empty", inputType: "none"   },
];
const OPS_TEXT: OpDef[] = [
  { key: "$ilike",     label: "contains",        inputType: "single" },
  { key: "$not_ilike", label: "doesn't contain", inputType: "single" },
  { key: "$eq",        label: "is exactly",      inputType: "single" },
  { key: "$ne",        label: "is not",          inputType: "single" },
  { key: "$isNull",    label: "is empty",        inputType: "none"   },
  { key: "$isNotNull", label: "is not empty",    inputType: "none"   },
];
const OPS_DATE: OpDef[] = [
  { key: "$between",   label: "is between", inputType: "range"  },
  { key: "$gte",       label: "is after",   inputType: "single" },
  { key: "$lte",       label: "is before",  inputType: "single" },
  { key: "$eq_date",   label: "is exactly", inputType: "single" },
  { key: "$isNull",    label: "is empty",   inputType: "none"   },
  { key: "$isNotNull", label: "is not empty", inputType: "none" },
];
const OPS_NUMBER: OpDef[] = [
  { key: "$between",   label: "is between", inputType: "range"  },
  { key: "$gte",       label: "≥",          inputType: "single" },
  { key: "$lte",       label: "≤",          inputType: "single" },
  { key: "$gt",        label: ">",          inputType: "single" },
  { key: "$lt",        label: "<",          inputType: "single" },
  { key: "$eq",        label: "=",          inputType: "single" },
  { key: "$ne",        label: "≠",          inputType: "single" },
  { key: "$isNull",    label: "is empty",   inputType: "none"   },
  { key: "$isNotNull", label: "is not empty", inputType: "none" },
];

export function opsForType(type: FieldType): OpDef[] {
  switch (type) {
    case "enum":   return OPS_ENUM;
    case "text":   return OPS_TEXT;
    case "date":   return OPS_DATE;
    case "number": return OPS_NUMBER;
  }
}

export function defaultOp(type: FieldType): OpKey {
  switch (type) {
    case "enum":   return "$in";
    case "text":   return "$ilike";
    case "date":   return "$between";
    case "number": return "$between";
  }
}

export function makeConditionId() { return Math.random().toString(36).slice(2); }

// ─── conditionToWhereClause ───────────────────────────────────────────────────

export function conditionToWhereClause(cond: Condition, fieldDefs: FieldDef[]): WhereClause | null {
  const { field, op, value } = cond;

  if (op === "$isNull")    return { [field]: { $isNull: true  } };
  if (op === "$isNotNull") return { [field]: { $isNull: false } };

  if (op === "$in" || op === "$nin") {
    const arr: string[] = JSON.parse(value || "[]");
    if (!arr.length) return null;
    return { [field]: { [op]: arr } };
  }

  if (op === "$between") {
    let lo: string, hi: string;
    try { [lo, hi] = JSON.parse(value || "[]"); } catch { return null; }
    if (!lo && !hi) return null;
    const clauses: WhereClause[] = [];
    if (lo) clauses.push({ [field]: { $gte: lo } });
    if (hi) clauses.push({ [field]: { $lte: hi } });
    if (clauses.length === 1) return clauses[0];
    return { $and: clauses };
  }

  if (op === "$not_ilike") {
    if (!value) return null;
    return { $not: { [field]: { $ilike: `%${value}%` } } };
  }

  if (op === "$ilike") {
    if (!value) return null;
    return { [field]: { $ilike: `%${value}%` } };
  }

  if (op === "$eq_date") {
    if (!value) return null;
    return { [field]: { $eq: value } };
  }

  if (!value) return null;
  const fieldDef = fieldDefs.find(f => f.key === field);
  const coerced = fieldDef?.type === "number" ? Number(value) : value;
  return { [field]: { [op]: coerced } };
}

// ─── summariseCondition ───────────────────────────────────────────────────────

export function summariseCondition(cond: Condition, fieldDefs: FieldDef[]): string {
  const field   = fieldDefs.find(f => f.key === cond.field);
  const op      = opsForType(field?.type ?? "text").find(o => o.key === cond.op);
  const opLabel = op?.label ?? cond.op;

  if (cond.op === "$isNull" || cond.op === "$isNotNull") return opLabel;

  if (cond.op === "$in" || cond.op === "$nin") {
    const arr: string[] = JSON.parse(cond.value || "[]");
    if (!arr.length) return opLabel;
    const labels = arr.map(v => field?.options?.find(o => o.value === v)?.label ?? v);
    return `${opLabel} ${labels.length === 1 ? labels[0] : labels.slice(0, 2).join(", ") + (labels.length > 2 ? ` +${labels.length - 2}` : "")}`;
  }

  if (cond.op === "$between") {
    let lo = "", hi = "";
    try { [lo, hi] = JSON.parse(cond.value || "[]"); } catch {}
    if (lo && hi) return `${lo} → ${hi}`;
    if (lo) return `after ${lo}`;
    if (hi) return `before ${hi}`;
    return opLabel;
  }

  return `${opLabel} ${cond.value}`;
}

// ─── FilterBar ────────────────────────────────────────────────────────────────

interface FilterBarProps {
  fieldDefs:    FieldDef[];
  conditions:   Condition[];
  search:       string;
  onSearch:     (v: string) => void;
  onAdd:        (cond: Condition) => void;
  onUpdate:     (id: string, patch: Partial<Omit<Condition, "id">>) => void;
  onRemove:     (id: string) => void;
  onClearAll:   () => void;
  searchPlaceholder?: string;
  totalLabel?:  string; // e.g. "26 invoices"
}

export function FilterBar({
  fieldDefs, conditions, search, onSearch,
  onAdd, onUpdate, onRemove, onClearAll,
  searchPlaceholder = "Search…", totalLabel,
}: FilterBarProps) {
  const [openId, setOpenId]   = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const hasAny = conditions.length > 0 || !!search;

  const handleAdd = (fieldKey: string) => {
    const field   = fieldDefs.find(f => f.key === fieldKey)!;
    const op      = defaultOp(field.type);
    const defaultValue = op === "$in" || op === "$nin" || op === "$between" ? "[]" : "";
    const id = makeConditionId();
    onAdd({ id, field: fieldKey, op, value: defaultValue });
    setAddOpen(false);
    setTimeout(() => setOpenId(id), 50);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">

        {/* Search */}
        <div className="relative shrink-0">
          <IconSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <input
            value={search}
            onChange={e => onSearch(e.target.value)}
            placeholder={searchPlaceholder}
            className={cn(
              "h-8 w-52 rounded-md border border-input bg-background pl-8 pr-7 text-sm",
              "placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring",
            )}
          />
          {search && (
            <button
              onClick={() => onSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            >
              <IconX className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Active condition pills */}
        {conditions.map(cond => {
          const fieldDef = fieldDefs.find(f => f.key === cond.field)!;
          const summary  = summariseCondition(cond, fieldDefs);
          const isOpen   = openId === cond.id;

          return (
            <Popover key={cond.id} open={isOpen} onOpenChange={o => setOpenId(o ? cond.id : null)}>
              <PopoverTrigger asChild>
                <button className={cn(
                  "inline-flex h-8 max-w-[280px] items-center gap-1 rounded-md border px-2.5 text-sm transition-all",
                  "focus:outline-none focus:ring-2 focus:ring-ring",
                  "border-primary/30 bg-primary/5 text-foreground font-medium",
                )}>
                  <span className="text-muted-foreground shrink-0 text-xs">{fieldDef.label}</span>
                  <span className="text-muted-foreground/50 shrink-0">·</span>
                  <span className="text-primary truncate text-xs">{summary}</span>
                  <button
                    onClick={e => { e.stopPropagation(); onRemove(cond.id); }}
                    className="ml-1 shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  >
                    <IconX className="h-3 w-3" />
                  </button>
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="p-0 w-auto" sideOffset={6}>
                <ConditionEditor
                  condition={cond}
                  fieldDef={fieldDef}
                  fieldDefs={fieldDefs}
                  onChange={patch => onUpdate(cond.id, patch)}
                  onRemove={() => { onRemove(cond.id); setOpenId(null); }}
                />
              </PopoverContent>
            </Popover>
          );
        })}

        {/* + Filter */}
        <Popover open={addOpen} onOpenChange={setAddOpen}>
          <PopoverTrigger asChild>
            <button className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-sm transition-all",
              "border-border bg-background text-muted-foreground hover:text-foreground hover:bg-muted/50",
              "focus:outline-none focus:ring-2 focus:ring-ring",
            )}>
              <IconFilter className="h-3.5 w-3.5" />
              <span>Filter</span>
              {conditions.length > 0 && (
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">
                  {conditions.length}
                </span>
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="p-0 w-52" sideOffset={6}>
            <FieldPicker fieldDefs={fieldDefs} onPick={handleAdd} />
          </PopoverContent>
        </Popover>

        {/* Clear all */}
        {hasAny && (
          <>
            <div className="h-5 w-px bg-border shrink-0" />
            <button
              onClick={onClearAll}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0"
            >
              <IconX className="h-3 w-3" />
              Clear all
            </button>
          </>
        )}
      </div>

      {/* Result count */}
      {totalLabel && (
        <p className="text-xs text-muted-foreground">{totalLabel}</p>
      )}
    </div>
  );
}

// ─── FieldPicker ──────────────────────────────────────────────────────────────

function FieldPicker({ fieldDefs, onPick }: { fieldDefs: FieldDef[]; onPick: (key: string) => void }) {
  const [q, setQ] = useState("");
  const filtered  = fieldDefs.filter(f => f.label.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="flex flex-col">
      <div className="p-2 border-b">
        <div className="relative">
          <IconSearch className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <input
            autoFocus
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Filter properties…"
            className="h-7 w-full rounded border border-input bg-background pl-7 pr-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      </div>
      <ScrollArea className="max-h-72 overflow-y-auto">
        <div className="py-1">
          {filtered.map(f => (
            <button
              key={f.key}
              onClick={() => onPick(f.key)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-muted transition-colors text-left"
            >
              <span className="flex-1">{f.label}</span>
              <span className="text-[10px] text-muted-foreground/50 uppercase tracking-wide">{f.type}</span>
            </button>
          ))}
          {filtered.length === 0 && (
            <p className="px-3 py-2 text-sm text-muted-foreground">No properties found</p>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

// ─── ConditionEditor ──────────────────────────────────────────────────────────

function ConditionEditor({
  condition, fieldDef, fieldDefs, onChange, onRemove,
}: {
  condition: Condition;
  fieldDef:  FieldDef;
  fieldDefs: FieldDef[];
  onChange:  (patch: Partial<Omit<Condition, "id">>) => void;
  onRemove:  () => void;
}) {
  const ops       = opsForType(fieldDef.type);
  const currentOp = ops.find(o => o.key === condition.op) ?? ops[0];

  const changeOp = (opKey: OpKey) => {
    const newOp      = ops.find(o => o.key === opKey)!;
    const defaultVal = newOp.inputType === "multi" || newOp.inputType === "range" ? "[]" : "";
    onChange({ op: opKey, value: defaultVal });
  };

  return (
    <div className="w-72">
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <span className="text-sm font-medium">{fieldDef.label}</span>
        <button onClick={onRemove} className="text-muted-foreground hover:text-destructive transition-colors rounded p-0.5 hover:bg-muted">
          <IconX className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="px-3 pt-2.5 pb-1">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-1.5">Operator</p>
        <div className="flex flex-wrap gap-1">
          {ops.map(op => (
            <button
              key={op.key}
              onClick={() => changeOp(op.key)}
              className={cn(
                "inline-flex items-center rounded border px-2 py-0.5 text-xs transition-colors",
                condition.op === op.key
                  ? "border-primary bg-primary text-primary-foreground font-medium"
                  : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {op.label}
            </button>
          ))}
        </div>
      </div>
      {currentOp.inputType !== "none" && (
        <div className="px-3 pb-3 pt-2">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-1.5">Value</p>
          <ConditionValueInput condition={condition} fieldDef={fieldDef} op={currentOp} onChange={onChange} />
        </div>
      )}
    </div>
  );
}

// ─── ConditionValueInput ──────────────────────────────────────────────────────

function ConditionValueInput({
  condition, fieldDef, op, onChange,
}: {
  condition: Condition;
  fieldDef:  FieldDef;
  op:        OpDef;
  onChange:  (patch: Partial<Omit<Condition, "id">>) => void;
}) {
  if (op.inputType === "multi" && fieldDef.options) {
    const selected: string[] = JSON.parse(condition.value || "[]");
    const toggle = (v: string) => {
      const next = selected.includes(v) ? selected.filter(x => x !== v) : [...selected, v];
      onChange({ value: JSON.stringify(next) });
    };
    return (
      <div className="space-y-0.5">
        {fieldDef.options.map(opt => {
          const on = selected.includes(opt.value);
          return (
            <button
              key={opt.value}
              onClick={() => toggle(opt.value)}
              className={cn(
                "w-full flex items-center gap-2 rounded px-2 py-1.5 text-sm transition-colors text-left",
                on ? "bg-primary/8 text-foreground" : "hover:bg-muted text-muted-foreground hover:text-foreground",
              )}
            >
              <span className={cn(
                "flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
                on ? "border-primary bg-primary text-primary-foreground" : "border-border",
              )}>
                {on && <IconCheck className="h-2.5 w-2.5" />}
              </span>
              {opt.color && <span className={cn("h-2 w-2 rounded-full shrink-0", opt.color)} />}
              <span className="flex-1">{opt.label}</span>
            </button>
          );
        })}
      </div>
    );
  }

  if (op.inputType === "range") {
    let lo = "", hi = "";
    try { [lo, hi] = JSON.parse(condition.value || "[]"); } catch {}
    const set = (newLo: string, newHi: string) => onChange({ value: JSON.stringify([newLo, newHi]) });
    return (
      <div className="flex items-center gap-2">
        <Input type={fieldDef.type === "number" ? "number" : "date"} value={lo}
          onChange={e => set(e.target.value, hi)} placeholder="From" className="h-7 text-sm flex-1" />
        <span className="text-xs text-muted-foreground shrink-0">→</span>
        <Input type={fieldDef.type === "number" ? "number" : "date"} value={hi}
          onChange={e => set(lo, e.target.value)} placeholder="To" className="h-7 text-sm flex-1" />
      </div>
    );
  }

  return (
    <Input
      type={fieldDef.type === "number" ? "number" : fieldDef.type === "date" ? "date" : "text"}
      value={condition.value}
      onChange={e => onChange({ value: e.target.value })}
      placeholder={fieldDef.type === "text" ? "Enter value…" : undefined}
      className="h-7 text-sm w-full"
      autoFocus
    />
  );
}
