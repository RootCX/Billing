import { pdf } from "@react-pdf/renderer";
import type { Invoice, SellerSettings } from "../types";
import { invoicePdfFilename } from "../types";
import InvoicePdfDocument from "@shared/InvoicePdfDocument";
import { triggerBlobDownload } from "./triggerBlobDownload";

export async function downloadInvoicePdf(invoice: Invoice, seller: SellerSettings | undefined) {
  const blob = await pdf(<InvoicePdfDocument invoice={invoice} seller={seller} />).toBlob();
  triggerBlobDownload(blob, invoicePdfFilename(invoice));
}
