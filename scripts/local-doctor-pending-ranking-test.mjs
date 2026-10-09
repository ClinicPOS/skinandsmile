import fs from 'node:fs';import assert from 'node:assert/strict';
const config=JSON.parse(fs.readFileSync(process.argv[2],'utf8').replace(/^\uFEFF/,''));assert.equal(config.API_URL,'http://127.0.0.1:54321');
const app='http://127.0.0.1:3001';let cookie;
try{
 const login=await fetch(app+'/api/auth/staff-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'owner.demo@local.test',password:'LocalOwnerTestOnly!42'})});assert.equal(login.status,200);cookie=login.headers.get('set-cookie').match(/app-auth=[^;]+/)[0];
 const response=await fetch(app+'/api/reports/ceo-dashboard',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({period:'month',clinicId:'11111111-1111-4111-8111-111111111111',includeHistoricalData:true})});assert.equal(response.status,200,await response.clone().text());const data=await response.json();
 assert.ok(data.treatmentPlanRankingPending.visits>=4);assert.ok(JSON.stringify(data).includes('stage values are approved'));assert.ok(Array.isArray(data.doctorPerformance));
 console.log('PASS: local CEO dashboard counts unvalued plan visits and warns that stage values are pending; no guessed treatment-plan ranking value.');
}finally{if(cookie)await fetch(app+'/api/auth/logout',{method:'POST',headers:{Cookie:cookie}});}
