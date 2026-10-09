import {authorizeWorkspace} from '../../../../lib/workspace-server';
import {createProtectedDataClient} from '../../../../lib/protected-data-server';
import {isUuid} from '../../../../lib/patient-mutation-validation';
export async function POST(request:Request){
 const {session,error}=await authorizeWorkspace(null,undefined,true);if(error||!session)return error!;
 const b=await request.json().catch(()=>null);
 if(!b||!['create','update'].includes(b.action)||b.action==='update'&&!isUuid(b.id)||!isUuid(b.data?.clinic_id)||typeof b.data.name!=='string'||!b.data.name.trim()||b.data.name.length>200||/[<>\u0000]/.test(b.data.name)||typeof b.data.shift!=='string'||b.data.shift.length>100||b.data.pin!=null&&(typeof b.data.pin!=='string'||!/^\d{4}$/.test(b.data.pin))||b.action==='create'&&!b.data.pin)return Response.json({error:'Choose a clinic, enter a name and shift, and use a 4-digit PIN. Leave the PIN blank when keeping an existing PIN.'},{status:400});
 const {data,error:saveError}=await createProtectedDataClient().rpc('owner_save_receptionist',{p_owner_id:session.accountId,p_id:b.action==='create'?null:b.id,p_name:b.data.name.trim(),p_shift:b.data.shift.trim(),p_clinic_id:b.data.clinic_id,p_pin:b.data.pin||null});
 if(saveError)return Response.json({error:'Could not save staff. Moving an existing receptionist to a different clinic is blocked to preserve historical records; create a separate clinic assignment instead.'},{status:409});
 return Response.json({record:data},{headers:{'Cache-Control':'no-store'}});
}
