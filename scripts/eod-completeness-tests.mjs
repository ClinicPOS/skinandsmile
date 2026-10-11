import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import ts from 'typescript';
const exports={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/eod-data-client.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,fetch,URL,Headers,Response,require:name=>{if(name==='server-only')return {};if(name==='@supabase/supabase-js')return {};throw Error(name)}});
const records=Array.from({length:2301},(_,i)=>({id:String(i),amount:i}));
let requests=[],failPage=false,omitCount=false;
const network=async(input,init)=>{
 const url=new URL(input);requests.push(url);
 assert.equal(init.cache,'no-store');assert.equal(new Headers(init.headers).get('prefer'),'count=exact');
 const offset=Number(url.searchParams.get('offset')||0),limit=Number(url.searchParams.get('limit')||1000);
 if(failPage&&offset>=100)return Response.json({message:'Unavailable'},{status:503});
 // Deliberately use a lower server cap than the requested page size.
 const rows=records.slice(offset,offset+Math.min(limit,100));
 return Response.json(rows,{headers:omitCount?{}:{'Content-Range':`${offset}-${offset+rows.length-1}/${records.length}`}});
};
const reader=exports.createEodReadFetch(network);
const url='http://local.test/rest/v1/payment_records?select=*&clinic_id=eq.clinic-a';
const rows=await (await reader(url)).json();assert.equal(rows.length,2301);assert.equal(new Set(rows.map(r=>r.id)).size,2301);assert.ok(requests.slice(1).every(r=>r.searchParams.get('order')==='id.asc'));
const count=requests.length;assert.deepEqual(await (await reader(url)).json(),rows);assert.equal(requests.length,count,'Identical reads are shared only within this request');
await exports.createEodReadFetch(network)(url);assert.ok(requests.length>count,'A new export must read fresh data');
const range=await (await reader(url+'&offset=5&limit=7')).json();assert.equal(range.length,7);assert.equal(range[0].id,'5');
const emptyReader=exports.createEodReadFetch(async()=>Response.json({code:'PGRST103'},{status:416,headers:{'Content-Range':'*/1000'}}));
assert.deepEqual(await (await emptyReader(url+'&offset=1000&limit=500')).json(),[],'An exact full final page must finish successfully');
assert.equal((await emptyReader(url+'&offset=500&limit=500')).status,416,'Unexpected out-of-range errors must still fail closed');
failPage=true;assert.equal((await exports.createEodReadFetch(network)(url)).status,503,'A failed later page must not return partial records');failPage=false;
omitCount=true;await assert.rejects(exports.createEodReadFetch(network)(url),/completeness/);omitCount=false;
await assert.rejects(reader(url,{method:'POST'}),/reads only/);
let batchSizes=[];
const batchReader=exports.createEodReadFetch(async(input)=>{
 const u=new URL(input),ids=u.searchParams.get('receipt_id').slice(4,-1).split(',');batchSizes.push(ids.length);
 return Response.json(ids.map(id=>({id,amount:1})),{headers:{'Content-Range':`0-${ids.length-1}/${ids.length}`}});
});
const ids=Array.from({length:2401},(_,i)=>`77777777-7777-4777-8777-${i.toString().padStart(12,'0')}`);
const batched=await (await batchReader(`http://local.test/rest/v1/receipt_items?select=*&receipt_id=in.(${ids.join(',')})`)).json();
assert.equal(batched.length,ids.length);assert.equal(new Set(batched.map(r=>r.id)).size,ids.length);assert.ok(batchSizes.every(size=>size<=200));
console.log('PASS: 2,301 rows despite a 100-row server cap; fresh exports; failed-page and missing-count denial; 2,401 linked IDs batched without omissions.');
