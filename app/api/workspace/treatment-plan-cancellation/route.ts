import {authorizeWorkspace} from '../../../../lib/workspace-server';
import {createProtectedDataClient} from '../../../../lib/protected-data-server';
import {isUuid} from '../../../../lib/patient-mutation-validation';
export async function POST(request:Request){
 const body=await request.json().catch(()=>null);
 if(!isUuid(body?.planId)||typeof body.reason!=='string'||body.reason.trim().length<3||body.reason.length>1000)return Response.json({error:'Select a plan and enter a reason.'},{status:400});
 const auth=await authorizeWorkspace(undefined,'correction_approval');if(auth.error)return auth.error;
 const db=createProtectedDataClient();
 const {data:plan,error:readError}=await db.from('treatment_plans').select('clinic_id').eq('id',body.planId).maybeSingle();
 if(readError)return Response.json({error:'Could not verify the plan.'},{status:503});
 if(!plan)return Response.json({error:'Plan not found.'},{status:404});
 const {session,error}=await authorizeWorkspace(plan.clinic_id,'correction_approval');if(error||!session)return error!;
 const {error:saveError}=await db.rpc('cancel_unused_treatment_plan',{p_plan_id:body.planId,p_account_id:session.accountId,p_reason:body.reason.trim()});
 if(saveError)return Response.json({error:saveError.code==='42501'?'Your manager permission changed. Sign in again.':saveError.code==='P0001'?'This plan has payments, visits, or linked receipts. It needs financial review; no records were changed.':'This plan cannot be cancelled. No records were changed.'},{status:400});
 return Response.json({status:'Cancelled'},{headers:{'Cache-Control':'no-store'}});
}
