// Executes the actual profile loader with synthetic query latency, without production access.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {execFileSync} from 'node:child_process';
import {testModuleLoader} from './load-test-module.mjs';

const current = fs.readFileSync('components/pos-modals.tsx', 'utf8');
// Pin the pre-performance release so this comparison still works after committing.
const baseline = execFileSync('git', ['show', '3281a4ab259af9d12e549cafc33a148ea842903b:components/pos-modals.tsx'], {encoding: 'utf8'});
function extract(source, name = 'openProfile') {
  const tree = ts.createSourceFile('modal.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let fn;
  function walk(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) fn = node.getText(tree);
    ts.forEachChild(node, walk);
  }
  walk(tree);
  assert.ok(fn);
  return fn;
}
function harness(source, options = {}) {
  const fn = extract(source), state = {}, requests = [], alerts = [];
  const scope = {
    exports: {}, Error, Set, clinicId: 'clinic-a', profileLoadGeneration: {current: 0},
    resetTreatmentPlanForms() {}, alert: message => alerts.push(message),
    receptionistIdsForClinic: testModuleLoader()('lib/clinic-scope.ts').receptionistIdsForClinic,
    loadPatientNotes: async id => { await delay(options.delay?.(id) ?? 25); return {data: [{id: `note-${id}`}]}; },
    supabase: {from(table) {
      let fields = '*'; const filters = {};
      const query = {
        select(value) {fields = value; return query;},
        eq(key, value) {filters[key] = value; return query;},
        neq() {return query;}, order() {return query;}, limit() {return query;},
        in(key, values) {filters[key] = values; return query;},
        async then(resolve, reject) {
          requests.push({table, fields, filters: {...filters}});
          try {
            await delay(options.delay?.(filters.patient_id) ?? 25);
            if (options.fail) throw new Error('Simulated connection failure');
            const id = filters.patient_id || 'a';
            const rows = {
              receptionist: options.noReceptionists ? [] : [{id: 'staff-a', clinic_id: 'clinic-a', name: 'TEST'}],
              receipts: [{id: `receipt-${id}`, receptionist_id: 'staff-a', created_at: '2026-10-12'}],
              treatment_plans: [{id: `plan-${id}`}],
              receipt_items: [{receipt_id: filters.receipt_id?.[0]}],
              treatment_plan_visits: [{treatment_plan_id: filters.treatment_plan_id?.[0]}],
              treatment_plan_payments: [], treatment_plan_payment_records: [],
            };
            resolve({data: rows[table] || []});
          } catch (error) {reject(error);}
        },
      };
      return query;
    }},
  };
  for (const name of new Set(fn.match(/\bset[A-Z]\w+/g))) scope[name] = value => {state[name] = value;};
  const code = ts.transpileModule(fn + '\nexports.run = openProfile;', {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(code, scope);
  return {...scope.exports, state, requests, alerts};
}
function delay(ms) {return new Promise(resolve => setTimeout(resolve, ms));}
async function measure(source) {
  const times = []; let h;
  for (let i = 0; i < 5; i++) {
    h = harness(source); const start = performance.now();
    await h.run({id: 'a', clinic_patient_file_id: 'file-a'});
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  return {medianMs: Number(times[2].toFixed(2)), requests: h.requests.length, h};
}
const before = await measure(baseline), after = await measure(current);
assert.equal(before.requests - after.requests, 1, 'one duplicate receptionist read removed');
assert.ok(after.medianMs < before.medianMs * 0.8, 'independent requests overlap');
for (const key of ['setProfileReceipts', 'setProfileReceiptItems', 'setTreatmentPlans', 'setTreatmentPlanVisits', 'setLastVisit', 'setHistoricalVisits']) {
  assert.equal(JSON.stringify(after.h.state[key]), JSON.stringify(before.h.state[key]), key);
}
const race = harness(current, {delay: id => id === 'a' ? 70 : 5});
const first = race.run({id: 'a'}); await delay(2); const second = race.run({id: 'b'});
await Promise.all([first, second]);
assert.equal(race.state.setNotes[0].id, 'note-b');
assert.equal(race.state.setProfileReceipts[0].id, 'receipt-b');
assert.equal(race.state.setIsLoadingProfile, false);
const failed = harness(current, {fail: true});
await failed.run({id: 'a'});
assert.equal(failed.state.setIsLoadingProfile, false);
assert.equal(failed.alerts.length, 1);
const emptyClinic = harness(current, {noReceptionists: true});
await emptyClinic.run({id: 'a'});
assert.equal(emptyClinic.state.setLastVisit, null);
assert.equal(emptyClinic.requests.filter(r => r.table === 'receipts').length, 1);
// Page-local coalescing must not persist across login sessions or serve stale clinic data.
const patientFn = extract(fs.readFileSync('app/receipts/page.tsx', 'utf8'), 'loadClinicScopedPatientData');
const calls = [], pageState = {}, pageAlerts = [];
const pageScope = {
  exports: {}, Error, patientLoadGeneration: {current: 0}, pendingPatientLoad: {current: null},
  accessSession: {id: 'session-a'},
  setPatients: rows => {pageState.patients = rows;},
  setClinicPatientFiles: rows => {pageState.files = rows;},
  alert: message => pageAlerts.push(message),
  loadClinicPatientRecords: id => new Promise((resolve, reject) => calls.push({id, resolve, reject})),
};
vm.runInNewContext(ts.transpileModule(patientFn + '\nexports.run = loadClinicScopedPatientData;', {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText, pageScope);
const records = id => ({patients: [{id}], files: [{id}]});
const a = pageScope.exports.run('clinic-a'), duplicate = pageScope.exports.run('clinic-a');
assert.equal(calls.length, 1);
calls[0].resolve(records('a')); await Promise.all([a, duplicate]);
const fresh = pageScope.exports.run('clinic-a'); assert.equal(calls.length, 2);
const other = pageScope.exports.run('clinic-b');
calls[2].resolve(records('b')); await other;
calls[1].resolve(records('a')); await fresh;
assert.equal(pageState.patients[0].id, 'b');
const oldSession = pageScope.exports.run('clinic-b');
pageScope.accessSession = {id: 'session-b'};
const newSession = pageScope.exports.run('clinic-b');
assert.equal(calls.length, 5, 'new session must issue a new request');
calls[4].resolve(records('new-session')); await newSession;
calls[3].resolve(records('old-session')); await oldSession;
assert.equal(pageState.patients[0].id, 'new-session');
const failure = pageScope.exports.run('clinic-b'); calls[5].reject(new Error('Failed lookup')); await failure;
assert.equal(pageAlerts.length, 1); assert.equal(pageScope.pendingPatientLoad.current, null);
const cleared = pageScope.exports.run(null); await cleared;
assert.equal(pageState.patients.length, 0);
const result = {
  environment: 'Local synthetic data; actual profile function; 25 ms per mocked query. Not deployed latency.',
  before: {medianMs: before.medianMs, dataRequests: before.requests},
  after: {medianMs: after.medianMs, dataRequests: after.requests},
  checks: ['matching profile data', 'latest patient wins concurrent loads', 'loading clears on failure', 'empty clinic last-visit lookup skipped', 'overlapping clinic requests share one read', 'fresh loads are not cached', 'clinic and session changes discard stale results', 'failed clinic loads clear and allow retry'],
};
fs.writeFileSync('docs/security/patient-profile-performance-results.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
