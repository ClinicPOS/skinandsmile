// Runs the actual POS export function with localhost-only clients; no browser automation.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID, webcrypto } from 'node:crypto';
import ts from 'typescript';
import { createClient } from '@supabase/supabase-js';
import XLSX from 'xlsx-js-style';
const require=createRequire(import.meta.url);
const status=JSON.parse(fs.readFileSync(process.argv[2],'utf8').replace(/^\uFEFF/,''));
assert.equal(status.API_URL,'http://127.0.0.1:54321');
const token=randomUUID(),clinic='11111111-1111-4111-8111-111111111111';
const headers={apikey:status.SERVICE_ROLE_KEY,Authorization:`Bearer ${status.SERVICE_ROLE_KEY}`,'Content-Type':'application/json'};
async function rest(query,init={}) {const res=await fetch(`${status.API_URL}/rest/v1/${query}`,{...init,headers});assert.ok(res.ok,`Local database operation failed: ${res.status}`);return res;}
const localFetch=async (input,init={})=>{
 const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;
 const resolved=url.startsWith('/')?`http://127.0.0.1:3001${url}`:url;
 assert.ok(resolved.startsWith(status.API_URL+'/')||resolved.startsWith('http://127.0.0.1:3001/'),'Remote network access is forbidden');
 if(resolved.startsWith('http://127.0.0.1:3001/')){
  if(new URL(resolved).pathname==='/api/workspace/eod-export')init={...init,body:JSON.stringify({...JSON.parse(init.body),day:process.env.LOCAL_EOD_REPORT_DAY||'2026-10-07'})};
  return fetch(resolved,{...init,headers:{...init.headers,Cookie:`app-auth=${token}`}});
 }
 const parsed=new URL(resolved);if(process.env.LOCAL_EOD_FAIL_TABLE && parsed.pathname==='/rest/v1/'+process.env.LOCAL_EOD_FAIL_TABLE)return Response.json({message:'Injected local read failure',code:'TEST'},{status:503});if(parsed.pathname.startsWith('/rest/v1/')&&(!init.method||init.method==='GET'||init.method==='HEAD')){const h=new Headers(init.headers);return fetch('http://127.0.0.1:3001/api/pos-read',{method:'POST',headers:{'Content-Type':'application/json',Cookie:'app-auth='+token},body:JSON.stringify({table:parsed.pathname.slice('/rest/v1/'.length),query:parsed.search.slice(1),range:h.get('range'),accept:h.get('accept'),count:h.get('prefer')?.includes('count=exact')?'exact':null})});}
 return fetch(resolved,init);
};
const client=createClient(status.API_URL,status.ANON_KEY,{global:{fetch:localFetch},auth:{persistSession:false}});
const modules=new Map();
function loadModule(filename){
 const resolved=path.resolve(filename);
 if(resolved.endsWith(path.join('lib','supabase.ts')))return {supabase:client};
 if(modules.has(resolved))return modules.get(resolved);
 const exports={};modules.set(resolved,exports);
 const compiled=ts.transpileModule(fs.readFileSync(resolved,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(compiled,{exports,require:name=>{
  if(name==='server-only')return {};
  if(name.startsWith('.')) {let target=path.resolve(path.dirname(resolved),name);if(!path.extname(target))target+='.ts';return loadModule(target);}
  return require(name);
 },fetch:localFetch,Response,URL,URLSearchParams,console,crypto:webcrypto,process:{env:{}},setTimeout,clearTimeout},{filename:resolved});
 return exports;
}
const pagePath=path.resolve('app/receipts/page.tsx'), sourceText=fs.readFileSync(process.env.LOCAL_EOD_SOURCE || pagePath,'utf8');
const source=ts.createSourceFile(pagePath,sourceText,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let target;function locate(node){if(ts.isFunctionDeclaration(node)&&node.name?.text==='downloadDailyIncomeReport')target=node;ts.forEachChild(node,locate);}locate(source);assert.ok(target);
let workbook;
const alerts=[];
const reportDay=process.env.LOCAL_EOD_REPORT_DAY||'2026-10-07';assert.match(reportDay,/^\d{4}-\d{2}-\d{2}$/);
const reportStart=new Date(`${reportDay}T00:00:00+04:00`).toISOString(),reportEnd=new Date(Date.parse(reportStart)+86400000-1).toISOString();
class ReportDate extends Date {constructor(...args){super(...(args.length?args:[`${reportDay}T08:00:00Z`]));}static now(){return Date.parse(`${reportDay}T08:00:00Z`);}}
 const scope={exports:{},supabase:client,activeClinic:{id:clinic,name:'TEST ONLY CLINIC A'},eodDate:process.env.LOCAL_EOD_REPORT_DAY||'2026-10-07',isDownloadingEod:false,setIsDownloadingEod:()=>{},performance,Error,XLSX:{...XLSX,writeFile:wb=>{workbook=wb;}},fetch:localFetch,alert:message=>alerts.push(message),console,Date:ReportDate,Intl,Response,URL,URLSearchParams,process:{env:{}},crypto:webcrypto};
scope.roundCurrency=loadModule(path.resolve('lib/money.ts')).roundCurrency;
const names=new Set(['computeTreatmentPlanRollup','extractLegacyCashAmount','getBusinessDayKeyForReporting','getPaymentBreakdownForReporting','getDubaiBusinessDate','getInstallmentFeeProvider','paymentVariantLabel','reportClinicFileNumber','summarizeStoredAllocationCollectionsForReporting','summarizeStoredAllocationRowsForReporting','truncateCurrency','parsePaymentMethodBreakdown','loadClinicHistoryPatients']);
for(const statement of source.statements){
 if(ts.isImportDeclaration(statement)&&statement.importClause?.namedBindings&&ts.isNamedImports(statement.importClause.namedBindings)){
  for(const element of statement.importClause.namedBindings.elements)if(names.has(element.name.text)){
   let filename=path.resolve(path.dirname(pagePath),statement.moduleSpecifier.text);if(!path.extname(filename))filename+='.ts';
   scope[element.name.text]=loadModule(filename)[element.propertyName?.text||element.name.text];
  }
 }
}
const helpers=source.statements.filter(node=>ts.isFunctionDeclaration(node)&&!node.modifiers?.some(m=>m.kind===ts.SyntaxKind.DefaultKeyword)).map(node=>node.getText(source)).join('\n');
const program=ts.transpileModule(`${helpers}\n${target.getText(source)}\nexports.run=downloadDailyIncomeReport;`,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
vm.runInNewContext(program,scope);
try{
 await rest('active_sessions',{method:'POST',body:JSON.stringify({token,session_mode:'clinic',clinic_id:clinic,user_role:'receptionist',created_at:new Date().toISOString()})});
 scope.activeClinic.name=(await (await rest(`clinics?id=eq.${clinic}&select=name`)).json())[0].name;
 const exportStarted=performance.now();
 await scope.exports.run();
 const preparationMs=Math.round(performance.now()-exportStarted);
 if(process.env.LOCAL_EOD_TIMING_OUTPUT)fs.writeFileSync(process.env.LOCAL_EOD_TIMING_OUTPUT,JSON.stringify({preparationMs,reportDay,source:process.env.LOCAL_EOD_SOURCE?'previous browser reads':'single server request'}));
 if(process.env.LOCAL_EOD_FAIL_TABLE){
   assert.equal(workbook,undefined,'Failed required read must prevent export');
   assert.ok(alerts.some(message=>message.includes('not exported')||message.includes('Could not load')));
   console.log('PASS: failed '+process.env.LOCAL_EOD_FAIL_TABLE+' read prevents incomplete EOD export.');
 } else {
 assert.ok(alerts.every(message=>message.includes('unresolved correction/refund requests')),`Export reported an error: ${alerts.join('; ')}`);
 assert.ok(workbook,'Actual EOD function must produce a workbook');
 if(process.env.LOCAL_EOD_SNAPSHOT)fs.writeFileSync(process.env.LOCAL_EOD_SNAPSHOT,JSON.stringify(workbook));
 for(const name of ['Daily Summary','Transaction Details','Treatment Plans','Treatment Plan Payments'])assert.ok(workbook.Sheets[name]);
 const payments=XLSX.utils.sheet_to_json(workbook.Sheets['Treatment Plan Payments'],{header:1});
 const sourcePayments=await (await rest(`treatment_plan_payment_records?clinic_id=eq.${clinic}&created_at=gte.${reportStart}&created_at=lte.${reportEnd}&select=patient_id,total_customer_charged_amount`)).json();
 if(!process.env.LOCAL_EOD_REPORT_DAY)assert.ok(sourcePayments.length>0,'The fake fixture must include plan payments to verify this regression');
 const summary=XLSX.utils.sheet_to_json(workbook.Sheets['Daily Summary'],{header:1});
 const sourceRefunds=await (await rest(`payment_allocation_refunds?clinic_id=eq.${clinic}&created_at=gte.${reportStart}&created_at=lte.${reportEnd}&select=id,total_returned_amount`)).json();
 if(sourceRefunds.length){
  assert.ok(workbook.Sheets.Refunds,'Completed refund reversals must have an export sheet');
  const refundExport=XLSX.utils.sheet_to_json(workbook.Sheets.Refunds,{header:1});
  const totalColumn=refundExport[0].findIndex(name=>String(name).includes('Total Returned'));
  assert.ok(totalColumn>=0);
  for(const refund of sourceRefunds){const row=refundExport.find(row=>row[1]===refund.id);assert.ok(row,'Every completed allocation refund must be exported');assert.equal(Number(row[totalColumn]),Number(refund.total_returned_amount));}
 }
 const expectedCollections=sourcePayments.reduce((sum,row)=>sum+Number(row.total_customer_charged_amount||0),0);
 assert.equal(summary.find(row=>row[0]==='Treatment Plan Collections')?.[1],expectedCollections);
 const fixturePatient=process.env.LOCAL_EOD_FIXTURE_PATIENT;
 if(fixturePatient){
  assert.match(fixturePatient,/^[a-f0-9-]{36}$/);
  const receipts=await (await rest(`receipts?patient_id=eq.${fixturePatient}&clinic_id=eq.${clinic}&created_at=gte.${reportStart}&created_at=lte.${reportEnd}&select=id,receipt_number,subtotal,discount_amount,vat,total,amount_paid,credit_applied,status`)).json();
  assert.ok(receipts.length>0);
  const details=XLSX.utils.sheet_to_json(workbook.Sheets['Transaction Details'],{header:1});
  const balances=await (await rest(`outstanding_balances?patient_id=eq.${fixturePatient}&select=receipt_id,original_amount`)).json();
  const paymentLedger=await (await rest(`payment_records?clinic_id=eq.${clinic}&created_at=gte.${reportStart}&created_at=lte.${reportEnd}&select=receipt_id,total_customer_charged_amount,total_invoice_amount_settled`)).json();
  for(const receipt of receipts){
   const row=details.find(row=>Number(String(row[1]||'').replace('#',''))===receipt.receipt_number);
   assert.ok(row, 'Every atomic checkout receipt must appear in EOD');
   assert.equal(row[8],Number(receipt.subtotal));assert.equal(row[9],Number(receipt.discount_amount||0));
   assert.equal(row[10],Number(receipt.total));assert.equal(row[11],Number(receipt.vat));
   const recorded=paymentLedger.filter(p=>p.receipt_id===receipt.id);assert.equal(row[25],recorded.length?recorded.reduce((sum,p)=>sum+Number(p.total_customer_charged_amount),0):Number(receipt.amount_paid??receipt.total));assert.equal(row[26],Number(receipt.credit_applied||0));
   if(receipt.status!=='VOIDED'){const invoice=Number(receipt.subtotal)-Number(receipt.discount_amount||0)+Number(receipt.vat),settled=recorded.length?recorded.reduce((sum,p)=>sum+Number(p.total_invoice_amount_settled),0):Math.min(invoice,Number(receipt.amount_paid??receipt.total));assert.ok(Math.abs(Number(row[27])-Math.max(0,invoice-settled-Number(receipt.credit_applied||0)))<0.001);}
   if(receipt.status==='VOIDED'){assert.equal(row[28],'VOIDED');const index=details.indexOf(row);const cell=workbook.Sheets['Transaction Details'][XLSX.utils.encode_cell({r:index,c:2})];assert.equal(cell.s.font.strike,true);assert.equal(cell.s.fill.fgColor.rgb,'E5E7EB');}
  }
 }
 const detailData=XLSX.utils.sheet_to_json(workbook.Sheets['Transaction Details'],{header:1});assert.equal(detailData[0][28],'Status');
 const totalRow=detailData.find(row=>row[0]==='NET TOTALS');assert.ok(totalRow);
 const summaryRows=XLSX.utils.sheet_to_json(workbook.Sheets['Daily Summary'],{header:1});
 assert.ok(Math.abs(Number(totalRow[25])-Number(summaryRows.find(row=>row[0]==='NET MONEY COLLECTED')[1])+expectedCollections+Number(summaryRows.find(row=>row[0]==='Old Balance Collections')?.[1]||0)+Number(summaryRows.find(row=>row[0]==='Advance Payments / Prepayments')?.[1]||0)-Number(summaryRows.find(row=>row[0]==='Refunds from earlier receipts')?.[1]||0))<0.001,'Receipt net collections must match summary for these receipt-only fixtures: detail='+totalRow[25]+' summary='+summaryRows.find(row=>row[0]==='NET MONEY COLLECTED')[1]+' plan='+expectedCollections);
 for(const [method,index] of (expectedCollections===0 && Number(summaryRows.find(row=>row[0]==='Refunds from earlier receipts')?.[1]||0)===0 && Number(summaryRows.find(row=>row[0]==='Old Balance Collections')?.[1]||0)===0 && Number(summaryRows.find(row=>row[0]==='Advance Payments / Prepayments')?.[1]||0)===0?[['Cash',12],['Tabby',15],['Card',13]]:[])){const summaryMethod=summaryRows.find(row=>row[0]===method);assert.ok(summaryMethod);assert.ok(Math.abs(Number(totalRow[index])-Number(summaryMethod[3]))<0.001,'Net payment method must reconcile: '+method);}
 for(let index=1;index<detailData.length;index++){const row=detailData[index];if(['REFUNDED','PARTIALLY_REFUNDED'].includes(row[28])){const cell=workbook.Sheets['Transaction Details'][XLSX.utils.encode_cell({r:index,c:2})];assert.equal(cell.s.fill.fgColor.rgb,row[28]==='REFUNDED'?'FECACA':'FEF3C7');}}
 assert.ok(workbook.Sheets['Pending Approvals']);
 const files=await (await rest(`clinic_patient_files?clinic_id=eq.${clinic}&select=patient_id,file_no`)).json();
 for(const payment of sourcePayments){const file=files.find(f=>f.patient_id===payment.patient_id);assert.ok(payments.some(row=>row[2]===file.file_no&&row[1]),'Plan payment export must retain the patient name and current clinic file label');}
 if(process.env.LOCAL_EOD_QA_OUTPUT)fs.writeFileSync(process.env.LOCAL_EOD_QA_OUTPUT,XLSX.write(workbook,{type:'buffer',bookType:'xlsx'}));
 console.log('PASS: actual POS EOD export function executed against restricted local Supabase; expected sheets and treatment-payment file labels verified.');
}
}finally{await rest(`active_sessions?token=eq.${token}`,{method:'DELETE'});}
