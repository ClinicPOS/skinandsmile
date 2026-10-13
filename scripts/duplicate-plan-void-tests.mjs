import fs from 'node:fs';import assert from 'node:assert/strict';import {randomUUID as uuid} from 'node:crypto';
import XLSX from 'xlsx-js-style';import {createVoidTestDatabase} from './void-test-database.mjs';import {testModuleLoader} from './load-test-module.mjs';import {fixtureQueryClient} from './fixture-query-client.mjs';
const db=await createVoidTestDatabase(),clinic=uuid(),rec=uuid(),patient=uuid(),owner=uuid(),wrong=uuid(),kept=uuid(),card=uuid(),cash=uuid(),doctor=uuid();
const date='2026-10-12T13:25:00Z',load=testModuleLoader();
const requester={actor_id:rec,actor_role:'receptionist',verified:true,void_workflow_version:2,duplicate_plan_workflow_version:1};
const approver={actor_id:owner,actor_role:'owner',verified:true,void_workflow_version:2,duplicate_plan_workflow_version:1,confirm_duplicate_plan:true};
async function insert(table,row){const names=Object.keys(row);await db.query(`insert into ${table}(${names.join(',')}) values(${names.map((_,i)=>'$'+(i+1)).join(',')})`,Object.values(row));}
const transition=(id,action,proposal=null,actor=requester)=>db.query('select public.transition_receipt_refund($1,$2,$3,$4,$5,$6,$7) q',[id,card,action,proposal,actor,'Duplicate plan and wrong Card entry; cash received once','']);
try{
 await db.exec(`alter table treatment_plans add column is_legacy boolean default false,add column historical_amount_paid numeric default 0,add column source_imported_visit_id uuid,add column clinic_patient_file_id uuid;`);
 await db.exec(fs.readFileSync('supabase/migrations/20261008030000_cancel_unused_treatment_plan.sql','utf8'));
 await db.exec(fs.readFileSync('supabase/migrations/20261013040835_duplicate_treatment_plan_void.sql','utf8'));
 await insert('clinics',{id:clinic,name:'TEST ONLY'});await insert('patients',{id:patient,name:'TEST Patient'});await insert('receptionist',{id:rec,name:'TEST Reception',pin:'unused',clinic_id:clinic});await insert('doctors',{id:doctor});await insert('pos_accounts',{id:owner,name:'TEST Owner',role:'owner',enabled:true});
 for(const [plan,payment,method] of [[wrong,card,'Card'],[kept,cash,'Cash']]){
  await insert('treatment_plans',{id:plan,patient_id:patient,clinic_id:clinic,title:'TEST Duplicate Package',total_amount:2199,planned_visits:9,created_at:date});
  await insert('treatment_plan_visits',{treatment_plan_id:plan,visit_number:1,doctor_id:doctor,receptionist_id:rec,notes:'TEST preserve original clinical record',created_at:date});
  const mirror=uuid();await insert('treatment_plan_payments',{id:mirror,treatment_plan_id:plan,patient_id:patient,clinic_id:clinic,amount:400,payment_method:method,receptionist_id:rec,source_payment_record_id:payment,created_at:date});
  await insert('treatment_plan_payment_records',{id:payment,treatment_plan_id:plan,patient_id:patient,clinic_id:clinic,receptionist_id:rec,total_invoice_amount_settled:400,total_customer_charged_amount:400,payment_method_summary:method+' AED 400.00',legacy_treatment_plan_payment_id:mirror,created_at:date});
  await insert('treatment_plan_payment_allocations',{payment_id:payment,method_group:method.toLowerCase(),method_variant:method.toLowerCase(),invoice_allocation_amount:400,treatment_net_amount:400,vat_amount:0,fee_rate:0,fee_amount:0,customer_charged_amount:400});
 }
 const before=(await db.query('select * from treatment_plan_visits order by id')).rows;
 const proposal=(await db.query('select prepare_duplicate_plan_void($1,$2) p',[card,kept])).rows[0].p;assert.equal(proposal.duplicatePlan.preservedVisits,1);assert.equal(proposal.duplicatePlan.originalValues,undefined,'Clinical snapshots stay out of browser proposals');
 const id=uuid();await transition(id,'request',proposal);assert.equal((await db.query('select status from treatment_plans where id=$1',[wrong])).rows[0].status,'Active');
 const pendingClient=await fixtureQueryClient(db);const statusModule=testModuleLoader({}, {'./api-session':{ensureClinicScopeAccess:()=>null}});const pendingResponse=await statusModule('lib/read-eod-status.ts').readEodStatus({userRole:'owner',sessionMode:'manager'},new Request('http://local.test?clinicId='+clinic+'&day=2026-10-12'),pendingClient);assert.equal(pendingResponse.status,200);assert.equal((await pendingResponse.json()).pending.length,1,'A next-day void request makes the original day EOD draft until approval');
 await assert.rejects(transition(id,'approve',null,{...approver,duplicate_plan_workflow_version:0}),/updated/);
 await assert.rejects(transition(id,'approve',null,{...approver,confirm_duplicate_plan:false}),/Confirm/);
 const extraVisit=uuid();await insert('treatment_plan_visits',{id:extraVisit,treatment_plan_id:wrong,visit_number:2,doctor_id:doctor,created_at:date});
 await assert.rejects(transition(id,'approve',null,approver),/clinical activity/);assert.equal((await db.query('select status from treatment_plan_payment_records where id=$1',[card])).rows[0].status,'completed');
 await db.query('delete from treatment_plan_visits where id=$1',[extraVisit]);
 if(db.connect){
  const connection=await db.connect();await connection.query('begin');await connection.query('select id from treatment_plans where id=$1 for update',[wrong]);
  let settled=false;const approval=transition(id,'approve',null,approver).finally(()=>{settled=true;});
  await new Promise(resolve=>setTimeout(resolve,150));assert.equal(settled,false,'Approval must wait for a concurrent plan writer');
  await connection.query('rollback');connection.release();await approval;
 }else await transition(id,'approve',null,approver);
 await transition(id,'approve',null,approver);
 assert.equal((await db.query('select status from treatment_plan_payment_records where id=$1',[card])).rows[0].status,'cancelled');assert.equal((await db.query('select status from treatment_plan_payment_records where id=$1',[cash])).rows[0].status,'completed');
 const plans=(await db.query('select * from treatment_plans')).rows,payments=(await db.query('select * from treatment_plan_payment_records')).rows,legacy=(await db.query('select * from treatment_plan_payments')).rows;
 assert.equal(plans.find(p=>p.id===wrong).duplicate_of_plan_id,kept);assert.equal(plans.find(p=>p.id===kept).status,'Active');assert.deepEqual((await db.query('select * from treatment_plan_visits order by id')).rows,before,'All clinical rows preserved exactly');
 const rollup=load('lib/treatment-plan-rollup.ts').computeTreatmentPlanRollup;
 assert.equal(rollup(plans.find(p=>p.id===wrong),{structuredPayments:payments,legacyPayments:legacy,asOf:'2026-10-12T19:59:59Z'}).remainingBalance,0,'Duplicate has no phantom debt even on corrected earlier reports');
 assert.equal(rollup(plans.find(p=>p.id===kept),{structuredPayments:payments,legacyPayments:legacy}).remainingBalance,1799);
 assert.equal(Number((await db.query('select count(*) n from duplicate_plan_void_audits')).rows[0].n),1);await assert.rejects(db.query('delete from duplicate_plan_void_audits'),/immutable|cannot|append|changed/i);
 const client=await fixtureQueryClient(db);const report=await load('lib/eod-workbook.ts').buildEodWorkbook({supabase:client,activeClinic:{id:clinic,name:'TEST ONLY'},now:new Date(date),fetch:async url=>url.startsWith('/api/workspace/eod?')?Response.json({pending:[],changes:[],statuses:{}}):Response.json({patients:[{id:patient,name:'TEST Patient'}],fileNumbers:[[patient,'007']]}),loadClinicHistoryPatients:async()=>[{id:patient,name:'TEST Patient',clinic_file_no:'007'}]});
 const rows=XLSX.utils.sheet_to_json(report.workbook.Sheets['Daily Summary'],{header:1});const value=label=>Number(rows.find(row=>row[0]===label)?.[1]||0);
 assert.equal(value('Treatment Plan Collections'),400);assert.equal(value('TOTAL MONEY COLLECTED'),400);assert.equal(value('Refunds'),0);assert.equal(Number(rows.find(row=>row[0]==='Cash')[3]),400);assert.equal(Number(rows.find(row=>row[0]==='Card')[3]),0);assert.ok(report.workbook.Sheets['Voided Plan Payments']);
 const ceoLoader=testModuleLoader({}, {'../../../../lib/api-session':{createServerSupabaseClient:()=>client,readAppSession:async()=>({session:{userRole:'owner',sessionMode:'manager'}})},'../../../../lib/protected-data-server':{createProtectedDataClient:()=>client}});
 const response=await ceoLoader('app/api/reports/ceo-dashboard/route.ts').POST(new Request('http://local.test',{method:'POST',body:JSON.stringify({period:'custom',customStart:'2026-10-12',customEnd:'2026-10-12',clinicId:clinic,year:2026})}));const ceo=await response.json();assert.equal(response.status,200,JSON.stringify(ceo));assert.equal(ceo.overview.customerCollections,400);assert.equal(ceo.overview.outstandingBalance,1799);assert.equal(ceo.treatmentPlanRankingPending.visits,1,"Duplicate clinical entry is preserved but excluded from doctor statistics");
 const context={clinic:null,voided:true,patientName:'TEST',planTitle:'TEST',paymentArrangement:'TEST',agreedTotal:2199,amountSettledToday:400,remainingAfterToday:0,totalFeeAmount:0,totalCustomerPaid:400,cashierName:'TEST',services:[],allocations:[]};assert.match(load('lib/print-treatment-plan-payment-receipt.ts').buildTreatmentPlanPaymentReceiptHtml(context),/VOIDED — NOT A VALID PAYMENT/);
 assert.match(load('lib/generate-invoice-html.ts').generateTreatmentPlanPaymentInvoiceHtml({...context,receiptNumber:'TPP-TEST',issuedAt:new Date(date),patient:{name:'TEST'},planTotalAmount:2199}),/VOIDED/);
 assert.equal((await db.query("select has_function_privilege('anon','prepare_duplicate_plan_void(uuid,uuid)','execute') allowed")).rows[0].allowed,false);
 console.log('PASS: atomic duplicate-plan/payment void, retained Cash plan, 400 Cash/0 Card/1799 balance, EOD and actual CEO route, earlier corrected balances, preserved visits, stale/old-app/unconfirmed denial, one immutable audit, marked thermal/A4 copies and anonymous denial.');
}finally{await db.close();}
