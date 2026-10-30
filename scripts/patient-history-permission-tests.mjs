import assert from 'node:assert/strict';
import {testModuleLoader} from './load-test-module.mjs';

const clinic='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',patient='33333333-3333-4333-8333-333333333333';
let calls=[],fail=false,session=null;
const db={from(table){
 const call={table,filters:[]};calls.push(call);
 const query={then(resolve){return Promise.resolve({data:table==='patients'?[{id:patient,name:'TEST',phone:'TEST PHONE'}]:table==='clinic_patient_files'?[{patient_id:patient,file_no:'007'}]:[],error:fail?{message:'TEST unavailable'}:null}).then(resolve);}};
 for(const method of ['select','eq','or','in','order','range'])query[method]=(...args)=>{call.filters.push([method,...args]);return query;};return query;
}};
const load=testModuleLoader({}, {
 '../../../../lib/api-session':{createServerSupabaseClient:()=>({}),readAppSession:async()=>session?{session}:{errorResponse:Response.json({error:'Unauthorized'},{status:401})}},
 '../../../../lib/protected-data-server':{createProtectedDataClient:()=>db},
});
const route=load('app/api/patients/history/route.ts');
const read=load('lib/read-report-patient-history.ts').readReportPatientHistory;
const request=(id=clinic,ids)=>new Request(`http://test/api/patients/history?${new URLSearchParams({clinicId:id,...(ids===undefined?{}:{patientIds:ids})})}`);
assert.equal((await route.GET(request())).status,401);assert.equal(calls.length,0);
for(const permissions of [undefined,[],['services'],['doctors','receptionists']]){
 session={sessionMode:'manager',userRole:'clinic_manager',clinicId:clinic,permissions};
 assert.equal((await route.GET(request())).status,403);
 assert.equal((await read(session,request(clinic,patient),db)).status,403,'Internal EOD reader must also enforce permission');
 assert.equal(calls.length,0,'Denied manager must not query patient data');
}
session.permissions=['reports'];
assert.equal((await route.GET(request(other))).status,403);assert.equal(calls.length,0);
const allowed=await route.GET(request(clinic,patient));assert.equal(allowed.status,200);
assert.equal((await allowed.json()).patients[0].clinic_file_no,'007');
assert.equal(allowed.headers.get('cache-control'),'no-store');
for(const call of calls.filter(call=>!['patients','receptionist'].includes(call.table)))assert.ok(call.filters.some(([method,key,ids])=>method==='in'&&key==='patient_id'&&ids[0]===patient));
for(const userRole of ['owner','ceo','it_admin']){session={sessionMode:'manager',userRole,clinicId:null};assert.equal((await route.GET(request())).status,200);}
session={sessionMode:'clinic',userRole:'receptionist',clinicId:clinic};assert.equal((await route.GET(request())).status,200);
assert.equal((await route.GET(request(other))).status,403);
session={sessionMode:'reports',userRole:'reports',clinicId:null};assert.equal((await route.GET(request())).status,403);
session={sessionMode:'manager',userRole:'clinic_manager',clinicId:clinic,permissions:['reports']};
assert.equal((await route.GET(request(clinic,'bad'))).status,400);
assert.equal((await route.GET(request(clinic,Array(201).fill(patient).map((_,i)=>`${String(i).padStart(8,'0')}-1111-4111-8111-111111111111`).join(',')))).status,400);
fail=true;assert.equal((await route.GET(request())).status,503);
console.log('PASS: patient-history route and shared reader reject managers without reports permission before database queries; existing roles, clinic scope, patient filters and failure handling preserved. Fake data only.');
