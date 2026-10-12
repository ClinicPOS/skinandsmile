import assert from 'node:assert/strict';
import {randomUUID as uuid} from 'node:crypto';
import {createVoidTestDatabase} from './void-test-database.mjs';
const db=await createVoidTestDatabase();
const clinic=uuid(),other=uuid(),patient=uuid(),rec=uuid(),manager=uuid(),owner=uuid(),foreign=uuid(),service=uuid();
const actor=(id,role)=>({actor_id:id,actor_role:role,verified:true,void_workflow_version:2});
const requester=actor(rec,'receptionist'),approver=actor(manager,'clinic_manager');
async function insert(table,row){const fields=Object.keys(row);await db.query(`insert into public.${table}(${fields.join(',')}) values(${fields.map((_,i)=>`$${i+1}`).join(',')})`,Object.values(row));}
async function rows(table,where='true',args=[]){return (await db.query(`select * from public.${table} where ${where}`,args)).rows;}
async function proposal(id){return (await db.query('select public.prepare_pos_void($1) p',[id])).rows[0].p;}
async function transition(id,target,action,p=null,a=requester,reason='TEST mistaken entry'){
 return (await db.query('select public.transition_receipt_refund($1,$2,$3,$4,$5,$6,$7) r',[id,target,action,p,a,reason,''])).rows[0].r;
}
async function request(target){const id=uuid(),p={...await proposal(target),originalInput:'{"kind":"VOID"}'};await transition(id,target,'request',p);return {id,p};}
async function receipt(method='cash',fee=0){
 const id=uuid(),payment=uuid();
 await insert('receipts',{id,clinic_id:clinic,patient_id:patient,receptionist_id:rec,total:210+fee,subtotal:200,vat:10,gateway_fee:fee,amount_paid:210+fee,credit_applied:0,payment_method:method,created_at:'2026-09-01T08:00:00Z'});
 await insert('receipt_items',{receipt_id:id,service_id:service,quantity:1,price:200,total:200});
 await insert('payment_records',{id:payment,receipt_id:id,clinic_id:clinic,receptionist_id:rec,total_invoice_amount_settled:210,total_vat_amount:10,total_payment_fee_amount:fee,total_customer_charged_amount:210+fee});
 for(const variant of method==='split'?['cash','card','tabby_standard','tamara']:[method]){
  await insert('payment_allocations',{payment_id:payment,method_group:variant.startsWith('tabby')?'tabby':variant,method_variant:variant,treatment_net_amount:method==='split'?50:200,vat_amount:method==='split'?2.5:10,invoice_allocation_amount:method==='split'?52.5:210,fee_amount:variant.includes('tabby')||variant==='tamara'?fee:0,customer_charged_amount:method==='split'?52.5:210+fee});
 }
 return id;
}
try {
 await insert('clinics',{id:clinic,name:'TEST ONLY'});await insert('clinics',{id:other,name:'OTHER TEST'});
 await insert('patients',{id:patient,name:'TEST Patient'});await insert('receptionist',{id:rec,name:'TEST Reception',pin:'unused',clinic_id:clinic});
 await insert('clinic_patient_files',{id:uuid(),clinic_id:clinic,patient_id:patient,file_no:'TEST'});
 await insert('services',{id:service,name:'TEST Service'});
 for(const [id,role] of [[manager,'clinic_manager'],[owner,'owner'],[foreign,'clinic_manager']])await insert('pos_accounts',{id,role,enabled:true,name:'TEST Approver'});
 await insert('pos_manager_access',{account_id:manager,clinic_id:clinic,permissions:['correction_approval']});
 await insert('pos_manager_access',{account_id:foreign,clinic_id:other,permissions:['correction_approval']});
 const legacyClientReceipt=await receipt('tabby_standard',15.75);
 await db.query('update receipts set created_at=now() where id=$1',[legacyClientReceipt]);
 const legacyProposal=await proposal(legacyClientReceipt);
 const legacyActor={actor_id:rec,actor_role:'receptionist',verified:true};
 await assert.rejects(transition(uuid(),legacyClientReceipt,'request',legacyProposal,legacyActor),/Credit, fee or refunded/);
 assert.equal((await rows('receipts','id=$1',[legacyClientReceipt]))[0].status,'COMPLETED');
 const helper=(await db.query("select pg_get_functiondef('public.complete_pos_checkout_before_register_lock(uuid,jsonb)'::regprocedure) source")).rows[0].source;
 assert.ok(helper.includes("from public.patient_credits where status='completed'"),'Wrapped checkout must use restored active credit');
 const legacyCash=await receipt();await db.query('update receipts set created_at=now() where id=$1',[legacyCash]);
 const legacyFingerprint=(await db.query('select public.receipt_refund_fingerprint($1) f',[legacyCash])).rows[0].f;
 const legacyCashRequest=uuid();await transition(legacyCashRequest,legacyCash,'request',{kind:'VOID',total:210,invoice:210,fingerprint:legacyFingerprint,method:'Legacy cash cancellation',items:[]},legacyActor);
 await transition(legacyCashRequest,legacyCash,'approve',null,{actor_id:owner,actor_role:'owner',verified:true});
 assert.equal((await rows('receipts','id=$1',[legacyCash]))[0].status,'VOIDED','Existing supported cash path stays compatible');
 console.log('PASS old application retains its original guard; expanded void needs the server version marker; wrapped checkout excludes cancelled credit debits.');
 for(const method of ['cash','card','tabby_standard','tabby_card','tamara','split']){
  const target=await receipt(method,method==='cash'||method==='card'?0:15.75),before=await rows('payment_records','receipt_id=$1',[target]);
  // Rejected and cancelled refund requests are audit records, not returned money.
  for(const status of ['REJECTED','CANCELLED'])await insert('receipt_refund_requests',{id:uuid(),receipt_id:target,clinic_id:clinic,requested_by:rec,requested_reason:'TEST mistaken refund',proposal:{},fingerprint:'test',status});
  const q=await request(target);assert.deepEqual(await rows('payment_records','receipt_id=$1',[target]),before);
  await assert.rejects(transition(q.id,target,'approve',null,requester),/approver/i);
  await assert.rejects(transition(q.id,target,'approve',null,actor(foreign,'clinic_manager')),/not assigned/);
  await assert.rejects(transition(q.id,target,'approve',null,{...approver,verified:false}),/Verified/);
  await db.query('update pos_accounts set enabled=false where id=$1',[manager]);
  await assert.rejects(transition(q.id,target,'approve',null,approver),/approver/i);
  await db.query('update pos_accounts set enabled=true where id=$1',[manager]);
  await assert.rejects(request(target),/open request/);
  const approved=await Promise.all([transition(q.id,target,'approve',null,approver),transition(q.id,target,'approve',null,approver)]);
  assert.ok(approved.every(row=>row.status==='COMPLETED'));
  assert.equal((await rows('pos_void_audits','target_id=$1',[target])).length,1);
  const saved=(await rows('receipts','id=$1',[target]))[0];assert.equal(saved.status,'VOIDED');assert.equal(Number(saved.total),210+(method==='cash'||method==='card'?0:15.75));
  assert.ok((await rows('payment_records','receipt_id=$1',[target])).every(row=>row.status==='cancelled'));
  const audits=(await rows('pos_void_audits','target_id=$1',[target]))[0];assert.equal(audits.original_values.receipt.status,'COMPLETED');assert.equal(audits.requested_by,rec);assert.equal(audits.approved_by,manager);
  await assert.rejects(db.query('update pos_void_audits set reason=$1 where target_id=$2',['tamper',target]),/cannot be edited/);
  await assert.rejects(transition(q.id,target,'execute'),/cannot be executed/);
  console.log(`PASS ${method}: earlier-day void, permissions, pending unchanged, rejected/cancelled refund requests, duplicates, simultaneous approval and immutable audit.`);
 }
 for(const action of ['reject','cancel']){
  const target=await receipt(),q=await request(target),before=await rows('payment_records','receipt_id=$1',[target]);
  await transition(q.id,target,action,null,action==='reject'?approver:requester);
  assert.equal((await rows('receipts','id=$1',[target]))[0].status,'COMPLETED');assert.deepEqual(await rows('payment_records','receipt_id=$1',[target]),before);
 }
 const target=await receipt('tabby_standard',15.75),payment=(await rows('payment_records','receipt_id=$1',[target]))[0],allocation=(await rows('payment_allocations','payment_id=$1',[payment.id]))[0];
 const balance=uuid(),refund=uuid();
 await db.query('update receipts set credit_applied=30 where id=$1',[target]);
 await insert('outstanding_balances',{id:balance,receipt_id:target,clinic_id:clinic,patient_id:patient,original_date:'2026-09-01',original_amount:100});
 await insert('balance_payments',{outstanding_balance_id:balance,amount:40,payment_method:'Cash',receptionist_id:rec});
 await insert('patient_credits',{patient_id:patient,clinic_id:clinic,amount:100,payment_method:'Cash'});
 await insert('patient_credits',{patient_id:patient,clinic_id:clinic,amount:-30,receipt_id:target});
 await insert('refunds',{id:refund,receipt_id:target,total_amount:52.5,refunded_by:rec,payment_method:'Tabby',reason:'TEST money actually returned'});
 await insert('payment_allocation_refunds',{refund_id:refund,payment_id:payment.id,payment_allocation_id:allocation.id,receipt_id:target,clinic_id:clinic,refunded_treatment_amount:50,refunded_vat_amount:2.5,refunded_invoice_amount:52.5,reversed_fee_amount:0,total_returned_amount:52.5,original_fee_rate:0.075});
 let q=await request(target);
 assert.equal(q.p.reconciliation.creditToRestore,30);assert.equal(q.p.reconciliation.completedRefunds,52.5);assert.equal(q.p.reconciliation.laterBalanceCollections,40);
 // A later payment after the request invalidates the approval without any reversal.
 await insert('balance_payments',{outstanding_balance_id:balance,amount:10,payment_method:'Card',receptionist_id:rec});
 await assert.rejects(transition(q.id,target,'approve',null,approver),/Financial records changed/);
 assert.equal((await rows('receipts','id=$1',[target]))[0].status,'COMPLETED');
 await transition(q.id,target,'cancel');q=await request(target);await transition(q.id,target,'approve',null,actor(owner,'owner'));
 assert.equal(Number((await db.query("select sum(amount) s from patient_credits where status='completed'")).rows[0].s),100,'Restores credit without inventing a deposit');
 assert.equal(Number((await rows('outstanding_balances','id=$1',[balance]))[0].original_amount),0);
 assert.ok((await rows('balance_payments','outstanding_balance_id=$1',[balance])).every(row=>row.status==='cancelled'));
 const savedRefund=(await rows('refunds','id=$1',[refund]))[0];assert.equal(Number(savedRefund.total_amount),52.5);assert.equal(savedRefund.accounting_void_request_id,q.id);
 assert.equal((await rows('payment_allocation_refunds','refund_id=$1',[refund]))[0].status,'completed','Actual refund status remains historical truth');
 const totals=(await db.query(`select (select coalesce(sum(total),0) from receipts where status<>'VOIDED') sales,
 (select coalesce(sum(total_customer_charged_amount),0) from payment_records where status<>'cancelled') collections,
 (select coalesce(sum(total_payment_fee_amount),0) from payment_records where status<>'cancelled') fees,
 (select coalesce(sum(total_amount),0) from refunds where accounting_void_request_id is null) refunds`)).rows[0];
 assert.equal(Number(totals.sales),645.75);assert.equal(Number(totals.collections),645.75);assert.equal(Number(totals.fees),15.75);assert.equal(Number(totals.refunds),0);
 console.log('PASS credit restored once; completed refunds retained and excluded once; later balances cancelled; stale approval rolls back; aggregate sales/collections/fees/refund totals.');
 const generatedCreditReceipt=await receipt();
 await insert('patient_credits',{patient_id:patient,clinic_id:clinic,amount:300,receipt_id:generatedCreditReceipt});
 await insert('patient_credits',{patient_id:patient,clinic_id:clinic,amount:-300,reason:'TEST spent on another receipt'});
 const generatedCreditRequest=await request(generatedCreditReceipt);
 await assert.rejects(transition(generatedCreditRequest.id,generatedCreditReceipt,'approve',null,approver),/already been spent/);
 assert.equal((await rows('receipts','id=$1',[generatedCreditReceipt]))[0].status,'COMPLETED');
 assert.equal((await rows('pos_void_audits','target_id=$1',[generatedCreditReceipt])).length,0);
 console.log('PASS spent receipt-generated credit blocks unsafe approval without changing other receipts or inventing funds.');
 const planId=uuid(),linked=await receipt(),linkedPayment=uuid(),unrelatedPayment=uuid(),legacy=uuid();
 await insert('treatment_plans',{id:planId,clinic_id:clinic,patient_id:patient,title:'TEST clinical plan',total_amount:1000});
 const clinicalVisit=uuid();await insert('treatment_plan_visits',{id:clinicalVisit,treatment_plan_id:planId,receipt_id:linked,visit_number:1,notes:'TEST preserve clinical history'});
 await db.query('update receipts set treatment_plan_id=$1 where id=$2',[planId,linked]);
 await insert('treatment_plan_payments',{id:legacy,treatment_plan_id:planId,patient_id:patient,clinic_id:clinic,amount:100,payment_method:'Card',receptionist_id:rec,source_payment_record_id:linkedPayment});
 for(const [id,receiptId] of [[linkedPayment,linked],[unrelatedPayment,null]])await insert('treatment_plan_payment_records',{id,receipt_id:receiptId,treatment_plan_id:planId,patient_id:patient,clinic_id:clinic,receptionist_id:rec,total_invoice_amount_settled:100,total_customer_charged_amount:100,legacy_treatment_plan_payment_id:id===linkedPayment?legacy:null});
 await insert('pos_plan_payment_requests',{id:uuid(),treatment_plan_id:planId,args:{},result:{payment_record_id:linkedPayment}});
 const visitBefore=await rows('treatment_plan_visits','id=$1',[clinicalVisit]),planBefore=await rows('treatment_plans','id=$1',[planId]);
 q=await request(linked);await transition(q.id,linked,'approve',null,approver);
 assert.equal((await rows('treatment_plan_payment_records','id=$1',[linkedPayment]))[0].status,'cancelled');assert.equal((await rows('treatment_plan_payments','id=$1',[legacy]))[0].status,'cancelled');
 assert.equal((await rows('pos_plan_payment_requests',"result->>'payment_record_id'=$1",[linkedPayment]))[0].result.status,'cancelled');
 assert.equal((await rows('treatment_plan_payment_records','id=$1',[unrelatedPayment]))[0].status,'completed');assert.deepEqual(await rows('treatment_plan_visits','id=$1',[clinicalVisit]),visitBefore);assert.deepEqual(await rows('treatment_plans','id=$1',[planId]),planBefore);
 q=await request(unrelatedPayment);await transition(q.id,unrelatedPayment,'approve',null,approver);assert.equal((await rows('treatment_plan_payment_records','id=$1',[unrelatedPayment]))[0].status,'cancelled');
 assert.deepEqual(await rows('treatment_plan_visits','id=$1',[clinicalVisit]),visitBefore);
 const visitLinkedReceipt=await receipt(),visitLinkedVisit=uuid(),visitPayment=uuid(),visitMirror=uuid();
 await insert('treatment_plan_visits',{id:visitLinkedVisit,treatment_plan_id:planId,receipt_id:visitLinkedReceipt,visit_number:2,notes:'TEST preserve visit-linked financial history'});
 await insert('treatment_plan_payments',{id:visitMirror,visit_id:visitLinkedVisit,treatment_plan_id:planId,patient_id:patient,clinic_id:clinic,amount:100,payment_method:'Card',receptionist_id:rec,source_payment_record_id:visitPayment});
 await insert('treatment_plan_payment_records',{id:visitPayment,treatment_plan_id:planId,patient_id:patient,clinic_id:clinic,receptionist_id:rec,total_invoice_amount_settled:100,total_customer_charged_amount:100,legacy_treatment_plan_payment_id:visitMirror});
 q=await request(visitLinkedReceipt);assert.equal(q.p.reconciliation.planPaymentCount,1);await transition(q.id,visitLinkedReceipt,'approve',null,approver);
 assert.equal((await rows('treatment_plan_payment_records','id=$1',[visitPayment]))[0].status,'cancelled');assert.equal((await rows('treatment_plan_payments','id=$1',[visitMirror]))[0].status,'cancelled');
 assert.equal((await rows('treatment_plan_visits','id=$1',[visitLinkedVisit]))[0].notes,'TEST preserve visit-linked financial history');
 console.log('PASS existing visit_id -> clinical receipt linkage traces exact plan payment and mirror without deleting the visit.');
 const permissions=(await db.query("select has_function_privilege('anon','public.transition_receipt_refund(uuid,uuid,text,jsonb,jsonb,text,text)','execute') allowed")).rows[0];assert.equal(permissions.allowed,false);
 console.log('PASS exact treatment-plan links and mirrored payments cancelled; unrelated payment/plan/visits preserved; standalone plan payment void; anonymous RPC denied.');
 if(db.connect){
  const target=await receipt(),q=await request(target),connection=await db.connect();
  await connection.query('begin');await connection.query('select id from receipts where id=$1 for update',[target]);
  let finished=false;
  const approval=transition(q.id,target,'approve',null,approver).finally(()=>finished=true);
  // Attach rejection handler immediately: this failure is the expected outcome.
  const expected=assert.rejects(approval,/Financial records changed/);
  await new Promise(resolve=>setTimeout(resolve,75));assert.equal(finished,false,'Other connection must wait for the receipt row lock');
  await connection.query('update payment_records set total_customer_charged_amount=211 where receipt_id=$1',[target]);
  await connection.query('commit');connection.release();await expected;
  assert.equal((await rows('receipts','id=$1',[target]))[0].status,'COMPLETED');assert.equal((await rows('pos_void_audits','target_id=$1',[target])).length,0);
  await transition(q.id,target,'cancel');
  const next=await request(target);
  const raced=await Promise.allSettled([transition(next.id,target,'approve',null,approver),transition(next.id,target,'cancel')]);
  assert.equal(raced.filter(r=>r.status==='fulfilled').length,1);
  const saved=(await rows('receipt_refund_requests','id=$1',[next.id]))[0];assert.ok(['COMPLETED','CANCELLED'].includes(saved.status));
  assert.equal((await rows('receipts','id=$1',[target]))[0].status,saved.status==='COMPLETED'?'VOIDED':'COMPLETED');
  const duplicateTarget=await receipt();
  const duplicateRequests=await Promise.allSettled([request(duplicateTarget),request(duplicateTarget)]);
  assert.equal(duplicateRequests.filter(r=>r.status==='fulfilled').length,1);
  const lateTarget=await receipt(),lateBalance=uuid(),register=uuid();
  await insert('outstanding_balances',{id:lateBalance,receipt_id:lateTarget,clinic_id:clinic,patient_id:patient,original_date:'2026-09-01',original_amount:100});
  await insert('cash_register_sessions',{id:register,receptionist_id:rec,opening_cash:0});
  const lateRequest=await request(lateTarget);
  const collectionRace=await Promise.allSettled([
   transition(lateRequest.id,lateTarget,'approve',null,approver),
   db.query('select public.record_balance_payment($1,$2,$3,$4,$5,$6,$7,$8)',[uuid(),lateBalance,clinic,rec,register,10,'Cash','TEST concurrent collection']),
  ]);
  assert.equal(collectionRace.filter(result=>result.status==='fulfilled').length,1,'Approval and a newly collected balance payment cannot both succeed on the old fingerprint');
  const lateSaved=(await rows('receipts','id=$1',[lateTarget]))[0];
  if(lateSaved.status==='VOIDED')assert.equal((await rows('balance_payments','outstanding_balance_id=$1',[lateBalance])).length,0);
  else assert.equal((await rows('balance_payments','outstanding_balance_id=$1',[lateBalance]))[0].status,'completed');
  console.log('PASS native approve/balance-collection race: either the new collection is retained and approval fails stale, or void completes and the collection is refused.');
  console.log('PASS native PostgreSQL multi-connection contention: receipt row lock blocks approval; intervening payment invalidates fingerprint without reversal; approve/cancel race has one winner; distinct simultaneous requests create one open request.');
 }
} finally {await db.close();}
