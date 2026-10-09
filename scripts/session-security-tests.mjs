import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../lib/session-auth.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const sandbox = { exports: {}, process, fetch, Date, require: () => ({ sessionStorageFetch: () => { throw new Error("Unexpected database access"); } }) };
vm.runInNewContext(compiled, sandbox);
const { validateActiveSession } = sandbox.exports;
const storageSource = fs.readFileSync(new URL('../lib/session-storage.ts', import.meta.url), 'utf8');
const storageCompiled = ts.transpileModule(storageSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
let captured;
const storageSandbox = { exports: {}, process: { env: { NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_SESSION_SECRET_KEY: 'fake-test-only-secret', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'fake-public-key' } }, require: () => ({}), fetch: async (...args) => { captured = args; return { ok: true }; } };
vm.runInNewContext(storageCompiled, storageSandbox);
await storageSandbox.exports.sessionStorageFetch('?token=eq.fake', { method: 'DELETE' });
assert.equal(captured[1].headers.apikey, 'fake-test-only-secret');
assert.equal(captured[1].cache, 'no-store');
assert.equal(captured[1].method, 'DELETE');
delete storageSandbox.process.env.SUPABASE_SESSION_SECRET_KEY;
assert.throws(() => storageSandbox.exports.sessionStorageConfiguration(), /not configured/);
assert.match(storageSource, /import "server-only"/);
const now = Date.parse('2026-10-07T00:00:00Z');
const valid = { token: 'test-token', created_at: '2026-10-06T00:00:00Z', session_mode: 'clinic', clinic_id: 'test-clinic', user_role: 'receptionist' };
assert.ok(validateActiveSession(valid, now));
assert.ok(validateActiveSession({ ...valid, session_mode: 'manager', clinic_id: null, user_role: 'ceo' }, now));
assert.ok(validateActiveSession({ ...valid, session_mode: 'reports', clinic_id: null, user_role: 'reports' }, now));
for (const patch of [
  { created_at: null }, { created_at: 'invalid' },
  { created_at: '2026-10-08T00:00:00Z' },
  { created_at: '2026-09-07T00:00:00Z' },
  { session_mode: null }, { session_mode: 'unknown' },
  { clinic_id: null }, { user_role: 'ceo' },
  { session_mode: 'manager', clinic_id: null, user_role: 'receptionist' },
  { session_mode: 'reports', user_role: 'reports' },
  { token: '' },
]) assert.equal(validateActiveSession({ ...valid, ...patch }, now), null, JSON.stringify(patch));
const login = fs.readFileSync(new URL('../app/api/auth/login/route.ts', import.meta.url), 'utf8');
assert.doesNotMatch(login, /JSON\.stringify\(\{ token, ip, user_agent: userAgent \}\)/);
assert.match(login, /if \(!sessionRes\.ok\)\s*\{\s*return NextResponse\.json/);
console.log('PASS: valid sessions accepted; expired, incomplete and incompatible roles denied; no incomplete login fallback. No database access.');
