import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
function load(file, deps = {}) {
 const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
 const mod = { exports: {} };
 new Function('require','module','exports', output)(name => { if (!(name in deps)) throw Error(`Blocked dependency ${name}`); return deps[name]; }, mod, mod.exports);
 return mod.exports;
}
const validation = load('lib/patient-mutation-validation.ts');
const clinicId='33333333-3333-4333-8333-333333333333';
const input={clinicId,fullName:'Test Patient',mobile:'0501234567',address:'Test',notes:'Test',clinicFileClinicalNotes:'Test'};
assert.ok(validation.validatePatientRegistration({...input,mobile:'1'.repeat(51)}).error);
assert.equal(validation.sessionCanAccessClinic({sessionMode:'reports',clinicId:null},clinicId),false);
let rpcCalls=0, failure;
const db={async rpc(){ rpcCalls++; return {data:{patient_id:'test-id',clinic_patient_file_id:'file-id',file_no:'001'},error:null}; },from(table){
 let updating=false;
 const q={update(){updating=true;return q;},select(){return q;},eq(){return q;},single(){return q;},then(resolve,reject){
 return Promise.resolve().then(()=>{
 if(failure==='network') throw Error('Connection lost');
 if(updating) return {error:failure===table?{code:'FAIL'}:null};
 return {data:failure==='reload'?null:{id:'test-id',name:'Test Patient'},error:null};
 }).then(resolve,reject);}}; return q;
}};
const {POST}=load('app/api/patients/register/route.ts',{
 '../../../../lib/protected-data-server':{createProtectedDataClient:()=>db},
 '../../../../lib/api-session':{createServerSupabaseClient:()=>db,readAppSession:async()=>({session:{sessionMode:'clinic',clinicId}})},
 '../../../../lib/patient-mutation-server':{canAccessClinicContext:async()=>true,operationResponse:(id,body,status=200)=>Response.json({...body,operationId:id},{status})},
 '../../../../lib/patient-mutation-validation':validation,
});
for(failure of ['patients','clinic_patient_files','reload','network',null]){
 rpcCalls=0;
 const response=await POST(new Request('http://test',{method:'POST',body:JSON.stringify(input)}));
 const body=await response.json();
 assert.equal(response.status,201);
 assert.equal(body.patientId,'test-id');
 assert.equal(rpcCalls,1);
 assert.equal(body.warnings.length>0,!!failure);
}
// Execute the real checkout-note block with a rejecting fetch and HTTP failure.
const checkout=fs.readFileSync('app/receipts/page.tsx','utf8');
const begin=checkout.indexOf('    if (notes.trim()) {',checkout.indexOf('  async function confirmPaymentAndSave'));
const end=checkout.indexOf('    return receiptData;',begin)+'    return receiptData;'.length;
const source=checkout.slice(begin,end);
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const run= new AsyncFunction('fetch','alert','notes','receiptData','transactionPatientId','doctorId','activeReceptionistId','receiptClinicId',source);
for(const fetch of [async()=>{throw Error('offline');},async()=>Response.json({error:'failed'},{status:500}),async()=>Response.json({},{status:201})]){
 const messages=[];const saved={id:'saved-receipt'};
 assert.equal(await run(fetch,m=>messages.push(m),'Test note',saved,'test-patient',null,null,clinicId),saved);
}
// Execute the real modal functions with a rejected request; saving must reset.
const modal=fs.readFileSync('components/pos-modals.tsx','utf8');
const tree=ts.createSourceFile('modal.tsx',modal,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const funcs=new Map();
function visit(node){if(ts.isFunctionDeclaration(node)&&['saveNewNote','saveEditNote','deleteNote'].includes(node.name?.text)) funcs.set(node.name.text,node.getText(tree));ts.forEachChild(node,visit);} visit(tree);
for(const [name,text] of funcs){
 const js=ts.transpileModule(text,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 let saving=false;const warnings=[];
 const fn=new Function('fetch','alert','confirm','selectedPatient','newNoteText','editingNoteText','editingNoteId','isSavingNote','setIsSavingNote',js+`;return ${name};`)(async()=>{throw Error('offline');},m=>warnings.push(m),()=>true,{id:'test'},'note','note','note-id',false,v=>{saving=v;});
 await fn('note-id');assert.equal(saving,false);assert.equal(warnings.length,1);
}
console.log('PASS: partial registration retains created ID; receipt survives note failure; note saving resets; validation and reports scope reject invalid inputs. No live access.');
