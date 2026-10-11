import { createServerSupabaseClient, readAppSession } from "../../../../lib/api-session";
import { createProtectedDataClient } from "../../../../lib/protected-data-server";

export const dynamic = "force-dynamic";

import {readReportPatientDetails} from "../../../../lib/read-report-patient-details";
export async function POST(request:Request){
 const {session,errorResponse}=await readAppSession(createServerSupabaseClient());
 if(!session)return errorResponse!;
 return readReportPatientDetails(session,request,createProtectedDataClient());
}
