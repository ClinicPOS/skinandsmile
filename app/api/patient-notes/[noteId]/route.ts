import { createServerSupabaseClient, readAppSession } from "../../../../lib/api-session";
import { canAccessPatientContext, operationResponse } from "../../../../lib/patient-mutation-server";
import { isUuid, validateNoteText } from "../../../../lib/patient-mutation-validation";
import { createProtectedDataClient } from "../../../../lib/protected-data-server";

export const dynamic = "force-dynamic";

async function loadAuthorizedNote(noteId: string) {
  const operationId = crypto.randomUUID();
  if (!isUuid(noteId)) {
    return { operationId, response: operationResponse(operationId, { error: "A valid note ID is required." }, 400) };
  }
  const supabase = createServerSupabaseClient();
  const { session, errorResponse } = await readAppSession(supabase);
  if (errorResponse || !session) return { operationId, response: errorResponse! };
  const protectedClient = createProtectedDataClient();
  const { data: note, error } = await protectedClient
    .from("patient_notes")
    .select("id, patient_id, clinic_id")
    .eq("id", noteId)
    .maybeSingle();
  if (error || !note) {
    return { operationId, response: operationResponse(operationId, { error: "Patient note was not found." }, 404) };
  }
  const clinicId = note.clinic_id ? String(note.clinic_id) : session.sessionMode === "clinic" ? session.clinicId : null;
  if (!note.clinic_id && session.sessionMode === "clinic") return { operationId, response: operationResponse(operationId, { error: "A manager must review this unassigned clinical note." }, 403) };
  if (!(await canAccessPatientContext(supabase, session, String(note.patient_id), clinicId))) {
    return { operationId, response: operationResponse(operationId, { error: "Forbidden for this clinic." }, 403) };
  }
  return { operationId, supabase: protectedClient, note };
}

export async function PATCH(request: Request, context: { params: Promise<{ noteId: string }> }) {
  const { noteId } = await context.params;
  const authorized = await loadAuthorizedNote(noteId);
  if (authorized.response) return authorized.response;
  const body = await request.json().catch(() => null);
  const validation = validateNoteText(body?.note);
  if (!validation.value) {
    return operationResponse(authorized.operationId, { error: validation.error }, 400);
  }
  const { data: note, error } = await authorized.supabase!
    .from("patient_notes")
    .update({ note: validation.value })
    .eq("id", noteId)
    .select("*")
    .single();
  if (error || !note) {
    console.error("Patient note update failed", { operationId: authorized.operationId, code: error?.code });
    return operationResponse(authorized.operationId, { error: "Patient note could not be updated." }, 500);
  }
  return operationResponse(authorized.operationId, { note });
}

export async function DELETE(_request: Request, context: { params: Promise<{ noteId: string }> }) {
  const { noteId } = await context.params;
  const authorized = await loadAuthorizedNote(noteId);
  if (authorized.response) return authorized.response;
  const { error } = await authorized.supabase!.from("patient_notes").delete().eq("id", noteId);
  if (error) {
    console.error("Patient note delete failed", { operationId: authorized.operationId, code: error.code });
    return operationResponse(authorized.operationId, { error: "Patient note could not be deleted." }, 500);
  }
  return operationResponse(authorized.operationId, { deleted: true });
}
