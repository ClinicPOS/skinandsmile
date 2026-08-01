"use client";

import { useState } from "react";
import { supabase } from "../lib/supabase";
import type { Clinic, TreatmentPlan, TreatmentPlanPayment } from "../lib/types";

const PLAN_PAYMENT_METHODS = ["Cash", "Card", "Visa", "Mastercard", "Tabby", "Tabby Card", "Tamara", "Tamara Card", "Bank Transfer", "Split Payment"];
const PAYMENT_ARRANGEMENTS = [
  "Full payment today",
  "Down payment + remaining balance",
  "Payment per visit",
  "50% now / 50% later",
  "Custom schedule",
  "No payment today",
];

export function PosPlanCheckoutModal({
  isOpen,
  onClose,
  onSaved,
  patientId,
  patientName,
  clinicId,
  clinicPatientFileId,
  patientFileNo,
  doctorId,
  receptionistId,
  registerSessionId,
  services,
  subtotal,
  total,
  discountAmount,
  vat,
  clinic,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSaved: (plan: TreatmentPlan, payment: TreatmentPlanPayment | null) => void;
  patientId: string;
  patientName: string;
  clinicId: string;
  clinicPatientFileId: string;
  patientFileNo: string;
  doctorId: string;
  receptionistId: string;
  registerSessionId: string;
  services: Array<{ id: string; name: string; price: number; quantity?: number; teeth?: string[] }>;
  subtotal: number;
  total: number;
  discountAmount: number;
  vat: number;
  clinic: Clinic | null;
}) {
  const defaultTitle = services.length === 1 ? services[0].name : `Treatment Plan — ${services.map((s) => s.name).join(", ")}`;
  const [planTitle, setPlanTitle] = useState(defaultTitle);
  const [plannedVisits, setPlannedVisits] = useState("5");
  const [agreedTotal, setAgreedTotal] = useState(String(total.toFixed(2)));
  const [paymentArrangement, setPaymentArrangement] = useState("Full payment today");
  const [amountToday, setAmountToday] = useState(String(total.toFixed(2)));
  const [paymentMethod, setPaymentMethod] = useState("Cash");
  const [tabbyRef, setTabbyRef] = useState("");
  const [tamaraRef, setTamaraRef] = useState("");
  const [planNotes, setPlanNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState<"config" | "review">("config");

  const agreedTotalNum = parseFloat(agreedTotal) || 0;
  const amountTodayNum = parseFloat(amountToday) || 0;
  const remainingAfterToday = Math.max(0, agreedTotalNum - amountTodayNum);

  if (!isOpen) return null;

  function goToReview() {
    if (!planTitle.trim()) { alert("Please enter a plan name."); return; }
    const visits = parseInt(plannedVisits, 10);
    if (!Number.isFinite(visits) || visits < 1) { alert("Planned visits must be at least 1."); return; }
    if (amountTodayNum < 0) { alert("Amount today cannot be negative."); return; }
    if (amountTodayNum > agreedTotalNum + 0.001) { alert("Amount today cannot exceed the agreed total."); return; }
    if (amountTodayNum > 0.001) {
      if (!paymentMethod) { alert("Please select a payment method."); return; }
      if (paymentMethod === "Tabby" && !tabbyRef.trim()) { alert("Enter Tabby reference number."); return; }
      if (paymentMethod === "Tamara" && !tamaraRef.trim()) { alert("Enter Tamara reference number."); return; }
    }
    setStep("review");
  }

  async function handleSave() {
    setSaving(true);
    try {
      const visits = parseInt(plannedVisits, 10);

      const { data: planData, error: planError } = await supabase
        .from("treatment_plans")
        .insert([{
          patient_id: patientId,
          clinic_id: clinicId,
          clinic_patient_file_id: clinicPatientFileId || null,
          service_id: services.length === 1 ? services[0].id : null,
          title: planTitle.trim(),
          total_amount: agreedTotalNum,
          planned_visits: visits,
          notes: planNotes.trim() || null,
          payment_arrangement: paymentArrangement,
          created_by: receptionistId,
          status: "Active",
        }])
        .select()
        .single();

      if (planError || !planData) {
        alert(`Error creating treatment plan: ${planError?.message || "Unknown error"}`);
        return;
      }

      let paymentData: TreatmentPlanPayment | null = null;

      if (amountTodayNum > 0.001) {
        const methodLabel = paymentMethod === "Tabby"
          ? `Tabby (Ref: ${tabbyRef.trim()})`
          : paymentMethod === "Tamara"
          ? `Tamara (Ref: ${tamaraRef.trim()})`
          : paymentMethod;

        const { data: pmtData, error: pmtError } = await supabase
          .from("treatment_plan_payments")
          .insert([{
            treatment_plan_id: planData.id,
            patient_id: patientId,
            clinic_id: clinicId,
            amount: amountTodayNum,
            payment_method: methodLabel,
            receptionist_id: receptionistId,
            register_session_id: registerSessionId || null,
            notes: `Initial payment for plan: ${planTitle.trim()}`,
          }])
          .select()
          .single();

        if (pmtError || !pmtData) {
          alert(`Plan created but payment failed: ${pmtError?.message || "Unknown"}`);
        } else {
          paymentData = pmtData as TreatmentPlanPayment;
        }
      }

      onSaved(planData as TreatmentPlan, paymentData);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="relative flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-3xl border border-cyan-100 bg-white shadow-2xl">
        <div className="sticky top-0 flex items-center justify-between border-b border-cyan-100 bg-white px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Active Treatment Plan</h2>
            <p className="text-xs text-slate-500">{patientName}{patientFileNo ? ` · File #${patientFileNo}` : ""}</p>
          </div>
          <button onClick={onClose} className="text-2xl text-slate-400 hover:text-slate-600">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {step === "config" ? (
            <div className="space-y-4">
              {/* Services summary */}
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Selected Services</p>
                <div className="space-y-1">
                  {services.map((s, i) => {
                    const teethStr = s.teeth && s.teeth.length > 0 ? ` — Tooth #${s.teeth.join(", #")}` : "";
                    return (
                      <div key={i} className="flex items-center justify-between text-sm">
                        <span className="text-slate-800">{s.name}{teethStr}</span>
                        <span className="font-semibold text-slate-700">AED {(Number(s.price) * (s.quantity ?? 1)).toFixed(2)}</span>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-2 border-t border-slate-200 pt-2 flex justify-between text-sm font-bold text-slate-900">
                  <span>Total</span>
                  <span>AED {total.toFixed(2)}</span>
                </div>
              </div>

              {/* Plan name */}
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Plan Name</label>
                <input
                  value={planTitle}
                  onChange={(e) => setPlanTitle(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                {/* Agreed total */}
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Agreed Total (AED)</label>
                  <input
                    type="number" min="0" step="0.01"
                    value={agreedTotal}
                    onChange={(e) => setAgreedTotal(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
                  />
                </div>
                {/* Planned visits */}
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Planned Visits</label>
                  <input
                    type="number" min="1" step="1"
                    value={plannedVisits}
                    onChange={(e) => setPlannedVisits(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
                  />
                </div>
              </div>

              {/* Payment arrangement */}
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Payment Arrangement</label>
                <select
                  value={paymentArrangement}
                  onChange={(e) => {
                    const val = e.target.value;
                    setPaymentArrangement(val);
                    if (val === "Full payment today") setAmountToday(String(parseFloat(agreedTotal) || 0));
                    else if (val === "50% now / 50% later") setAmountToday(String(Math.round((parseFloat(agreedTotal) || 0) * 0.5 * 100) / 100));
                    else if (val === "No payment today") setAmountToday("0");
                    else if (val === "Payment per visit") {
                      const visits = parseInt(plannedVisits, 10) || 1;
                      setAmountToday(String(Math.round((parseFloat(agreedTotal) || 0) / visits * 100) / 100));
                    }
                  }}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
                >
                  {PAYMENT_ARRANGEMENTS.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>

              {/* Amount today */}
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Amount Paid Today (AED)</label>
                <input
                  type="number" min="0" step="0.01"
                  value={amountToday}
                  onChange={(e) => setAmountToday(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
                />
                {amountTodayNum < agreedTotalNum - 0.001 && (
                  <p className="mt-1 text-xs text-amber-600">
                    Remaining balance after today: AED {remainingAfterToday.toFixed(2)}
                  </p>
                )}
              </div>

              {/* Payment method (only when amount > 0) */}
              {amountTodayNum > 0.001 && (
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Payment Method</label>
                  <div className="grid grid-cols-3 gap-2">
                    {PLAN_PAYMENT_METHODS.map((m) => (
                      <button
                        key={m}
                        onClick={() => setPaymentMethod(m)}
                        className={`rounded-xl border px-2 py-1.5 text-xs font-semibold transition ${paymentMethod === m ? "border-cyan-300 bg-cyan-600 text-white" : "border-slate-200 bg-white text-slate-700 hover:border-cyan-200"}`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                  {paymentMethod === "Tabby" && (
                    <input value={tabbyRef} onChange={(e) => setTabbyRef(e.target.value)} placeholder="Tabby reference number" className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-cyan-300" />
                  )}
                  {paymentMethod === "Tamara" && (
                    <input value={tamaraRef} onChange={(e) => setTamaraRef(e.target.value)} placeholder="Tamara reference number" className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-cyan-300" />
                  )}
                </div>
              )}

              {/* Notes */}
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Plan Notes (Optional)</label>
                <textarea
                  value={planNotes}
                  onChange={(e) => setPlanNotes(e.target.value)}
                  rows={2}
                  placeholder="Treatment stages, notes…"
                  className="w-full resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
                />
              </div>

              <button
                onClick={goToReview}
                className="w-full rounded-2xl bg-cyan-600 py-3 text-sm font-semibold text-white transition hover:bg-cyan-500"
              >
                Review Plan →
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-2xl border border-cyan-200 bg-cyan-50 p-4 space-y-2">
                <h3 className="text-sm font-bold text-cyan-900">Review Treatment Plan</h3>
                <div className="space-y-1 text-sm text-slate-700">
                  <div className="flex justify-between"><span className="font-semibold">Plan Name</span><span>{planTitle}</span></div>
                  <div className="flex justify-between"><span className="font-semibold">Patient</span><span>{patientName}</span></div>
                  {patientFileNo && <div className="flex justify-between"><span className="font-semibold">File No.</span><span>#{patientFileNo}</span></div>}
                  <div className="flex justify-between"><span className="font-semibold">Planned Visits</span><span>{plannedVisits}</span></div>
                  <div className="flex justify-between"><span className="font-semibold">Agreed Total</span><span>AED {agreedTotalNum.toFixed(2)}</span></div>
                  <div className="flex justify-between"><span className="font-semibold">Payment Arrangement</span><span>{paymentArrangement}</span></div>
                  {amountTodayNum > 0.001 ? (
                    <>
                      <div className="flex justify-between text-emerald-700 font-semibold"><span>Paid Today</span><span>AED {amountTodayNum.toFixed(2)}</span></div>
                      <div className="flex justify-between text-amber-700 font-semibold"><span>Remaining Balance</span><span>AED {remainingAfterToday.toFixed(2)}</span></div>
                      <div className="flex justify-between"><span className="font-semibold">Payment Method</span><span>{paymentMethod}</span></div>
                    </>
                  ) : (
                    <div className="flex justify-between text-slate-500"><span className="font-semibold">Payment Today</span><span>None</span></div>
                  )}
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setStep("config")}
                  className="flex-1 rounded-2xl border border-slate-200 py-3 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
                >
                  ← Edit
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex-1 rounded-2xl bg-cyan-600 py-3 text-sm font-semibold text-white transition hover:bg-cyan-500 disabled:opacity-50"
                >
                  {saving ? "Saving…" : amountTodayNum > 0.001 ? "Save Plan & Record Payment" : "Save Plan"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
