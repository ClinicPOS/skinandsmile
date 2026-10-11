import {createServerSupabaseClient,readAppSession} from '../../../../lib/api-session';
import {createProtectedDataClient} from '../../../../lib/protected-data-server';
export const dynamic='force-dynamic';
import {readEodStatus} from "../../../../lib/read-eod-status";
export async function GET(request:Request){
 const {session,errorResponse}=await readAppSession(createServerSupabaseClient());
 if(!session)return errorResponse!;
 return readEodStatus(session,request,createProtectedDataClient());
}
