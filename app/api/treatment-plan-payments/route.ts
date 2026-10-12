import {createProtectedDataClient} from '../../../lib/protected-data-server';
import {readAppSession} from '../../../lib/api-session';
import {isUuid} from '../../../lib/patient-mutation-validation';
import {buildPaymentAllocations,validatePaymentAllocations,type PaymentAllocationDraft,type PaymentMethodVariant} from '../../../lib/payment-allocation';
import {buildTreatmentPlanPaymentRpcArgs} from '../../../lib/treatment-plan-payment-records';
export async function POST(request:Request){
 const db=createProtectedDataClient(),{session,errorResponse}=await readAppSession(db);if(!session)return errorResponse!;
 if(session.userRole!=='receptionist'||!session.clinicId||!session.receptionistId)return Response.json({error:'Sign in as the receptionist and open your register.'},{status:403});
 const body=await request.json().catch(()=>null),input=body?.args;
 if(!isUuid(body?.requestId)||!isUuid(input?.p_treatment_plan_id)||!isUuid(input?.p_register_session_id)||!Array.isArray(input?.p_allocations)||input.p_allocations.length<1||input.p_allocations.length>20)return Response.json({error:'Select a plan, open register and valid payment methods.'},{status:400});
 const {data:plan,error:planError}=await db.from('treatment_plans').select('id,patient_id,clinic_id,title').eq('id',input.p_treatment_plan_id).eq('clinic_id',session.clinicId).maybeSingle();
 if(planError)return Response.json({error:'Could not verify the plan.'},{status:503});if(!plan)return Response.json({error:'Plan not found in your clinic.'},{status:403});
 let args;
 try{
  const drafts:PaymentAllocationDraft[]=input.p_allocations.map((row:Record<string,unknown>,index:number)=>{
   if(!row||!['cash','card','bank_transfer','tabby_standard','tabby_card','tamara'].includes(String(row.method_variant))||typeof row.invoice_allocation_amount!=='number'||!Number.isFinite(row.invoice_allocation_amount)||row.invoice_allocation_amount<=0||row.invoice_allocation_amount>1000000||Math.abs(row.invoice_allocation_amount*100-Math.round(row.invoice_allocation_amount*100))>0.000001)throw Error('Enter valid AED amounts and payment methods.');
   for(const key of ['provider_reference_number','terminal_authorization_code','card_network'])if(row[key]!=null&&(typeof row[key]!=='string'||String(row[key]).length>200))throw Error('Payment references must be up to 200 characters.');
   return {id:String(index),methodVariant:row.method_variant as PaymentMethodVariant,invoiceAllocationAmountInput:String(row.invoice_allocation_amount),providerReferenceNumber:String(row.provider_reference_number||''),terminalAuthorizationCode:String(row.terminal_authorization_code||''),cardNetwork:String(row.card_network||'')};
  });
  const amount=drafts.reduce((sum,row)=>sum+Number(row.invoiceAllocationAmountInput),0),validation=validatePaymentAllocations(drafts,amount);if(validation.length)throw Error(validation[0].message);
  args=buildTreatmentPlanPaymentRpcArgs({treatmentPlanId:plan.id,patientId:plan.patient_id,clinicId:session.clinicId,receptionistId:session.receptionistId,registerSessionId:input.p_register_session_id,paymentNotePrefix:`Plan payment: ${plan.title}`,allocations:buildPaymentAllocations(drafts,amount,amount,0)});
 }catch(e){return Response.json({error:e instanceof Error?e.message:'Invalid payment.'},{status:400});}
 const {data,error}=await db.rpc('record_protected_plan_payment',{p_request_id:body.requestId,p_args:args});
 if(error)return Response.json({error:error.code==='23505'?'This request was already used for different payment details.':'The plan or register changed, or this payment exceeds the remaining balance. No additional payment was recorded.'},{status:409});
 if(data?.status==='cancelled')return Response.json({error:'This payment was voided. No new payment was recorded. Review the history before starting another payment.'},{status:409});
 return Response.json({payment:data},{headers:{'Cache-Control':'no-store'}});
}
