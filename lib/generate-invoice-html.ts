import qrcode from "qrcode-generator";
import { getInvoiceTheme } from "./invoice-themes";
import { getReceiptLogoPath } from "./receipt-branding";
import type { Clinic, Patient, Doctor } from "./types";
import { truncateCurrency } from "./money";

export type InvoiceStatus = "PAID" | "PARTIALLY PAID" | "UNPAID" | "REFUNDED";

export interface InvoiceAllocationRow {
  methodLabel: string;
  invoiceAllocationAmount: number;
  feeAmount: number;
  customerChargedAmount: number;
  providerReferenceNumber?: string | null;
  terminalAuthorizationCode?: string | null;
}

export interface InvoiceItem {
  description: string;
  providerName?: string | null;
  quantity: number;
  unitPrice: number;
  /** Reduction from the list price for this single line */
  discountAmount?: number;
  vatRate?: number;
  teeth?: string[];
}

export interface GenerateInvoiceHtmlOptions {
  clinic: (Pick<Clinic, "name" | "logo" | "phone" | "whatsapp" | "instagram" | "tiktok" | "facebook" | "address" | "trn" | "receipt_qr_url" | "receipt_print_name" | "receipt_title"> & { email?: string | null; website?: string | null }) | null | undefined;
  receiptNumber: string;
  invoiceStatus: InvoiceStatus;
  issuedAt: Date;
  /** Receipt number (80 mm receipt) when available */
  posReceiptNumber?: string | null;
  cashierName?: string | null;
  patient: Pick<Patient, "name" | "phone"> & { fileNumber?: string | null; patientNumber?: number | null; email?: string | null };
  doctorName?: string | null;
  department?: string | null;
  items: InvoiceItem[];
  /** Total discount applied to the basket (AED) */
  totalDiscount?: number;
  /** 5% VAT applicable for the Aesthetic clinic */
  vatAmount?: number;
  /** Tabby/Tamara/etc. processing fees charged to the patient */
  paymentFeeAmount?: number;
  /** The grand total the patient is billed */
  grandTotal: number;
  /** Patient credit used towards this invoice */
  creditApplied?: number;
  /** Amount received (may be less than grandTotal when partially paid) */
  amountPaid?: number;
  /** Remaining balance still owed */
  outstandingBalance?: number;
  paymentAllocations?: InvoiceAllocationRow[];
  /** Treatment-plan title/reference, if this invoice settles a plan instalment */
  treatmentPlanReference?: string | null;
  /** Additional free-text notes to show in the notes section (NOT clinical) */
  notes?: string | null;
  /** Whether to include Arabic bilingual labels */
  bilingual?: boolean;
}

// ── helpers ────────────────────────────────────────────────────────────────

function fmt(value: number) {
  return `AED ${truncateCurrency(value).toFixed(2)}`;
}

function escHtml(str: string) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildQrSvg(url: string): string {
  const qr = qrcode(0, "M");
  qr.addData(url);
  qr.make();
  return qr
    .createSvgTag({ cellSize: 3, margin: 2, scalable: true })
    .replace("<svg ", '<svg style="width:22mm;height:22mm;display:block;" ');
}

function statusBadgeStyle(status: InvoiceStatus) {
  const map: Record<InvoiceStatus, { bg: string; color: string }> = {
    "PAID":           { bg: "#e6f4ec", color: "#087A35" },
    "PARTIALLY PAID": { bg: "#fff4cc", color: "#9A6A20" },
    "UNPAID":         { bg: "#fde8e8", color: "#c0392b" },
    "REFUNDED":       { bg: "#eaf0fb", color: "#2c5f9e" },
  };
  return map[status] ?? map["UNPAID"];
}

// ── main export ────────────────────────────────────────────────────────────

