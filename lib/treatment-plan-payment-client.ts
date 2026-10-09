import type {buildTreatmentPlanPaymentRpcArgs} from './treatment-plan-payment-records';
export async function saveTreatmentPlanPayment(args:ReturnType<typeof buildTreatmentPlanPaymentRpcArgs>){
 try{
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(args)));
  const key='pos-plan-payment-'+Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,'0')).join('');
  let requestId=sessionStorage.getItem(key);if(!requestId){requestId=crypto.randomUUID();sessionStorage.setItem(key,requestId);}
  const response=await fetch('/api/treatment-plan-payments',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId,args})});const result=await response.json();
  if(!response.ok)return {data:null,error:{message:result.error||'Payment was not saved.'}};
  sessionStorage.removeItem(key);return {data:result.payment,error:null};
 }catch{return {data:null,error:{message:'Could not confirm the payment. Retry the same details; do not create another payment.'}};}
}
