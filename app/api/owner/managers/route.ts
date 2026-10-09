import {randomBytes} from 'node:crypto';
import {authorizeWorkspace} from '../../../../lib/workspace-server';
import {createProtectedDataClient} from '../../../../lib/protected-data-server';
import {MANAGER_PERMISSIONS} from '../../../../lib/account-access';
import {validDate} from '../../../../lib/correction-approvers';
import {isUuid} from '../../../../lib/patient-mutation-validation';
export const dynamic='force-dynamic';
export async function GET(){const {error}=await authorizeWorkspace(null,undefined,true);if(error)return error;
 try{const client=createProtectedDataClient();const results=await Promise.all([client.from('pos_accounts').select('id,name,email,role,enabled,updated_at').eq('role','clinic_manager').order('name'),client.from('pos_manager_access').select('*'),client.from('clinics').select('id,name').order('name')]);if(results.some(r=>r.error))throw Error('Lookup failed');return Response.json({accounts:results[0].data,access:results[1].data,clinics:results[2].data},{headers:{'Cache-Control':'no-store'}});}catch{return Response.json({error:'Manager accounts unavailable.'},{status:503});}}
export async function POST(request:Request){const {session,error}=await authorizeWorkspace(null,undefined,true);if(error||!session)return error!;
 const body=await request.json().catch(()=>null);
 if(!body||!isUuid(body.clinicId)||body.accountId&&!isUuid(body.accountId)||typeof body.name!=='string'||!body.name.trim()||body.name.length>120||typeof body.enabled!=='boolean'||!Array.isArray(body.permissions)||body.permissions.some((p:unknown)=>!MANAGER_PERMISSIONS.includes(p as typeof MANAGER_PERMISSIONS[number]))||typeof body.reason!=='string'||body.reason.trim().length<3||body.reason.length>1000||body.startsOn!=null&&!validDate(body.startsOn)||body.endsOn!=null&&!validDate(body.endsOn)||body.startsOn&&body.endsOn&&body.endsOn<body.startsOn||body.expectedUpdatedAt!=null&&!Number.isFinite(Date.parse(body.expectedUpdatedAt)))return Response.json({error:'Enter a name, clinic, valid permissions/dates and a reason.'},{status:400});
 if(!body.accountId&&(typeof body.email!=='string'||body.email.length>254||!/^\S+@\S+\.\S+$/.test(body.email)))return Response.json({error:'Enter a valid manager email.'},{status:400});
 try{const client=createProtectedDataClient();let id=body.accountId;let temporaryPassword:string|undefined;
 if(!id){const email=body.email.trim().toLowerCase();const {data:existing,error:existingError}=await client.from('pos_accounts').select('id,role').eq('email',email).maybeSingle();if(existingError)throw existingError;if(existing)return Response.json({error:'This account already exists. Select it to change access.'},{status:409});
 temporaryPassword=randomBytes(24).toString('base64url');const {data,error:createError}=await client.auth.admin.createUser({email,password:temporaryPassword,email_confirm:true});if(createError||!data.user)return Response.json({error:'Could not create account. The email may already be registered.'},{status:409});id=data.user.id;
 const inserted=await client.from('pos_accounts').insert({id,name:body.name.trim(),email,role:'clinic_manager',enabled:false});if(inserted.error)throw Error('Account setup incomplete');
 }
 const {error:saveError}=await client.rpc('owner_save_manager',{p_owner_id:session.accountId,p_account_id:id,p_name:body.name.trim(),p_enabled:body.enabled,p_clinic_id:body.clinicId,p_permissions:[...new Set(body.permissions)],p_starts:body.startsOn??null,p_ends:body.endsOn??null,p_expected_updated_at:body.expectedUpdatedAt??null,p_reason:body.reason.trim()});
 if(saveError)return Response.json({error:saveError.code==='23505'?'Access changed. Refresh before saving.':'Access could not be saved. A newly created account remains disabled.'},{status:saveError.code==='23505'?409:saveError.code==='42501'?403:400});
 return Response.json({saved:true,accountId:id,...(temporaryPassword?{temporaryPassword}:{})},{headers:{'Cache-Control':'no-store'}});
 }catch{return Response.json({error:'Manager setup could not complete. Refresh and check for a disabled account before retrying.'},{status:503});}
}
