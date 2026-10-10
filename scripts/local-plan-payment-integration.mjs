// LOCALHOST ONLY. Fake payment records remain for audit; temporary register is closed.
import fs from 'node:fs';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
const config=JSON.parse(fs.readFileSync(process.argv[2],'utf8').replace(/^\uFEFF/,''));assert.equal(config.API_URL,'http://127.0.0.1:54321');
const clinic='11111111-1111-4111-8111-111111111111',rec=randomUUID(),patient='77777777-7777-4777-8777-777777777777',balance=randomUUID(),register=randomUUID(),token=randomUUID(),foreign=randomUUID();
const headers={apikey:config.SERVICE_ROLE_KEY,Authorization:`Bearer ${config.SERVICE_ROLE_KEY}`,'Content-Type':'application/json'};
async function db(path,init={}){const r=await fetch(`${config.API_URL}/rest/v1/${path}`,{...init,headers});assert.ok(r.ok,await r.clone().text());const text=await r.text();return text?JSON.parse(text):null;}
async function pay(body,auth=token){return fetch('http://127.0.0.1:3001/api/treatment-plan-payments',{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Cookie:`app-auth=${auth}`}:{})},body:JSON.stringify({requestId:body.requestId,args:{p_treatment_plan_id:balance,p_register_session_id:register,p_allocations:[{method_variant:'cash',invoice_allocation_amount:body.amount,fee_amount:999,customer_charged_amount:999}],p_clinic_id:'22222222-2222-4222-8222-222222222222'}})});}
const payment={requestId:randomUUID(),balanceId:balance,registerSessionId:register,amount:50,method:'Cash',notes:'TEST atomic balance payment'};
try{
 await db('receptionist',{method:'POST',body:JSON.stringify({id:rec,clinic_id:clinic,name:'TEST balance audit fixture (not for login)',pin:randomUUID()})});
 await db('cash_register_sessions',{method:'POST',body:JSON.stringify({id:register,receptionist_id:rec,opened_at:new Date().toISOString(),opening_cash:0})});
 await db('treatment_plans',{method:'POST',body:JSON.stringify({id:balance,clinic_id:clinic,patient_id:patient,title:'TEST protected plan payment',total_amount:200,planned_visits:3,status:'Active'})});
 await db('active_sessions',{method:'POST',body:JSON.stringify([{token,session_mode:'clinic',user_role:'receptionist',clinic_id:clinic,receptionist_id:rec,created_at:new Date().toISOString()},{token:foreign,session_mode:'clinic',user_role:'receptionist',clinic_id:'22222222-2222-4222-8222-222222222222',receptionist_id:'44444444-4444-4444-8444-444444444444',created_at:new Date().toISOString()}])});
 assert.equal((await pay(payment,null)).status,401);assert.equal((await pay(payment,foreign)).status,403);
 assert.equal((await pay({...payment,amount:201})).status,409);
 for(const response of await Promise.all([pay(payment),pay(payment)]))assert.equal(response.status,200,await response.clone().text());
 assert.equal((await db(`treatment_plan_payment_records?treatment_plan_id=eq.${balance}&select=id`)).length,1);
 assert.equal((await pay({...payment,amount:51})).status,409);
 const concurrent=await Promise.all([pay({...payment,requestId:randomUUID(),amount:80}),pay({...payment,requestId:randomUUID(),amount:80})]);assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,409]);
 const rows=await db(`treatment_plan_payment_records?treatment_plan_id=eq.${balance}&select=total_invoice_amount_settled`);assert.equal(rows.reduce((sum,r)=>sum+Number(r.total_invoice_amount_settled),0),130);

 assert.equal((await db(`treatment_plan_visits?treatment_plan_id=eq.${balance}&select=id`)).length,0,'Payments do not create visits');
 assert.equal((await db(`activity_log?actor_id=eq.${rec}&action=eq.COLLECT_PLAN_PAYMENT&select=id`)).length,2);
 const anon={apikey:config.ANON_KEY,Authorization:`Bearer ${config.ANON_KEY}`,'Content-Type':'application/json'};const direct=await fetch(`${config.API_URL}/rest/v1/rpc/create_treatment_plan_payment_record_with_allocations`,{method:'POST',headers:anon,body:JSON.stringify({})});assert.notEqual(direct.status,200);
 const allocations=await db(`treatment_plan_payment_allocations?payment_id=in.(${(await db('treatment_plan_payment_records?treatment_plan_id=eq.'+balance+'&select=id')).map(r=>r.id).join(',')})&select=fee_amount,customer_charged_amount`);assert.ok(allocations.every(r=>Number(r.fee_amount)===0));assert.equal(allocations.reduce((sum,r)=>sum+Number(r.customer_charged_amount),0),130);
 await db(`cash_register_sessions?id=eq.${register}`,{method:'PATCH',body:JSON.stringify({closed_at:new Date().toISOString(),closing_cash:130})});
 assert.equal((await pay({...payment,requestId:randomUUID(),amount:1})).status,409);
 console.log('PASS: receptionist/clinic/register verification, amount limit, same-request retry once, concurrent overpayment prevention, retained audit, anonymous insert denial and closed-register block.');
}finally{for(const t of [token,foreign])await db(`active_sessions?token=eq.${t}`,{method:'DELETE'});await db(`cash_register_sessions?id=eq.${register}`,{method:'PATCH',body:JSON.stringify({closed_at:new Date().toISOString()})});}
