import { createServerSupabaseClient, readAppSession, ensureManagerSession } from "../../../../lib/api-session";
import { createProtectedDataClient } from "../../../../lib/protected-data-server";
import { isUuid } from "../../../../lib/patient-mutation-validation";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { session, errorResponse } = await readAppSession(createServerSupabaseClient());
  if (errorResponse || !session) return errorResponse!;
  const clinicId = new URL(request.url).searchParams.get("clinicId") || (session.sessionMode === "clinic" ? session.clinicId : "");
  if (!isUuid(clinicId)) return Response.json({ error: "A valid clinic is required." }, { status: 400 });
  if (session.sessionMode === "clinic" ? session.clinicId !== clinicId : !!ensureManagerSession(session)) {
    return Response.json({ error: "Forbidden for this clinic." }, { status: 403 });
  }
  try {
    const client = createProtectedDataClient();
    const files = [];
    const patients = new Map();
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await client.from("clinic_patient_files")
        .select("id, clinic_id, patient_id, file_no, mrn, patients(id, patient_number, name, phone, email, notes, date_of_birth, sex, nationality, emirates_id, passport_number, mrn, address)")
        .eq("clinic_id", clinicId).order("id", { ascending: true }).range(offset, offset + 499);
      if (error) throw error;
      for (const row of data || []) {
        const linked = Array.isArray(row.patients) ? row.patients[0] : row.patients;
        files.push({ id: row.id, clinic_id: row.clinic_id, patient_id: row.patient_id, file_no: row.file_no, mrn: row.mrn });
        if (linked?.id) patients.set(linked.id, linked);
      }
      if ((data || []).length < 500) break;
    }
    return Response.json({ patients: Array.from(patients.values()), files }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Clinic patient records could not be loaded. Please try again." }, { status: 503 });
  }
}
