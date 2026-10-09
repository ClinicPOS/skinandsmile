// Fake local register only. Does not close a user's register.
import fs from 'node:fs';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
const c=JSON.parse(fs.readFileSync(process.argv[2],'utf8').replace(/^\uFEFF/,''));assert.equal(c.API_URL,'http://127.0.0.1:54321');
const headers={apikey:c.SERVICE_ROLE_KEY,Authorization:`Bearer ${c.SERVICE_ROLE_KEY}`,'Content-Type':'application/json'};
const rec=randomUUID(),token=randomUUID(),other=randomUUID(),clinic='11111111-1111-4111-8111-111111111111';let register;
async function db(path,init={}){const r=await fetch(c.API_URL+'/rest/v1/'+path,{...init,headers});assert.ok(r.ok,await r.clone().text());const text=await r.text();return text?JSON.parse(text):null;}
async function change(body,auth=token){return fetch('http://127.0.0.1:3001/api/register',{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Cookie:`app-auth=${auth}`}:{})},body:JSON.stringify(body)});}
try{
 await db('receptionist',{method:'POST',body:JSON.stringify({id:rec,clinic_id:clinic,name:'TEST register audit fixture (not for login)',pin:randomUUID()})});
 await db('active_sessions',{method:'POST',body:JSON.stringify([{token,session_mode:'clinic',user_role:'receptionist',clinic_id:clinic,receptionist_id:rec,created_at:new Date().toISOString()},{token:other,session_mode:'clinic',user_role:'receptionist',clinic_id:clinic,receptionist_id:'33333333-3333-4333-8333-333333333333',created_at:new Date().toISOString()}])});
 assert.equal((await change({action:'open',amount:0},null)).status,401);
 assert.equal((await change({action:'open',amount:-1})).status,400);
 const opens=await Promise.all([change({action:'open',amount:25}),change({action:'open',amount:25})]);for(const r of opens)assert.equal(r.status,200,await r.clone().text());const rows=await Promise.all(opens.map(r=>r.json()));register=rows[0].register.id;assert.equal(register,rows[1].register.id);assert.equal(rows[0].register.receptionist_id,rec);
 assert.equal((await db(`cash_register_sessions?receptionist_id=eq.${rec}&select=id`)).length,1);
 assert.equal((await change({action:'close',amount:25,registerSessionId:register},other)).status,403);
 const stale=await db('rpc/register_ledger_version',{method:'POST',body:JSON.stringify({p_receptionist_id:rec})});
 const deposit={patient_id:'77777777-7777-4777-8777-777777777777',clinic_id:clinic,amount:10,payment_method:'Cash',reason:'TEST register serialization deposit',receptionist_id:rec,register_session_id:register};
 await db('patient_credits',{method:'POST',body:JSON.stringify(deposit)});
 const staleClose=await fetch(c.API_URL+'/rest/v1/rpc/close_verified_register',{method:'POST',headers,body:JSON.stringify({p_receptionist_id:rec,p_clinic_id:clinic,p_register_id:register,p_amount:25,p_expected_cash:25,p_ledger_version:stale})});assert.ok(!staleClose.ok);
 assert.equal((await db(`cash_register_sessions?id=eq.${register}&select=closed_at`))[0].closed_at,null);
 const closed=await change({action:'close',amount:35,registerSessionId:register,expectedCash:999,variance:999});assert.equal(closed.status,200,await closed.clone().text());const saved=(await closed.json()).register;assert.equal(Number(saved.variance),0);assert.ok(saved.closed_at);
 assert.equal((await change({action:'close',amount:35,registerSessionId:register})).status,200);
 assert.equal((await change({action:'close',amount:24,registerSessionId:register})).status,409);
 const audit=await db(`activity_log?entity_id=eq.${register}&select=action`);assert.deepEqual(audit.map(r=>r.action).sort(),['CLOSE_REGISTER','OPEN_REGISTER']);
 const anon={apikey:c.ANON_KEY,Authorization:`Bearer ${c.ANON_KEY}`,'Content-Type':'application/json'};assert.ok([401,403].includes((await fetch(c.API_URL+'/rest/v1/cash_register_sessions',{method:'POST',headers:anon,body:JSON.stringify({receptionist_id:rec,opening_cash:0})})).status));
 assert.ok(!(await fetch(c.API_URL+'/rest/v1/patient_credits',{method:'POST',headers,body:JSON.stringify(deposit)})).ok);
 console.log('PASS: authenticated register ownership, concurrent open/resume, server cash verification, repeat-close audit once, changed-close rejection and anonymous write denial.');
}finally{for(const t of [token,other])await db(`active_sessions?token=eq.${t}`,{method:'DELETE'});if(register)await db(`cash_register_sessions?id=eq.${register}`,{method:'PATCH',body:JSON.stringify({closed_at:new Date().toISOString()})});}
