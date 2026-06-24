"use client";

import { useEffect, useMemo, useState } from "react";
import { AppFrame } from "../../components/app-frame";
import { supabase } from "../../lib/supabase";

type Receipt = {
  id: string;
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
};

type Patient = {
  id: string;
  name: string;
  phone?: string | null;
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
  const [selectedReceiptId, setSelectedReceiptId] = useState<string>("");

  useEffect(() => {
    loadHistory();
  }, []);

  async function loadHistory() {
    const [receiptResult, patientResult, doctorResult, receptionistResult, serviceResult, itemResult] = await Promise.all([
      supabase.from("receipts").select("*").order("created_at", { ascending: false }),
      supabase.from("patients").select("id, name, phone").order("name", { ascending: true }),
      supabase.from("doctors").select("id, name").order("name", { ascending: true }),
      supabase.from("receptionist").select("id, name").order("name", { ascending: true }),
      supabase.from("services").select("id, name").order("name", { ascending: true }),
      supabase.from("receipt_items").select("receipt_id, service_id, quantity, price, total"),
    ]);

    setReceipts((receiptResult.data as Receipt[]) || []);
    setPatients((patientResult.data as LookupItem[]) || []);
    setDoctors((doctorResult.data as LookupItem[]) || []);
    setReceptionists((receptionistResult.data as LookupItem[]) || []);
    setServices((serviceResult.data as LookupItem[]) || []);
    setReceiptItems((itemResult.data as ReceiptItem[]) || []);

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
    if (!selectedReceipt) {
      return;
    }

    const clinicName = "SKIN & SMILE DENTAL CLINIC";
    const clinicNameAR = "Ø¹ÙŠØ§Ø¯Ø© Ø³ÙƒÙ† Ø¢Ù†Ø¯ Ø³Ù…Ø§ÙŠÙ„ Ù„Ø·Ø¨ Ø§Ù„Ø£Ø³Ù†Ø§Ù†";
    const trn = "123456789";
    const phone = "+971 XX XXX XXXX";
    const logoPath = "/images/logo2.png";
    const dateStr = selectedReceipt.created_at
      ? new Date(selectedReceipt.created_at).toLocaleString()
      : new Date().toLocaleString();

    const patientNameForReceipt = getPatientName(selectedReceipt.patient_id);
    const doctorNameForReceipt = doctors.find((d) => d.id === selectedReceipt.doctor_id)?.name || "-";
    const receptionistNameForReceipt =
      receptionists.find((person) => person.id === selectedReceipt.receptionist_id)?.name || "-";

    const itemsHtml = selectedReceiptLineItems
      .map(
        (item) => `
          <div style="display:flex;justify-content:space-between;margin:6px 0;">
            <div style="max-width:60%;font-size:13px;">${item.name} x${item.quantity}</div>
            <div style="min-width:80px;text-align:right;font-size:13px;">AED ${Number(item.total).toFixed(2)}</div>
          </div>`
      )
      .join("");

    const receiptHtml = `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>Receipt</title>
        <style>
          body{font-family: Arial, Helvetica, sans-serif; width:72mm; margin:0 auto; padding:6px; color:#000}
          .center{text-align:center}
          .separator{border-top:1px dashed #000;margin:8px 0}
          .total{font-weight:700; margin-top:8px; font-size:15px}
          .logo-wrap{display:flex;justify-content:center;margin:0 0 6px 0}
          .logo{max-width:50mm;max-height:28mm;object-fit:contain}
          @media print{
            body{width:72mm}
            @page{size:80mm auto;margin:2mm}
          }
        </style>
      </head>
      <body>
        <div class="center">
          <div class="logo-wrap" id="logo-wrap">
            <img
              src="${logoPath}"
              alt="Clinic logo"
              class="logo"
              onerror="document.getElementById('logo-wrap').style.display='none'"
            />
          </div>
          <div style="font-size:18px;font-weight:700">${clinicName}</div>
          <div style="font-size:14px;margin-top:4px">${clinicNameAR}</div>
          <div style="margin-top:8px;font-size:12px">TRN: ${trn}</div>
        </div>

        <div style="height:10px"></div>

        <div style="font-size:13px;margin-bottom:6px">
          <div><strong>Date:</strong> ${dateStr}</div>
          <div style="margin-top:6px"><strong>Receipt #:</strong> ${selectedReceipt.id.slice(0, 8)}</div>
          <div style="margin-top:6px"><strong>Patient / Ø§Ù„Ù…Ø±ÙŠØ¶:</strong> ${patientNameForReceipt}</div>
          <div style="margin-top:4px"><strong>Doctor / Ø§Ù„Ø·Ø¨ÙŠØ¨:</strong> ${doctorNameForReceipt}</div>
          <div style="margin-top:4px"><strong>Receptionist / Ø§Ù„Ø§Ø³ØªÙ‚Ø¨Ø§Ù„:</strong> ${receptionistNameForReceipt}</div>
          <div style="margin-top:4px"><strong>Payment / Ø·Ø±ÙŠÙ‚Ø© Ø§Ù„Ø¯ÙØ¹:</strong> ${selectedReceipt.payment_method || "-"}</div>
        </div>

        <div class="separator"></div>

        <div>
          ${itemsHtml}
        </div>

        <div class="separator"></div>

        <div style="font-size:13px">
          <div style="display:flex;justify-content:space-between;margin:6px 0"><div>Subtotal / Ø§Ù„Ù…Ø¬Ù…ÙˆØ¹ Ø§Ù„ÙØ±Ø¹ÙŠ</div><div>AED ${Number(selectedReceipt.subtotal || 0).toFixed(2)}</div></div>
          <div style="display:flex;justify-content:space-between;margin:6px 0"><div>VAT / Ø¶Ø±ÙŠØ¨Ø© Ø§Ù„Ù‚ÙŠÙ…Ø© Ø§Ù„Ù…Ø¶Ø§ÙØ©</div><div>AED ${Number(selectedReceipt.vat || 0).toFixed(2)}</div></div>
          <div class="total" style="display:flex;justify-content:space-between"><div>Total / Ø§Ù„Ø¥Ø¬Ù…Ø§Ù„ÙŠ</div><div>AED ${Number(selectedReceipt.total || 0).toFixed(2)}</div></div>
        </div>

        ${selectedReceipt.notes ? `<div class="separator"></div><div style="font-size:12px;margin-top:8px;padding:6px;background:#f5f5f5;border-radius:3px"><strong>Notes:</strong><div style="margin-top:4px">${selectedReceipt.notes}</div></div>` : ""}

        <div style="margin-top:12px;text-align:center;font-size:13px">
          <div>Thank you for visiting! / Ø´ÙƒØ±Ø§Ù‹ Ù„Ø²ÙŠØ§Ø±ØªÙƒÙ…</div>
          <div style="margin-top:6px">Phone / Ù‡Ø§ØªÙ: ${phone}</div>
        </div>
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
                      <p className="text-sm font-semibold text-slate-900">Receipt #{receipt.id.slice(0, 8)}</p>
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
                      Receipt #{selectedReceipt.id.slice(0, 8)}
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
