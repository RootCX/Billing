import { renderToBuffer } from "@react-pdf/renderer";
import InvoicePdfDocument from "../shared/InvoicePdfDocument";

export type { Invoice, SellerSettings } from "../shared/invoice-types";
export { invoicePdfFilename } from "../shared/invoice-types";

export async function renderInvoicePdf(
  invoice: Parameters<typeof InvoicePdfDocument>[0]["invoice"],
  seller: Parameters<typeof InvoicePdfDocument>[0]["seller"],
): Promise<Buffer> {
  return renderToBuffer(
    <InvoicePdfDocument invoice={invoice} seller={seller} />,
  ) as Promise<Buffer>;
}
