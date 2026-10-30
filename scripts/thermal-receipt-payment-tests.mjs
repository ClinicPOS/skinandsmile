import assert from 'node:assert/strict';
import {testModuleLoader} from './load-test-module.mjs';

const load=testModuleLoader();
const {buildDepositReceiptHtml}=load('lib/print-deposit-receipt.ts');
const {buildPaymentReceiptHtml}=load('lib/print-payment-receipt.ts');
const {buildThermalReceiptHtml}=load('lib/build-thermal-receipt-html.ts');
const base={
  title:'Receipt',clinic:null,invoiceNumber:'TEST-1',dateValue:'29/10/2026',timeValue:'12:00',cashierName:'Test',doctorName:'-',
  patientName:'Test Patient',patientPhone:'0500000000',patientFileNumber:'007',doctorField:'Doctor',items:[],subtotal:100,
  discountAmount:0,vat:0,total:100,allocations:[],creditUsed:0,outstandingBalance:0,notes:'',paymentMethod:'Cash',
};

function receipt(overrides) {
  const html=buildThermalReceiptHtml({...base,...overrides});
  const amount=html.match(/<span>Total Customer Pays<\/span><span>: AED ([\d.]+)/)?.[1]
    ??html.match(/<span>Amount Paid[^<]*<\/span><span>: AED ([\d.]+)/)?.[1];
  assert.ok(amount, 'receipt includes the collected amount');
  assert.equal(Number(amount),overrides.expectedCollected);
  if(overrides.expectedCustomerPays!=null){
    const customerPays=html.match(/<span>Total Customer Pays<\/span><span>: AED ([\d.]+)/)?.[1];
    assert.equal(Number(customerPays),overrides.expectedCustomerPays);
  }
  if(overrides.expectedOutstanding!=null){
    const outstanding=html.match(/<span>Outstanding[^<]*<\/span><span>: AED ([\d.]+)/)?.[1];
    assert.equal(Number(outstanding),overrides.expectedOutstanding);
  }
  return html;
}

const allocation=(methodVariant,invoiceAllocationAmount,feeAmount=0)=>({
  methodVariant,invoiceAllocationAmount,feeAmount,feeRate:feeAmount?0.075:0,
  customerChargedAmount:invoiceAllocationAmount+feeAmount,
});

receipt({creditUsed:20,allocations:[allocation('cash',80)],expectedCollected:80,expectedCustomerPays:80});
const fullCredit=receipt({creditUsed:100,expectedCollected:0});
assert.match(fullCredit,/PATIENT CREDIT/);
receipt({creditUsed:20,allocations:[allocation('cash',30)],outstandingBalance:50,expectedCollected:30,expectedCustomerPays:30,expectedOutstanding:50});
receipt({creditUsed:20,allocations:[allocation('cash',40),allocation('card',40)],expectedCollected:80,expectedCustomerPays:80});
for(const methodVariant of ['tabby_standard','tabby_card','tamara']){
  receipt({creditUsed:20,allocations:[allocation(methodVariant,80,6)],expectedCollected:86,expectedCustomerPays:86});
}
receipt({allocations:[allocation('cash',100)],expectedCollected:100,expectedCustomerPays:100});
assert.match(buildDepositReceiptHtml({clinic:{name:'Test Clinic'},patient:{name:'Test Patient'},credit:{id:'test',amount:20,payment_method:'Cash'},cashierName:'Test',availableAfter:20}),/Deposit Received<\/span><span>AED 20\.00/);
assert.match(buildPaymentReceiptHtml({clinic:{name:'Test Clinic'},patient:{name:'Test Patient'},balance:{id:'test',original_amount:100,reference_number:'TEST'},payment:{amount:30,payment_method:'Cash'},cashierName:'Test',totalPaidBefore:0,remainingAfter:70}),/Amount Paid Today<\/span><span>AED 30\.00/);
assert.match(buildPaymentReceiptHtml({clinic:{name:'Test Clinic'},patient:{name:'Test Patient'},balance:{id:'test',original_amount:100,reference_number:'TEST'},payment:{amount:30,payment_method:'Cash'},cashierName:'Test',totalPaidBefore:0,remainingAfter:70}),/Remaining Balance<\/span><span>AED 70\.00/);

console.log('PASS: patient credit is excluded from collections; invoice, deposit, balance due, split cash/card, Tabby and Tamara amounts remain correct.');
