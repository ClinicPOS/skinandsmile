import type { Clinic } from "./types";
import { buildReceiptQrHtml, getReceiptLogoPath, printHtmlWhenImagesReady } from "./receipt-branding";
import {
  buildThermalLogoHtml,
  buildThermalReceiptCss,
  getThermalReceiptSettings,
} from "./thermal-receipt-branding";

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
  const clinicRoom = ctx.clinic?.room ? `2nd Floor, Room ${ctx.clinic.room.replace(/^Room\s+/i, "")}` : "";
  const clinicPhone = ctx.clinic?.phone || "";
  const clinicTrn = ctx.clinic?.trn || "";
  const clinicWhatsapp = ctx.clinic?.whatsapp || "";
  const clinicInstagram = ctx.clinic?.instagram || "";
  const clinicFacebook = ctx.clinic?.facebook || "";
  const clinicTiktok = ctx.clinic?.tiktok || "";
  const logoPath = getReceiptLogoPath(ctx.clinic, undefined, "thermal");
  const createdAt = new Date(ctx.createdAt || Date.now());
  const thermalSettings = getThermalReceiptSettings(ctx.clinic);
  const dateStr = createdAt.toLocaleDateString("en-GB");
  const timeStr = createdAt.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
  const referenceNo = (ctx.referenceNo || "").trim() || `TP-${String(createdAt.getTime()).slice(-6)}`;
  const receiptVatNote = ctx.clinic?.receipt_vat_note?.trim() || "VAT Included in Above Amount / الضريبة مشمولة في المبلغ أعلاه";
  const receiptThankYou = ctx.clinic?.receipt_thank_you?.trim() || "Thank you for choosing us. / شكراً لاختيارنا.";
  const receiptFinalMessage = ctx.clinic?.receipt_final_message?.trim() || "Wishing you a healthy smile. / نتمنى لك ابتسامة صحية.";
  const socialHtml = clinicInstagram || clinicFacebook || clinicTiktok
    ? `
      <div class="footer-center" style="margin-top:6px;">Follow us:</div>
      ${clinicInstagram ? `<div class="footer-center">Instagram: ${escapeHtml(clinicInstagram)}</div>` : ""}
      ${clinicFacebook ? `<div class="footer-center">Facebook: ${escapeHtml(clinicFacebook)}</div>` : ""}
      ${clinicTiktok ? `<div class="footer-center">TikTok: ${escapeHtml(clinicTiktok)}</div>` : ""}
    `
    : "";
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
    ${buildThermalReceiptCss(thermalSettings)}
    .service-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) max-content;
      column-gap: 4px;
      width: 100%;
      max-width: 100%;
      align-items: start;
    }
    .service-row span:first-child { min-width: 0; }
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
  </style>
</head>
<body>
  ${buildThermalLogoHtml(logoPath, "Clinic logo")}

  <div class="double">PAYMENT RECEIPT / إيصال الدفع</div>

  <div class="clinic-name">${escapeHtml(clinicName)}</div>
  <div class="address">
    ${clinicTitle ? `<div>${escapeHtml(clinicTitle)}</div>` : ""}
    ${clinicAddress ? clinicAddress.split(/\n|\n/).map((line: string) => `<div>${escapeHtml(line)}</div>`).join("") : ""}
    ${clinicRoom && !clinicAddress.toLowerCase().includes(clinicRoom.toLowerCase()) && !clinicAddress.includes("2nd Floor") ? `<div>${escapeHtml(clinicRoom)}</div>` : ""}
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
  <div class="footer-center">${escapeHtml(receiptVatNote)}</div>
  <div class="footer-center">${escapeHtml(receiptThankYou)}</div>
  ${socialHtml}
  <div class="hr"></div>
  <div style="text-align:center;font-size:9px;line-height:1.4;">
    ${clinicPhone ? `<div>Phone: ${escapeHtml(clinicPhone)}</div>` : ""}
    ${clinicWhatsapp ? `<div>WhatsApp: ${escapeHtml(clinicWhatsapp)}</div>` : ""}
  </div>
  <div class="hr"></div>
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
