import { supabase } from "./supabase";

export type ClinicPatientFileRecord = {
  id: string;
  clinic_id: string;
  patient_id: string;
  file_no: string;
  mrn: string | null;
};

export type EnsureClinicPatientFileResult = {
  patientId: string;
  clinicPatientFileId: string;
  fileNo: string;
  clinicFileCreated: boolean;
};

export async function nextClinicFileNumber(clinicId: string): Promise<string> {
  const { data, error } = await supabase.rpc("next_clinic_file_number", {
    p_clinic_id: clinicId,
  });
  if (error) {
    throw new Error(error.message || "Failed to get next clinic file number");
  }
  return String(data || "").trim();
}

export async function getClinicPatientFile(
  clinicId: string,
  patientId: string
): Promise<ClinicPatientFileRecord | null> {
  const { data, error } = await supabase
    .from("clinic_patient_files")
    .select("id, clinic_id, patient_id, file_no, mrn")
    .eq("clinic_id", clinicId)
    .eq("patient_id", patientId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || "Failed to load clinic patient file");
  }

  return (data as ClinicPatientFileRecord | null) || null;
}

export async function createClinicPatientFile(payload: {
  clinicId: string;
  patientId: string;
  fileNo: string;
  mrn?: string | null;
  clinicalNotes?: string | null;
}): Promise<ClinicPatientFileRecord> {
  const { data, error } = await supabase
    .from("clinic_patient_files")
    .insert([
      {
        clinic_id: payload.clinicId,
        patient_id: payload.patientId,
        file_no: payload.fileNo,
        mrn: payload.mrn ?? null,
        clinical_notes: payload.clinicalNotes ?? null,
      },
    ])
    .select("id, clinic_id, patient_id, file_no, mrn")
    .single();

  if (error || !data) {
    throw new Error(error?.message || "Failed to create clinic patient file");
  }

  return data as ClinicPatientFileRecord;
}

export async function ensurePatientClinicFile(payload: {
  clinicId: string;
  patientId: string;
  mrn?: string | null;
  fileNo?: string | null;
}): Promise<EnsureClinicPatientFileResult> {
  const { data, error } = await supabase.rpc("ensure_patient_clinic_file", {
    p_patient_id: payload.patientId,
    p_clinic_id: payload.clinicId,
    p_mrn_input: payload.mrn ?? null,
    p_file_no: payload.fileNo ?? null,
  });
  if (error || !data) {
    throw new Error(error?.message || "Failed to ensure clinic patient file");
  }

  const result = data as {
    patient_id: string;
    clinic_patient_file_id: string;
    file_no: string;
    clinic_file_created: boolean;
  };

  return {
    patientId: String(result.patient_id || ""),
    clinicPatientFileId: String(result.clinic_patient_file_id || ""),
    fileNo: String(result.file_no || ""),
    clinicFileCreated: Boolean(result.clinic_file_created),
  };
}

export function getActiveClinicIdFromRegisterSession(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem("posRegisterSession");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const clinicId = String(parsed?.clinicId || "").trim();
    return clinicId || null;
  } catch {
    return null;
  }
}

export function getActiveReceptionistIdFromRegisterSession(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem("posRegisterSession");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const receptionistId = String(parsed?.receptionistId || "").trim();
    return receptionistId || null;
  } catch {
    return null;
  }
}
