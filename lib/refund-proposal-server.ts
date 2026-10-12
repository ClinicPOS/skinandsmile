import 'server-only';
import {createProtectedDataClient} from './protected-data-server';
import {buildAllocationRefundRequests,buildSnapshotRefundItemRows,classifyReceiptSnapshotStatus,getReceiptItemRefundSnapshot,getReceiptItemRemainingRefundable,getRefundableFeeAmount} from './receipt-refunds';
import {roundCurrency} from './money';
import type {PaymentAllocation} from './types';
export async function prepareRefundProposal(receiptId:string,itemIds:string[],amounts:Record<string,string>){
 const db=createProtectedDataClient();
 const initial=await db.rpc('receipt_refund_fingerprint',{p_receipt_id:receiptId});if(initial.error)throw Error('Could not verify receipt.');
 const results=await Promise.all([db.from('receipt_items').select('*').eq('receipt_id',receiptId),db.from('refunds').select('id').is("accounting_void_request_id", null).eq('receipt_id',receiptId),db.from('payment_records').select('id').eq('receipt_id',receiptId)]);
 for(const result of results)if(result.error)throw Error('Could not load original refund records.');
 const [items,refunds,payments]=results.map(r=>r.data||[]);
 if(classifyReceiptSnapshotStatus(items)!=='snapshot')throw Error('This older receipt needs a reviewed historical refund calculation. Automatic refund is blocked.');
 const previous=refunds.length?await db.from('refund_items').select('*').in('refund_id',refunds.map(r=>r.id)):{data:[],error:null};
 const allocations=payments.length?await db.from('payment_allocations').select('*').in('payment_id',payments.map(r=>r.id)):{data:[],error:null};
 if(previous.error||allocations.error)throw Error('Could not load payment history.');
 if(!itemIds.length||new Set(itemIds).size!==itemIds.length||itemIds.some(id=>!items.some(i=>i.id===id)))throw Error('Select valid receipt items.');
 const rows=buildSnapshotRefundItemRows(itemIds.map(id=>{const item=items.find(i=>i.id===id)!;const snapshot=getReceiptItemRefundSnapshot(item)!;const remaining=getReceiptItemRemainingRefundable(snapshot,previous.data||[]);if(remaining.isFullyRefunded)throw Error('An item is already fully refunded.');return {snapshot,remaining,serviceId:item.service_id};}));
 const invoice=roundCurrency(rows.reduce((sum,row)=>sum+Number(row.refunded_invoice_amount),0));
 if(Object.keys(amounts).some(id=>!(allocations.data||[]).some(a=>a.id===id)))throw Error('Invalid payment allocation.');
 const built=buildAllocationRefundRequests({allocations:(allocations.data||[]) as PaymentAllocation[],selectedAllocationIds:Object.keys(amounts),requestedAmountsByAllocationId:amounts,expectedRefundAmount:invoice});
 if(built.error)throw Error(built.error);
 const treatment=roundCurrency(rows.reduce((sum,row)=>sum+Number(row.refunded_treatment_amount),0));
 if(Math.abs(treatment-built.requests.reduce((sum,r)=>sum+r.refundedTreatmentAmount,0))>0.01)throw Error('The payment VAT split does not match the selected services. Ask the owner to review.');
 const total=roundCurrency(built.requests.reduce((sum,r)=>sum+r.requestedInvoiceAmount+getRefundableFeeAmount(r.allocation,r.requestedInvoiceAmount),0));
 const final=await db.rpc('receipt_refund_fingerprint',{p_receipt_id:receiptId});if(final.error||initial.data!==final.data)throw Error('Receipt changed while preparing refund. Reload and try again.');
 return {total,invoice,fingerprint:initial.data,items:rows,allocations:built.requests.map(r=>({id:r.allocation.id,treatment:r.refundedTreatmentAmount,vat:r.refundedVatAmount,method:r.allocation.method_variant})),method:built.requests.map(r=>r.allocation.method_variant).join(', ')};
}
