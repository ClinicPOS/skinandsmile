import { createServerSupabaseClient, readAppSession, ensureManagerSession } from "../../../../lib/api-session";
import { createProtectedDataClient } from "../../../../lib/protected-data-server";
import { isUuid } from "../../../../lib/patient-mutation-validation";
import { normalizeMrn } from "../../../../lib/patient-registration";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { session, errorResponse } = await readAppSession(createServerSupabaseClient());
  if (errorResponse || !session) return errorResponse!;
  const params = new URL(request.url).searchParams;
  const clinicId = params.get("clinicId");
  const excludeId = params.get("excludePatientId");
  const mrn = normalizeMrn(params.get("mrn"));
  if (!isUuid(clinicId) || (excludeId && !isUuid(excludeId)) || !mrn || mrn.length > 100) {
    return Response.json({ error: "Valid clinic and MRN are required." }, { status: 400 });
  }
  if (session.sessionMode === "clinic" ? session.clinicId !== clinicId : !!ensureManagerSession(session)) {
    return Response.json({ error: "Forbidden for this clinic." }, { status: 403 });
  }
  try {
    const client = createProtectedDataClient();
    const matches: Array<{ patientId: string; name: string; fileNo: string | null; phone: string | null }> = [];
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await client.from("clinic_patient_files")
        .select("id, patient_id, file_no, mrn, patients(name, phone, mrn)")
        .eq("clinic_id", clinicId).order("id", { ascending: true }).range(offset, offset + 499);
      if (error) throw error;
      for (const row of data || []) {
        const linked = Array.isArray(row.patients) ? row.patients[0] : row.patients;
        if (row.patient_id !== excludeId && normalizeMrn(row.mrn || linked?.mrn) === mrn) {
          matches.push({ patientId: row.patient_id, name: linked?.name || "Unknown patient", fileNo: row.file_no, phone: linked?.phone ?? null });
        }
      }
      if ((data || []).length < 500) break;
    }
    return Response.json({ matches }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Could not verify MRN. Please try again." }, { status: 503 });
  }
}
