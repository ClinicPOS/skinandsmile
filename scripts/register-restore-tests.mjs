import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import vm from 'node:vm';
import {testModuleLoader} from './load-test-module.mjs';
const clinic='11111111-1111-4111-8111-111111111111', staff='22222222-2222-4222-8222-222222222222', other='33333333-3333-4333-8333-333333333333', registerId='44444444-4444-4444-8444-444444444444';
const register={id:registerId,receptionist_id:staff,opening_cash:125,opened_at:'2026-10-12T08:00:00Z',closed_at:null};
let session=null,calls=[],fail=false,active=true,registers=[register];
const db={from(table){
 const filters=[]; const query={select(fields){calls.push({table,fields,filters});return query;},eq(field,value){filters.push([field,value]);return query;},is(field,value){filters.push([field,value]);return query;},order(){return query;},limit(){return query;},
  maybeSingle(){return query;},then(resolve){
   if(fail)return Promise.resolve({data:null,error:{message:'TEST unavailable'}}).then(resolve);
   const rows=table==='clinics'?[{id:clinic,name:'TEST clinic'}]:table==='receptionist'?[{id:staff,name:'TEST receptionist',clinic_id:clinic,is_active:active}]:registers;
   const matched=rows.filter(row=>filters.every(([field,value])=>(row[field]??null)===value));
   return Promise.resolve({data:table==='cash_register_sessions'?matched:matched[0]||null,error:null}).then(resolve);
  }};return query;
 },rpc(){throw Error('Restore must not write registers');}};
const route=testModuleLoader({}, {
 '../../../lib/protected-data-server':{createProtectedDataClient:()=>db},
 '../../../lib/api-session':{readAppSession:async()=>session?{session}:{errorResponse:Response.json({}, {status:401})}},
})('app/api/register/route.ts');
assert.equal((await route.GET()).status,401);assert.equal(calls.length,0);
session={sessionMode:'manager',userRole:'owner',clinicId:clinic,receptionistId:staff};
assert.equal((await route.GET()).status,403);assert.equal(calls.length,0);
session={sessionMode:'clinic',userRole:'receptionist',clinicId:clinic,receptionistId:null};
let response=await route.GET();assert.equal(response.status,200);assert.equal((await response.json()).identity,null);
assert.ok(!calls.some(call=>call.table==='cash_register_sessions'));
session.receptionistId=staff;calls=[];
response=await route.GET(new Request(`http://localhost/api/register?receptionistId=${other}&registerSessionId=${other}`));
assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
let body=await response.json();assert.equal(body.register.id,registerId);assert.equal(body.identity.receptionistId,staff);
assert.equal(body.register.opened_at,register.opened_at,'overnight register must not be closed or deleted');
const read=calls.find(call=>call.table==='cash_register_sessions');
assert.ok(read.filters.some(([field,value])=>field==='receptionist_id'&&value===staff));assert.ok(read.filters.some(([field,value])=>field==='closed_at'&&value===null));
registers=[{...register,closed_at:'2026-10-13T08:00:00Z'},{...register,id:other,receptionist_id:other}];
assert.equal((await (await route.GET()).json()).register,null,'closed and another staff member registers cannot resume');
registers=[register,{...register,id:other}];assert.equal((await route.GET()).status,409);
registers=[register];active=false;assert.equal((await route.GET()).status,403);active=true;
session.clinicId=other;assert.equal((await route.GET()).status,403);session.clinicId=clinic;
fail=true;assert.equal((await route.GET()).status,503);fail=false;
const writes=calls.length;
assert.equal((await route.POST(new Request('http://localhost/api/register',{method:'POST',body:JSON.stringify({action:'open',amount:0,expectedReceptionistId:other,expectedClinicId:clinic})}))).status,409);
assert.equal((await route.POST(new Request('http://localhost/api/register',{method:'POST',body:JSON.stringify({action:'open',amount:0,expectedReceptionistId:staff,expectedClinicId:other})}))).status,409);
assert.equal(calls.length,writes,'changed login must be denied before database operations');

const verified={clinic:{id:clinic,name:'TEST clinic'},identity:{receptionistId:staff,receptionistName:'TEST receptionist',clinicId:clinic},register};
let payload=verified,status=200;
const loader=testModuleLoader({fetch:async(url,init)=>{assert.equal(url,'/api/register');assert.equal(init.cache,'no-store');return Response.json(payload,{status});}})('lib/verified-register-client.ts');
assert.equal((await loader.loadVerifiedRegister()).register.id,registerId);
payload={...verified,register:{...register,receptionist_id:other}};await assert.rejects(loader.loadVerifiedRegister(),/match/);
payload={...verified,register:{...register,closed_at:'2026-10-14'}};await assert.rejects(loader.loadVerifiedRegister(),/match/);
payload={...verified,identity:{...verified.identity,clinicId:other}};await assert.rejects(loader.loadVerifiedRegister(),/match/);
payload={...verified,register:{...register,opening_cash:'bad'}};await assert.rejects(loader.loadVerifiedRegister(),/details/);
payload={error:'TEST connection failure'};status=503;await assert.rejects(loader.loadVerifiedRegister(),/TEST connection/);
let timeoutCallback;
const timeoutLoader=testModuleLoader({setTimeout:cb=>{timeoutCallback=cb;return 1;},clearTimeout(){},fetch:async(url,init)=>new Promise((resolve,reject)=>init.signal.addEventListener('abort',()=>reject(new Error('abort'))))})('lib/verified-register-client.ts');
const timed=assert.rejects(timeoutLoader.loadVerifiedRegister(),/timed out/);timeoutCallback();await timed;

