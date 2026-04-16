import PDFDocument from "pdfkit";

interface LineItem {
  id: string;
  product: string;
  description: string;
  quantity: number;
  unit: string;
  unit_price: number;
  discount: number;
  tax_rate: number;
}

interface InvoiceReference {
  id: string;
  type: string;
  label: string;
  value: string;
}

export interface Invoice {
  id: string;
  invoice_number: string;
  status: string;
  invoice_date: string;
  due_date: string;
  currency: string;
  vat_treatment: string;
  client_company: string;
  client_vat: string;
  client_street: string;
  client_city: string;
  client_postal: string;
  client_country: string;
  client_contact_name: string;
  client_contact_email: string;
  line_items: LineItem[];
  references: InvoiceReference[];
  internal_notes: string;
  terms: string;
  subtotal: number;
  total_tax: number;
  total: number;
}

export interface SellerSettings {
  company_name: string;
  vat_number: string;
  street: string;
  city: string;
  postal_code: string;
  country_code: string;
  email: string;
  phone: string;
  iban: string;
  bic: string;
  logo: string;
  default_currency: string;
  default_vat_rate: number;
  invoice_prefix: string;
  default_terms: string;
  default_notes: string;
}

const FIELD_NONE = "__none__";

const C = {
  ink: "#0f172a",
  body: "#1e293b",
  strong: "#334155",
  muted: "#475569",
  softMuted: "#64748b",
  faint: "#94a3b8",
  line: "#e2e8f0",
  lineSoft: "#f1f5f9",
};

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  draft:     { bg: "#f3f4f6", text: "#4b5563", label: "DRAFT" },
  sent:      { bg: "#dbeafe", text: "#1d4ed8", label: "SENT" },
  paid:      { bg: "#dcfce7", text: "#15803d", label: "PAID" },
  overdue:   { bg: "#fee2e2", text: "#b91c1c", label: "OVERDUE" },
  cancelled: { bg: "#f3f4f6", text: "#6b7280", label: "CANCELLED" },
};

const VAT_LABELS: Record<string, string> = {
  standard: "Standard", exempt: "Exempt", reverse_charge: "Reverse Charge",
  intra_eu: "Intra-EU", export: "Export",
};

function formatCurrency(amount: number, currency: string) {
  const cur = currency || "EUR";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: cur, minimumFractionDigits: 2 }).format(amount);
  } catch {
    return `${cur} ${amount.toFixed(2)}`;
  }
}

function formatDate(dateStr: string) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function computeLineItem(item: LineItem) {
  const gross = (item.quantity || 0) * (item.unit_price || 0);
  const discounted = gross * (1 - (item.discount || 0) / 100);
  const tax = discounted * ((item.tax_rate || 0) / 100);
  return { subtotal: discounted, tax, total: discounted + tax };
}

function dataUrlToBuffer(dataUrl: string): Buffer | null {
  if (!dataUrl || !dataUrl.startsWith("data:")) return null;
  const comma = dataUrl.indexOf(",");
  if (comma === -1) return null;
  const header = dataUrl.slice(0, comma);
  if (!header.includes("base64")) return null;
  try { return Buffer.from(dataUrl.slice(comma + 1), "base64"); }
  catch { return null; }
}

export function invoicePdfFilename(invoice: Invoice): string {
  const base = (invoice.invoice_number || invoice.id).replace(/[^A-Za-z0-9._-]+/g, "_");
  return `${base}.pdf`;
}

export function renderInvoicePdf(invoice: Invoice, seller: SellerSettings | undefined): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 40, info: { Title: invoice.invoice_number || "Invoice" } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    try {
      paint(doc, invoice, seller);
    } catch (e) {
      reject(e as Error);
      return;
    }
    doc.end();
  });
}

