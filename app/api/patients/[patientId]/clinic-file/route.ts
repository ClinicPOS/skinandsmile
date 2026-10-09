import { createProtectedDataClient } from "../../../../../lib/protected-data-server";
import { createServerSupabaseClient, ensureManagerSession, readAppSession } from "../../../../../lib/api-session";
import { operationResponse } from "../../../../../lib/patient-mutation-server";
import { isUuid } from "../../../../../lib/patient-mutation-validation";
import { fileNumberConflictMessage } from "../../../../../lib/clinic-file-numbers";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: { params: Promise<{ patientId: string }> }) {
  const operationId = crypto.randomUUID();
  const { patientId } = await context.params;
  if (!isUuid(patientId)) return operationResponse(operationId, { error: "A valid patient ID is required." }, 400);
  let supabase = createServerSupabaseClient();
  const { session, errorResponse } = await readAppSession(supabase);
  if (!session || errorResponse) return errorResponse!;
  const body = await request.json().catch(() => null);
  if (!body || !isUuid(body.clinicId) || typeof body.fileNo !== "string") {
    return operationResponse(operationId, { error: "A clinic and File No. are required." }, 400);
  }
  if (Object.keys(body).some(key => !["clinicId", "fileNo", "mrn"].includes(key))) {
    return operationResponse(operationId, { error: "Unexpected clinic file field." }, 400);
  }
  const fileNo = body.fileNo.trim();
  if (!fileNo || fileNo.length > 100 || (body.mrn != null && (typeof body.mrn !== "string" || body.mrn.trim().length > 100))) {
    return operationResponse(operationId, { error: "File No. cannot be empty or longer than 100 characters; MRN must be valid text." }, 400);
  }
  const clinicId = String(body.clinicId);
  if (session.sessionMode === "clinic") {
    if (session.clinicId !== clinicId) return operationResponse(operationId, { error: "Forbidden for this clinic." }, 403);
  } else if (ensureManagerSession(session)) {
    return operationResponse(operationId, { error: "Forbidden for this clinic." }, 403);
  }

  supabase = createProtectedDataClient();

  const { data: current, error: currentError } = await supabase.from("clinic_patient_files")
    .select("id, file_no, mrn").eq("clinic_id", clinicId).eq("patient_id", patientId).maybeSingle();
  if (currentError) return operationResponse(operationId, { error: "Clinic file could not be checked." }, 500);
  if (!current) return operationResponse(operationId, { error: "Patient has no file in this clinic." }, 404);

  const findConflict = () => supabase.from("clinic_patient_files")
    .select("id, patients(name)").eq("clinic_id", clinicId).eq("file_no", fileNo).neq("id", current.id).limit(1);
  const conflictResponse = (row?: { patients?: unknown }) => {
    const linked = Array.isArray(row?.patients) ? row.patients[0] : row?.patients;
    const name = linked && typeof linked === "object" && "name" in linked ? String(linked.name || "") : null;
    return operationResponse(operationId, { error: fileNumberConflictMessage(name) }, 409);
  };
  const { data: conflicts, error: conflictError } = await findConflict();
  if (conflictError) return operationResponse(operationId, { error: "File No. could not be checked. Nothing was saved." }, 500);
  if (conflicts?.length) return conflictResponse(conflicts[0]);

  const updates: { file_no: string; mrn?: string | null } = { file_no: fileNo };
  if (Object.hasOwn(body, "mrn")) updates.mrn = body.mrn?.trim() || null;
  const { data: clinicFile, error } = await supabase.from("clinic_patient_files")
    .update(updates).eq("id", current.id).eq("clinic_id", clinicId).eq("patient_id", patientId)
    .select("id, file_no, mrn").single();
  if (error?.code === "23505") {
    // The existing UNIQUE(clinic_id, file_no) constraint protects simultaneous edits.
    const { data: racedConflict } = await findConflict();
    return conflictResponse(racedConflict?.[0]);
  }
  if (error || !clinicFile) {
    console.error("Clinic file edit failed", { operationId, code: error?.code });
    return operationResponse(operationId, { error: "Clinic file could not be saved." }, 500);
  }
  return operationResponse(operationId, { clinicFile });
}
