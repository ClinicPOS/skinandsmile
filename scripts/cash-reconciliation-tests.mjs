// Executes the real cash reconciliation function with controlled ledger responses.
import fs from 'node:fs';import path from 'node:path';import vm from 'node:vm';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import ts from 'typescript';
const require=createRequire(import.meta.url),cache=new Map();
function load(file){file=path.resolve(file);if(cache.has(file))return cache.get(file).exports;const module={exports:{}};cache.set(file,module);const js=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;const localRequire=name=>name.startsWith('.')?load(path.resolve(path.dirname(file),name+'.ts')):require(name);vm.runInThisContext('(function(require,module,exports){'+js+'\n})',{filename:file})(localRequire,module,module.exports);return module.exports;}
const {computeRegisterSessionCashCollected}=load('app/api/cash-deductions/_shared.ts');
const context={id:'shift',clinicId:'clinic',receptionistId:'rec',openedAt:'2026-10-08T00:00:00Z',closedAt:'2026-10-08T10:00:00Z'};
function database({returned=105,legacy=0,fail=false}={}){
 const calls=[];const tables={receipts:[{id:'r1',amount_paid:210,payment_method:'Cash'}],payment_records:[{id:'p1',receipt_id:'r1'}],balance_payments:[],patient_credits:[],treatment_plan_payment_records:[],treatment_plan_payments:[],payment_allocations:[{payment_id:'p1',method_group:'cash',customer_charged_amount:210,refunded_treatment_amount:100,refunded_fee_amount:0}],treatment_plan_payment_allocations:[],payment_allocation_refunds:[{refund_id:'f1',total_returned_amount:returned,payment_allocations:{method_group:'cash'}}],refunds:[{id:'f1',total_amount:returned,payment_method:'Cash'},{id:'old',total_amount:legacy,payment_method:'Cash'}]};
 const db={from(table){const filters=[];calls.push({table,filters});const query={then(resolve,reject){return Promise.resolve({data:tables[table]||[],error:fail&&table==='refunds'?{message:'Unavailable'}:null}).then(resolve,reject)}};for(const method of ['select','eq','neq','gte','lte','in','ilike','gt'])query[method]=(...args)=>{filters.push([method,...args]);return query};return query}};return {db,calls};
}
let fixture=database();assert.equal(await computeRegisterSessionCashCollected(fixture.db,context),105,'A returned AED 105 must include the refunded AED 5 VAT');
fixture=database({returned:210});assert.equal(await computeRegisterSessionCashCollected(fixture.db,context),0,'Full cash refund leaves zero retained cash');
fixture=database({returned:105,legacy:20});assert.equal(await computeRegisterSessionCashCollected(fixture.db,context),85,'Legacy return is deducted once and modern parent is not deducted twice');
const receiptQuery=fixture.calls.find(c=>c.table==='receipts');assert.ok(receiptQuery.filters.some(f=>f[0]==='neq'&&f[1]==='status'&&f[2]==='VOIDED'));
const paymentQuery=fixture.calls.find(c=>c.table==='payment_records');assert.ok(paymentQuery.filters.some(f=>f[0]==='neq'&&f[1]==='status'&&f[2]==='cancelled'));
for(const table of ['refunds','payment_allocation_refunds']){const query=fixture.calls.find(c=>c.table===table);assert.ok(query.filters.some(f=>f[0]==='eq'&&f[1].endsWith('clinic_id')&&f[2]===context.clinicId));assert.ok(query.filters.some(f=>f[0]==='gte'&&f[1]==='created_at'&&f[2]===context.openedAt));}
fixture=database({fail:true});await assert.rejects(()=>computeRegisterSessionCashCollected(fixture.db,context),/could not be verified/);
console.log('PASS: cash refunds include VAT, full/partial returns, legacy deduplication, void/cancel filters, clinic and shift scope, and unavailable-ledger rejection.');
const {computeTreatmentPlanRollup}=load('lib/treatment-plan-rollup.ts');
const cancelled={id:'plan',total_amount:100,status:'Cancelled',cancelled_at:'2026-10-08T12:00:00Z'};
assert.equal(computeTreatmentPlanRollup(cancelled).remainingBalance,0);
assert.equal(computeTreatmentPlanRollup(cancelled,{asOf:'2026-10-08T11:00:00Z'}).remainingBalance,100);
assert.equal(computeTreatmentPlanRollup(cancelled,{asOf:'2026-10-08T13:00:00Z'}).remainingBalance,0);
assert.equal(computeTreatmentPlanRollup({...cancelled,status:'Active'}).remainingBalance,100);
console.log('PASS: cancelled plans are excluded from current balances while earlier report dates retain their original balance.');
