import type { SupabaseClient } from "@supabase/supabase-js";

export function fileNumberConflictMessage(patientName?: string | null): string {
  return `File No. Already taken = ${patientName?.trim() || "another patient"}`;
}

// Never substitute a global patient number or another clinic's file number.
export function reportClinicFileNumber(files: Map<string, string>, patientId: unknown): string {
  return files.get(String(patientId || "")) || "Missing clinic file";
}

export async function loadClinicFileNumbers(supabase: SupabaseClient, clinicId: string, patientIds?: string[]): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  const pageSize = 500;
  const ids = patientIds === undefined ? null : [...new Set(patientIds)];
  const batches = ids === null ? [null] : Array.from({ length: Math.ceil(ids.length / 200) }, (_, index) => ids.slice(index * 200, index * 200 + 200));
  for (const batch of batches) {
    for (let offset = 0; ; offset += pageSize) {
      let query = supabase.from("clinic_patient_files").select("id, patient_id, file_no")
        .eq("clinic_id", clinicId).order("id", { ascending: true }).range(offset, offset + pageSize - 1);
      if (batch) query = query.in("patient_id", batch);
      const { data, error } = await query;
      if (error) throw new Error("Clinic file numbers could not be loaded. Please try again.");
      for (const row of data || []) {
        const fileNo = String(row.file_no ?? "").trim();
        if (fileNo) files.set(String(row.patient_id), fileNo);
      }
      if ((data || []).length < pageSize) break;
    }
  }
  return files;
}
