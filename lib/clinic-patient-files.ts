import { supabase } from "./supabase";

export type ClinicPatientFileRecord = {
  id: string;
  clinic_id: string;
  patient_id: string;
  file_no: string;
  mrn: string | null;
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

