import type { Clinic, Patient, OutstandingBalance, BalancePayment } from "./types";
import { formatBalanceReference } from "./outstanding-balances";

export type PaymentReceiptContext = {
  balance: OutstandingBalance;
  payment: BalancePayment;
  patient: Patient;
  clinic: Clinic | null;
  cashierName: string;
  totalPaidBefore: number;
  remainingAfter: number;
};

export function buildPaymentReceiptHtml(ctx: PaymentReceiptContext): string {
  const {
    balance,
    payment,
    patient,
    clinic,
    cashierName,
    totalPaidBefore,
    remainingAfter,
  } = ctx;

  const clinicName = (clinic?.name || "Skin and Smile Dental Clinic")
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  const clinicAddress = clinic?.address || "";
  const clinicPhone = clinic?.phone || "";
  const clinicTrn = clinic?.trn || "";
  const clinicInstagram = clinic?.instagram || "";
  const clinicFacebook = clinic?.facebook || "";
  const now = new Date(payment.created_at || Date.now());
  const dateStr = now.toLocaleDateString("en-GB");
  const timeStr = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });

  const reference = formatBalanceReference(balance);
  const original = Number(balance.original_amount).toFixed(2);
  const paidToday = Number(payment.amount).toFixed(2);
  const paidBefore = totalPaidBefore.toFixed(2);
  const remaining = remainingAfter.toFixed(2);
  const patientNo = patient.patient_number != null
    ? `#${String(patient.patient_number).padStart(5, "0")}`
    : "-";

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Payment Receipt</title>
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

  <div class="center bold title">PAYMENT RECEIPT</div>
  <div class="center meta">Outstanding Balance Collection</div>

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
    <div class="row"><span>Original Balance</span><span>AED ${original}</span></div>
    <div class="row"><span>Previously Paid</span><span>AED ${paidBefore}</span></div>
    <div class="row bold"><span>Amount Paid Today</span><span>AED ${paidToday}</span></div>
    <div class="row"><span>Payment Method</span><span>${payment.payment_method.toUpperCase()}</span></div>
    <div class="divider"></div>
    <div class="row total"><span>Remaining Balance</span><span>AED ${remaining}</span></div>
  </div>

  ${Number(remainingAfter) <= 0.0049 ? `<div class="stamp">SETTLED IN FULL</div>` : ""}

  ${balance.reason ? `<div class="meta" style="margin-top:6px;">Note: ${balance.reason}</div>` : ""}
  ${payment.notes ? `<div class="meta">${payment.notes}</div>` : ""}

  <div class="footer">Thank you for your payment.</div>
  ${clinicInstagram || clinicFacebook ? `<div class="footer">Follow us${clinicInstagram ? `<br/>Instagram: ${clinicInstagram}` : ""}${clinicFacebook ? `<br/>Facebook: ${clinicFacebook}` : ""}</div>` : ""}
</body>
</html>`;
}

export function printPaymentReceipt(ctx: PaymentReceiptContext): void {
  const html = buildPaymentReceiptHtml(ctx);
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
