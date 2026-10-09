import fs from 'node:fs';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
const c=JSON.parse(fs.readFileSync(process.argv[2],'utf8').replace(/^\uFEFF/,''));assert.equal(c.API_URL,'http://127.0.0.1:54321');
const clinic='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const actor=randomUUID(),patient=randomUUID(),file=randomUUID(),token=randomUUID();
const headers={apikey:c.SERVICE_ROLE_KEY,Authorization:'Bearer '+c.SERVICE_ROLE_KEY,'Content-Type':'application/json'};
async function db(path,init={}){const r=await fetch(c.API_URL+'/rest/v1/'+path,{...init,headers});assert.ok(r.ok,await r.clone().text());const s=await r.text();return s?JSON.parse(s):null;}
async function post(body,auth=token){return fetch('http://127.0.0.1:3001/api/pos-preferences',{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Cookie:'app-auth='+auth}:{})},body:JSON.stringify(body)});}
try{
 await db('receptionist',{method:'POST',body:JSON.stringify({id:actor,name:'TEST preferences only',clinic_id:clinic,pin:'1234',shift:'Morning'})});
 await db('patients',{method:'POST',body:JSON.stringify({id:patient,name:'TEST birthday preference',phone:''})});
 await db('clinic_patient_files',{method:'POST',body:JSON.stringify({id:file,patient_id:patient,clinic_id:clinic,file_no:'TEST-'+file})});
 await db('active_sessions',{method:'POST',body:JSON.stringify({token,session_mode:'clinic',user_role:'receptionist',clinic_id:clinic,receptionist_id:actor,created_at:new Date().toISOString()})});
 const service=(await db('services?clinic_id=eq.'+clinic+'&is_active=eq.true&select=id&limit=1'))[0].id;
 assert.equal((await post({kind:'favorite',serviceId:service,enabled:true},null)).status,401);
 for(let i=0;i<2;i++){const r=await post({kind:'favorite',serviceId:service,enabled:true});assert.equal(r.status,200,await r.clone().text());}
 assert.equal((await db('service_favorites?receptionist_id=eq.'+actor+'&select=id')).length,1);
 const foreignService=(await db('services?clinic_id=eq.'+other+'&select=id&limit=1'))[0];
 if(foreignService)assert.equal((await post({kind:'favorite',serviceId:foreignService.id,enabled:true})).status,403);
 assert.equal((await post({kind:'favorite',serviceId:service,enabled:false})).status,200);
 assert.equal((await db('service_favorites?receptionist_id=eq.'+actor+'&select=id')).length,0);
 const responses=await Promise.all([post({kind:'greeting',patientId:patient}),post({kind:'greeting',patientId:patient})]);
 for(const r of responses)assert.equal(r.status,200,await r.clone().text());
 assert.equal((await db('birthday_greetings?patient_id=eq.'+patient+'&select=id')).length,1);
 assert.equal((await post({kind:'greeting',patientId:'99999999-9999-4999-8999-999999999999'})).status,403);
 console.log('PASS: favorites save/remove/retry once, greetings concurrent retry once, no foreign-clinic changes and no unauthenticated writes.');
}finally{
 await db('active_sessions?token=eq.'+token,{method:'DELETE'});
 await db('service_favorites?receptionist_id=eq.'+actor,{method:'DELETE'});
 await db('birthday_greetings?patient_id=eq.'+patient,{method:'DELETE'});
 await db('clinic_patient_files?id=eq.'+file,{method:'DELETE'});
 await db('patients?id=eq.'+patient,{method:'DELETE'});
 await db('receptionist?id=eq.'+actor,{method:'DELETE'});
}
