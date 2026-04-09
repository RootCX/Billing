import postgres from "postgres";

let sql: ReturnType<typeof postgres>;

serve({
  onStart(ctx: any) {
    sql = postgres(ctx.databaseUrl);
  },
  rpc: {
    next_invoice_number: (params: any) => nextInvoiceNumber(params),
  },
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
