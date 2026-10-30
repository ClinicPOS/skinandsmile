import assert from 'node:assert/strict';
import fs from 'node:fs';
import {testModuleLoader} from './load-test-module.mjs';
const clinic = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222';
const id = (prefix, n) => `${prefix}-3333-4333-8333-${String(n).padStart(12,'0')}`;
const staff = id('44444444', 1), foreignStaff = id('44444444', 2);
const rows = {
  receptionist: [{id: staff, clinic_id: clinic}, {id: foreignStaff, clinic_id: other}],
  patients: Array.from({length: 10000}, (_, n) => ({id: id('55555555', n), name: `TEST ${n}`, phone: 'TEST', patient_number: n})),
  clinic_patient_files: Array.from({length: 10000}, (_, n) => ({id: id('66666666', n), clinic_id: clinic, patient_id: id('55555555', n), file_no: String(n).padStart(5,'0')})),
  receipts: Array.from({length: 10000}, (_, n) => ({id: id('77777777', n), clinic_id: clinic, receptionist_id: staff, patient_id: id('55555555', n), total: 100, status: n === 0 ? 'VOIDED' : 'COMPLETED', created_at: n < 75 ? '2026-10-13T20:00:00Z' : '2026-10-12T10:00:00Z'})),
  treatment_plan_payment_records: [{id: id('88888888', 1), clinic_id: clinic, patient_id: id('55555555', 0), receptionist_id: staff, treatment_plan_id: id('99999999', 0), status: 'cancelled', created_at: '2026-10-14T19:59:59Z'}],
};
// Boundary and attribution cases; explicit clinic takes priority over receptionist.
rows.receipts.push(
  {id: id('77777777', 10001), clinic_id: clinic, receptionist_id: foreignStaff, patient_id: id('55555555',0), created_at: '2026-10-14T19:59:59Z'},
  {id: id('77777777', 10002), clinic_id: null, receptionist_id: staff, patient_id: id('55555555',0), created_at: '2026-10-14T10:00:00Z'},
  {id: id('77777777', 10003), clinic_id: other, receptionist_id: staff, patient_id: id('55555555',0), created_at: '2026-10-14T10:00:00Z'},
  {id: id('77777777', 10004), clinic_id: clinic, receptionist_id: staff, patient_id: id('55555555',0), created_at: '2026-10-14T20:00:00Z'},
);
function client(delay = 0, failure = '') {
  const calls = [];
  return {calls, from(table) {
    const filters = [], orders = []; let offset = 0, limit = 1000, fields = '*';
    const query = {
      select(value) {fields = value; return query;},
      eq(field, value) {filters.push(row => row[field] === value); return query;},
      in(field, values) {filters.push(row => values.includes(row[field])); return query;},
      gte(field, value) {filters.push(row => Date.parse(row[field]) >= Date.parse(value)); return query;},
      lt(field, value) {filters.push(row => Date.parse(row[field]) < Date.parse(value)); return query;},
      order(field, options = {}) {orders.push([field, options.ascending !== false]); return query;},
      range(from, to) {offset = from; limit = to - from + 1; return query;},
      or(scope) {
        const cid = scope.match(/^clinic_id\.eq\.([a-f0-9-]+)/)?.[1]; assert.ok(cid);
        const staffIds = scope.match(/receptionist_id\.in\.\(([^)]+)\)/)?.[1]?.split(',') || [];
        filters.push(row => row.clinic_id === cid || row.clinic_id == null && staffIds.includes(row.receptionist_id)); return query;
      },
      async then(resolve) {
        calls.push({table, offset, limit});
        if (delay) await new Promise(r => setTimeout(r, delay));
        if (failure === table) return resolve({data: null, error: {message: 'TEST failure'}});
        let data = (rows[table] || []).filter(row => filters.every(filter => filter(row)));
        data.sort((a,b) => {for (const [field, ascending] of orders) {if (a[field] !== b[field]) return (a[field] > b[field] ? 1 : -1) * (ascending ? 1 : -1);} return 0;});
        data = data.slice(offset, offset + limit);
        if (fields !== '*') data = data.map(row => Object.fromEntries(fields.split(',').map(field => field.trim()).map(field => [field, row[field]])));
        return resolve({data, error: null});
      },
    }; return query;
  }};
}
const {readModalReceiptHistory, historyDateRange} = testModuleLoader()('lib/read-modal-receipt-history.ts');
assert.deepEqual(JSON.parse(JSON.stringify(historyDateRange('2026-10-14'))), {start: '2026-10-14T00:00:00+04:00', end: '2026-10-15T00:00:00+04:00'});
assert.throws(() => historyDateRange('2026-02-30')); assert.throws(() => historyDateRange('garbage'));
const dataClient = client(), first = await readModalReceiptHistory(dataClient, clinic, 'receipt', 0, '2026-10-14');
const second = await readModalReceiptHistory(dataClient, clinic, 'receipt', 50, '2026-10-14');
assert.equal(first.receipts.length, 50); assert.equal(second.receipts.length, 27); assert.equal(first.hasMore, true); assert.equal(second.hasMore, false);
assert.equal(first.receipts[0].id, id('77777777',10001));
const seen = [...first.receipts, ...second.receipts];
assert.equal(new Set(seen.map(row => row.id)).size, 77);
assert.ok(seen.some(row => row.id === id('77777777',10002))); // legacy clinic
assert.ok(!seen.some(row => row.id === id('77777777',10003) || row.id === id('77777777',10004)));
assert.ok(seen.some(row => row.status === 'VOIDED'));
assert.equal(first.patients.length, 49); // repeated patient on the bounded page
assert.equal(first.patients.find(row => row.id === id('55555555',0)).clinic_file_no, '00000');
assert.ok(dataClient.calls.every(call => !call.table.startsWith('treatment_plan')));
const plans = await readModalReceiptHistory(client(), clinic, 'plan', 0, '2026-10-14');
assert.equal(plans.planPayments.length, 1); assert.equal(plans.planPayments[0].status, 'cancelled'); assert.equal(plans.receipts.length, 0);
const emptyClient = client(), empty = await readModalReceiptHistory(emptyClient, clinic, 'receipt', 0, '2027-01-01');
assert.equal(empty.receipts.length, 0); assert.ok(!emptyClient.calls.some(call => call.table === 'patients'));
await assert.rejects(readModalReceiptHistory(client(0, 'receipts'), clinic, 'receipt', 0, null));
// Execute the actual authenticated API, checking denial occurs before any data query.
let session = null; const apiClient = client();
const auth = testModuleLoader()('lib/api-session.ts');
const route = testModuleLoader({}, {
  '../../../../lib/api-session': {readAppSession: async () => session ? {session} : {errorResponse: Response.json({}, {status: 401})}, ensureClinicScopeAccess: auth.ensureClinicScopeAccess},
  '../../../../lib/protected-data-server': {createProtectedDataClient: () => apiClient},
})('app/api/receipts/history/route.ts');
const request = (cid = clinic, kind = 'receipt', date = '2026-10-14') => new Request(`http://localhost/api/receipts/history?${new URLSearchParams({clinicId: cid, kind, date})}`);
assert.equal((await route.GET(request())).status, 401);
session = {sessionMode: 'clinic', userRole: 'receptionist', clinicId: clinic};
assert.equal((await route.GET(request(other))).status, 403);
assert.equal((await route.GET(request(clinic, 'bad'))).status, 400);
assert.equal((await route.GET(request(clinic, 'receipt', '2026-02-30'))).status, 400);
assert.equal(apiClient.calls.length, 0);
const allowed = await route.GET(request()); assert.equal(allowed.status, 200); assert.equal(allowed.headers.get('cache-control'), 'no-store');
assert.equal((await allowed.json()).receipts.length, 50);
// Confirm the source of excessive data loading with a controlled per-query delay.
const oldClient = client(1), newClient = client(1);
const oldReader = testModuleLoader()('lib/read-report-patient-history.ts').readReportPatientHistory;
let start = performance.now(); const oldResponse = await oldReader(session, new Request(`http://localhost/api/patients/history?clinicId=${clinic}`), oldClient); const beforeMs = performance.now() - start;
assert.equal(oldResponse.status, 200); const oldPatients = await oldResponse.json();
start = performance.now(); const page = await readModalReceiptHistory(newClient, clinic, 'receipt', 0, '2026-10-14'); const afterMs = performance.now() - start;
assert.equal(oldPatients.patients.length, 10000); assert.ok(oldClient.calls.length > newClient.calls.length * 10);
const result = {environment: 'Synthetic 10,000-patient clinic; actual old patient-history reader and new page reader; 1 ms simulated query delay. Not live end-to-end latency.',
  before: {ms: Number(beforeMs.toFixed(2)), patientRows: oldPatients.patients.length, queries: oldClient.calls.length},
  after: {ms: Number(afterMs.toFixed(2)), patientRows: page.patients.length, receiptRows: page.receipts.length, queries: newClient.calls.length},
  checks: ['Dubai day boundaries', '50-row pages without gaps or duplicates', 'explicit and legacy clinic attribution', 'targeted patient/file lookups', 'no treatment reads for regular receipts', 'VOIDED/cancelled history retained', 'invalid dates and cross-clinic requests denied', 'empty/error handling']};
fs.writeFileSync('docs/security/receipt-modal-speed-results.json', JSON.stringify(result,null,2) + '\n');
console.log(JSON.stringify(result,null,2));
