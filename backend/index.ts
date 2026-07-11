import JSZip from "jszip";
import { renderInvoicePdf, invoicePdfFilename, type Invoice, type SellerSettings } from "./pdf/renderInvoicePdf.tsx";
import { ublToIncomingPdfData, type ParsedUbl } from "./shared/incoming-types";

const APP_ID = "billing";
const PEPPOL_APP_ID = "peppol";
const MAX_EXPORT = 5000;
const MAX_ZIP_SIZE_BYTES = 250 * 1024 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let runtimeUrl = "";

serve({
  onStart(ctx: any) {
    runtimeUrl = ctx.runtimeUrl;
  },
  rpc: {
    next_invoice_number: (params: any, _caller: any, ctx: any) => nextInvoiceNumber(params, ctx),
    start_export: (params: any, caller: any, ctx: any) =>
      startGenericExport(params, caller, ctx, {
        queryApp: APP_ID, queryCollection: "invoice", exportCollection: "invoice_export",
        jobType: "run_export", defaultOrderBy: "invoice_date", label: "invoices",
      }),
    start_incoming_export: (params: any, caller: any, ctx: any) =>
      startGenericExport(params, caller, ctx, {
        queryApp: PEPPOL_APP_ID, queryCollection: "incoming_documents", exportCollection: "incoming_export",
        jobType: "run_incoming_export", defaultOrderBy: "issue_date", label: "documents",
      }),
  },
  onJob: (payload: any, caller: any, ctx: any) => runJob(payload, caller, ctx),
});

async function nextInvoiceNumber({ prefix = "INV" }: { prefix?: string }, ctx: any) {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const like = `${prefix}-${today}-%`;
  const result = await ctx.sql(
    `SELECT COALESCE(MAX(CAST(SPLIT_PART(invoice_number, '-', 3) AS INTEGER)), 0) + 1 AS next_num
       FROM "billing"."invoice"
      WHERE invoice_number LIKE $1`,
    [like],
  );
  const nextNum = Number(result?.rows?.[0]?.[0] ?? 1);
  return { invoice_number: `${prefix}-${today}-${String(nextNum).padStart(3, "0")}` };
}

// ─── Legacy REST helpers (Core <v0.20, caller.authToken available) ───────────

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

