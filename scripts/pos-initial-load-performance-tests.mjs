import assert from 'node:assert/strict';
import fs from 'node:fs';
import {testModuleLoader} from './load-test-module.mjs';

const clinic = '11111111-1111-4111-8111-111111111111';
const otherClinic = '22222222-2222-4222-8222-222222222222';
const patient = '33333333-3333-4333-8333-333333333333';
const balanceId = '44444444-4444-4444-8444-444444444444';
let session = {sessionMode: 'clinic', clinicId: clinic, userRole: 'receptionist'};
let failPage = null;
let missingCreditsTable = false;
let missingCreditsCode = '42P01';
const queries = [];
const records = {
  outstanding_balances: [
    {id: balanceId, patient_id: patient, clinic_id: clinic, original_date: '2026-01-01', original_amount: 2000, reason: 'synthetic', reference_number: null, created_by: null, created_at: '2026-01-01'},
    {id: '55555555-5555-4555-8555-555555555555', patient_id: patient, clinic_id: otherClinic, original_date: '2026-01-01', original_amount: 9000, reason: 'other clinic', reference_number: null, created_by: null, created_at: '2026-01-01'},
  ],
  balance_payments: Array.from({length: 1205}, (_, i) => ({id: `payment-${i}`, outstanding_balance_id: balanceId, amount: 1, payment_method: 'Cash', status: 'completed', created_at: '2026-01-01'})),
  patient_credits: Array.from({length: 1205}, (_, i) => ({id: `credit-${i}`, patient_id: patient, clinic_id: clinic, amount: 0.01, status: 'completed', created_at: '2026-01-01'})),
};

const load = testModuleLoader({}, {
  '../../../../lib/api-session': {
    createServerSupabaseClient: () => ({}),
    readAppSession: async () => session ? {session} : {errorResponse: Response.json({}, {status: 401})},
    ensureManagerSession: value => value.sessionMode === 'manager' && ['ceo', 'it_admin'].includes(value.userRole) ? null : Response.json({}, {status: 403}),
  },
  '../../../../lib/protected-data-server': {
    createProtectedDataClient: () => ({from(table) {
      const filters = [];
      const query = {
        select() { return this; },
        eq(field, value) { filters.push({kind: 'eq', field, value}); return this; },
        in(field, value) { filters.push({kind: 'in', field, value: Array.from(value)}); return this; },
        neq(field, value) { filters.push({kind: 'neq', field, value}); return this; },
        order() { return this; },
        range(from, to) {
          queries.push({table, filters: structuredClone(filters), from, to});
          if (failPage?.table === table && failPage.from === from) return Promise.resolve({data: null, error: {message: 'synthetic page failure'}});
          if (missingCreditsTable && table === 'patient_credits') return Promise.resolve({data: null, error: {code: missingCreditsCode, message: 'table missing'}});
          let rows = records[table] || [];
          for (const filter of filters) {
            if (filter.kind === 'eq') rows = rows.filter(row => row[filter.field] === filter.value);
            if (filter.kind === 'in') rows = rows.filter(row => filter.value.includes(row[filter.field]));
            if (filter.kind === 'neq') rows = rows.filter(row => row[filter.field] !== filter.value);
          }
          return Promise.resolve({data: rows.slice(from, to + 1), error: null});
        },
      };
      return query;
    }}),
  },
  '../../../../lib/patient-mutation-validation': {isUuid: value => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value)},
})('app/api/patients/financials/route.ts');

