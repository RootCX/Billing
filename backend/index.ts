import postgres from "postgres";
import JSZip from "jszip";
import { renderInvoicePdf, invoicePdfFilename, type Invoice, type SellerSettings } from "./pdf/renderInvoicePdf.tsx";
import { ublToIncomingPdfData, type ParsedUbl } from "./shared/incoming-types";

const APP_ID = "billing";
const PEPPOL_APP_ID = "peppol";
const MAX_EXPORT = 5000;
const MAX_ZIP_SIZE_BYTES = 250 * 1024 * 1024;

let sql: ReturnType<typeof postgres>;
let runtimeUrl = "";

serve({
  onStart(ctx: any) {
    sql = postgres(ctx.databaseUrl);
    runtimeUrl = ctx.runtimeUrl;
  },
  rpc: {
    next_invoice_number: (params: any) => nextInvoiceNumber(params),
    start_export: (params: any, caller: any) =>
      startGenericExport(params, caller, {
        queryApp: APP_ID, queryCollection: "invoice", exportCollection: "invoice_export",
        jobType: "run_export", defaultOrderBy: "invoice_date", label: "invoices",
      }),
    start_incoming_export: (params: any, caller: any) =>
      startGenericExport(params, caller, {
        queryApp: PEPPOL_APP_ID, queryCollection: "incoming_documents", exportCollection: "incoming_export",
        jobType: "run_incoming_export", defaultOrderBy: "issue_date", label: "documents",
      }),
  },
  onJob: (payload: any, caller: any) => runJob(payload, caller),
});

