import assert from 'node:assert/strict';
import {testModuleLoader} from './load-test-module.mjs';
const clinic = '11111111-1111-4111-8111-111111111111', patient = '22222222-2222-4222-8222-222222222222';
let calls = 0, fail = false, selectedFields = "";
const route = testModuleLoader({}, {
  '../../../../lib/api-session': {createServerSupabaseClient: () => ({}), readAppSession: async () => ({session: {sessionMode: 'clinic', clinicId: clinic, userRole: 'receptionist'}}), ensureManagerSession() {throw Error('Unexpected manager');}},
  '../../../../lib/protected-data-server': {createProtectedDataClient: () => {calls++; let scoped = false, targeted = false; return {from(table) {
    assert.equal(table, 'clinic_patient_files');
    return {select(fields) {selectedFields = fields; return this;}, eq(field, value) {assert.equal(field, 'clinic_id'); assert.equal(value, clinic); scoped = true; return this;}, order() {return this;}, range() {return this;},
      in(field, ids) {assert.equal(field, 'patient_id'); assert.deepEqual(Array.from(ids), [patient]); targeted = true; return this;},
      then(resolve) {assert.ok(scoped && targeted); return Promise.resolve(fail ? {error: {message: 'private error'}} : {data: [{id: 'file', clinic_id: clinic, patient_id: patient, file_no: '0007', patients: {id: patient, name: 'TEST'}}], error: null}).then(resolve);},
    };
  }};}},
})('app/api/patients/clinic-records/route.ts');
const request = ids => new Request(`http://localhost/api/patients/clinic-records?${new URLSearchParams({clinicId: clinic, patientIds: ids})}`);
const empty = await route.GET(request('')); assert.equal(empty.status, 200); assert.equal(calls, 0);
assert.equal((await route.GET(request('not-a-uuid'))).status, 400); assert.equal(calls, 0);
const excessive = Array.from({length: 201}, (_, i) => `33333333-3333-4333-8333-${String(i).padStart(12, '0')}`).join(',');
assert.equal((await route.GET(request(excessive))).status, 400); assert.equal(calls, 0);
const result = await route.GET(request(`${patient},${patient}`)); assert.equal(result.status, 200);
const body = await result.json(); assert.equal(body.files[0].file_no, '0007'); assert.equal(body.patients[0].id, patient);
assert.match(selectedFields, /email, notes, date_of_birth, sex/);
const minimal = await route.GET(new Request(`http://localhost/api/patients/clinic-records?${new URLSearchParams({clinicId: clinic, patientIds: patient, minimal: 'true'})}`));
assert.equal(minimal.status, 200);
assert.match(selectedFields, /date_of_birth, mrn\)/);
assert.doesNotMatch(selectedFields, /email|notes|emirates_id|passport_number|address/);
fail = true; assert.equal((await route.GET(request(patient))).status, 503);
console.log('PASS: targeted file lookup validates clinic and patient filters, retains leading zeros, supports minimum registration fields, and reports query failures.');
