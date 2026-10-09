import { createServerSupabaseClient, readAppSession, ensureManagerSession } from "../../../../lib/api-session";
import { createProtectedDataClient } from "../../../../lib/protected-data-server";
import { isUuid } from "../../../../lib/patient-mutation-validation";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const { session, errorResponse } = await readAppSession(createServerSupabaseClient());
  if (errorResponse || !session) return errorResponse!;
  const params = new URL(request.url).searchParams, clinicId = params.get("clinicId"), date = params.get("date") || "", view = params.get("view") || "list";
  if (!isUuid(clinicId) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !["count", "list"].includes(view) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10) !== date) {
    return Response.json({ error: "Valid clinic and date are required." }, { status: 400 });
  }
  if (session.sessionMode === "clinic" ? session.clinicId !== clinicId : !!ensureManagerSession(session)) return Response.json({ error: "Forbidden for this clinic." }, { status: 403 });
  try {
    const { data, error } = await createProtectedDataClient().rpc(view === "count" ? "get_clinic_birthday_remaining_count" : "get_clinic_birthday_patients", { p_clinic_id: clinicId, p_target_date: date });
    if (error) throw error;
    return Response.json(view === "count" ? { count: Number(data || 0) } : { patients: data || [] }, { headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ error: "Birthdays could not be loaded." }, { status: 503 }); }
}
