"use client";

import { useEffect, useState } from "react";
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
    setMrnDuplicateWarnings([]);
  }, [isOpen, patient]);

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
      let duplicates: MrnDuplicateWarningCandidate[];
      try {
        const params = new URLSearchParams({ clinicId, mrn: normalizedMrn, excludePatientId: patient.id });
        const response = await fetch(`/api/patients/mrn-matches?${params}`, { cache: "no-store" });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Could not verify MRN.");
        duplicates = result.matches;
      } catch (error) {
        alert(error instanceof Error ? error.message : "Could not verify MRN. Please try again.");
        return;
      }

      if (duplicates.length > 0) {
        setMrnDuplicateWarnings(duplicates);
        return;
      }
    }

    const nextClinicFileNo = fileNumber.trim();
    const nextClinicMrn = mrn.trim() || null;
    if (clinicId && patient.clinic_patient_file_id && !nextClinicFileNo) {
      alert("File No. cannot be empty.");
      return;
    }
    setSaving(true);
    try {
      let savedClinicFile = { file_no: patient.clinic_file_no, mrn: patient.clinic_file_mrn };
      if (clinicId && patient.clinic_patient_file_id) {
        // Reject file conflicts before saving any demographic changes.
        const clinicResponse = await fetch(`/api/patients/${encodeURIComponent(patient.id)}/clinic-file`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clinicId, fileNo: nextClinicFileNo, mrn: nextClinicMrn }),
        });
        const clinicPayload = await clinicResponse.json().catch(() => null);
        if (!clinicResponse.ok || !clinicPayload?.clinicFile) {
          alert(clinicPayload?.error || "Clinic file could not be saved.");
          return;
        }
        savedClinicFile = clinicPayload.clinicFile;
      }
      const patientResponse = await fetch(`/api/patients/${encodeURIComponent(patient.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clinicId, updates }),
      });
      const patientPayload = await patientResponse.json().catch(() => null);
      if (!patientResponse.ok || !patientPayload?.patient) {
        console.error("Update patient failed", { operationId: patientPayload?.operationId });
        alert(`${clinicId && patient.clinic_patient_file_id ? "Clinic file saved, but " : ""}patient details could not be saved. ${patientPayload?.error || "Please retry."}`);
        return;
      }
      const data = patientPayload.patient;

      onSaved?.({
        ...(data as EditablePatient),
        clinic_patient_file_id: patient.clinic_patient_file_id ?? null,
        clinic_file_no: savedClinicFile.file_no ?? null,
        clinic_file_mrn: savedClinicFile.mrn ?? null,
      });
      onClose();
    } catch {
      alert("Could not finish saving. Check the patient details before retrying.");
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
            <input
              type="text"
              value={fileNumber}
              onChange={(e) => setFileNumber(e.target.value)}
              maxLength={100}
              disabled={saving || !clinicId || !patient.clinic_patient_file_id}
              className={inputClass}
            />
            <p className="mt-1 text-xs text-slate-400">
              File No. must be unique within this clinic. No additional PIN is required.
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
