import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {testModuleLoader} from './load-test-module.mjs';

const attempts=new Map(),logs=[],stored=[];
let now=0,unavailable=false,clearFailure=false,sessionFailure=false;
const limiter={
 loginAttemptKey:(kind,identity)=>`${kind}:${identity}`,
 async consumeLoginAttempt(key,limit){
  if(unavailable)throw Error('TEST unavailable');
  let state=attempts.get(key);if(!state||state.until<=now)state={count:0,until:now+300};
  state.count++;attempts.set(key,state);return {allowed:state.count<=limit,remaining:state.until-now};
 },
 async clearLoginAttempts(key){if(clearFailure)throw Error('TEST unavailable');attempts.delete(key);},
};
const overrides={
 '../../../../lib/login-attempt-limits':limiter,
 '../../../../lib/login-log':{recordLoginAttempt:async(_request,success)=>logs.push(success)},
 '../../../../lib/session-storage':{sessionStorageFetch:async(query,init)=>{stored.push({query,...init});return new Response(null,{status:sessionFailure?503:204});}},
};
const env={REPORTS_LOGIN_USERNAME:'test',REPORTS_LOGIN_PASSWORD:'test-secret',REPORTS_LOGIN_USERNAME_2:'second',REPORTS_LOGIN_PASSWORD_2:'second-secret',NEXT_PUBLIC_SUPABASE_URL:'https://example.invalid',NEXT_PUBLIC_SUPABASE_ANON_KEY:'fake',NODE_ENV:'production'};
const route=()=>testModuleLoader({Buffer,crypto:webcrypto,process:{env}},overrides)('app/api/reports/login/route.ts');
const request=(password='wrong',username='test',cookie,ip='192.0.2.1')=>({json:async()=>({username,password}),headers:new Headers({'x-forwarded-for':ip}),cookies:{get:()=>cookie===undefined?undefined:{value:cookie}}});
for(let i=0;i<3;i++)assert.equal((await route().POST(request())).status,401);
const blocked=await route().POST(request('test-secret','different-user',Buffer.from('{}').toString('base64')));
assert.equal(blocked.status,429);assert.equal((await blocked.json()).remaining,300);
assert.equal(logs.length,3);assert.equal(stored.length,0,'Blocked attempts cannot create sessions');
assert.equal((await route().POST(request('wrong','new-user'))).status,429,'Changing username cannot reset the IP limit');
now=301;
const success=await route().POST(request('test-secret'));
assert.equal(success.status,200);assert.equal(attempts.size,0);
for(const attribute of [/app-auth=/,/; HttpOnly/i,/; Secure/i,/; SameSite=lax/i])assert.match(success.headers.get('set-cookie'),attribute);
assert.equal(JSON.parse(stored.at(-1).body).session_mode,'reports');
assert.equal((await route().POST(request('second-secret','second'))).status,200,'Secondary credentials still work');
const lockedCookie=Buffer.from(JSON.stringify({attempts:0,lockedUntil:Date.now()+600000,lockCount:2})).toString('base64');
assert.equal((await route().POST(request('test-secret','test',lockedCookie,'192.0.2.2'))).status,429,'Existing cookie lockout is retained');
unavailable=true;const before=stored.length;
assert.equal((await route().POST(request('test-secret'))).status,503);assert.equal(stored.length,before);
unavailable=false;clearFailure=true;
const failedClear=await route().POST(request('test-secret','test',undefined,'192.0.2.3'));
assert.equal(failedClear.status,503);assert.ok(!failedClear.headers.get('set-cookie')?.includes('app-auth='));
assert.equal(stored.at(-1).method,'DELETE','Failed limiter reset revokes the newly created session');
clearFailure=false;sessionFailure=true;
assert.equal((await route().POST(request('test-secret','test',undefined,'192.0.2.4'))).status,500);
assert.equal(logs.filter(Boolean).length,4);
console.log('PASS: reports login limits survive missing/reset cookies, username changes and fresh workers; expiry, both credentials, cookie security and fail-closed storage checks verified. Fake storage only.');
