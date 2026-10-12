import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {testModuleLoader} from './load-test-module.mjs';
let values=[],refs=[],cursor=0,refCursor=0,calls=[],mode='error';
const react={useState(initial){const i=cursor++;if(!(i in values))values[i]=typeof initial==='function'?initial():initial;return [values[i],value=>values[i]=typeof value==='function'?value(values[i]):value];},useRef(initial){const i=refCursor++;return refs[i]??=( {current:initial});}};
const localFetch=async(url,init)=>{
 calls.push(JSON.parse(init.body));
 if(mode==='error')return Response.json({error:'TEST approval access denied'},{status:409});
 if(mode==='html')return new Response('<html>Error</html>',{status:500});
 return Response.json({request:{id:calls.at(-1).operationId,status:'PENDING'}});
};
const load=testModuleLoader({fetch:localFetch,crypto:webcrypto},{react});
const {ReceiptVoidButton}=load('components/receipt-void-button.tsx');
function find(node,predicate){if(!node||typeof node!=='object')return [];if(Array.isArray(node))return node.flatMap(child=>find(child,predicate));return [...(predicate(node)?[node]:[]),...find(node.props?.children,predicate)];}
function render(){cursor=0;refCursor=0;return ReceiptVoidButton({receiptId:'test-receipt'});}
let tree=render();find(tree,n=>n.type==='button')[0].props.onClick();tree=render();find(tree,n=>n.type==='textarea')[0].props.onChange({target:{value:'TEST wrong payment'}});
tree=render();const submit=find(tree,n=>n.type==='form')[0].props.onSubmit;
await Promise.all([submit({preventDefault(){}}),submit({preventDefault(){}})]);
assert.equal(calls.length,1,'Double clicks must not submit twice');
tree=render();assert.equal(find(tree,n=>n.type==='button').at(-1).props.disabled,false,'Saving clears on failure');assert.equal(find(tree,n=>n.props.role==='alert')[0].props.children,'TEST approval access denied');
mode='html';await find(tree,n=>n.type==='form')[0].props.onSubmit({preventDefault(){}});tree=render();assert.ok(find(tree,n=>n.props.role==='alert')[0].props.children.includes('500'));assert.equal(find(tree,n=>n.type==='button').at(-1).props.disabled,false);
mode='ok';await find(tree,n=>n.type==='form')[0].props.onSubmit({preventDefault(){}});tree=render();assert.equal(new Set(calls.map(c=>c.operationId)).size,1,'Retry after ambiguous failure must keep the original ID');assert.equal(find(tree,n=>n.props.role==='status').length,1);
const timeoutLoad=testModuleLoader({fetch:(_url,init)=>new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(new Error('aborted'))))});
await assert.rejects(timeoutLoad('lib/request-json.ts').requestJson('/local',{},10),/same request will not be saved twice/);
console.log('PASS actual VOID form: server error and non-JSON failure visible, Saving clears, success announced, double click blocked, stable retry ID, network timeout handled.');
