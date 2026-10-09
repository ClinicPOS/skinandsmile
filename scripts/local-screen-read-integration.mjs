// Local fake records only. Uses server cookies, not database access tokens.
import fs from 'node:fs';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
const c=JSON.parse(fs.readFileSync(process.argv[2],'utf8').replace(/^\uFEFF/,''));assert.equal(c.API_URL,'http://127.0.0.1:54321');
const headers={apikey:c.SERVICE_ROLE_KEY,Authorization:`Bearer ${c.SERVICE_ROLE_KEY}`,'Content-Type':'application/json'};
const token=randomUUID(),clinic='11111111-1111-4111-8111-111111111111',foreign='22222222-2222-4222-8222-222222222222';
async function db(path,init={}){const r=await fetch(c.API_URL+'/rest/v1/'+path,{...init,headers});assert.ok(r.ok,await r.clone().text());const text=await r.text();return text?JSON.parse(text):null;}
async function read(table,query='select=*',auth=token){return fetch('http://127.0.0.1:3001/api/pos-read',{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Cookie:`app-auth=${auth}`}:{})},body:JSON.stringify({table,query})});}
const tables=['receipts','receipt_items','refunds','refund_items','payment_records','payment_allocations','payment_allocation_refunds','outstanding_balances','balance_payments','patient_credits','treatment_plans','treatment_plan_visits','treatment_plan_payments','treatment_plan_payment_records','treatment_plan_payment_allocations','cash_register_sessions','cash_deductions','birthday_greetings','service_favorites','patient_treatment_visits','receptionist','doctors','services','clinics'];
try{
 await db('active_sessions',{method:'POST',body:JSON.stringify({token,session_mode:'clinic',user_role:'receptionist',clinic_id:clinic,receptionist_id:'33333333-3333-4333-8333-333333333333',created_at:new Date().toISOString()})});
 assert.equal((await read('receipts','select=*',null)).status,401);
 assert.equal((await read('active_sessions')).status,400);
 assert.equal((await read('receptionist','select=pin')).status,403);
 assert.equal((await read('receipts','select=*,receptionist(*)')).status,403);
 assert.equal((await read('receipts','select=*,patients(clinic_patient_files(*))')).status,403);
 assert.equal((await read('clinics','select=*,clinic_memberships(*)')).status,403);
 assert.equal((await read('receptionist','select=*,cash_register_sessions(*)')).status,403);
 for(const table of tables){const r=await read(table);assert.equal(r.status,200,`${table}: ${await r.clone().text()}`);const rows=await r.json();assert.ok(rows.every(row=>!row.__scope&&!row.pin));}
 for(const table of ['receipts','treatment_plans','patient_credits','payment_records']){const r=await read(table,`select=*&clinic_id=eq.${foreign}`);assert.equal(r.status,200);assert.deepEqual(await r.json(),[]);}
 const clinics=await read('clinics','select=id,name',null);assert.equal(clinics.status,200);
 console.log('PASS: protected reads for 24 screen tables, clinic filtering, unauthenticated financial denial, private-field denial and public clinic names only.');
}finally{await db(`active_sessions?token=eq.${token}`,{method:'DELETE'});}
