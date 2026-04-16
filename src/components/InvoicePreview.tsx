import { useState, useEffect } from "react";
import { PDFViewer } from "@react-pdf/renderer";
import { useAppCollection } from "@rootcx/sdk";
import type { Invoice, SellerSettings } from "../types";
import InvoicePdfDocument from "@shared/InvoicePdfDocument";

const APP_ID = "billing";
const DEBOUNCE_MS = 400;

interface Props {
  invoice: Invoice;
}

export default function InvoicePreview({ invoice }: Props) {
  const { data: settings } = useAppCollection<SellerSettings>(APP_ID, "seller_settings");
  const seller = settings?.[0];

  const [debounced, setDebounced] = useState(invoice);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(invoice), DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [invoice]);

  return (
    <div className="max-w-3xl mx-auto h-full min-h-[600px]">
      <PDFViewer width="100%" height="100%" showToolbar={false} style={{ border: "none", borderRadius: 8 }}>
        <InvoicePdfDocument invoice={debounced} seller={seller} />
      </PDFViewer>
    </div>
  );
}
