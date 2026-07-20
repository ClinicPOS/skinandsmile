import type { Clinic, Patient, PatientCredit } from "./types";
import { buildReceiptQrHtml } from "./receipt-branding";

export type DepositReceiptContext = {
  credit: PatientCredit;
  patient: Patient;
  clinic: Clinic | null;
  cashierName: string;
  availableAfter: number;
};

export function buildDepositReceiptHtml(ctx: DepositReceiptContext): string {
  const { credit, patient, clinic, cashierName, availableAfter } = ctx;

  const clinicName = (clinic?.name || "Skin and Smile Dental Clinic")
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  const clinicAddress = clinic?.address || "";
  const clinicPhone = clinic?.phone || "";
  const clinicTrn = clinic?.trn || "";
  const clinicInstagram = clinic?.instagram || "";
  const clinicFacebook = clinic?.facebook || "";
  const clinicWhatsapp = clinic?.whatsapp || "";
  const clinicTiktok = clinic?.tiktok || "";
  const now = new Date(credit.created_at || Date.now());
  const dateStr = now.toLocaleDateString("en-GB");
  const timeStr = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });

  const reference = `#${credit.id.slice(0, 8).toUpperCase()}`;
  const amount = Number(credit.amount).toFixed(2);
  const available = availableAfter.toFixed(2);
  const patientNo = patient.patient_number != null
    ? `#${String(patient.patient_number).padStart(5, "0")}`
    : "-";
  const expectedDate = credit.expected_treatment_date
    ? new Date(credit.expected_treatment_date).toLocaleDateString("en-GB")
    : "";
  const qrHtml = buildReceiptQrHtml({
    clinic,
    clinicDisplayName: clinicName,
    clinicPhone,
    clinicWhatsapp,
    clinicInstagram,
    clinicFacebook,
    clinicTiktok,
    invoiceNo: reference,
  });

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Deposit Receipt</title>
  <style>
    @page { size: 80mm auto; margin: 4mm; }
    body { font-family: 'Segoe UI', Arial, sans-serif; width: 72mm; margin: 0; color: #111; }
    .center { text-align: center; }
    .bold { font-weight: 700; }
    .divider { border-top: 1px dashed #333; margin: 6px 0; }
    .row { display: flex; justify-content: space-between; font-size: 11px; margin: 2px 0; }
    .row span:last-child { text-align: right; }
    .title { font-size: 13px; letter-spacing: 2px; margin-top: 6px; }
    .clinic { font-size: 12px; font-weight: 700; }
    .meta { font-size: 10px; color: #444; }
    .summary { font-size: 12px; }
    .summary .row.total { font-weight: 700; font-size: 13px; }
    .footer { text-align: center; font-size: 10px; color: #444; margin-top: 8px; }
    .stamp { text-align: center; font-weight: 700; letter-spacing: 3px; margin: 8px 0; font-size: 13px; border: 1.5px solid #111; padding: 4px 0; }
  </style>
</head>
<body>
  <div class="center clinic">${clinicName}</div>
  ${clinicAddress ? `<div class="center meta">${clinicAddress.replace(/\n/g, "<br/>")}</div>` : ""}
  ${clinicPhone ? `<div class="center meta">Tel: ${clinicPhone}</div>` : ""}
  ${clinicTrn ? `<div class="center meta">TRN: ${clinicTrn}</div>` : ""}

  <div class="center bold title">DEPOSIT RECEIPT</div>
  <div class="center meta">Advance Payment / Patient Credit</div>

  <div class="divider"></div>

  <div class="row"><span>Date</span><span>${dateStr} ${timeStr}</span></div>
  <div class="row"><span>Cashier</span><span>${cashierName}</span></div>
  <div class="row"><span>Ref</span><span>${reference}</span></div>

  <div class="divider"></div>

  <div class="row"><span>Patient</span><span>${patient.name}</span></div>
  <div class="row"><span>File No.</span><span>${patientNo}</span></div>
  ${patient.phone ? `<div class="row"><span>Phone</span><span>${patient.phone}</span></div>` : ""}

  <div class="divider"></div>

  <div class="summary">
    <div class="row bold"><span>Deposit Received</span><span>AED ${amount}</span></div>
    <div class="row"><span>Payment Method</span><span>${(credit.payment_method || "-").toUpperCase()}</span></div>
    ${credit.reason ? `<div class="row"><span>Reason</span><span>${credit.reason}</span></div>` : ""}
    ${expectedDate ? `<div class="row"><span>Expected Treatment</span><span>${expectedDate}</span></div>` : ""}
    <div class="divider"></div>
    <div class="row total"><span>Available Credit</span><span>AED ${available}</span></div>
  </div>

  <div class="stamp">CREDIT ON ACCOUNT</div>

  ${credit.notes ? `<div class="meta" style="margin-top:6px;">Note: ${credit.notes}</div>` : ""}

  <div class="footer">This deposit is held on the patient's account and can be used for future treatments.</div>
  <div class="footer">Thank you.</div>
  ${clinicInstagram || clinicFacebook ? `<div class="footer">Follow us${clinicInstagram ? `<br/>Instagram: ${clinicInstagram}` : ""}${clinicFacebook ? `<br/>Facebook: ${clinicFacebook}` : ""}</div>` : ""}
  <div class="divider"></div>
  ${qrHtml}
</body>
</html>`;
}

export function printDepositReceipt(ctx: DepositReceiptContext): void {
  const html = buildDepositReceiptHtml(ctx);
  const w = window.open("", "_blank", "width=400,height=600");
  if (!w) {
    alert("Please allow popups to print the receipt.");
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => {
    try { w.print(); } catch { /* ignore */ }
  }, 400);
}
