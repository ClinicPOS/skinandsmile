import type { Patient } from "./types";
import type { ClinicPatientFileRecord } from "./clinic-patient-files";

export async function loadClinicPatientRecords(clinicId: string): Promise<{ patients: Patient[]; files: ClinicPatientFileRecord[] }> {
  const response = await fetch(`/api/patients/clinic-records?${new URLSearchParams({ clinicId })}`, { cache: "no-store" });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Clinic patient records could not be loaded.");
  return body;
}

export async function loadManagedPatients(ids?: string[]): Promise<Patient[]> {
  const patients: Patient[] = [];
  const batches = ids ? Array.from({ length: Math.ceil(ids.length / 200) }, (_, i) => ids.slice(i * 200, i * 200 + 200)) : [null];
  for (const batch of batches) {
    const query = batch ? `?${new URLSearchParams({ ids: batch.join(",") })}` : "";
    const response = await fetch(`/api/admin/patients${query}`, { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Patient records could not be loaded.");
    patients.push(...body.patients);
  }
  return patients;
}

export async function loadClinicHistoryPatients(clinicId?: string | null): Promise<(Patient & { clinic_file_no?: string | null })[]> {
  if (!clinicId) return loadManagedPatients();
  const response = await fetch(`/api/patients/history?${new URLSearchParams({ clinicId })}`, { cache: "no-store" });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Patient history details could not be loaded.");
  return body.patients;
}

export async function loadClinicFileIndex(clinicId?: string | null): Promise<ClinicPatientFileRecord[]> {
  if (clinicId) return (await loadClinicPatientRecords(clinicId)).files;
  const response = await fetch("/api/admin/clinic-files", { cache: "no-store" });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Clinic files could not be loaded.");
  return body.files;
}

export async function loadClinicBirthdays(clinicId: string, date: string, view: "list" | "count" = "list") {
  const response = await fetch(`/api/patients/birthdays?${new URLSearchParams({ clinicId, date, view })}`, { cache: "no-store" });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Birthdays could not be loaded.");
  return body;
}
