import { isUuid } from './patient-mutation-validation';
import { buildPaymentAllocations, paymentGroupFromVariant, paymentVariantLabel, type PaymentMethodVariant } from './payment-allocation';

const receiptFields=['clinic_id','patient_id','patient_file_id','doctor_id','receptionist_id','subtotal','vat','total','total_before_gateway_fee','gateway_fee','gateway_fee_provider','discount_amount','birthday_discount_amount','discount_reason','amount_paid','credit_applied'] as const;
const itemFields=['service_id','quantity','price','total','original_price','teeth','service_name_snapshot','allocated_global_discount_amount','taxable_amount','vat_rate','vat_amount','final_line_total'] as const;
const allocationFields=['method_group','method_variant','treatment_net_amount','vat_amount','invoice_allocation_amount','fee_rate','fee_amount','customer_charged_amount','provider_reference_number','terminal_authorization_code','card_network'] as const;
function object(value: unknown): Record<string,unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid checkout object.'); return value as Record<string,unknown>; }
function project(value: Record<string,unknown>, fields: readonly string[]) { return Object.fromEntries(fields.filter(key=>Object.hasOwn(value,key)).map(key=>[key,value[key]])); }
function money(value:unknown, optional=false) { if(optional && value==null) return; if(typeof value!=='number' || !Number.isFinite(value) || value<0 || value>10000000 || Math.abs(value*100-Math.round(value*100))>0.000001) throw Error('Amounts must be valid AED values with at most two decimal places.'); }
function text(value:unknown,max:number) { if(value!=null && (typeof value!=='string' || value.length>max)) throw Error('Invalid checkout text.'); }
export function validateCheckoutBody(input:unknown) {
  const body=object(input);
  if(!isUuid(body.requestId)) throw Error('A valid request ID is required.');
  const receipt=project(object(body.receipt),receiptFields);
  for(const key of ['clinic_id','patient_id','receptionist_id']) if(!isUuid(receipt[key])) throw Error('A valid clinic, patient and receptionist are required.');
  for(const key of ['doctor_id','patient_file_id']) if(receipt[key]!=null && !isUuid(receipt[key])) throw Error('Invalid doctor or patient file.');
  for(const key of ['subtotal','vat','total','total_before_gateway_fee']) money(receipt[key]);
  for(const key of ['gateway_fee','discount_amount','birthday_discount_amount','amount_paid','credit_applied']) money(receipt[key],true);
  text(receipt.gateway_fee_provider,50); text(receipt.discount_reason,200);
  if(!Array.isArray(body.items) || body.items.length<1 || body.items.length>200) throw Error('Checkout needs between 1 and 200 items.');
  const items=body.items.map(value=>{
    const item=project(object(value),itemFields);
    if(!isUuid(item.service_id) || !Number.isInteger(item.quantity) || Number(item.quantity)<1 || Number(item.quantity)>1000) throw Error('Invalid service or quantity.');
    for(const key of ['price','total','original_price','allocated_global_discount_amount','taxable_amount','vat_amount','final_line_total']) money(item[key]);
    if(![0,0.05].includes(item.vat_rate as number)) throw Error('Service VAT is not configured.');
    if(!Array.isArray(item.teeth) || item.teeth.length>64 || item.teeth.some(v=>typeof v!=='string'||v.length>20)) throw Error('Invalid teeth selection.');
    text(item.service_name_snapshot,300); return item;
  });
  if(!Array.isArray(body.allocations) || body.allocations.length>20) throw Error('Invalid payment allocations.');
  const variants=['cash','card','bank_transfer','tabby_standard','tabby_card','tamara'];
  const allocations: Record<string,unknown>[]=body.allocations.map(value=>{
    const row=project(object(value),allocationFields);
    if(!variants.includes(row.method_variant as string) || row.method_group!==paymentGroupFromVariant(row.method_variant as PaymentMethodVariant)) throw Error('Invalid payment method.');
    for(const key of ['treatment_net_amount','vat_amount','invoice_allocation_amount','fee_amount','customer_charged_amount']) money(row[key]);
    if(row.fee_rate!==(['tabby','tamara'].includes(row.method_group as string)?0.075:0)) throw Error('Invalid provider fee rate.');
    for(const key of ['provider_reference_number','terminal_authorization_code','card_network']) text(row[key],200);
    return {...row,status:'completed'};
  });
  const credit=Number(receipt.credit_applied||0);
  const paid=allocations.reduce((sum,row)=>sum+Number(row.invoice_allocation_amount),0);
  const computed=buildPaymentAllocations(allocations.map((row,index)=>({id:String(index),methodVariant:row.method_variant as PaymentMethodVariant,invoiceAllocationAmountInput:String(row.invoice_allocation_amount),providerReferenceNumber:String(row.provider_reference_number||''),terminalAuthorizationCode:String(row.terminal_authorization_code||''),cardNetwork:String(row.card_network||'')})),paid,Number(receipt.total_before_gateway_fee),Number(receipt.vat));
  allocations.forEach((row,index)=>{
    for(const [key,expected] of [['vat_amount',computed[index].vatAmount],['treatment_net_amount',computed[index].treatmentNetAmount],['fee_amount',computed[index].feeAmount],['customer_charged_amount',computed[index].customerChargedAmount]] as const){
      if(row[key]!==expected) throw Error('Payment allocation amounts do not reconcile.');
    }
  });
  const providers=[...new Set(allocations.filter(row=>Number(row.fee_amount)>0).map(row=>row.method_group==='tabby'?'Tabby':'Tamara'))];
  receipt.gateway_fee_provider=providers.length===1?providers[0]:providers.length>1?'Mixed':null;
  receipt.payment_method=allocations.length ? allocations.map(row=>`${paymentVariantLabel(row.method_variant as PaymentMethodVariant)} AED ${Number(row.invoice_allocation_amount).toFixed(2)}`).join(' + ') : credit>0 ? `Patient Credit (AED ${credit.toFixed(2)})` : 'No payment';
  if(body.registerSessionId!=null && !isUuid(body.registerSessionId)) throw Error('Invalid register session.');
  return {requestId:body.requestId as string,payload:{receipt,items,allocations,registerSessionId:body.registerSessionId??null}};
}
