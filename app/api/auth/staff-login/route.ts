import {NextResponse} from 'next/server';
import {randomUUID} from 'node:crypto';
import {createProtectedDataClient} from '../../../../lib/protected-data-server';
import {readNamedAccountAccess} from '../../../../lib/account-access';
import {sessionStorageFetch} from '../../../../lib/session-storage';
import {recordLoginAttempt} from '../../../../lib/login-log';
import {isUuid} from '../../../../lib/patient-mutation-validation';
import {consumeLoginAttempt,clearLoginAttempts,loginAttemptKey} from '../../../../lib/login-attempt-limits';
export async function POST(request:Request){
 const body=await request.json().catch(()=>null);
 if(typeof body?.email!=='string'||body.email.length>254||typeof body?.password!=='string'||body.password.length>256||(body.clinicId&&!isUuid(body.clinicId)))return Response.json({error:'Enter your email and password.'},{status:400});
 try{
  const attemptKey=loginAttemptKey('named-staff',body.email.trim().toLowerCase()+'\0'+(request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()||'local'));
  if(!(await consumeLoginAttempt(attemptKey,10)).allowed)return Response.json({error:'Too many login attempts. Try again in five minutes.'},{status:429});
  const {data,error}=await createProtectedDataClient().auth.signInWithPassword({email:body.email.trim().toLowerCase(),password:body.password});
  if(error||!data.user){await recordLoginAttempt(request,false);return Response.json({error:'Incorrect login or account unavailable.'},{status:401});}
  const client=createProtectedDataClient();
  const {data:account,error:lookupError}=await client.from('pos_accounts').select('id,name,role,enabled').eq('id',data.user.id).maybeSingle();
  if(lookupError)throw lookupError;
  if(!account?.enabled){await recordLoginAttempt(request,false);return Response.json({error:'Incorrect login or account unavailable.'},{status:401});}
  let clinicId:string|null=null;
  if(account.role==='clinic_manager'){
   const {data:access,error:accessError}=await client.from('pos_manager_access').select('clinic_id,starts_on,ends_on').eq('account_id',account.id);if(accessError)throw accessError;
   const allowed=[];for(const row of access||[]){if(await readNamedAccountAccess(account.id,row.clinic_id))allowed.push(row.clinic_id);}
   if(!allowed.length)return Response.json({error:'No active clinic assignment. Contact the owner.'},{status:403});
   if(!body.clinicId){const {data:clinics,error:clinicError}=await client.from('clinics').select('id,name').in('id',allowed).order('name');if(clinicError)throw clinicError;return Response.json({clinics:clinics||[],selectClinic:true});}
   if(!allowed.includes(body.clinicId))return Response.json({error:'This clinic is not assigned to you.'},{status:403});clinicId=body.clinicId;
  }else if(account.role!=='owner')return Response.json({error:'Account unavailable.'},{status:403});
  const token=randomUUID();const stored=await sessionStorageFetch('',{method:'POST',body:JSON.stringify({token,session_mode:'manager',clinic_id:clinicId,user_role:account.role,account_id:account.id,created_at:new Date().toISOString()})});
  if(!stored.ok)throw Error('Session could not be saved');
  try{await recordLoginAttempt(request,true);await clearLoginAttempts(attemptKey);}catch(error){await sessionStorageFetch(`?token=eq.${token}`,{method:'DELETE'});throw error;}
  const response=NextResponse.json({role:account.role,name:account.name,clinicId,next:account.role==='owner'?'/backend/managers':'/clinic-admin'},{headers:{'Cache-Control':'no-store'}});
  response.cookies.set('app-auth',token,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',path:'/',maxAge:8*60*60});return response;
 }catch{return Response.json({error:'Login is temporarily unavailable. Please try again.'},{status:503});}
}
