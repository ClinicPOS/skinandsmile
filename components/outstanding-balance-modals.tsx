"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import type { Clinic, Patient, OutstandingBalance, BalancePayment } from "../lib/types";
import { rollupBalance } from "../lib/outstanding-balances";

const PAYMENT_METHODS = ["Cash", "Card", "Visa", "Mastercard", "Tabby", "Tabby Card", "Tamara", "Tamara Card"];

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
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
// AddOutstandingBalanceModal — admin-only. Creates a migrated invoice for a patient.
// ---------------------------------------------------------------------------

export function AddOutstandingBalanceModal({
  isOpen,
  onClose,
  patient,
  clinics,
  createdBy,
  onSaved,
}: {
  isOpen: boolean;
  onClose: () => void;
  patient: Patient | null;
  clinics: Clinic[];
  createdBy?: string | null;
  onSaved?: (balance: OutstandingBalance) => void;
}) {
  const [clinicId, setClinicId] = useState<string>("");
  const [originalDate, setOriginalDate] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("Previous balance before system migration");
  const [reference, setReference] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setClinicId(clinics[0]?.id ?? "");
    setOriginalDate("");
    setAmount("");
    setReason("Previous balance before system migration");
    setReference("");
  }, [isOpen, clinics]);

  async function save() {
    if (!patient) return;
    if (!clinicId) { alert("Choose a clinic."); return; }
    if (!originalDate) { alert("Original date is required."); return; }
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) { alert("Amount must be greater than 0."); return; }

    setSaving(true);
    try {
      const { data, error } = await supabase
        .from("outstanding_balances")
        .insert([
          {
            patient_id: patient.id,
            clinic_id: clinicId,
            original_date: originalDate,
            original_amount: amt,
            reason: reason.trim() || null,
            reference_number: reference.trim() || null,
            created_by: createdBy ?? null,
          },
        ])
        .select()
        .single();

      if (error) {
        console.error("Add outstanding balance failed:", error);
        alert(`Error: ${error.message || "Unknown error"}`);
        return;
      }
      onSaved?.(data as OutstandingBalance);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Overlay isOpen={isOpen} onClose={onClose} title="Add Outstanding Balance">
      {patient && (
        <div className="mb-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
          <p className="text-xs uppercase tracking-wide text-slate-500">Patient</p>
          <p className="font-semibold text-slate-800">{patient.name}</p>
          {patient.patient_number != null && (
            <p className="text-xs text-slate-500">File No. #{String(patient.patient_number).padStart(5, "0")}</p>
          )}
        </div>
      )}
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Clinic</label>
          <select
            value={clinicId}
            onChange={(e) => setClinicId(e.target.value)}
            className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
          >
            <option value="">Select clinic…</option>
            {clinics.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Original Date</label>
          <input
            type="date"
            value={originalDate}
            onChange={(e) => setOriginalDate(e.target.value)}
            className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Amount (AED)</label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="e.g. 800"
            className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Reason</label>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Reference Number (optional)</label>
          <input
            type="text"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="Old system invoice #"
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
          className="rounded-xl bg-cyan-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save Balance"}
        </button>
      </div>
    </Overlay>
  );
}

// ---------------------------------------------------------------------------
// CollectBalancePaymentModal — POS/staff-side. Records a payment against a balance.
// ---------------------------------------------------------------------------

export function CollectBalancePaymentModal({
  isOpen,
  onClose,
  balance,
  patient,
  clinic,
  existingPayments,
  receptionistId,
  registerSessionId,
  onCollected,
}: {
  isOpen: boolean;
  onClose: () => void;
  balance: OutstandingBalance | null;
  patient: Patient | null;
  clinic: Clinic | null;
  existingPayments: BalancePayment[];
  receptionistId: string | null;
  registerSessionId: string | null;
  onCollected?: (
    payment: BalancePayment,
    context: { balance: OutstandingBalance; patient: Patient; clinic: Clinic | null; remainingAfter: number }
  ) => void;
}) {
  const rollup = useMemo(
    () => (balance ? rollupBalance(balance, existingPayments) : null),
    [balance, existingPayments]
  );

  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<string>("Cash");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen || !rollup) return;
    setAmount(rollup.remaining > 0 ? rollup.remaining.toFixed(2) : "");
    setMethod("Cash");
    setNotes("");
  }, [isOpen, rollup]);

  async function save() {
    if (!balance || !patient || !rollup) return;
    if (!receptionistId) { alert("Open the register first."); return; }
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) { alert("Amount must be greater than 0."); return; }
    if (amt > rollup.remaining + 0.0049) {
      alert(`Amount exceeds remaining balance (AED ${rollup.remaining.toFixed(2)}).`);
      return;
    }

    setSaving(true);
    try {
      const { data, error } = await supabase
        .from("balance_payments")
        .insert([
          {
            outstanding_balance_id: balance.id,
            amount: amt,
            payment_method: method,
            receptionist_id: receptionistId,
            register_session_id: registerSessionId,
            notes: notes.trim() || null,
          },
        ])
        .select()
        .single();

      if (error) {
        console.error("Collect balance payment failed:", error);
        alert(`Error: ${error.message || "Unknown error"}`);
        return;
      }
      const payment = data as BalancePayment;
      const remainingAfter = Math.max(0, rollup.remaining - amt);
      onCollected?.(payment, { balance, patient, clinic, remainingAfter });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  if (!balance || !rollup) return <Overlay isOpen={isOpen} onClose={onClose} title="Collect Payment">{null}</Overlay>;

  return (
    <Overlay isOpen={isOpen} onClose={onClose} title="Collect Outstanding Payment">
      <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm">
        <p className="text-xs uppercase tracking-wide text-amber-700">Patient</p>
        <p className="font-semibold text-slate-800">{patient?.name}</p>
        <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
          <div>
            <p className="uppercase text-slate-500">Original</p>
            <p className="text-sm font-semibold text-slate-800">AED {Number(balance.original_amount).toFixed(2)}</p>
          </div>
          <div>
            <p className="uppercase text-slate-500">Paid</p>
            <p className="text-sm font-semibold text-slate-800">AED {rollup.paid.toFixed(2)}</p>
          </div>
          <div>
            <p className="uppercase text-slate-500">Remaining</p>
            <p className="text-sm font-semibold text-amber-700">AED {rollup.remaining.toFixed(2)}</p>
          </div>
        </div>
        {balance.reference_number && (
          <p className="mt-2 text-xs text-slate-500">Ref: {balance.reference_number}</p>
        )}
      </div>
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Amount received (AED)</label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
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
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
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
          className="rounded-xl bg-cyan-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {saving ? "Saving…" : "Collect & Print"}
        </button>
      </div>
    </Overlay>
  );
}
