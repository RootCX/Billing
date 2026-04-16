import { useState, useEffect } from "react";
import { PDFViewer } from "@react-pdf/renderer";
import { useIntegration } from "@rootcx/sdk";
import type { IncomingDocument } from "../types";
import type { ParsedUbl } from "@shared/incoming-types";
import { ublToIncomingPdfData } from "@shared/incoming-types";
import InvoicePdfDocument from "@shared/InvoicePdfDocument";

interface Props {
  doc: IncomingDocument;
}

export default function IncomingPdfPreview({ doc }: Props) {
  const { call } = useIntegration("peppol");
  const [pdfData, setPdfData] = useState<ReturnType<typeof ublToIncomingPdfData> | null>(null);

  useEffect(() => {
    if (!doc.xml) return;
    setPdfData(null);
    call("parse_ubl", { xml: doc.xml })
      .then((ubl) => setPdfData(ublToIncomingPdfData(ubl as ParsedUbl, doc)))
      .catch(() => setPdfData(null));
  }, [doc.xml, doc.id, call]);

  if (!pdfData) {
    return <div className="flex items-center justify-center h-full text-muted-foreground text-sm">Parsing document…</div>;
  }

  return (
    <PDFViewer width="100%" height="100%" showToolbar={false} style={{ border: "none", borderRadius: 8 }}>
      <InvoicePdfDocument
        invoice={pdfData.invoice}
        seller={pdfData.seller}
        documentTitle={pdfData.documentTitle}
        paymentInfo={pdfData.paymentInfo}
        footerText={pdfData.footerText}
      />
    </PDFViewer>
  );
}
