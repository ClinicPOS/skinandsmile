import { createServerSupabaseClient, ensureManagerSession, readAppSession } from '../../../../lib/api-session';
import { createProtectedDataClient } from '../../../../lib/protected-data-server';
import { validateCheckoutBody } from '../../../../lib/checkout-validation';
import { isUuid } from '../../../../lib/patient-mutation-validation';
import { auditActor } from '../../../../lib/admin-security';
export const dynamic='force-dynamic';
export async function GET(request:Request) {
  const {session,errorResponse}=await readAppSession(createServerSupabaseClient());
  if(errorResponse||!session) return errorResponse!;
  if(session.sessionMode!=='clinic' && ensureManagerSession(session)) return Response.json({error:'Forbidden.'},{status:403});
  const requestId=new URL(request.url).searchParams.get('requestId');
  if(!isUuid(requestId)) return Response.json({error:'Invalid request ID.'},{status:400});
  try {
    let query=createProtectedDataClient().from('pos_checkout_requests').select('clinic_id,result').eq('id',requestId);
    if(session.sessionMode==='clinic') query=query.eq('clinic_id',session.clinicId!);
    const {data,error}=await query.maybeSingle();
    if(error) throw error;
    if(!data || (session.sessionMode==='clinic' && session.receptionistId && data.result?.receipt?.receptionist_id!==session.receptionistId)) return Response.json({error:'Checkout not found.'},{status:404});
    return Response.json(data.result,{headers:{'Cache-Control':'no-store'}});
  } catch { return Response.json({error:'Checkout lookup is unavailable.'},{status:503}); }
}
export async function POST(request:Request) {
  const {session,errorResponse}=await readAppSession(createServerSupabaseClient());
  if(errorResponse||!session) return errorResponse!;
  if(session.sessionMode!=='clinic'||session.userRole!=='receptionist'||!session.receptionistId)return Response.json({error:'Sign in as a receptionist and open the register first.'},{status:403});
  if(session.sessionMode!=='clinic' && ensureManagerSession(session)) return Response.json({error:'Forbidden.'},{status:403});
  let checkout: ReturnType<typeof validateCheckoutBody>;
  try { checkout=validateCheckoutBody(await request.json()); } catch(error) {
    return Response.json({error:error instanceof Error?error.message:'Invalid checkout.'},{status:400});
  }
  const receipt=checkout.payload.receipt;
  if(!isUuid(checkout.payload.registerSessionId))return Response.json({error:'A saved open register is required.'},{status:400});
  if(session.sessionMode==='clinic' && (receipt.clinic_id!==session.clinicId || (session.receptionistId && receipt.receptionist_id!==session.receptionistId))) {
    return Response.json({error:'Forbidden for this clinic or receptionist.'},{status:403});
  }
  try {
    const {data,error}=await createProtectedDataClient().rpc('complete_pos_checkout',{p_request_id:checkout.requestId,p_payload:{...checkout.payload,audit_actor:await auditActor(session)}});
    if(error) {
      console.error('Checkout database verification failed',{code:error.code,message:error.message});
      const status=error.code==='42501'?403:['23505','23514'].includes(error.code)?409:['22023','22P02'].includes(error.code)?400:503;
      return Response.json({error:status===403?'A patient, staff member, service or register does not belong to this clinic.':status===409?'Checkout details changed, credit is unavailable, or a reference/request ID was already used. Review the transaction before retrying.':status===400?'Checkout amounts do not reconcile. Review the cart and payment.':'Checkout could not be confirmed. Retry with the same details and request ID.'},{status});
    }
    if(data?.receipt?.status==='VOIDED')return Response.json({error:'This receipt was voided. No new payment was recorded. Review receipt history before starting a new transaction.'},{status:409});
    return Response.json(data,{headers:{'Cache-Control':'no-store'}});
  } catch { return Response.json({error:'Checkout is unavailable. Retry with the same details and request ID.'},{status:503}); }
}
