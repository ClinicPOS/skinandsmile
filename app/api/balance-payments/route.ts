import {createProtectedDataClient} from '../../../lib/protected-data-server';
import {readAppSession} from '../../../lib/api-session';
import {isUuid} from '../../../lib/patient-mutation-validation';
export async function POST(request:Request){
 const db=createProtectedDataClient(),{session,errorResponse}=await readAppSession(db);if(!session)return errorResponse!;
 if(session.userRole!=='receptionist'||!session.receptionistId||!session.clinicId)return Response.json({error:'Sign in as the receptionist and open your register.'},{status:403});
 const b=await request.json().catch(()=>null);
 if(!isUuid(b?.requestId)||!isUuid(b?.balanceId)||!isUuid(b?.registerSessionId)||typeof b.amount!=='number'||!Number.isFinite(b.amount)||b.amount<=0||b.amount>1000000||Math.abs(b.amount*100-Math.round(b.amount*100))>0.000001||typeof b.method!=='string'||!['Cash','Card','Bank Transfer','Visa','Mastercard','Tabby','Tabby Card','Tamara','Tamara Card'].includes(b.method)||typeof b.notes!=='string'||b.notes.length>2000)return Response.json({error:'Enter a valid payment amount and method, with an open register.'},{status:400});
 const {data,error}=await db.rpc('record_balance_payment',{p_id:b.requestId,p_balance_id:b.balanceId,p_clinic_id:session.clinicId,p_receptionist_id:session.receptionistId,p_register_id:b.registerSessionId,p_amount:b.amount,p_method:b.method,p_notes:b.notes.trim()||null});
 if(error)return Response.json({error:error.code==='42501'?'This balance or register does not belong to your clinic and receptionist login.':error.code==='23505'?'This payment request was already used with different details.':'The balance or register changed, or the payment exceeds the remaining balance. Refresh and check before retrying.'},{status:409});
 return Response.json({payment:data,remainingAfter:Number(data.remaining_after_payment)},{headers:{'Cache-Control':'no-store'}});
}
