import { createServerSupabaseClient, readAppSession } from "../../../../lib/api-session";
import { createProtectedDataClient } from "../../../../lib/protected-data-server";

export const dynamic = "force-dynamic";
import {readReportPatientHistory} from "../../../../lib/read-report-patient-history";
export async function GET(request:Request){
 const {session,errorResponse}=await readAppSession(createServerSupabaseClient());
 if(!session)return errorResponse!;
 return readReportPatientHistory(session,request,createProtectedDataClient());
}
