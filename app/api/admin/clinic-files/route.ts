import { createServerSupabaseClient, readAppSession, ensureManagerSession } from "../../../../lib/api-session";
import { createProtectedDataClient } from "../../../../lib/protected-data-server";
export const dynamic = "force-dynamic";
export async function GET() {
  const { session, errorResponse } = await readAppSession(createServerSupabaseClient());
  if (errorResponse || !session) return errorResponse!;
  const denied = ensureManagerSession(session);
  if (denied) return denied;
  try {
    const client = createProtectedDataClient(), files = [];
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await client.from("clinic_patient_files").select("id, clinic_id, patient_id, file_no, mrn").order("id").range(offset, offset + 499);
      if (error) throw error;
      files.push(...(data || []));
      if ((data || []).length < 500) break;
    }
    return Response.json({ files }, { headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ error: "Clinic files could not be loaded." }, { status: 503 }); }
}
