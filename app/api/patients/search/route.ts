import { createServerSupabaseClient, readAppSession, ensureManagerSession } from "../../../../lib/api-session";
import { createProtectedDataClient } from "../../../../lib/protected-data-server";
import { isUuid } from "../../../../lib/patient-mutation-validation";

export const dynamic = "force-dynamic";

type PatientSearchPatient = { id: string; name: string | null; phone: string | null; patient_number: string | null };
type PatientSearchRow = { id: string; file_no: string | null; patients: PatientSearchPatient | PatientSearchPatient[] | null };

export async function GET(request: Request) {
  const started = performance.now();
  const { session, errorResponse } = await readAppSession(createServerSupabaseClient());
  if (errorResponse || !session) return errorResponse!;
  const sessionReady = performance.now();
  const params = new URL(request.url).searchParams;
  const clinicId = params.get("clinicId") || (session.sessionMode === "clinic" ? session.clinicId : "");
  if (!isUuid(clinicId)) return Response.json({ error: "A valid clinic is required." }, { status: 400 });
  if (session.sessionMode === "clinic" ? session.clinicId !== clinicId : !!ensureManagerSession(session)) {
    return Response.json({ error: "Forbidden for this clinic." }, { status: 403 });
  }
  const search = (params.get("q") || "").trim();
  if (search.length > 120) return Response.json({ error: "Search is too long." }, { status: 400 });
  const offset = Number(params.get("offset") || "0");
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1000000) return Response.json({ error: "Invalid search page." }, { status: 400 });

  try {
    const client = createProtectedDataClient();
    const select = "id, file_no, mrn, patients!inner(id, patient_number, name, phone, email, emirates_id, passport_number)";
    const baseQuery = () => client.from("clinic_patient_files")
      .select(select).eq("clinic_id", clinicId)
      .order("file_no", { ascending: true }).order("id", { ascending: true });

    let rows: PatientSearchRow[];
    let hasMore: boolean;
    if (!search) {
      const { data, error } = await baseQuery().range(offset, offset + 200);
      if (error) throw error;
      const page = (data || []) as PatientSearchRow[];
      hasMore = page.length > 200;
      rows = page.slice(0, 200);
    } else {
      // Keep matching identity fields on the server; the response contains search labels only.
      const pattern = `%${search.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}%`;
      // shortcut: broad searches reread earlier matches to deduplicate both filter sets; use an indexed database search if deep pages become slow.
      const candidateEnd = offset + 200;
      const patientQuery = baseQuery().or(
        `name.ilike."${pattern}",phone.ilike."${pattern}",email.ilike."${pattern}",emirates_id.ilike."${pattern}",passport_number.ilike."${pattern}"${/^\d+$/.test(search) ? `,patient_number.eq.${search}` : ""}`,
        { referencedTable: "patients" },
      ).range(0, candidateEnd);
      const localQuery = baseQuery().or(`file_no.ilike."${pattern}",mrn.ilike."${pattern}"`).range(0, candidateEnd);
      const [patientResult, localResult] = await Promise.all([patientQuery, localQuery]);
      if (patientResult.error || localResult.error) throw patientResult.error || localResult.error;
      const unique = new Map<string, PatientSearchRow>();
      for (const row of [...(patientResult.data || []), ...(localResult.data || [])]) unique.set(String(row.id), row);
      const ordered = [...unique.values()].sort((a, b) => String(a.file_no || "").localeCompare(String(b.file_no || "")) || String(a.id).localeCompare(String(b.id)));
      hasMore = ordered.length > candidateEnd;
      rows = ordered.slice(offset, candidateEnd);
    }

    const patients = rows.flatMap(row => {
      const patient = Array.isArray(row.patients) ? row.patients[0] : row.patients;
      return patient ? [{
        id: patient.id,
        name: patient.name,
        phone: patient.phone,
        patient_number: patient.patient_number,
        clinic_file_no: row.file_no,
      }] : [];
    });
    return Response.json({ patients, hasMore }, { headers: { "Cache-Control": "no-store", "Server-Timing": `session;dur=${(sessionReady-started).toFixed(1)}, total;dur=${(performance.now()-started).toFixed(1)}` } });
  } catch {
    return Response.json({ error: "Patient search is unavailable. Please try again." }, { status: 503 });
  }
}
