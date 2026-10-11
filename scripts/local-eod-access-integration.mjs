// Temporary localhost sessions only; financial records and account access are unchanged.
import fs from 'node:fs';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
const c=JSON.parse(fs.readFileSync(process.argv[2],'utf8').replace(/^\uFEFF/,''));assert.equal(c.API_URL,'http://127.0.0.1:54321');
const clinic='11111111-1111-4111-8111-111111111111',foreign='22222222-2222-4222-8222-222222222222',tokens=[];
const headers={apikey:c.SERVICE_ROLE_KEY,Authorization:`Bearer ${c.SERVICE_ROLE_KEY}`,'Content-Type':'application/json'};
async function db(query,init={}){const response=await fetch(c.API_URL+'/rest/v1/'+query,{...init,headers});assert.ok(response.ok,`Local setup status ${response.status}`);const text=await response.text();return text?JSON.parse(text):null;}
async function session(row){const token=randomUUID();tokens.push(token);await db('active_sessions',{method:'POST',body:JSON.stringify({token,created_at:new Date().toISOString(),...row})});return token;}
const exportReport=(token,clinicId=clinic,day='2026-10-07')=>fetch('http://127.0.0.1:3001/api/workspace/eod-export',{method:'POST',headers:{'Content-Type':'application/json',...(token?{Cookie:'app-auth='+token}:{})},body:JSON.stringify({clinicId,day})});
try{
 assert.equal((await exportReport(null)).status,401);
 const receptionist=await session({session_mode:'clinic',user_role:'receptionist',clinic_id:clinic,receptionist_id:'33333333-3333-4333-8333-333333333333'});
 const ownerAccount=(await db('pos_accounts?email=eq.owner.demo@local.test&select=id'))[0],managerAccount=(await db('pos_accounts?email=eq.manager.demo@local.test&select=id'))[0];
 const owner=await session({session_mode:'manager',user_role:'owner',account_id:ownerAccount.id});
 const manager=await session({session_mode:'manager',user_role:'clinic_manager',account_id:managerAccount.id,clinic_id:clinic});
 for(const token of [receptionist,owner,manager]){const r=await exportReport(token);assert.equal(r.status,200,await r.clone().text());assert.equal(r.headers.get('content-encoding'),'gzip');assert.match(r.headers.get('cache-control'),/no-store/);assert.ok(r.headers.get('server-timing'));const report=await r.json();assert.ok(report.workbook.Sheets['Daily Summary']);assert.ok(report.workbook.Sheets['Pending Approvals']);}
 assert.equal((await exportReport(receptionist,foreign)).status,403);assert.equal((await exportReport(manager,foreign)).status,403);
 assert.equal((await exportReport(receptionist,clinic,'2026-02-31')).status,400);
 const reports=await session({session_mode:'reports',user_role:'reports'});assert.equal((await exportReport(reports)).status,403);
 await db(`active_sessions?token=eq.${receptionist}`,{method:'DELETE'});assert.equal((await exportReport(receptionist)).status,401);
 console.log('PASS: actual compressed EOD downloads for local receptionist, owner and assigned manager; anonymous, revoked, foreign-clinic and reports-only denial; invalid dates rejected.');
}finally{for(const token of tokens)await db(`active_sessions?token=eq.${token}`,{method:'DELETE'});}
