import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const row={id:'fixture-request',receiptNumber:123,patientName:'TEST Patient',requestedBy:'TEST Receptionist',status:'PENDING',created_at:'2026-10-07T10:00:00Z',requested_reason:'TEST return',proposal:{total:105,method:'cash',items:[{service_name:'TEST Service',refunded_invoice_amount:105}]}};
let values=[],cursor=0,calls=[];
const react={useEffect(){},useState(initial){const i=cursor++;if(!(i in values))values[i]=Array.isArray(initial)?[row]:typeof initial==='boolean'&&initial===true?false:initial;return [values[i],value=>{values[i]=typeof value==='function'?value(values[i]):value;}];}};
const source=ts.transpileModule(fs.readFileSync('components/refund-approval-queue.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const fakeFetch=async(url,init)=>{calls.push({url,body:JSON.parse(init.body)});return {ok:true,json:async()=>({request:{status:'APPROVED'}})};};
const exports={};vm.runInNewContext(source,{exports,require:name=>name==='react'?react:name==='../lib/request-json'?{requestJson:async(url,init)=>{const response=await fakeFetch(url,init);return response.json();}}:require(name),fetch:async(url,init)=>{calls.push({url,body:JSON.parse(init.body)});return {ok:true,json:async()=>({request:{status:'APPROVED'}})};},queueMicrotask,console,Date});
function render(){cursor=0;return exports.RefundApprovalQueue({clinicId:'fixture-clinic',review:true});}
function find(node,predicate){if(!node||typeof node!=='object')return [];if(Array.isArray(node))return node.flatMap(child=>find(child,predicate));return [...(predicate(node)?[node]:[]),...find(node.props?.children,predicate)];}
for(const label of ['Approve','Reject']){
 values=[];calls=[];let tree=render();const button=find(tree,node=>node.type==='button'&&node.props.children===label)[0];assert.ok(button);assert.equal(button.props.disabled,false);button.props.onClick();assert.equal(calls.length,0,'Selecting review must not save a financial action');
 tree=render();const article=find(tree,node=>node.type==='article')[0];const form=find(article,node=>node.type==='form')[0];assert.ok(form,'Confirmation must be inside the selected request');assert.equal(find(tree,node=>node.type==='form').length,1);assert.ok(find(form,node=>node.type==='button'&&node.props.children===`Confirm ${label==='Approve'?'approval':'rejection'}`).length);
 if(label==='Reject'){const input=find(form,node=>node.type==='textarea')[0];assert.ok(input.props.required);input.props.onChange({target:{value:'TEST rejection reason'}});tree=render();}
 await find(tree,node=>node.type==='form')[0].props.onSubmit({preventDefault(){}});assert.equal(calls.length,1);assert.equal(calls[0].body.action,label.toLowerCase());assert.equal(calls[0].body.id,row.id);
}
values=[];calls=[];let tree=render();find(tree,node=>node.type==='button'&&node.props.children==='Approve')[0].props.onClick();tree=render();find(tree,node=>node.type==='button'&&node.props.children==='Back')[0].props.onClick();assert.equal(find(render(),node=>node.type==='form').length,0);assert.equal(calls.length,0);
console.log('PASS: Approve/Reject open confirmation within the clicked request, rejection requires a reason, confirmation sends the selected action, Back makes no request.');
