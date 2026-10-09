import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const clinic='11111111-1111-4111-8111-111111111111', other='22222222-2222-4222-8222-222222222222';
const rows=Array.from({length:501},(_,i)=>({id:`file-${i}`,clinic_id:clinic,patient_id:`patient-${i}`,file_no:String(i).padStart(3,'0'),mrn:i===500?' abc ':null,patients:{id:`patient-${i}`,name:'TEST',phone:'',mrn:null}}));
let session=null,calls=0,pages=0;
const deps={
  '../../../../lib/api-session':{createServerSupabaseClient:()=>({}),readAppSession:async()=>session?{session}:{errorResponse:Response.json({}, {status:401})},ensureManagerSession:s=>s.sessionMode==='manager'&&s.userRole==='ceo'?null:Response.json({}, {status:403})},
  '../../../../lib/protected-data-server':{createProtectedDataClient:()=>{calls++;return {from:()=>({select(v){assert.doesNotMatch(v,/\*/);return this;},eq(k,v){assert.equal(k,'clinic_id');assert.equal(v,clinic);return this;},order(k){assert.equal(k,'id');return this;},async range(a,b){pages++;return {data:rows.slice(a,b+1),error:null};}})};}},
  '../../../../lib/patient-mutation-validation':{isUuid:v=>typeof v==='string'&&/^[a-f0-9-]{36}$/.test(v)},
  '../../../../lib/patient-registration':{normalizeMrn:v=>String(v||'').trim().toUpperCase()},
};
for(const name of ['clinic-records','mrn-matches']) {
 const source=fs.readFileSync(new URL(`../app/api/patients/${name}/route.ts`,import.meta.url),'utf8');
 const scope={exports:{},require:n=>deps[n],URL,Response};
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,scope);
 const request=id=>new Request(`http://localhost/api/patients/${name}?clinicId=${id}&mrn=ABC`);
 session=null;calls=0;pages=0;
 assert.equal((await scope.exports.GET(request(clinic))).status,401);
 session={sessionMode:'clinic',clinicId:clinic,userRole:'receptionist'};
 assert.equal((await scope.exports.GET(request(other))).status,403);
 assert.equal(calls,0);
 const res=await scope.exports.GET(request(clinic));assert.equal(res.status,200);
 const body=await res.json();assert.equal(pages,2);
 if(name==='clinic-records') {assert.equal(body.patients.length,501);assert.equal(body.files[0].file_no,'000');}
 else {assert.equal(body.matches.length,1);assert.equal(body.matches[0].patientId,'patient-500');}
}
console.log('PASS: clinic record and MRN routes reject unauthorized access; clinic filters, field lists, 501-row pagination and MRN normalization verified.');
