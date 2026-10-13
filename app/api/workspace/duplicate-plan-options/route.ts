import {createProtectedDataClient} from '../../../../lib/protected-data-server';
import {readAppSession,ensureClinicScopeAccess} from '../../../../lib/api-session';
import {isUuid} from '../../../../lib/patient-mutation-validation';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 const db=createProtectedDataClient(),{session,errorResponse}=await readAppSession(db);if(!session)return errorResponse!;
 if(!['owner','receptionist'].includes(session.userRole)&&!(session.userRole==='clinic_manager'&&session.permissions?.includes('correction_approval')))return Response.json({error:'Correction access is not assigned.'},{status:403});
 const id=new URL(request.url).searchParams.get('paymentId');if(!isUuid(id))return Response.json({error:'Select a plan payment.'},{status:400});
 const target=await db.from('treatment_plan_payment_records').select('id,treatment_plan_id,clinic_id,patient_id,total_invoice_amount_settled').eq('id',id).maybeSingle();
 if(target.error)return Response.json({error:'Plan payment could not be verified.'},{status:503});if(!target.data)return Response.json({error:'Plan payment not found.'},{status:404});
 const denied=ensureClinicScopeAccess(session,target.data.clinic_id);if(denied)return denied;
 const source=await db.from('treatment_plans').select('id,title,total_amount,planned_visits,created_at').eq('id',target.data.treatment_plan_id).maybeSingle();
 if(source.error||!source.data)return Response.json({error:'Plan details could not be loaded.'},{status:503});
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Dubai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(source.data.created_at));const start=new Date(`${day}T00:00:00+04:00`),end=new Date(start.getTime()+86400000);
 const plans=await db.from('treatment_plans').select('id,title').eq('clinic_id',target.data.clinic_id).eq('patient_id',target.data.patient_id).eq('status','Active').eq('title',source.data.title).eq('total_amount',source.data.total_amount).eq('planned_visits',source.data.planned_visits).neq('id',source.data.id).gte('created_at',start.toISOString()).lt('created_at',end.toISOString()).order('id').limit(101);
 if(plans.error||plans.data.length>100)return Response.json({error:'Duplicate-plan options could not be fully verified. Ask the owner to review.'},{status:503});
 const options=[];
 for(const plan of plans.data){const payment=await db.from('treatment_plan_payment_records').select('id,payment_method_summary').eq('treatment_plan_id',plan.id).eq('status','completed').eq('total_invoice_amount_settled',target.data.total_invoice_amount_settled).order('created_at').limit(1);if(payment.error)return Response.json({error:'The retained payment could not be verified.'},{status:503});if(payment.data.length)options.push({id:plan.id,label:`TPP-${payment.data[0].id.slice(0,8).toUpperCase()} · ${payment.data[0].payment_method_summary} · ${plan.title}`});}
 return Response.json({options},{headers:{'Cache-Control':'no-store'}});
}
