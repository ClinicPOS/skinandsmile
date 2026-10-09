// LOCALHOST ONLY: labelled fake plans are retained as audit evidence.
import fs from 'node:fs';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
const config=JSON.parse(fs.readFileSync(process.argv[2],'utf8').replace(/^\uFEFF/,''));assert.equal(config.API_URL,'http://127.0.0.1:54321');
const clinic='11111111-1111-4111-8111-111111111111',patient='77777777-7777-4777-8777-777777777777';
const headers={apikey:config.SERVICE_ROLE_KEY,Authorization:`Bearer ${config.SERVICE_ROLE_KEY}`,'Content-Type':'application/json'};
async function db(path,init={}){const r=await fetch(`${config.API_URL}/rest/v1/${path}`,{...init,headers});assert.ok(r.ok,await r.clone().text());const text=await r.text();return text?JSON.parse(text):null;}
async function api(body,token){return fetch('http://127.0.0.1:3001/api/workspace/treatment-plan-cancellation',{method:'POST',headers:{'Content-Type':'application/json',...(token?{Cookie:`app-auth=${token}`}:{})},body:JSON.stringify(body)});}
const service=randomUUID(),empty=randomUUID(),paid=randomUUID();let token;
try{
 await db('services',{method:'POST',body:JSON.stringify({id:service,clinic_id:clinic,name:'TEST Cancel unused plan',price:100,vat_rate:0,is_active:true})});
 await db('treatment_plans',{method:'POST',body:JSON.stringify([{id:empty,clinic_id:clinic,patient_id:patient,service_id:service,title:'TEST unused plan cancelled with history',total_amount:100,planned_visits:3,status:'Active',is_legacy:false,historical_amount_paid:0},{id:paid,clinic_id:clinic,patient_id:patient,service_id:service,title:'TEST historical payment blocks cancellation',total_amount:100,planned_visits:3,status:'Active',is_legacy:true,historical_amount_paid:20}])});
 assert.equal((await api({planId:empty,reason:'TEST duplicate unused plan'})).status,401);
 const login=await fetch('http://127.0.0.1:3001/api/auth/staff-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'owner.demo@local.test',password:'LocalOwnerTestOnly!42'})});assert.equal(login.status,200);token=login.headers.get('set-cookie').match(/app-auth=([^;]+)/)[1];
 assert.equal((await api({planId:empty,reason:'x'},token)).status,400);
 const results=await Promise.all([api({planId:empty,reason:'TEST duplicate unused plan'},token),api({planId:empty,reason:'TEST duplicate unused plan'},token)]);for(const r of results)assert.equal(r.status,200,await r.clone().text());
 const [plan]=await db(`treatment_plans?id=eq.${empty}&select=status,total_amount,cancellation_reason,cancelled_by`);assert.equal(plan.status,'Cancelled');assert.equal(Number(plan.total_amount),100);assert.ok(plan.cancelled_by);assert.equal(plan.cancellation_reason,'TEST duplicate unused plan');
 const activity=await db(`activity_log?entity_id=eq.${empty}&action=eq.CANCEL_UNUSED_PLAN&select=id`);assert.equal(activity.length,1);
 assert.equal((await api({planId:paid,reason:'TEST do not erase historical payments'},token)).status,400);
 assert.equal((await db(`treatment_plans?id=eq.${paid}&select=status,historical_amount_paid`))[0].status,'Active');
 const latePayment=await fetch(`${config.API_URL}/rest/v1/treatment_plan_payments`,{method:'POST',headers,body:JSON.stringify({treatment_plan_id:empty,patient_id:patient,clinic_id:clinic,amount:10,payment_method:'Cash'})});assert.equal(latePayment.status,403);
 const anon={apikey:config.ANON_KEY,Authorization:`Bearer ${config.ANON_KEY}`};const privilege=await fetch(`${config.API_URL}/rest/v1/rpc/cancel_unused_treatment_plan`,{method:'POST',headers:{...anon,'Content-Type':'application/json'},body:JSON.stringify({p_plan_id:paid,p_account_id:plan.cancelled_by,p_reason:'TEST anonymous bypass'})});assert.notEqual(privilege.status,200);
 console.log('PASS: authenticated cancellation, concurrent retry once, retained amount and audit, paid-plan block, cancelled-plan payment block, anonymous RPC denial.');
}finally{if(token)await db(`active_sessions?token=eq.${token}`,{method:'DELETE'});await db(`services?id=eq.${service}`,{method:'PATCH',body:JSON.stringify({is_active:false})});}
