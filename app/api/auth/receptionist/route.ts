import {createServerSupabaseClient,readAppSession} from '../../../../lib/api-session';
import {createProtectedDataClient} from '../../../../lib/protected-data-server';
import {sessionStorageFetch} from '../../../../lib/session-storage';
import {isUuid} from '../../../../lib/patient-mutation-validation';
import {consumeLoginAttempt,clearLoginAttempts,loginAttemptKey} from '../../../../lib/login-attempt-limits';
export const dynamic='force-dynamic';
export async function POST(request:Request){
 const {session,errorResponse}=await readAppSession(createServerSupabaseClient());if(!session)return errorResponse!;
 if(session.sessionMode!=='clinic'||session.userRole!=='receptionist')return Response.json({error:'Use Receptionist / POS login first.'},{status:403});
 const body=await request.json().catch(()=>null);
 if(!body||!isUuid(body.receptionistId)||typeof body.pin!=='string'||body.pin.length>100)return Response.json({error:'Select a receptionist and enter their PIN.'},{status:400});
 const attemptKey=loginAttemptKey('receptionist-pin',session.token+'\0'+body.receptionistId);
 const accountKey=loginAttemptKey('receptionist-account-pin',session.clinicId+'\0'+body.receptionistId);
 try{const attempt=await consumeLoginAttempt(attemptKey,5);const accountAttempt=await consumeLoginAttempt(accountKey,10);if(!attempt.allowed||!accountAttempt.allowed)return Response.json({error:'Too many PIN attempts. Try again in five minutes.'},{status:429});}catch{return Response.json({error:'PIN verification is unavailable. Try again.'},{status:503});}
 const db=createProtectedDataClient();const {data,error}=await db.from('receptionist').select('id,clinic_id,pin').eq('id',body.receptionistId).eq('clinic_id',session.clinicId!).maybeSingle();
 if(error)return Response.json({error:'Could not verify receptionist. Try again.'},{status:503});
 if(!data||!data.pin||String(data.pin)!==body.pin)return Response.json({error:'Invalid receptionist or PIN.'},{status:403});
 if(session.receptionistId&&session.receptionistId!==data.id)return Response.json({error:'Sign out before changing receptionist.'},{status:409});
 const saved=await sessionStorageFetch(`?token=eq.${encodeURIComponent(session.token)}`,{method:'PATCH',body:JSON.stringify({receptionist_id:data.id})});
 if(!saved.ok)return Response.json({error:'Could not save receptionist login. Try again.'},{status:503});
 const verified=await readAppSession(createServerSupabaseClient());if(verified.session?.receptionistId!==data.id)return Response.json({error:'Receptionist login could not be confirmed. Try again.'},{status:503});
 try{await clearLoginAttempts(attemptKey);await clearLoginAttempts(accountKey);}catch{await sessionStorageFetch(`?token=eq.${encodeURIComponent(session.token)}`,{method:'DELETE'});return Response.json({error:'PIN verification could not be confirmed. Sign in again.'},{status:503});}return Response.json({ok:true});
}
