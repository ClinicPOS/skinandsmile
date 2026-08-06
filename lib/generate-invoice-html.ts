import qrcode from "qrcode-generator";
import { getA4InvoiceLogoPath, getA4InvoiceLogoSettings, getA4InvoiceTheme } from "./a4-invoice-branding";
import type { Clinic, Patient } from "./types";
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
  /** Original unit price before a manual edit or promotion, when available */
  originalUnitPrice?: number | null;
  unitPrice: number;
  /** Reduction from the list price for this single line */
  discountAmount?: number;
  vatRate?: number;
  teeth?: string[];
}

export interface GenerateInvoiceHtmlOptions {
  clinic: (Pick<
    Clinic,
    | "name"
    | "logo"
    | "phone"
    | "whatsapp"
    | "instagram"
    | "tiktok"
    | "facebook"
    | "address"
    | "trn"
    | "receipt_qr_url"
    | "receipt_print_name"
    | "receipt_title"
    | "a4_invoice_logo_url"
    | "a4_invoice_logo_width_mm"
    | "a4_invoice_logo_height_mm"
    | "a4_invoice_logo_alignment"
    | "a4_invoice_logo_offset_x_mm"
    | "a4_invoice_logo_offset_y_mm"
    | "a4_invoice_primary_color"
    | "a4_invoice_secondary_color"
    | "a4_invoice_accent_color"
    | "a4_invoice_text_color"
    | "a4_invoice_divider_color"
    | "a4_invoice_slogan"
  > & { email?: string | null; website?: string | null }) | null | undefined;
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
  /** Treatment-plan summary for the A4 breakdown section */
  treatmentPlanTotalAmount?: number | null;
  treatmentPlanPaidToday?: number | null;
  treatmentPlanBalanceAfterToday?: number | null;
  treatmentPlanPlannedVisits?: number | null;
  treatmentPlanCompletedVisits?: number | null;
  /** Additional free-text notes to show in the notes section (NOT clinical) */
  notes?: string | null;
  /** Whether to include Arabic bilingual labels */
  bilingual?: boolean;
  /** When true, render inside an A4 paper preview shell for on-screen previews */
  previewPaperMode?: boolean;
}

