import {authorizeWorkspace} from '../../../../lib/workspace-server';
import {createProtectedDataClient} from '../../../../lib/protected-data-server';
import {isUuid} from '../../../../lib/patient-mutation-validation';
export async function GET(request:Request){
 const clinicId=new URL(request.url).searchParams.get('clinicId');
 if(!isUuid(clinicId))return Response.json({error:'Select a clinic.'},{status:400});
 const {error}=await authorizeWorkspace(clinicId,'receptionists');if(error)return error;
 const result=await createProtectedDataClient().from('receptionist').select('id,name,shift,clinic_id,is_active').eq('clinic_id',clinicId).order('name');
 return result.error?Response.json({error:'Could not load receptionists.'},{status:503}):Response.json({records:result.data},{headers:{'Cache-Control':'no-store'}});
}
export async function POST(request:Request){
 const b=await request.json().catch(()=>null);
 if(!b||!isUuid(b.clinicId)||b.id!=null&&!isUuid(b.id)||typeof b.name!=='string'||!b.name.trim()||b.name.length>200||/[<>\u0000]/.test(b.name)||typeof b.shift!=='string'||b.shift.length>100||typeof b.active!=='boolean'||typeof b.reason!=='string'||b.reason.trim().length<3||b.reason.length>1000||b.pin!=null&&(typeof b.pin!=='string'||!/^\d{4}$/.test(b.pin))||!b.id&&!b.pin)return Response.json({error:'Enter a name, shift, reason and a four-digit PIN for a new receptionist.'},{status:400});
 const {session,error}=await authorizeWorkspace(b.clinicId,'receptionists');if(error||!session)return error!;
 const result=await createProtectedDataClient().rpc('manager_save_receptionist',{p_account_id:session.accountId,p_id:b.id??null,p_name:b.name.trim(),p_shift:b.shift.trim(),p_clinic_id:b.clinicId,p_pin:b.pin||null,p_active:b.active,p_reason:b.reason.trim()});
 return result.error?Response.json({error:'Could not save receptionist. Refresh and check clinic access.'},{status:400}):Response.json({record:result.data},{headers:{'Cache-Control':'no-store'}});
}
