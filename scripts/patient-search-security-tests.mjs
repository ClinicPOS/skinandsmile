import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source = fs.readFileSync(new URL('../app/api/patients/search/route.ts', import.meta.url), 'utf8');
let session = null, calls = 0, queryError = null;
const filters = [];
const chain = { select() { return this; }, eq(k,v) { filters.push([k,v]); return this; }, order() { return this; }, limit() { return this; }, or(v) { filters.push(['or',v]); return this; }, then(resolve) { return Promise.resolve({data: [{file_no:'007',patients:{id:'fake',name:'TEST',phone:''}}],error:queryError}).then(resolve); } };
const deps = {
  '../../../../lib/api-session': { createServerSupabaseClient: () => ({}), readAppSession: async () => session ? {session} : {errorResponse:Response.json({}, {status:401})}, ensureManagerSession: s => s.sessionMode === 'manager' && ['ceo','it_admin'].includes(s.userRole) ? null : Response.json({}, {status:403}) },
  '../../../../lib/protected-data-server': { createProtectedDataClient: () => { calls++; return {from: () => chain}; } },
  '../../../../lib/patient-mutation-validation': { isUuid: v => typeof v === 'string' && /^[a-f0-9-]{36}$/.test(v) },
};
const scope = {exports:{}, require:n => deps[n], URL, Response, performance};
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,scope);
const clinic='11111111-1111-4111-8111-111111111111', other='22222222-2222-4222-8222-222222222222';
const request = (id,q='') => new Request(`http://localhost/api/patients/search?${new URLSearchParams({clinicId:id,q})}`);
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
assert.equal((await result.json()).patients[0].clinic_file_no,'007');
assert.ok(filters.some(([k,v])=>k==='clinic_id'&&v===clinic));
assert.ok(filters.some(([k,v])=>k==='file_no'&&v==='007'));
session={sessionMode:'manager',userRole:'ceo'};
assert.equal((await scope.exports.GET(request(other))).status,200);
queryError={message:'private database error'};
assert.equal((await scope.exports.GET(request(clinic))).status,503);
assert.doesNotMatch(fs.readFileSync(new URL('../app/search-patients/page.tsx',import.meta.url),'utf8'),/\.from\("clinic_patient_files"\)/);
console.log('PASS: search rejects unauthenticated, other-clinic and reports sessions; manager scope, clinic filter, leading zeros and query failure verified.');
