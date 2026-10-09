import 'server-only';
import {createHash} from 'node:crypto';
import {createProtectedDataClient} from './protected-data-server';
export function loginAttemptKey(kind:string,identity:string){return createHash('sha256').update(kind+'\0'+identity).digest('hex');}
export async function consumeLoginAttempt(key:string,limit:number){const {data,error}=await createProtectedDataClient().rpc('consume_pos_login_attempt',{p_key:key,p_limit:limit,p_window_seconds:300});if(error)throw Error('Login verification is unavailable.');return data as {allowed:boolean;remaining:number};}
export async function clearLoginAttempts(key:string){const {error}=await createProtectedDataClient().from('pos_login_attempt_limits').delete().eq('key',key);if(error)throw Error('Login verification is unavailable.');}
