// Read-only checks. Never print patient records, cookies, or keys.
import fs from 'node:fs';import assert from 'node:assert/strict';
const env=Object.fromEntries(fs.readFileSync('.env.local','utf8').split(/\r?\n/).filter(line=>/^[A-Z0-9_]+=/.test(line)).map(line=>{const i=line.indexOf('=');return [line.slice(0,i),line.slice(i+1).trim().replace(/^(['"])(.*)\1$/,'$2')];}));
assert.equal(new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname,'vkcwmzdtypetqtqceazy.supabase.co');
const app='https://skinandsmile.vercel.app';
for(const path of ['/login','/login/staff']){const response=await fetch(app+path,{signal:AbortSignal.timeout(20000)});assert.equal(response.status,200,'Public login page: '+path);}
for(const path of ['/api/admin/patients','/api/patients/search?clinicId=00000000-0000-4000-8000-000000000000']){const response=await fetch(app+path,{redirect:'manual',signal:AbortSignal.timeout(20000)});assert.ok([401,403].includes(response.status),'Unsigned private route must be denied: '+path+' status '+response.status);}
const exportResponse=await fetch(app+'/api/workspace/eod-export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({clinicId:'00000000-0000-4000-8000-000000000000'}),signal:AbortSignal.timeout(20000)});
assert.equal(exportResponse.status,401,'The single-request EOD endpoint must authenticate before reading records');
for(const table of ['patients','receipts','receptionist','active_sessions']){const response=await fetch(env.NEXT_PUBLIC_SUPABASE_URL+'/rest/v1/'+table+'?select=*&limit=1',{headers:{apikey:env.NEXT_PUBLIC_SUPABASE_ANON_KEY,Authorization:'Bearer '+env.NEXT_PUBLIC_SUPABASE_ANON_KEY},signal:AbortSignal.timeout(20000)});assert.ok([401,403].includes(response.status),'Anonymous table access must be denied: '+table+' status '+response.status);await response.body?.cancel();}
console.log('PASS: live login pages load; unsigned private endpoints and direct anonymous patient/receipt/staff/session reads are denied. No live records were changed.');
