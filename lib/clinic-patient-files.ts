
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

export async function ensurePatientClinicFile(payload: {
  clinicId: string;
  patientId: string;
  mrn?: string | null;
  fileNo?: string | null;
}): Promise<EnsureClinicPatientFileResult> {
  const response = await fetch(`/api/patients/${encodeURIComponent(payload.patientId)}/clinic-link`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clinicId: payload.clinicId,
      mrn: payload.mrn ?? null,
      fileNo: payload.fileNo ?? null,
    }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.clinicPatientFileId) throw new Error(result?.error || "Failed to ensure clinic patient file");

  return {
    patientId: String(result.patientId || ""),
    clinicPatientFileId: String(result.clinicPatientFileId || ""),
    fileNo: String(result.fileNo || ""),
    clinicFileCreated: Boolean(result.clinicFileCreated),
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
