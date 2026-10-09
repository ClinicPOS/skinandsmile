// LOCALHOST ONLY. Fake payment records remain for audit; temporary register is closed.
import fs from 'node:fs';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
const config=JSON.parse(fs.readFileSync(process.argv[2],'utf8').replace(/^\uFEFF/,''));assert.equal(config.API_URL,'http://127.0.0.1:54321');
const clinic='11111111-1111-4111-8111-111111111111',rec=randomUUID(),patient='77777777-7777-4777-8777-777777777777',balance=randomUUID(),register=randomUUID(),token=randomUUID(),foreign=randomUUID();
const headers={apikey:config.SERVICE_ROLE_KEY,Authorization:`Bearer ${config.SERVICE_ROLE_KEY}`,'Content-Type':'application/json'};
async function db(path,init={}){const r=await fetch(`${config.API_URL}/rest/v1/${path}`,{...init,headers});assert.ok(r.ok,await r.clone().text());const text=await r.text();return text?JSON.parse(text):null;}
async function pay(body,auth=token){return fetch('http://127.0.0.1:3001/api/balance-payments',{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Cookie:`app-auth=${auth}`}:{})},body:JSON.stringify(body)});}
const payment={requestId:randomUUID(),balanceId:balance,registerSessionId:register,amount:50,method:'Cash',notes:'TEST atomic balance payment'};
try{
 await db('receptionist',{method:'POST',body:JSON.stringify({id:rec,clinic_id:clinic,name:'TEST balance audit fixture (not for login)',pin:randomUUID()})});
 await db('cash_register_sessions',{method:'POST',body:JSON.stringify({id:register,receptionist_id:rec,opened_at:new Date().toISOString(),opening_cash:0})});
 await db('outstanding_balances',{method:'POST',body:JSON.stringify({id:balance,clinic_id:clinic,patient_id:patient,original_date:'2020-01-01',original_amount:200,reason:'TEST balance payment race checks',created_by:rec})});
 await db('active_sessions',{method:'POST',body:JSON.stringify([{token,session_mode:'clinic',user_role:'receptionist',clinic_id:clinic,receptionist_id:rec,created_at:new Date().toISOString()},{token:foreign,session_mode:'clinic',user_role:'receptionist',clinic_id:'22222222-2222-4222-8222-222222222222',receptionist_id:'44444444-4444-4444-8444-444444444444',created_at:new Date().toISOString()}])});
 assert.equal((await pay(payment,null)).status,401);assert.equal((await pay(payment,foreign)).status,409);
 assert.equal((await pay({...payment,amount:201})).status,409);
 for(const response of await Promise.all([pay(payment),pay(payment)]))assert.equal(response.status,200,await response.clone().text());
 assert.equal((await db(`balance_payments?outstanding_balance_id=eq.${balance}&select=id`)).length,1);
 assert.equal((await pay({...payment,amount:51})).status,409);
 const concurrent=await Promise.all([pay({...payment,requestId:randomUUID(),amount:80}),pay({...payment,requestId:randomUUID(),amount:80})]);assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,409]);
 const rows=await db(`balance_payments?outstanding_balance_id=eq.${balance}&select=amount`);assert.equal(rows.reduce((sum,r)=>sum+Number(r.amount),0),130);
 const retryAfterOtherPayment=await pay(payment);assert.equal(retryAfterOtherPayment.status,200);assert.equal((await retryAfterOtherPayment.json()).remainingAfter,70,'A retry after another payment must return the actual current balance');
 assert.equal((await db(`activity_log?entity_id=eq.${payment.requestId}&action=eq.COLLECT_BALANCE&select=id`)).length,1);
 const anon={apikey:config.ANON_KEY,Authorization:`Bearer ${config.ANON_KEY}`,'Content-Type':'application/json'};const direct=await fetch(`${config.API_URL}/rest/v1/balance_payments`,{method:'POST',headers:anon,body:JSON.stringify({outstanding_balance_id:balance,amount:1,payment_method:'Cash',receptionist_id:rec,register_session_id:register})});assert.equal(direct.status,401);
 await db(`cash_register_sessions?id=eq.${register}`,{method:'PATCH',body:JSON.stringify({closed_at:new Date().toISOString(),closing_cash:130})});
 assert.equal((await pay({...payment,requestId:randomUUID(),amount:1})).status,409);
 console.log('PASS: receptionist/clinic/register verification, amount limit, same-request retry once, concurrent overpayment prevention, retained audit, anonymous insert denial and closed-register block.');
}finally{for(const t of [token,foreign])await db(`active_sessions?token=eq.${t}`,{method:'DELETE'});await db(`cash_register_sessions?id=eq.${register}`,{method:'PATCH',body:JSON.stringify({closed_at:new Date().toISOString()})});}
