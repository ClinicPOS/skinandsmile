import {NextResponse} from 'next/server';
import {authorizeWorkspace} from '../../../../lib/workspace-server';
import {sessionStorageFetch} from '../../../../lib/session-storage';
export async function POST(){const {session,error}=await authorizeWorkspace();if(error||!session)return error!;const response=await sessionStorageFetch(`?token=eq.${encodeURIComponent(session.token)}`,{method:'DELETE'});if(!response.ok)return Response.json({error:'Could not sign out.'},{status:503});const result=NextResponse.json({signedOut:true});result.cookies.delete('app-auth');return result;}
