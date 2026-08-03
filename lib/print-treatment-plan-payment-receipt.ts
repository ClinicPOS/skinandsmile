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
  const logoPath = getReceiptLogoPath(ctx.clinic);
  const createdAt = new Date(ctx.createdAt || Date.now());
  const dateStr = createdAt.toLocaleDateString("en-GB");
  const timeStr = createdAt.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
  const referenceNo = (ctx.referenceNo || "").trim() || `TP-${String(createdAt.getTime()).slice(-6)}`;
  const receiptThankYou = ctx.clinic?.receipt_thank_you?.trim() || "Thank you for choosing us.";
  const receiptFinalMessage = ctx.clinic?.receipt_final_message?.trim() || "Wishing you a healthy smile.";
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
      <div class="row sub"><span>Invoice settled</span><span>AED ${Number(allocation.invoiceAllocationAmount || 0).toFixed(2)}</span></div>
      ${Number(allocation.feeAmount || 0) > 0.0049 ? `<div class="row sub"><span>Fee</span><span>AED ${Number(allocation.feeAmount || 0).toFixed(2)}</span></div>` : ""}
  `).join("<div class=\"divider\"></div>");

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Treatment Plan Payment Receipt</title>
  <style>
    @page { size: 80mm auto; margin: 4mm; }
    body { font-family: 'Segoe UI', Arial, sans-serif; width: 72mm; margin: 0; color: #111827; }
    .center { text-align: center; }
    .divider { border-top: 1px dashed #334155; margin: 6px 0; }
    .row { display: flex; justify-content: space-between; gap: 6px; margin: 2px 0; font-size: 11px; }
    .row span:last-child { text-align: right; white-space: nowrap; }
    .row.sub { font-size: 10px; color: #475569; }
    .title { font-size: 13px; letter-spacing: 2px; font-weight: 700; margin-top: 6px; }
    .clinic { font-size: 12px; font-weight: 700; }
    .meta { font-size: 10px; color: #475569; }
    .totals .row { font-size: 12px; }
    .totals .total { font-size: 13px; font-weight: 700; }
    .footer { text-align: center; font-size: 10px; color: #475569; margin-top: 6px; }
    img.logo { max-width: 52mm; max-height: 18mm; object-fit: contain; margin-bottom: 4px; }
  </style>
</head>
<body>
  <div class="center">
    <img class="logo" src="${logoPath}" alt="Clinic logo" />
    <div class="clinic">${escapeHtml(clinicName)}</div>
    <div class="meta">${escapeHtml(clinicTitle)}</div>
    ${clinicAddress ? `<div class="meta">${escapeHtml(clinicAddress).replace(/\n/g, "<br/>")}</div>` : ""}
    ${clinicPhone ? `<div class="meta">Tel: ${escapeHtml(clinicPhone)}</div>` : ""}
    ${clinicTrn ? `<div class="meta">TRN: ${escapeHtml(clinicTrn)}</div>` : ""}
  </div>

  <div class="title center">PAYMENT RECEIPT</div>
  <div class="meta center">Treatment Plan Collection</div>
  <div class="divider"></div>

  <div class="row"><span>Date</span><span>${dateStr} ${timeStr}</span></div>
  <div class="row"><span>Cashier</span><span>${escapeHtml(ctx.cashierName || "Reception")}</span></div>
  <div class="row"><span>Ref</span><span>${escapeHtml(referenceNo)}</span></div>

  <div class="divider"></div>
  <div class="row"><span>Patient</span><span>${escapeHtml(ctx.patientName)}</span></div>
  ${ctx.patientFileNo ? `<div class="row"><span>File No.</span><span>#${escapeHtml(ctx.patientFileNo)}</span></div>` : ""}
  <div class="row"><span>Plan</span><span>${escapeHtml(ctx.planTitle)}</span></div>
  <div class="row"><span>Arrangement</span><span>${escapeHtml(ctx.paymentArrangement)}</span></div>

  <div class="divider"></div>
  <div class="meta" style="font-weight:700; margin-bottom:2px;">Selected Services</div>
  ${serviceRows}

  <div class="divider"></div>
  <div class="meta" style="font-weight:700; margin-bottom:2px;">Payment Breakdown</div>
  ${allocationRows}

  <div class="divider"></div>
  <div class="totals">
    <div class="row"><span>Plan Total</span><span>AED ${Number(ctx.agreedTotal || 0).toFixed(2)}</span></div>
    <div class="row"><span>Invoice Settled Today</span><span>AED ${Number(ctx.amountSettledToday || 0).toFixed(2)}</span></div>
    <div class="row"><span>Payment Fee</span><span>AED ${Number(ctx.totalFeeAmount || 0).toFixed(2)}</span></div>
    <div class="row total"><span>Total Customer Paid</span><span>AED ${Number(ctx.totalCustomerPaid || 0).toFixed(2)}</span></div>
    <div class="row"><span>Remaining Plan Balance</span><span>AED ${Number(ctx.remainingAfterToday || 0).toFixed(2)}</span></div>
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
