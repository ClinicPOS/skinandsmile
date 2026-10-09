import { createProtectedDataClient } from "../../../../lib/protected-data-server";
import { createServerSupabaseClient, readAppSession } from "../../../../lib/api-session";
import { canAccessPatientContext, operationResponse } from "../../../../lib/patient-mutation-server";
import { isUuid, validatePatientUpdates } from "../../../../lib/patient-mutation-validation";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: { params: Promise<{ patientId: string }> }) {
  const operationId = crypto.randomUUID();
  const { patientId } = await context.params;
  if (!isUuid(patientId)) {
    return operationResponse(operationId, { error: "A valid patient ID is required." }, 400);
  }

  let supabase = createServerSupabaseClient();
  const { session, errorResponse } = await readAppSession(supabase);
  if (errorResponse || !session) return errorResponse!;
  const body = await request.json().catch(() => null);
  if (body?.clinicId != null && !isUuid(body.clinicId)) {
    return operationResponse(operationId, { error: "A valid clinic ID is required." }, 400);
  }
  const validation = validatePatientUpdates(body?.updates);
  if (!validation.value) {
    return operationResponse(operationId, { error: validation.error }, 400);
  }

  const clinicId = body?.clinicId ? String(body.clinicId) : session.sessionMode === "clinic" ? session.clinicId : null;
  if (!(await canAccessPatientContext(supabase, session, patientId, clinicId))) {
    return operationResponse(operationId, { error: "Forbidden for this clinic." }, 403);
  }

  supabase = createProtectedDataClient();

  const { data: patient, error } = await supabase
    .from("patients")
    .update(validation.value)
    .eq("id", patientId)
    .select("*")
    .single();
  if (error || !patient) {
    console.error("Patient demographic update failed", { operationId, code: error?.code });
    const message = error?.code === "23505"
      ? "This patient record conflicts with an existing value."
      : "Patient details could not be saved.";
    return operationResponse(operationId, { error: message }, error?.code === "23505" ? 409 : 500);
  }
  return operationResponse(operationId, { patient });
}
