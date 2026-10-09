export type PatientLike = {
  id: string;
  name?: string | null;
  phone?: string | null;
  mrn?: string | null;
  date_of_birth?: string | null;
  email?: string | null;
  sex?: string | null;
  nationality?: string | null;
  emirates_id?: string | null;
  passport_number?: string | null;
  patient_number?: number | null;
  notes?: string | null;
  address?: string | null;
};

export type ClinicPatientFileLike = {
  id: string;
  clinic_id: string;
  patient_id: string;
  file_no: string;
  mrn?: string | null;
};

export type DuplicateCandidate = {
  patientId: string;
  name: string;
  phone: string | null;
  dateOfBirth: string | null;
  patientNumber: number | null;
  clinicPatientFileId: string | null;
  clinicFileNo: string | null;
  matchedByPhone: boolean;
  matchedByNameDob: boolean;
};

export type MrnDuplicateCandidate = {
  patientId: string;
  name: string;
  phone: string | null;
  clinicFileNo: string | null;
  mrn: string;
};

export type FileNoConflictCandidate = {
  patientId: string;
  name: string;
  phone: string | null;
  clinicFileNo: string;
};

export function normalizePatientPhone(value: string | null | undefined): string {
  const rawDigits = String(value || "").replace(/\D/g, "");
  if (!rawDigits) return "";

  let digits = rawDigits;
  if (digits.startsWith("00971")) {
    digits = `971${digits.slice(5)}`;
  }

  if (digits.startsWith("971") && digits.length === 12 && digits.slice(3, 4) === "5") {
    return `+${digits}`;
  }
  if (digits.length === 10 && digits.startsWith("05")) {
    return `+971${digits.slice(1)}`;
  }
  if (digits.length === 9 && digits.startsWith("5")) {
    return `+971${digits}`;
  }
  if (digits.startsWith("971")) {
    return `+${digits}`;
  }
  return `+${digits}`;
}

export function normalizePatientName(value: string | null | undefined): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~-]+/g, " ")
    .replace(/\s+/g, " ");
}

export function normalizeMrn(value: string | null | undefined): string {
  return String(value || "").trim().toUpperCase();
}

export function findPossibleDuplicatePatients(input: {
  patients: PatientLike[];
  clinicPatientFiles: ClinicPatientFileLike[];
  clinicId: string;
  fullName: string;
  mobile: string;
  dateOfBirth?: string | null;
}): DuplicateCandidate[] {
  const canonicalMobile = normalizePatientPhone(input.mobile);
  const canonicalName = normalizePatientName(input.fullName);
  const dob = String(input.dateOfBirth || "");
  const clinicFileByPatientId = new Map<string, ClinicPatientFileLike>();

  for (const row of input.clinicPatientFiles) {
    if (row.clinic_id !== input.clinicId) continue;
    clinicFileByPatientId.set(String(row.patient_id), row);
  }

  const matches: DuplicateCandidate[] = [];
  for (const patient of input.patients) {
    const patientId = String(patient.id || "");
    if (!patientId) continue;
    const patientMobile = normalizePatientPhone(patient.phone);
    const patientName = normalizePatientName(patient.name);
    const phoneMatch = canonicalMobile.length > 0 && patientMobile === canonicalMobile;
    const nameDobMatch =
      canonicalName.length > 0 &&
      dob.length > 0 &&
      patientName === canonicalName &&
      String(patient.date_of_birth || "") === dob;
    if (!phoneMatch && !nameDobMatch) continue;

    const file = clinicFileByPatientId.get(patientId);
    matches.push({
      patientId,
      name: String(patient.name || "Unknown patient"),
      phone: patient.phone ?? null,
      dateOfBirth: patient.date_of_birth ?? null,
      patientNumber: patient.patient_number ?? null,
      clinicPatientFileId: file?.id || null,
      clinicFileNo: file?.file_no || null,
      matchedByPhone: phoneMatch,
      matchedByNameDob: nameDobMatch,
    });
  }

  return matches;
}

export function findPossibleDuplicateMrnInClinic(input: {
  patients: PatientLike[];
  clinicPatientFiles: ClinicPatientFileLike[];
  clinicId: string;
  mrn: string;
  excludePatientId?: string | null;
}): MrnDuplicateCandidate[] {
  const normalizedInputMrn = normalizeMrn(input.mrn);
  if (!normalizedInputMrn) return [];

  const patientById = new Map<string, PatientLike>();
  for (const patient of input.patients) {
    patientById.set(String(patient.id || ""), patient);
  }

  const matches: MrnDuplicateCandidate[] = [];
  for (const file of input.clinicPatientFiles) {
    if (String(file.clinic_id || "") !== input.clinicId) continue;
    const patientId = String(file.patient_id || "");
    if (!patientId) continue;
    if (input.excludePatientId && patientId === String(input.excludePatientId)) continue;
    const patient = patientById.get(patientId);
    const candidateMrn = normalizeMrn(file.mrn ?? patient?.mrn ?? "");
    if (!candidateMrn || candidateMrn !== normalizedInputMrn) continue;
    matches.push({
      patientId,
      name: String(patient?.name || "Unknown patient"),
      phone: patient?.phone ?? null,
      clinicFileNo: String(file.file_no || "") || null,
      mrn: candidateMrn,
    });
  }

  return matches;
}

export function findClinicFileNoConflict(input: {
  patients: PatientLike[];
  clinicPatientFiles: ClinicPatientFileLike[];
  clinicId: string;
  fileNo: string;
  excludePatientId?: string | null;
}): FileNoConflictCandidate | null {
  const target = String(input.fileNo || "").trim();
  if (!target) return null;

  const patientById = new Map<string, PatientLike>();
  for (const patient of input.patients) {
    patientById.set(String(patient.id || ""), patient);
  }

  for (const file of input.clinicPatientFiles) {
    if (String(file.clinic_id || "") !== input.clinicId) continue;
    if (String(file.file_no || "").trim() !== target) continue;
    const patientId = String(file.patient_id || "");
    if (input.excludePatientId && patientId === String(input.excludePatientId)) continue;
    const patient = patientById.get(patientId);
    return {
      patientId,
      name: String(patient?.name || "Unknown patient"),
      phone: patient?.phone ?? null,
      clinicFileNo: target,
    };
  }

  return null;
}

export async function registerPatientFromPos(payload: {
  clinicId: string;
  fullName: string;
  mobile: string;
  email?: string | null;
  dateOfBirth?: string | null;
  sex?: string | null;
  nationality?: string | null;
  emiratesId?: string | null;
  passportNumber?: string | null;
  mrn?: string | null;
  address?: string | null;
  notes?: string | null;
  fileNo?: string | null;
  clinicFileClinicalNotes?: string | null;
}) {
  const response = await fetch("/api/patients/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.patientId) throw new Error(result?.error || "Could not create patient");

  return {
    patient: result.patient as PatientLike | null,
    warnings: Array.isArray(result.warnings) ? result.warnings.filter((warning: unknown): warning is string => typeof warning === "string") as string[] : [],
    patientId: String(result.patientId || ""),
    clinicPatientFileId: String(result.clinicPatientFileId || ""),
    fileNo: String(result.fileNo || ""),
  };
}
