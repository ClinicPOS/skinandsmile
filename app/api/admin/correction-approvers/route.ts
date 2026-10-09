import {authorizeSecurityAdmin,auditActor} from '../../../../lib/admin-security';
import {createProtectedDataClient} from '../../../../lib/protected-data-server';
import {isUuid} from '../../../../lib/patient-mutation-validation';
import {dubaiDay,effectiveApprovers,validDate} from '../../../../lib/correction-approvers';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 const {error}=await authorizeSecurityAdmin();if(error)return error;
 const clinicId=new URL(request.url).searchParams.get('clinicId');if(!isUuid(clinicId))return Response.json({error:'Select a clinic.'},{status:400});
 try{const client=createProtectedDataClient();
 const [settingsResult,clinicsResult]=await Promise.all([client.from('clinic_correction_approvers').select('*').eq('clinic_id',clinicId).maybeSingle(),client.from('clinics').select('id,name').order('name')]);
 if(settingsResult.error||clinicsResult.error)throw Error('Lookup failed');
 const staff: {id:string;name:string|null;clinic_id:string|null}[]=[];
 for(let offset=0;;offset+=500){const {data,error}=await client.from('receptionist').select('id,name,clinic_id').order('id').range(offset,offset+499);if(error)throw error;staff.push(...(data||[]));if((data||[]).length<500)break;}
 const day=dubaiDay(),settings=settingsResult.data;
 return Response.json({settings,staff,clinics:clinicsResult.data||[],day,effective:settings?effectiveApprovers(settings,day):null},{headers:{'Cache-Control':'no-store'}});
 }catch{return Response.json({error:'Approver settings are unavailable.'},{status:503});}
}
export async function PUT(request:Request){
 const {session,error}=await authorizeSecurityAdmin();if(error||!session)return error!;
 const body=await request.json().catch(()=>null),s=body?.settings;
 if(!isUuid(body?.clinicId)||!s||!isUuid(s.primary_approver_id)||[s.backup_approver_id,s.temporary_approver_id].some(v=>v!=null&&!isUuid(v))||s.backup_approver_id===s.primary_approver_id||typeof body.reason!=='string'||body.reason.trim().length<3||body.reason.length>1000)return Response.json({error:'Select a primary approver, a different backup, and enter a reason.'},{status:400});
 if(s.temporary_approver_id?(!validDate(s.temporary_start)||!validDate(s.temporary_end)||s.temporary_end<s.temporary_start):(s.temporary_start!=null||s.temporary_end!=null))return Response.json({error:'Temporary cover needs valid start and end dates.'},{status:400});
 if(body.expectedUpdatedAt!=null&&(typeof body.expectedUpdatedAt!=='string'||!Number.isFinite(Date.parse(body.expectedUpdatedAt))))return Response.json({error:'Invalid settings version.'},{status:400});
 const settings={primary_approver_id:s.primary_approver_id,backup_approver_id:s.backup_approver_id??null,temporary_approver_id:s.temporary_approver_id??null,temporary_start:s.temporary_start??null,temporary_end:s.temporary_end??null};
 try{const {data,error:saveError}=await createProtectedDataClient().rpc('save_clinic_correction_approvers',{p_clinic_id:body.clinicId,p_settings:settings,p_expected_updated_at:body.expectedUpdatedAt??null,p_actor:await auditActor(session),p_reason:body.reason.trim()});
 if(saveError)return Response.json({error:saveError.code==='23505'?'Another administrator changed these settings. Refresh before saving.':'Approver settings could not be saved.'},{status:saveError.code==='23505'?409:['22023','23514','23503'].includes(saveError.code)?400:503});
 const day=dubaiDay();
 return Response.json({settings:data,day,effective:effectiveApprovers(data,day)},{headers:{'Cache-Control':'no-store'}});
 }catch{return Response.json({error:'Approver settings are unavailable.'},{status:503});}
}
