import { createServerSupabaseClient, ensureManagerSession, readAppSession } from "../../../lib/api-session";
import {createProtectedDataClient} from '../../../lib/protected-data-server';

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const supabase = createServerSupabaseClient();
  const { session, errorResponse } = await readAppSession(supabase);
  if (errorResponse || !session) return errorResponse!;

  const managerError = ensureManagerSession(session);
  if (managerError) return managerError;
  if(session.userRole!=='owner'||!session.accountId)return Response.json({error:'Your individual owner login is required.'},{status:403});

  const body = await request.json().catch(() => null);
  const clinicId = String(body?.clinicId || "").trim();
  if (!clinicId) {
    return Response.json({ error: "clinicId is required." }, { status: 400 });
  }

  const payload = {
    enable_expenses: !!body?.enableExpenses,
    enable_commissions: !!body?.enableCommissions,
  };

  const { data, error } = await createProtectedDataClient().rpc('manage_clinic_catalog',{p_account_id:session.accountId,p_clinic_id:clinicId,p_kind:'clinics',p_action:'update',p_entity_id:clinicId,p_data:payload,p_reason:'Owner changed expense and commission controls'});

  if (error || !data) {
    return Response.json({ error: error?.message || "Failed updating clinic settings." }, { status: 500 });
  }

  return Response.json({
    clinicId: data.id,
    enableExpenses: !!data.enable_expenses,
    enableCommissions: !!data.enable_commissions,
  });
}
