import { supabase } from "./supabase";

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
}) {
  const { data, error } = await supabase.rpc("create_patient_with_clinic_file", {
    p_name: payload.fullName.trim(),
    p_phone: payload.mobile.trim(),
    p_email: payload.email?.trim() || "",
    p_date_of_birth: payload.dateOfBirth || "",
    p_sex: payload.sex || "",
    p_nationality: payload.nationality?.trim() || "",
    p_emirates_id: payload.emiratesId?.trim() || "",
    p_passport_number: payload.passportNumber?.trim() || "",
    p_mrn_input: payload.mrn?.trim() || "",
    p_clinic_id: payload.clinicId,
    p_file_no: payload.fileNo?.trim() || "",
  });
  if (error || !data) {
    throw new Error(error?.message || "Could not create patient");
  }

  const result = data as {
    patient_id: string;
    clinic_patient_file_id: string;
    file_no: string;
  };

  const updatePayload: Record<string, string | null> = {
    address: payload.address?.trim() || null,
    notes: payload.notes?.trim() || null,
  };
  const { error: updateError } = await supabase
    .from("patients")
    .update(updatePayload)
    .eq("id", result.patient_id);
  if (updateError) {
    throw new Error(updateError.message || "Patient created but optional details failed to save");
  }

  return {
    patientId: String(result.patient_id || ""),
    clinicPatientFileId: String(result.clinic_patient_file_id || ""),
    fileNo: String(result.file_no || ""),
  };
}
