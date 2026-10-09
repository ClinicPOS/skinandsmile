import { createProtectedDataClient } from "../../../../lib/protected-data-server";
import { createServerSupabaseClient, readAppSession } from "../../../../lib/api-session";
import { canAccessClinicContext, operationResponse } from "../../../../lib/patient-mutation-server";
import { validatePatientRegistration } from "../../../../lib/patient-mutation-validation";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const operationId = crypto.randomUUID();
  let supabase = createServerSupabaseClient();
  const { session, errorResponse } = await readAppSession(supabase);
  if (errorResponse || !session) return errorResponse!;
  const validation = validatePatientRegistration(await request.json().catch(() => null));
  if (!validation.value) return operationResponse(operationId, { error: validation.error }, 400);
  const input = validation.value;

  if (!(await canAccessClinicContext(supabase, session, input.clinicId))) {
    return operationResponse(operationId, { error: "Forbidden for this clinic." }, 403);
  }

  supabase = createProtectedDataClient();

  const { data, error } = await supabase.rpc("create_patient_with_clinic_file", {
    p_name: input.fullName,
    p_phone: input.mobile,
    p_email: input.email || "",
    p_date_of_birth: input.dateOfBirth || "",
    p_sex: input.sex || "",
    p_nationality: input.nationality || "",
    p_emirates_id: input.emiratesId || "",
    p_passport_number: input.passportNumber || "",
    p_mrn_input: input.mrn || "",
    p_clinic_id: input.clinicId,
    p_file_no: input.fileNo || "",
  });
  if (error || !data) {
    console.error("Patient registration failed", { operationId, code: error?.code });
    const duplicate = error?.code === "23505" || /already taken|duplicate/i.test(error?.message || "");
    return operationResponse(operationId, {
      error: duplicate ? "This patient or clinic file number already exists." : "Patient could not be registered.",
    }, duplicate ? 409 : 500);
  }

  const result = data as { patient_id: string; clinic_patient_file_id: string; file_no: string };
  const warnings: string[] = [];
  if (input.address || input.notes) {
    try {
      const { error } = await supabase.from("patients").update({
        address: input.address, notes: input.notes,
      }).eq("id", result.patient_id);
      if (error) throw new Error("Optional details update failed.");
    } catch {
      warnings.push("Address or notes could not be saved. Open the existing patient profile to finish them.");
    }
  }
  if (input.clinicFileClinicalNotes) {
    try {
      const { error } = await supabase.from("clinic_patient_files")
        .update({ clinical_notes: input.clinicFileClinicalNotes })
        .eq("id", result.clinic_patient_file_id).eq("clinic_id", input.clinicId);
      if (error) throw new Error("Clinic notes update failed.");
    } catch {
      warnings.push("Clinic notes could not be saved. Open the existing patient profile to finish them.");
    }
  }
  let patient = null;
  try {
    const reloaded = await supabase.from("patients").select("*").eq("id", result.patient_id).single();
    if (reloaded.error || !reloaded.data) throw new Error("Patient reload failed.");
    patient = reloaded.data;
  } catch {
    warnings.push("Patient details could not be reloaded. Refresh the patient profile before editing.");
  }
  return operationResponse(operationId, {
    patient,
    warnings,
    patientId: String(result.patient_id),
    clinicPatientFileId: String(result.clinic_patient_file_id),
    fileNo: String(result.file_no),
  }, 201);
}
