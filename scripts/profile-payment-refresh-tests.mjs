import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const source=fs.readFileSync('components/pos-modals.tsx','utf8');
const tree=ts.createSourceFile('profile.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let paymentFunction;
function find(node){if(ts.isFunctionDeclaration(node)&&node.name?.text==='saveTreatmentPayment')paymentFunction=node;ts.forEachChild(node,find);}find(tree);
const updaters={};
function collect(node){if(ts.isCallExpression(node)&&['setTreatmentPlanPayments','setTreatmentPlanPaymentRecords'].includes(node.expression.getText(tree)))updaters[node.expression.getText(tree)]=node.arguments[0].getText(tree);ts.forEachChild(node,collect);}collect(paymentFunction);
function run(name,previous,rows){
 const text=`const update=${updaters[name]}; export default update;`;
 const js=ts.transpileModule(text,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const mod={exports:{}};
 new Function('module','exports','plan','refreshedPaymentsResult','refreshedRecordsResult',js)(mod,mod.exports,{id:'plan-a'},{data:rows},{data:rows});
 return mod.exports.default(previous);
}
for(const name of Object.keys(updaters)){
 const previous=[{id:'a-old',treatment_plan_id:'plan-a',amount:20},{id:'b-paid',treatment_plan_id:'plan-b',amount:40}];
 const refreshed=[previous[0],{id:'a-new',treatment_plan_id:'plan-a',amount:30}];
 const result=run(name,previous,refreshed);
 assert.equal(result.filter(p=>p.id==='b-paid').length,1,'Other plan payment retained');
 assert.equal(result.filter(p=>p.id==='a-old').length,1,'Reload does not duplicate prior payment');
 assert.equal(200-result.reduce((sum,p)=>sum+p.amount,0),110,'Combined outstanding stays correct after collecting 30');
 assert.equal(run(name,result,refreshed).length,3,'Repeat reload stays stable');
 assert.equal(run(name,previous,[]).length,1,'Empty reload affects only selected plan');
}
assert.equal(Object.keys(updaters).length,2);
console.log('PASS: real profile payment updaters preserve other plans, retain correct combined balance, and avoid duplicate rows. No live access.');
