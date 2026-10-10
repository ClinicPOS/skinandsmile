// Fake local financial entries are retained as audit fixtures.
import fs from 'node:fs';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
const c=JSON.parse(fs.readFileSync(process.argv[2],'utf8').replace(/^\uFEFF/,''));assert.equal(c.API_URL,'http://127.0.0.1:54321');
const headers={apikey:c.SERVICE_ROLE_KEY,Authorization:`Bearer ${c.SERVICE_ROLE_KEY}`,'Content-Type':'application/json'};
const rec=randomUUID(),token=randomUUID(),register=randomUUID(),clinic='11111111-1111-4111-8111-111111111111',patient='77777777-7777-4777-8777-777777777777';let owner;
async function db(path,init={}){const r=await fetch(c.API_URL+'/rest/v1/'+path,{...init,headers});assert.ok(r.ok,await r.clone().text());const t=await r.text();return t?JSON.parse(t):null;}
async function post(body,auth=token,path='/api/pos-entries'){return fetch('http://127.0.0.1:3001'+path,{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Cookie:`app-auth=${auth}`}:{})},body:JSON.stringify(body)});}
try{
 await db('receptionist',{method:'POST',body:JSON.stringify({id:rec,clinic_id:clinic,name:'TEST entry audit fixture (not for login)',pin:randomUUID()})});
 await db('cash_register_sessions',{method:'POST',body:JSON.stringify({id:register,receptionist_id:rec,opening_cash:0,opened_at:new Date().toISOString()})});
 await db('active_sessions',{method:'POST',body:JSON.stringify({token,session_mode:'clinic',user_role:'receptionist',clinic_id:clinic,receptionist_id:rec,created_at:new Date().toISOString()})});
 const plan={requestId:randomUUID(),kind:'plan',data:{patient_id:patient,clinic_id:clinic,title:'TEST protected legacy plan',total_amount:200,planned_visits:4,is_legacy:true,historical_amount_paid:50,historical_visits:2,historical_visit_date:'2026-10-01'}};
 assert.equal((await post(plan,null)).status,401);
 assert.equal((await post({...plan,data:{...plan.data,clinic_id:'22222222-2222-4222-8222-222222222222'}})).status,403);
 assert.equal((await post({...plan,data:{...plan.data,patient_id:'99999999-9999-4999-8999-999999999999'}})).status,409);
 assert.equal((await post({...plan,data:{...plan.data,historical_amount_paid:201}})).status,400);
 for(const r of await Promise.all([post(plan),post(plan)]))assert.equal(r.status,200,await r.clone().text());
 assert.equal((await db(`treatment_plans?id=eq.${plan.requestId}&select=id`)).length,1);
 assert.equal((await db(`treatment_plan_visits?treatment_plan_id=eq.${plan.requestId}&select=id`)).length,2);
 assert.equal((await post({...plan,data:{...plan.data,title:'Changed'}})).status,409);
 const freshPlan={requestId:randomUUID(),kind:'plan',data:{patient_id:patient,clinic_id:clinic,title:'TEST new five-visit plan',total_amount:200,planned_visits:5}};
 assert.equal((await post(freshPlan)).status,200);
 assert.equal((await db(`treatment_plan_visits?treatment_plan_id=eq.${freshPlan.requestId}&select=id`)).length,0,'New plans start with zero visits');
 const visitDoctor=randomUUID();
 await db('doctors',{method:'POST',body:JSON.stringify({id:visitDoctor,clinic_id:clinic,name:'TEST five-visit doctor',is_active:true})});
 for(let count=1;count<=5;count++){
  const response=await post({treatmentPlanId:freshPlan.requestId,requestId:randomUUID(),doctorId:visitDoctor,notes:'TEST saved visit '+count},token,'/api/treatment-plan-visits');
  assert.equal(response.status,200,await response.clone().text());const saved=await response.json();
  assert.equal(saved.completedVisits,count);assert.equal(saved.visit.visit_number,count);assert.equal(saved.visit.doctor_id,visitDoctor);
  assert.equal(saved.plan.status,count===5?'Completed':'Active');
 }
 assert.equal((await post({treatmentPlanId:freshPlan.requestId,requestId:randomUUID(),doctorId:visitDoctor},token,'/api/treatment-plan-visits')).status,409);
 await db(`doctors?id=eq.${visitDoctor}`,{method:'PATCH',body:JSON.stringify({is_active:false})});
 const deposit={requestId:randomUUID(),kind:'deposit',data:{patient_id:patient,clinic_id:clinic,amount:50,register_session_id:register,payment_method:'Cash',reason:'TEST protected deposit'}};
 for(const r of await Promise.all([post(deposit),post(deposit)]))assert.equal(r.status,200,await r.clone().text());
 assert.equal((await db(`patient_credits?id=eq.${deposit.requestId}&select=id`)).length,1);
 assert.equal((await post({...deposit,requestId:randomUUID(),data:{...deposit.data,amount:-1}})).status,400);
 const balance={requestId:randomUUID(),kind:'legacy_balance',data:{patient_id:patient,clinic_id:clinic,original_amount:20,original_date:'2026-10-01',reason:'TEST historical balance'}};
 assert.equal((await post(balance)).status,403);
 const login=await post({email:'owner.demo@local.test',password:'LocalOwnerTestOnly!42'},null,'/api/auth/staff-login');assert.equal(login.status,200);owner=login.headers.get('set-cookie').match(/app-auth=([^;]+)/)[1];
 assert.equal((await post(balance,owner)).status,200);
 assert.equal((await db(`activity_log?entity_id=in.(${plan.requestId},${deposit.requestId},${balance.requestId})&action=in.(CREATE_PLAN,CREATE_DEPOSIT,CREATE_LEGACY_BALANCE)&select=id`)).length,3);
 await db(`cash_register_sessions?id=eq.${register}`,{method:'PATCH',body:JSON.stringify({closed_at:new Date().toISOString()})});
 assert.equal((await post({...deposit,requestId:randomUUID()})).status,409);
 console.log('PASS: atomic plan and historical visits, deposit retries once, actor/patient/clinic validation, owner-only legacy balance, recorded audit and closed-register denial.');
}finally{for(const t of [token,owner].filter(Boolean))await db(`active_sessions?token=eq.${t}`,{method:'DELETE'});await db(`cash_register_sessions?id=eq.${register}`,{method:'PATCH',body:JSON.stringify({closed_at:new Date().toISOString()})});}