function paint(doc: PDFKit.PDFDocument, invoice: Invoice, seller: SellerSettings | undefined) {
  const pageWidth = doc.page.width;
  const contentLeft = doc.page.margins.left;
  const contentRight = pageWidth - doc.page.margins.right;
  const contentWidth = contentRight - contentLeft;

  const currency = invoice.currency || "EUR";
  const lineItems = invoice.line_items ?? [];
  const references = invoice.references ?? [];
  const rows = lineItems.map((item) => ({ item, ...computeLineItem(item) }));
  const subtotal = rows.reduce((a, r) => a + r.subtotal, 0);
  const totalTax = rows.reduce((a, r) => a + r.tax, 0);
  const total = subtotal + totalTax;
  const statusStyle = STATUS_STYLES[invoice.status] ?? STATUS_STYLES.draft;

  const headerTop = doc.y;
  let leftY = headerTop;

  // Logo (optional)
  const logoBuf = seller?.logo ? dataUrlToBuffer(seller.logo) : null;
  if (logoBuf) {
    try {
      doc.image(logoBuf, contentLeft, leftY, { fit: [120, 40] });
      leftY += 48;
    } catch {
      // ignore bad image
    }
  }

  doc.font("Helvetica-Bold").fontSize(20).fillColor(C.ink)
    .text(seller?.company_name || "Your Company", contentLeft, leftY, { width: contentWidth * 0.6 });
  leftY = doc.y;

  doc.font("Helvetica").fontSize(9).fillColor(C.faint);
  if (seller?.vat_number) { doc.text(`VAT: ${seller.vat_number}`, contentLeft, leftY); leftY = doc.y; }
  const addressLine = [seller?.street, [seller?.postal_code, seller?.city].filter(Boolean).join(" "), seller?.country_code].filter(Boolean).join(", ");
  if (addressLine) { doc.text(addressLine, contentLeft, leftY, { width: contentWidth * 0.6 }); leftY = doc.y; }
  if (seller?.email) { doc.text(seller.email, contentLeft, leftY); leftY = doc.y; }

  // Right side: INVOICE title + number + status
  const rightColX = contentLeft + contentWidth * 0.55;
  const rightColW = contentWidth * 0.45;
  doc.font("Helvetica-Bold").fontSize(22).fillColor(C.ink)
    .text("INVOICE", rightColX, headerTop, { width: rightColW, align: "right" });
  doc.font("Courier").fontSize(11).fillColor(C.softMuted)
    .text(invoice.invoice_number || "INV-XXXXXX", rightColX, doc.y + 2, { width: rightColW, align: "right" });

  // Status pill
  const statusLabel = statusStyle.label;
  doc.font("Helvetica-Bold").fontSize(8);
  const pillTextWidth = doc.widthOfString(statusLabel);
  const pillPadX = 8;
  const pillPadY = 4;
  const pillW = pillTextWidth + pillPadX * 2;
  const pillH = 14;
  const pillX = contentRight - pillW;
  const pillY = doc.y + 6;
  doc.roundedRect(pillX, pillY, pillW, pillH, 7).fill(statusStyle.bg);
  doc.fillColor(statusStyle.text).text(statusLabel, pillX + pillPadX, pillY + pillPadY - 1, { lineBreak: false });
  const rightBottomY = pillY + pillH;

  // Divider under header
  const headerBottom = Math.max(leftY, rightBottomY) + 12;
  doc.moveTo(contentLeft, headerBottom).lineTo(contentRight, headerBottom).strokeColor(C.line).lineWidth(0.5).stroke();
  doc.y = headerBottom + 18;

  const datesY = doc.y;
  const colW = contentWidth / 3;
  const dateItems = [
    { label: "Invoice Date", value: formatDate(invoice.invoice_date) || "—" },
    { label: "Due Date",     value: formatDate(invoice.due_date) || "—" },
    { label: "VAT Treatment", value: VAT_LABELS[invoice.vat_treatment] || "—" },
  ];
  dateItems.forEach((d, i) => {
    const x = contentLeft + colW * i;
    doc.font("Helvetica-Bold").fontSize(7).fillColor(C.faint).text(d.label.toUpperCase(), x, datesY, { characterSpacing: 1, lineBreak: false });
    doc.font("Helvetica").fontSize(11).fillColor(C.body).text(d.value, x, datesY + 12, { width: colW - 8, lineBreak: false });
  });
  doc.y = datesY + 32;

  const btY = doc.y;
  const billColW = references.length > 0 ? contentWidth / 2 - 8 : contentWidth;
  // Bill To
  doc.font("Helvetica-Bold").fontSize(7).fillColor(C.faint).text("BILL TO", contentLeft, btY, { characterSpacing: 1, lineBreak: false });
  let btCurY = btY + 12;
  doc.font("Helvetica-Bold").fontSize(11).fillColor(C.ink).text(invoice.client_company || "—", contentLeft, btCurY, { width: billColW });
  btCurY = doc.y;
  const billLines: string[] = [];
  if (invoice.client_vat) billLines.push(`VAT: ${invoice.client_vat}`);
  if (invoice.client_street) billLines.push(invoice.client_street);
  const cityLine = [invoice.client_postal, invoice.client_city].filter(Boolean).join(" ");
  if (cityLine) billLines.push(cityLine);
  if (invoice.client_country) billLines.push(invoice.client_country);
  if (invoice.client_contact_name) billLines.push(invoice.client_contact_name);
  if (invoice.client_contact_email) billLines.push(invoice.client_contact_email);
  doc.font("Helvetica").fontSize(10).fillColor(C.muted);
  for (const line of billLines) { doc.text(line, contentLeft, btCurY, { width: billColW }); btCurY = doc.y; }

  // References
  let refBottomY = btCurY;
  if (references.length > 0) {
    const refX = contentLeft + contentWidth / 2 + 8;
    const refW = contentWidth / 2 - 8;
    doc.font("Helvetica-Bold").fontSize(7).fillColor(C.faint).text("REFERENCES", refX, btY, { characterSpacing: 1, lineBreak: false });
    let rY = btY + 12;
    for (const ref of references) {
      doc.font("Helvetica").fontSize(9).fillColor(C.faint).text(`${ref.label}:`, refX, rY, { continued: true })
         .fillColor(C.strong).font("Helvetica-Bold").text(` ${ref.value || "—"}`, { width: refW });
      rY = doc.y + 2;
    }
    refBottomY = rY;
  }
  doc.y = Math.max(btCurY, refBottomY) + 20;

  const headers = [
    { label: "DESCRIPTION", align: "left" as const,  w: 0.38 },
    { label: "QTY",         align: "right" as const, w: 0.07 },
    { label: "UNIT",        align: "right" as const, w: 0.08 },
    { label: "PRICE",       align: "right" as const, w: 0.15 },
    { label: "DISC.",       align: "right" as const, w: 0.07 },
    { label: "TAX",         align: "right" as const, w: 0.07 },
    { label: "TOTAL",       align: "right" as const, w: 0.18 },
  ];
  const colWidths = headers.map((h) => h.w * contentWidth);
  const colXs: number[] = [];
  { let acc = contentLeft; for (const w of colWidths) { colXs.push(acc); acc += w; } }

  const drawCellText = (text: string, x: number, y: number, w: number, align: "left" | "right") => {
    doc.text(text, x + (align === "right" ? 4 : 0), y, { width: w - 8, align, lineBreak: false });
  };

  // Header row
  let tableY = doc.y;
  doc.font("Helvetica-Bold").fontSize(7).fillColor(C.softMuted);
  headers.forEach((h, i) => {
    drawCellText(h.label, colXs[i], tableY, colWidths[i], h.align);
  });
  tableY += 14;
  doc.moveTo(contentLeft, tableY).lineTo(contentRight, tableY).strokeColor(C.ink).lineWidth(1).stroke();
  tableY += 8;
  doc.y = tableY;

  // Body rows
  if (rows.length === 0) {
    doc.font("Helvetica-Oblique").fontSize(10).fillColor(C.faint).text("No line items", contentLeft, doc.y + 12, { width: contentWidth, align: "center" });
    doc.y += 24;
  } else {
    for (const { item, total: rowTotal } of rows) {
      // Measure description block height first
      const descX = colXs[0];
      const descW = colWidths[0] - 8;
      doc.font("Helvetica-Bold").fontSize(10);
      const productH = doc.heightOfString(item.product || "—", { width: descW });
      let descH = productH;
      if (item.description) {
        doc.font("Helvetica").fontSize(8);
        descH += 2 + doc.heightOfString(item.description, { width: descW });
      }
      const rowH = Math.max(descH, 14) + 12;

      // Page break if needed
      if (doc.y + rowH > doc.page.height - doc.page.margins.bottom - 120) {
        doc.addPage();
        // Redraw header on new page
        let hY = doc.y;
        doc.font("Helvetica-Bold").fontSize(7).fillColor(C.softMuted);
        headers.forEach((h, i) => drawCellText(h.label, colXs[i], hY, colWidths[i], h.align));
        hY += 14;
        doc.moveTo(contentLeft, hY).lineTo(contentRight, hY).strokeColor(C.ink).lineWidth(1).stroke();
        hY += 8;
        doc.y = hY;
      }

      const rowY = doc.y;
      // Description
      doc.font("Helvetica-Bold").fontSize(10).fillColor(C.body).text(item.product || "—", descX, rowY, { width: descW });
      if (item.description) {
        doc.font("Helvetica").fontSize(8).fillColor(C.faint).text(item.description, descX, doc.y + 1, { width: descW });
      }

      // Other columns (single line each)
      const rowBaselineY = rowY + 1;
      doc.font("Helvetica").fontSize(10).fillColor(C.muted);
      drawCellText(String(item.quantity ?? 0), colXs[1], rowBaselineY, colWidths[1], "right");
      drawCellText(item.unit || "", colXs[2], rowBaselineY, colWidths[2], "right");
      drawCellText(formatCurrency(item.unit_price || 0, currency), colXs[3], rowBaselineY, colWidths[3], "right");
      drawCellText(item.discount > 0 ? `${item.discount}%` : "—", colXs[4], rowBaselineY, colWidths[4], "right");
      drawCellText(item.tax_rate > 0 ? `${item.tax_rate}%` : "—", colXs[5], rowBaselineY, colWidths[5], "right");
      doc.font("Helvetica-Bold").fillColor(C.body);
      drawCellText(formatCurrency(rowTotal, currency), colXs[6], rowBaselineY, colWidths[6], "right");

      const rowBottom = rowY + rowH;
      doc.moveTo(contentLeft, rowBottom - 4).lineTo(contentRight, rowBottom - 4).strokeColor(C.lineSoft).lineWidth(0.5).stroke();
      doc.y = rowBottom;
    }
  }

  doc.y += 10;
  const totalsW = 220;
  const totalsX = contentRight - totalsW;
  let tY = doc.y;
  const drawTotalRow = (label: string, value: string, bold = false) => {
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 11 : 10).fillColor(bold ? C.ink : C.muted);
    doc.text(label, totalsX, tY, { width: totalsW / 2, lineBreak: false });
    doc.text(value, totalsX + totalsW / 2, tY, { width: totalsW / 2, align: "right", lineBreak: false });
    tY += bold ? 18 : 14;
  };
  drawTotalRow("Subtotal", formatCurrency(subtotal, currency));
  if (totalTax > 0) drawTotalRow("VAT", formatCurrency(totalTax, currency));
  doc.moveTo(totalsX, tY).lineTo(totalsX + totalsW, tY).strokeColor(C.ink).lineWidth(1.5).stroke();
  tY += 6;
  drawTotalRow(`Total (${currency})`, formatCurrency(total, currency), true);
  doc.y = tY + 12;

  if (seller?.iban || seller?.bic) {
    drawSectionDivider(doc, contentLeft, contentRight);
    doc.font("Helvetica-Bold").fontSize(7).fillColor(C.faint).text("BANK DETAILS", contentLeft, doc.y, { characterSpacing: 1, lineBreak: false });
    let bY = doc.y + 10;
    if (seller.iban) {
      doc.font("Helvetica").fontSize(7).fillColor(C.faint).text("IBAN", contentLeft, bY, { lineBreak: false });
      doc.font("Courier").fontSize(10).fillColor(C.strong).text(seller.iban, contentLeft, bY + 10, { lineBreak: false });
    }
    if (seller.bic) {
      const bicX = contentLeft + 220;
      doc.font("Helvetica").fontSize(7).fillColor(C.faint).text("BIC", bicX, bY, { lineBreak: false });
      doc.font("Courier").fontSize(10).fillColor(C.strong).text(seller.bic, bicX, bY + 10, { lineBreak: false });
    }
    doc.y = bY + 26;
  }

  if (invoice.internal_notes && invoice.internal_notes !== FIELD_NONE) {
    drawSectionDivider(doc, contentLeft, contentRight);
    doc.font("Helvetica-Bold").fontSize(7).fillColor(C.faint).text("NOTES", contentLeft, doc.y, { characterSpacing: 1, lineBreak: false });
    doc.y += 4;
    doc.font("Helvetica").fontSize(10).fillColor(C.muted).text(invoice.internal_notes, contentLeft, doc.y + 8, { width: contentWidth });
    doc.y += 8;
  }

  const termsText = invoice.terms !== FIELD_NONE ? (invoice.terms || seller?.default_terms || "") : "";
  if (termsText) {
    drawSectionDivider(doc, contentLeft, contentRight);
    doc.font("Helvetica-Bold").fontSize(7).fillColor(C.faint).text("TERMS & CONDITIONS", contentLeft, doc.y, { characterSpacing: 1, lineBreak: false });
    doc.y += 4;
    doc.font("Helvetica").fontSize(9).fillColor(C.softMuted).text(termsText, contentLeft, doc.y + 8, { width: contentWidth, lineGap: 2 });
    doc.y += 8;
  }

  const footerY = doc.page.height - doc.page.margins.bottom - 20;
  doc.moveTo(contentLeft, footerY).lineTo(contentRight, footerY).strokeColor(C.line).lineWidth(0.5).stroke();
  const footerParts = [seller?.company_name, seller?.vat_number ? `VAT ${seller.vat_number}` : "", seller?.email].filter(Boolean);
  doc.font("Helvetica").fontSize(8).fillColor(C.faint).text(footerParts.join(" · "), contentLeft, footerY + 6, { width: contentWidth, align: "center", lineBreak: false });
}

function drawSectionDivider(doc: PDFKit.PDFDocument, x1: number, x2: number) {
  doc.moveTo(x1, doc.y).lineTo(x2, doc.y).strokeColor(C.lineSoft).lineWidth(0.5).stroke();
  doc.y += 12;
}
