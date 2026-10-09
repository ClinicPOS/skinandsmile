import {authorizeWorkspace} from '../../../../lib/workspace-server';
import {createProtectedDataClient} from '../../../../lib/protected-data-server';
export const dynamic='force-dynamic';
export async function GET(){const {session,error}=await authorizeWorkspace();if(error||!session)return error!;
 try{let query=createProtectedDataClient().from('clinics').select('id,name').order('name');if(session.userRole!=='owner')query=query.eq('id',session.clinicId!);
 const {data,error:queryError}=await query;if(queryError)throw queryError;
 return Response.json({role:session.userRole,name:session.accountName,clinicId:session.clinicId,permissions:session.permissions,clinics:data||[]},{headers:{'Cache-Control':'no-store'}});
 }catch{return Response.json({error:'Workspace unavailable.'},{status:503});}}
