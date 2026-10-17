import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {testModuleLoader} from './load-test-module.mjs';
const load=testModuleLoader();
const {buildPaymentAllocations}=load('lib/payment-allocation.ts');
const {calculateInstallmentFee}=load('lib/tabby-tamara-fees.ts');
const {validateCheckoutBody}=load('lib/checkout-validation.ts');
const id='11111111-1111-4111-8111-111111111111';
const db=new PGlite();
try {
  for(const variant of ['tamara','tabby_standard','tabby_card']) {
    const [row]=buildPaymentAllocations([{id:'test',methodVariant:variant,invoiceAllocationAmountInput:'469.00',providerReferenceNumber:'TEST-ONLY'}],469,469,0);
    const [{fee}]=(await db.query('select round(469::numeric * 0.075,2)::text as fee')).rows;
    assert.equal(row.feeAmount,Number(fee));
    assert.equal(calculateInstallmentFee(469),35.18);
    const body={requestId:id,registerSessionId:id,receipt:{clinic_id:id,patient_id:id,receptionist_id:id,subtotal:719,discount_amount:250,vat:0,total:504.18,total_before_gateway_fee:469,gateway_fee:35.18,amount_paid:504.18},items:[{service_id:id,quantity:1,price:349,total:349,original_price:599,allocated_global_discount_amount:0,taxable_amount:349,vat_rate:0,vat_amount:0,final_line_total:349,teeth:[]},{service_id:id,quantity:1,price:120,total:120,original_price:120,allocated_global_discount_amount:0,taxable_amount:120,vat_rate:0,vat_amount:0,final_line_total:120,teeth:[]}],allocations:[{method_group:row.methodGroup,method_variant:variant,treatment_net_amount:469,vat_amount:0,invoice_allocation_amount:469,fee_rate:0.075,fee_amount:row.feeAmount,customer_charged_amount:row.customerChargedAmount,provider_reference_number:'TEST-ONLY'}]};
    assert.equal(validateCheckoutBody(body).payload.receipt.total,504.18);
    body.allocations[0].fee_amount=35.17;
    assert.throws(()=>validateCheckoutBody(body),/reconcile/);
  }
  const result=await db.query('select n, round((n::numeric/100)*0.075,2)::text as fee from generate_series(1,100000) n');
  for(const row of result.rows)assert.equal(calculateInstallmentFee(row.n/100),Number(row.fee));
  console.log('PASS: reported discounted two-service checkout for Tamara, Tabby and Tabby Card; SQL numeric parity for 100,000 amounts; incorrect old fee rejected. No live data accessed.');
} finally {await db.close();}
