import {randomBytes} from 'node:crypto';
import {authorizeWorkspace} from '../../../../../lib/workspace-server';
import {createProtectedDataClient} from '../../../../../lib/protected-data-server';
import {isUuid} from '../../../../../lib/patient-mutation-validation';
import {sessionStorageFetch} from '../../../../../lib/session-storage';
export async function POST(request:Request){
 const {session,error}=await authorizeWorkspace(null,undefined,true);if(error||!session)return error!;
 const b=await request.json().catch(()=>null);
 if(!isUuid(b?.accountId)||typeof b.reason!=='string'||b.reason.trim().length<3||b.reason.length>1000)return Response.json({error:'Select a manager and enter a reason.'},{status:400});
 try{
  const client=createProtectedDataClient(),lookup=await client.from('pos_accounts').select('id,role').eq('id',b.accountId).single();
  if(lookup.error||lookup.data.role!=='clinic_manager')return Response.json({error:'Manager not found.'},{status:404});
  const revoked=await sessionStorageFetch(`?account_id=eq.${b.accountId}`,{method:'DELETE'});if(!revoked.ok)throw Error('Session revocation failed');
  const temporaryPassword=randomBytes(24).toString('base64url');
  const changed=await client.auth.admin.updateUserById(b.accountId,{password:temporaryPassword});if(changed.error)throw changed.error;
  const logged=await client.from('activity_log').insert({action:'MANAGER_PASSWORD_RESET',entity_type:'pos_accounts',entity_id:b.accountId,actor_id:session.accountId,actor_role:'owner',actor_verified:true,reason:b.reason.trim()});if(logged.error)throw logged.error;
  return Response.json({temporaryPassword},{headers:{'Cache-Control':'no-store'}});
 }catch{return Response.json({error:'Reset could not complete. Retry to issue a new temporary password.'},{status:503});}
}