const route = await load;
const posPage = fs.readFileSync(new URL('../app/receipts/page.tsx', import.meta.url), 'utf8');
const posModal = fs.readFileSync(new URL('../components/pos-modals.tsx', import.meta.url), 'utf8');
const loadDataSource = posPage.match(/async function loadData\(\) \{[\s\S]*?\n  \}/)?.[0] || '';
assert.ok(loadDataSource, 'POS startup data loader remains identifiable');
const startupTableReads = (loadDataSource.match(/supabase\.from\(/g) || []).length;
assert.equal(startupTableReads, 4, 'startup keeps only doctors, receptionists, services, and clinic reads');
assert.doesNotMatch(loadDataSource, /outstanding_balances|balance_payments|patient_credits|loadClinicPatientRecords/);
assert.doesNotMatch(posPage, /supabase\.from\("outstanding_balances"\)|supabase\.from\("balance_payments"\)|supabase\.from\("patient_credits"\)/);
assert.match(posModal, /fetch\(`\/api\/patients\/search\?/);
assert.match(posModal, /patientIds: results\.map/);
const financialUrl = params => `http://localhost/api/patients/financials?${new URLSearchParams({clinicId: clinic, ...params})}`;

session = null;
assert.equal((await route.GET(new Request(financialUrl({patientId: patient})))).status, 401);
session = {sessionMode: 'clinic', clinicId: clinic, userRole: 'receptionist'};
assert.equal((await route.GET(new Request(financialUrl({clinicId: otherClinic, patientId: patient})))).status, 403);
assert.equal(queries.length, 0);
session = {sessionMode: 'reports', userRole: 'reports'};
assert.equal((await route.GET(new Request(financialUrl({patientId: patient})))).status, 403);
assert.equal(queries.length, 0);
session = {sessionMode: 'clinic', clinicId: clinic, userRole: 'receptionist'};

const complete = await route.GET(new Request(financialUrl({patientId: patient})));
assert.equal(complete.status, 200);
const ledgers = await complete.json();
assert.equal(ledgers.balances.length, 1);
assert.equal(ledgers.balancePayments.length, 1205, 'all pages of payment history are returned');
assert.equal(ledgers.patientCredits.length, 1205, 'all pages of the credit ledger are returned');
assert.ok(queries.filter(query => query.table === 'outstanding_balances').every(query => query.filters.some(filter => filter.field === 'clinic_id' && filter.value === clinic)));
assert.ok(queries.filter(query => query.table === 'balance_payments').every(query => query.filters.some(filter => filter.field === 'outstanding_balance_id' && filter.value.includes(balanceId))));
assert.ok(queries.filter(query => query.table === 'patient_credits').every(query => query.filters.some(filter => filter.field === 'clinic_id' && filter.value === clinic) && query.filters.some(filter => filter.field === 'patient_id' && filter.value === patient)));
assert.ok(queries.filter(query => query.table === 'balance_payments').some(query => query.from === 1000));
assert.ok(queries.filter(query => query.table === 'patient_credits').some(query => query.from === 1000));

const summary = await route.GET(new Request(financialUrl({patientIds: patient})));
assert.equal(summary.status, 200);
const summaryBody = await summary.json();
assert.equal(summaryBody.outstandingByPatient[patient].remaining, 795);
assert.equal(summaryBody.outstandingByPatient[patient].count, 1);

session = {sessionMode: 'manager', userRole: 'ceo'};
const managerLedger = await route.GET(new Request(financialUrl({patientId: patient})));
assert.equal(managerLedger.status, 200);
assert.equal((await managerLedger.json()).balances.length, 2, 'authorized managers retain the cross-clinic patient history view');
assert.ok(queries.filter(query => query.table === 'outstanding_balances').at(-1).filters.every(filter => filter.field !== 'clinic_id'));
session = {sessionMode: 'clinic', clinicId: clinic, userRole: 'receptionist'};

missingCreditsTable = true;
for (const code of ['42P01', 'PGRST205']) {
  missingCreditsCode = code;
  const legacySchema = await route.GET(new Request(financialUrl({patientId: patient})));
  assert.equal(legacySchema.status, 200, 'a database without the optional credit migration retains legacy checkout behavior');
  assert.deepEqual((await legacySchema.json()).patientCredits, []);
}
missingCreditsTable = false;

failPage = {table: 'patient_credits', from: 1000};
const failedLaterPage = await route.GET(new Request(financialUrl({patientId: patient})));
assert.equal(failedLaterPage.status, 503, 'a later-page failure must not return a partial financial ledger');
assert.match((await failedLaterPage.json()).error, /completely/i);

console.log(`PASS: POS startup uses ${startupTableReads} lookup reads; scoped financial reads return all 1,205 synthetic payments and credits; late page errors fail closed.`);