// Execute the real page restoration functions with stale local data and a draft cart.
const source=fs.readFileSync('app/receipts/page.tsx','utf8'),tree=ts.createSourceFile('page.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const functions={};function walk(node){if(ts.isFunctionDeclaration(node)&&node.name)functions[node.name.text]=node.getText(tree);ts.forEachChild(node,walk);}walk(tree);
const keys=['applyVerifiedRegister','verifySavedRegister','openRegister'];
const state={},storage=new Map([['posRegisterSession',JSON.stringify({receptionistId:other,clinicId:other,openingCash:999})]]),draft=[{id:'unfinished-cart-item'}];
const scope={exports:{},Error,JSON,Number,POS_REGISTER_SESSION_KEY:'posRegisterSession',registerVerificationGeneration:{current:0},
 localStorage:{setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},syncVerifiedClinic:(id,name)=>{state.clinic=[id,name];},
 selectedServices:draft,loadVerifiedRegister:async()=>verified,
 loginReceptionistId:staff,receptionists:[{id:staff,clinic_id:clinic}],clinics:[verified.clinic],accessSession:{mode:'clinic',clinicId:clinic},
 clinicAccessAllowsClinic:()=>true,pinInput:'TEST PIN',openingCashInput:'',alerts:[],alert:message=>scope.alerts.push(message)};
for(const name of new Set(keys.map(key=>functions[key]).join('\n').match(/\bset[A-Z]\w+/g)))scope[name]=value=>state[name]=value;
vm.runInNewContext(ts.transpileModule(keys.map(key=>functions[key]).join('\n')+'\nexports.apply=applyVerifiedRegister;exports.verify=verifySavedRegister;exports.open=openRegister;',{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,scope);
await scope.exports.verify();
assert.equal(state.setIsPosUnlocked,true);assert.equal(state.setReceptionistId,staff);assert.equal(state.setOpeningCash,125);assert.equal(state.setRegisterSessionId,registerId);
assert.equal(JSON.parse(storage.get('posRegisterSession')).clinicId,clinic);
storage.clear();await scope.exports.verify();assert.equal(state.setIsPosUnlocked,true,'server-owned register resumes without browser cache');
scope.loadVerifiedRegister=async()=>{throw new Error('TEST outage');};const retained=storage.get('posRegisterSession');await scope.exports.verify();
assert.equal(state.setIsPosUnlocked,false);assert.equal(state.setIsVerifyingRegister,false);assert.equal(storage.get('posRegisterSession'),retained);assert.equal(draft.length,1);
scope.loadVerifiedRegister=async()=>({...verified,register:null});await scope.exports.verify();assert.equal(state.setIsPosUnlocked,false);assert.equal(storage.size,0);assert.equal(state.setLoginReceptionistId,staff);
let resolve;
scope.loadVerifiedRegister=()=>new Promise(r=>resolve=r);const stale=scope.exports.verify();scope.registerVerificationGeneration.current++;resolve(verified);await stale;assert.equal(state.setIsPosUnlocked,false,'obsolete verification cannot unlock POS');
const mutations=[];
scope.fetch=async(url,init)=>{mutations.push({url,body:JSON.parse(init.body)});assert.equal(url,'/api/auth/receptionist');return {ok:true};};
scope.loadVerifiedRegister=async()=>verified;await scope.exports.open();
assert.equal(mutations.length,1);assert.equal(state.setRegisterSessionId,registerId);assert.equal(state.setPinInput,'');
assert.equal(mutations[0].body.receptionistId,staff,'PIN identity is verified before register recovery');
scope.loadVerifiedRegister=async()=>({...verified,identity:{...verified.identity,receptionistId:other}});await scope.exports.open();
assert.ok(scope.alerts.some(message=>message.includes('login changed')));
assert.ok(mutations.every(call=>call.url!=='/api/register'),'resume or changed identity must not create another register');
scope.localStorage={setItem(){throw Error('Storage unavailable');},removeItem(){throw Error('Storage unavailable');}};
scope.exports.apply(verified);assert.equal(state.setIsPosUnlocked,true,'browser storage failure must not hide a verified server-owned register');
scope.exports.apply({...verified,register:null});assert.equal(state.setIsPosUnlocked,false);
console.log('PASS: authenticated server-only register recovery; no writes/overnight closing; missing identity, foreign/closed/duplicate registers and outages; canonical cashier/clinic/cash replaces stale cache; missing cache recovery; failure preserves cart/cache; timeout and stale responses; PIN resumes an existing register without creating a second.');
