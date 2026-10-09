import {cookies} from 'next/headers';
import {NextResponse} from 'next/server';
import {sessionStorageFetch} from '../../../../lib/session-storage';
import {APP_AUTH_COOKIE_NAME} from '../../../../lib/session-auth';
export async function POST(){
 const token=(await cookies()).get(APP_AUTH_COOKIE_NAME)?.value;
 try{if(token){const revoked=await sessionStorageFetch(`?token=eq.${encodeURIComponent(token)}`,{method:'DELETE'});if(!revoked.ok)throw Error('Sign out failed');}}
 catch{return Response.json({error:'Could not sign out safely. Please try again.'},{status:503});}
 const result=NextResponse.json({signedOut:true});result.cookies.delete(APP_AUTH_COOKIE_NAME);return result;
}
