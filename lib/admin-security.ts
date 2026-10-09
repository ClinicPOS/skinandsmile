import 'server-only';
import {createServerSupabaseClient,readAppSession,ensureManagerSession} from './api-session';
import {sessionManagementId} from './session-management';
export async function authorizeSecurityAdmin(){
 const {session,errorResponse}=await readAppSession(createServerSupabaseClient());
 if(errorResponse||!session) return {session:null,error:errorResponse!};
 const error=ensureManagerSession(session);
 return error?{session:null,error}:{session,error:null};
}
export async function auditActor(session:NonNullable<Awaited<ReturnType<typeof authorizeSecurityAdmin>>['session']>){
 return {actor_id:session.accountId||session.receptionistId,actor_role:session.userRole,actor_reference:await sessionManagementId(session.token),verified:true};
}