export interface TreatmentPlanInvoiceContext {
  clinic: GenerateInvoiceHtmlOptions["clinic"];
  receiptNumber: string;
  issuedAt: Date;
  cashierName?: string | null;
  patient: GenerateInvoiceHtmlOptions["patient"];
  doctorName?: string | null;
  planTitle: string;
  planTotalAmount: number;
  amountSettledToday: number;
  paymentFeeAmount?: number;
  paymentAllocations?: InvoiceAllocationRow[];
  remainingAfterToday?: number;
  plannedVisits?: number | null;
  completedVisits?: number | null;
  notes?: string | null;
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

export function generateTreatmentPlanPaymentInvoiceHtml(ctx: TreatmentPlanInvoiceContext): string {
  const paymentFeeAmount = Number(ctx.paymentFeeAmount ?? 0);
  const settlementAmount = Number(ctx.amountSettledToday ?? 0);
  const allocationTotal = (ctx.paymentAllocations ?? []).reduce((sum, allocation) => sum + Number(allocation.customerChargedAmount || 0), 0);
  const grandTotal = allocationTotal > 0.0049 ? allocationTotal : settlementAmount + paymentFeeAmount;
  const notes = [
    ctx.notes,
    `Treatment plan: ${ctx.planTitle}`,
    ctx.remainingAfterToday != null ? `Remaining balance after today: AED ${Number(ctx.remainingAfterToday).toFixed(2)}` : null,
  ].filter(Boolean) as string[];

  return generateInvoiceHtml({
    clinic: ctx.clinic,
    receiptNumber: ctx.receiptNumber,
    invoiceStatus: "PAID",
    issuedAt: ctx.issuedAt,
    cashierName: ctx.cashierName,
    patient: ctx.patient,
    doctorName: ctx.doctorName,
    items: [
      {
        description: `Treatment Plan Payment — ${ctx.planTitle}`,
        quantity: 1,
        unitPrice: settlementAmount,
      },
    ],
    paymentFeeAmount,
    grandTotal,
    amountPaid: grandTotal,
    outstandingBalance: 0,
    paymentAllocations: ctx.paymentAllocations,
    treatmentPlanReference: ctx.planTitle,
    treatmentPlanTotalAmount: ctx.planTotalAmount,
    treatmentPlanPaidToday: ctx.amountSettledToday,
    treatmentPlanBalanceAfterToday: ctx.remainingAfterToday,
    treatmentPlanPlannedVisits: ctx.plannedVisits ?? null,
    treatmentPlanCompletedVisits: ctx.completedVisits ?? null,
    notes: notes.join("\n"),
  });
}

export function generateInvoiceHtml(opts: GenerateInvoiceHtmlOptions): string {
  const theme = getA4InvoiceTheme(opts.clinic);
  const logoPath = (() => {
    const resolvedPath = getA4InvoiceLogoPath(opts.clinic);
    if (!resolvedPath || /^https?:\/\//i.test(resolvedPath) || resolvedPath.startsWith("data:")) {
      return resolvedPath;
    }
    if (typeof window !== "undefined" && window.location?.origin) {
      return `${window.location.origin}${resolvedPath.startsWith("/") ? resolvedPath : `/${resolvedPath}`}`;
    }
    return resolvedPath;
  })();

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
  const logoSettings = getA4InvoiceLogoSettings(opts.clinic);
  const hasLogo = !!logoPath;

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
  const subtotal = opts.items.reduce((sum, item) => {
    const originalUnitPrice = item.originalUnitPrice != null ? Number(item.originalUnitPrice) : null;
    const priceWasEdited = originalUnitPrice != null && originalUnitPrice > Number(item.unitPrice) + 0.0049;
    const baseUnitPrice = priceWasEdited ? originalUnitPrice : Number(item.unitPrice);
    return sum + baseUnitPrice * item.quantity;
  }, 0);
  const totalDiscount = Math.max(0, Math.min(subtotal, opts.totalDiscount ?? opts.items.reduce((sum, item) => sum + (item.discountAmount ?? 0), 0)));
  const originalSubtotal = subtotal;
  const preVat = Math.max(0, subtotal - totalDiscount);
  const vatAmount = opts.vatAmount ?? 0;
  const paymentFee = opts.paymentFeeAmount ?? 0;
  const grandTotal = opts.grandTotal;
  const creditApplied = opts.creditApplied ?? 0;
  const amountPaid = opts.amountPaid ?? grandTotal;
  const outstandingBalance = opts.outstandingBalance ?? Math.max(0, grandTotal - amountPaid);

  const badge = statusBadgeStyle(opts.invoiceStatus);

  // ── services table rows ────────────────────────────────────────────────────
  const itemsRows = opts.items.map((item, idx) => {
    const originalUnitPrice = item.originalUnitPrice != null ? Number(item.originalUnitPrice) : null;
    const priceWasEdited = originalUnitPrice != null && originalUnitPrice > Number(item.unitPrice) + 0.0049;
    const displayUnitPrice = priceWasEdited ? originalUnitPrice : Number(item.unitPrice);
    const lineBasePrice = priceWasEdited ? originalUnitPrice : Number(item.unitPrice);
    const lineNet = lineBasePrice * item.quantity;
    const disc = item.discountAmount ?? 0;
    const taxable = Math.max(0, lineNet - disc);
    const vatRate = item.vatRate ?? (vatAmount > 0 ? 0.05 : 0);
    const vatLine = truncateCurrency(taxable * vatRate);
    const lineTotal = truncateCurrency(taxable + vatLine);
    const teethLabel = item.teeth && item.teeth.length > 0 ? ` <span style="font-size:8px;color:#888;">(Tooth #${item.teeth.join(", #")})</span>` : "";
    const unitPriceHtml = fmt(displayUnitPrice);
    return `
      <tr>
        <td style="text-align:center;">${idx + 1}</td>
        <td>${escHtml(item.description)}${teethLabel}</td>
        <td>${escHtml(item.providerName || "-")}</td>
        <td style="text-align:center;">${item.quantity}</td>
        <td style="text-align:right;">${unitPriceHtml}</td>
        <td style="text-align:right;">${disc > 0 ? fmt(disc) : "-"}</td>
        <td style="text-align:right;">${fmt(taxable)}</td>
        <td style="text-align:center;">${vatRate > 0 ? `${(vatRate * 100).toFixed(0)}%` : "0%"}</td>
        <td style="text-align:right;">${vatRate > 0 ? fmt(vatLine) : "-"}</td>
        <td style="text-align:right;font-weight:600;">${fmt(lineTotal)}</td>
      </tr>`;
  }).join("");

  const treatmentPlanPlanTotal = opts.treatmentPlanTotalAmount != null ? Number(opts.treatmentPlanTotalAmount || 0) : null;
  const treatmentPlanPaidToday = opts.treatmentPlanPaidToday != null ? Number(opts.treatmentPlanPaidToday || 0) : null;
  const treatmentPlanBalanceAfterToday = opts.treatmentPlanBalanceAfterToday != null ? Number(opts.treatmentPlanBalanceAfterToday || 0) : null;
  const treatmentPlanPlannedVisits = opts.treatmentPlanPlannedVisits != null ? Number(opts.treatmentPlanPlannedVisits || 0) : null;
  const treatmentPlanCompletedVisits = opts.treatmentPlanCompletedVisits != null ? Number(opts.treatmentPlanCompletedVisits || 0) : null;
  const treatmentPlanAllocationSummary = (opts.paymentAllocations ?? [])
    .map((alloc) => `${fmt(alloc.customerChargedAmount)} (${alloc.methodLabel})`)
    .join(" + ");

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
  const logoAlignmentClass = logoSettings.alignment === "center"
    ? "logo-align-center"
    : logoSettings.alignment === "right"
      ? "logo-align-right"
      : "logo-align-left";
  const logoOffsetStyle = logoSettings.offsetXMm !== 0 || logoSettings.offsetYMm !== 0
    ? `transform: translate(${logoSettings.offsetXMm}mm, ${logoSettings.offsetYMm}mm);`
    : "";
  const logoStageWidthMm = hasLogo ? 42 : 0;
  const logoStageHeightMm = hasLogo ? 24 : 0;
  const previewPageClass = opts.previewPaperMode ? "page-shell preview-paper" : "page-shell";

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

    html { background: ${opts.previewPaperMode ? "#e2e8f0" : "#fff"}; }
    body {
      font-family: "Inter", Arial, "Aptos", sans-serif;
      font-size: 9pt;
      color: var(--text);
      background: ${opts.previewPaperMode ? "#e2e8f0" : "#fff"};
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .page-shell { background: #fff; }
    .page-shell.preview-paper {
      width: 210mm;
      min-height: 297mm;
      margin: 0 auto;
      padding: 12mm 14mm;
      box-shadow: 0 16px 40px rgba(15, 23, 42, 0.18);
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

    .header-left {
      position: relative;
      flex: 1;
      min-width: 0;
      min-height: ${logoStageHeightMm > 0 ? `${logoStageHeightMm}mm` : "0"};
      padding-right: 4mm;
    }
    .header-left.logo-align-center .clinic-info {
      text-align: center;
      padding-top: ${logoStageHeightMm > 0 ? `${logoStageHeightMm}mm` : "0"};
    }
    .header-left.logo-align-left .clinic-info {
      padding-left: ${logoStageWidthMm > 0 ? `${logoStageWidthMm}mm` : "0"};
    }
    .header-left.logo-align-right .clinic-info {
      padding-right: ${logoStageWidthMm > 0 ? `${logoStageWidthMm}mm` : "0"};
    }

    .logo-wrap {
      position: absolute;
      top: 0;
      z-index: 0;
      display: flex;
      align-items: flex-start;
      justify-content: flex-start;
      width: ${logoStageWidthMm > 0 ? `${logoStageWidthMm}mm` : "0"};
      min-width: ${logoStageWidthMm > 0 ? `${logoStageWidthMm}mm` : "0"};
      height: ${logoStageHeightMm > 0 ? `${logoStageHeightMm}mm` : "0"};
      min-height: ${logoStageHeightMm > 0 ? `${logoStageHeightMm}mm` : "0"};
      overflow: visible;
      pointer-events: none;
      ${logoOffsetStyle}
    }
    .header-left.logo-align-center .logo-wrap { justify-content: center; }
    .header-left.logo-align-right .logo-wrap { justify-content: flex-end; }
    .header-left.logo-align-left .logo-wrap { left: 0; }
    .header-left.logo-align-center .logo-wrap { left: 50%; transform: translate(calc(-50% + ${logoSettings.offsetXMm}mm), ${logoSettings.offsetYMm}mm); }
    .header-left.logo-align-right .logo-wrap { right: 0; }

    .logo-wrap img {
      display: block;
      max-width: ${logoSettings.widthMm}mm;
      max-height: ${logoSettings.heightMm}mm;
      width: auto;
      height: auto;
      object-fit: contain;
    }

    .clinic-info { position: relative; z-index: 1; line-height: 1.45; min-width: 0; }
    .clinic-name { font-size: 13pt; font-weight: 700; color: var(--secondary); }
    .clinic-detail { font-size: 8pt; color: #555; margin-top: 5px; line-height: 1.5; }

    .header-right { text-align: right; flex-shrink: 0; margin-left: 6px; }
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
    .treatment-plan-summary .value { vertical-align: top; }
    .treatment-plan-sub {
      margin-top: 2px;
      font-size: 7pt;
      line-height: 1.35;
      color: #666;
      font-weight: 400;
    }
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
    .footer-qr-block {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 8px;
    }
    .footer-qr-copy {
      text-align: left;
      max-width: 46mm;
    }
    .footer-qr-title {
      font-size: 8pt;
      font-weight: 700;
      color: var(--primary);
      margin-bottom: 2px;
    }
    .footer-qr-subtitle {
      font-size: 7pt;
      line-height: 1.35;
      color: #666;
    }

    @media print {
      html, body { background: #fff; }
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .page-shell,
      .page-shell.preview-paper {
        width: auto;
        min-height: 0;
        margin: 0;
        padding: 0;
        box-shadow: none;
      }
      .header { break-inside: avoid; }
      thead { display: table-header-group; }
    }
  </style>
</head>
<body>
  <div class="${previewPageClass}">

  <!-- ── HEADER ── -->
  <div class="header">
    <div class="header-left ${logoAlignmentClass}">
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
        ${totalDiscount > 0.005 ? `
        <tr>
          <td class="label">Subtotal / المجموع الفرعي</td>
          <td class="value">${fmt(originalSubtotal)}</td>
        </tr>` : `<tr><td class="label">Subtotal / المجموع الفرعي</td><td class="value">${fmt(subtotal)}</td></tr>`}
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

  ${treatmentPlanPlanTotal != null ? `
  <div class="section-heading">Plan Breakdown / تفاصيل الخطة</div>
  <table class="totals-table treatment-plan-summary">
    <tr><td class="label">Total Plan Cost / التكلفة الإجمالية للخطة</td><td class="value">${fmt(treatmentPlanPlanTotal)}</td></tr>
    <tr>
      <td class="label">Paid Today / المدفوع اليوم</td>
      <td class="value">
        ${fmt(treatmentPlanPaidToday ?? amountPaid)}
        ${treatmentPlanAllocationSummary ? `<div class="treatment-plan-sub">${escHtml(treatmentPlanAllocationSummary)}</div>` : ""}
      </td>
    </tr>
    ${paymentFee > 0.005 ? `<tr><td class="label">Payment Fee / رسوم الدفع</td><td class="value">${fmt(paymentFee)}</td></tr>` : ""}
    ${treatmentPlanBalanceAfterToday != null ? `<tr><td class="label">Balance / الرصيد المتبقي</td><td class="value">${fmt(treatmentPlanBalanceAfterToday)}</td></tr>` : ""}
    ${treatmentPlanPlannedVisits != null ? `<tr><td class="label">Visits / الزيارات</td><td class="value">${Math.max(0, treatmentPlanCompletedVisits ?? 0)}/${Math.max(0, treatmentPlanPlannedVisits)}</td></tr>` : ""}
  </table>` : ""}

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
     <div class="footer-qr-block">
       <div class="footer-qr-copy">
         <div class="footer-qr-title">Your Feedback Matters</div>
         <div class="footer-qr-subtitle">Please scan the QR code to review your visit.</div>
       </div>
       ${qrSvg}
     </div>
    </div>
  </div>
  </div>
</body>
</html>`;
}
