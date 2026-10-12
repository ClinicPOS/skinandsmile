import { createProtectedDataClient } from '../../../../lib/protected-data-server';
import { readAppSession, ensureClinicScopeAccess } from '../../../../lib/api-session';
import { isUuid } from '../../../../lib/patient-mutation-validation';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const db = createProtectedDataClient();
  const { session, errorResponse } = await readAppSession(db);
  if (!session) return errorResponse!;
  const params = new URL(request.url).searchParams;
  const clinicId = params.get('clinicId') || session.clinicId;
  const offset = Number(params.get('offset') || 0);
  if (!isUuid(clinicId) || !Number.isSafeInteger(offset) || offset < 0 || offset > 1000000) {
    return Response.json({ error: 'Select a clinic and a valid history page.' }, { status: 400 });
  }
  const denied = ensureClinicScopeAccess(session, clinicId);
  if (denied) return denied;
  if (session.userRole !== 'owner' && session.userRole !== 'receptionist' &&
      !(session.userRole === 'clinic_manager' && session.permissions?.includes('reports'))) {
    return Response.json({ error: 'History access is not assigned.' }, { status: 403 });
  }
  const start = performance.now();
  const { data, error } = await db.rpc('pos_receipt_history_page', { p_clinic_id: clinicId, p_offset: offset, p_limit: 50 });
  if (error) return Response.json({ error: 'Receipt history could not be loaded.' }, { status: 503 });
  return Response.json(data, { headers: { 'Cache-Control': 'no-store', 'Server-Timing': `history;dur=${(performance.now()-start).toFixed(1)}` } });
}
