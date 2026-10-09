import type { SupabaseClient } from "@supabase/supabase-js";
import { ensureManagerSession, type AppSession } from "./api-session";
import { sessionCanAccessClinic } from "./patient-mutation-validation";
import { createProtectedDataClient } from "./protected-data-server";

export function operationResponse(operationId: string, body: Record<string, unknown>, status = 200) {
  return Response.json({ ...body, operationId }, {
    status,
    headers: { "X-Request-ID": operationId },
  });
}

export async function patientBelongsToClinic(
  supabase: SupabaseClient,
  patientId: string,
  clinicId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from("clinic_patient_files")
    .select("id")
    .eq("patient_id", patientId)
    .eq("clinic_id", clinicId)
    .limit(1);
  return !error && Array.isArray(data) && data.length > 0;
}

export async function canAccessClinicContext(
  supabase: SupabaseClient,
  session: AppSession,
  clinicId: string
): Promise<boolean> {
  if (!sessionCanAccessClinic(session, clinicId)) return false;
  if (session.sessionMode === "manager" && ensureManagerSession(session)) return false;
  const { data, error } = await createProtectedDataClient().from("clinics").select("id").eq("id", clinicId).maybeSingle();
  return !error && !!data;
}

export async function canAccessPatientContext(
  supabase: SupabaseClient,
  session: AppSession,
  patientId: string,
  clinicId: string | null
): Promise<boolean> {
  if (!sessionCanAccessClinic(session, clinicId)) return false;
  if (session.sessionMode === "manager" && ensureManagerSession(session)) return false;
  if (!clinicId) return session.sessionMode !== "clinic";
  return patientBelongsToClinic(createProtectedDataClient(), patientId, clinicId);
}