async function nextInvoiceNumber({ prefix = "INV" }: { prefix?: string }) {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const result = await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${"inv_seq_" + prefix + today}))`;
    return tx`
      SELECT COALESCE(MAX(CAST(SPLIT_PART(invoice_number, '-', 3) AS INTEGER)), 0) + 1 AS next_num
      FROM "billing"."invoice"
      WHERE invoice_number LIKE ${prefix + "-" + today + "-%"}
    `;
  });
  return { invoice_number: `${prefix}-${today}-${String(result[0].next_num).padStart(3, "0")}` };
}

async function api(method: string, path: string, token: string, body?: unknown): Promise<any> {
  const res = await fetch(`${runtimeUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function apiBinary(path: string, token: string): Promise<Buffer> {
  const res = await fetch(`${runtimeUrl}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

interface ExportDef {
  queryApp: string;
  queryCollection: string;
  exportCollection: string;
  jobType: string;
  defaultOrderBy: string;
  label: string;
}

interface StartExportParams {
  where?: unknown;
  orderBy?: string;
  order?: "asc" | "desc";
}

async function startGenericExport(params: StartExportParams, caller: any, def: ExportDef) {
  const token: string = caller?.authToken;
  if (!token) throw new Error("Not authenticated");

  const { where, orderBy = def.defaultOrderBy, order = "desc" } = params ?? {};

  const countProbe = await api(
    "POST",
    `/api/v1/apps/${def.queryApp}/collections/${def.queryCollection}/query`,
    token,
    { ...(where ? { where } : {}), limit: 1, offset: 0 },
  );
  const total: number = Number(countProbe?.total ?? 0);

  if (total === 0) throw new Error(`No ${def.label} match the current filter`);
  if (total > MAX_EXPORT) {
    throw new Error(`Export too large: ${total} ${def.label} (max ${MAX_EXPORT}). Please narrow the filter.`);
  }

  const exportRec = await api(
    "POST",
    `/api/v1/apps/${APP_ID}/collections/${def.exportCollection}`,
    token,
    {
      status: "pending",
      filter: { where: where ?? null, orderBy, order },
      total_count: total,
      generated_count: 0,
      file_name: "",
      file_data: "",
      file_size: 0,
      error_message: "",
    },
  );

  const { job_id } = await api(
    "POST",
    `/api/v1/apps/${APP_ID}/jobs`,
    token,
    { payload: { type: def.jobType, export_id: exportRec.id, where, orderBy, order } },
  );

  return { export_id: exportRec.id, job_id, total_count: total };
}

async function runJob(payload: any, caller: any) {
  switch (payload?.type) {
    case "run_export": return runExport(payload, caller);
    case "run_incoming_export": return runIncomingExport(payload, caller);
    default: throw new Error(`unknown job type: ${payload?.type}`);
  }
}

interface RunExportPayload {
  export_id: string;
  where?: unknown;
  orderBy?: string;
  order?: "asc" | "desc";
}

type ItemRenderer = (item: any, token: string) => Promise<{ fileName: string; pdfBuf: Buffer } | null>;

async function runGenericExport(
  payload: RunExportPayload,
  caller: any,
  opts: { exportCollection: string; queryApp: string; queryCollection: string; batchSize: number; zipPrefix: string; defaultOrderBy: string; progressInterval: number },
  renderItem: ItemRenderer,
) {
  const token: string = caller?.authToken;
  if (!token) throw new Error("Not authenticated");

  const { export_id: exportId, where, orderBy = opts.defaultOrderBy, order = "desc" } = payload;

  const patchExport = (fields: Record<string, unknown>) =>
    api("PATCH", `/api/v1/apps/${APP_ID}/collections/${opts.exportCollection}/${exportId}`, token, fields)
      .catch((e) => log.warn(`patch ${opts.exportCollection}: ${e.message}`));

  try {
    await patchExport({ status: "running" });

    const zip = new JSZip();
    const usedNames = new Set<string>();
    let generated = 0;
    let offset = 0;
    let done = false;

    while (!done) {
      const batch = await api(
        "POST",
        `/api/v1/apps/${opts.queryApp}/collections/${opts.queryCollection}/query`,
        token,
        { ...(where ? { where } : {}), orderBy, order, limit: opts.batchSize, offset },
      );
      const items: any[] = batch?.data ?? [];
      if (items.length === 0) break;

      for (const item of items) {
        if (generated >= MAX_EXPORT) { done = true; break; }

        try {
          const result = await renderItem(item, token);
          if (!result) continue;

          let { fileName } = result;
          if (usedNames.has(fileName)) {
            const base = fileName.replace(/\.pdf$/i, "");
            fileName = `${base}_${item.id.slice(0, 8)}.pdf`;
          }
          usedNames.add(fileName);
          zip.file(fileName, result.pdfBuf);
        } catch (e: any) {
          log.warn(`${opts.zipPrefix} ${item.invoice_number || item.document_number || item.id}: ${e.message}`);
        }

        generated++;
        if (generated % opts.progressInterval === 0) await patchExport({ generated_count: generated });
      }

      if (items.length < opts.batchSize) break;
      offset += opts.batchSize;
    }

    await patchExport({ generated_count: generated });

    const zipBuf: Buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
    if (zipBuf.byteLength > MAX_ZIP_SIZE_BYTES) {
      throw new Error(`ZIP too large (${(zipBuf.byteLength / 1024 / 1024).toFixed(1)} MB). Narrow the filter.`);
    }

    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const fileName = `${opts.zipPrefix}_${stamp}.zip`;
    const fileData = `data:application/zip;base64,${zipBuf.toString("base64")}`;

    await patchExport({
      status: "completed",
      generated_count: generated,
      file_name: fileName,
      file_data: fileData,
      file_size: zipBuf.byteLength,
    });

    return { export_id: exportId, generated, file_size: zipBuf.byteLength };
  } catch (e: any) {
    await patchExport({ status: "failed", error_message: String(e?.message ?? e) }).catch(() => {});
    throw e;
  }
}

async function runExport(payload: RunExportPayload, caller: any) {
  const token: string = caller?.authToken;
  if (!token) throw new Error("Not authenticated");

  const sellerRes = await api("GET", `/api/v1/apps/${APP_ID}/collections/seller_settings`, token);
  const seller: SellerSettings | undefined = Array.isArray(sellerRes) ? sellerRes[0] : sellerRes?.data?.[0];

  return runGenericExport(
    payload, caller,
    { exportCollection: "invoice_export", queryApp: APP_ID, queryCollection: "invoice", batchSize: 500, zipPrefix: "invoices", defaultOrderBy: "invoice_date", progressInterval: 50 },
    async (inv) => ({
      fileName: invoicePdfFilename(inv),
      pdfBuf: await renderInvoicePdf(inv, seller),
    }),
  );
}

async function runIncomingExport(payload: RunExportPayload, caller: any) {
  const token: string = caller?.authToken;

  return runGenericExport(
    payload, caller,
    { exportCollection: "incoming_export", queryApp: PEPPOL_APP_ID, queryCollection: "incoming_documents", batchSize: 50, zipPrefix: "incoming", defaultOrderBy: "issue_date", progressInterval: 10 },
    async (doc, tok) => {
      const pdfAttachment = (doc.attachments ?? []).find(
        (a: any) => a.mimeCode === "application/pdf" && a.fileId,
      );

      const baseName = (doc.document_number || doc.id).replace(/[^A-Za-z0-9._-]+/g, "_");
      let pdfBuf: Buffer;

      if (pdfAttachment) {
        pdfBuf = await apiBinary(`/api/v1/apps/${PEPPOL_APP_ID}/storage/${pdfAttachment.fileId}`, tok);
      } else if (doc.xml) {
        const xml = stripEmbeddedBinaries(doc.xml);
        const ubl: ParsedUbl = await api(
          "POST",
          `/api/v1/integrations/${PEPPOL_APP_ID}/actions/parse_ubl`,
          tok,
          { xml },
        );
        const data = ublToIncomingPdfData(ubl, doc);
        pdfBuf = await renderInvoicePdf(data.invoice, data.seller);
      } else {
        return null;
      }

      return { fileName: `${baseName}.pdf`, pdfBuf };
    },
  );
}

function stripEmbeddedBinaries(xml: string): string {
  return xml.replace(
    /(<(?:[a-z0-9]+:)?EmbeddedDocumentBinaryObject[^>]*>)[^<]*/gi,
    "$1",
  );
}
