import "server-only";
import type {AppSession} from "./api-session";
import type {SupabaseClient} from "@supabase/supabase-js";
import {ensureClinicScopeAccess} from './api-session';
import {isUuid} from './patient-mutation-validation';
// Internal helper: caller must verify the session; clinic/role checks remain here.
export async function readEodStatus(session:AppSession,request:Request,client:SupabaseClient){
const p=new URL(request.url).searchParams,clinicId=p.get('clinicId'),day=p.get('day');
if(!isUuid(clinicId)||!day||!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(Date.parse(day)))return Response.json({error:'Valid clinic and report date required.'},{status:400});
const scope=ensureClinicScopeAccess(session,clinicId);
if(scope)return scope;
if(!['owner','receptionist'].includes(session.userRole)&&!(session.userRole==='clinic_manager'&&session.permissions?.includes('reports')))return Response.json({error:'EOD access is not assigned.'},{status:403});
const start=new Date(`${day}T00:00:00+04:00`),end=new Date(start.getTime()+86400000),db=client;
const [pending,changes]=await Promise.all([db.from('receipt_refund_requests').select('id,receipt_id,plan_payment_id,kind,status,requested_reason,created_at').eq('clinic_id',clinicId).in('status',['PENDING','APPROVED']).lt('created_at',end.toISOString()).order('created_at'),db.from('receipt_refund_requests').select('receipt_id,plan_payment_id,reviewed_by,reviewed_at,completed_at,kind,requested_reason,replacement_receipt_id').eq('clinic_id',clinicId).eq('status','COMPLETED').gte('completed_at',start.toISOString()).lt('completed_at',end.toISOString())]);
if(pending.error||changes.error)return Response.json({error:'Could not check EOD approvals. Export blocked.'},{status:503});
const ids=(changes.data||[]).map(r=>r.reviewed_by).filter(Boolean);
const names=ids.length?await db.from('pos_accounts').select('id,name').in('id',ids):{data:[],error:null};
if(names.error)return Response.json({error:'Could not check approvers.'},{status:503});
const receipts=await db.from('receipts').select('id,receipt_number').eq('clinic_id',clinicId).gte('created_at',start.toISOString()).lt('created_at',end.toISOString());
if(receipts.error)return Response.json({error:'Could not check receipt status.'},{status:503});
const receiptIds=(receipts.data||[]).map(r=>r.id),payments=receiptIds.length?await db.from('payment_records').select('receipt_id,status').in('receipt_id',receiptIds):{data:[],error:null};
if(payments.error)return Response.json({error:'Could not check payment status.'},{status:503});
const statuses:Record<string,string>={};
for(const id of receiptIds){const rows=payments.data?.filter(r=>r.receipt_id===id)||[];statuses[id]=rows.length&&rows.every(r=>r.status==='refunded')?'REFUNDED':rows.some(r=>['refunded','partially_refunded'].includes(r.status))?'PARTIALLY_REFUNDED':'COMPLETED';}
return Response.json({pending:pending.data||[],statuses,receiptNumbers:Object.fromEntries((receipts.data||[]).map(r=>[r.id,String(r.receipt_number).padStart(5,'0')])),changes:(changes.data||[]).map(row=>({...row,approver:names.data?.find(n=>n.id===row.reviewed_by)?.name||''}))},{headers:{'Cache-Control':'no-store'}});
}
