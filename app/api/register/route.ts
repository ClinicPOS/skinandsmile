import {createProtectedDataClient} from '../../../lib/protected-data-server';
import {readAppSession} from '../../../lib/api-session';
import {isUuid} from '../../../lib/patient-mutation-validation';
import {computeRegisterSessionCashCollected,listCashDeductions,loadRegisterSessionContext,buildCashDeductionSummary} from '../cash-deductions/_shared';
export const dynamic='force-dynamic';
// Browser storage is a hint, never proof of who owns a register.
export async function GET(){
 const db=createProtectedDataClient();const {session,errorResponse}=await readAppSession(db);
 if(!session)return errorResponse!;
 if(session.sessionMode!=='clinic'||session.userRole!=='receptionist'||!session.clinicId)return Response.json({error:'Use Receptionist / POS login first.'},{status:403});
 try{
  const clinicResult=await db.from('clinics').select('*').eq('id',session.clinicId).maybeSingle();
  if(clinicResult.error)throw clinicResult.error;
  if(!clinicResult.data)return Response.json({error:'Your clinic could not be verified. Sign in again.'},{status:403});
  if(!session.receptionistId)return Response.json({clinic:clinicResult.data,identity:null,register:null},{headers:{'Cache-Control':'no-store'}});
  const [staffResult,registerResult]=await Promise.all([
   db.from('receptionist').select('id,name,clinic_id,is_active').eq('id',session.receptionistId).eq('clinic_id',session.clinicId).maybeSingle(),
   db.from('cash_register_sessions').select('id,receptionist_id,opening_cash,opened_at,closed_at').eq('receptionist_id',session.receptionistId).is('closed_at',null).order('opened_at',{ascending:false}).limit(2),
  ]);
  if(staffResult.error||registerResult.error)throw staffResult.error||registerResult.error;
  if(!staffResult.data||staffResult.data.is_active!==true)return Response.json({error:'Your receptionist account could not be verified. Sign in again.'},{status:403});
  if((registerResult.data||[]).length>1)return Response.json({error:'More than one open register was found. Ask a manager to reconcile them before continuing.'},{status:409});
  return Response.json({clinic:clinicResult.data,identity:{receptionistId:staffResult.data.id,receptionistName:staffResult.data.name,clinicId:session.clinicId},register:registerResult.data?.[0]||null},{headers:{'Cache-Control':'no-store'}});
 }catch{return Response.json({error:'Register verification is unavailable. Your register has not been changed. Please retry.'},{status:503});}
}
export async function POST(request:Request){
 const db=createProtectedDataClient();const {session,errorResponse}=await readAppSession(db);
 if(!session)return errorResponse!;
 if(session.userRole!=='receptionist'||!session.receptionistId||!session.clinicId)return Response.json({error:'Sign in as a receptionist first.'},{status:403});
 const body=await request.json().catch(()=>null);
 if(!body||!['open','close'].includes(body.action)||typeof body.amount!=='number'||!Number.isFinite(body.amount)||body.amount<0||body.amount>10000000||Math.abs(body.amount*100-Math.round(body.amount*100))>0.00001||body.action==='close'&&!isUuid(body.registerSessionId))return Response.json({error:'Enter a valid cash amount.'},{status:400});
 if(body.expectedReceptionistId!==undefined||body.expectedClinicId!==undefined){
  if(!isUuid(body.expectedReceptionistId)||!isUuid(body.expectedClinicId))return Response.json({error:'Verify your receptionist login before changing the register.'},{status:400});
  if(body.expectedReceptionistId!==session.receptionistId||body.expectedClinicId!==session.clinicId)return Response.json({error:'Your receptionist login changed. Verify it again before changing the register.'},{status:409});
 }
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
