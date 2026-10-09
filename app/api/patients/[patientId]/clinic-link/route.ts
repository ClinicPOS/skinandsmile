import { createProtectedDataClient } from "../../../../../lib/protected-data-server";
import { createServerSupabaseClient, readAppSession } from "../../../../../lib/api-session";
import { canAccessClinicContext, canAccessPatientContext, operationResponse } from "../../../../../lib/patient-mutation-server";
import { isUuid } from "../../../../../lib/patient-mutation-validation";

export const dynamic = "force-dynamic";

function optionalText(value: unknown, maxLength: number) {
  if (value == null || value === "") return { value: null as string | null };
  if (typeof value !== "string") return { error: "Value must be text." };
  const normalized = value.trim();
  if (normalized.length > maxLength) return { error: "Value is too long." };
  return { value: normalized || null };
}

export async function POST(request: Request, context: { params: Promise<{ patientId: string }> }) {
  const operationId = crypto.randomUUID();
  const { patientId } = await context.params;
  if (!isUuid(patientId)) return operationResponse(operationId, { error: "A valid patient ID is required." }, 400);
  let supabase = createServerSupabaseClient();
  const { session, errorResponse } = await readAppSession(supabase);
  if (errorResponse || !session) return errorResponse!;
  const body = await request.json().catch(() => null);
  if (!body || !isUuid(body.clinicId)) {
    return operationResponse(operationId, { error: "A valid clinic ID is required." }, 400);
  }
  const unexpected = Object.keys(body).find((key) => !["clinicId", "mrn", "fileNo"].includes(key));
  if (unexpected) return operationResponse(operationId, { error: `Field '${unexpected}' is not allowed.` }, 400);
  const mrn = optionalText(body.mrn, 100);
  const fileNo = optionalText(body.fileNo, 100);
  if (mrn.error || fileNo.error) return operationResponse(operationId, { error: mrn.error || fileNo.error }, 400);
  const clinicId = String(body.clinicId);
  if (!(await canAccessClinicContext(supabase, session, clinicId))) {
    return operationResponse(operationId, { error: "Forbidden for this clinic." }, 403);
  }

  if (session.sessionMode === "clinic" && !(await canAccessPatientContext(supabase, session, patientId, clinicId))) {
    return operationResponse(operationId, { error: "A manager must link a patient from another clinic." }, 403);
  }

  supabase = createProtectedDataClient();

  const { data, error } = await supabase.rpc("ensure_patient_clinic_file", {
    p_patient_id: patientId,
    p_clinic_id: clinicId,
    p_mrn_input: mrn.value,
    p_file_no: fileNo.value,
  });
  if (error || !data) {
    console.error("Patient clinic link failed", { operationId, code: error?.code });
    const duplicate = error?.code === "23505" || /already taken|duplicate/i.test(error?.message || "");
    return operationResponse(operationId, {
      error: duplicate ? "This clinic file number already exists." : "Patient could not be linked to the clinic.",
    }, duplicate ? 409 : 500);
  }
  const result = data as {
    patient_id: string;
    clinic_patient_file_id: string;
    file_no: string;
    clinic_file_created: boolean;
  };
  return operationResponse(operationId, {
    patientId: String(result.patient_id),
    clinicPatientFileId: String(result.clinic_patient_file_id),
    fileNo: String(result.file_no),
    clinicFileCreated: Boolean(result.clinic_file_created),
  });
}
