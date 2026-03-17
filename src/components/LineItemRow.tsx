import { Button } from "@rootcx/ui";
import { IconEdit, IconTrash } from "@tabler/icons-react";
import type { LineItem } from "../types";
import { computeLineItem, formatCurrency } from "../types";

interface Props {
  item: LineItem;
  currency: string;
  onEdit: (item: LineItem) => void;
  onDelete: (id: string) => void;
}

export default function LineItemRow({ item, currency, onEdit, onDelete }: Props) {
  const { subtotal, total } = computeLineItem(item);

  return (
    <div className="border rounded-md p-2.5 bg-background text-xs group hover:border-primary/50 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="font-medium truncate">{item.product}</p>
          {item.description && (
            <p className="text-muted-foreground truncate mt-0.5">{item.description}</p>
          )}
          <p className="text-muted-foreground mt-1">
            {item.quantity} {item.unit} × {formatCurrency(item.unit_price, currency)}
            {item.discount > 0 && ` − ${item.discount}% disc.`}
            {item.tax_rate > 0 && ` + ${item.tax_rate}% tax`}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="font-semibold font-mono">{formatCurrency(total, currency)}</p>
          {item.tax_rate > 0 && (
            <p className="text-muted-foreground font-mono">{formatCurrency(subtotal, currency)} excl.</p>
          )}
        </div>
      </div>
      <div className="flex justify-end gap-1 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onEdit(item)}>
          <IconEdit className="h-3 w-3" />
        </Button>
        <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive hover:text-destructive" onClick={() => onDelete(item.id)}>
          <IconTrash className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}
