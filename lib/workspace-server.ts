import 'server-only';
import {createServerSupabaseClient,readAppSession} from './api-session';
import type {ManagerPermission} from './account-access';
export async function authorizeWorkspace(clinicId?:string|null,permission?:ManagerPermission,ownerOnly=false){
 const {session,errorResponse}=await readAppSession(createServerSupabaseClient());
 if(!session)return {session:null,error:errorResponse!};
 if(!session.accountId||!['owner','clinic_manager'].includes(session.userRole)||ownerOnly&&session.userRole!=='owner')return {session:null,error:Response.json({error:'Your individual owner or manager login is required.'},{status:403})};
 if(session.userRole==='clinic_manager'&&((clinicId&&clinicId!==session.clinicId)||(permission&&!session.permissions?.includes(permission))))return {session:null,error:Response.json({error:'You do not have access to this clinic or permission.'},{status:403})};
 return {session,error:null};
}