function isFileId(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

async function downloadStorageFile(
  appId: string,
  fileId: string,
  token: string | undefined,
  ctx: any,
): Promise<{ name?: string; contentType?: string; content: Buffer }> {
  if (token) {
    return {
      content: await apiBinary(`/api/v1/apps/${appId}/storage/${fileId}`, token),
    };
  }

  if (typeof ctx?.downloadFile !== "function") {
    throw new Error("storage download is not available in this RootCX worker");
  }

  const file = await ctx.downloadFile(appId, fileId);
  return {
    name: file?.name,
    contentType: file?.contentType,
    content: Buffer.from(file?.content ?? []),
  };
}

async function resolveXml(xmlField: unknown, token: string | undefined, ctx: any): Promise<string> {
  if (typeof xmlField !== "string" || !xmlField) {
    throw new Error("missing XML");
  }
  if (!isFileId(xmlField)) {
    return xmlField;
  }
  const file = await downloadStorageFile(PEPPOL_APP_ID, xmlField, token, ctx);
  return file.content.toString("utf8");
}

// ─── v2 IPC helpers (Core v0.20+, no token — uses ctx.sql) ──────────────────

function escapeIdent(s: string): string {
  return `"${s.replace(/"/g, '""')}"`;
}

function buildWhereSql(where: any, params: unknown[]): string {
  if (!where || typeof where !== "object") return "TRUE";

  const parts: string[] = [];

  for (const [key, val] of Object.entries(where)) {
    if (key === "$and") {
      const subs = (val as any[]).map(sub => buildWhereSql(sub, params));
      parts.push(`(${subs.join(" AND ")})`);
    } else if (key === "$or") {
      const subs = (val as any[]).map(sub => buildWhereSql(sub, params));
      parts.push(`(${subs.join(" OR ")})`);
    } else if (key === "$not") {
      parts.push(`NOT (${buildWhereSql(val, params)})`);
    } else {
      buildFieldCondition(escapeIdent(key), val, params, parts);
    }
  }

  return parts.length === 0 ? "TRUE" : parts.join(" AND ");
}

function buildFieldCondition(col: string, val: unknown, params: unknown[], parts: string[]) {
  if (val === null || val === undefined) {
    parts.push(`${col} IS NULL`);
    return;
  }
  if (typeof val !== "object") {
    params.push(val);
    parts.push(`${col} = $${params.length}`);
    return;
  }
  if (!Object.keys(val as object).some(k => k.startsWith("$"))) {
    params.push(JSON.stringify(val));
    parts.push(`${col} = $${params.length}::jsonb`);
    return;
  }

  for (const [op, operand] of Object.entries(val as Record<string, unknown>)) {
    switch (op) {
      case "$eq":
        if (operand === null) parts.push(`${col} IS NULL`);
        else { params.push(operand); parts.push(`${col} = $${params.length}`); }
        break;
      case "$ne":
        if (operand === null) parts.push(`${col} IS NOT NULL`);
        else { params.push(operand); parts.push(`${col} != $${params.length}`); }
        break;
      case "$gt": case "$gte": case "$lt": case "$lte":
      case "$like": case "$ilike": {
        const sqlOp: Record<string, string> = { $gt: ">", $gte: ">=", $lt: "<", $lte: "<=", $like: "LIKE", $ilike: "ILIKE" };
        params.push(operand);
        parts.push(`${col} ${sqlOp[op]} $${params.length}`);
        break;
      }
      case "$in": case "$nin": {
        const arr = operand as unknown[];
        if (arr.length === 0) { parts.push(op === "$in" ? "FALSE" : "TRUE"); break; }
        const kw = op === "$in" ? "IN" : "NOT IN";
        const phs = arr.map(v => { params.push(v); return `$${params.length}`; });
        parts.push(`${col} ${kw} (${phs.join(", ")})`);
        break;
      }
      case "$contains": {
        const arr = operand as unknown[];
        if (arr.length > 0) {
          params.push(JSON.stringify(operand));
          parts.push(`${col} @> $${params.length}::jsonb`);
        }
        break;
      }
      case "$isNull":
        parts.push((operand as boolean) ? `${col} IS NULL` : `${col} IS NOT NULL`);
        break;
    }
  }
}

const SAFE_IDENT = /^[a-z_][a-z0-9_]*$/;
function safeSortField(field: string | undefined): string {
  if (!field || !SAFE_IDENT.test(field)) return '"created_at"';
  return escapeIdent(field);
}

async function sqlQuery(
  ctx: any, app: string, entity: string,
  opts: { where?: any; orderBy?: string; order?: "asc" | "desc"; limit?: number; offset?: number },
): Promise<{ data: any[]; total: number }> {
  const tbl = `${escapeIdent(app)}.${escapeIdent(entity)}`;
  const params: unknown[] = [];
  const whereSql = buildWhereSql(opts.where, params);
  const whereClause = whereSql === "TRUE" ? "" : ` WHERE ${whereSql}`;
  const sort = safeSortField(opts.orderBy);
  const order = opts.order === "asc" ? "ASC" : "DESC";
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 1000);
  const offset = Math.max(opts.offset ?? 0, 0);

  const q = `SELECT to_jsonb(t.*) AS row, COUNT(*) OVER() AS total FROM ${tbl} t${whereClause} ORDER BY t.${sort} ${order}, t.id ASC LIMIT ${limit} OFFSET ${offset}`;
  const result = await ctx.sql(q, params);
  const rows: any[] = result?.rows ?? [];
  const total = rows.length > 0 ? Number(rows[0][1]) : 0;
  return { data: rows.map((r: any[]) => r[0]), total };
}

async function sqlCount(ctx: any, app: string, entity: string, where?: any): Promise<number> {
  const tbl = `${escapeIdent(app)}.${escapeIdent(entity)}`;
  const params: unknown[] = [];
  const whereSql = buildWhereSql(where, params);
  const whereClause = whereSql === "TRUE" ? "" : ` WHERE ${whereSql}`;
  const result = await ctx.sql(`SELECT COUNT(*) FROM ${tbl}${whereClause}`, params);
  return Number(result?.rows?.[0]?.[0] ?? 0);
}

