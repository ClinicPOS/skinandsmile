import {createProtectedDataClient} from '../../../lib/protected-data-server';
import {readAppSession} from '../../../lib/api-session';
import {isUuid} from '../../../lib/patient-mutation-validation';
import {computeRegisterSessionCashCollected,listCashDeductions,loadRegisterSessionContext,buildCashDeductionSummary} from '../cash-deductions/_shared';
export const dynamic='force-dynamic';
export async function POST(request:Request){
 const db=createProtectedDataClient();const {session,errorResponse}=await readAppSession(db);
 if(!session)return errorResponse!;
 if(session.userRole!=='receptionist'||!session.receptionistId||!session.clinicId)return Response.json({error:'Sign in as a receptionist first.'},{status:403});
 const body=await request.json().catch(()=>null);
 if(!body||!['open','close'].includes(body.action)||typeof body.amount!=='number'||!Number.isFinite(body.amount)||body.amount<0||body.amount>10000000||Math.abs(body.amount*100-Math.round(body.amount*100))>0.00001||body.action==='close'&&!isUuid(body.registerSessionId))return Response.json({error:'Enter a valid cash amount.'},{status:400});
 try{
  let expectedCash:null|number=null;let ledgerVersion:string|null=null;
  if(body.action==='close'){
   const context=await loadRegisterSessionContext(db,body.registerSessionId);
   if(!context)return Response.json({error:'Register not found.'},{status:404});
   if(context.clinicId!==session.clinicId||context.receptionistId!==session.receptionistId)return Response.json({error:'This register belongs to another receptionist.'},{status:403});
   const snapshot=await db.rpc('register_ledger_version',{p_receptionist_id:session.receptionistId});if(snapshot.error)throw snapshot.error;ledgerVersion=snapshot.data;
   const [cash,entries,register]=await Promise.all([computeRegisterSessionCashCollected(db,context),listCashDeductions(db,context.id),db.from('cash_register_sessions').select('opening_cash').eq('id',context.id).single()]);
   if(register.error)throw register.error;
   const summary=buildCashDeductionSummary(context,entries,cash);
   expectedCash=Math.round((Number(register.data.opening_cash||0)+cash-summary.activeDeductionsTotal)*100)/100;
  }
  const args={p_receptionist_id:session.receptionistId,p_clinic_id:session.clinicId,p_register_id:body.action==='close'?body.registerSessionId:null,p_amount:body.amount,p_expected_cash:expectedCash};
  const {data,error}=body.action==='close'?await db.rpc('close_verified_register',{...args,p_ledger_version:ledgerVersion}):await db.rpc('protected_register_change',{...args,p_action:'open'});
  if(error)return Response.json({error:'Register change was not saved. Refresh and try again.'},{status:409});
  return Response.json({register:data,expectedCash},{headers:{'Cache-Control':'no-store'}});
 }catch{return Response.json({error:'Cash records could not be verified. Register was not changed.'},{status:503});}
}
