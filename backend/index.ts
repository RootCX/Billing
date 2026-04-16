import postgres from "postgres";
import JSZip from "jszip";
import { renderInvoicePdf, invoicePdfFilename, type Invoice, type SellerSettings } from "./pdf/renderInvoicePdf";

const APP_ID = "billing";
const BATCH_SIZE = 500;
const MAX_INVOICES_PER_EXPORT = 5000;
const MAX_ZIP_SIZE_BYTES = 250 * 1024 * 1024; // ~250 MB

let sql: ReturnType<typeof postgres>;
let runtimeUrl = "";

serve({
  onStart(ctx: any) {
    sql = postgres(ctx.databaseUrl);
    runtimeUrl = ctx.runtimeUrl;
  },
  rpc: {
    next_invoice_number: (params: any) => nextInvoiceNumber(params),
    start_export: (params: any, caller: any) => startExport(params, caller),
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

interface StartExportParams {
  where?: unknown;
  orderBy?: string;
  order?: "asc" | "desc";
}

async function startExport(params: StartExportParams, caller: any) {
  const token: string = caller?.authToken;
  if (!token) throw new Error("Not authenticated");

  const { where, orderBy = "invoice_date", order = "desc" } = params ?? {};

  const countProbe = await api(
    "POST",
    `/api/v1/apps/${APP_ID}/collections/invoice/query`,
    token,
    { ...(where ? { where } : {}), limit: 1, offset: 0 },
  );
  const total: number = Number(countProbe?.total ?? 0);

  if (total === 0) throw new Error("No invoices match the current filter");
  if (total > MAX_INVOICES_PER_EXPORT) {
    throw new Error(`Export too large: ${total} invoices (max ${MAX_INVOICES_PER_EXPORT}). Please narrow the filter.`);
  }

  const exportRec = await api(
    "POST",
    `/api/v1/apps/${APP_ID}/collections/invoice_export`,
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
    { payload: { type: "run_export", export_id: exportRec.id, where, orderBy, order } },
  );

  return { export_id: exportRec.id, job_id, total_count: total };
}

async function runJob(payload: any, caller: any) {
  switch (payload?.type) {
    case "run_export": return runExport(payload, caller);
    default: throw new Error(`unknown job type: ${payload?.type}`);
  }
}

interface RunExportPayload {
  export_id: string;
  where?: unknown;
  orderBy?: string;
  order?: "asc" | "desc";
}

async function runExport(payload: RunExportPayload, caller: any) {
  const token: string = caller?.authToken;
  if (!token) throw new Error("Not authenticated");

  const exportId = payload.export_id;
  const where = payload.where;
  const orderBy = payload.orderBy ?? "invoice_date";
  const order = payload.order ?? "desc";

  const patchExport = (fields: Record<string, unknown>) =>
    api("PATCH", `/api/v1/apps/${APP_ID}/collections/invoice_export/${exportId}`, token, fields)
      .catch((e) => log.warn(`patch invoice_export: ${e.message}`));

  try {
    const [, sellerRes] = await Promise.all([
      patchExport({ status: "running" }),
      api("GET", `/api/v1/apps/${APP_ID}/collections/seller_settings`, token),
    ]);
    const seller: SellerSettings | undefined = Array.isArray(sellerRes) ? sellerRes[0] : sellerRes?.data?.[0];

    const zip = new JSZip();
    const usedNames = new Set<string>();
    let generated = 0;
    let offset = 0;
    let done = false;

    while (!done) {
      const batch = await api(
        "POST",
        `/api/v1/apps/${APP_ID}/collections/invoice/query`,
        token,
        { ...(where ? { where } : {}), orderBy, order, limit: BATCH_SIZE, offset },
      );
      const invoices: Invoice[] = batch?.data ?? [];
      if (invoices.length === 0) break;

      for (const inv of invoices) {
        if (generated >= MAX_INVOICES_PER_EXPORT) { done = true; break; }
        let fileName = invoicePdfFilename(inv);
        if (usedNames.has(fileName)) {
          const base = fileName.replace(/\.pdf$/i, "");
          fileName = `${base}_${inv.id.slice(0, 8)}.pdf`;
        }
        usedNames.add(fileName);

        try {
          const pdfBuf = await renderInvoicePdf(inv, seller);
          zip.file(fileName, pdfBuf);
        } catch (e: any) {
          log.warn(`render ${inv.invoice_number}: ${e.message}`);
        }

        generated++;
        if (generated % 50 === 0) await patchExport({ generated_count: generated });
      }

      if (invoices.length < BATCH_SIZE) break;
      offset += BATCH_SIZE;
    }

    await patchExport({ generated_count: generated });

    const zipBuf: Buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
    if (zipBuf.byteLength > MAX_ZIP_SIZE_BYTES) {
      throw new Error(`ZIP too large (${(zipBuf.byteLength / 1024 / 1024).toFixed(1)} MB). Narrow the filter.`);
    }

    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const fileName = `invoices_${stamp}.zip`;
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
