// Local fake data only: authorization, retries and simultaneous visit completion.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const config=JSON.parse(fs.readFileSync(process.argv[2],'utf8').replace(/^\uFEFF/,''));
assert.equal(config.API_URL,'http://127.0.0.1:54321');
const app='http://127.0.0.1:3001';
const headers={apikey:config.SERVICE_ROLE_KEY,Authorization:`Bearer ${config.SERVICE_ROLE_KEY}`,'Content-Type':'application/json'};
const clinic='11111111-1111-4111-8111-111111111111', other='22222222-2222-4222-8222-222222222222';
const receptionist='33333333-3333-4333-8333-333333333333', foreignDoctor='66666666-6666-4666-8666-666666666666';
const planId=randomUUID(), token=randomUUID(), reportsToken=randomUUID(), otherToken=randomUUID();
const doctorOne=randomUUID(),doctorTwo=randomUUID(),multiPlan=randomUUID();
const fileId=(await (await fetch(`${config.API_URL}/rest/v1/clinic_patient_files?patient_id=eq.77777777-7777-4777-8777-777777777777&clinic_id=eq.${clinic}&select=id`,{headers})).json())[0].id;
async function db(path, options={}) { const r=await fetch(`${config.API_URL}/rest/v1/${path}`,{...options,headers}); assert.ok(r.ok,`Local DB request failed ${r.status}`); return r; }
async function visit(id, overrides={}, session=token) { return fetch(`${app}/api/treatment-plan-visits`,{method:'POST',headers:{'Content-Type':'application/json',...(session?{Cookie:`app-auth=${session}`}:{})},body:JSON.stringify({treatmentPlanId:planId,requestId:id,doctorId:doctorOne,notes:'TEST atomic visit',...overrides})}); }
try {
  await db('doctors',{method:'POST',body:JSON.stringify([{id:doctorOne,clinic_id:clinic,name:'TEST Visit Doctor One',is_active:true},{id:doctorTwo,clinic_id:clinic,name:'TEST Visit Doctor Two',is_active:true}])});
  await db('treatment_plans',{method:'POST',body:JSON.stringify({id:multiPlan,patient_id:'77777777-7777-4777-8777-777777777777',clinic_id:clinic,clinic_patient_file_id:fileId,title:'TEST Different Visit Doctors '+multiPlan,total_amount:0,planned_visits:3,created_by:receptionist})});
  await db('treatment_plans',{method:'POST',body:JSON.stringify({id:planId,patient_id:'77777777-7777-4777-8777-777777777777',clinic_id:clinic,clinic_patient_file_id:fileId,title:'TEST ATOMIC VISIT '+planId,total_amount:0,planned_visits:1,created_by:receptionist})});
  await db('active_sessions',{method:'POST',body:JSON.stringify([
    {token,session_mode:'clinic',clinic_id:clinic,user_role:'receptionist',receptionist_id:receptionist},
    {token:reportsToken,session_mode:'reports',clinic_id:null,user_role:'reports',receptionist_id:null},
    {token:otherToken,session_mode:'clinic',clinic_id:other,user_role:'receptionist',receptionist_id:'44444444-4444-4444-8444-444444444444'}
  ].map(row => ({...row,created_at:new Date().toISOString()})))});
  assert.equal((await (await db(`treatment_plan_visits?treatment_plan_id=eq.${planId}&select=id`)).json()).length,0);
  assert.equal((await visit(randomUUID(),{},null)).status,401);
  assert.equal((await visit(randomUUID(),{},reportsToken)).status,403);
  assert.equal((await visit(randomUUID(),{},otherToken)).status,404);
  assert.equal((await visit(randomUUID(),{requestId:'invalid'})).status,400);
  assert.equal((await visit(randomUUID(),{doctorId:foreignDoctor})).status,403);
  assert.equal((await visit(randomUUID(),{doctorId:null})).status,400);
  assert.equal((await visit(randomUUID(),{notes:'x'.repeat(4001)})).status,400);
  const ids=[randomUUID(),randomUUID()];
  const attempts=await Promise.all(ids.map(id=>visit(id)));
  assert.deepEqual(attempts.map(r=>r.status).sort(),[200,409]);
  const winner=ids[attempts.findIndex(r=>r.status===200)];
  const saved=await attempts.find(r=>r.status===200).json();
  assert.equal(saved.plan.status,'Completed'); assert.equal(saved.completedVisits,1);
  const retry=await visit(winner); assert.equal(retry.status,200);
  const replay=await retry.json(); assert.equal(replay.replayed,true); assert.equal(replay.visit.id,saved.visit.id);
  assert.equal((await visit(winner,{notes:'TEST changed payload'})).status,409);
  const visits=await (await db(`treatment_plan_visits?treatment_plan_id=eq.${planId}&select=id,doctor_id,visit_number`)).json();
  assert.equal(visits.length,1); assert.equal(visits[0].visit_number,1);
  let completed=0;
  for(const doctorId of [doctorOne,doctorTwo,doctorOne]){const response=await visit(randomUUID(),{treatmentPlanId:multiPlan,doctorId});assert.equal(response.status,200);const savedVisit=await response.json();assert.equal(savedVisit.visit.doctor_id,doctorId);assert.equal(savedVisit.completedVisits,++completed);assert.equal(savedVisit.visit.visit_number,completed);}
  const attributed=await (await db(`treatment_plan_visits?treatment_plan_id=eq.${multiPlan}&select=doctor_id&order=visit_number`)).json();assert.deepEqual(attributed.map(row=>row.doctor_id),[doctorOne,doctorTwo,doctorOne]);
  await db(`doctors?id=eq.${doctorTwo}`,{method:'PATCH',body:JSON.stringify({is_active:false})});
  const inactive=await visit(randomUUID(),{doctorId:doctorTwo});assert.equal(inactive.status,403);
  const anon={apikey:config.ANON_KEY,Authorization:`Bearer ${config.ANON_KEY}`,'Content-Type':'application/json'};
  const denied=await fetch(`${config.API_URL}/rest/v1/rpc/record_treatment_plan_visit`,{method:'POST',headers:anon,body:JSON.stringify({p_visit_id:randomUUID(),p_plan_id:planId,p_clinic_id:clinic,p_doctor_id:null,p_receptionist_id:null,p_notes:null})});
  assert.ok([401,403,404].includes(denied.status));
  console.log('PASS: clinic and reports authorization, doctor ownership, malformed input, concurrent visit limit, atomic completion, identical retry, changed retry and anonymous RPC denial.');
} finally {
  for(const doctorId of [doctorOne,doctorTwo])await db(`doctors?id=eq.${doctorId}`,{method:'PATCH',body:JSON.stringify({is_active:false})});
  for(const session of [token,reportsToken,otherToken]) await db(`active_sessions?token=eq.${session}`,{method:'DELETE'});
}
