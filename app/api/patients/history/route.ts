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
  const requestedParam = new URL(request.url).searchParams.get("patientIds");
  const patientFilter = requestedParam === null ? null : [...new Set(requestedParam.split(","))];
  if (patientFilter && (patientFilter.length > 200 || patientFilter.some(id => !isUuid(id)))) {
    return Response.json({ error: "Valid patient IDs are required (maximum 200)." }, { status: 400 });
  }
  try {
    const client = createProtectedDataClient();
    const ids = new Set<string>();
    const files = new Map<string, string>();
    const receptionistIds: string[] = [];
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await client.from("receptionist").select("id").eq("clinic_id", clinicId).order("id").range(offset, offset + 499);
      if (error) throw error;
      for (const row of data || []) if (isUuid(row.id)) receptionistIds.push(row.id);
      if ((data || []).length < 500) break;
    }
    const receiptScope = receptionistIds.length
      ? `clinic_id.eq.${clinicId},and(clinic_id.is.null,receptionist_id.in.(${receptionistIds.join(",")}))`
      : `clinic_id.eq.${clinicId}`;
    for (const table of ["clinic_patient_files", "receipts", "treatment_plans", "treatment_plan_payment_records", "outstanding_balances", "patient_credits"]) {
      for (let offset = 0; ; offset += 500) {
        let query = client.from(table).select(table === "clinic_patient_files" ? "id, patient_id, file_no" : "id, patient_id").order("id").range(offset, offset + 499);
        query = table === "receipts" ? query.or(receiptScope) : query.eq("clinic_id", clinicId);
        if (patientFilter) query = query.in("patient_id", patientFilter);
        const { data, error } = await query;
        if (error) throw error;
        for (const row of (data || []) as unknown as Array<{ patient_id: string; file_no?: string }>) {
          if (isUuid(row.patient_id)) ids.add(row.patient_id);
          if (table === "clinic_patient_files" && row.file_no) files.set(row.patient_id, row.file_no);
        }
        if ((data || []).length < 500) break;
      }
    }
    const patients = [];
    const requested = Array.from(ids);
    for (let offset = 0; offset < requested.length; offset += 200) {
      const { data, error } = await client.from("patients").select("id, name, phone, patient_number").in("id", requested.slice(offset, offset + 200));
      if (error) throw error;
      for (const row of data || []) patients.push({ ...row, clinic_file_no: files.get(row.id) ?? null });
    }
    patients.sort((a,b) => a.name.localeCompare(b.name));
    return Response.json({ patients }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Patient history details could not be loaded." }, { status: 503 });
  }
}
