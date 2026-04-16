import { pdf } from "@react-pdf/renderer";
import type { Invoice, SellerSettings } from "../types";
import { invoicePdfFilename } from "../types";
import InvoicePdfDocument from "@shared/InvoicePdfDocument";

export async function downloadInvoicePdf(invoice: Invoice, seller: SellerSettings | undefined) {
  const blob = await pdf(<InvoicePdfDocument invoice={invoice} seller={seller} />).toBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = invoicePdfFilename(invoice);
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
