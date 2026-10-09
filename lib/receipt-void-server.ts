import 'server-only';
import {createProtectedDataClient} from './protected-data-server';
export async function prepareReceiptVoid(receiptId:string){
 const db=createProtectedDataClient();const {data:r,error}=await db.from('receipts').select('*').eq('id',receiptId).single();if(error)throw Error('Could not load receipt.');
 if(r.status==='VOIDED')throw Error('Receipt is already voided.');
 const today=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Dubai'});if(new Date(r.created_at).toLocaleDateString('en-CA',{timeZone:'Asia/Dubai'})!==today)throw Error('Earlier-day receipts need owner reconciliation.');
 const fingerprint=await db.rpc('receipt_refund_fingerprint',{p_receipt_id:receiptId});if(fingerprint.error)throw Error('Could not verify receipt.');
 return {kind:'VOID',total:Number(r.total),invoice:Number(r.total),fingerprint:fingerprint.data,method:'Cancel mistaken receipt and its recorded payment entry; no refund',items:[{service_name:'Whole receipt',refunded_invoice_amount:Number(r.total)}]};
}
