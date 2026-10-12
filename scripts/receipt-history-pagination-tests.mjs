import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomUUID as uuid} from 'node:crypto';
import {createVoidTestDatabase} from './void-test-database.mjs';
import {testModuleLoader} from './load-test-module.mjs';
const db = await createVoidTestDatabase();
const clinic = uuid(), other = uuid(), patient = uuid(), staff = uuid(), foreignStaff = uuid(), plan = uuid();
async function insert(table, row) {
  const keys = Object.keys(row);
  await db.query(`insert into public.${table}(${keys.join(',')}) values(${keys.map((_, i) => `$${i + 1}`).join(',')})`, Object.values(row));
}
try {
  await db.exec(fs.readFileSync('supabase/migrations/20261012194215_pos_history_pagination.sql', 'utf8'));
  await insert('clinics', {id: clinic, name: 'TEST'}); await insert('clinics', {id: other, name: 'OTHER TEST'});
  await insert('patients', {id: patient, name: 'TEST'});
  await insert('receptionist', {id: staff, clinic_id: clinic, name: 'TEST', pin: 'unused'});
  await insert('receptionist', {id: foreignStaff, clinic_id: other, name: 'OTHER', pin: 'unused'});
  await insert('treatment_plans', {id: plan, clinic_id: clinic, patient_id: patient, title: 'TEST', total_amount: 1000});
  const expected = [];
  // Same timestamps deliberately test the stable id/kind tie breakers across pages.
  for (let i = 0; i < 65; i++) {
    const receipt = uuid(), payment = uuid(); expected.push(receipt, payment);
    await insert('receipts', {id: receipt, clinic_id: i === 0 ? null : clinic, patient_id: patient, receptionist_id: staff, total: 100, created_at: '2026-10-01', status: i === 1 ? 'VOIDED' : 'COMPLETED'});
    await insert('treatment_plan_payment_records', {id: payment, clinic_id: clinic, patient_id: patient, receptionist_id: staff, treatment_plan_id: plan, total_invoice_amount_settled: 100, total_customer_charged_amount: 100, created_at: '2026-10-01', status: i === 1 ? 'cancelled' : 'completed'});
  }
  const directReceipt = uuid(); expected.push(directReceipt);
  await insert('receipts', {id: directReceipt, clinic_id: clinic, patient_id: patient, receptionist_id: foreignStaff, total: 50, created_at: '2026-10-02'});
  const wrongClinic = uuid();
  await insert('receipts', {id: wrongClinic, clinic_id: other, patient_id: patient, receptionist_id: staff, total: 50, created_at: '2026-10-03'});
  const seen = [], states = [];
  for (let offset = 0; offset < 150; offset += 50) {
    const page = (await db.query('select public.pos_receipt_history_page($1,$2,50) p', [clinic, offset])).rows[0].p;
    const ids = [...page.receipts, ...page.planPayments].map(row => row.id);
    assert.equal(ids.length, offset === 100 ? 31 : 50);
    assert.equal(page.hasMore, offset !== 100);
    seen.push(...ids); states.push(...page.receipts.map(r => r.status), ...page.planPayments.map(r => r.status));
  }
  assert.equal(new Set(seen).size, seen.length, 'no duplicate page entries');
  assert.deepEqual([...seen].sort(), expected.sort(), 'no missing or foreign-clinic entries');
  assert.ok(states.includes('VOIDED')); assert.ok(states.includes('cancelled'), 'audit history remains visible');
  const permissions = (await db.query(`select has_function_privilege('anon','public.pos_receipt_history_page(uuid,integer,integer)','execute') anon,
    has_function_privilege('authenticated','public.pos_receipt_history_page(uuid,integer,integer)','execute') browser,
    has_function_privilege('service_role','public.pos_receipt_history_page(uuid,integer,integer)','execute') server`)).rows[0];
  assert.equal(permissions.anon, false); assert.equal(permissions.browser, false); assert.equal(permissions.server, true);

  let session = null, rpcCalls = 0, fail = false;
  const auth = testModuleLoader()('lib/api-session.ts');
  const route = testModuleLoader({}, {
    '../../../../lib/api-session': {readAppSession: async () => session ? {session} : {errorResponse: Response.json({}, {status: 401})}, ensureClinicScopeAccess: auth.ensureClinicScopeAccess},
    '../../../../lib/protected-data-server': {createProtectedDataClient: () => ({rpc: async (name, args) => {
      rpcCalls++; assert.equal(name, 'pos_receipt_history_page'); assert.equal(args.p_limit, 50);
      return fail ? {error: {message: 'TEST'}, data: null} : {data: {receipts: [], planPayments: [], hasMore: false}, error: null};
    }})},
  })('app/api/receipts/history/route.ts');
  const request = (id = clinic, offset = '0') => new Request(`http://localhost/api/receipts/history?clinicId=${id}&offset=${offset}`);
  assert.equal((await route.GET(request())).status, 401);
  session = {sessionMode: 'clinic', userRole: 'receptionist', clinicId: clinic};
  assert.equal((await route.GET(request(other))).status, 403);
  assert.equal((await route.GET(request(clinic, '-1'))).status, 400);
  assert.equal((await route.GET(request(clinic, '1.5'))).status, 400);
  assert.equal((await route.GET(request('invalid'))).status, 400);
  assert.equal(rpcCalls, 0, 'denied requests cannot execute the data function');
  session = {sessionMode: 'manager', userRole: 'clinic_manager', clinicId: clinic, permissions: []};
  assert.equal((await route.GET(request())).status, 403);
  session.permissions = ['reports'];
  assert.equal((await route.GET(request(other))).status, 403);
  const allowed = await route.GET(request()); assert.equal(allowed.status, 200); assert.equal(allowed.headers.get('cache-control'), 'no-store');
  session = {sessionMode: 'manager', userRole: 'owner', clinicId: null}; assert.equal((await route.GET(request(other))).status, 200);
  session.userRole = 'ceo'; assert.equal((await route.GET(request())).status, 403);
  session.userRole = 'owner'; fail = true; assert.equal((await route.GET(request())).status, 503);
  console.log('PASS: mixed history pages have no gaps/duplicates at tied timestamps; direct/legacy clinic attribution; VOIDED history retained; server-only function permissions; route authentication, clinic/role restrictions, validation, and failures.');
} finally {await db.close();}
