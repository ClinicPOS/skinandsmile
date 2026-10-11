import "server-only";
import type {AppSession} from "./api-session";
import type {SupabaseClient} from "@supabase/supabase-js";
import { ensureManagerSession } from "./api-session";
import { isUuid } from "./patient-mutation-validation";
import { loadClinicFileNumbers } from "./clinic-file-numbers";
// Internal helper: caller must verify the session; clinic/role checks remain here.
export async function readReportPatientDetails(session:AppSession,request:Request,client:SupabaseClient){
const body = await request.json().catch(() => null);
if (!isUuid(body?.clinicId) || !Array.isArray(body?.patientIds) || body.patientIds.length > 5000 || !body.patientIds.every(isUuid)) {
    return Response.json({ error: "Valid clinic and patient IDs are required." }, { status: 400 });
  }
const clinicId = body.clinicId as string;
if ((session.sessionMode === "clinic" || session.userRole === "clinic_manager") ? session.clinicId !== clinicId : !!ensureManagerSession(session)) {
    return Response.json({ error: "Forbidden for this clinic." }, { status: 403 });
  }
const ids = [...new Set<string>(body.patientIds)];
try {
    const receptionistIds: string[] = [];
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await client.from("receptionist").select("id")
        .eq("clinic_id", clinicId).order("id", { ascending: true }).range(offset, offset + 499);
      if (error) throw error;
      for (const row of data || []) if (isUuid(row.id)) receptionistIds.push(row.id);
      if ((data || []).length < 500) break;
    }
    // Older receipts can identify the clinic only through their receptionist.
    // An explicit different clinic_id must never be overridden by that fallback.
    const receiptScope = receptionistIds.length
      ? `clinic_id.eq.${clinicId},and(clinic_id.is.null,receptionist_id.in.(${receptionistIds.join(",")}))`
      : `clinic_id.eq.${clinicId}`;
    const patients: Array<{ id: string; name: string; phone: string; nationality: string | null; date_of_birth: string | null }> = [];
    for (let start = 0; start < ids.length; start += 200) {
      const batch = ids.slice(start, start + 200);
      const permitted = new Set<string>();
      // Historical receipts authorize report details even if a clinic file is missing.
      for (let offset = 0; ; offset += 500) {
        const { data, error } = await client.from("receipts").select("id, patient_id")
          .or(receiptScope).in("patient_id", batch).order("id", { ascending: true }).range(offset, offset + 499);
        if (error) throw error;
        for (const row of data || []) permitted.add(row.patient_id);
        if ((data || []).length < 500) break;
      }
      if (batch.some(id => !permitted.has(id))) return Response.json({ error: "Patient is not part of this clinic's receipt history." }, { status: 403 });
      const { data, error } = await client.from("patients").select("id, name, phone, nationality, date_of_birth").in("id", batch);
      if (error) throw error;
      patients.push(...(data || []));
    }
    const files = await loadClinicFileNumbers(client, clinicId, ids);
    return Response.json({ patients, fileNumbers: Array.from(files) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Patient details for the report could not be loaded. Please try again." }, { status: 503 });
  }
}
