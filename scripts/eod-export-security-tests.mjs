import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';import ts from 'typescript';
import {gzipSync,gunzipSync} from 'node:zlib';
const clinic='11111111-1111-4111-8111-111111111111',foreign='22222222-2222-4222-8222-222222222222';
let session=null,authCalls=0,dataCalls=0,fail=false;
const exports={};
const db={from(){dataCalls++;const q={select(){return q},eq(){return q},maybeSingle:async()=>({data:{id:clinic,name:'TEST'},error:null})};return q}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('app/api/workspace/eod-export/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,performance,Date,Request,Response,URL,URLSearchParams,Error,Uint8Array,require:name=>{
 if(name==='node:zlib')return {gzipSync};
 if(name.includes('api-session'))return {createServerSupabaseClient:()=>({}),readAppSession:async()=>{authCalls++;return {session,errorResponse:Response.json({error:'Unauthorized'},{status:401})}},ensureClinicScopeAccess:(s,id)=>(s.sessionMode==='clinic'||s.userRole==='clinic_manager')&&s.clinicId!==id?Response.json({error:'Forbidden'},{status:403}):null};
 if(name.includes('patient-mutation-validation'))return {isUuid:id=>typeof id==='string'&&/^[a-f\d-]{36}$/i.test(id)};
 if(name.includes('eod-data-client'))return {createEodDataClient:()=>db};
 if(name.includes('read-eod-status'))return {readEodStatus:async()=>Response.json({pending:[]})};
 if(name.includes('read-report-patient-details'))return {readReportPatientDetails:async()=>Response.json({patients:[],fileNumbers:[]})};
 if(name.includes('read-report-patient-history'))return {readReportPatientHistory:async()=>Response.json({patients:[]})};
 if(name.includes('eod-workbook'))return {buildEodWorkbook:async context=>{assert.equal(context.activeClinic.id,clinic);if(fail)throw Error('Required dependency unavailable');assert.equal((await context.fetch('/api/workspace/eod')).status,200);assert.equal((await context.loadClinicHistoryPatients(clinic,[])).length,0);return {workbook:{SheetNames:['Daily Summary'],Sheets:{}},fileName:'TEST.xlsx',warnings:[],timings:{dataAndCalculationMs:5,workbookMs:1}}}};
 throw Error(name);
}});
async function request(body={clinicId:clinic}){const before=authCalls;const response=await exports.POST(new Request('http://local.test/api/workspace/eod-export',{method:'POST',body:JSON.stringify(body)}));assert.equal(authCalls,before+1,'Each export must verify current access exactly once');return response;}
assert.equal((await request()).status,401);assert.equal(dataCalls,0);
session={sessionMode:'clinic',userRole:'receptionist',clinicId:clinic};assert.equal((await request({clinicId:foreign})).status,403);assert.equal(dataCalls,0);
assert.equal((await request({clinicId:'bad'})).status,400);assert.equal((await request({clinicId:clinic,day:'2026-02-31'})).status,400);assert.equal(dataCalls,0);
const success=await request();assert.equal(success.status,200);assert.match(success.headers.get('cache-control'),/private.*no-store/);assert.ok(success.headers.get('server-timing'));assert.equal(JSON.parse(gunzipSync(Buffer.from(await success.arrayBuffer()))).fileName,'TEST.xlsx');
session={sessionMode:'manager',userRole:'clinic_manager',clinicId:clinic,permissions:[]};assert.equal((await request()).status,403);
session.permissions=['reports'];assert.equal((await request({clinicId:foreign})).status,403);assert.equal((await request()).status,200);
session={sessionMode:'manager',userRole:'owner'};assert.equal((await request()).status,200);
session={sessionMode:'manager',userRole:'ceo'};assert.equal((await request()).status,403);
session={sessionMode:'clinic',userRole:'receptionist',clinicId:clinic};fail=true;const blocked=await request();assert.equal(blocked.status,503);assert.equal((await blocked.json()).workbook,undefined);
session=null;assert.equal((await request()).status,401,'Revoked access must fail on the next export');
console.log('PASS: one fresh authorization per export; anonymous, revoked, foreign-clinic and unassigned-role denial; invalid dates; required failure blocks workbook; private no-store timings.');
