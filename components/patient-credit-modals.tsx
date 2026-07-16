"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import type { Clinic, Patient, PatientCredit } from "../lib/types";
import { availableCredit } from "../lib/patient-credits";
import { printDepositReceipt } from "../lib/print-deposit-receipt";

const DEPOSIT_METHODS = ["Cash", "Card", "Tabby", "Tamara", "Split Payment", "Bank Transfer"];
const SPLIT_SECOND_METHODS = ["Card", "Tabby", "Tamara", "Bank Transfer"];
const REASON_PRESETS = ["Advance Payment", "Promo Reservation", "Treatment Deposit", "Other"];

function Overlay({
  isOpen,
  onClose,
  title,
  children,
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl border border-teal-100 bg-white shadow-2xl">
        <div className="sticky top-0 flex items-center justify-between border-b border-teal-100 bg-white px-6 py-4">
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
          <button onClick={onClose} className="text-2xl text-slate-400 hover:text-slate-600">
            ×
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ReceiveDepositModal — records an advance payment (deposit) on the patient's
// account without touching the POS cart, services, or treatment records.
// ---------------------------------------------------------------------------

export function ReceiveDepositModal({
  isOpen,
  onClose,
  patient,
  clinic,
  receptionistId,
  registerSessionId,
  cashierName,
  existingCredits,
  onSaved,
}: {
  isOpen: boolean;
  onClose: () => void;
  patient: Patient | null;
  clinic: Clinic | null;
  receptionistId: string | null;
  registerSessionId: string | null;
  cashierName: string;
  existingCredits: PatientCredit[];
  onSaved?: (credit: PatientCredit) => void;
}) {
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<string>("Cash");
  const [splitCash, setSplitCash] = useState("");
  const [splitOtherMethod, setSplitOtherMethod] = useState("Card");
  const [splitOtherAmount, setSplitOtherAmount] = useState("");
  const [reasonPreset, setReasonPreset] = useState("Advance Payment");
  const [reasonOther, setReasonOther] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const availableNow = useMemo(() => availableCredit(existingCredits), [existingCredits]);

  useEffect(() => {
    if (!isOpen) return;
    setAmount("");
    setMethod("Cash");
    setSplitCash("");
    setSplitOtherMethod("Card");
    setSplitOtherAmount("");
    setReasonPreset("Advance Payment");
    setReasonOther("");
    setExpectedDate("");
    setNotes("");
  }, [isOpen]);

  function parseAmount(value: string) {
    const num = Number(value.replace(/,/g, ".").trim());
    return Number.isFinite(num) ? num : 0;
  }

  async function save() {
    if (!patient) return;
    if (!receptionistId) { alert("Open the register first."); return; }
    if (!clinic?.id) { alert("Deposits need an active clinic. Open the register for a clinic first."); return; }

    const amt = parseAmount(amount);
    if (amt <= 0) { alert("Amount must be greater than 0."); return; }

    const reason = reasonPreset === "Other" ? reasonOther.trim() : reasonPreset;
    if (!reason) { alert("Please enter a reason for the deposit."); return; }

    let methodForSave = method;
    if (method === "Split Payment") {
      const cash = parseAmount(splitCash);
      const other = parseAmount(splitOtherAmount);
      if (cash <= 0 || other <= 0) {
        alert("Please enter both cash and second payment amounts for split payment.");
        return;
      }
      if (Math.abs(cash + other - amt) > 0.01) {
        alert(`Split payment amounts must equal the deposit amount AED ${amt.toFixed(2)}.`);
        return;
      }
      methodForSave = `Split Payment (Cash AED ${cash.toFixed(2)} + ${splitOtherMethod} AED ${other.toFixed(2)})`;
    }

    setSaving(true);
    try {
      const { data, error } = await supabase
        .from("patient_credits")
        .insert([
          {
            patient_id: patient.id,
            clinic_id: clinic.id,
            amount: amt,
            payment_method: methodForSave,
            reason,
            expected_treatment_date: expectedDate || null,
            notes: notes.trim() || null,
            receptionist_id: receptionistId,
            register_session_id: registerSessionId,
          },
        ])
        .select()
        .single();

      if (error) {
        console.error("Receive deposit failed:", error);
        alert(`Error: ${error.message || "Unknown error"}`);
        return;
      }

      const credit = data as PatientCredit;
      printDepositReceipt({
        credit,
        patient,
        clinic,
        cashierName,
        availableAfter: availableNow + amt,
      });
      onSaved?.(credit);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Overlay isOpen={isOpen} onClose={onClose} title="Receive Deposit">
      {patient && (
        <div className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm">
          <p className="text-xs uppercase tracking-wide text-emerald-700">Patient</p>
          <p className="font-semibold text-slate-800">{patient.name}</p>
          <div className="mt-1 flex flex-wrap gap-x-4 text-xs text-slate-500">
            {patient.patient_number != null && (
              <span>File No. #{String(patient.patient_number).padStart(5, "0")}</span>
            )}
            <span>
              Current credit: <span className="font-semibold text-emerald-700">AED {availableNow.toFixed(2)}</span>
            </span>
          </div>
        </div>
      )}
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Amount (AED)</label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="e.g. 500"
            autoFocus
            className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Payment method</label>
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
          >
            {DEPOSIT_METHODS.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
        {method === "Split Payment" && (
          <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Cash Amount (AED)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={splitCash}
                onChange={(e) => setSplitCash(e.target.value)}
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Second Method</label>
              <select
                value={splitOtherMethod}
                onChange={(e) => setSplitOtherMethod(e.target.value)}
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
              >
                {SPLIT_SECOND_METHODS.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Second Method Amount (AED)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={splitOtherAmount}
                onChange={(e) => setSplitOtherAmount(e.target.value)}
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
              />
            </div>
          </div>
        )}
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Reason</label>
          <select
            value={reasonPreset}
            onChange={(e) => setReasonPreset(e.target.value)}
            className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
          >
            {REASON_PRESETS.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
          {reasonPreset === "Other" && (
            <input
              type="text"
              value={reasonOther}
              onChange={(e) => setReasonOther(e.target.value)}
              placeholder="Enter reason"
              className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
            />
          )}
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Expected Treatment Date (optional)</label>
          <input
            type="date"
            value={expectedDate}
            onChange={(e) => setExpectedDate(e.target.value)}
            className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Notes (optional)</label>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
          />
        </div>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button
          onClick={onClose}
          className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600"
        >
          Cancel
        </button>
        <button
          onClick={save}
          disabled={saving}
          className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save & Print Receipt"}
        </button>
      </div>
    </Overlay>
  );
}
