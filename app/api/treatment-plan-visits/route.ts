import { createServerSupabaseClient, ensureManagerSession, readAppSession } from "../../../lib/api-session";
import { createProtectedDataClient } from "../../../lib/protected-data-server";
import { isUuid } from "../../../lib/patient-mutation-validation";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { session, errorResponse } = await readAppSession(createServerSupabaseClient());
  if (errorResponse || !session) return errorResponse!;
  if (session.sessionMode !== "clinic" && ensureManagerSession(session)) {
    return Response.json({ error: "Forbidden." }, { status: 403 });
  }
  const body = await request.json().catch(() => null);
  const treatmentPlanId = body?.treatmentPlanId;
  const requestId = body?.requestId;
  const doctorId = body?.doctorId ?? null;
  if(!isUuid(doctorId))return Response.json({error:'Select the doctor who actually performed this visit.'},{status:400});
  const notes = typeof body?.notes === "string" ? body.notes.trim() || null : null;
  if (!isUuid(treatmentPlanId) || !isUuid(requestId) || (doctorId !== null && !isUuid(doctorId)) ||
      (body?.notes != null && typeof body.notes !== "string") || (notes?.length || 0) > 4000) {
    return Response.json({ error: "Valid plan, request ID and visit details are required." }, { status: 400 });
  }
  try {
    const client = createProtectedDataClient();
    let query = client.from("treatment_plans").select("id, clinic_id").eq("id", treatmentPlanId);
    if (session.sessionMode === "clinic") query = query.eq("clinic_id", session.clinicId!);
    const { data: plan, error } = await query.maybeSingle();
    if (error) throw error;
    if (!plan) return Response.json({ error: "Treatment plan was not found in the permitted clinic." }, { status: 404 });
    const { data, error: saveError } = await client.rpc("record_treatment_plan_visit", {
      p_visit_id: requestId, p_plan_id: treatmentPlanId, p_clinic_id: plan.clinic_id,
      p_doctor_id: doctorId, p_receptionist_id: session.receptionistId, p_notes: notes,
    });
    if (saveError) {
      const status = saveError.code === "42501" ? 403 : ["23505", "23514"].includes(saveError.code) ? 409 : saveError.code === "22023" ? 400 : 503;
      const message = status === 403 ? "The patient, doctor or receptionist is not linked to this clinic." : status === 409 ? "The plan is closed, its visit limit was reached, or this request ID was already used. Refresh the plan before trying again." : "Visit could not be saved. Retry the same request.";
      return Response.json({ error: message }, { status });
    }
    return Response.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Visit saving is unavailable. Retry the same request." }, { status: 503 });
  }
}
