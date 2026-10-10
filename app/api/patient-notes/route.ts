import { createServerSupabaseClient, readAppSession } from "../../../lib/api-session";
import { canAccessPatientContext, operationResponse } from "../../../lib/patient-mutation-server";
import { isUuid, validateNoteText } from "../../../lib/patient-mutation-validation";
import { createProtectedDataClient } from "../../../lib/protected-data-server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const operationId = crypto.randomUUID();
  const supabase = createServerSupabaseClient();
  const { session, errorResponse } = await readAppSession(supabase);
  if (errorResponse || !session) return errorResponse!;
  const url = new URL(request.url);
  const patientId = url.searchParams.get("patientId");
  const clinicId = url.searchParams.get("clinicId") || (session.sessionMode === "clinic" ? session.clinicId : null);
  if (!isUuid(patientId) || (clinicId && !isUuid(clinicId))) return operationResponse(operationId, { error: "Valid patient and clinic references are required." }, 400);
  if (!(await canAccessPatientContext(supabase, session, patientId, clinicId))) return operationResponse(operationId, { error: "Forbidden for this clinic." }, 403);
  const protectedClient = createProtectedDataClient();
  const notes: unknown[] = [];
  for (let offset = 0; ; offset += 500) {
    let query = protectedClient.from("patient_notes").select("*").eq("patient_id", patientId)
      .order("created_at", { ascending: false }).order("id", { ascending: true }).range(offset, offset + 499);
    if (clinicId) query = query.eq("clinic_id", clinicId);
    const { data, error } = await query;
    if (error) return operationResponse(operationId, { error: "Clinical notes could not be loaded." }, 503);
    notes.push(...(data || []));
    if ((data || []).length < 500) break;
  }
  return operationResponse(operationId, { notes });
}

export async function POST(request: Request) {
  const operationId = crypto.randomUUID();
  const supabase = createServerSupabaseClient();
  const { session, errorResponse } = await readAppSession(supabase);
  if (errorResponse || !session) return errorResponse!;

  const body = await request.json().catch(() => null);
  if (!body || !isUuid(body.patientId)) {
    return operationResponse(operationId, { error: "A valid patient ID is required." }, 400);
  }
  const noteValidation = validateNoteText(body.note);
  if (!noteValidation.value) {
    return operationResponse(operationId, { error: noteValidation.error }, 400);
  }

  for (const [label, value] of [
    ["clinic", body.clinicId],
    ["receipt", body.receiptId],
    ["doctor", body.doctorId],
    ["receptionist", body.receptionistId],
  ] as const) {
    if (value != null && value !== "" && !isUuid(value)) {
      return operationResponse(operationId, { error: `A valid ${label} ID is required.` }, 400);
    }
  }

  let clinicId = body.clinicId ? String(body.clinicId) : session.sessionMode === "clinic" ? session.clinicId : null;
  const patientId = String(body.patientId);
  const receiptId = body.receiptId ? String(body.receiptId) : null;

  if (!(await canAccessPatientContext(supabase, session, patientId, clinicId))) {
    return operationResponse(operationId, { error: "Forbidden for this clinic." }, 403);
  }
  const protectedClient = createProtectedDataClient();

  if (receiptId) {
    const { data: receipt, error } = await protectedClient
      .from("receipts")
      .select("id, patient_id, clinic_id")
      .eq("id", receiptId)
      .maybeSingle();
    if (error || !receipt || String(receipt.patient_id || "") !== patientId) {
      return operationResponse(operationId, { error: "Receipt context is invalid." }, 400);
    }
    const receiptClinicId = receipt.clinic_id ? String(receipt.clinic_id) : null;
    if (clinicId && receiptClinicId && clinicId !== receiptClinicId) {
      return operationResponse(operationId, { error: "Receipt clinic context is invalid." }, 400);
    }
    clinicId = receiptClinicId || clinicId;
  }

  if (!(await canAccessPatientContext(supabase, session, patientId, clinicId))) {
    return operationResponse(operationId, { error: "Forbidden for this clinic." }, 403);
  }

  let receptionistId = session.receptionistId;
  if (!receptionistId && body.receptionistId) {
    const { data: receptionist } = await protectedClient
      .from("receptionist")
      .select("id, clinic_id")
      .eq("id", String(body.receptionistId))
      .maybeSingle();
    if (!receptionist || (clinicId && String(receptionist.clinic_id || "") !== clinicId)) {
      return operationResponse(operationId, { error: "Receptionist context is invalid." }, 400);
    }
    receptionistId = String(receptionist.id);
  }

  if (body.doctorId && clinicId) {
    const { data: doctor } = await protectedClient
      .from("doctors")
      .select("id, clinic_id")
      .eq("id", String(body.doctorId))
      .maybeSingle();
    if (!doctor || (doctor.clinic_id && String(doctor.clinic_id) !== clinicId)) {
      return operationResponse(operationId, { error: "Doctor context is invalid." }, 400);
    }
  }

  const { data: note, error } = await protectedClient
    .from("patient_notes")
    .insert([{
      patient_id: patientId,
      receipt_id: receiptId,
      note: noteValidation.value,
      doctor_id: body.doctorId || null,
      receptionist_id: receptionistId || null,
      clinic_id: clinicId,
    }])
    .select("*")
    .single();

  if (error || !note) {
    console.error("Patient note create failed", { operationId, code: error?.code });
    return operationResponse(operationId, { error: "Patient note could not be saved." }, 500);
  }
  return operationResponse(operationId, { note }, 201);
}
