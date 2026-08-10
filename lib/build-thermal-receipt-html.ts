import { buildReceiptQrHtml, getReceiptLogoPath } from "./receipt-branding";
import {
  buildThermalLogoHtml,
  buildThermalReceiptCss,
  getThermalReceiptSettings,
} from "./thermal-receipt-branding";
import type { Clinic } from "./types";

export interface ThermalReceiptItem {
  name: string;
  quantity: number;
  price: number;
  originalPrice?: number | null;
  teeth?: string[];
  allocatedGlobalDiscountAmount?: number | null;
  taxableAmount?: number | null;
  vatRate?: number | null;
  vatAmount?: number | null;
  finalLineTotal?: number | null;
}

export interface ThermalReceiptAllocation {
  methodVariant: string;
  customerChargedAmount: number;
  invoiceAllocationAmount: number;
  feeAmount: number;
  feeRate: number;
  providerReferenceNumber?: string | null;
}

export interface BuildThermalReceiptHtmlOptions {
  title: string;
  clinic: Clinic | null | undefined;
  invoiceNumber: string;
  dateValue: string;
  timeValue: string;
  cashierName: string;
  doctorName: string;
  patientName: string;
  patientPhone: string;
  patientFileNumber: string;
  doctorField: string;
  items: ThermalReceiptItem[];
  subtotal: number;
  discountAmount: number;
  discountType?: "AED" | "%";
  discountInput?: string;
  vat: number;
  total: number;
  paymentFeeAmount?: number;
  allocations: ThermalReceiptAllocation[];
  creditUsed: number;
  outstandingBalance: number;
  notes: string;
  paymentMethod: string;
  receiptHeaderLabel?: string;
  manualDiscountAmount?: number;
  globalDiscountAmount?: number;
}

