// Doctor performance is treatment value excluding VAT and payment-provider fees.
// Cash collections and commissions are separate measures.
type Receipt={id:string;doctor_id:string|null;patient_id:string|null;subtotal:number|null;discount_amount:number|null;total:number|null;vat:number|null;gateway_fee:number|null;total_before_gateway_fee:number|null};
type Item={id:string;receipt_id:string;doctor_id:string|null;total:number|null;taxable_amount:number|null};
type Refund={receipt_item_id:string;refunded_treatment_amount:number|null;amount:number|null};
const cents=(value:unknown)=>Math.round(Number(value||0)*100);
export function doctorRevenue(receipts:Receipt[],items:Item[],refunds:Refund[],saleIds:Set<string>){
 const output=new Map<string,{netSales:number;receiptIds:Set<string>;patientIds:Set<string>}>();let unresolved=0;
 const byItem=new Map<string,{doctorId:string|null;receiptId:string;value:number}>();
 const add=(doctorId:string|null,amount:number,receipt?:Receipt)=>{if(!doctorId){if(amount)unresolved++;return;}const row=output.get(doctorId)||{netSales:0,receiptIds:new Set<string>(),patientIds:new Set<string>()};row.netSales+=amount/100;if(receipt){row.receiptIds.add(receipt.id);if(receipt.patient_id)row.patientIds.add(receipt.patient_id);}output.set(doctorId,row);};
 for(const receipt of receipts){
  const base=Math.max(0,receipt.subtotal!=null?cents(receipt.subtotal)-cents(receipt.discount_amount):cents(receipt.total_before_gateway_fee??Number(receipt.total||0)-Number(receipt.gateway_fee||0))-cents(receipt.vat));
  const lines=items.filter(item=>item.receipt_id===receipt.id).sort((a,b)=>a.id.localeCompare(b.id));
  if(!lines.length){if(saleIds.has(receipt.id))add(receipt.doctor_id,base,receipt);continue;}
  const weights=lines.map(line=>Math.max(0,cents(line.taxable_amount??line.total))),sum=weights.reduce((a,b)=>a+b,0);
  if(!sum){if(base)unresolved++;continue;}
  const values=weights.map(weight=>Math.floor(base*weight/sum));let left=base-values.reduce((a,b)=>a+b,0);
  const order=weights.map((weight,i)=>({i,remainder:base*weight/sum-values[i]})).sort((a,b)=>b.remainder-a.remainder||a.i-b.i);
  for(let i=0;left>0;i++,left--)values[order[i%order.length].i]++;
  for(let i=0;i<lines.length;i++){const line=lines[i],doctorId=line.doctor_id||receipt.doctor_id;byItem.set(line.id,{doctorId,receiptId:receipt.id,value:values[i]});if(saleIds.has(receipt.id))add(doctorId,values[i],receipt);}
 }
 for(const refund of refunds){const line=byItem.get(refund.receipt_item_id);if(!line){unresolved++;continue;}if(refund.refunded_treatment_amount==null){unresolved++;continue;}add(line.doctorId,-cents(refund.refunded_treatment_amount));}
 for(const row of output.values())row.netSales=Math.round(row.netSales*100)/100;
 return {rows:output,unresolved};
}
