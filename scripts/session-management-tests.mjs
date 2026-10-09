import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { webcrypto } from 'node:crypto';

function load(file, dependencies) {
  const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const scope = { exports: {}, require: name => {
    if (name === 'server-only') return {};
    if (!(name in dependencies)) throw Error(`Unexpected dependency ${name}`);
    return dependencies[name];
  }, crypto: webcrypto, TextEncoder, Uint8Array, Response };
  vm.runInNewContext(compiled, scope);
  return scope.exports;
}
const token = 'fake-test-secret-token';
const row = { token, ip: '127.0.0.1', user_agent: 'fake-test-browser', created_at: '2026-10-07T00:00:00Z' };
const management = load('../lib/session-management.ts', { './session-storage': { sessionStorageFetch: async () => Response.json([row]) } });
const safe = await management.redactManagedSession(row);
assert.match(safe.id, /^[a-f0-9]{64}$/);
assert.equal('token' in safe, false);
assert.equal(JSON.stringify(safe).includes(token), false);
let auth = null;
let revoked = '';
let reads = 0;
const route = load('../app/api/admin/sessions/route.ts', {
  '../../../../lib/api-session': {
    createServerSupabaseClient: () => ({}),
    readAppSession: async () => auth ? { session: auth } : { session: null, errorResponse: Response.json({}, { status: 401 }) },
    ensureManagerSession: session => session.sessionMode === 'manager' && ['ceo', 'it_admin'].includes(session.userRole) ? null : Response.json({}, { status: 403 }),
  },
  '../../../../lib/session-management': { ...management, loadManagedSessions: async () => { reads++; return [row]; } },
  '../../../../lib/session-storage': { sessionStorageFetch: async query => { revoked = query; return new Response(null, { status: 204 }); } },
});
assert.equal((await route.GET()).status, 401);
auth = { sessionMode: 'clinic', userRole: 'receptionist' };
assert.equal((await route.GET()).status, 403);
assert.equal((await route.DELETE(new Request('http://localhost', { method: 'DELETE', body: JSON.stringify({ id: safe.id }) }))).status, 403);
assert.equal(reads, 0);
auth = { sessionMode: 'manager', userRole: 'it_admin' };
const listing = await route.GET();
assert.equal(listing.status, 200);
assert.equal((await listing.text()).includes(token), false);
assert.equal((await route.DELETE(new Request('http://localhost', { method: 'DELETE', body: JSON.stringify({ token }) }))).status, 400);
const removal = await route.DELETE(new Request('http://localhost', { method: 'DELETE', body: JSON.stringify({ id: safe.id }) }));
assert.equal(removal.status, 200);
assert.equal(revoked, `?token=eq.${encodeURIComponent(token)}`);
console.log('PASS: session tokens redacted; unauthenticated and clinic access denied before database use; manager revokes by opaque ID. Fake data only.');
