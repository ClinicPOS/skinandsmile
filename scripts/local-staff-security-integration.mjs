// Local fake accounts only. Never accepts a remote target or prints credentials.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
const c=JSON.parse(fs.readFileSync(process.argv[2],'utf8').replace(/^\uFEFF/,''));
assert.equal(c.API_URL,'http://127.0.0.1:54321');
const app='http://127.0.0.1:3001',clinic='11111111-1111-4111-8111-111111111111';
const headers={apikey:c.SERVICE_ROLE_KEY,Authorization:`Bearer ${c.SERVICE_ROLE_KEY}`,'Content-Type':'application/json'};
const anon={apikey:c.ANON_KEY,Authorization:`Bearer ${c.ANON_KEY}`,'Content-Type':'application/json'};
const tokens=[],keys=[];let staffId;
async function db(path,init={}){const r=await fetch(`${c.API_URL}/rest/v1/${path}`,{...init,headers});assert.ok(r.ok,await r.clone().text());const t=await r.text();return t?JSON.parse(t):null;}
async function request(path,token,body){return fetch(app+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Cookie:`app-auth=${token}`}:{})},body:JSON.stringify(body)});}
try{
 const login=await request('/api/auth/staff-login',null,{email:'owner.demo@local.test',password:'LocalOwnerTestOnly!42'});assert.equal(login.status,200);const owner=login.headers.get('set-cookie').match(/app-auth=([^;]+)/)[1];tokens.push(owner);
 const draft={action:'create',data:{name:'TEST private staff credentials',shift:'Morning',clinic_id:clinic,pin:'8172'}};
 assert.equal((await request('/api/owner/receptionists',null,draft)).status,401);
 let response=await request('/api/owner/receptionists',owner,draft);assert.equal(response.status,200,await response.clone().text());const record=(await response.json()).record;staffId=record.id;assert.equal(record.pin,undefined);
 response=await request('/api/owner/receptionists',owner,{action:'update',id:staffId,data:{...draft.data,pin:'9273'}});assert.equal(response.status,200);
 assert.equal((await request('/api/owner/receptionists',owner,{action:'update',id:staffId,data:{...draft.data,clinic_id:'22222222-2222-4222-8222-222222222222'}})).status,409);
 for(const select of ['pin','*']){const r=await fetch(`${c.API_URL}/rest/v1/receptionist?select=${select}`,{headers:anon});assert.ok([401,403].includes(r.status));}
 assert.ok([401,403].includes((await fetch(`${c.API_URL}/rest/v1/receptionist?select=id,name,clinic_id,shift`,{headers:anon})).status));
 assert.ok([401,403].includes((await fetch(`${c.API_URL}/rest/v1/receptionist`,{method:'POST',headers:anon,body:JSON.stringify(draft.data)})).status));
 const audit=await db(`activity_log?entity_id=eq.${staffId}&select=old_data,new_data`);assert.equal(audit.length,2);assert.ok(audit.every(r=>!r.old_data?.pin&&!r.new_data?.pin));
 const token=randomUUID();tokens.push(token);await db('active_sessions',{method:'POST',body:JSON.stringify({token,session_mode:'clinic',user_role:'receptionist',clinic_id:clinic,created_at:new Date().toISOString()})});
 assert.equal((await request('/api/owner/receptionists',token,draft)).status,403);
 keys.push(createHash('sha256').update('receptionist-pin\0'+token+'\0'+staffId).digest('hex'));
 assert.equal((await request('/api/auth/receptionist',token,{receptionistId:staffId,pin:'9273'})).status,200);
 for(let i=0;i<5;i++)assert.equal((await request('/api/auth/receptionist',token,{receptionistId:staffId,pin:'0000'})).status,403);
 assert.equal((await request('/api/auth/receptionist',token,{receptionistId:staffId,pin:'9273'})).status,429);
 const key=createHash('sha256').update(randomUUID()).digest('hex');keys.push(key);
 const results=await Promise.all(Array.from({length:12},()=>db('rpc/consume_pos_login_attempt',{method:'POST',body:JSON.stringify({p_key:key,p_limit:5,p_window_seconds:300})})));
 assert.equal(results.filter(r=>r.allowed).length,5);
 await db(`pos_login_attempt_limits?key=eq.${key}`,{method:'PATCH',body:JSON.stringify({until_at:'2000-01-01T00:00:00Z'})});
 assert.equal((await db('rpc/consume_pos_login_attempt',{method:'POST',body:JSON.stringify({p_key:key,p_limit:5,p_window_seconds:300})})).allowed,true);
 assert.equal((await request('/api/auth/login',null,{selectedScope:'manager',password:'invalid'})).status,403);
 console.log('PASS: owner-only staff updates, private PINs, redacted audit, clinic history preserved, server PIN verification, durable concurrent attempt limits and expiry.');
}finally{
 for(const token of tokens)await db(`active_sessions?token=eq.${token}`,{method:'DELETE'});
 for(const key of keys)await db(`pos_login_attempt_limits?key=eq.${key}`,{method:'DELETE'});
 if(staffId)await db(`receptionist?id=eq.${staffId}`,{method:'DELETE'});
}
