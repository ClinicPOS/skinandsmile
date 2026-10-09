// Local fake data only. Audit history is deliberately retained after fixture cleanup.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import ts from 'typescript';
const config=JSON.parse(fs.readFileSync(process.argv[2],'utf8').replace(/^\uFEFF/,''));
assert.equal(config.API_URL,'http://127.0.0.1:54321');
const app='http://127.0.0.1:3001',clinic=randomUUID(),token=randomUUID(),staffToken=randomUUID(),reportsToken=randomUUID();
const staffA='33333333-3333-4333-8333-333333333333',staffB='44444444-4444-4444-8444-444444444444';
const headers={apikey:config.SERVICE_ROLE_KEY,Authorization:`Bearer ${config.SERVICE_ROLE_KEY}`,'Content-Type':'application/json'};
const anon={apikey:config.ANON_KEY,Authorization:`Bearer ${config.ANON_KEY}`,'Content-Type':'application/json'};
async function rest(path,init={}){const r=await fetch(`${config.API_URL}/rest/v1/${path}`,{...init,headers});assert.ok(r.ok,`Local DB operation ${r.status}: ${await r.clone().text()}`);return r;}
async function api(path,session=token,init={}){return fetch(`${app}/api/admin/${path}`,{...init,headers:{'Content-Type':'application/json',...(session?{Cookie:`app-auth=${session}`}:{})}});}
const settings={primary_approver_id:staffA,backup_approver_id:staffB,temporary_approver_id:null,temporary_start:null,temporary_end:null};
let clinicCreated=false;
try{
 await rest('clinics',{method:'POST',body:JSON.stringify({id:clinic,name:`TEST APPROVERS ${clinic}`})});clinicCreated=true;
 for(const [session,mode,role,clinicId] of [[token,'manager','owner',null],[staffToken,'clinic','receptionist','11111111-1111-4111-8111-111111111111'],[reportsToken,'reports','reports',null]])await rest('active_sessions',{method:'POST',body:JSON.stringify({token:session,session_mode:mode,user_role:role,clinic_id:clinicId,...(mode==='manager'?{account_id:(await (await rest('pos_accounts?role=eq.owner&select=id')).json())[0].id}:{}),created_at:new Date().toISOString()})});
 for(const endpoint of ['activity-log','login-logs',`correction-approvers?clinicId=${clinic}`]){
  assert.equal((await api(endpoint,null)).status,401);assert.equal((await api(endpoint,staffToken)).status,403);assert.equal((await api(endpoint,reportsToken)).status,403);
 }
 for(const table of ['activity_log','clinic_correction_approvers','login_logs']){
  const r=await fetch(`${config.API_URL}/rest/v1/${table}?select=*&limit=1`,{headers:anon});assert.ok([401,403].includes(r.status));
 }
 const put=(body)=>api('correction-approvers',token,{method:'PUT',body:JSON.stringify(body)});
 const body={clinicId:clinic,settings,expectedUpdatedAt:null,reason:'TEST initial configuration'};
 assert.equal((await put({...body,reason:''})).status,400);
 assert.equal((await put({...body,settings:{...settings,backup_approver_id:staffA}})).status,400);
 assert.equal((await put({...body,settings:{...settings,temporary_approver_id:staffB,temporary_start:'2026-02-30',temporary_end:'2026-03-01'}})).status,400);
 let response=await put(body);assert.equal(response.status,200,await response.clone().text());let saved=(await response.json()).settings;
 assert.equal(saved.primary_approver_id,staffA);
 assert.equal((await put(body)).status,409);
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Dubai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const temporary={...settings,temporary_approver_id:staffB,temporary_start:day,temporary_end:day};
 response=await put({...body,settings:temporary,expectedUpdatedAt:saved.updated_at,reason:'TEST one day leave cover'});assert.equal(response.status,200,await response.clone().text());saved=(await response.json()).settings;
 const loaded=await (await api(`correction-approvers?clinicId=${clinic}`)).json();assert.equal(loaded.effective.primaryId,staffB);assert.equal(loaded.effective.temporary,true);
 const module={exports:{}};new Function('exports',ts.transpile(fs.readFileSync('lib/correction-approvers.ts','utf8'),{module:ts.ModuleKind.CommonJS}))(module.exports);
 assert.equal(module.exports.effectiveApprovers(temporary,'2099-01-01').primaryId,staffA);
 assert.equal(module.exports.effectiveApprovers(temporary,'2000-01-01').primaryId,staffA);
 const history=await (await api(`activity-log?clinicId=${clinic}`)).json();assert.equal(history.entries.length,2);
 assert.ok(history.entries.every(e=>e.actor_verified&&e.actor_role==='owner'&&e.reason.startsWith('TEST')));
 assert.ok(history.entries.every(e=>e.actor_reference!==token&&e.actor_reference.length===64));
 assert.equal(history.entries[0].old_data.temporary_approver_id,null);assert.equal(history.entries[0].new_data.temporary_approver_id,staffB);
 assert.equal((await api('activity-log?offset=-1')).status,400);
 const immutable=await fetch(`${config.API_URL}/rest/v1/activity_log?id=eq.${history.entries[0].id}`,{method:'PATCH',headers,body:JSON.stringify({reason:'tamper'})});assert.ok([401,403].includes(immutable.status));
 const rpc=await fetch(`${config.API_URL}/rest/v1/rpc/save_clinic_correction_approvers`,{method:'POST',headers:anon,body:JSON.stringify({p_clinic_id:clinic,p_settings:settings,p_expected_updated_at:null,p_actor:{verified:true},p_reason:'TEST spoof'})});assert.ok([401,403,404].includes(rpc.status));
 assert.equal((await api('login-logs')).status,200);
 const failedLogin=await fetch(`${app}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'TEST incorrect password',selectedScope:'11111111-1111-4111-8111-111111111111'})});assert.equal(failedLogin.status,401);
 const localEnv=fs.readFileSync(new URL('./.env.local',`file:///${process.argv[2].replaceAll('\\','/')}`),'utf8');
 const password=localEnv.match(/^APP_PASSWORD\s*=\s*(.+)$/m)?.[1]?.trim().replace(/^['"]|['"]$/g,'');assert.ok(password);
 const validLogin=await fetch(`${app}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password,selectedScope:'11111111-1111-4111-8111-111111111111'})});assert.equal(validLogin.status,200,await validLogin.clone().text());
 const loginToken=validLogin.headers.get('set-cookie')?.match(/app-auth=([^;]+)/)?.[1];assert.ok(loginToken);await rest(`active_sessions?token=eq.${decodeURIComponent(loginToken)}`,{method:'DELETE'});
 const loginHistory=await (await api('login-logs')).json();assert.ok(loginHistory.logs.some(row=>row.success===true));assert.ok(loginHistory.logs.some(row=>row.success===false));
 console.log('PASS: administrator-only access, anonymous denial, reasons, date validation, temporary cover, automatic expiry, concurrent-edit protection, before/after audit, protected actor reference, immutable history and login history.');
}finally{
 for(const session of [token,staffToken,reportsToken])await rest(`active_sessions?token=eq.${session}`,{method:'DELETE'});
 if(clinicCreated){await rest(`clinic_correction_approvers?clinic_id=eq.${clinic}`,{method:'DELETE'});await rest(`clinics?id=eq.${clinic}`,{method:'DELETE'});}
}
