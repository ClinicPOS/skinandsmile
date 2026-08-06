import type { Clinic } from "./types";
import { buildReceiptQrHtml, getReceiptLogoPath, printHtmlWhenImagesReady } from "./receipt-branding";

type TreatmentPlanReceiptAllocation = {
  methodLabel: string;
  invoiceAllocationAmount: number;
  feeAmount: number;
  customerChargedAmount: number;
};

export type TreatmentPlanPaymentReceiptContext = {
  clinic: Clinic | null;
  patientName: string;
  patientFileNo?: string;
  planTitle: string;
  paymentArrangement: string;
  agreedTotal: number;
  amountSettledToday: number;
  remainingAfterToday: number;
  totalFeeAmount: number;
  totalCustomerPaid: number;
  cashierName: string;
  services: Array<{ name: string; price: number; quantity?: number; teeth?: string[] }>;
  allocations: TreatmentPlanReceiptAllocation[];
  createdAt?: string;
  referenceNo?: string;
};

function escapeHtml(value: string): string {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function buildTreatmentPlanPaymentReceiptHtml(ctx: TreatmentPlanPaymentReceiptContext): string {
  const clinicName = (ctx.clinic?.receipt_print_name || ctx.clinic?.name || "Skin and Smile Dental Clinic")
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  const clinicTitle = ctx.clinic?.receipt_title?.trim() || "DENTAL CLINIC";
  const clinicAddress = ctx.clinic?.address || "";
  const clinicPhone = ctx.clinic?.phone || "";
  const clinicTrn = ctx.clinic?.trn || "";
  const clinicWhatsapp = ctx.clinic?.whatsapp || "";
  const clinicInstagram = ctx.clinic?.instagram || "";
  const clinicFacebook = ctx.clinic?.facebook || "";
  const clinicTiktok = ctx.clinic?.tiktok || "";
  const logoPath = getReceiptLogoPath(ctx.clinic, undefined, "thermal");
  const createdAt = new Date(ctx.createdAt || Date.now());
  const dateStr = createdAt.toLocaleDateString("en-GB");
  const timeStr = createdAt.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
  const referenceNo = (ctx.referenceNo || "").trim() || `TP-${String(createdAt.getTime()).slice(-6)}`;
  const receiptThankYou = ctx.clinic?.receipt_thank_you?.trim() || "Thank you for choosing us. / شكراً لاختيارنا.";
  const receiptFinalMessage = ctx.clinic?.receipt_final_message?.trim() || "Wishing you a healthy smile. / نتمنى لك ابتسامة صحية.";
  const qrHtml = buildReceiptQrHtml({
    clinic: ctx.clinic,
    clinicDisplayName: clinicName,
    clinicPhone,
    clinicWhatsapp,
    clinicInstagram,
    clinicFacebook,
    clinicTiktok,
    invoiceNo: referenceNo,
  });

  const serviceRows = ctx.services.map((service) => {
    const qty = service.quantity ?? 1;
    const total = Number(service.price || 0) * qty;
    const teeth = service.teeth && service.teeth.length > 0 ? ` — Tooth #${service.teeth.join(", #")}` : "";
    return `
      <div class="row service-row">
        <span class="service-description">${escapeHtml(service.name)}${escapeHtml(teeth)}</span>
        <span class="service-amount">AED ${total.toFixed(2)}</span>
      </div>
    `;
  }).join("");

  const allocationRows = ctx.allocations.map((allocation) => `
      <div class="row"><span>${escapeHtml(allocation.methodLabel)}</span><span>AED ${Number(allocation.customerChargedAmount || 0).toFixed(2)}</span></div>
    <div class="row sub"><span>Invoice settled / تم تسوية الفاتورة</span><span>AED ${Number(allocation.invoiceAllocationAmount || 0).toFixed(2)}</span></div>
    ${Number(allocation.feeAmount || 0) > 0.0049 ? `<div class="row sub"><span>Fee / الرسوم</span><span>AED ${Number(allocation.feeAmount || 0).toFixed(2)}</span></div>` : ""}
  `).join("<div class=\"divider\"></div>");

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Treatment Plan Payment Receipt</title>
  <style>
    * { box-sizing: border-box; }
    @page { size: 80mm auto; margin: 0; }
    body {
      font-family: Arial, Helvetica, sans-serif;
      width: 72mm;
      margin: 0;
      padding: 2mm;
      font-size: 10px;
      line-height: 1.25;
      color: #000;
      background: #fff;
      overflow-x: hidden;
      -webkit-text-size-adjust: 100%;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
      font-weight: 500;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .center { text-align: center; }
    .hr { border-top: 1px dashed #000; margin: 5px 0; }
    .double {
      border-top: 2px solid #000;
      border-bottom: 2px solid #000;
      padding: 3px 0;
      margin: 5px 0;
      text-align: center;
      font-weight: 700;
    }
    .logo-wrap { display: flex; justify-content: center; margin-bottom: 4px; }
    .logo {
      display: block;
      width: 100%;
      max-width: 68mm;
      max-height: 36mm;
      height: auto;
      object-fit: contain;
      image-rendering: -webkit-optimize-contrast;
      image-rendering: crisp-edges;
    }
    .clinic-name { text-align: center; font-size: 14px; font-weight: 700; line-height: 1.1; }
    .address { text-align: center; font-size: 9px; line-height: 1.25; margin-top: 4px; }
    .row {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 6px;
      margin: 1px 0;
    }
    .row span:first-child { min-width: 30mm; }
    .row span:last-child {
      text-align: right;
      flex: 1;
      min-width: 0;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .service-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) max-content;
      column-gap: 4px;
      width: 100%;
      max-width: 100%;
      align-items: start;
    }
    .service-description {
      min-width: 0;
      overflow-wrap: anywhere;
      word-break: normal;
    }
    .service-amount {
      justify-self: end;
      text-align: right;
      white-space: nowrap;
      overflow-wrap: normal;
      word-break: normal;
    }
    .head-row { display: flex; justify-content: space-between; font-weight: 700; }
    .footer-center { text-align: center; margin-top: 4px; }
    .meta { font-size: 9px; line-height: 1.25; }
    @media print {
      @page { size: 80mm auto; margin: 0; }
      body { width: 72mm; padding: 2mm; }
      * { color: #000 !important; border-color: #000 !important; background-color: #fff !important; }
      .logo { width: 100%; max-width: 68mm; max-height: 36mm; height: auto; }
    }
  </style>
</head>
<body>
  <div class="logo-wrap" id="logo-wrap">
    <img class="logo" src="${logoPath}" alt="Clinic logo" loading="eager" decoding="async" onerror="document.getElementById('logo-wrap').style.display='none'" />
  </div>

  <div class="double">PAYMENT RECEIPT / إيصال الدفع</div>

  <div class="clinic-name">${escapeHtml(clinicName)}</div>
  <div class="address">
    ${clinicTitle ? `<div>${escapeHtml(clinicTitle)}</div>` : ""}
    ${clinicAddress ? clinicAddress.split(/\n|\n/).map((line: string) => `<div>${escapeHtml(line)}</div>`).join("") : ""}
    ${clinicPhone ? `<div>${escapeHtml(`Tel / هاتف: ${clinicPhone}`)}</div>` : ""}
    ${clinicTrn ? `<div style="margin-top:2px;font-weight:700;">TRN / الرقم الضريبي: ${escapeHtml(clinicTrn)}</div>` : ""}
  </div>

  <div class="hr"></div>

  <div class="row"><span>Date / التاريخ</span><span>${dateStr} ${timeStr}</span></div>
  <div class="row"><span>Cashier / أمين الصندوق</span><span>${escapeHtml(ctx.cashierName || "Reception")}</span></div>
  <div class="row"><span>Ref / المرجع</span><span>${escapeHtml(referenceNo)}</span></div>

  <div class="hr"></div>
  <div class="row"><span>Patient / المريض</span><span>${escapeHtml(ctx.patientName)}</span></div>
  ${ctx.patientFileNo ? `<div class="row"><span>File No. / رقم الملف</span><span>#${escapeHtml(ctx.patientFileNo)}</span></div>` : ""}
  <div class="row"><span>Plan / الخطة</span><span>${escapeHtml(ctx.planTitle)}</span></div>
  <div class="row"><span>Arrangement / الترتيب</span><span>${escapeHtml(ctx.paymentArrangement)}</span></div>

  <div class="hr"></div>
  <div class="head-row"><span>Selected Services / الخدمات المختارة</span><span></span></div>
  ${serviceRows}

  <div class="hr"></div>
  <div class="head-row"><span>Payment Breakdown / تفاصيل الدفع</span><span></span></div>
  ${allocationRows}

  <div class="hr"></div>
  <div class="row"><span>Plan Total / إجمالي الخطة</span><span>AED ${Number(ctx.agreedTotal || 0).toFixed(2)}</span></div>
  <div class="row"><span>Invoice Settled Today / الفاتورة المسددة اليوم</span><span>AED ${Number(ctx.amountSettledToday || 0).toFixed(2)}</span></div>
  <div class="row"><span>Payment Fee / رسوم الدفع</span><span>AED ${Number(ctx.totalFeeAmount || 0).toFixed(2)}</span></div>
  <div class="row" style="font-weight:700;"><span>Total Customer Paid / إجمالي ما دفعه العميل</span><span>AED ${Number(ctx.totalCustomerPaid || 0).toFixed(2)}</span></div>
  <div class="row"><span>Remaining Plan Balance / الرصيد المتبقي للخطة</span><span>AED ${Number(ctx.remainingAfterToday || 0).toFixed(2)}</span></div>

  <div class="hr"></div>
  <div class="footer-center">${escapeHtml(receiptThankYou)}</div>
  <div class="footer-center">${escapeHtml(receiptFinalMessage)}</div>
  <div class="hr"></div>
  ${qrHtml}
</body>
</html>`;
}

export function printTreatmentPlanPaymentReceipt(ctx: TreatmentPlanPaymentReceiptContext): void {
  const html = buildTreatmentPlanPaymentReceiptHtml(ctx);
  printHtmlWhenImagesReady(html, "Please allow popups to print the treatment plan receipt.");
}
