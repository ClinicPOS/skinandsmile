"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import type { Patient } from "../lib/types";
import { COUNTRIES } from "../lib/countries";

// ---------------------------------------------------------------------------
// EditPatientModal — edits patient demographics from the profile view.
// The File Number is an official physical file label, so changing it requires
// the Owner/Admin PIN (verified via /api/verify-boss-pin) and stays unique.
// ---------------------------------------------------------------------------

export function EditPatientModal({
  isOpen,
  onClose,
  patient,
  onSaved,
}: {
  isOpen: boolean;
  onClose: () => void;
  patient: Patient | null;
  onSaved?: (patient: Patient) => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [nationality, setNationality] = useState("");
  const [emiratesId, setEmiratesId] = useState("");
  const [passportNumber, setPassportNumber] = useState("");
  const [address, setAddress] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [sex, setSex] = useState("");
  const [fileNumber, setFileNumber] = useState("");
  const [fileNumberUnlocked, setFileNumberUnlocked] = useState(false);
  const [showPinPrompt, setShowPinPrompt] = useState(false);
  const [pinInput, setPinInput] = useState("");
  const [verifyingPin, setVerifyingPin] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen || !patient) return;
    setName(patient.name || "");
    setPhone(patient.phone || "");
    setEmail(patient.email || "");
    setNationality(patient.nationality || "");
    setEmiratesId(patient.emirates_id || "");
    setPassportNumber(patient.passport_number || "");
    setAddress(patient.address || "");
    setDateOfBirth(patient.date_of_birth || "");
    setSex(patient.sex || "");
    setFileNumber(patient.patient_number != null ? String(patient.patient_number) : "");
    setFileNumberUnlocked(false);
    setShowPinPrompt(false);
    setPinInput("");
  }, [isOpen, patient]);

  async function verifyPin() {
    if (!pinInput.trim()) return;
    setVerifyingPin(true);
    try {
      const res = await fetch("/api/verify-boss-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: pinInput.trim() }),
      });
      const payload = await res.json().catch(() => null);
      if (payload?.valid) {
        setFileNumberUnlocked(true);
        setShowPinPrompt(false);
        setPinInput("");
      } else {
        alert("Invalid PIN.");
      }
    } catch {
      alert("Could not verify PIN. Please try again.");
    } finally {
      setVerifyingPin(false);
    }
  }

  async function save() {
    if (!patient) return;
    if (!name.trim()) {
      alert("Patient name is required.");
      return;
    }

    const updates: Record<string, unknown> = {
      name: name.trim(),
      // Live patients.phone column is NOT NULL; POS inserts "" too.
      phone: phone.trim(),
      email: email.trim() || null,
      nationality: nationality.trim() || null,
      emirates_id: emiratesId.trim() || null,
      passport_number: passportNumber.trim() || null,
      address: address.trim() || null,
      date_of_birth: dateOfBirth || null,
      sex: sex || null,
    };

    if (fileNumberUnlocked) {
      const trimmed = fileNumber.trim();
      if (!trimmed) {
        alert("File No. cannot be empty.");
        return;
      }
      const parsed = parseInt(trimmed, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        alert("File No. must be a positive number.");
        return;
      }
      if (parsed !== patient.patient_number) {
        const { data: dupes, error: dupeError } = await supabase
          .from("patients")
          .select("id")
          .eq("patient_number", parsed)
          .neq("id", patient.id)
          .limit(1);
        if (dupeError) {
          alert(`Could not verify File No.: ${dupeError.message}`);
          return;
        }
        if ((dupes || []).length > 0) {
          alert("This File Number already exists. Please use another File Number.");
          return;
        }
        updates.patient_number = parsed;
      }
    }

    setSaving(true);
    try {
      const { data, error } = await supabase
        .from("patients")
        .update(updates)
        .eq("id", patient.id)
        .select()
        .single();

      if (error) {
        console.error("Update patient failed:", error);
        if ((error as { code?: string }).code === "23505") {
          alert("This File Number already exists. Please use another File Number.");
        } else {
          alert(`Error saving patient: ${error.message || "Unknown error"}`);
        }
        return;
      }

      onSaved?.(data as Patient);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  if (!isOpen || !patient) return null;

  const inputClass =
    "w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100";

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl border border-teal-100 bg-white shadow-2xl">
        <div className="sticky top-0 flex items-center justify-between border-b border-teal-100 bg-white px-6 py-4">
          <h2 className="text-lg font-semibold text-slate-900">Edit Patient</h2>
          <button onClick={onClose} className="text-2xl text-slate-400 hover:text-slate-600">
            ×
          </button>
        </div>
        <div className="space-y-3 p-6">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">File No.</label>
            <div className="flex gap-2">
              <input
                type="number"
                min="1"
                value={fileNumber}
                onChange={(e) => setFileNumber(e.target.value)}
                disabled={!fileNumberUnlocked}
                className={`${inputClass} disabled:bg-slate-100 disabled:text-slate-500`}
              />
              {!fileNumberUnlocked && !showPinPrompt && (
                <button
                  onClick={() => setShowPinPrompt(true)}
                  className="shrink-0 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-2 text-xs font-semibold text-amber-700 transition hover:bg-amber-100"
                >
                  Unlock
                </button>
              )}
            </div>
            {showPinPrompt && (
              <div className="mt-2 flex gap-2">
                <input
                  type="password"
                  value={pinInput}
                  onChange={(e) => setPinInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") verifyPin(); }}
                  placeholder="Owner/Admin PIN"
                  autoFocus
                  className={inputClass}
                />
                <button
                  onClick={verifyPin}
                  disabled={verifyingPin}
                  className="shrink-0 rounded-2xl bg-amber-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
                >
                  {verifyingPin ? "…" : "Verify"}
                </button>
              </div>
            )}
            <p className="mt-1 text-xs text-slate-400">
              {fileNumberUnlocked
                ? "File No. unlocked — it must stay unique."
                : "Changing the File No. requires the Owner/Admin PIN."}
            </p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Name *</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Phone</label>
              <input type="text" value={phone} onChange={(e) => setPhone(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Date of Birth</label>
              <input type="date" value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Gender</label>
              <select value={sex} onChange={(e) => setSex(e.target.value)} className={inputClass}>
                <option value="">Select</option>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Nationality</label>
            <input
              type="text"
              value={nationality}
              onChange={(e) => setNationality(e.target.value)}
              list="edit-patient-nationalities"
              className={inputClass}
            />
            <datalist id="edit-patient-nationalities">
              {COUNTRIES.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Emirates ID</label>
              <input type="text" value={emiratesId} onChange={(e) => setEmiratesId(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Passport No.</label>
              <input type="text" value={passportNumber} onChange={(e) => setPassportNumber(e.target.value)} className={inputClass} />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Address</label>
            <input type="text" value={address} onChange={(e) => setAddress(e.target.value)} className={inputClass} />
          </div>
          <div className="mt-2 flex justify-end gap-2">
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
              {saving ? "Saving…" : "Save Changes"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
