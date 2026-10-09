// LOCALHOST ONLY. Retains labelled fake financial records to preserve audit history.
import fs from 'node:fs';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
const config=JSON.parse(fs.readFileSync(process.argv[2],'utf8').replace(/^\uFEFF/,''));assert.equal(config.API_URL,'http://127.0.0.1:54321');
const app='http://127.0.0.1:3001',clinic='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',rec='33333333-3333-4333-8333-333333333333';
const headers={apikey:config.SERVICE_ROLE_KEY,Authorization:`Bearer ${config.SERVICE_ROLE_KEY}`,'Content-Type':'application/json'},anon={apikey:config.ANON_KEY,Authorization:`Bearer ${config.ANON_KEY}`,'Content-Type':'application/json'};
const token=randomUUID(),foreign=randomUUID(),service=randomUUID(),tokens=[token,foreign];
let testManagerId;
async function db(path,init={}){const r=await fetch(`${config.API_URL}/rest/v1/${path}`,{...init,headers});assert.ok(r.ok,await r.clone().text());const text=await r.text();return text?JSON.parse(text):null;}
async function api(path,auth=token,body){return fetch(`${app}${path}`,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(auth?{Cookie:`app-auth=${auth}`}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'manual'});}
async function ok(response){assert.equal(response.status,200,await response.clone().text());return response.json();}
async function login(email,password,clinicId){const r=await api('/api/auth/staff-login',null,{email,password,clinicId});await ok(r);const value=r.headers.get('set-cookie').match(/app-auth=([^;]+)/)[1];tokens.push(value);return value;}
const post=(body,auth=token)=>api('/api/workspace/refunds',auth,body);
async function receipt(variant='cash'){
 const patient='77777777-7777-4777-8777-777777777777';const files=await db(`clinic_patient_files?patient_id=eq.${patient}&clinic_id=eq.${clinic}&select=id`);
 const doctors=await db(`doctors?clinic_id=eq.${clinic}&is_active=eq.true&select=id`);assert.ok(doctors.length);
 const id=randomUUID(),fee=variant==='tabby_standard'?15.75:0;
 const saved=await ok(await api('/api/receipts/checkout',token,{requestId:id,receipt:{clinic_id:clinic,patient_id:patient,patient_file_id:files[0].id,doctor_id:doctors[0].id,receptionist_id:rec,subtotal:200,vat:10,total:210+fee,total_before_gateway_fee:210,gateway_fee:fee,discount_amount:0,birthday_discount_amount:0,amount_paid:210+fee,credit_applied:0},items:[0,1].map(()=>({service_id:service,quantity:1,price:100,original_price:100,total:100,teeth:[],service_name_snapshot:'TEST REFUND APPROVAL',allocated_global_discount_amount:0,taxable_amount:100,vat_rate:0.05,vat_amount:5,final_line_total:105})),allocations:[{method_group:variant==='cash'?'cash':'tabby',method_variant:variant,treatment_net_amount:200,vat_amount:10,invoice_allocation_amount:210,fee_rate:fee?0.075:0,fee_amount:fee,customer_charged_amount:210+fee,provider_reference_number:fee?'TEST-'+id:null}],registerSessionId:(await db('cash_register_sessions?receptionist_id=eq.'+rec+'&closed_at=is.null&select=id'))[0].id}));
 const items=await db(`receipt_items?receipt_id=eq.${saved.receipt.id}&select=id`),payments=await db(`payment_records?receipt_id=eq.${saved.receipt.id}&select=id`),allocations=await db(`payment_allocations?payment_id=eq.${payments[0].id}&select=*`);
 return {id:saved.receipt.id,items:items.map(i=>i.id),allocation:allocations[0].id};
}
function draft(r,all=false){return {action:'request',receiptId:r.id,operationId:randomUUID(),reason:'TEST patient requested return',itemIds:all?r.items:[r.items[0]],allocationAmounts:{[r.allocation]:all?'210':'105'}};}
try{
 await db('services',{method:'POST',body:JSON.stringify({id:service,clinic_id:clinic,name:'TEST OLDER SALE REFUND',price:100,vat_rate:0.05,is_active:true})});
 await db('active_sessions',{method:'POST',body:JSON.stringify({token,session_mode:'clinic',user_role:'receptionist',clinic_id:clinic,receptionist_id:rec,created_at:new Date().toISOString()})});
 const owner=await login('owner.demo@local.test','LocalOwnerTestOnly!42');
 const saved=await receipt();
 const oldDate='2026-09-01T08:00:00Z';
 await db(`receipts?id=eq.${saved.id}`,{method:'PATCH',body:JSON.stringify({created_at:oldDate})});
 await db(`payment_records?receipt_id=eq.${saved.id}`,{method:'PATCH',body:JSON.stringify({created_at:oldDate})});
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Dubai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 async function dashboard(){return ok(await api('/api/reports/ceo-dashboard',owner,{period:'custom',customStart:day,customEnd:day,clinicId:clinic,includeHistoricalData:true}));}
 const before=await dashboard();
 const input=draft(saved,true);await ok(await post(input));await ok(await post({action:'approve',id:input.operationId},owner));await ok(await post({action:'execute',id:input.operationId,moneyReturned:true,reference:'TEST older-sale cash returned'}));
 const after=await dashboard();
 assert.ok(Math.abs(before.overview.customerCollections-after.overview.customerCollections)<0.011,'Older refund must not change gross collections today');
 assert.ok(Math.abs(before.overview.netSales-after.overview.netSales-210)<0.011,'Older refund must reduce today net by actual return');
 assert.ok(Math.abs(before.cashManagement.cashAfterDeductions-after.cashManagement.cashAfterDeductions-210)<0.011,'Older cash refund must reduce today cash');
 console.log('PASS: previous-month sale refunded today reduces today net/cash by AED 210, leaves gross collections unchanged and retains original sale.');
}finally{for(const t of tokens)await db(`active_sessions?token=eq.${t}`,{method:'DELETE'});await db(`services?id=eq.${service}`,{method:'PATCH',body:JSON.stringify({is_active:false})});}