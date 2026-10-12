// Runs the real Next.js pages/routes against a localhost-only synthetic REST
// adapter and real PostgreSQL functions. No production URL or credential is used.
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID as uuid} from 'node:crypto';
import {createVoidTestDatabase} from './void-test-database.mjs';
const db=await createVoidTestDatabase(),clinic=uuid(),patient=uuid(),rec=uuid(),target=uuid(),token=uuid();
await db.exec(fs.readFileSync('supabase/migrations/20261012175015_pos_history_pagination.sql','utf8'));
let appProcess,backend;
const counts=[];
const rpcArgs={pos_receipt_history_page:['p_clinic_id','p_offset','p_limit'],prepare_pos_void:['p_target_id'],transition_receipt_refund:['p_id','p_receipt_id','p_action','p_proposal','p_actor','p_reason','p_reference']};
try{
 await db.query('insert into clinics(id,name) values($1,$2)',[clinic,'TEST ONLY']);await db.query('insert into patients(id,name,phone) values($1,$2,$3)',[patient,'TEST HTTP Patient','0500000000']);
 await db.query('insert into receptionist(id,name,pin,clinic_id) values($1,$2,$3,$4)',[rec,'TEST Reception','unused',clinic]);
 await db.query('insert into clinic_patient_files(id,clinic_id,patient_id,file_no) values($1,$2,$3,$4)',[uuid(),clinic,patient,'123']);
 await db.query("insert into receipts(id,clinic_id,patient_id,receptionist_id,total,gateway_fee,created_at) values($1,$2,$3,$4,225.75,15.75,'2026-09-01')",[target,clinic,patient,rec]);
 backend=http.createServer(async(req,res)=>{
  try{
   const url=new URL(req.url,'http://127.0.0.1');counts.push(url.pathname);
   assert.ok(url.pathname.startsWith('/rest/v1/'));
   const table=url.pathname.slice('/rest/v1/'.length);
   let result;
   if(table.startsWith('rpc/')){
    const name=table.slice(4),fields=rpcArgs[name];if(!fields)throw Error('Unexpected RPC '+name);
    const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks));
    result=(await db.query(`select public.${name}(${fields.map((_,i)=>`$${i+1}`).join(',')}) value`,fields.map(field=>body[field]))).rows[0].value;
   }else{
    const known=(await db.query("select tablename from pg_tables where schemaname='public'")).rows.map(row=>row.tablename);
    if(table==='active_sessions')result=url.searchParams.get('token')===`eq.${token}`?[{token,session_mode:'clinic',user_role:'receptionist',clinic_id:clinic,receptionist_id:rec,created_at:new Date().toISOString(),account_id:null}]:[];
    else{
     if(!known.includes(table))throw Error('Unknown test table '+table);
     result=(await db.query(`select * from public.${table}`)).rows;
     if(table==='receptionist')result=result.map(row=>({...row,is_active:true}));
     if(table==='clinic_patient_files'){
      const patients=(await db.query('select * from patients')).rows;result=result.map(row=>({...row,patients:patients.find(p=>p.id===row.patient_id)}));
     }
     for(const [field,filter] of url.searchParams){
      if(['select','order','offset','limit'].includes(field))continue;
      if(field==='patients.or'){const term=filter.match(/%([^%]+)%/)?.[1];if(term)result=result.filter(row=>row.patients.name.includes(term)||row.patients.phone?.includes(term));continue;}
      if(filter.startsWith('eq.'))result=result.filter(row=>String(row[field])===filter.slice(3));
      else if(filter.startsWith('in.(')){const ids=filter.slice(4,-1).split(',');result=result.filter(row=>ids.includes(String(row[field])));}
      else throw Error('Unexpected fixture filter '+field+' '+filter);
     }
     const from=Number(url.searchParams.get('offset')||0),limit=Number(url.searchParams.get('limit')||1000);result=result.slice(from,from+limit);
    }
    if(req.headers.accept?.includes('object+json'))result=result[0]||null;
   }
   res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(result));
  }catch(error){res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({message:error.message}));}
 });
 await new Promise(resolve=>backend.listen(0,'127.0.0.1',resolve));
 const backendURL=`http://127.0.0.1:${backend.address().port}`;
 const socket=net.createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
 let logs='';
 appProcess=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--hostname','127.0.0.1','--port',String(port)],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,NEXT_PUBLIC_SUPABASE_URL:backendURL,NEXT_PUBLIC_SUPABASE_ANON_KEY:'test-only',SUPABASE_SERVER_SECRET_KEY:'sb_secret_synthetic',SUPABASE_SESSION_SECRET_KEY:'sb_secret_synthetic',NEXT_TELEMETRY_DISABLED:'1'}});
 appProcess.stdout.on('data',chunk=>logs+=chunk);appProcess.stderr.on('data',chunk=>logs+=chunk);
 const base=`http://127.0.0.1:${port}`;
 const deadline=Date.now()+60000;while(!logs.includes('Ready in')){if(Date.now()>deadline||appProcess.exitCode!==null)throw Error('Test Next.js server could not start: '+logs.slice(-1200));await new Promise(resolve=>setTimeout(resolve,200));}
 async function call(path,body,auth=true){const start=performance.now(),count=counts.length;const response=await fetch(base+path,{method:body?'POST':'GET',headers:{...(auth?{Cookie:`app-auth=${token}`}:{}) , 'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),redirect:'manual'});const text=await response.text();assert.equal(response.status,200,`${path}: ${response.status} ${text.slice(0,500)}`);return {ms:Number((performance.now()-start).toFixed(1)),databaseRequests:counts.slice(count),serverTiming:response.headers.get('server-timing'),bytes:Buffer.byteLength(text),body:response.headers.get('content-type')?.includes('json')?JSON.parse(text):null};}
 const cold=await call('/receipts'),warm=await call('/receipts');
 const historyCold=await call(`/api/receipts/history?clinicId=${clinic}`),historyWarm=await call(`/api/receipts/history?clinicId=${clinic}`);
 const searchCold=await call(`/api/patients/search?clinicId=${clinic}&q=TEST`),searchWarm=await call(`/api/patients/search?clinicId=${clinic}&q=TEST`);
 const request={action:'request',kind:'VOID',receiptId:target,operationId:uuid(),reason:'TEST HTTP wrong Tabby entry',itemIds:[],allocationAmounts:{}};
 const save=await call('/api/workspace/refunds',request),retry=await call('/api/workspace/refunds',request);
 assert.equal(save.body.request.id,retry.body.request.id);
 await call('/api/workspace/refunds',{action:'cancel',id:request.operationId});
 const warmSave=await call('/api/workspace/refunds',{...request,operationId:uuid()});assert.equal((await db.query('select status from receipts where id=$1',[target])).rows[0].status,'COMPLETED');
 for(const path of ['/api/receipts/history','/api/receipts/checkout','/api/patients/search','/api/patients/history','/api/patients/clinic-records','/api/workspace/refunds']){
  const write=path.endsWith('refunds')||path.endsWith('checkout');
  const response=await fetch(base+path,{method:write?'POST':'GET',headers:{'Content-Type':'application/json'},...(write?{body:JSON.stringify(request)}:{})});assert.equal(response.status,401,'Self-authenticating route must still reject anonymous requests');
 }
 const redact=({body,...result})=>result;
 const result={date:'2026-10-12',environment:'Local Next.js development server + synthetic localhost REST adapter + PostgreSQL WASM. Cold timings include compilation; HTML timings exclude browser hydration. No production contacted.',page:{cold:redact(cold),warm:redact(warm)},receiptHistory:{cold:redact(historyCold),warm:redact(historyWarm)},patientSearch:{cold:redact(searchCold),warm:redact(searchWarm)},voidRequestSave:{cold:redact(save),warm:redact(warmSave)},idempotentRetry:redact(retry)};
 fs.writeFileSync('docs/security/pos-performance-http-results.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
}finally{
 if(appProcess?.pid&&appProcess.exitCode===null){if(process.platform==='win32')await promisify(execFile)('C:\\Windows\\System32\\taskkill.exe',['/PID',String(appProcess.pid),'/T','/F'],{windowsHide:true});else appProcess.kill('SIGTERM');}
 if(backend)await new Promise(resolve=>backend.close(resolve));await db.close();
}
