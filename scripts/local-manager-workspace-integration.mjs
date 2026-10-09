// Local DEMO accounts and fake clinic data only. Never accepts a remote target.
import fs from 'node:fs';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import ts from 'typescript';
const config=JSON.parse(fs.readFileSync(process.argv[2],'utf8').replace(/^\uFEFF/,''));assert.equal(config.API_URL,'http://127.0.0.1:54321');const app='http://127.0.0.1:3001';
const clinic='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const headers={apikey:config.SERVICE_ROLE_KEY,Authorization:`Bearer ${config.SERVICE_ROLE_KEY}`,'Content-Type':'application/json'};
const anon={apikey:config.ANON_KEY,Authorization:`Bearer ${config.ANON_KEY}`,'Content-Type':'application/json'};
const tokens=[],createdDoctors=[],createdServices=[];let ownerToken,managerToken,managerId,originalAccess,newManagerId,passwordChanged=false;
const testPlans=[];
async function db(path,init={}){const r=await fetch(`${config.API_URL}/rest/v1/${path}`,{...init,headers});assert.ok(r.ok,`Local DB ${r.status}: ${await r.clone().text()}`);const text=await r.text();return text?JSON.parse(text):null;}
async function login(email,password,clinicId){const r=await fetch(`${app}/api/auth/staff-login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password,clinicId})});assert.equal(r.status,200,await r.clone().text());const cookie=r.headers.get('set-cookie');if(cookie){const token=cookie.match(/app-auth=([^;]+)/)[1];tokens.push(token);return {token,data:await r.json()};}return {data:await r.json()};}
async function request(path,token,method='GET',body){return fetch(`${app}${path}`,{method,headers:{'Content-Type':'application/json',...(token?{Cookie:`app-auth=${token}`}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'manual'});}
const mutation=(kind,action,id,data,clinicId=clinic,token=managerToken)=>request('/api/workspace/catalog',token,'POST',{kind,action,id,data,clinicId,reason:'TEST scoped catalog change'});
async function access(permissions,extra={}){const rows=await db(`pos_manager_access?account_id=eq.${managerId}&clinic_id=eq.${clinic}&select=*`);return request('/api/owner/managers',ownerToken,'POST',{accountId:managerId,name:'TEST Clinic A Manager',email:'manager.demo@local.test',enabled:true,clinicId:clinic,permissions,startsOn:null,endsOn:null,expectedUpdatedAt:rows[0].updated_at,reason:'TEST permission update',...extra});}
try{
 assert.equal((await request('/api/owner/managers',null)).status,401);
 assert.equal((await request('/api/auth/staff-login',null,'POST',{email:'manager.demo@local.test',password:'TEST wrong'})).status,401);
 ownerToken=(await login('owner.demo@local.test','LocalOwnerTestOnly!42')).token;
 assert.equal((await request('/api/auth/login',null,'POST',{selectedScope:'manager',password:'TEST legacy'})).status,403);
 const newManagerEmail=`test.manager.${randomUUID()}@local.test`;
 const created=await request('/api/owner/managers',ownerToken,'POST',{clinicId:other,name:'TEST New Manager (disabled after verification)',email:newManagerEmail,enabled:true,permissions:['reports'],startsOn:null,endsOn:null,expectedUpdatedAt:null,reason:'TEST owner creates manager'});assert.equal(created.status,200,await created.clone().text());const createdData=await created.json();newManagerId=createdData.accountId;assert.ok(createdData.temporaryPassword.length>=24);
 const newLogin=await login(newManagerEmail,createdData.temporaryPassword,other);assert.equal((await request('/api/owner/managers',newLogin.token)).status,403);assert.equal((await request(`/api/workspace/catalog?kind=services&clinicId=${other}`,newLogin.token)).status,403);
 const choices=(await login('manager.demo@local.test','LocalManagerTestOnly!42')).data;assert.equal(choices.selectClinic,true);assert.deepEqual(choices.clinics.map(c=>c.id),[clinic]);
 assert.equal((await request('/api/auth/staff-login',null,'POST',{email:'manager.demo@local.test',password:'LocalManagerTestOnly!42',clinicId:other})).status,403);
 managerToken=(await login('manager.demo@local.test','LocalManagerTestOnly!42',clinic)).token;
 const context=await (await request('/api/workspace/context',managerToken)).json();assert.deepEqual(context.clinics.map(c=>c.id),[clinic]);assert.equal(context.role,'clinic_manager');
 managerId=(await db('pos_accounts?email=eq.manager.demo@local.test&select=id'))[0].id;originalAccess=(await db(`pos_manager_access?account_id=eq.${managerId}&clinic_id=eq.${clinic}&select=*`))[0];
 assert.equal((await request('/api/owner/managers',managerToken)).status,403);assert.equal((await request('/api/admin/sessions',managerToken)).status,403);assert.equal((await request('/api/patients/simple',managerToken)).status,403);
 assert.equal((await request('/backend',managerToken)).status,307);
 for(const kind of ['doctors','services','clinics']){
  assert.equal((await request(`/api/workspace/catalog?kind=${kind}&clinicId=${other}`,managerToken)).status,403);
  const r=await request(`/api/workspace/catalog?kind=${kind}&clinicId=${clinic}`,managerToken);assert.equal(r.status,200);const rows=(await r.json()).records;assert.ok(rows.every(row=>kind==='clinics'?row.id===clinic:row.clinic_id===clinic));
 }
 let r=await mutation('doctors','create',null,{name:'TEST Doctor '+randomUUID(),specialty:'TEST'});assert.equal(r.status,200,await r.clone().text());const doctor=(await r.json()).record;createdDoctors.push(doctor.id);
 r=await mutation('doctors','update',doctor.id,{name:'TEST Changed doctor'});assert.equal(r.status,200,await r.clone().text());
 assert.equal((await mutation('doctors','update','66666666-6666-4666-8666-666666666666',{name:'TEST forbidden'})).status,404);
 assert.equal((await mutation('doctors','update',doctor.id,{clinic_id:other})).status,400);
 assert.equal((await mutation('doctors','archive',doctor.id,{})).status,200);assert.equal((await db(`doctors?id=eq.${doctor.id}&select=is_active`))[0].is_active,false);
 const planId=randomUUID(),visitId=randomUUID();await db('treatment_plans',{method:'POST',body:JSON.stringify({id:planId,patient_id:'77777777-7777-4777-8777-777777777777',clinic_id:clinic,title:'TEST doctor archive retry',total_amount:0,planned_visits:1,created_by:'33333333-3333-4333-8333-333333333333'})});testPlans.push(planId);
 const visitBody={p_visit_id:visitId,p_plan_id:planId,p_clinic_id:clinic,p_doctor_id:doctor.id,p_receptionist_id:'33333333-3333-4333-8333-333333333333',p_notes:'TEST archived doctor visit'};
 const deniedVisit=await fetch(`${config.API_URL}/rest/v1/rpc/record_treatment_plan_visit`,{method:'POST',headers,body:JSON.stringify(visitBody)});assert.equal(deniedVisit.status,403);
 assert.equal((await mutation('doctors','update',doctor.id,{is_active:true})).status,200);await db('rpc/record_treatment_plan_visit',{method:'POST',body:JSON.stringify(visitBody)});
 assert.equal((await mutation('doctors','archive',doctor.id,{})).status,200);assert.equal((await db('rpc/record_treatment_plan_visit',{method:'POST',body:JSON.stringify(visitBody)})).replayed,true);
 r=await mutation('services','create',null,{name:'TEST Service '+randomUUID(),price:123.45,vat_rate:0.05});assert.equal(r.status,200,await r.clone().text());const service=(await r.json()).record;createdServices.push(service.id);
 assert.equal((await mutation('services','update',service.id,{price:-1})).status,400);
 assert.equal((await mutation('services','update',service.id,{price:125,standard_price:125})).status,200);
 assert.equal((await mutation('services','archive',service.id,{})).status,200);
 assert.equal((await mutation('clinics','update',clinic,{receipt_title:'<script>unsafe</script>'})).status,400);
 assert.equal((await mutation('clinics','update',clinic,{logo:'/images/x" onerror="unsafe'})).status,400);
 const thermal={};new Function('exports',ts.transpile(fs.readFileSync('lib/thermal-receipt-branding.ts','utf8'),{module:ts.ModuleKind.CommonJS}))(thermal);const html=thermal.buildThermalLogoHtml('/images/x" onload="unsafe','" onload="unsafe','invalid"id');assert.ok(!html.includes('onload="'));assert.ok(html.includes('&quot;'));
 assert.equal((await mutation('clinics','update',clinic,{trn:'TEST unauthorized legal identity'})).status,400);
 const oldTitle=(await db(`clinics?id=eq.${clinic}&select=receipt_title`))[0].receipt_title;
 try{assert.equal((await mutation('clinics','update',clinic,{receipt_title:'TEST manager receipt'})).status,200);}finally{await db(`clinics?id=eq.${clinic}`,{method:'PATCH',body:JSON.stringify({receipt_title:oldTitle})});}
 for(const table of ['doctors','services','clinics']){const result=await fetch(`${config.API_URL}/rest/v1/${table}?id=eq.${clinic}`,{method:'PATCH',headers:anon,body:JSON.stringify(table==='clinics'?{receipt_title:'bypass'}:{name:'bypass'})});assert.ok([401,403].includes(result.status));}
 for(const table of ['pos_accounts','pos_manager_access']){const result=await fetch(`${config.API_URL}/rest/v1/${table}?select=*`,{headers:anon});assert.ok([401,403].includes(result.status));}
 const reports=await request('/api/reports/ceo-dashboard',managerToken,'POST',{clinicId:clinic,period:'today'});assert.equal(reports.status,200,await reports.clone().text());const dashboard=await reports.json();assert.equal(dashboard.meta.clinicId,clinic);assert.ok(dashboard.clinicPerformance.every(row=>row.clinicId===clinic));
 assert.equal((await request('/api/reports/ceo-dashboard',managerToken,'POST',{clinicId:other,period:'today'})).status,403);assert.equal((await request('/api/reports/ceo-dashboard',managerToken,'POST',{period:'today'})).status,403);
 assert.equal((await access(['doctors'])).status,200);assert.equal((await request(`/api/workspace/catalog?kind=services&clinicId=${clinic}`,managerToken)).status,403);assert.equal((await request('/api/reports/ceo-dashboard',managerToken,'POST',{clinicId:clinic,period:'today'})).status,403);
 assert.equal((await access(originalAccess.permissions,{endsOn:'2000-01-01'})).status,200);assert.equal((await request('/api/workspace/context',managerToken)).status,401);
 assert.equal((await access(originalAccess.permissions,{enabled:false})).status,200);assert.equal((await request('/api/workspace/context',managerToken)).status,401);
 assert.equal((await access(originalAccess.permissions)).status,200);
 const secondSession=(await login('manager.demo@local.test','LocalManagerTestOnly!42',clinic)).token;
 assert.equal((await request('/api/workspace/password',managerToken,'POST',{currentPassword:'TEST incorrect',newPassword:'LocalChangedTestOnly!42'})).status,401);
 const changed=await request('/api/workspace/password',managerToken,'POST',{currentPassword:'LocalManagerTestOnly!42',newPassword:'LocalChangedTestOnly!42'});assert.equal(changed.status,200,await changed.clone().text());passwordChanged=true;
 assert.equal((await request('/api/workspace/context',secondSession)).status,401);
 const changedLogin=await login('manager.demo@local.test','LocalChangedTestOnly!42',clinic);
 assert.equal((await request('/api/workspace/logout',changedLogin.token,'POST')).status,200);assert.equal((await request('/api/workspace/context',changedLogin.token)).status,401);
 const history=await (await request(`/api/admin/activity-log?clinicId=${clinic}&entity=doctors`,ownerToken)).json();assert.ok(history.entries.some(row=>row.entity_id===doctor.id&&row.actor_id===managerId&&row.actor_verified&&row.actor_role==='clinic_manager'));
 console.log('PASS: real owner/manager login, owner creates accounts, assigned clinic selection, owner-only account management, clinic and route isolation, scoped doctor/service editing and archive, receipt design validation, anonymous write denial, clinic dashboard scope, immediate permission revocation, account disable and dated expiry, named audit actors, password changes revoke other sessions, logout and legacy admin login denial.');
}finally{
 if(passwordChanged){const restored=await fetch(`${config.API_URL}/auth/v1/admin/users/${managerId}`,{method:'PUT',headers,body:JSON.stringify({password:'LocalManagerTestOnly!42'})});assert.ok(restored.ok);}
 if(newManagerId){const row=(await db(`pos_manager_access?account_id=eq.${newManagerId}&clinic_id=eq.${other}&select=updated_at`))[0];const disabled=await request('/api/owner/managers',ownerToken,'POST',{accountId:newManagerId,clinicId:other,name:'TEST New Manager (disabled after verification)',enabled:false,permissions:[],startsOn:null,endsOn:null,expectedUpdatedAt:row.updated_at,reason:'TEST cleanup disables generated account'});assert.equal(disabled.status,200);}
 if(originalAccess&&ownerToken){const response=await access(originalAccess.permissions,{startsOn:originalAccess.starts_on,endsOn:originalAccess.ends_on,enabled:true});assert.equal(response.status,200);}
 for(const id of testPlans){await db(`treatment_plan_visits?treatment_plan_id=eq.${id}`,{method:'DELETE'});await db(`treatment_plans?id=eq.${id}`,{method:'DELETE'});}
 for(const id of createdDoctors)await db(`doctors?id=eq.${id}`,{method:'DELETE'});
 for(const id of createdServices)await db(`services?id=eq.${id}`,{method:'DELETE'});
 for(const token of tokens)await db(`active_sessions?token=eq.${token}`,{method:'DELETE'});
}
