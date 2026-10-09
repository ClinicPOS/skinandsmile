import {authorizeWorkspace} from '../../../../lib/workspace-server';
import {createProtectedDataClient} from '../../../../lib/protected-data-server';
import {sessionStorageFetch} from '../../../../lib/session-storage';
export async function POST(request:Request){const {session,error}=await authorizeWorkspace();if(error||!session)return error!;const body=await request.json().catch(()=>null);
 if(typeof body?.currentPassword!=='string'||body.currentPassword.length>256||typeof body?.newPassword!=='string'||body.newPassword.length<12||body.newPassword.length>128)return Response.json({error:'Enter your current password and a new password of 12–128 characters.'},{status:400});
 try{const client=createProtectedDataClient();const {data:account,error:accountError}=await client.from('pos_accounts').select('email').eq('id',session.accountId!).single();if(accountError)throw accountError;
 const verified=await createProtectedDataClient().auth.signInWithPassword({email:account.email,password:body.currentPassword});if(verified.error||verified.data.user?.id!==session.accountId)return Response.json({error:'Current password is incorrect.'},{status:401});
 const revoked=await sessionStorageFetch(`?account_id=eq.${session.accountId}&token=neq.${encodeURIComponent(session.token)}`,{method:'DELETE'});if(!revoked.ok)throw Error('Session revocation failed');
 const changed=await client.auth.admin.updateUserById(session.accountId!,{password:body.newPassword});if(changed.error)throw changed.error;
 const logged=await client.from('activity_log').insert({action:'PASSWORD_CHANGED',entity_type:'pos_accounts',entity_id:session.accountId,actor_id:session.accountId,actor_role:session.userRole,actor_verified:true,reason:'Account holder changed password; other POS sessions revoked'});if(logged.error)throw logged.error;
 return Response.json({changed:true},{headers:{'Cache-Control':'no-store'}});
 }catch{return Response.json({error:'Password change could not complete. Try signing in with the new password before retrying.'},{status:503});}}
