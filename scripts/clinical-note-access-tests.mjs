import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { webcrypto } from 'node:crypto';
const source = fs.readFileSync(new URL('../app/api/patient-notes/route.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const patient = '77777777-7777-4777-8777-777777777777';
const clinic = '11111111-1111-4111-8111-111111111111';
let session = null;
let allowed = false;
let privilegedCalls = 0;
const filters = [];
const chain = { select() { return this; }, eq(k,v) { filters.push([k,v]); return this; }, order() { return this; }, range() { return this; }, then(resolve) { return Promise.resolve({ data: [{ id: 'fake-note', note: 'fake text' }], error: null }).then(resolve); } };
const deps = {
  '../../../lib/api-session': { createServerSupabaseClient: () => ({}), readAppSession: async () => session ? { session } : { errorResponse: Response.json({}, { status: 401 }) } },
  '../../../lib/patient-mutation-server': { canAccessPatientContext: async () => allowed, operationResponse: (id,body,status=200) => Response.json(body,{status}) },
  '../../../lib/patient-mutation-validation': { isUuid: v => typeof v === 'string' && /^[a-f0-9-]{36}$/.test(v), validateNoteText: () => ({}) },
  '../../../lib/protected-data-server': { createProtectedDataClient: () => { privilegedCalls++; return { from: table => { assert.equal(table,'patient_notes');return chain; } }; } },
};
const scope = { exports: {}, require: name => { if (!(name in deps)) throw Error(name); return deps[name]; }, crypto: webcrypto, Response, URL };
vm.runInNewContext(compiled, scope);
const request = new Request(`http://localhost/api/patient-notes?patientId=${patient}&clinicId=${clinic}`);
assert.equal((await scope.exports.GET(request)).status,401);
session = { sessionMode: 'clinic', clinicId: clinic };
assert.equal((await scope.exports.GET(request)).status,403);
assert.equal(privilegedCalls,0,'Unauthorized callers never receive protected client access');
allowed = true;
assert.equal((await scope.exports.GET(request)).status,200);
assert.ok(filters.some(([k,v]) => k === 'patient_id' && v === patient));
assert.ok(filters.some(([k,v]) => k === 'clinic_id' && v === clinic));
const ui = fs.readFileSync(new URL('../components/pos-modals.tsx', import.meta.url),'utf8');
assert.doesNotMatch(ui,/\.from\("patient_notes"\)/);
console.log('PASS: unauthorized note reads blocked before privileged access; allowed reads filter by patient and clinic; browser direct note access removed. Fake data only.');
