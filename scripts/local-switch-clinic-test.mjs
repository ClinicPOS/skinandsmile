import fs from 'node:fs';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const config=JSON.parse(fs.readFileSync(process.argv[2],'utf8').replace(/^\uFEFF/,''));assert.equal(config.API_URL,'http://127.0.0.1:54321');
const token=randomUUID(),url=config.API_URL+'/rest/v1/active_sessions?token=eq.'+token;
const headers={apikey:config.SERVICE_ROLE_KEY,Authorization:`Bearer ${config.SERVICE_ROLE_KEY}`,'Content-Type':'application/json'};
try{
 const seeded=await fetch(config.API_URL+'/rest/v1/active_sessions',{method:'POST',headers,body:JSON.stringify({token,session_mode:'clinic',user_role:'receptionist',clinic_id:'11111111-1111-4111-8111-111111111111',receptionist_id:'33333333-3333-4333-8333-333333333333',created_at:new Date().toISOString()})});assert.ok(seeded.ok);
 const signedOut=await fetch('http://127.0.0.1:3001/api/auth/logout',{method:'POST',headers:{Cookie:`app-auth=${token}`}});assert.equal(signedOut.status,200);assert.match(signedOut.headers.get('set-cookie'),/app-auth=/);
 assert.equal((await (await fetch(url+'&select=token',{headers})).json()).length,0);
 const denied=await fetch('http://127.0.0.1:3001/api/workspace/refunds',{headers:{Cookie:`app-auth=${token}`}});assert.equal(denied.status,401);
 assert.ok(fs.readFileSync('lib/clinic-access.ts','utf8').includes("localStorage.removeItem('posRegisterSession')"));
 console.log('PASS: Switch Clinic revokes server login, clears cookie and saved receptionist login; revoked login cannot read requests.');
}finally{await fetch(url,{method:'DELETE',headers});}
