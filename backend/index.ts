import { createInterface } from "readline";
import postgres from "postgres";

const write = (m: unknown) => process.stdout.write(JSON.stringify(m) + "\n");
const rl = createInterface({ input: process.stdin });
let sql: ReturnType<typeof postgres>;

rl.on("line", (line) => {
  let m: any;
  try { m = JSON.parse(line); } catch { return; }
  if (m.type === "discover") { sql = postgres(m.database_url); write({ type: "discover", methods: ["next_invoice_number"] }); }
  else if (m.type === "rpc") handleRpc(m);
  else if (m.type === "shutdown") process.exit(0);
});

async function handleRpc(m: any) {
  try { write({ type: "rpc_response", id: m.id, result: await dispatch(m.method, m.params ?? {}) }); }
  catch (e: any) { write({ type: "rpc_response", id: m.id, error: e.message }); }
}

async function dispatch(method: string, params: any): Promise<any> {
  if (method === "next_invoice_number") return nextInvoiceNumber(params);
  throw new Error(`unknown method: ${method}`);
}

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
