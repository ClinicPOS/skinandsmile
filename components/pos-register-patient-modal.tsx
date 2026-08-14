"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import { COUNTRIES } from "../lib/countries";
import { ensurePatientClinicFile } from "../lib/clinic-patient-files";
import {
  DuplicateCandidate,
  FileNoConflictCandidate,
  MrnDuplicateCandidate,
  findClinicFileNoConflict,
  findPossibleDuplicateMrnInClinic,
  findPossibleDuplicatePatients,
  normalizePatientPhone,
  registerPatientFromPos,
  type ClinicPatientFileLike,
  type PatientLike,
} from "../lib/patient-registration";
import {
  getEmiratesIdReaderMessage,
  mergeReaderPatientFields,
  readEmiratesIdCard,
  readEmiratesIdDiagnostic,
} from "../lib/emirates-id-reader";

type RegisteredPatientPayload = {
  patient: PatientLike & {
    clinic_patient_file_id: string;
    clinic_file_no: string;
    clinic_file_mrn?: string | null;
  };
  successMessage: string;
};

export function PosRegisterPatientModal({
  isOpen,
  clinicId,
  patients,
  clinicPatientFiles,
  onClose,
  onPatientRegistered,
}: {
  isOpen: boolean;
  clinicId: string | null;
  patients: PatientLike[];
  clinicPatientFiles: ClinicPatientFileLike[];
  onClose: () => void;
  onPatientRegistered: (payload: RegisteredPatientPayload) => void;
}) {
  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [email, setEmail] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [gender, setGender] = useState("");
  const [nationality, setNationality] = useState("");
  const [emiratesId, setEmiratesId] = useState("");
  const [passportNumber, setPassportNumber] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [mrn, setMrn] = useState("");
  const [fileNo, setFileNo] = useState("");
  const [saving, setSaving] = useState(false);
  const [warningCandidates, setWarningCandidates] = useState<DuplicateCandidate[]>([]);
  const [confirmCreateAnyway, setConfirmCreateAnyway] = useState(false);
  const [mrnWarningCandidates, setMrnWarningCandidates] = useState<MrnDuplicateCandidate[]>([]);
  const [pendingCreateAfterMrnWarning, setPendingCreateAfterMrnWarning] = useState(false);
  const [readerStatus, setReaderStatus] = useState("Ready");
  const [readerSkippedFields, setReaderSkippedFields] = useState<string[]>([]);
  const [readerPhoto, setReaderPhoto] = useState<string | null>(null);
  const [readerDiagnosticStatus, setReaderDiagnosticStatus] = useState("");
  const [readerDiagnosticPaths, setReaderDiagnosticPaths] = useState<string[]>([]);

  const hasWarnings = warningCandidates.length > 0;
  const canonicalMobile = useMemo(() => normalizePatientPhone(mobile), [mobile]);

  function resetAndClose() {
    setName("");
    setMobile("");
    setEmail("");
    setDateOfBirth("");
    setGender("");
    setNationality("");
    setEmiratesId("");
    setPassportNumber("");
    setAddress("");
    setNotes("");
    setMrn("");
    setFileNo("");
    setSaving(false);
    setWarningCandidates([]);
    setConfirmCreateAnyway(false);
    setMrnWarningCandidates([]);
    setPendingCreateAfterMrnWarning(false);
    setReaderStatus("Ready");
    setReaderSkippedFields([]);
    setReaderPhoto(null);
    setReaderDiagnosticStatus("");
    setReaderDiagnosticPaths([]);
    onClose();
  }

  function computeWarnings() {
    if (!clinicId) return [];
    return findPossibleDuplicatePatients({
      patients,
      clinicPatientFiles,
      clinicId,
      fullName: name,
      mobile,
      dateOfBirth: dateOfBirth || null,
    });
  }

  async function handleReadEmiratesId() {
    setReaderStatus("Reading Emirates ID…");
    setReaderSkippedFields([]);
    setReaderPhoto(null);

    try {
      const result = await readEmiratesIdCard();
      const { updates, skippedFields } = mergeReaderPatientFields(
        {
          name,
          emiratesId,
          dateOfBirth,
          sex: gender,
          nationality,
          phone: mobile,
          email,
          passportNumber,
        },
        result.fields
      );

      if (updates.name) setName(updates.name);
      if (updates.emiratesId) setEmiratesId(updates.emiratesId);
      if (updates.dateOfBirth) setDateOfBirth(updates.dateOfBirth);
      if (updates.sex) setGender(updates.sex);
      if (updates.nationality) setNationality(updates.nationality);
      if (updates.phone) setMobile(updates.phone);
      if (updates.email) setEmail(updates.email);
      if (updates.passportNumber) setPassportNumber(updates.passportNumber);

      setReaderPhoto(result.photoDataUrl);
      setReaderSkippedFields(skippedFields);
      setReaderStatus("Emirates ID read successfully");
    } catch (error) {
      setReaderPhoto(null);
      setReaderSkippedFields([]);
      setReaderStatus(getEmiratesIdReaderMessage(error));
    }
  }

  async function handleInspectEmiratesIdFields() {
    setReaderDiagnosticStatus("Inspecting Emirates ID response keys…");
    setReaderDiagnosticPaths([]);

    try {
      const result = await readEmiratesIdDiagnostic();
      setReaderDiagnosticPaths(result.keyPaths);
      setReaderDiagnosticStatus(result.keyPaths.length > 0 ? "Reader response keys loaded." : "No reader response keys were returned.");
    } catch (error) {
      setReaderDiagnosticPaths([]);
      setReaderDiagnosticStatus(getEmiratesIdReaderMessage(error));
    }
  }

  function findFileNoConflictForClinic(excludePatientId?: string | null): FileNoConflictCandidate | null {
    if (!clinicId) return null;
    return findClinicFileNoConflict({
      patients,
      clinicPatientFiles,
      clinicId,
      fileNo,
      excludePatientId,
    });
  }

  function computeMrnWarnings(excludePatientId?: string | null) {
    if (!clinicId) return [];
    if (!mrn.trim()) return [];
    return findPossibleDuplicateMrnInClinic({
      patients,
      clinicPatientFiles,
      clinicId,
      mrn,
      excludePatientId,
    });
  }

  async function createNewPatient() {
    if (!clinicId) {
      alert("Open the register for a clinic first.");
      return;
    }
    setSaving(true);
    try {
      const created = await registerPatientFromPos({
        clinicId,
        fullName: name,
        mobile,
        email: email || null,
        dateOfBirth: dateOfBirth || null,
        sex: gender || null,
        nationality: nationality || null,
        emiratesId: emiratesId || null,
        passportNumber: passportNumber || null,
        mrn: mrn || null,
        address: address || null,
        notes: notes || null,
        fileNo: fileNo || null,
      });

      onPatientRegistered({
        patient: {
          id: created.patientId,
          name: name.trim(),
          phone: mobile.trim(),
          email: email.trim() || null,
          date_of_birth: dateOfBirth || null,
          sex: gender || null,
          nationality: nationality.trim() || null,
          emirates_id: emiratesId.trim() || null,
          passport_number: passportNumber.trim() || null,
          address: address.trim() || null,
          notes: notes.trim() || null,
          mrn: mrn.trim() || null,
          clinic_patient_file_id: created.clinicPatientFileId,
          clinic_file_no: created.fileNo,
          clinic_file_mrn: mrn.trim() || null,
          patient_number: null,
        },
        successMessage: `Patient registered and selected (File #${created.fileNo}).`,
      });
      resetAndClose();
    } catch (error) {
      alert(error instanceof Error ? error.message : "Could not register patient.");
    } finally {
      setSaving(false);
    }
  }

  async function savePatient() {
    if (!name.trim()) {
      alert("Full Name is required.");
      return;
    }

    const warnings = computeWarnings();
    if (warnings.length > 0) {
      setWarningCandidates(warnings);
      setConfirmCreateAnyway(false);
      return;
    }

    const fileNoConflict = findFileNoConflictForClinic();
    if (fileNoConflict) {
      alert(
        `File No. ${fileNoConflict.clinicFileNo} already belongs to ${fileNoConflict.name}${fileNoConflict.phone ? ` (${fileNoConflict.phone})` : ""} in this clinic.`
      );
      return;
    }

    const mrnWarnings = computeMrnWarnings();
    if (mrnWarnings.length > 0) {
      setMrnWarningCandidates(mrnWarnings);
      setPendingCreateAfterMrnWarning(true);
      return;
    }

    await createNewPatient();
  }

  async function selectExisting(candidate: DuplicateCandidate) {
    if (!clinicId) {
      alert("Open the register for a clinic first.");
      return;
    }
    const matchedPatient = patients.find((row) => String(row.id) === candidate.patientId);
    if (!matchedPatient) {
      alert("Could not load selected patient.");
      return;
    }

    setSaving(true);
    try {
      if (candidate.clinicFileNo && fileNo.trim() && candidate.clinicFileNo !== fileNo.trim()) {
        alert(`This patient already has File No. ${candidate.clinicFileNo} in this clinic. Use Edit Patient to change it.`);
        return;
      }

      const fileNoConflict = findFileNoConflictForClinic(candidate.patientId);
      if (fileNoConflict) {
        alert(
          `File No. ${fileNoConflict.clinicFileNo} already belongs to ${fileNoConflict.name}${fileNoConflict.phone ? ` (${fileNoConflict.phone})` : ""} in this clinic.`
        );
        return;
      }

      const ensured = await ensurePatientClinicFile({
        clinicId,
        patientId: candidate.patientId,
        mrn: mrn.trim() || null,
        fileNo: fileNo.trim() || null,
      });
      onPatientRegistered({
        patient: {
          ...matchedPatient,
          clinic_patient_file_id: ensured.clinicPatientFileId,
          clinic_file_no: ensured.fileNo,
          clinic_file_mrn: mrn.trim() || null,
        },
        successMessage: ensured.clinicFileCreated
          ? `Existing patient linked to this clinic and selected (File #${ensured.fileNo}).`
          : `Existing patient selected (File #${ensured.fileNo}).`,
      });
      resetAndClose();
    } catch (error) {
      alert(error instanceof Error ? error.message : "Could not link patient to clinic.");
    } finally {
      setSaving(false);
    }
  }

  async function continueAfterMrnWarning() {
    const fileNoConflict = findFileNoConflictForClinic();
    if (fileNoConflict) {
      alert(
        `File No. ${fileNoConflict.clinicFileNo} already belongs to ${fileNoConflict.name}${fileNoConflict.phone ? ` (${fileNoConflict.phone})` : ""} in this clinic.`
      );
      return;
    }
    setMrnWarningCandidates([]);
    setPendingCreateAfterMrnWarning(false);
    await createNewPatient();
  }

  if (!isOpen) return null;

  const inputClass =
    "w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-cyan-400 focus:ring-4 focus:ring-cyan-100";

  return (
    <div className="fixed inset-0 z-[65] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="relative max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-3xl border border-teal-100 bg-white shadow-2xl">
        <div className="sticky top-0 flex items-center justify-between border-b border-teal-100 bg-white px-6 py-4">
          <h2 className="text-lg font-semibold text-slate-900">Register Patient</h2>
          <button onClick={resetAndClose} className="text-2xl text-slate-400 hover:text-slate-600">
            ×
          </button>
        </div>

        <div className="space-y-4 p-6">
          {hasWarnings && (
            <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4">
              <p className="text-sm font-semibold text-amber-900">Possible existing patient found</p>
              <p className="mt-1 text-xs text-amber-800">
                Mobile in canonical form: {canonicalMobile || "N/A"}. Select an existing patient or explicitly confirm creating a new one.
              </p>
              <div className="mt-3 space-y-2">
                {warningCandidates.map((candidate) => (
                  <div key={candidate.patientId} className="rounded-xl border border-amber-200 bg-white px-3 py-2">
                    <p className="text-sm font-semibold text-slate-900">{candidate.name}</p>
                    <p className="text-xs text-slate-600">
                      {(candidate.clinicFileNo || candidate.patientNumber != null)
                        ? `Patient/File #${candidate.clinicFileNo || candidate.patientNumber}`
                        : "No file number assigned"}
                      {candidate.dateOfBirth ? ` · DOB: ${new Date(candidate.dateOfBirth).toLocaleDateString("en-GB")}` : ""}
                    </p>
                    <p className="text-xs text-slate-600">Mobile: {candidate.phone || "No mobile saved"}</p>
                    <p className="mt-1 text-[11px] text-amber-700">
                      {candidate.matchedByPhone ? "Mobile match" : ""}
                      {candidate.matchedByPhone && candidate.matchedByNameDob ? " · " : ""}
                      {candidate.matchedByNameDob ? "Name + DOB match" : ""}
                    </p>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void selectExisting(candidate)}
                      className="mt-2 rounded-xl bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-teal-500 disabled:opacity-60"
                    >
                      Select Existing Patient
                    </button>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {!confirmCreateAnyway ? (
                  <button
                    type="button"
                    onClick={() => setConfirmCreateAnyway(true)}
                    className="rounded-xl border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-800 transition hover:bg-amber-100"
                  >
                    Create New Patient Anyway
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void createNewPatient()}
                    className="rounded-xl bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-rose-500 disabled:opacity-60"
                  >
                    Confirm Create New Patient
                  </button>
                )}
                <button
                  type="button"
                  onClick={resetAndClose}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
          {mrnWarningCandidates.length > 0 && (
            <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4">
              <p className="text-sm font-semibold text-amber-900">Possible Duplicate MRN</p>
              <p className="mt-1 text-xs text-amber-800">
                MRN {mrn.trim()} is already used by:
              </p>
              <div className="mt-3 space-y-2">
                {mrnWarningCandidates.map((candidate) => (
                  <div key={candidate.patientId} className="rounded-xl border border-amber-200 bg-white px-3 py-2">
                    <p className="text-sm font-semibold text-slate-900">{candidate.name}</p>
                    <p className="text-xs text-slate-600">
                      File No.: {candidate.clinicFileNo || "—"} · Phone: {candidate.phone || "—"}
                    </p>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setMrnWarningCandidates([]);
                    setPendingCreateAfterMrnWarning(false);
                  }}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                >
                  Go Back
                </button>
                {pendingCreateAfterMrnWarning && (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void continueAfterMrnWarning()}
                    className="rounded-xl bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-rose-500 disabled:opacity-60"
                  >
                    Continue Anyway
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">Emirates ID Reader</p>
                <p className="mt-1 text-xs text-slate-500">{readerStatus}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void handleReadEmiratesId()}
                  disabled={readerStatus === "Reading Emirates ID…" || readerDiagnosticStatus === "Inspecting Emirates ID response keys…"}
                  className="rounded-xl border border-cyan-200 bg-white px-3 py-1.5 text-xs font-semibold text-cyan-700 transition hover:bg-cyan-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {readerStatus === "Reading Emirates ID…" ? "Reading Emirates ID…" : "Read Emirates ID"}
                </button>
                <button
                  type="button"
                  onClick={() => void handleInspectEmiratesIdFields()}
                  disabled={readerStatus === "Reading Emirates ID…" || readerDiagnosticStatus === "Inspecting Emirates ID response keys…"}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {readerDiagnosticStatus === "Inspecting Emirates ID response keys…" ? "Inspecting Reader Fields…" : "Inspect Reader Fields"}
                </button>
              </div>
            </div>
            {readerSkippedFields.length > 0 ? (
              <p className="mt-3 text-xs text-amber-700">
                Existing fields were left unchanged: {readerSkippedFields.join(", ")}.
              </p>
            ) : null}
            {readerDiagnosticStatus ? (
              <p className="mt-3 text-xs text-slate-600">{readerDiagnosticStatus}</p>
            ) : null}
            {readerDiagnosticPaths.length > 0 ? (
              <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Returned Reader Keys Only</p>
                <ul className="mt-2 space-y-1 text-xs text-slate-700">
                  {readerDiagnosticPaths.map((path) => (
                    <li key={path} className="font-mono">
                      {path}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {readerPhoto ? (
              <div className="mt-4">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Emirates ID Photo</p>
                <Image
                  src={readerPhoto}
                  alt="Emirates ID Photo"
                  width={96}
                  height={112}
                  unoptimized
                  className="mt-2 h-28 w-24 rounded-xl border border-slate-200 object-cover"
                />
              </div>
            ) : null}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Full Name *</label>
              <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} placeholder="Patient full name" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Mobile Number (Optional)</label>
              <input value={mobile} onChange={(e) => setMobile(e.target.value)} className={inputClass} placeholder="e.g. 0501234567" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Email</label>
              <input value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} type="email" placeholder="patient@example.com" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Date of Birth</label>
              <input value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} className={inputClass} type="date" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Gender</label>
              <select value={gender} onChange={(e) => setGender(e.target.value)} className={inputClass}>
                <option value="">Select</option>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Nationality</label>
              <input value={nationality} onChange={(e) => setNationality(e.target.value)} className={inputClass} list="register-patient-nationalities" />
              <datalist id="register-patient-nationalities">
                {COUNTRIES.map((country) => (
                  <option key={country} value={country} />
                ))}
              </datalist>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Emirates ID</label>
              <input value={emiratesId} onChange={(e) => setEmiratesId(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Passport Number</label>
              <input value={passportNumber} onChange={(e) => setPassportNumber(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Address</label>
              <input value={address} onChange={(e) => setAddress(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">File No. (Optional)</label>
              <input value={fileNo} onChange={(e) => setFileNo(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">MRN</label>
              <input value={mrn} onChange={(e) => setMrn(e.target.value)} className={inputClass} />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Notes</label>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className={inputClass} />
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-4">
          <button
            onClick={resetAndClose}
            className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            onClick={() => void savePatient()}
            disabled={saving}
            className="rounded-xl bg-cyan-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-cyan-500 disabled:opacity-60"
          >
            {saving ? "Saving..." : "Save Patient"}
          </button>
        </div>
      </div>
    </div>
  );
}
