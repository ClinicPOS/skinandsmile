import {authorizeSecurityAdmin} from '../../../../lib/admin-security';
import {createProtectedDataClient} from '../../../../lib/protected-data-server';
export const dynamic='force-dynamic';
export async function GET(){
 const {error}=await authorizeSecurityAdmin();if(error)return error;
 try{const {data,error:queryError}=await createProtectedDataClient().from('login_logs').select('id,ip,user_agent,success,created_at').order('created_at',{ascending:false}).order('id',{ascending:false}).limit(20);if(queryError)throw queryError;
 return Response.json({logs:data||[]},{headers:{'Cache-Control':'no-store'}});
 }catch{return Response.json({error:'Login history is unavailable.'},{status:503});}
}
