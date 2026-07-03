import { useState, useEffect } from "react";
import { PDFViewer } from "@react-pdf/renderer";
import { useIntegration, useRuntimeClient } from "@rootcx/sdk";
import type { IncomingDocument } from "../types";
import type { ParsedUbl } from "@shared/incoming-types";
import { ublToIncomingPdfData } from "@shared/incoming-types";
import InvoicePdfDocument from "@shared/InvoicePdfDocument";

const PEPPOL_APP_ID = "peppol";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isFileId(value: string): boolean {
  return UUID_RE.test(value);
}

export function getPdfAttachment(doc: IncomingDocument) {
  return doc.attachments?.find((a) => a.mimeCode === "application/pdf" && a.fileId);
}

export function peppolStorageUrl(baseUrl: string, fileId: string) {
  return `${baseUrl}/api/v1/apps/${PEPPOL_APP_ID}/storage/${fileId}`;
}

export function fetchXmlContent(client: { getBaseUrl(): string; getAccessToken(): string }, xmlField: string): Promise<string> {
  if (!isFileId(xmlField)) return Promise.resolve(xmlField);
  return fetch(peppolStorageUrl(client.getBaseUrl(), xmlField), {
    headers: { Authorization: `Bearer ${client.getAccessToken()}` },
  }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`);
    return r.text();
  });
}

interface Props {
  doc: IncomingDocument;
}

export default function IncomingPdfPreview({ doc }: Props) {
  const pdfAttachment = getPdfAttachment(doc);

  if (pdfAttachment) {
    return <EmbeddedPdfPreview fileId={pdfAttachment.fileId} />;
  }

  return <GeneratedPdfPreview doc={doc} />;
}

function EmbeddedPdfPreview({ fileId }: { fileId: string }) {
  const client = useRuntimeClient();
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let url: string | null = null;

    fetch(peppolStorageUrl(client.getBaseUrl(), fileId), {
      headers: { Authorization: `Bearer ${client.getAccessToken()}` },
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status}`);
        return res.blob();
      })
      .then((blob) => {
        url = URL.createObjectURL(blob);
        setBlobUrl(url);
      })
      .catch((e) => { if (e.name !== "AbortError") setError(true); });

    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [fileId, client]);

  if (error) {
    return <div className="flex items-center justify-center h-full text-muted-foreground text-sm">Failed to load PDF attachment</div>;
  }

  if (!blobUrl) {
    return <div className="flex items-center justify-center h-full text-muted-foreground text-sm">Loading PDF…</div>;
  }

  return (
    <iframe
      src={blobUrl}
      width="100%"
      height="100%"
      style={{ border: "none", borderRadius: 8 }}
      title="Attached PDF"
    />
  );
}

function GeneratedPdfPreview({ doc }: { doc: IncomingDocument }) {
  const { call } = useIntegration("peppol");
  const client = useRuntimeClient();
  const [pdfData, setPdfData] = useState<ReturnType<typeof ublToIncomingPdfData> | null>(null);

  useEffect(() => {
    if (!doc.xml) return;
    setPdfData(null);
    fetchXmlContent(client, doc.xml)
      .then((xml) => call("parse_ubl", { xml }))
      .then((ubl) => setPdfData(ublToIncomingPdfData(ubl as ParsedUbl, doc)))
      .catch(() => setPdfData(null));
  }, [doc.xml, doc.id, call, client]);

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
