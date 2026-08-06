import { createServerSupabaseClient, ensureManagerSession, readAppSession } from "../../../lib/api-session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const supabase = createServerSupabaseClient();
  const { session, errorResponse } = await readAppSession(supabase);
  if (errorResponse || !session) return errorResponse!;

  const managerError = ensureManagerSession(session);
  if (managerError) return managerError;

  const body = await request.json().catch(() => null);
  const clinicId = String(body?.clinicId || "").trim();
  if (!clinicId) {
    return Response.json({ error: "clinicId is required." }, { status: 400 });
  }

  const payload = {
    enable_expenses: !!body?.enableExpenses,
    enable_commissions: !!body?.enableCommissions,
  };

  const { data, error } = await supabase
    .from("clinics")
    .update(payload)
    .eq("id", clinicId)
    .select("id, enable_expenses, enable_commissions")
    .single();

  if (error || !data) {
    return Response.json({ error: error?.message || "Failed updating clinic settings." }, { status: 500 });
  }

  return Response.json({
    clinicId: data.id,
    enableExpenses: !!data.enable_expenses,
    enableCommissions: !!data.enable_commissions,
  });
}
