"use client";

import { useEffect, useMemo, useState } from "react";
import { AppFrame } from "../../components/app-frame";
import { supabase } from "../../lib/supabase";

type Receipt = {
  id: string;
  receipt_number?: number | null;
  patient_id: string;
  doctor_id: string;
  receptionist_id: string;
  payment_method?: string | null;
  subtotal: number;
  vat: number;
  total: number;
  notes: string | null;
  created_at?: string;
};

type LookupItem = {
  id: string;
  name: string;
  clinic_id?: string;
};

type Patient = {
  id: string;
  name: string;
  phone?: string | null;
  patient_number?: number | null;
};

type Clinic = {
  id: string;
  name: string;
  address?: string | null;
  room?: string | null;
  trn?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  logo?: string | null;
};

type ReceiptItem = {
  receipt_id: string;
  service_id: string;
  quantity: number;
  price: number;
  total: number;
};

export default function ReceiptHistoryPage() {
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [doctors, setDoctors] = useState<LookupItem[]>([]);
  const [receptionists, setReceptionists] = useState<LookupItem[]>([]);
  const [services, setServices] = useState<LookupItem[]>([]);
  const [receiptItems, setReceiptItems] = useState<ReceiptItem[]>([]);
  const [clinics, setClinics] = useState<Clinic[]>([]);
  const [selectedReceiptId, setSelectedReceiptId] = useState<string>("");

  useEffect(() => {
    loadHistory();
  }, []);

  async function loadHistory() {
    const [receiptResult, patientResult, doctorResult, receptionistResult, serviceResult, itemResult, clinicResult] = await Promise.all([
      supabase.from("receipts").select("*").order("created_at", { ascending: false }),
      supabase.from("patients").select("id, name, phone, patient_number").order("name", { ascending: true }),
      supabase.from("doctors").select("id, name").order("name", { ascending: true }),
      supabase.from("receptionist").select("id, name, clinic_id").order("name", { ascending: true }),
      supabase.from("services").select("id, name").order("name", { ascending: true }),
      supabase.from("receipt_items").select("receipt_id, service_id, quantity, price, total"),
      supabase.from("clinics").select("*"),
    ]);

    setReceipts((receiptResult.data as Receipt[]) || []);
    setPatients((patientResult.data as Patient[]) || []);
    setDoctors((doctorResult.data as LookupItem[]) || []);
    setReceptionists((receptionistResult.data as LookupItem[]) || []);
    setServices((serviceResult.data as LookupItem[]) || []);
    setReceiptItems((itemResult.data as ReceiptItem[]) || []);
    setClinics((clinicResult.data as Clinic[]) || []);

    if (!selectedReceiptId && receiptResult.data?.length) {
      setSelectedReceiptId(receiptResult.data[0].id);
    }
  }

  const selectedReceipt = receipts.find((receipt) => receipt.id === selectedReceiptId);

  const selectedReceiptLineItems = useMemo(() => {
    if (!selectedReceipt) {
      return [];
    }

    return receiptItems
      .filter((item) => item.receipt_id === selectedReceipt.id)
      .map((item) => {
        const service = services.find((entry) => entry.id === item.service_id);

        return {
          id: item.service_id,
          name: service?.name || "Service",
          quantity: item.quantity,
          total: item.total,
        };
      });
  }, [receiptItems, selectedReceipt, services]);

  function getPatientName(patientId: string) {
    return patients.find((patient) => patient.id === patientId)?.name || "Unknown patient";
  }

  function printSelectedReceipt() {
    if (!selectedReceipt) return;

    const receptionist = receptionists.find((r) => r.id === selectedReceipt.receptionist_id);
    const clinic = clinics.find((c) => c.id === receptionist?.clinic_id) ?? clinics[0];
    const logoPath = clinic?.logo === "altamuze" ? "/images/logo4.png" : "/images/logo6.jpg";
    const clinicDisplayName = clinic?.name?.toUpperCase() || "SKIN & SMILE DENTAL CLINIC";
    const clinicAddress = clinic?.address || "Al Satwa, Dubai, UAE\nSame Building of Almaya Supermarket\nNear Satwa Bus Station";
    const clinicRoom = clinic?.room ? `2nd Floor, Room ${clinic.room}` : "";
    const clinicTrn = clinic?.trn || "";
    const clinicPhone = clinic?.phone || "";
    const clinicWhatsapp = clinic?.whatsapp || "";
    const isSkinAndSmile = !clinic || clinic.logo !== "altamuze";
    const createdAt = selectedReceipt.created_at ? new Date(selectedReceipt.created_at) : new Date();
    const invoiceNo = selectedReceipt.receipt_number
      ? `#${String(selectedReceipt.receipt_number).padStart(5, "0")}`
      : "-";
    const dateValue = createdAt.toLocaleDateString("en-GB");
    const timeValue = createdAt.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });

    const patient = patients.find((p) => p.id === selectedReceipt.patient_id);
    const patientNameForReceipt = patient?.name || "-";
    const patientMobileForReceipt = patient?.phone || "-";
    const patientIdForReceipt = patient?.patient_number
      ? `#${String(patient.patient_number).padStart(5, "0")}`
      : "-";
    const doctorNameForReceipt = doctors.find((d) => d.id === selectedReceipt.doctor_id)?.name || "-";
    const cashierName = receptionists.find((r) => r.id === selectedReceipt.receptionist_id)?.name || "Reception";

    const itemsHtml = selectedReceiptLineItems
      .map((item) => `
        <div class="row item-row">
          <span class="item-name">${item.name}</span>
          <span class="amount">AED ${Number(item.total).toFixed(2)}</span>
        </div>`)
      .join("");

    const paymentSection = `
      <div class="row"><span>Payment Method / \u0637\u0631\u064a\u0642\u0629 \u0627\u0644\u062f\u0641\u0639</span><span>: ${(selectedReceipt.payment_method || "-").toUpperCase()}</span></div>
      <div class="row"><span>Amount Paid / \u0627\u0644\u0645\u0628\u0644\u063a \u0627\u0644\u0645\u062f\u0641\u0648\u0639</span><span>: AED ${Number(selectedReceipt.total).toFixed(2)}</span></div>
    `;

    const receiptHtml = `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>Receipt</title>
        <style>
          * { box-sizing: border-box; }
          body { font-family: Arial, Helvetica, sans-serif; width: 72mm; margin: 0; padding: 2mm; font-size: 10px; line-height: 1.25; color: #000; background: #fff; overflow-x: hidden; }
          .center { text-align: center; }
          .hr { border-top: 1px dashed #000; margin: 5px 0; }
          .double { border-top: 2px solid #000; border-bottom: 2px solid #000; padding: 3px 0; margin: 5px 0; text-align: center; font-weight: 700; }
          .logo-wrap { display: flex; justify-content: center; margin-bottom: 4px; }
          .logo { max-width: 48mm; max-height: 26mm; object-fit: contain; }
          .clinic-name { text-align: center; font-size: 14px; font-weight: 700; line-height: 1.1; }
          .address { text-align: center; font-size: 9px; line-height: 1.25; margin-top: 4px; }
          .row { display: flex; justify-content: space-between; gap: 6px; margin: 1px 0; }
          .row span:first-child { min-width: 30mm; }
          .row span:last-child { text-align: right; flex: 1; min-width: 0; overflow-wrap: anywhere; word-break: break-word; }
          .head-row { display: flex; justify-content: space-between; font-weight: 700; }
          .item-row { margin: 2px 0; }
          .item-name { flex: 1; min-width: 0; overflow-wrap: anywhere; }
          .amount { text-align: right; white-space: nowrap; }
          .footer-center { text-align: center; margin-top: 4px; }
          @media print { @page { size: 80mm auto; margin: 0; } body { width: 72mm; -webkit-print-color-adjust: exact; print-color-adjust: exact; } * { color: #000 !important; border-color: #000 !important; } img { -webkit-print-color-adjust: exact; print-color-adjust: exact; image-rendering: crisp-edges; } }
        </style>
      </head>
      <body>
        <div class="logo-wrap" id="logo-wrap">
          <img src="${logoPath}" alt="Clinic logo" class="logo" onerror="document.getElementById('logo-wrap').style.display='none'" />
        </div>
        <div class="double">TAX INVOICE</div>
        <div class="clinic-name">${clinicDisplayName}</div>
        <div class="address">
          ${clinicAddress.split("\n").map((line: string) => `<div>${line}</div>`).join("")}
          ${clinicRoom && !clinicAddress.toLowerCase().includes(clinicRoom.toLowerCase()) && !clinicAddress.includes("2nd Floor") ? `<div>${clinicRoom}</div>` : ""}
          ${clinicTrn ? `<div style="margin-top:2px;font-weight:700;">TRN: ${clinicTrn}</div>` : ""}
        </div>
        <div class="hr"></div>
        <div class="row"><span>Invoice No / \u0631\u0642\u0645 \u0627\u0644\u0641\u0627\u062a\u0648\u0631\u0629</span><span>: ${invoiceNo}</span></div>
        <div class="row"><span>Date / \u0627\u0644\u062a\u0627\u0631\u064a\u062e</span><span>: ${dateValue}</span></div>
        <div class="row"><span>Time / \u0627\u0644\u0648\u0642\u062a</span><span>: ${timeValue}</span></div>
        <div class="row"><span>Cashier / \u0623\u0645\u064a\u0646 \u0627\u0644\u0635\u0646\u062f\u0648\u0642</span><span>: ${cashierName}</span></div>
        <div class="row"><span>Doctor / \u0627\u0644\u0637\u0628\u064a\u0628</span><span>: ${doctorNameForReceipt}</span></div>
        <div class="row"><span>Patient Name / \u0627\u0633\u0645 \u0627\u0644\u0645\u0631\u064a\u0636</span><span>: ${patientNameForReceipt}</span></div>
        <div class="row"><span>Patient ID / \u0645\u0639\u0631\u0641 \u0627\u0644\u0645\u0631\u064a\u0636</span><span>: ${patientIdForReceipt}</span></div>
        <div class="row"><span>Mobile / \u0627\u0644\u0647\u0627\u062a\u0641</span><span>: ${patientMobileForReceipt}</span></div>
        <div class="hr"></div>
        <div class="head-row"><span>DESCRIPTION / \u0627\u0644\u0648\u0635\u0641</span><span>AMOUNT / \u0627\u0644\u0645\u0628\u0644\u063a</span></div>
        <div class="hr" style="margin-top:2px;"></div>
        ${itemsHtml || '<div class="center">No services selected</div>'}
        <div class="hr"></div>
        <div class="row"><span>Subtotal / \u0627\u0644\u0625\u062c\u0645\u0627\u0644\u064a \u0627\u0644\u062c\u0632\u0626\u064a</span><span>AED ${Number(selectedReceipt.subtotal).toFixed(2)}</span></div>
        <div class="row"><span>VAT / \u0627\u0644\u0636\u0631\u064a\u0628\u0629</span><span>AED ${Number(selectedReceipt.vat).toFixed(2)}</span></div>
        <div class="hr" style="margin:4px 0;"></div>
        <div class="row" style="font-weight:700;"><span>TOTAL / \u0627\u0644\u0625\u062c\u0645\u0627\u0644\u064a</span><span>AED ${Number(selectedReceipt.total).toFixed(2)}</span></div>
        <div class="hr"></div>
        ${paymentSection}
        ${selectedReceipt.notes ? `<div style="margin-top:4px;">Note / \u0645\u0644\u0627\u062d\u0638\u0629: ${selectedReceipt.notes}</div>` : ""}
        <div class="hr"></div>
        <div class="footer-center">VAT Included in Above Amount / \u0627\u0644\u0636\u0631\u064a\u0628\u0629 \u0645\u0634\u0645\u0648\u0644\u0629 \u0641\u064a \u0627\u0644\u0645\u0628\u0644\u063a \u0623\u0639\u0644\u0627\u0647</div>
        <div class="footer-center">Thank you for visiting us / \u0634\u0643\u0631\u0627\u064b \u0644\u0632\u064a\u0627\u0631\u062a\u0643 \u0644\u0646\u0627</div>
        ${isSkinAndSmile ? `
        <div class="footer-center" style="margin-top:6px;">Follow us:</div>
        <div class="footer-center">Instagram: @skinandsmiledentalclinic</div>
        <div class="footer-center">TikTok: @skinandsmile</div>
        ` : ""}
        <div class="hr"></div>
        ${clinicPhone ? `<div class="row"><span>For appointments - Number</span><span>: ${clinicPhone}</span></div>` : ""}
        ${clinicWhatsapp ? `<div class="row"><span>WhatsApp</span><span>: ${clinicWhatsapp}</span></div>` : ""}
        <div class="hr"></div>
        <div class="double">Thank you for Visiting US!</div>
      </body>
    </html>`;

    try {
      const w = window.open("", "_blank", "width=400,height=600");
      if (!w) {
        alert("Please allow popups to print the receipt.");
        return;
      }
      w.document.open();
      w.document.write(receiptHtml);
      w.document.close();
      w.focus();
      setTimeout(() => {
        w.print();
      }, 500);
    } catch (error) {
      alert("Error opening print dialog. Please check browser settings.");
    }
  }

  const doctorName = doctors.find((doctor) => doctor.id === selectedReceipt?.doctor_id)?.name || "Unknown doctor";
  const receptionistName = receptionists.find((person) => person.id === selectedReceipt?.receptionist_id)?.name || "Unknown receptionist";

  function formatReceiptNo(receipt: Receipt) {
    return receipt.receipt_number
      ? `#${String(receipt.receipt_number).padStart(5, "0")}`
      : `#${receipt.id.slice(0, 8)}`;
  }

  return (
    <AppFrame
      title="Receipt History"
      description="Review previous receipts in a premium dental-style workspace and print thermal copies quickly."
      actionLabel="New Receipt"
      actionHref="/receipts"
    >
      <div className="relative overflow-hidden rounded-[28px] border border-teal-100/70 bg-gradient-to-br from-white via-cyan-50/60 to-teal-50/70 p-4 shadow-[0_18px_50px_-24px_rgba(15,23,42,0.35)] sm:p-6">
        <div className="pointer-events-none absolute -left-10 -top-10 h-44 w-44 rounded-full bg-teal-200/30 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-14 -right-10 h-52 w-52 rounded-full bg-cyan-200/30 blur-2xl" />

        <div className="grid gap-6 xl:grid-cols-[0.95fr_1.15fr]">
          <div className="rounded-3xl border border-white/80 bg-white/85 p-4 shadow-sm backdrop-blur sm:p-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-teal-700">Receipt Archive</p>
                <h3 className="mt-1 text-lg font-semibold text-slate-900">Patient Visit Ledger</h3>
              </div>
              <div className="rounded-2xl border border-teal-100 bg-teal-50 px-3 py-1.5 text-xs font-semibold text-teal-700">
                {receipts.length} Records
              </div>
            </div>

            <div className="space-y-3">
              {receipts.map((receipt) => (
                <button
                  key={receipt.id}
                  onClick={() => setSelectedReceiptId(receipt.id)}
                  className={`w-full rounded-2xl border p-4 text-left transition duration-200 hover:-translate-y-0.5 ${
                    receipt.id === selectedReceiptId
                      ? "border-teal-300 bg-gradient-to-r from-teal-50 to-cyan-50 shadow-sm"
                      : "border-slate-200 bg-white hover:border-teal-200"
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">Receipt {formatReceiptNo(receipt)}</p>
                      <p className="mt-1 text-sm text-slate-600">{getPatientName(receipt.patient_id)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-teal-700">AED {Number(receipt.total || 0).toFixed(2)}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {receipt.created_at ? new Date(receipt.created_at).toLocaleString() : "No date"}
                      </p>
                    </div>
                  </div>
                </button>
              ))}

              {receipts.length === 0 && (
                <div className="rounded-2xl border border-dashed border-teal-200 bg-teal-50/60 p-8 text-center text-sm text-teal-800">
                  No receipts have been saved yet.
                </div>
              )}
            </div>
          </div>

          <div className="space-y-5 print:text-black">
            {selectedReceipt ? (
              <div className="relative overflow-hidden rounded-3xl border border-slate-200/80 bg-white p-5 shadow-[0_20px_35px_-24px_rgba(15,23,42,0.45)] print:border-black print:bg-white sm:p-6">
                <div
                  className="pointer-events-none absolute -right-10 -top-12 h-48 w-48 rounded-full bg-cyan-100/70"
                  style={{
                    backgroundImage: "radial-gradient(circle at 40% 40%, rgba(20,184,166,0.2), rgba(186,230,253,0.35))",
                  }}
                />
                <div
                  className="pointer-events-none absolute bottom-5 right-6 h-20 w-20 bg-contain bg-center bg-no-repeat opacity-10"
                  style={{ backgroundImage: "url('/images/logo2.png')" }}
                />

                <div className="relative z-10 flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.3em] text-teal-700 print:text-black">
                      Printable Thermal Receipt
                    </p>
                    <h2 className="mt-2 text-2xl font-semibold text-slate-900 print:text-black">
                      Receipt {formatReceiptNo(selectedReceipt)}
                    </h2>
                    <p className="mt-1 text-sm text-slate-500">Premium dental clinic format</p>
                  </div>

                  <button
                    onClick={printSelectedReceipt}
                    className="rounded-full bg-gradient-to-r from-teal-700 to-cyan-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:from-teal-600 hover:to-cyan-600 print:hidden"
                  >
                    Print Receipt
                  </button>
                </div>

                <div className="relative z-10 mt-5 grid gap-3 text-sm text-slate-700 sm:grid-cols-2">
                  <div className="rounded-2xl border border-teal-100 bg-gradient-to-br from-white to-teal-50/40 p-4">
                    <p className="text-xs uppercase tracking-[0.25em] text-teal-700">Patient</p>
                    <p className="mt-2 font-semibold text-slate-900">{getPatientName(selectedReceipt.patient_id)}</p>
                  </div>
                  <div className="rounded-2xl border border-teal-100 bg-gradient-to-br from-white to-teal-50/40 p-4">
                    <p className="text-xs uppercase tracking-[0.25em] text-teal-700">Doctor</p>
                    <p className="mt-2 font-semibold text-slate-900">{doctorName}</p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-white p-4">
                    <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Receptionist</p>
                    <p className="mt-2 font-semibold text-slate-900">{receptionistName}</p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-white p-4">
                    <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Date</p>
                    <p className="mt-2 font-semibold text-slate-900">
                      {selectedReceipt.created_at ? new Date(selectedReceipt.created_at).toLocaleString() : "No date"}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:col-span-2">
                    <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Payment Method</p>
                    <p className="mt-2 font-semibold text-slate-900">{selectedReceipt.payment_method || "Not recorded"}</p>
                  </div>
                </div>

                <div className="relative z-10 mt-5 space-y-3">
                  {selectedReceiptLineItems.map((item) => (
                    <div key={item.id} className="flex items-center justify-between rounded-2xl border border-slate-100 bg-white px-4 py-3 text-sm shadow-sm">
                      <div>
                        <p className="font-semibold text-slate-900">{item.name}</p>
                        <p className="text-slate-500">Qty {item.quantity}</p>
                      </div>
                      <p className="font-semibold text-slate-900">AED {Number(item.total || 0).toFixed(2)}</p>
                    </div>
                  ))}
                </div>

                <div className="relative z-10 mt-5 grid gap-2 rounded-2xl bg-gradient-to-r from-slate-900 to-teal-900 px-4 py-4 text-sm text-slate-100 print:bg-white print:text-black">
                  <div className="flex items-center justify-between">
                    <span>Subtotal</span>
                    <span>AED {Number(selectedReceipt.subtotal || 0).toFixed(2)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>VAT</span>
                    <span>AED {Number(selectedReceipt.vat || 0).toFixed(2)}</span>
                  </div>
                  <div className="flex items-center justify-between border-t border-white/20 pt-2 text-base font-semibold text-white print:border-black print:text-black">
                    <span>Total</span>
                    <span>AED {Number(selectedReceipt.total || 0).toFixed(2)}</span>
                  </div>
                </div>

                {selectedReceipt.notes && (
                  <div className="relative z-10 mt-5 rounded-2xl border border-teal-100 bg-teal-50/40 p-4 text-sm text-slate-700 print:border-black print:bg-white print:text-black">
                    <p className="text-xs uppercase tracking-[0.3em] text-teal-700">Notes</p>
                    <p className="mt-2">{selectedReceipt.notes}</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-teal-200 bg-teal-50/60 p-8 text-center text-sm text-teal-800">
                Select a receipt to view and print it.
              </div>
            )}
          </div>
        </div>
      </div>
    </AppFrame>
  );
}
