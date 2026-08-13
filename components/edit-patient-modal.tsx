"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import type { Patient } from "../lib/types";
import { COUNTRIES } from "../lib/countries";
import { normalizeMrn } from "../lib/patient-registration";

// ---------------------------------------------------------------------------
// EditPatientModal — edits patient demographics from the profile view.
// File No. is clinic-scoped and stored in clinic_patient_files for the current clinic.
// ---------------------------------------------------------------------------

type EditablePatient = Patient & {
  clinic_file_no?: string | null;
  clinic_file_mrn?: string | null;
  clinic_patient_file_id?: string | null;
};

type MrnDuplicateWarningCandidate = {
  patientId: string;
  name: string;
  fileNo: string | null;
  phone: string | null;
};

export function EditPatientModal({
  isOpen,
  onClose,
  patient,
  clinicId,
  onSaved,
}: {
  isOpen: boolean;
  onClose: () => void;
  patient: EditablePatient | null;
  clinicId: string | null;
  onSaved?: (patient: EditablePatient) => void;
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
  const [mrn, setMrn] = useState("");
  const [fileNumber, setFileNumber] = useState("");
  const [fileNumberUnlocked, setFileNumberUnlocked] = useState(false);
  const [showPinPrompt, setShowPinPrompt] = useState(false);
  const [pinInput, setPinInput] = useState("");
  const [verifyingPin, setVerifyingPin] = useState(false);
  const [saving, setSaving] = useState(false);
  const [mrnDuplicateWarnings, setMrnDuplicateWarnings] = useState<MrnDuplicateWarningCandidate[]>([]);

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
    setMrn(patient.clinic_file_mrn || patient.mrn || "");
    setFileNumber(patient.clinic_file_no || "");
    setFileNumberUnlocked(false);
    setShowPinPrompt(false);
    setPinInput("");
    setMrnDuplicateWarnings([]);
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

  async function save(allowDuplicateMrn = false) {
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
      mrn: mrn.trim() || null,
    };

    const normalizedMrn = normalizeMrn(mrn);
    if (!allowDuplicateMrn && clinicId && normalizedMrn) {
      const { data: clinicFiles, error: clinicFilesError } = await supabase
        .from("clinic_patient_files")
        .select("id, patient_id, file_no, mrn, patients(name, phone, mrn)")
        .eq("clinic_id", clinicId);
      if (clinicFilesError) {
        alert(`Could not verify MRN: ${clinicFilesError.message}`);
        return;
      }

      const duplicates = ((clinicFiles || []) as Array<{
        id: string;
        patient_id: string;
        file_no: string;
        mrn: string | null;
        patients:
          | { name: string | null; phone: string | null; mrn: string | null }
          | Array<{ name: string | null; phone: string | null; mrn: string | null }>
          | null;
      }>)
        .filter((row) => String(row.patient_id || "") !== String(patient.id))
        .map((row) => {
          const linked = Array.isArray(row.patients) ? row.patients[0] : row.patients;
          const candidateMrn = normalizeMrn(row.mrn || linked?.mrn || "");
          return { row, linked, candidateMrn };
        })
        .filter((entry) => entry.candidateMrn === normalizedMrn)
        .map((entry) => ({
          patientId: String(entry.row.patient_id || ""),
          name: String(entry.linked?.name || "Unknown patient"),
          fileNo: entry.row.file_no || null,
          phone: entry.linked?.phone || null,
        }));

      if (duplicates.length > 0) {
        setMrnDuplicateWarnings(duplicates);
        return;
      }
    }

    let nextClinicFileNo = patient.clinic_file_no || null;
    let nextClinicMrn = mrn.trim() || null;
    if (fileNumberUnlocked) {
      if (!clinicId || !patient.clinic_patient_file_id) {
        alert("This patient is missing a clinic-specific file record for the current clinic.");
        return;
      }
      const trimmed = fileNumber.trim();
      if (!trimmed) {
        alert("File No. cannot be empty.");
        return;
      }
      if (trimmed !== String(patient.clinic_file_no || "").trim()) {
        const { data: dupes, error: dupeError } = await supabase
          .from("clinic_patient_files")
          .select("id, patient_id, file_no, patients(name, phone)")
          .eq("clinic_id", clinicId)
          .eq("file_no", trimmed)
          .neq("id", patient.clinic_patient_file_id)
          .limit(1);
        if (dupeError) {
          alert(`Could not verify File No.: ${dupeError.message}`);
          return;
        }
        if ((dupes || []).length > 0) {
          const duplicateRow = (dupes || [])[0] as {
            file_no: string;
            patients:
              | { name: string | null; phone: string | null }
              | Array<{ name: string | null; phone: string | null }>
              | null;
          };
          const linkedPatient = Array.isArray(duplicateRow?.patients) ? duplicateRow.patients[0] : duplicateRow?.patients;
          alert(
            `File No. ${duplicateRow.file_no} already belongs to ${linkedPatient?.name || "another patient"}${linkedPatient?.phone ? ` (${linkedPatient.phone})` : ""} in this clinic.`
          );
          return;
        }
        nextClinicFileNo = trimmed;
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
          alert("This record could not be saved due to a duplicate value.");
        } else {
          alert(`Error saving patient: ${error.message || "Unknown error"}`);
        }
        return;
      }

      if (clinicId && patient.clinic_patient_file_id) {
        const clinicFileUpdates: Record<string, string | null> = {
          mrn: nextClinicMrn,
        };
        if (fileNumberUnlocked && nextClinicFileNo != null) {
          clinicFileUpdates.file_no = nextClinicFileNo;
        }

        const { data: updatedClinicFile, error: clinicFileError } = await supabase
          .from("clinic_patient_files")
          .update(clinicFileUpdates)
          .eq("id", patient.clinic_patient_file_id)
          .eq("clinic_id", clinicId)
          .select("id, file_no, mrn")
          .single();
        if (clinicFileError) {
          alert(`Patient saved, but clinic file update failed: ${clinicFileError.message}`);
          return;
        }
        nextClinicFileNo = String(updatedClinicFile.file_no || "");
        nextClinicMrn = updatedClinicFile.mrn ?? null;
      }

      onSaved?.({
        ...(data as EditablePatient),
        clinic_patient_file_id: patient.clinic_patient_file_id ?? null,
        clinic_file_no: nextClinicFileNo,
        clinic_file_mrn: nextClinicMrn,
      });
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
                type="text"
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
                ? "File No. unlocked — it stays unique within this clinic."
                : "Changing the File No. requires the Owner/Admin PIN."}
            </p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">MRN</label>
            <input type="text" value={mrn} onChange={(e) => setMrn(e.target.value)} className={inputClass} />
          </div>
          {mrnDuplicateWarnings.length > 0 && (
            <div className="rounded-2xl border border-amber-300 bg-amber-50 p-3">
              <p className="text-sm font-semibold text-amber-900">Possible Duplicate MRN</p>
              <p className="mt-1 text-xs text-amber-800">MRN {mrn.trim()} is already used by:</p>
              <div className="mt-2 space-y-1.5">
                {mrnDuplicateWarnings.map((candidate) => (
                  <p key={candidate.patientId} className="rounded-xl border border-amber-200 bg-white px-2 py-1 text-xs text-slate-700">
                    {candidate.name} · File No.: {candidate.fileNo || "—"} · Phone: {candidate.phone || "—"}
                  </p>
                ))}
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => setMrnDuplicateWarnings([])}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700"
                >
                  Go Back
                </button>
                <button
                  onClick={() => void save(true)}
                  disabled={saving}
                  className="rounded-xl bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                >
                  Continue Anyway
                </button>
              </div>
            </div>
          )}
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
            onClick={() => void save()}
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
