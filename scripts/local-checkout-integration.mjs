// Real localhost checkout integration; creates and removes only isolated fake fixtures.
import fs from 'node:fs'; import assert from 'node:assert/strict'; import {randomUUID} from 'node:crypto';
import { verifyCheckoutScreen } from './checkout-ui-harness.mjs';
import { execFileSync } from 'node:child_process';
const status=JSON.parse(fs.readFileSync(process.argv[2],'utf8').replace(/^\uFEFF/,'')); assert.equal(status.API_URL,'http://127.0.0.1:54321');
const clinic='11111111-1111-4111-8111-111111111111', other='22222222-2222-4222-8222-222222222222';
const receptionist='33333333-3333-4333-8333-333333333333';
const patient=randomUUID(),file=randomUUID(),service=randomUUID(),token=randomUUID(),reports=randomUUID(); const requests=[];
const headers={apikey:status.SERVICE_ROLE_KEY,Authorization:`Bearer ${status.SERVICE_ROLE_KEY}`,'Content-Type':'application/json'};
async function db(path,options={}) {const r=await fetch(`${status.API_URL}/rest/v1/${path}`,{...options,headers}); assert.ok(r.ok,`Local DB failed ${r.status}: ${path.split('?')[0]}`); return r;}
let doctorId,registerId;
const insert=(table,row)=>db(table,{method:'POST',body:JSON.stringify(row)});
async function checkout(body,cookie=token) {return fetch('http://127.0.0.1:3001/api/receipts/checkout',{method:'POST',headers:{'Content-Type':'application/json',...(cookie?{Cookie:`app-auth=${cookie}`}:{})},body:JSON.stringify(body)});}
function body({paid=105,credit=0,variant='cash',reference=null,discount=0}={}) {
 const id=randomUUID(); requests.push(id); const total=105-discount*1.05; const vat=5-discount*0.05; const paidVat=Math.round(vat*paid/total*100)/100;
 const group=variant.startsWith('tabby')?'tabby':variant==='tamara'?'tamara':variant; const fee=['tabby','tamara'].includes(group)?Math.round(paid*0.075*100)/100:0;
 return {requestId:id,receipt:{clinic_id:clinic,patient_id:patient,patient_file_id:file,doctor_id:doctorId,receptionist_id:receptionist,subtotal:100,vat,total:total+fee,total_before_gateway_fee:total,gateway_fee:fee,discount_amount:discount,birthday_discount_amount:0,amount_paid:paid+fee,credit_applied:credit},items:[{service_id:service,quantity:1,price:100,original_price:100,total:100,teeth:[],service_name_snapshot:'TEST CHECKOUT',allocated_global_discount_amount:discount,taxable_amount:100-discount,vat_rate:0.05,vat_amount:vat,final_line_total:total}],allocations:paid>0?[{method_group:group,method_variant:variant,treatment_net_amount:paid-paidVat,vat_amount:paidVat,invoice_allocation_amount:paid,fee_rate:fee?0.075:0,fee_amount:fee,customer_charged_amount:paid+fee,provider_reference_number:reference}]:[],registerSessionId:registerId};
}
async function run(b){const r=await checkout(b);assert.equal(r.status,200,`Expected checkout success, got ${r.status}: ${JSON.stringify(await r.clone().json())}`);return r.json();}
try {
 doctorId=(await(await db('doctors?clinic_id=eq.'+clinic+'&is_active=eq.true&select=id&limit=1')).json())[0].id;
 registerId=(await(await db('cash_register_sessions?receptionist_id=eq.'+receptionist+'&closed_at=is.null&select=id')).json())[0].id;
 await insert('patients',{id:patient,name:'TEST CHECKOUT '+patient,phone:'0000000000'});
 await insert('clinic_patient_files',{id:file,clinic_id:clinic,patient_id:patient,file_no:'TEST-'+file});
 await insert('services',{id:service,clinic_id:clinic,name:'TEST CHECKOUT',price:100,vat_rate:0.05,is_active:true});
 for(const row of [{token,session_mode:'clinic',clinic_id:clinic,user_role:'receptionist',receptionist_id:receptionist},{token:reports,session_mode:'reports',clinic_id:null,user_role:'reports',receptionist_id:null}]) await insert('active_sessions',{...row,created_at:new Date().toISOString()});
 assert.equal((await checkout(body(),null)).status,401); assert.equal((await checkout(body(),reports)).status,403);
 const wrong=body();wrong.receipt.clinic_id=other;assert.equal((await checkout(wrong)).status,403);
 const bad=body();bad.items[0].vat_amount=0;assert.equal((await checkout(bad)).status,400);
 const wrongDoctor=body();wrongDoctor.receipt.doctor_id='66666666-6666-4666-8666-666666666666';assert.equal((await checkout(wrongDoctor)).status,403);
 const full=body();const responses=await Promise.all([checkout(full),checkout(full)]);assert.ok(responses.every(r=>r.status===200));const saved=await responses[0].json(); const repeated=await responses[1].json();assert.equal(saved.receipt.id,repeated.receipt.id);assert.ok(saved.replayed||repeated.replayed);
 const records=await(await db(`payment_records?receipt_id=eq.${saved.receipt.id}&select=id`)).json();assert.equal(records.length,1);
 const lookup=await fetch(`http://127.0.0.1:3001/api/receipts/checkout?requestId=${full.requestId}`,{headers:{Cookie:`app-auth=${token}`}});
 assert.equal(lookup.status,200); assert.equal((await lookup.json()).receipt.id,saved.receipt.id);
 assert.equal((await fetch(`http://127.0.0.1:3001/api/receipts/checkout?requestId=${full.requestId}`)).status,401);
 assert.equal((await fetch(`http://127.0.0.1:3001/api/receipts/checkout?requestId=${full.requestId}`,{headers:{Cookie:`app-auth=${reports}`}})).status,403);
 const changed=structuredClone(full);changed.receipt.doctor_id=null;assert.equal((await checkout(changed)).status,409);
 const partial=await run(body({paid:50}));assert.equal(Number(partial.balance.original_amount),55);assert.equal(Number(partial.receipt.amount_paid),50);
 await insert('patient_credits',{patient_id:patient,clinic_id:clinic,amount:10,reason:'TEST CHECKOUT'});
 const creditRequest=body({paid:95,credit:10}); const competing=body({paid:95,credit:10}); const creditResponses=await Promise.all([checkout(creditRequest),checkout(competing)]); assert.deepEqual(creditResponses.map(r=>r.status).sort(),[200,409]);
 const ledger=await(await db(`patient_credits?patient_id=eq.${patient}&select=amount`)).json();assert.equal(ledger.reduce((s,r)=>s+Number(r.amount),0),0);
 const reference='TEST-'+randomUUID(); const bnpl=await run(body({variant:'tabby_standard',reference})); assert.equal(Number(bnpl.receipt.gateway_fee),7.88);assert.equal(Number(bnpl.receipt.total),112.88);
  const failRequest=body({variant:'tabby_standard',reference});
  failRequest.allocations=[0,1].map(()=>({...failRequest.allocations[0],treatment_net_amount:50,vat_amount:2.5,invoice_allocation_amount:52.5,fee_amount:3.94,customer_charged_amount:56.44}));
  assert.equal((await checkout(failRequest)).status,409);
 assert.equal((await(await db(`receipts?id=eq.${failRequest.requestId}&select=id`)).json()).length,0,'Failed allocation must roll back receipt');
 assert.equal((await(await db(`receipt_items?receipt_id=eq.${failRequest.requestId}&select=id`)).json()).length,0);
 assert.equal((await(await db(`pos_checkout_requests?id=eq.${failRequest.requestId}&select=id`)).json()).length,0);
 await run(body({paid:94.50,discount:10}));
 await run(body({variant:'bank_transfer'}));
 await insert('patient_credits',{patient_id:patient,clinic_id:clinic,amount:105,reason:'TEST CREDIT ONLY'});
 const creditOnly=await run(body({paid:0,credit:105}));assert.equal(creditOnly.paymentRecordId,null);assert.equal(creditOnly.balance,null);assert.equal(Number(creditOnly.receipt.amount_paid),0);
 const split=body();split.allocations=[{...split.allocations[0],invoice_allocation_amount:60,vat_amount:2.86,treatment_net_amount:57.14,customer_charged_amount:60},{...split.allocations[0],method_group:'card',method_variant:'card',invoice_allocation_amount:45,vat_amount:2.14,treatment_net_amount:42.86,customer_charged_amount:45}];
 await run(split);
 requests.push(await verifyCheckoutScreen({patient,file,service,clinic,receptionist,token,doctorId,registerId}));
 execFileSync(process.execPath,['scripts/local-eod-export-integration.mjs',process.argv[2]],{stdio:'inherit',env:{...process.env,LOCAL_EOD_FIXTURE_PATIENT:patient,LOCAL_EOD_REPORT_DAY:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Dubai'}).format(new Date())}});
 const anon={apikey:status.ANON_KEY,Authorization:`Bearer ${status.ANON_KEY}`,'Content-Type':'application/json'};
 const denied=await fetch(`${status.API_URL}/rest/v1/rpc/complete_pos_checkout`,{method:'POST',headers:anon,body:JSON.stringify({p_request_id:randomUUID(),p_payload:{}})});assert.ok([401,403,404].includes(denied.status));
 console.log('PASS: checkout ownership, amount/VAT validation, full and partial payment, discount, bank transfer, BNPL fee, duplicate-reference rollback, concurrent retry and credit double-spend prevention.');
} finally {
 // Retain labelled financial fixtures and their links for audit/retry verification.
 await db(`services?id=eq.${service}`,{method:'PATCH',body:JSON.stringify({is_active:false})});
 for(const id of [token,reports]) await db(`active_sessions?token=eq.${id}`,{method:'DELETE'});
}
