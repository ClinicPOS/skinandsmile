import { createServerSupabaseClient, readAppSession, ensureManagerSession } from "../../../../lib/api-session";
import { createProtectedDataClient } from "../../../../lib/protected-data-server";
import { isUuid } from "../../../../lib/patient-mutation-validation";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const { session, errorResponse } = await readAppSession(createServerSupabaseClient());
  if (errorResponse || !session) return errorResponse!;
  const denied = ensureManagerSession(session);
  if (denied) return denied;
  const rawIds = new URL(request.url).searchParams.get("ids");
  const ids = rawIds === null ? null : rawIds.split(",");
  if (ids && (!ids.length || ids.length > 200 || !ids.every(isUuid))) return Response.json({ error: "Invalid patient IDs." }, { status: 400 });
  try {
    const client = createProtectedDataClient();
    const patients = [];
    for (let offset = 0; ; offset += 500) {
      let query = client.from("patients").select("id, patient_number, name, phone, email, notes, date_of_birth, sex, nationality, emirates_id, passport_number, mrn, address, created_at")
        .order("created_at", { ascending: false }).order("id", { ascending: true }).range(offset, offset + 499);
      if (ids) query = query.in("id", ids);
      const { data, error } = await query;
      if (error) throw error;
      patients.push(...(data || []));
      if ((data || []).length < 500) break;
    }
    return Response.json({ patients }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Patient records could not be loaded." }, { status: 503 });
  }
}
