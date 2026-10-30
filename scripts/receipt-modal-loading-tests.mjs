import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {testModuleLoader} from './load-test-module.mjs';
const source = fs.readFileSync('components/pos-modals.tsx','utf8');
const tree = ts.createSourceFile('modals.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const component = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'ReceiptHistoryModal');
function fn(name) {return component.body.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(tree);}
function harness({kind = 'receipt', page, request, failDetails = false} = {}) {
  const calls = [], state = {}, generation = {current: 1};
  const scope = {exports: {}, Error, Set, URLSearchParams, performance, clinicId: 'TEST', historyKind: kind,
    historyPage: 0, historyDate: '2026-10-14', historyGeneration: generation,
    requestJson: request || (async url => {calls.push({url}); return page || {receipts: [{id:'r',patient_id:'p'}], patients:[{id:'p'}], planPayments: [], hasMore:false};}),
    supabase: {from(table) {let field, ids; const query = {select() {return query;}, in(key, values) {field=key;ids=values;return query;}, eq() {return query;}, neq() {return query;}, order() {return query;}, range() {return query;}, is() {return query;},
      then(resolve) {calls.push({table, field, ids}); const data = table === 'treatment_plan_payment_records' ? [{id:'old-payment',treatment_plan_id:'plan'}] : table === 'treatment_plans' ? [{id:'plan'}] : [];
        return Promise.resolve({data,error:failDetails?{message:'TEST'}:null}).then(resolve);}}; return query;}},
  };
  const code = [fn('fetchAllRows'),fn('loadHistory')].join('\n');
  for (const name of new Set(code.match(/\bset[A-Z]\w+/g))) scope[name] = value => state[name] = value;
  vm.runInNewContext(ts.transpileModule(code+'\nexports.load=loadHistory;',{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,scope);
  return {...scope.exports, calls, state, generation};
}
const normal = harness(); await normal.load();
assert.equal(normal.calls.length, 1, 'regular list needs just one bounded API call');
assert.ok(normal.calls[0].url.includes('kind=receipt') && normal.calls[0].url.includes('date=2026-10-14'));
assert.equal(normal.state.setReceipts.length, 1);
const plans = harness({kind:'plan',page:{receipts:[],patients:[],planPayments:[{id:'current',treatment_plan_id:'plan',receptionist_id:'staff'}],hasMore:false}});
await plans.load();
assert.equal(plans.state.setTreatmentPlanPayments[0].id, 'current', 'only current page is listed');
assert.equal(plans.state.setPlanPaymentRollupRecords[0].id, 'old-payment', 'all linked plan records available for historical balance');
assert.ok(plans.calls.filter(call => call.table !== undefined).every(call => call.ids?.length), 'all plan/cashier reads are targeted');
let resolve;
const stale = harness({request: () => new Promise(r => resolve=r)});
const pending = stale.load(); stale.generation.current++;
resolve({receipts:[{id:'wrong'}],patients:[],planPayments:[],hasMore:false}); await pending;
assert.equal(Object.keys(stale.state).length, 0, 'closed/stale load cannot overwrite state');
await assert.rejects(harness({request: async () => {throw new Error('TEST timeout');}}).load(), /TEST timeout/);
await assert.rejects(harness({kind:'plan',failDetails:true,page:{receipts:[],patients:[],planPayments:[{id:'current',treatment_plan_id:'plan',receptionist_id:'staff'}],hasMore:false}}).load(), /Receipt details/);
// Real component markup: loading status, error/retry, history-kind headings and action buttons.
const defaults = []; let cursor = 0;
const react = {useState(value) {const index=cursor++; return [index in defaults?defaults[index]:typeof value==='function'?value():value,()=>{}];}, useRef(value) {cursor++;return {current:value};},useMemo(work){return work();},useEffect(){}};
const modal = testModuleLoader({crypto:{randomUUID:()=> 'TEST'}},{react})('components/pos-modals.tsx').ReceiptHistoryModal;
function walk(node, predicate) {if(!node||typeof node!=='object')return [];if(Array.isArray(node))return node.flatMap(n=>walk(n,predicate));return [...(predicate(node)?[node]:[]),...walk(node.props?.children,predicate)];}
cursor=0; const clean = modal({isOpen:true,onClose(){},clinicId:'TEST',clinic:null});
assert.ok(walk(clean,n=>n.type==='input'&&n.props['aria-label']==='Receipt history date').length);
assert.ok(walk(clean,n=>n.type==='button'&&n.props.children==='All dates').length);
const componentState = component.body.statements.filter(ts.isVariableStatement).flatMap(statement => statement.declarationList.declarations);
let stateIndex=0, loadingIndex, errorIndex;
for(const declaration of componentState) {
  if (!ts.isCallExpression(declaration.initializer || {}) || !['useState','useRef'].includes(declaration.initializer.expression.getText(tree))) continue;
  const text=declaration.name.getText(tree); if(text.includes('historyLoading'))loadingIndex=stateIndex; if(text.includes('historyError'))errorIndex=stateIndex; stateIndex++;
}
defaults[loadingIndex]=true; cursor=0; const loading=modal({isOpen:true,onClose(){},clinicId:'TEST',clinic:null});
assert.ok(walk(loading,n=>n.props?.role==='status').length);
assert.ok(!walk(loading,n=>n.type==='p'&&n.props.children==='No receipts found').length);
defaults[loadingIndex]=false; defaults[errorIndex]='TEST failure'; cursor=0;
assert.ok(walk(modal({isOpen:true,onClose(){},clinicId:'TEST',clinic:null}),n=>n.props?.role==='alert').length);
console.log('PASS: actual modal loader makes one regular-history API call, preserves full targeted plan rollups, discards stale/closed results, reports failures, and renders loading/date/history/error controls.');
