import { createServerSupabaseClient, ensureClinicScopeAccess, readAppSession } from "../../../lib/api-session";
import { canAddTreatmentPlanVisit, getTreatmentPlanCompletedVisitCount } from "../../../lib/treatment-plan-visits";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const supabase = createServerSupabaseClient();
  const { session, errorResponse } = await readAppSession(supabase);
  if (errorResponse || !session) return errorResponse!;

  const body = await request.json().catch(() => null);
  const treatmentPlanId = String(body?.treatmentPlanId || "").trim();
  const doctorId = String(body?.doctorId || "").trim() || null;
  const notes = String(body?.notes || "").trim() || null;
  if (!treatmentPlanId) {
    return Response.json({ error: "Treatment plan is required." }, { status: 400 });
  }
  const { data: plan, error: planError } = await supabase
    .from("treatment_plans")
    .select("id, clinic_id, planned_visits, clinic_patient_file_id, status")
    .eq("id", treatmentPlanId)
    .maybeSingle();
  if (planError || !plan) {
    return Response.json({ error: "Treatment plan was not found." }, { status: 404 });
  }

  const clinicScopeError = ensureClinicScopeAccess(session, String(plan.clinic_id));
  if (clinicScopeError) return clinicScopeError;

  const { count, error: countError } = await supabase
    .from("treatment_plan_visits")
    .select("id", { count: "exact", head: true })
    .eq("treatment_plan_id", treatmentPlanId);
  if (countError) {
    return Response.json({ error: "Treatment-plan visits could not be checked." }, { status: 500 });
  }

  const recordedVisits = getTreatmentPlanCompletedVisitCount(Number(count || 0), !!plan.clinic_patient_file_id);
  const totalVisits = plan.planned_visits == null ? null : Number(plan.planned_visits);
  if (!canAddTreatmentPlanVisit(totalVisits, recordedVisits)) {
    return Response.json({
      error: "This treatment plan has reached its planned visit limit. Create a new add-on plan for further treatment.",
      completedVisits: recordedVisits,
      totalVisits,
    }, { status: 409 });
  }

  const nextVisitNumber = recordedVisits + 1;
  const { data: visit, error: insertError } = await supabase
    .from("treatment_plan_visits")
    .insert([{
      treatment_plan_id: treatmentPlanId,
      visit_number: nextVisitNumber,
      doctor_id: doctorId,
      receptionist_id: session.receptionistId,
      notes,
    }])
    .select()
    .single();
  if (insertError || !visit) {
    return Response.json({ error: insertError?.message || "Treatment-plan visit could not be saved." }, { status: 500 });
  }

  let updatedPlan = null;
  const completedVisits = recordedVisits + 1;
  if (totalVisits != null && completedVisits >= totalVisits && plan.status !== "Completed") {
    const { data } = await supabase
      .from("treatment_plans")
      .update({ status: "Completed", completed_at: new Date().toISOString() })
      .eq("id", treatmentPlanId)
      .select("*")
      .single();
    if (data) updatedPlan = data;
  }

  return Response.json({ visit, plan: updatedPlan, completedVisits, totalVisits });
}
