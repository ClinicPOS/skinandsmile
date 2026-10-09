// Creates named DEMO accounts only in the disposable localhost project.
import fs from 'node:fs';import assert from 'node:assert/strict';
const config=JSON.parse(fs.readFileSync(process.argv[2],'utf8').replace(/^\uFEFF/,''));assert.equal(config.API_URL,'http://127.0.0.1:54321');
const headers={apikey:config.SERVICE_ROLE_KEY,Authorization:`Bearer ${config.SERVICE_ROLE_KEY}`,'Content-Type':'application/json'};
async function call(path,init={}){const r=await fetch(config.API_URL+path,{...init,headers});assert.ok(r.ok,`Local setup failed ${r.status}: ${await r.clone().text()}`);const text=await r.text();return text?JSON.parse(text):null;}
async function account(email,name,role,password){const rows=await call(`/rest/v1/pos_accounts?email=eq.${email}&select=id,role`);if(rows.length){assert.equal(rows[0].role,role);return rows[0].id;}const created=await call('/auth/v1/admin/users',{method:'POST',body:JSON.stringify({email,password,email_confirm:true})});await call('/rest/v1/pos_accounts',{method:'POST',body:JSON.stringify({id:created.id,email,name,role,enabled:true}),headers:{...headers,Prefer:'return=representation'}});return created.id;}
const owner=await account('owner.demo@local.test','TEST Owner','owner','LocalOwnerTestOnly!42');
const manager=await account('manager.demo@local.test','TEST Clinic A Manager','clinic_manager','LocalManagerTestOnly!42');
const clinic='11111111-1111-4111-8111-111111111111';
const rows=await call(`/rest/v1/pos_manager_access?account_id=eq.${manager}&clinic_id=eq.${clinic}&select=updated_at`);
await call('/rest/v1/rpc/owner_save_manager',{method:'POST',body:JSON.stringify({p_owner_id:owner,p_account_id:manager,p_name:'TEST Clinic A Manager',p_enabled:true,p_clinic_id:clinic,p_permissions:['doctors','services','receipt_design','reports'],p_starts:null,p_ends:null,p_expected_updated_at:rows[0]?.updated_at??null,p_reason:'TEST local demo initial clinic access'})});
console.log('PASS: local named owner and clinic manager demo accounts provisioned. No remote database or email was used.');
