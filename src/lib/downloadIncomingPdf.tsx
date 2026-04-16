import { pdf } from "@react-pdf/renderer";
import InvoicePdfDocument from "@shared/InvoicePdfDocument";
import type { IncomingPdfData } from "@shared/incoming-types";
import { triggerBlobDownload } from "./triggerBlobDownload";

export async function downloadIncomingPdf(data: IncomingPdfData, filename: string) {
  const blob = await pdf(
    <InvoicePdfDocument
      invoice={data.invoice}
      seller={data.seller}
      documentTitle={data.documentTitle}
      paymentInfo={data.paymentInfo}
      footerText={data.footerText}
    />,
  ).toBlob();
  triggerBlobDownload(blob, filename);
}