async function sqlUpdate(
  ctx: any, app: string, entity: string, id: string, fields: Record<string, unknown>,
): Promise<void> {
  const tbl = `${escapeIdent(app)}.${escapeIdent(entity)}`;
  const keys = Object.keys(fields);
  if (keys.length === 0) return;
  const params: unknown[] = [];
  const sets = keys.map(k => {
    params.push(fields[k]);
    return `${escapeIdent(k)} = $${params.length}`;
  });
  params.push(id);
  const q = `UPDATE ${tbl} SET ${sets.join(", ")} WHERE id = $${params.length}::uuid`;
  await ctx.sql(q, params);
}

// ─── Export logic ────────────────────────────────────────────────────────────

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

async function startGenericExport(params: StartExportParams, caller: any, ctx: any, def: ExportDef) {
  const token: string | undefined = caller?.authToken;
  const { where, orderBy = def.defaultOrderBy, order = "desc" } = params ?? {};

  if (token) {
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

  const total = await sqlCount(ctx, def.queryApp, def.queryCollection, where);

  if (total === 0) throw new Error(`No ${def.label} match the current filter`);
  if (total > MAX_EXPORT) {
    throw new Error(`Export too large: ${total} ${def.label} (max ${MAX_EXPORT}). Please narrow the filter.`);
  }

  const exportRec = await ctx.collection(def.exportCollection).insert({
    status: "pending",
    filter: { where: where ?? null, orderBy, order },
    total_count: total,
    generated_count: 0,
    file_name: "",
    file_data: "",
    file_size: 0,
    error_message: "",
  });

  const exportPayload = { type: def.jobType, export_id: exportRec.id, where, orderBy, order };
  if (typeof ctx?.enqueueJob === "function") {
    const queued = await ctx.enqueueJob(exportPayload);
    return { export_id: exportRec.id, job_id: queued?.msgId, total_count: total };
  }

  try {
    await runJob(exportPayload, caller, ctx);
  } catch (e: any) {
    await sqlUpdate(ctx, APP_ID, def.exportCollection, exportRec.id, {
      status: "failed", error_message: String(e?.message ?? e),
    }).catch(() => {});
  }

  return { export_id: exportRec.id, total_count: total };
}

async function runJob(payload: any, caller: any, ctx: any) {
  switch (payload?.type) {
    case "run_export": return runExport(payload, caller, ctx);
    case "run_incoming_export": return runIncomingExport(payload, caller, ctx);
    default: throw new Error(`unknown job type: ${payload?.type}`);
  }
}

interface RunExportPayload {
  export_id: string;
  where?: unknown;
  orderBy?: string;
  order?: "asc" | "desc";
}

type ItemRenderer = (item: any, token: string | undefined, ctx: any) => Promise<{ fileName: string; pdfBuf: Buffer } | null>;

async function runGenericExport(
  payload: RunExportPayload,
  caller: any,
  ctx: any,
  opts: { exportCollection: string; queryApp: string; queryCollection: string; batchSize: number; zipPrefix: string; defaultOrderBy: string; progressInterval: number },
  renderItem: ItemRenderer,
) {
  const token: string | undefined = caller?.authToken;
  const { export_id: exportId, where, orderBy = opts.defaultOrderBy, order = "desc" } = payload;

  const patchExport = async (fields: Record<string, unknown>) => {
    try {
      if (token) {
        await api("PATCH", `/api/v1/apps/${APP_ID}/collections/${opts.exportCollection}/${exportId}`, token, fields);
      } else {
        await sqlUpdate(ctx, APP_ID, opts.exportCollection, exportId, fields);
      }
    } catch (e: any) {
      log.warn(`patch ${opts.exportCollection}: ${e.message}`);
    }
  };

  try {
    await patchExport({ status: "running" });

    const zip = new JSZip();
    const usedNames = new Set<string>();
    let generated = 0;
    let offset = 0;
    let done = false;

    while (!done) {
      let items: any[];

      if (token) {
        const batch = await api(
          "POST",
          `/api/v1/apps/${opts.queryApp}/collections/${opts.queryCollection}/query`,
          token,
          { ...(where ? { where } : {}), orderBy, order, limit: opts.batchSize, offset },
        );
        items = batch?.data ?? [];
      } else {
        const batch = await sqlQuery(ctx, opts.queryApp, opts.queryCollection, {
          where, orderBy, order: order as "asc" | "desc", limit: opts.batchSize, offset,
        });
        items = batch.data;
      }

      if (items.length === 0) break;

      for (const item of items) {
        if (generated >= MAX_EXPORT) {
          done = true;
          break;
        }

        try {
          const result = await renderItem(item, token, ctx);
          if (!result) continue;

          let { fileName } = result;
          if (usedNames.has(fileName)) {
            const base = fileName.replace(/\.pdf$/i, "");
            fileName = `${base}_${item.id.slice(0, 8)}.pdf`;
          }
          usedNames.add(fileName);
          zip.file(fileName, result.pdfBuf);
          generated++;
        } catch (e: any) {
          log.warn(`${opts.zipPrefix} ${item.invoice_number || item.document_number || item.id}: ${e.message}`);
        }

        if (generated > 0 && generated % opts.progressInterval === 0) {
          await patchExport({ generated_count: generated });
        }
      }

      if (items.length < opts.batchSize) break;
      offset += opts.batchSize;
    }

    await patchExport({ generated_count: generated });
    if (generated === 0) {
      throw new Error(`No PDFs could be generated for the selected ${opts.zipPrefix}`);
    }

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

async function runExport(payload: RunExportPayload, caller: any, ctx: any) {
  const token: string | undefined = caller?.authToken;

  let seller: SellerSettings | undefined;
  if (token) {
    const sellerRes = await api("GET", `/api/v1/apps/${APP_ID}/collections/seller_settings`, token);
    seller = Array.isArray(sellerRes) ? sellerRes[0] : sellerRes?.data?.[0];
  } else {
    const sellers = await ctx.collection("seller_settings").find({});
    seller = Array.isArray(sellers) ? sellers[0] : undefined;
  }

  return runGenericExport(
    payload, caller, ctx,
    { exportCollection: "invoice_export", queryApp: APP_ID, queryCollection: "invoice", batchSize: 500, zipPrefix: "invoices", defaultOrderBy: "invoice_date", progressInterval: 50 },
    async (inv) => ({
      fileName: invoicePdfFilename(inv),
      pdfBuf: await renderInvoicePdf(inv, seller),
    }),
  );
}

async function runIncomingExport(payload: RunExportPayload, caller: any, ctx: any) {
  const token: string | undefined = caller?.authToken;

  return runGenericExport(
    payload, caller, ctx,
    { exportCollection: "incoming_export", queryApp: PEPPOL_APP_ID, queryCollection: "incoming_documents", batchSize: 50, zipPrefix: "incoming", defaultOrderBy: "issue_date", progressInterval: 10 },
    async (doc, tok, c) => {
      const pdfAttachment = (doc.attachments ?? []).find(
        (a: any) => a.mimeCode === "application/pdf" && (a.fileId || a.base64Content),
      );
      const baseName = (doc.document_number || doc.id).replace(/[^A-Za-z0-9._-]+/g, "_");

      if (pdfAttachment?.fileId) {
        const file = await downloadStorageFile(PEPPOL_APP_ID, pdfAttachment.fileId, tok, c);
        return { fileName: safePdfFilename(pdfAttachment.filename, baseName), pdfBuf: file.content };
      }

      if (pdfAttachment?.base64Content) {
        return {
          fileName: safePdfFilename(pdfAttachment.filename, baseName),
          pdfBuf: Buffer.from(pdfAttachment.base64Content, "base64"),
        };
      }

      if (!doc.xml) return null;

      const xml = stripEmbeddedBinaries(await resolveXml(doc.xml, tok, c));
      const ubl: ParsedUbl = tok
        ? await api("POST", `/api/v1/integrations/${PEPPOL_APP_ID}/actions/parse_ubl`, tok, { xml })
        : await c.callIntegration(PEPPOL_APP_ID, "parse_ubl", { xml });
      const data = ublToIncomingPdfData(ubl, doc);
      const pdfBuf = await renderInvoicePdf(data.invoice, data.seller);
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

function safePdfFilename(name: unknown, fallbackBase: string): string {
  const raw = typeof name === "string" && name.trim() ? name.trim() : `${fallbackBase}.pdf`;
  const safe = raw.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  if (!safe) {
    return `${fallbackBase}.pdf`;
  }
  if (safe.toLowerCase().endsWith(".pdf")) {
    return safe;
  }
  return `${safe}.pdf`;
}
