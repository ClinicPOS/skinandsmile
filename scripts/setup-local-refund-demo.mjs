// Enables the demo manager's refund tab in the isolated local project only.
import fs from 'node:fs';import assert from 'node:assert/strict';
const config=JSON.parse(fs.readFileSync(process.argv[2],'utf8').replace(/^\uFEFF/,''));assert.equal(config.API_URL,'http://127.0.0.1:54321');
const headers={apikey:config.SERVICE_ROLE_KEY,Authorization:`Bearer ${config.SERVICE_ROLE_KEY}`,'Content-Type':'application/json'},clinicId='11111111-1111-4111-8111-111111111111';
async function get(path){const r=await fetch(`${config.API_URL}/rest/v1/${path}`,{headers});assert.ok(r.ok);return r.json();}
const [account]=await get('pos_accounts?email=eq.manager.demo@local.test&select=*');assert.equal(account.role,'clinic_manager');
const [access]=await get(`pos_manager_access?account_id=eq.${account.id}&clinic_id=eq.${clinicId}&select=*`);assert.ok(access);
const login=await fetch('http://127.0.0.1:3001/api/auth/staff-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'owner.demo@local.test',password:'LocalOwnerTestOnly!42'})});assert.equal(login.status,200);
const token=login.headers.get('set-cookie').match(/app-auth=([^;]+)/)[1];
try{
 const response=await fetch('http://127.0.0.1:3001/api/owner/managers',{method:'POST',headers:{'Content-Type':'application/json',Cookie:`app-auth=${token}`},body:JSON.stringify({accountId:account.id,name:account.name,email:account.email,enabled:account.enabled,clinicId,permissions:[...new Set([...access.permissions,'correction_approval'])],startsOn:access.starts_on,endsOn:access.ends_on,expectedUpdatedAt:access.updated_at,reason:'Enable local demo refund approval for user testing'})});assert.equal(response.status,200,await response.clone().text());console.log('Local demo manager Refund approvals tab enabled.');
}finally{await fetch(`${config.API_URL}/rest/v1/active_sessions?token=eq.${token}`,{method:'DELETE',headers});}
