import assert from 'node:assert/strict';
import {randomUUID as uuid} from 'node:crypto';
import XLSX from 'xlsx-js-style';
import {createVoidTestDatabase} from './void-test-database.mjs';
import {testModuleLoader} from './load-test-module.mjs';
import {fixtureQueryClient} from './fixture-query-client.mjs';
const db=await createVoidTestDatabase(),clinic=uuid(),rec=uuid(),patient=uuid(),manager=uuid(),service=uuid(),target=uuid(),good=uuid(),payment=uuid(),allocation=uuid(),balance=uuid(),refund=uuid();
const date='2026-09-01T08:00:00Z';
async function insert(table,row){const fields=Object.keys(row);await db.query(`insert into ${table}(${fields.join(',')}) values(${fields.map((_,i)=>`$${i+1}`).join(',')})`,Object.values(row));}
const load=testModuleLoader();
async function exportWorkbook(){
 const client=await fixtureQueryClient(db);
 const result=await load('lib/eod-workbook.ts').buildEodWorkbook({supabase:client,activeClinic:{id:clinic,name:'TEST ONLY'},now:new Date(date),
  fetch:async(url)=>{
   if(url.startsWith('/api/workspace/eod?'))return Response.json({pending:[],changes:[],statuses:{}});
   if(url==='/api/patients/report-details')return Response.json({patients:[{id:patient,name:'TEST Patient',clinic_file_no:'TEST'}]});
   throw Error('Unexpected report request '+url);
  },loadClinicHistoryPatients:async()=>[{id:patient,name:'TEST Patient',clinic_file_no:'TEST'}]});
 assert.ok(result?.workbook,'Real workbook must be produced');
 // Verify the final XLSX round trip, not just an intermediate sum.
 const reopened=XLSX.read(XLSX.write(result.workbook,{type:'buffer',bookType:'xlsx'}),{type:'buffer'});
 const sheet=reopened.Sheets[reopened.SheetNames[0]];
 const rows=XLSX.utils.sheet_to_json(sheet,{header:1});
 return {rows,workbook:result.workbook,value:label=>Number(rows.find(row=>row[0]===label)?.[1]||0)};
}
try {
 await insert('clinics',{id:clinic,name:'TEST ONLY'});await insert('receptionist',{id:rec,name:'TEST Reception',pin:'unused',clinic_id:clinic});await insert('patients',{id:patient,name:'TEST Patient'});
 await insert('services',{id:service,name:'TEST Service'});await insert('pos_accounts',{id:manager,role:'owner',enabled:true});
 for(const [id,fee,credit] of [[target,15.75,30],[good,0,0]]){
  await insert('receipts',{id,clinic_id:clinic,patient_id:patient,receptionist_id:rec,subtotal:200,vat:10,total:210+fee,total_before_gateway_fee:210,gateway_fee:fee,credit_applied:credit,amount_paid:210+fee-credit,payment_method:fee?'Tabby':'Cash',created_at:date});
  await insert('receipt_items',{receipt_id:id,service_id:service,total:200,quantity:1,price:200});
 }
 await insert('payment_records',{id:payment,receipt_id:target,clinic_id:clinic,receptionist_id:rec,total_invoice_amount_settled:180,total_vat_amount:8.57,total_payment_fee_amount:15.75,total_customer_charged_amount:195.75,created_at:date});
 await insert('payment_allocations',{id:allocation,payment_id:payment,method_group:'tabby',method_variant:'tabby_standard',invoice_allocation_amount:180,treatment_net_amount:171.43,vat_amount:8.57,fee_amount:15.75,customer_charged_amount:195.75});
 await insert('outstanding_balances',{id:balance,receipt_id:target,clinic_id:clinic,patient_id:patient,original_date:'2026-09-01',original_amount:100});
 await insert('balance_payments',{outstanding_balance_id:balance,amount:40,payment_method:'Cash',receptionist_id:rec,created_at:date});
 await insert('patient_credits',{patient_id:patient,clinic_id:clinic,amount:100,payment_method:'Cash',created_at:date});
 await insert('patient_credits',{patient_id:patient,clinic_id:clinic,receipt_id:target,amount:-30,created_at:date});
 await insert('refunds',{id:refund,receipt_id:target,total_amount:52.5,payment_method:'Tabby',refunded_by:rec,created_at:date});
 await insert('refund_items',{refund_id:refund,service_id:service,service_name:'TEST Service',amount:50,refunded_treatment_amount:50,refunded_vat_amount:2.5,refunded_invoice_amount:52.5});
 await insert('payment_allocation_refunds',{refund_id:refund,payment_id:payment,payment_allocation_id:allocation,receipt_id:target,clinic_id:clinic,refunded_treatment_amount:50,refunded_vat_amount:2.5,refunded_invoice_amount:52.5,reversed_fee_amount:0,total_returned_amount:52.5,original_fee_rate:0.075,processed_by:rec,created_at:date});
 const before=await exportWorkbook();
 const id=uuid(),proposal=(await db.query('select public.prepare_pos_void($1) p',[target])).rows[0].p;
 const args=[id,target,'request',proposal,{actor_id:rec,actor_role:'receptionist',verified:true,void_workflow_version:2},'TEST wrong entry',''];
 await db.query('select public.transition_receipt_refund($1,$2,$3,$4,$5,$6,$7)',args);
 const pending=await exportWorkbook();assert.deepEqual(pending.rows,before.rows,'Pending void must leave report values unchanged');
 args[2]='approve';args[3]=null;args[4]={actor_id:manager,actor_role:'owner',verified:true,void_workflow_version:2};
 await db.query('select public.transition_receipt_refund($1,$2,$3,$4,$5,$6,$7)',args);
 const after=await exportWorkbook();
 assert.equal(after.value('Regular Treatment Collections'),210);
 assert.equal(after.value('Old Balance Collections'),0);
 assert.equal(after.value('Advance Payments / Prepayments'),100);
 assert.equal(after.value('TOTAL MONEY COLLECTED'),310);
 assert.equal(after.value('Refunds'),0);
 assert.equal(after.value('NET MONEY COLLECTED'),310);
 assert.equal(after.value('TOTAL INVOICE SALES'),210);
 assert.equal(after.value('TOTAL BNPL SURCHARGES'),0);
 const detail=Object.values(after.workbook.Sheets).flatMap(sheet=>Object.values(sheet)).filter(cell=>cell&&typeof cell==='object');
 assert.ok(detail.some(cell=>cell.v==='VOIDED'),'Original receipt stays visible as VOIDED in Excel');
 const client=await fixtureQueryClient(db);
 const reportingLoader=testModuleLoader({}, {
  '../../../../lib/api-session':{createServerSupabaseClient:()=>client,readAppSession:async()=>({session:{userRole:'owner',sessionMode:'manager'}})},
  '../../../../lib/protected-data-server':{createProtectedDataClient:()=>client},
 });
 const ceoResponse=await reportingLoader('app/api/reports/ceo-dashboard/route.ts').POST(new Request('http://local.test/api/reports/ceo-dashboard',{method:'POST',body:JSON.stringify({period:'custom',customStart:'2026-09-01',customEnd:'2026-09-01',clinicId:clinic,year:2026})}));
 const ceo=await ceoResponse.json();assert.equal(ceoResponse.status,200,JSON.stringify(ceo));
 assert.equal(ceo.overview.customerCollections,310);assert.equal(ceo.overview.refundsReturned,0);assert.equal(ceo.overview.outstandingBalance,0);
 const servicesResponse=await reportingLoader('app/api/reports/top-services/route.ts').POST(new Request('http://local.test/api/reports/top-services',{method:'POST',body:JSON.stringify({startDate:'2026-09-01',endDate:'2026-09-01',clinicId:clinic})}));
 const services=await servicesResponse.json();assert.equal(servicesResponse.status,200,JSON.stringify(services));assert.equal(services.summary.totalServiceRevenue,200);
 console.log('PASS actual CEO report route agrees with EOD collections/refunds/outstanding totals; service revenue excludes the voided receipt and its refund.');
 console.log('PASS actual EOD workbook and XLSX round trip: pending unchanged; approved void excludes receipt collections/sales/fees, linked balance payments and historical refunds; credit restoration does not create a new deposit; correct receipt and original VOIDED detail retained.');
} finally {await db.close();}
