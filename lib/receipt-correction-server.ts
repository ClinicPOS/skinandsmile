import 'server-only';
import {createProtectedDataClient} from './protected-data-server';
import {isUuid} from './patient-mutation-validation';
import {roundCurrency} from './money';
export async function prepareReceiptCorrection(receiptId:string,receptionistId:string,input:unknown){
 if(!input||typeof input!=='object'||!('items' in input)||!Array.isArray(input.items)||input.items.length<1||input.items.length>20)throw Error('Select between 1 and 20 corrected services.');
 const db=createProtectedDataClient(),initial=await db.rpc('receipt_refund_fingerprint',{p_receipt_id:receiptId});
 const register=await db.from('cash_register_sessions').select('id').eq('receptionist_id',receptionistId).is('closed_at',null).single();if(register.error||!register.data)throw Error('Open the register before requesting a correction.');
 const receipt=await db.from('receipts').select('*').eq('id',receiptId).single();if(receipt.error||initial.error)throw Error('Could not load receipt.');
 const r=receipt.data;if(r.status==='VOIDED')throw Error('This receipt is already voided. Use the replacement.');
 const [visits,clinicalItems]=await Promise.all([db.from('treatment_plan_visits').select('id').eq('receipt_id',receiptId).limit(1),db.from('receipt_items').select('teeth').eq('receipt_id',receiptId)]);
 if(visits.error||clinicalItems.error)throw Error('Could not verify clinical records.');
 if(r.treatment_plan_id||r.transaction_type&&r.transaction_type!=='regular'||visits.data.length||clinicalItems.data.some(i=>Array.isArray(i.teeth)&&i.teeth.length))throw Error('This receipt contains treatment-plan or tooth records. Ask the owner to review it; automatic correction is unavailable.');
 const [payments,refunds,balances]=await Promise.all([db.from('payment_records').select('id,total_customer_charged_amount').eq('receipt_id',receiptId),db.from('refunds').select('id').eq('receipt_id',receiptId).limit(1),db.from('outstanding_balances').select('id').eq('receipt_id',receiptId)]);
 if(payments.error||refunds.error||balances.error)throw Error('Could not verify payment history.');
 if(refunds.data.length||Number(r.credit_applied||0)!==0||Number(r.gateway_fee||0)!==0||payments.data.length>1)throw Error('This receipt needs owner review because it includes a refund, credit, fees or multiple payments.');
 const allocation=payments.data.length?await db.from('payment_allocations').select('method_variant').eq('payment_id',payments.data[0].id):{data:[],error:null};
 if(allocation.error||payments.data.length&&(allocation.data?.length!==1||allocation.data[0].method_variant!=='cash'))throw Error('Automatic correction currently supports single cash payments only. Ask the owner to review other methods.');
 if(payments.data.reduce((sum,p)=>sum+Number(p.total_customer_charged_amount),0)!==Number(r.amount_paid??r.total))throw Error('The saved payment does not reconcile. Ask the owner to review it.');
 if(balances.data.length){const collected=await db.from('balance_payments').select('id').in('outstanding_balance_id',balances.data.map(b=>b.id)).limit(1);if(collected.error||collected.data.length)throw Error('A later balance payment exists or could not be checked. Ask the owner to review.');}
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Dubai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 if(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Dubai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(r.created_at))!==today)throw Error('Earlier-day receipts need owner reconciliation.');
 const raw=input.items as {serviceId:unknown;price:unknown;quantity:unknown}[];
 if(raw.some(i=>!isUuid(i.serviceId)||typeof i.price!=='number'||!Number.isFinite(i.price)||i.price<0||i.price>1000000||Math.round(i.price*100)!==i.price*100&&Math.abs(Math.round(i.price*100)-i.price*100)>1e-7||typeof i.quantity!=='number'||!Number.isInteger(i.quantity)||i.quantity<1||i.quantity>100))throw Error('Enter valid services, prices and quantities.');
 const services=await db.from('services').select('id,name,clinic_id,vat_rate,is_active').in('id',raw.map(i=>i.serviceId));if(services.error)throw Error('Could not load services.');
 const items=raw.map(line=>{const service=services.data.find(s=>s.id===line.serviceId);if(!service||service.is_active===false||service.clinic_id&&service.clinic_id!==r.clinic_id||![0,0.05].includes(service.vat_rate))throw Error('Select active services for this clinic.');const total=roundCurrency(Number(line.price)*Number(line.quantity)),vat=roundCurrency(total*service.vat_rate);return {service_id:service.id,quantity:line.quantity,price:line.price,original_price:line.price,total,teeth:[],service_name_snapshot:service.name,allocated_global_discount_amount:0,taxable_amount:total,vat_rate:service.vat_rate,vat_amount:vat,final_line_total:roundCurrency(total+vat)};});
 const subtotal=roundCurrency(items.reduce((s,i)=>s+i.total,0)),vat=roundCurrency(items.reduce((s,i)=>s+i.vat_amount,0)),total=roundCurrency(subtotal+vat);
 const paid=Number(r.amount_paid??r.total);if(total<=0||paid>total)throw Error('The corrected bill must cover the recorded payment. If money is owed to the patient, record a refund or patient credit decision first.');
 const final=await db.rpc('receipt_refund_fingerprint',{p_receipt_id:receiptId});if(final.error||initial.data!==final.data)throw Error('Receipt changed. Reload and request again.');
 return {kind:'CORRECTION',fingerprint:initial.data,total,invoice:total,recordedPayment:paid,items:items.map(i=>({service_name:i.service_name_snapshot,refunded_invoice_amount:i.final_line_total})),method:'Keep original recorded cash payment',checkout:{receipt:{clinic_id:r.clinic_id,patient_id:r.patient_id,patient_file_id:r.patient_file_id,doctor_id:r.doctor_id,receptionist_id:receptionistId,subtotal,vat,total,total_before_gateway_fee:total,gateway_fee:0,discount_amount:0,birthday_discount_amount:0,amount_paid:0,credit_applied:0,payment_method:'Cash'},items,allocations:[],registerSessionId:register.data.id}};
}
