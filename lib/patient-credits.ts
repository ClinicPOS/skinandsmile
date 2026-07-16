import type { PatientCredit } from "./types";

// Sum of the patient's credit ledger (deposits positive, applications
// negative). Clamped at 0 so a bad row can never show negative credit.
export function availableCredit(credits: PatientCredit[]): number {
  const sum = credits.reduce((s, c) => s + Number(c.amount || 0), 0);
  return Math.max(0, Math.round(sum * 100) / 100);
}

export function creditsForPatient(
  credits: PatientCredit[],
  patientId: string,
  clinicId?: string | null
): PatientCredit[] {
  return credits.filter(
    (c) => c.patient_id === patientId && (!clinicId || c.clinic_id === clinicId)
  );
}
