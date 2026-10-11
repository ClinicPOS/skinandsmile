import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import ts from 'typescript';
const clinic='11111111-1111-4111-8111-111111111111';
const patient='77777777-7777-4777-8777-777777777777';
let session={sessionMode:'clinic',clinicId:clinic}, calls=[];
const client={from(table){const call={table};calls.push(call);const query={select(){return query},eq(key,value){call[key]=value;return query},or(){return query},order(){return query},range(){return query},in(key,value){call.filter={key,value};return query},then(resolve){resolve({data:table==='patients'?[{id:patient,name:'TEST'}]:table==='clinic_patient_files'?[{patient_id:patient,file_no:'007'}]:[],error:null})}};return query}};
const exports={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/read-report-patient-history.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Response,URL,require(name){if(name==='server-only')return {};if(name.includes('api-session'))return {ensureManagerSession:()=>null};if(name.includes('patient-mutation-validation'))return {isUuid:value=>typeof value==='string'&&/^[a-f0-9-]{36}$/.test(value)};throw Error(name)}});
exports.GET=request=>exports.readReportPatientHistory(session,request,client);
const request=(id=clinic,ids=patient)=>new Request(`http://localhost/api?clinicId=${id}&patientIds=${ids}`);
assert.equal((await exports.GET(request())).status,200);
for(const call of calls.filter(call=>!['patients','receptionist'].includes(call.table)))assert.deepEqual(JSON.parse(JSON.stringify(call.filter)),{key:'patient_id',value:[patient]});
const before=calls.length;
assert.equal((await exports.GET(request(clinic,'invalid'))).status,400);
assert.equal((await exports.GET(request('22222222-2222-4222-8222-222222222222'))).status,403);
assert.equal(calls.length,before);
calls=[];
assert.equal((await exports.GET(new Request(`http://localhost/api?clinicId=${clinic}`))).status,200);
assert.ok(calls.filter(call=>!['patients','receptionist'].includes(call.table)).every(call=>!call.filter));
console.log('PASS: targeted EOD patient lookups retain clinic authorization, reject invalid IDs, filter all six history sources and preserve existing full-history reads.');


