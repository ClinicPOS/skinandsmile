import { supabase } from "./supabase";

// System-generated File Numbers start here; old-system files (up to ~18,000)
// keep their original numbers.
export const AUTO_FILE_NUMBER_START = 20000;

// Next auto-assigned File No. for a new patient. Prefers the DB-side sequence
// (supabase-file-number-generation-migration.sql), which is safe when several
// receptionists create patients at once. Falls back to max+1 clamped to the
// 20,000 range on databases that haven't run the migration — there the unique
// index plus the callers' retry-on-23505 loops still prevent duplicates.
export async function nextAutoFileNumber(): Promise<number> {
  const { data, error } = await supabase.rpc("next_patient_file_number");
  if (!error && Number.isFinite(Number(data))) {
    return Number(data);
  }

  const { data: maxPatient } = await supabase
    .from("patients")
    .select("patient_number")
    .not("patient_number", "is", null)
    .order("patient_number", { ascending: false })
    .limit(1);
  const maxExisting = Number(maxPatient?.[0]?.patient_number) || 0;
  return Math.max(maxExisting + 1, AUTO_FILE_NUMBER_START);
}
