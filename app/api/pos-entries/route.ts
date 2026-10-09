import {createProtectedDataClient} from '../../../lib/protected-data-server';
import {readAppSession} from '../../../lib/api-session';
import {isUuid} from '../../../lib/patient-mutation-validation';
const money=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>0&&v<=10000000&&Math.abs(v*100-Math.round(v*100))<0.00001;
const text=(v:unknown,max=2000)=>v==null||typeof v==='string'&&v.length<=max&&!v.includes('\0');
const date=(v:unknown)=>v==null||typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v));
export async function POST(request:Request){
 const db=createProtectedDataClient();const {session,errorResponse}=await readAppSession(db);if(!session)return errorResponse!;
 const b=await request.json().catch(()=>null),d=b?.data;
 if(!b||!isUuid(b.requestId)||!['plan','deposit','legacy_balance'].includes(b.kind)||!d||!isUuid(d.clinic_id)||!isUuid(d.patient_id))return Response.json({error:'Valid patient and clinic references are required.'},{status:400});
 const owner=session.userRole==='owner';
 if(!owner&&(session.userRole!=='receptionist'||!session.receptionistId||session.clinicId!==d.clinic_id)||b.kind==='legacy_balance'&&!owner||b.kind==='deposit'&&owner)return Response.json({error:'Forbidden for this clinic or action.'},{status:403});
 let fields:Record<string,unknown>={patient_id:d.patient_id};
 if(b.kind==='plan'){
  if(typeof d.title!=='string'||!d.title.trim()||!text(d.title,300)||!money(d.total_amount)||!Number.isInteger(d.planned_visits)||d.planned_visits<1||d.planned_visits>1000||d.service_id!=null&&!isUuid(d.service_id)||!text(d.notes)||!text(d.payment_arrangement,200)||d.is_legacy!=null&&typeof d.is_legacy!=='boolean')return Response.json({error:'Enter a treatment title, valid amount and visit count.'},{status:400});
  const history=d.historical_amount_paid??0,visits=d.historical_visits??0;
  if(typeof history!=='number'||!Number.isFinite(history)||history<0||history>d.total_amount||Math.abs(history*100-Math.round(history*100))>0.00001||!Number.isInteger(visits)||visits<0||visits>d.planned_visits||(!d.is_legacy&&(history!==0||visits!==0))||!date(d.historical_visit_date))return Response.json({error:'Historical amounts and visits must be within the treatment plan totals.'},{status:400});
  fields={...fields,title:d.title.trim(),total_amount:d.total_amount,planned_visits:d.planned_visits,service_id:d.service_id||null,notes:d.notes||null,payment_arrangement:d.payment_arrangement||null,is_legacy:d.is_legacy===true,historical_amount_paid:history,historical_visits:visits,historical_visit_date:d.historical_visit_date||null};
 }else if(b.kind==='deposit'){
  if(!money(d.amount)||!isUuid(d.register_session_id)||typeof d.reason!=='string'||!d.reason.trim()||!text(d.reason)||!text(d.notes)||!date(d.expected_treatment_date)||typeof d.payment_method!=='string'||!text(d.payment_method,200)||!['Cash','Card','Bank Transfer','Tabby','Tabby Card','Tamara'].includes(d.payment_method)&&!/^Split Payment \(Cash AED \d+\.\d{2} \+ (Card|Bank Transfer|Tabby|Tabby Card|Tamara) AED \d+\.\d{2}\)$/.test(d.payment_method))return Response.json({error:'Enter a valid deposit amount, payment method and reason.'},{status:400});
  if(d.payment_method.startsWith('Split Payment')){const amounts=[...d.payment_method.matchAll(/AED (\d+\.\d{2})/g)].map(m=>Number(m[1]));if(amounts.some(a=>a<=0)||Math.abs(amounts.reduce((a,b)=>a+b,0)-d.amount)>0.001)return Response.json({error:'Split payments must match the deposit amount.'},{status:400});}
  fields={...fields,amount:d.amount,register_session_id:d.register_session_id,payment_method:d.payment_method,reason:d.reason.trim(),notes:d.notes||null,expected_treatment_date:d.expected_treatment_date||null};
 }else{
  if(!money(d.original_amount)||!date(d.original_date)||!d.original_date||!text(d.reason)||!text(d.reference_number,200))return Response.json({error:'Enter the original date and a valid balance amount.'},{status:400});
  fields={...fields,original_amount:d.original_amount,original_date:d.original_date,reason:d.reason||null,reference_number:d.reference_number||null};
 }
 const {data,error}=await db.rpc('create_protected_pos_entry',{p_request_id:b.requestId,p_kind:b.kind,p_clinic_id:d.clinic_id,p_actor_id:owner?session.accountId:session.receptionistId,p_owner:owner,p_data:fields});
 if(error)return Response.json({error:'Entry was not saved. Verify clinic, patient, service and open register; retry unchanged entries after refreshing.'},{status:409});
 return Response.json({record:data},{headers:{'Cache-Control':'no-store'}});
}
