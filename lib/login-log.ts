import 'server-only';
import {createProtectedDataClient} from './protected-data-server';
export async function recordLoginAttempt(request:Request,success:boolean){
 const ip=(request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()||'unknown').slice(0,100);
 const user_agent=(request.headers.get('user-agent')||'unknown').slice(0,2000);
 const {error}=await createProtectedDataClient().from('login_logs').insert({ip,user_agent,success});
 if(error) throw new Error('Login history could not be recorded.');
}
