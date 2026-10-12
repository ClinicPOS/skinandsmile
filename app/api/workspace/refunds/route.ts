import {createServerSupabaseClient,readAppSession,ensureClinicScopeAccess} from '../../../../lib/api-session';
import {createProtectedDataClient} from '../../../../lib/protected-data-server';
import {auditActor} from '../../../../lib/admin-security';
import {isUuid} from '../../../../lib/patient-mutation-validation';
import {prepareRefundProposal} from '../../../../lib/refund-proposal-server';
import {prepareReceiptCorrection} from '../../../../lib/receipt-correction-server';
import {prepareReceiptVoid} from '../../../../lib/receipt-void-server';
export const dynamic='force-dynamic';
async function access(){return readAppSession(createServerSupabaseClient());}
export async function GET(request:Request){
 const {session,errorResponse}=await access();if(!session)return errorResponse!;
 if(session.userRole==='receptionist'&&!session.receptionistId)return Response.json({error:'Your receptionist login has not been confirmed. Sign out of the test POS, log in again, then select your receptionist and enter the PIN before opening the till.'},{status:403});
 const params=new URL(request.url).searchParams;
 const clinicId=params.get('clinicId')||session.clinicId;
 const offset=Number(params.get('offset')||0);if(!Number.isSafeInteger(offset)||offset<0||offset>1000000)return Response.json({error:'Invalid history page.'},{status:400});
 if(!isUuid(clinicId))return Response.json({error:'Select a clinic.'},{status:400});
 const scope=ensureClinicScopeAccess(session,clinicId);if(scope)return scope;
 if(session.userRole!=='owner'&&session.userRole!=='receptionist'&&!(session.userRole==='clinic_manager'&&session.permissions?.includes('correction_approval')))return Response.json({error:'Refund access is not assigned.'},{status:403});
 const db=createProtectedDataClient();let query=db.from('receipt_refund_requests').select('*').eq('clinic_id',clinicId).order('created_at',{ascending:false}).order('id');
 if(params.get('history')==='true')query=query.range(offset,offset+99);else query=query.in('status',['PENDING','APPROVED']).limit(200);
 if(session.userRole==='receptionist')query=query.eq('requested_by',session.receptionistId);
 const {data,error}=await query;if(error)return Response.json({error:'Could not load refund requests.'},{status:503});
 const requests=data||[];
 if(requests.length){
  const [receipts,staff,accounts]=await Promise.all([db.from('receipts').select('id,receipt_number,patient_id').in('id',requests.map(r=>r.receipt_id).filter(Boolean)),db.from('receptionist').select('id,name').in('id',requests.map(r=>r.requested_by)),db.from('pos_accounts').select('id,name').in('id',requests.map(r=>r.reviewed_by).filter(Boolean))]);
  if(receipts.error||staff.error||accounts.error)return Response.json({error:'Could not load refund details.'},{status:503});
  const planIds=requests.map(r=>r.plan_payment_id).filter(Boolean);const plans=planIds.length?await db.from('treatment_plan_payment_records').select('id,patient_id').in('id',planIds):{data:[],error:null};if(plans.error)return Response.json({error:'Could not load plan payment details.'},{status:503});
  const patientIds=[...(receipts.data||[]),...(plans.data||[])].map(r=>r.patient_id).filter(Boolean);const patients=patientIds.length?await db.from('patients').select('id,name').in('id',patientIds):{data:[],error:null};
  if(patients.error)return Response.json({error:'Could not load patient details.'},{status:503});
  for(const request of requests){const receipt=receipts.data?.find(r=>r.id===request.receipt_id);const plan=plans.data?.find(r=>r.id===request.plan_payment_id);request.receiptNumber=receipt?.receipt_number;request.planPaymentId=plan?.id;request.patientName=patients.data?.find(p=>p.id===(receipt?.patient_id||plan?.patient_id))?.name||'Patient';request.requestedBy=staff.data?.find(s=>s.id===request.requested_by)?.name||'Receptionist';request.reviewedBy=accounts.data?.find(a=>a.id===request.reviewed_by)?.name||null;}
 }
 return Response.json({requests},{headers:{'Cache-Control':'no-store'}});
}
export async function POST(request:Request){
 const {session,errorResponse}=await access();if(!session)return errorResponse!;
 const body=await request.json().catch(()=>null);const db=createProtectedDataClient();
 if(!body||!['request','approve','reject','execute','cancel'].includes(body.action))return Response.json({error:'Invalid refund action.'},{status:400});
 const correction=body.kind==='CORRECTION';
 let clinicId:string;let receiptId:string;let row;
 if(body.action==='request'){
  if(session.userRole!=='receptionist')return Response.json({error:'Use Receptionist / POS login to request a correction or refund. Managers approve requests from their workspace.'},{status:403});
  if(!session.receptionistId)return Response.json({error:'Your receptionist login has not been confirmed. Sign out, log in to the POS, then select your receptionist and enter the PIN before opening the till.'},{status:403});
  if(session.userRole!=='receptionist'||!session.receptionistId||!isUuid(body.receiptId)||!isUuid(body.operationId)||typeof body.reason!=='string'||body.reason.trim().length<3||body.reason.length>1000||!Array.isArray(body.itemIds)||body.itemIds.length>100||body.itemIds.some((id:unknown)=>!isUuid(id))||!body.allocationAmounts||typeof body.allocationAmounts!=='object'||Array.isArray(body.allocationAmounts)||Object.keys(body.allocationAmounts).length>20||Object.entries(body.allocationAmounts).some(([id,value])=>!isUuid(id)||typeof value!=='string'||value.length>30))return Response.json({error:'A receptionist login, receipt, selected items, payment amounts and reason are required.'},{status:400});
  let result=await db.from('receipts').select('id,clinic_id').eq('id',body.receiptId).maybeSingle();
  if(!result.error&&!result.data&&body.kind==='VOID')result=await db.from('treatment_plan_payment_records').select('id,clinic_id').eq('id',body.receiptId).maybeSingle();
  if(result.error)return Response.json({error:'Could not load entry.'},{status:503});if(!result.data)return Response.json({error:'Entry not found.'},{status:404});clinicId=result.data.clinic_id;receiptId=result.data.id;
 }else{
  if(!isUuid(body.id))return Response.json({error:'Invalid request.'},{status:400});
  const result=await db.from('receipt_refund_requests').select('*').eq('id',body.id).maybeSingle();if(result.error)return Response.json({error:'Could not load request.'},{status:503});if(!result.data)return Response.json({error:'Request not found.'},{status:404});row=result.data;clinicId=row.clinic_id;receiptId=row.receipt_id||row.plan_payment_id;
 }
 const scope=ensureClinicScopeAccess(session,clinicId);if(scope)return scope;
 const originalInput=body.action==='request'?JSON.stringify(body.kind==='VOID'?{kind:'VOID'}:correction?{kind:'CORRECTION',correction:body.correction}:{items:[...body.itemIds].sort(),allocations:Object.entries(body.allocationAmounts).sort(([a],[b])=>a.localeCompare(b))}):null;
 if(body.action==='request'){
  const previous=await db.from('receipt_refund_requests').select('*').eq('id',body.operationId).maybeSingle();if(previous.error)return Response.json({error:'Could not verify request retry.'},{status:503});
  if(previous.data){if((previous.data.receipt_id||previous.data.plan_payment_id)!==receiptId||previous.data.requested_by!==session.receptionistId||previous.data.requested_reason!==body.reason.trim()||previous.data.proposal.originalInput!==originalInput)return Response.json({error:'Request ID already used. Reopen the receipt to start again.'},{status:409});return Response.json({request:previous.data});}
 }
 if(['approve','reject'].includes(body.action)&&(!session.accountId||session.userRole!=='owner'&&!(session.userRole==='clinic_manager'&&session.permissions?.includes('correction_approval'))))return Response.json({error:'Only an assigned manager or owner can review.'},{status:403});
 if(['execute','cancel'].includes(body.action)&&(session.userRole!=='receptionist'||session.receptionistId!==row?.requested_by))return Response.json({error:'Only the requesting receptionist can confirm or cancel.'},{status:403});
 if(body.action==='execute'&&row?.kind==='VOID')return Response.json({error:'Void completes on manager approval. No money-return action is allowed.'},{status:409});
 if(body.action==='execute'&&row?.kind!=='CORRECTION'&&(body.moneyReturned!==true||typeof body.reference!=='string'||body.reference.trim().length<3||body.reference.length>200))return Response.json({error:'Confirm money was returned and enter a cash or provider reference.'},{status:400});
 if(body.action==='reject'&&(typeof body.reason!=='string'||body.reason.trim().length<3||body.reason.length>1000))return Response.json({error:'Enter a rejection reason.'},{status:400});
 try{
  if(body.action==='approve'&&row?.kind==='VOID'&&body.confirmMistakenEntry!==true)return Response.json({error:'Confirm this is a mistaken payment entry, with actual money accounted for separately.'},{status:400});
  const proposal=body.action==='request'?{...await (body.kind==='VOID'?prepareReceiptVoid(receiptId):correction?prepareReceiptCorrection(receiptId,session.receptionistId!,body.correction):prepareRefundProposal(receiptId,body.itemIds,body.allocationAmounts)),originalInput}:null;
  const {data,error}=await db.rpc('transition_receipt_refund',{p_id:body.action==='request'?body.operationId:body.id,p_receipt_id:receiptId,p_action:body.action,p_proposal:proposal,p_actor:{...await auditActor(session),...((body.kind==='VOID'||row?.kind==='VOID')?{void_workflow_version:2}:{})},p_reason:body.reason?.trim()||'',p_reference:body.reference?.trim()||''});
  if(error)return Response.json({error:error.message==='Invalid service clinic'?'A replacement service is inactive or does not belong to this clinic. Cancel this request and create a fresh correction using active services from your clinic.':error.message},{status:409});return Response.json({request:data});
 }catch(e){return Response.json({error:e instanceof Error?e.message:'Refund calculation failed.'},{status:400});}
}
