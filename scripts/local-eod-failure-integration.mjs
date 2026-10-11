// Read-only localhost fault tests. No production destinations or business writes.
import fs from 'node:fs';import path from 'node:path';import vm from 'node:vm';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import ts from 'typescript';import {createClient} from '@supabase/supabase-js';
const require=createRequire(import.meta.url),config=JSON.parse(fs.readFileSync(process.argv[2],'utf8').replace(/^\uFEFF/,''));assert.equal(config.API_URL,'http://127.0.0.1:54321');
const clinic='11111111-1111-4111-8111-111111111111',session={sessionMode:'clinic',userRole:'receptionist',clinicId:clinic};
let failTable='',queried=new Set();
const network=async(input,init)=>{const url=new URL(input);assert.equal(url.origin,config.API_URL);const table=url.pathname.split('/').pop();queried.add(table);if(table===failTable)return Response.json({message:'Injected local failure',code:'TEST'},{status:503});return fetch(input,init)};
const modules=new Map();
function load(file){file=path.resolve(file);if(modules.has(file))return modules.get(file);const exports={};modules.set(file,exports);vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,fetch:network,Response,Request,URL,URLSearchParams,Headers,Date,Intl,performance,Error,console:{warn(){},error(){}},require:name=>{
 if(name==='server-only')return {};
 if(name.endsWith('api-session'))return {ensureManagerSession:()=>null,ensureClinicScopeAccess:(s,id)=>s.clinicId!==id?Response.json({error:'Forbidden'},{status:403}):null};
 if(name.startsWith('.')){let p=path.resolve(path.dirname(file),name);if(!path.extname(p))p+=fs.existsSync(p+'.ts')?'.ts':'.js';return load(p)}return require(name);
}},{filename:file});return exports;}
const {createEodReadFetch}=load('lib/eod-data-client.ts'),{buildEodWorkbook}=load('lib/eod-workbook.ts');
const db=createClient(config.API_URL,config.SERVICE_ROLE_KEY,{global:{fetch:createEodReadFetch(network)},auth:{persistSession:false}});
const clinicRow=await db.from('clinics').select('id,name').eq('id',clinic).maybeSingle();assert.ok(clinicRow.data);
async function run(failed){failTable=failed;queried=new Set();const client=createClient(config.API_URL,config.SERVICE_ROLE_KEY,{global:{fetch:createEodReadFetch(network)},auth:{persistSession:false}});
 const read=async(input,init)=>{const request=new Request(new URL(input,'http://eod.internal'),init);const name=new URL(request.url).pathname;if(name==='/api/workspace/eod')return load('lib/read-eod-status.ts').readEodStatus(session,request,client);if(name==='/api/patients/report-details')return load('lib/read-report-patient-details.ts').readReportPatientDetails(session,request,client);if(name==='/api/patients/history')return load('lib/read-report-patient-history.ts').readReportPatientHistory(session,request,client);throw Error('Unexpected dependency')};
 const history=async(clinicId,patientIds)=>{const rows=[];for(let offset=0;offset<patientIds.length;offset+=200){const r=await read(`/api/patients/history?${new URLSearchParams({clinicId,patientIds:patientIds.slice(offset,offset+200).join(',')})}`);const data=await r.json();if(!r.ok)throw Error('Patient history unavailable');rows.push(...data.patients)}return rows};
 return buildEodWorkbook({supabase:client,activeClinic:clinicRow.data,fetch:read,loadClinicHistoryPatients:history,now:new Date('2026-10-07T08:00:00Z')});
}
const baseline=await run('');assert.ok(baseline.workbook);const tables=[...queried];assert.ok(tables.length>=15);
for(const table of tables)await assert.rejects(run(table),undefined,`Failed required ${table} read must prevent an export`);
console.log(`PASS: all ${tables.length} required EOD table failure scenarios reject the export; original server workbook succeeds on localhost.`);