export function buildThermalReceiptHtml(options: BuildThermalReceiptHtmlOptions): string {
  const {
    title,
    clinic,
    invoiceNumber,
    dateValue,
    timeValue,
    cashierName,
    doctorName,
    patientName,
    patientPhone,
    patientFileNumber,
    doctorField,
    items,
    subtotal,
    discountAmount,
    discountType,
    discountInput,
    vat,
    total,
    paymentFeeAmount,
    allocations,
    creditUsed,
    outstandingBalance,
    notes,
    paymentMethod,
    receiptHeaderLabel,
    manualDiscountAmount,
    globalDiscountAmount,
  } = options;

  const logoPath = getReceiptLogoPath(clinic, undefined, "thermal");
  const thermalSettings = getThermalReceiptSettings(clinic);
  const clinicDisplayName = (clinic?.receipt_print_name || clinic?.name || "Skin and Smile Dental Clinic")
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  const receiptTitle = clinic?.receipt_title || "TAX INVOICE";
  const receiptHeading = receiptHeaderLabel || receiptTitle;
  const isAlDanaClinic = (clinic?.name || "").toLowerCase().includes("al dana");
  const clinicAddress = clinic?.address || (
    isAlDanaClinic
      ? "Al Dana Center - 4th Floor room 408 - Al Maktoum Rd - Al Muraqqabat - Deira - Dubai"
      : "Al Satwa, Dubai, UAE\nSame Building of Almaya Supermarket\nNear Satwa Bus Station"
  );
  const clinicRoom = clinic?.room ? `2nd Floor, Room ${clinic.room.replace(/^Room\s+/i, "")}` : "";
  const clinicTrn = clinic?.trn || "";
  const clinicPhone = clinic?.phone || (isAlDanaClinic ? "054 460 1011" : "");
  const clinicWhatsapp = clinic?.whatsapp || "";
  const isSkinAndSmile = !clinic || clinic.logo !== "altamuze";
  const clinicInstagram = clinic?.instagram || (isSkinAndSmile ? "@skinandsmiledentalclinic" : "");
  const clinicFacebook = clinic?.facebook || "";
  const clinicTiktok = clinic?.tiktok || (isSkinAndSmile ? "@skinandsmile" : "");
  const receiptVatNote = clinic?.receipt_vat_note || "VAT Included in Above Amount / الضريبة مشمولة في المبلغ أعلاه";
  const receiptThankYou = clinic?.receipt_thank_you || "Thank you for visiting us / شكراً لزيارتك لنا";
  const receiptFinalMessage = clinic?.receipt_final_message || "Thank you for Visiting US!";

  const socialHtml = clinicInstagram || clinicFacebook || clinicTiktok
    ? `
      <div class="footer-center" style="margin-top:6px;">Follow us:</div>
      ${clinicInstagram ? `<div class="footer-center">Instagram: ${clinicInstagram}</div>` : ""}
      ${clinicFacebook ? `<div class="footer-center">Facebook: ${clinicFacebook}</div>` : ""}
      ${clinicTiktok ? `<div class="footer-center">TikTok: ${clinicTiktok}</div>` : ""}
      `
    : "";

  const qrHtml = buildReceiptQrHtml({
    clinic,
    clinicDisplayName,
    clinicPhone,
    clinicWhatsapp,
    clinicInstagram,
    clinicFacebook,
    clinicTiktok,
    invoiceNo: invoiceNumber,
  });

  const itemsHtml = items
    .map((item) => {
      const qty = item.quantity ?? 1;
      const discountedLineTotal = Number(item.price) * qty;
      const originalLineTotal = item.originalPrice != null ? Number(item.originalPrice) * qty : null;
      const hasTruePromo = originalLineTotal != null && originalLineTotal > discountedLineTotal + 0.0049;
      const hasPriceIncrease = originalLineTotal != null && discountedLineTotal > originalLineTotal + 0.0049;
      const hasSnapshotDetails = item.taxableAmount != null
        && item.vatRate != null
        && item.vatAmount != null
        && item.finalLineTotal != null;
      const allocatedGlobalDiscountAmount = Number(item.allocatedGlobalDiscountAmount ?? 0);
      const vatRate = item.vatRate != null ? Number(item.vatRate) : null;
      const vatAmount = item.vatAmount != null ? Number(item.vatAmount) : null;
      const finalLineTotal = item.finalLineTotal != null ? Number(item.finalLineTotal) : null;
      const qtyLabel = qty > 1 ? ` <span style="font-size:9px;">×${qty} Unit</span>` : "";
      const teethLabel = item.teeth || [];
      const teethDisplay = teethLabel.length > 0 ? ` (Tooth #${teethLabel.join(", #")})` : "";
      if (!hasSnapshotDetails) {
        const displayLineTotal = hasTruePromo && originalLineTotal != null ? originalLineTotal : discountedLineTotal;
        return hasTruePromo
          ? `
          <div class="row item-row">
            <span class="item-name">${item.name}${qtyLabel}${teethDisplay} <span style="font-size:10px;">(Promo)</span></span>
            <span class="amount" style="text-align:right;">${displayLineTotal === 0 ? "Free" : `AED ${displayLineTotal.toFixed(2)}`}</span>
          </div>`
          : `
          <div class="row item-row">
            <span class="item-name">${item.name}${qtyLabel}${teethDisplay}</span>
            <span class="amount">${discountedLineTotal === 0 ? "Free" : `AED ${discountedLineTotal.toFixed(2)}`}</span>
          </div>`;
      }

      const detailRows: string[] = [];
      if (hasTruePromo && originalLineTotal != null) {
        detailRows.push(`<div class="row detail-row"><span>Original Price</span><span>AED ${originalLineTotal.toFixed(2)}</span></div>`);
        detailRows.push(`<div class="row detail-row"><span>Promo Price</span><span>AED ${discountedLineTotal.toFixed(2)}</span></div>`);
      } else if (hasPriceIncrease && originalLineTotal != null) {
        detailRows.push(`<div class="row detail-row"><span>Original Price</span><span>AED ${originalLineTotal.toFixed(2)}</span></div>`);
        detailRows.push(`<div class="row detail-row"><span>Price Adjustment</span><span>AED ${discountedLineTotal.toFixed(2)}</span></div>`);
      } else if (allocatedGlobalDiscountAmount > 0.0049 || (vatAmount ?? 0) > 0.0049 || Math.abs((finalLineTotal ?? discountedLineTotal) - discountedLineTotal) > 0.0049) {
        detailRows.push(`<div class="row detail-row"><span>Price</span><span>AED ${discountedLineTotal.toFixed(2)}</span></div>`);
      }

      if (allocatedGlobalDiscountAmount > 0.0049) {
        detailRows.push(`<div class="row detail-row"><span>Discount</span><span>-AED ${allocatedGlobalDiscountAmount.toFixed(2)}</span></div>`);
      }
      if ((vatRate ?? 0) > 0.0049 && (vatAmount ?? 0) > 0.0049) {
        detailRows.push(`<div class="row detail-row"><span>VAT ${(vatRate! * 100).toFixed(0)}%</span><span>AED ${vatAmount!.toFixed(2)}</span></div>`);
      }

      const shouldShowLineTotal = hasTruePromo
        || hasPriceIncrease
        || allocatedGlobalDiscountAmount > 0.0049
        || (vatAmount ?? 0) > 0.0049
        || Math.abs((finalLineTotal ?? discountedLineTotal) - discountedLineTotal) > 0.0049;

      if (shouldShowLineTotal && finalLineTotal != null) {
        detailRows.push(`<div class="row detail-row detail-total"><span>Line Total</span><span>AED ${finalLineTotal.toFixed(2)}</span></div>`);
      }

      if (detailRows.length === 0) {
        return `
          <div class="row item-row">
            <span class="item-name">${item.name}${qtyLabel}${teethDisplay}</span>
            <span class="amount">${discountedLineTotal === 0 ? "Free" : `AED ${discountedLineTotal.toFixed(2)}`}</span>
          </div>`;
      }

      return `
        <div class="item-block">
          <div class="row item-row">
            <span class="item-name">${item.name}${qtyLabel}${teethDisplay}</span>
            <span class="amount"></span>
          </div>
          ${detailRows.join("")}
        </div>`;
    })
    .join("");

  const allocationFeeTotal = allocations.length > 0
    ? allocations.reduce((sum, row) => sum + row.feeAmount, 0)
    : Number(paymentFeeAmount ?? 0);
  const paidToday = total + allocationFeeTotal - outstandingBalance;
  const isPartial = outstandingBalance > 0.0049;
  const originalSubtotal = subtotal;
  const grandTotalBeforeFees = Math.max(0, subtotal - discountAmount);
  const manualDiscountTotal = Number(manualDiscountAmount ?? 0);
  const globalDiscountTotal = Number(globalDiscountAmount ?? 0);
  const showSnapshotDiscountBreakdown = manualDiscountTotal > 0.0049 || globalDiscountTotal > 0.0049;

  const escapeReceiptText = (value: string) =>
    value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  const notesForReceipt = escapeReceiptText(notes.trim());

  const paymentStatusRows = `
      ${creditUsed > 0.0049
        ? `
      <div class="row"><span>Patient Credit Used / الرصيد المستخدم</span><span>: - AED ${creditUsed.toFixed(2)}</span></div>
      <div class="row"><span>Payment Received / المبلغ المستلم</span><span>: AED ${paidToday.toFixed(2)}</span></div>`
        : ""}
      ${isPartial
        ? `
      ${creditUsed <= 0.0049 ? `<div class="row"><span>Paid Today / المدفوع اليوم</span><span>: AED ${paidToday.toFixed(2)}</span></div>` : ""}
      <div class="row"><span>Outstanding / المبلغ المتبقي</span><span>: AED ${outstandingBalance.toFixed(2)}</span></div>`
        : ""}
      <div class="row" style="font-weight:700;"><span>Payment Status / حالة الدفع</span><span>: ${isPartial ? "PARTIAL PAYMENT" : "PAID"}</span></div>
    `;

  const paymentSummaryLabel =
    allocations.length > 0
      ? allocations.map((a) => a.methodVariant.replace(/_/g, " ").toUpperCase()).join(" + ")
      : paymentMethod
        ? paymentMethod.toUpperCase()
        : "-";

  let paymentSection = `
      <div class="row"><span>Payment Method / طريقة الدفع</span><span>: ${
        creditUsed > 0.0049 && paidToday <= 0.0049 ? "PATIENT CREDIT" : paymentSummaryLabel
      }</span></div>
      ${allocationFeeTotal > 0 ? `<div class="row"><span>Payment Fee / رسوم الدفع</span><span>: AED ${allocationFeeTotal.toFixed(2)}</span></div>` : ""}
      <div class="row"><span>Amount Paid / المبلغ المدفوع</span><span>: AED ${paidToday.toFixed(2)}</span></div>
    `;

  if (allocations.length > 0) {
    paymentSection = `
        <div class="row"><span>Payment Method / طريقة الدفع</span><span>: ${paymentSummaryLabel}</span></div>
        ${allocations
          .map(
            (row) => `
          <div class="row"><span>${row.methodVariant.replace(/_/g, " ").charAt(0).toUpperCase() + row.methodVariant.replace(/_/g, " ").slice(1)}</span><span>: AED ${row.customerChargedAmount.toFixed(2)}</span></div>
          <div class="row"><span>Invoice Allocated</span><span>: AED ${row.invoiceAllocationAmount.toFixed(2)}</span></div>
          ${row.feeAmount > 0 ? `<div class="row"><span>Fee (${(row.feeRate * 100).toFixed(1)}%)</span><span>: AED ${row.feeAmount.toFixed(2)}</span></div>` : ""}
          ${row.providerReferenceNumber ? `<div class="row"><span>Provider Reference</span><span>: ${row.providerReferenceNumber}</span></div>` : ""}
        `
          )
          .join("")}
        <div class="row"><span>Total Customer Pays</span><span>: AED ${paidToday.toFixed(2)}</span></div>
      `;
  }

  return `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>${title}</title>
        <style>
          ${buildThermalReceiptCss(thermalSettings)}
          .head-row { display: flex; justify-content: space-between; font-weight: 700; }
          .item-row { margin: 2px 0; }
          .item-block { margin: 3px 0; }
          .detail-row { padding-left: 6px; font-size: 10px; }
          .detail-total { font-weight: 700; }
          .item-name { flex: 1; min-width: 0; overflow-wrap: anywhere; }
          .amount { text-align: right; white-space: nowrap; }
        </style>
      </head>
      <body>
        ${buildThermalLogoHtml(logoPath, "Clinic logo")}

        <div class="double">${receiptHeading}</div>

        <div class="clinic-name">${clinicDisplayName}</div>

        <div class="address">
          ${clinicAddress
            .split(/\\n|\n/)
            .map((line: string) => `<div>${line}</div>`)
            .join("")}
          ${clinicRoom && !clinicAddress.toLowerCase().includes(clinicRoom.toLowerCase()) && !clinicAddress.includes("2nd Floor") ? `<div>${clinicRoom}</div>` : ""}
          ${clinicTrn ? `<div style="margin-top:2px;font-weight:700;">TRN: ${clinicTrn}</div>` : ""}
        </div>

        <div class="hr"></div>

        <div class="row"><span>Invoice No / رقم الفاتورة</span><span>: ${invoiceNumber}</span></div>
        <div class="row"><span>Date / التاريخ</span><span>: ${dateValue}</span></div>
        <div class="row"><span>Time / الوقت</span><span>: ${timeValue}</span></div>
        <div class="row"><span>Cashier / أمين الصندوق</span><span>: ${cashierName}</span></div>
        <div class="row"><span>${doctorField}</span><span>: ${doctorName}</span></div>
        <div class="row"><span>Patient Name / اسم المريض</span><span>: ${patientName}</span></div>
        <div class="row"><span>Patient ID / معرف المريض</span><span>: ${patientFileNumber}</span></div>
        <div class="row"><span>Mobile / الهاتف</span><span>: ${patientPhone}</span></div>

        <div class="hr"></div>

        <div class="head-row"><span>DESCRIPTION / الوصف</span><span>AMOUNT / المبلغ</span></div>
        <div class="hr" style="margin-top:2px;"></div>
        ${itemsHtml || '<div class="center">No services selected</div>'}

        <div class="hr"></div>

        <div class="row"><span>Subtotal / Services</span><span>AED ${originalSubtotal.toFixed(2)}</span></div>
        ${showSnapshotDiscountBreakdown && manualDiscountTotal > 0.0049 && globalDiscountTotal <= 0.0049
          ? `<div class="row"><span>Discount</span><span>- AED ${manualDiscountTotal.toFixed(2)}</span></div>`
          : ""}
        ${showSnapshotDiscountBreakdown && manualDiscountTotal > 0.0049 && globalDiscountTotal > 0.0049
          ? `<div class="row"><span>Promo / Price Adjustments</span><span>- AED ${manualDiscountTotal.toFixed(2)}</span></div>`
          : ""}
        ${showSnapshotDiscountBreakdown && globalDiscountTotal > 0.0049
          ? `<div class="row"><span>Global Discount</span><span>- AED ${globalDiscountTotal.toFixed(2)}</span></div>`
          : ""}
        ${!showSnapshotDiscountBreakdown && discountAmount > 0
          ? `<div class="row"><span>Discount / خصم${discountType === "%" ? ` (${discountInput}%)` : ""}</span><span>- AED ${discountAmount.toFixed(2)}</span></div>`
          : ""}
        <div class="row"><span>Grand Total / الإجمالي</span><span>AED ${grandTotalBeforeFees.toFixed(2)}</span></div>
        <div class="row"><span>VAT</span><span>AED ${vat.toFixed(2)}</span></div>
        ${allocationFeeTotal > 0 ? `<div class="row"><span>Payment Fee</span><span>AED ${allocationFeeTotal.toFixed(2)}</span></div>` : ""}
        <div class="hr" style="margin:4px 0;"></div>
        <div class="row" style="font-weight:700;"><span>TOTAL / الإجمالي</span><span>AED ${(total + allocationFeeTotal).toFixed(2)}</span></div>

        <div class="hr"></div>

        ${paymentSection}
        ${paymentStatusRows}
  ${notesForReceipt ? `
  <div class="hr"></div>
  <div style="font-weight:700;">Notes / ملاحظات</div>
  <div style="white-space:pre-wrap;overflow-wrap:anywhere;">${notesForReceipt}</div>` : ""}

        <div class="hr"></div>

        <div class="footer-center">${receiptVatNote}</div>
        <div class="footer-center">${receiptThankYou}</div>
        ${socialHtml}

        <div class="hr"></div>

        <div style="text-align:center;font-size:9px;line-height:1.4;">
          ${clinicPhone ? `<div>Phone: ${clinicPhone}</div>` : ""}
          ${clinicWhatsapp ? `<div>WhatsApp: ${clinicWhatsapp}</div>` : ""}
        </div>

        <div class="hr"></div>

        ${qrHtml}

        <div class="hr"></div>

        <div class="double">${receiptFinalMessage}</div>
      </body>
    </html>`;
}
