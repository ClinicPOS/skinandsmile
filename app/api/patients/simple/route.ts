import { createProtectedDataClient } from "../../../../lib/protected-data-server";
import { createServerSupabaseClient, ensureManagerSession, readAppSession } from "../../../../lib/api-session";
import { operationResponse } from "../../../../lib/patient-mutation-server";
import { validatePatientUpdates } from "../../../../lib/patient-mutation-validation";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const operationId = crypto.randomUUID();
  let supabase = createServerSupabaseClient();
  const { session, errorResponse } = await readAppSession(supabase);
  if (errorResponse || !session) return errorResponse!;
  const managerError = ensureManagerSession(session);
  if (managerError) return managerError;
  const body = await request.json().catch(() => null);
  const validation = validatePatientUpdates(body?.patient);
  if (!validation.value) return operationResponse(operationId, { error: validation.error }, 400);

  supabase = createProtectedDataClient();

  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: patientNumber, error: numberError } = await supabase.rpc("next_patient_file_number");
    if (numberError || !patientNumber) {
      console.error("Patient number allocation failed", { operationId, code: numberError?.code });
      return operationResponse(operationId, { error: "Patient number could not be allocated." }, 500);
    }
    const { data: patient, error } = await supabase.from("patients").insert([{
      ...validation.value,
      patient_number: Number(patientNumber),
    }]).select("*").single();
    if (!error && patient) return operationResponse(operationId, { patient }, 201);
    if (error?.code !== "23505") {
      console.error("Simple patient creation failed", { operationId, code: error?.code });
      return operationResponse(operationId, { error: "Patient could not be saved." }, 500);
    }
  }
  return operationResponse(operationId, { error: "A unique patient number could not be allocated." }, 409);
}
