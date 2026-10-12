import { createServerSupabaseClient, readAppSession, ensureManagerSession } from "../../../../lib/api-session";
import { createProtectedDataClient } from "../../../../lib/protected-data-server";
import { isUuid } from "../../../../lib/patient-mutation-validation";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const started=performance.now();
  const { session, errorResponse } = await readAppSession(createServerSupabaseClient());
  if (errorResponse || !session) return errorResponse!;
  const sessionReady=performance.now();
  const params = new URL(request.url).searchParams;
  const clinicId = params.get("clinicId") || (session.sessionMode === "clinic" ? session.clinicId : "");
  if (!isUuid(clinicId)) return Response.json({ error: "A valid clinic is required." }, { status: 400 });
  if (session.sessionMode === "clinic" ? session.clinicId !== clinicId : !!ensureManagerSession(session)) {
    return Response.json({ error: "Forbidden for this clinic." }, { status: 403 });
  }
  const search = (params.get("q") || "").trim();
  if (search.length > 120) return Response.json({ error: "Search is too long." }, { status: 400 });
  try {
    const client = createProtectedDataClient();
    let query = client.from("clinic_patient_files")
      .select("file_no, patients!inner(id, name, phone)").eq("clinic_id", clinicId)
      .order("file_no", { ascending: true }).order("id", { ascending: true }).limit(200);
    if (/^\d+$/.test(search)) query = query.eq("file_no", search);
    else if (search) {
      // Quote PostgREST values so punctuation cannot introduce another filter.
      const pattern = `%${search.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}%`;
      query = query.or(`name.ilike."${pattern}",phone.ilike."${pattern}"`, { referencedTable: "patients" });
    }
    const databaseStarted=performance.now();
    const { data, error } = await query;
    if (error) throw error;
    const patients = (data || []).flatMap(row => {
      const patient = Array.isArray(row.patients) ? row.patients[0] : row.patients;
      return patient ? [{ id: patient.id, name: patient.name, phone: patient.phone, clinic_file_no: row.file_no }] : [];
    });
    return Response.json({ patients }, { headers: { "Cache-Control": "no-store", "Server-Timing": `session;dur=${(sessionReady-started).toFixed(1)}, search;dur=${(performance.now()-databaseStarted).toFixed(1)}, total;dur=${(performance.now()-started).toFixed(1)}` } });
  } catch {
    return Response.json({ error: "Patient search is unavailable. Please try again." }, { status: 503 });
  }
}
