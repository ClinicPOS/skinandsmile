import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source = fs.readFileSync(new URL('../app/api/patients/search/route.ts', import.meta.url), 'utf8');
let session = null, calls = 0, queryError = null, selectedFields = "";
const filters = [];
const chain = { select(v) { selectedFields = v; return this; }, eq(k,v) { filters.push([k,v]); return this; }, order() { return this; }, range(from,to) { filters.push(['range',from,to]); return this; }, or(v,opts) { filters.push(['or',v,opts]); return this; }, then(resolve) { return Promise.resolve({data: [{id:'file-id',file_no:'007',mrn:'SECRET-MRN',patients:{id:'fake',patient_number:7,name:'TEST',phone:'',email:'private@example.test',emirates_id:'SECRET-EID',passport_number:'SECRET-PASSPORT'}}],error:queryError}).then(resolve); } };
const deps = {
  '../../../../lib/api-session': { createServerSupabaseClient: () => ({}), readAppSession: async () => session ? {session} : {errorResponse:Response.json({}, {status:401})}, ensureManagerSession: s => s.sessionMode === 'manager' && ['ceo','it_admin'].includes(s.userRole) ? null : Response.json({}, {status:403}) },
  '../../../../lib/protected-data-server': { createProtectedDataClient: () => { calls++; return {from: () => chain}; } },
  '../../../../lib/patient-mutation-validation': { isUuid: v => typeof v === 'string' && /^[a-f0-9-]{36}$/.test(v) },
};
const scope = {exports:{}, require:n => deps[n], URL, Response, performance};
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,scope);
const clinic='11111111-1111-4111-8111-111111111111', other='22222222-2222-4222-8222-222222222222';
const request = (id,q='',offset='') => new Request(`http://localhost/api/patients/search?${new URLSearchParams({clinicId:id,q, ...(offset ? {offset} : {})})}`);
assert.equal((await scope.exports.GET(request(clinic))).status,401);
session={sessionMode:'clinic',clinicId:clinic,userRole:'receptionist'};
assert.equal((await scope.exports.GET(request(other))).status,403);
session={sessionMode:'reports',userRole:'reports'};
assert.equal((await scope.exports.GET(request(clinic))).status,403);
assert.equal(calls,0);
session={sessionMode:'clinic',clinicId:clinic,userRole:'receptionist'};
const result=await scope.exports.GET(request(clinic,'007'));
assert.equal(result.status,200);
assert.equal(result.headers.get('cache-control'),'no-store');
const body=await result.json();
assert.equal(body.patients[0].clinic_file_no,'007');
assert.equal(body.patients[0].name,'TEST');
assert.equal('email' in body.patients[0],false);
assert.equal('emirates_id' in body.patients[0],false);
assert.equal('passport_number' in body.patients[0],false);
assert.equal('clinic_file_mrn' in body.patients[0],false);
assert.equal(body.hasMore,false);
assert.match(selectedFields,/email, emirates_id, passport_number/);
assert.match(selectedFields,/patient_number, name, phone/);
assert.ok(filters.some(([k,v])=>k==='clinic_id'&&v===clinic));
assert.ok(filters.some(([k,v])=>k==='or'&&String(v).includes('file_no')));
assert.ok(filters.some(([k,v,opts])=>k==='or'&&String(v).includes('email')&&opts?.referencedTable==='patients'));
await scope.exports.GET(request(clinic,'TEST','200'));
assert.ok(filters.some(([k,from,to])=>k==='range'&&from===0&&to===400),'search pages fetch enough ordered candidates to deduplicate without skipping rows');
assert.equal((await scope.exports.GET(request(clinic,'','-1'))).status,400);
session={sessionMode:'manager',userRole:'ceo'};
assert.equal((await scope.exports.GET(request(other))).status,200);
queryError={message:'private database error'};
assert.equal((await scope.exports.GET(request(clinic))).status,503);
assert.doesNotMatch(fs.readFileSync(new URL('../app/search-patients/page.tsx',import.meta.url),'utf8'),/\.from\("clinic_patient_files"\)/);
console.log('PASS: search rejects unauthenticated, other-clinic and reports sessions; manager scope, clinic filter, leading zeros and query failure verified.');