export function generateInvoiceHtml(opts: GenerateInvoiceHtmlOptions): string {
  const theme = getInvoiceTheme(opts.clinic?.logo);
  const logoPath = getReceiptLogoPath(opts.clinic);

  const clinicName = opts.clinic?.receipt_print_name || opts.clinic?.name || "Clinic";
  const branchLabel = theme.branchLabel || "";
  const clinicAddress = opts.clinic?.address || "";
  const clinicPhone = opts.clinic?.phone || "";
  const clinicWhatsapp = opts.clinic?.whatsapp || "";
  const clinicEmail = opts.clinic?.email || "";
  const clinicWebsite = opts.clinic?.website || "";
  const clinicInstagram = opts.clinic?.instagram || "";
  const clinicTiktok = opts.clinic?.tiktok || "";
  const clinicTrn = opts.clinic?.trn || "";
  const tagline = theme.tagline;

  const qrUrl = (opts.clinic?.receipt_qr_url || "").trim();
  const waDigits = clinicWhatsapp.replace(/\D/g, "");
  const qrTarget = qrUrl || (waDigits.length >= 8 ? `https://wa.me/${waDigits}` : clinicName);
  const qrSvg = buildQrSvg(qrTarget);

  const issueDate = opts.issuedAt.toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    timeZone: "Asia/Dubai",
  });
  const issueTime = opts.issuedAt.toLocaleTimeString("en-US", {
    hour: "2-digit", minute: "2-digit", hour12: true,
    timeZone: "Asia/Dubai",
  });

  // ── computed totals ────────────────────────────────────────────────────────
  const subtotal = opts.items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const totalDiscount = opts.totalDiscount ?? opts.items.reduce((sum, item) => sum + (item.discountAmount ?? 0), 0);
  const preVat = subtotal - totalDiscount;
  const vatAmount = opts.vatAmount ?? 0;
  const paymentFee = opts.paymentFeeAmount ?? 0;
  const grandTotal = opts.grandTotal;
  const creditApplied = opts.creditApplied ?? 0;
  const amountPaid = opts.amountPaid ?? grandTotal;
  const outstandingBalance = opts.outstandingBalance ?? Math.max(0, grandTotal - amountPaid);

  const badge = statusBadgeStyle(opts.invoiceStatus);

  // ── services table rows ────────────────────────────────────────────────────
  const itemsRows = opts.items.map((item, idx) => {
    const lineNet = item.unitPrice * item.quantity;
    const disc = item.discountAmount ?? 0;
    const taxable = lineNet - disc;
    const vatRate = item.vatRate ?? (vatAmount > 0 ? 0.05 : 0);
    const vatLine = truncateCurrency(taxable * vatRate);
    const lineTotal = truncateCurrency(taxable + vatLine);
    const teethLabel = item.teeth && item.teeth.length > 0 ? ` <span style="font-size:8px;color:#888;">(Tooth #${item.teeth.join(", #")})</span>` : "";
    return `
      <tr>
        <td style="text-align:center;">${idx + 1}</td>
        <td>${escHtml(item.description)}${teethLabel}</td>
        <td>${escHtml(item.providerName || "-")}</td>
        <td style="text-align:center;">${item.quantity}</td>
        <td style="text-align:right;">${fmt(item.unitPrice)}</td>
        <td style="text-align:right;">${disc > 0 ? fmt(disc) : "-"}</td>
        <td style="text-align:right;">${fmt(taxable)}</td>
        <td style="text-align:center;">${vatRate > 0 ? `${(vatRate * 100).toFixed(0)}%` : "0%"}</td>
        <td style="text-align:right;">${vatRate > 0 ? fmt(vatLine) : "-"}</td>
        <td style="text-align:right;font-weight:600;">${fmt(lineTotal)}</td>
      </tr>`;
  }).join("");

  // ── payment allocation rows ────────────────────────────────────────────────
  const allocRows = (opts.paymentAllocations ?? []).map((alloc) => {
    const refParts: string[] = [];
    if (alloc.providerReferenceNumber) refParts.push(`Ref: ${escHtml(alloc.providerReferenceNumber)}`);
    if (alloc.terminalAuthorizationCode) refParts.push(`Auth: ${escHtml(alloc.terminalAuthorizationCode)}`);
    const refStr = refParts.length > 0 ? `<br><span style="font-size:8px;color:#888;">${refParts.join(" · ")}</span>` : "";
    return `
      <tr>
        <td>${escHtml(alloc.methodLabel)}${refStr}</td>
        <td style="text-align:right;">${fmt(alloc.invoiceAllocationAmount)}</td>
        <td style="text-align:right;">${alloc.feeAmount > 0 ? fmt(alloc.feeAmount) : "-"}</td>
        <td style="text-align:right;font-weight:600;">${fmt(alloc.customerChargedAmount)}</td>
      </tr>`;
  }).join("");

  // ── notes content ──────────────────────────────────────────────────────────
  const notesLines: string[] = [];
  if (opts.treatmentPlanReference) notesLines.push(`Treatment Plan: ${escHtml(opts.treatmentPlanReference)}`);
  if (outstandingBalance > 0.005) notesLines.push(`Outstanding balance: ${fmt(outstandingBalance)}`);
  if (opts.notes) notesLines.push(escHtml(opts.notes));
  notesLines.push("Refunds are subject to the clinic's approved refund policy.");
  notesLines.push("This invoice was generated electronically by the clinic POS system.");

  const p  = theme.primaryColor;   // accent / section headings
  const s  = theme.secondaryColor; // table header bg
  const t  = theme.textColor;
  const d  = theme.dividerColor;

  const clinicNameSafe = escHtml(clinicName);
  const branchSafe = branchLabel ? `<div style="font-size:11px;color:${p};font-weight:600;margin-top:2px;">${escHtml(branchLabel)}</div>` : "";
  const taglineSafe = tagline ? `<div style="font-size:10px;color:#666;font-style:italic;margin-top:3px;">${escHtml(tagline)}</div>` : "";
  const trnLine = clinicTrn ? `<div>TRN: ${escHtml(clinicTrn)}</div>` : "";
  const phoneLine = clinicPhone ? `<div>Tel: ${escHtml(clinicPhone)}</div>` : "";
  const waLine = clinicWhatsapp ? `<div>WhatsApp: ${escHtml(clinicWhatsapp)}</div>` : "";
  const emailLine = clinicEmail ? `<div>Email: ${escHtml(clinicEmail)}</div>` : "";
  const websiteLine = clinicWebsite ? `<div>${escHtml(clinicWebsite)}</div>` : "";
  const addressLine = clinicAddress ? `<div style="margin-bottom:3px;">${escHtml(clinicAddress).replace(/\n/g, "<br>")}</div>` : "";

  const patientFileRef = opts.patient.fileNumber
    ? `#${opts.patient.fileNumber}`
    : opts.patient.patientNumber
    ? `#${String(opts.patient.patientNumber).padStart(5, "0")}`
    : "-";

  const invoiceTitle = opts.clinic?.receipt_title?.trim() || "TAX INVOICE";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escHtml(invoiceTitle)} — ${escHtml(opts.receiptNumber)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --primary:  ${p};
      --secondary:${s};
      --accent:   ${theme.accentColor};
      --text:     ${t};
      --divider:  ${d};
    }

    @page { size: A4; margin: 12mm 14mm; }
    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: "Inter", Arial, "Aptos", sans-serif;
      font-size: 9pt;
      color: var(--text);
      background: #fff;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    /* ── HEADER ── */
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      padding-bottom: 8px;
      border-bottom: 2px solid var(--primary);
      gap: 16px;
    }

    .header-left { display: flex; align-items: flex-start; gap: 12px; flex: 1; }

    .logo-wrap img {
      width: 38mm;
      max-height: 22mm;
      object-fit: contain;
      display: block;
    }

    .clinic-info { line-height: 1.45; }
    .clinic-name { font-size: 13pt; font-weight: 700; color: var(--secondary); }
    .clinic-detail { font-size: 8pt; color: #555; margin-top: 5px; line-height: 1.5; }

    .header-right { text-align: right; flex-shrink: 0; }
    .invoice-title-text {
      font-size: 22pt;
      font-weight: 700;
      color: var(--primary);
      letter-spacing: 1px;
      line-height: 1.1;
    }
    .invoice-title-ar {
      font-size: 13pt;
      font-weight: 600;
      color: var(--primary);
      line-height: 1.1;
      margin-bottom: 6px;
    }
    .invoice-meta { font-size: 8pt; line-height: 1.6; color: #444; }
    .invoice-meta-row { display: flex; justify-content: flex-end; gap: 6px; }
    .invoice-meta-label { font-weight: 600; color: var(--primary); min-width: 28mm; text-align: right; }
    .invoice-meta-value { min-width: 36mm; text-align: left; }
    .status-badge {
      display: inline-block;
      padding: 3px 9px;
      border-radius: 4px;
      font-size: 8pt;
      font-weight: 700;
      letter-spacing: 0.5px;
      background: ${badge.bg};
      color: ${badge.color};
      margin-bottom: 6px;
    }

    /* ── SECTION HEADING ── */
    .section-heading {
      font-size: 8pt;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      color: var(--primary);
      border-bottom: 1px solid var(--divider);
      padding-bottom: 3px;
      margin: 10px 0 6px;
    }

    /* ── TWO-COLUMN INFO BLOCKS ── */
    .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 4px; }
    .info-row { display: flex; font-size: 8.5pt; line-height: 1.5; }
    .info-label { color: var(--primary); font-weight: 600; min-width: 28mm; flex-shrink: 0; }
    .info-value { color: var(--text); }

    /* ── TABLES (shared) ── */
    table { width: 100%; border-collapse: collapse; font-size: 8pt; }
    thead tr { background: var(--secondary); color: #fff; }
    thead th {
      padding: 5px 6px;
      text-align: left;
      font-weight: 600;
      font-size: 7.5pt;
      text-transform: uppercase;
    }
    tbody tr { border-bottom: 1px solid var(--divider); }
    tbody tr:nth-child(even) { background: #fafafa; }
    tbody td { padding: 5px 6px; vertical-align: top; }

    /* ── TOTALS ── */
    .totals-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin-top: 8px;
    }
    .totals-table { font-size: 8.5pt; }
    .totals-table td { padding: 4px 6px; border-bottom: 1px solid var(--divider); }
    .totals-table .label { color: #555; }
    .totals-table .value { text-align: right; font-weight: 500; }
    .totals-table .grand-row td {
      background: var(--primary);
      color: #fff;
      font-weight: 700;
      font-size: 9.5pt;
      border-bottom: none;
    }
    .totals-table .balance-row td { color: #c0392b; font-weight: 600; }

    /* ── PAYMENT TABLE ── */
    .payment-table thead tr { background: var(--primary); }

    /* ── NOTES ── */
    .notes-block {
      background: #fafafa;
      border-left: 3px solid var(--divider);
      padding: 7px 10px;
      font-size: 7.5pt;
      color: #555;
      line-height: 1.55;
      margin-top: 8px;
    }
    .notes-block li { margin-left: 12px; }

    /* ── FOOTER ── */
    .footer {
      margin-top: 12px;
      padding-top: 8px;
      border-top: 1px solid var(--divider);
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 10px;
      font-size: 7.5pt;
      color: #666;
      line-height: 1.55;
    }
    .footer-col { flex: 1; }
    .footer-col-center { flex: 1; text-align: center; }
    .footer-col-right { flex: 0 0 auto; text-align: right; }
    .footer-qr-label { font-size: 7pt; color: #888; margin-top: 3px; }

    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .header { break-inside: avoid; }
      thead { display: table-header-group; }
    }
  </style>
</head>
<body>

  <!-- ── HEADER ── -->
  <div class="header">
    <div class="header-left">
      <div class="logo-wrap">
        <img src="${logoPath}" alt="${clinicNameSafe} logo" onerror="this.style.display='none'">
      </div>
      <div class="clinic-info">
        <div class="clinic-name">${clinicNameSafe}</div>
        ${branchSafe}
        ${taglineSafe}
        <div class="clinic-detail">
          ${addressLine}
          ${phoneLine}
          ${waLine}
          ${emailLine}
          ${websiteLine}
          ${trnLine}
        </div>
      </div>
    </div>

    <div class="header-right">
      <div class="invoice-title-text">${escHtml(invoiceTitle)}</div>
      <div class="invoice-title-ar">فاتورة ضريبية</div>
      <div class="status-badge">${opts.invoiceStatus}</div>
      <div class="invoice-meta">
        <div class="invoice-meta-row">
          <span class="invoice-meta-label">Invoice No.</span>
          <span class="invoice-meta-value">${escHtml(opts.receiptNumber)}</span>
        </div>
        <div class="invoice-meta-row">
          <span class="invoice-meta-label">Issue Date</span>
          <span class="invoice-meta-value">${issueDate}</span>
        </div>
        <div class="invoice-meta-row">
          <span class="invoice-meta-label">Issue Time</span>
          <span class="invoice-meta-value">${issueTime}</span>
        </div>
        ${opts.posReceiptNumber ? `
        <div class="invoice-meta-row">
          <span class="invoice-meta-label">Receipt No.</span>
          <span class="invoice-meta-value">${escHtml(opts.posReceiptNumber)}</span>
        </div>` : ""}
        ${opts.cashierName ? `
        <div class="invoice-meta-row">
          <span class="invoice-meta-label">Cashier</span>
          <span class="invoice-meta-value">${escHtml(opts.cashierName)}</span>
        </div>` : ""}
      </div>
    </div>
  </div>

  <!-- ── PATIENT / VISIT DETAILS ── -->
  <div class="section-heading">Patient &amp; Visit Details / تفاصيل المريض والزيارة</div>
  <div class="info-grid">
    <div>
      <div class="info-row"><span class="info-label">Patient Name</span><span class="info-value">${escHtml(opts.patient.name)}</span></div>
      <div class="info-row"><span class="info-label">Patient ID</span><span class="info-value">${escHtml(patientFileRef)}</span></div>
      ${opts.patient.phone ? `<div class="info-row"><span class="info-label">Mobile</span><span class="info-value">${escHtml(opts.patient.phone)}</span></div>` : ""}
      ${opts.patient.email ? `<div class="info-row"><span class="info-label">Email</span><span class="info-value">${escHtml(opts.patient.email)}</span></div>` : ""}
    </div>
    <div>
      <div class="info-row"><span class="info-label">Invoice Date</span><span class="info-value">${issueDate}</span></div>
      ${opts.doctorName ? `<div class="info-row"><span class="info-label">Doctor / Provider</span><span class="info-value">${escHtml(opts.doctorName)}</span></div>` : ""}
      ${opts.department ? `<div class="info-row"><span class="info-label">Department</span><span class="info-value">${escHtml(opts.department)}</span></div>` : ""}
      ${branchLabel ? `<div class="info-row"><span class="info-label">Branch</span><span class="info-value">${escHtml(branchLabel)}</span></div>` : ""}
    </div>
  </div>

  <!-- ── SERVICES TABLE ── -->
  <div class="section-heading">Services &amp; Treatments / الخدمات والعلاجات</div>
  <table>
    <thead>
      <tr>
        <th style="width:22px;">#</th>
        <th>Description / الوصف</th>
        <th style="width:30mm;">Provider</th>
        <th style="width:14px;text-align:center;">Qty</th>
        <th style="width:26mm;text-align:right;">Unit Price</th>
        <th style="width:22mm;text-align:right;">Discount</th>
        <th style="width:26mm;text-align:right;">Taxable Amt</th>
        <th style="width:16px;text-align:center;">VAT%</th>
        <th style="width:22mm;text-align:right;">VAT Amt</th>
        <th style="width:26mm;text-align:right;">Total</th>
      </tr>
    </thead>
    <tbody>
      ${itemsRows}
    </tbody>
  </table>

  <!-- ── TOTALS + PAYMENT BREAKDOWN ── -->
  <div class="totals-grid">

    <!-- Payment breakdown -->
    <div>
      ${(opts.paymentAllocations ?? []).length > 0 ? `
      <div class="section-heading">Payment Breakdown / تفاصيل الدفع</div>
      <table class="payment-table">
        <thead>
          <tr>
            <th>Method</th>
            <th style="text-align:right;">Invoice Alloc.</th>
            <th style="text-align:right;">Fee</th>
            <th style="text-align:right;">Charged</th>
          </tr>
        </thead>
        <tbody>${allocRows}</tbody>
      </table>` : `<div class="section-heading">Payment / الدفع</div>
      <div style="font-size:8.5pt;color:#555;padding:6px 0;">${amountPaid >= grandTotal - 0.005 ? "Paid in full" : "Partially paid"}</div>`}
    </div>

    <!-- Totals summary -->
    <div>
      <div class="section-heading">Summary / الملخص</div>
      <table class="totals-table">
        <tr><td class="label">Subtotal / المجموع الفرعي</td><td class="value">${fmt(subtotal)}</td></tr>
        ${totalDiscount > 0.005 ? `<tr><td class="label">Discount / الخصم</td><td class="value" style="color:var(--primary);">− ${fmt(totalDiscount)}</td></tr>` : ""}
        ${vatAmount > 0.005 ? `
        <tr><td class="label">Amount Before VAT</td><td class="value">${fmt(preVat)}</td></tr>
        <tr><td class="label">VAT (5%) / ضريبة القيمة المضافة</td><td class="value">${fmt(vatAmount)}</td></tr>` : ""}
        ${paymentFee > 0.005 ? `<tr><td class="label">Payment Fee / رسوم الدفع</td><td class="value">${fmt(paymentFee)}</td></tr>` : ""}
        <tr class="grand-row"><td class="label">Grand Total / الإجمالي</td><td class="value">${fmt(grandTotal)}</td></tr>
        ${creditApplied > 0.005 ? `<tr><td class="label">Credit Applied / رصيد مستخدم</td><td class="value" style="color:var(--primary);">− ${fmt(creditApplied)}</td></tr>` : ""}
        <tr><td class="label">Amount Paid / المدفوع</td><td class="value">${fmt(amountPaid)}</td></tr>
        ${outstandingBalance > 0.005 ? `<tr class="balance-row"><td class="label">Balance Due / الرصيد المستحق</td><td class="value">${fmt(outstandingBalance)}</td></tr>` : ""}
      </table>
    </div>

  </div>

  <!-- ── NOTES ── -->
  <div class="notes-block">
    <ul>
      ${notesLines.map((n) => `<li>${n}</li>`).join("\n      ")}
    </ul>
  </div>

  <!-- ── FOOTER ── -->
  <div class="footer">
    <div class="footer-col">
      ${addressLine}
      ${phoneLine}
      ${waLine}
      ${emailLine}
      ${websiteLine}
    </div>
    <div class="footer-col-center">
      ${clinicInstagram ? `<div>Instagram: ${escHtml(clinicInstagram)}</div>` : ""}
      ${clinicTiktok ? `<div>TikTok: ${escHtml(clinicTiktok)}</div>` : ""}
    </div>
    <div class="footer-col-right">
      ${qrSvg}
      <div class="footer-qr-label">Scan to view or verify this invoice</div>
    </div>
  </div>

</body>
</html>`;
}
