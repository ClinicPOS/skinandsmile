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
      <div class="row">
        <span>${escapeHtml(service.name)}${escapeHtml(teeth)}</span>
        <span>AED ${total.toFixed(2)}</span>
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
    @page { size: 80mm auto; margin: 4mm; }
    body {
      font-family: 'Segoe UI', Arial, sans-serif;
      width: 72mm;
      margin: 0;
      color: #111827;
      line-height: 1.2;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .center { text-align: center; }
    .divider { border-top: 1px dashed #334155; margin: 6px 0; }
    .row { display: flex; justify-content: space-between; gap: 6px; margin: 2px 0; font-size: 10.5px; }
    .row span:last-child { text-align: right; white-space: nowrap; }
    .row.sub { font-size: 10px; color: #475569; }
    .title { font-size: 12px; letter-spacing: 1px; font-weight: 700; margin-top: 4px; }
    .clinic { font-size: 11px; font-weight: 700; margin-top: 2px; }
    .meta { font-size: 9.5px; color: #475569; }
    .totals .row { font-size: 10.5px; }
    .totals .total { font-size: 11px; font-weight: 700; }
    .footer { text-align: center; font-size: 9.5px; color: #475569; margin-top: 6px; }
    .logo-wrap {
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 18mm;
      margin: 1mm 0 2mm;
    }
    img.logo {
      display: block;
      width: auto;
      max-width: 56mm;
      max-height: 16mm;
      height: auto;
      object-fit: contain;
      margin: 0 auto;
      image-rendering: -webkit-optimize-contrast;
      image-rendering: crisp-edges;
    }
  </style>
</head>
<body>
  <div class="center">
    <div class="logo-wrap">
      <img class="logo" src="${logoPath}" alt="Clinic logo" loading="eager" decoding="async" />
    </div>
    <div class="clinic">${escapeHtml(clinicName)}</div>
    <div class="meta">${escapeHtml(clinicTitle)}</div>
    ${clinicAddress ? `<div class="meta">${escapeHtml(clinicAddress).replace(/\n/g, "<br/>")}</div>` : ""}
    ${clinicPhone ? `<div class="meta">Tel / هاتف: ${escapeHtml(clinicPhone)}</div>` : ""}
    ${clinicTrn ? `<div class="meta">TRN / الرقم الضريبي: ${escapeHtml(clinicTrn)}</div>` : ""}
  </div>

  <div class="title center">PAYMENT RECEIPT / إيصال الدفع</div>
  <div class="meta center">Treatment Plan Collection / تحصيل خطة العلاج</div>
  <div class="divider"></div>

  <div class="row"><span>Date / التاريخ</span><span>${dateStr} ${timeStr}</span></div>
  <div class="row"><span>Cashier / أمين الصندوق</span><span>${escapeHtml(ctx.cashierName || "Reception")}</span></div>
  <div class="row"><span>Ref / المرجع</span><span>${escapeHtml(referenceNo)}</span></div>

  <div class="divider"></div>
  <div class="row"><span>Patient / المريض</span><span>${escapeHtml(ctx.patientName)}</span></div>
  ${ctx.patientFileNo ? `<div class="row"><span>File No. / رقم الملف</span><span>#${escapeHtml(ctx.patientFileNo)}</span></div>` : ""}
  <div class="row"><span>Plan / الخطة</span><span>${escapeHtml(ctx.planTitle)}</span></div>
  <div class="row"><span>Arrangement / الترتيب</span><span>${escapeHtml(ctx.paymentArrangement)}</span></div>

  <div class="divider"></div>
  <div class="meta" style="font-weight:700; margin-bottom:2px;">Selected Services / الخدمات المختارة</div>
  ${serviceRows}

  <div class="divider"></div>
  <div class="meta" style="font-weight:700; margin-bottom:2px;">Payment Breakdown / تفاصيل الدفع</div>
  ${allocationRows}

  <div class="divider"></div>
  <div class="totals">
    <div class="row"><span>Plan Total / إجمالي الخطة</span><span>AED ${Number(ctx.agreedTotal || 0).toFixed(2)}</span></div>
    <div class="row"><span>Invoice Settled Today / الفاتورة المسددة اليوم</span><span>AED ${Number(ctx.amountSettledToday || 0).toFixed(2)}</span></div>
    <div class="row"><span>Payment Fee / رسوم الدفع</span><span>AED ${Number(ctx.totalFeeAmount || 0).toFixed(2)}</span></div>
    <div class="row total"><span>Total Customer Paid / إجمالي ما دفعه العميل</span><span>AED ${Number(ctx.totalCustomerPaid || 0).toFixed(2)}</span></div>
    <div class="row"><span>Remaining Plan Balance / الرصيد المتبقي للخطة</span><span>AED ${Number(ctx.remainingAfterToday || 0).toFixed(2)}</span></div>
  </div>

  <div class="footer">${escapeHtml(receiptThankYou)}</div>
  <div class="footer">${escapeHtml(receiptFinalMessage)}</div>
  <div class="divider"></div>
  ${qrHtml}
</body>
</html>`;
}

export function printTreatmentPlanPaymentReceipt(ctx: TreatmentPlanPaymentReceiptContext): void {
  const html = buildTreatmentPlanPaymentReceiptHtml(ctx);
  printHtmlWhenImagesReady(html, "Please allow popups to print the treatment plan receipt.");
}
