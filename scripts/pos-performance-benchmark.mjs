// Repeatable local measurements. Not deployed latency and not a provider save.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {randomUUID as uuid} from 'node:crypto';
import ts from 'typescript';
import vm from 'node:vm';
import {createVoidTestDatabase} from './void-test-database.mjs';
import {testModuleLoader} from './load-test-module.mjs';
async function measure(work,iterations=7){const times=[];let result;await work();for(let i=0;i<iterations;i++){const start=performance.now();result=await work();times.push(performance.now()-start);}times.sort((a,b)=>a-b);return {medianMs:Number(times[Math.floor(times.length/2)].toFixed(2)),p95Ms:Number(times.at(-1).toFixed(2)),result};}
const patients=Array.from({length:10000},(_,i)=>({id:`TEST-${i}`,name:`TEST Patient ${i}`,phone:`050${i}`,clinic_file_no:String(i)}));
const source=fs.readFileSync('components/pos-modals.tsx','utf8'),filename=path.resolve('components/pos-modals.tsx');
const after=testModuleLoader()('components/pos-modals.tsx').SearchPatientModal;
const before=testModuleLoader({}, {}, {[filename]:source.replace('filteredPatients.slice(0,patientDisplayLimit).map','filteredPatients.map')})('components/pos-modals.tsx').SearchPatientModal;
const props={isOpen:true,onClose(){},onSelect(){},patients,clinicId:'TEST'};
const beforeRender=await measure(()=>renderToStaticMarkup(React.createElement(before,props)),5);
const afterRender=await measure(()=>renderToStaticMarkup(React.createElement(after,props)),5);
assert.ok(afterRender.result.length<beforeRender.result.length/20);
const search=await measure(()=>patients.filter(p=>p.name.toLowerCase().includes('999')||p.phone.includes('999')),20);
// Extract the real save function and measure requests with a controlled 25ms round trip.
const page=fs.readFileSync('app/receipts/page.tsx','utf8'),tree=ts.createSourceFile('page.tsx',page,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let save;function find(node){if(ts.isFunctionDeclaration(node)&&node.name?.text==='savePatientDetails')save=node;ts.forEachChild(node,find);}find(tree);assert.ok(save);
const savedPatient={id:'TEST',name:'TEST Patient',phone:'0500000000'};
let requests=0;
const scope={exports:{},patients:[savedPatient],buildPatientDetailsPayload:()=>({name:'TEST Patient',phone:'0500000000'}),activeClinic:{id:'TEST'},setPatients(){},console,Error,encodeURIComponent,
 patientDetailChanges:testModuleLoader()('lib/patient-detail-changes.ts').patientDetailChanges,
 fetch:async()=>{requests++;await new Promise(resolve=>setTimeout(resolve,25));return Response.json({});}};
function compiledSave(baseline){const code=baseline?save.getText(tree).replace(/const sanitizedPayload = patientDetailChanges\([\s\S]*?\n    \);/,'const sanitizedPayload = buildPatientDetailsPayload();'):save.getText(tree);vm.runInNewContext(ts.transpileModule(code+'\nexports.run=savePatientDetails;',{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,scope);return scope.exports.run;}
requests=0;const beforeSave=await measure(()=>compiledSave(true)('TEST'),5);const beforeRequests=requests;requests=0;const afterSave=await measure(()=>compiledSave(false)('TEST'),5);const afterRequests=requests;assert.equal(afterRequests,0);
const db=await createVoidTestDatabase(),clinic=uuid(),patient=uuid(),rec=uuid();
await db.exec(fs.readFileSync('supabase/migrations/20261012175015_pos_history_pagination.sql','utf8'));
let database;
try{
 await db.query('insert into clinics(id,name) values($1,$2)',[clinic,'TEST']);await db.query('insert into patients(id,name) values($1,$2)',[patient,'TEST']);await db.query('insert into receptionist(id,name,pin,clinic_id) values($1,$2,$3,$4)',[rec,'TEST','unused',clinic]);
 await db.query(`insert into receipts(id,clinic_id,patient_id,receptionist_id,total,created_at) select gen_random_uuid(),$1,$2,$3,210,'2026-09-01'::timestamptz+g*interval '1 minute' from generate_series(1,10000) g`,[clinic,patient,rec]);
 await db.exec('analyze receipts;');
 const all=await measure(()=>db.query('select * from receipts where clinic_id=$1 order by created_at desc limit 1000',[clinic]));
 const paged=await measure(()=>db.query('select public.pos_receipt_history_page($1,0,50) p',[clinic]));
 assert.equal(paged.result.rows[0].p.receipts.length,50);assert.equal(paged.result.rows[0].p.hasMore,true);
 const page2=(await db.query('select public.pos_receipt_history_page($1,50,50) p',[clinic])).rows[0].p;
 assert.ok(!page2.receipts.some(row=>paged.result.rows[0].p.receipts.some(first=>first.id===row.id)));
 database={datasetReceipts:10000,oldQueryMs:all.medianMs,newQueryMs:paged.medianMs,oldPayloadBytes:Buffer.byteLength(JSON.stringify(all.result.rows)),newPayloadBytes:Buffer.byteLength(JSON.stringify(paged.result.rows[0].p)),oldVisibleRows:all.result.rows.length,newVisibleRows:50,plan:(await db.query('explain (analyze,buffers) select * from receipts where clinic_id=$1 order by created_at desc,id desc limit 50',[clinic])).rows};
}finally{await db.close();}
const result={date:'2026-10-12',environment:'Local synthetic fixtures; PostgreSQL WASM and React server rendering. No production contact.',patientSearch:{patients:10000,filterMs:search.medianMs,beforeRenderMs:beforeRender.medianMs,afterRenderMs:afterRender.medianMs,beforeHtmlBytes:Buffer.byteLength(beforeRender.result),afterHtmlBytes:Buffer.byteLength(afterRender.result)},unchangedPatientSave:{simulatedRoundTripMs:25,beforeMs:beforeSave.medianMs,afterMs:afterSave.medianMs,beforeRequests,afterRequests},receiptHistory:database};
fs.writeFileSync('docs/security/pos-performance-local-results.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
