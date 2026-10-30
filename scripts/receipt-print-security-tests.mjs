import assert from 'node:assert/strict';
import {testModuleLoader} from './load-test-module.mjs';

const load=testModuleLoader();
const {buildDepositReceiptHtml}=load('lib/print-deposit-receipt.ts');
const {buildPaymentReceiptHtml}=load('lib/print-payment-receipt.ts');
const {buildThermalReceiptHtml}=load('lib/build-thermal-receipt-html.ts');
const payload='</title><img src=x onerror="window.__xss=1">&\'"';
const escaped='&lt;/title&gt;&lt;img src=x onerror=&quot;window.__xss=1&quot;&gt;&amp;&#39;&quot;';
const clinic={name:'TEST Clinic',address:'First line\nSecond line',phone:'0500000000'};
const patient={name:'TEST Patient',phone:'0500000001',patient_number:7};
const credit={id:'test-deposit',created_at:'2026-10-29T08:00:00Z',amount:100,payment_method:'Cash',reason:'Advance Payment',notes:'TEST note'};
const deposit=()=>({clinic:{...clinic},patient:{...patient},credit:{...credit},cashierName:'TEST Cashier',availableAfter:150});
const balancePayment=()=>({clinic:{...clinic},patient:{...patient},balance:{id:'test-balance',original_amount:200,reference_number:'OLD-7',reason:'TEST reason'},payment:{amount:100,payment_method:'Cash',notes:'TEST note',created_at:credit.created_at},cashierName:'TEST Cashier',totalPaidBefore:0,remainingAfter:100});
const thermal=()=>({clinic:{...clinic},title:'Receipt',invoiceNumber:'00007',dateValue:'29/10/2026',timeValue:'12:00 PM',cashierName:'TEST Cashier',doctorName:'TEST Doctor',doctorField:'Doctor',patientName:patient.name,patientPhone:patient.phone,patientFileNumber:'007',items:[{name:'TEST Service',quantity:1,price:100,teeth:['11']}],subtotal:100,discountAmount:0,vat:0,total:100,allocations:[],creditUsed:0,outstandingBalance:0,notes:'TEST note',paymentMethod:'Cash'});

function checkFields(build,fixture,paths){
 for(const path of paths){
  const context=fixture();let target=context;
  for(const key of path.slice(0,-1))target=target[key];
  target[path.at(-1)]=payload;
  const html=build(context);
  assert.ok(!html.toLowerCase().includes(payload.toLowerCase()),`Raw HTML in ${path.join('.')}`);
  assert.ok(html.toLowerCase().includes(escaped.toLowerCase()),`Missing escaped text for ${path.join('.')}`);
 }
}
const clinicPaths=['name','address','phone','trn','instagram','facebook'].map(key=>['clinic',key]);
checkFields(buildDepositReceiptHtml,deposit,[...clinicPaths,['cashierName'],['patient','name'],['patient','phone'],['credit','payment_method'],['credit','reason'],['credit','notes']]);
checkFields(buildPaymentReceiptHtml,balancePayment,[...clinicPaths,['cashierName'],['patient','name'],['patient','phone'],['balance','reference_number'],['balance','reason'],['payment','payment_method'],['payment','notes']]);
checkFields(buildThermalReceiptHtml,thermal,[...['name','address','room','trn','phone','whatsapp','receipt_print_name','receipt_title','receipt_vat_note','receipt_thank_you','receipt_final_message'].map(key=>['clinic',key]),...['title','invoiceNumber','dateValue','timeValue','cashierName','doctorName','doctorField','patientName','patientPhone','patientFileNumber','notes','paymentMethod','receiptHeaderLabel'].map(key=>[key]),['items',0,'name'],['items',0,'teeth',0]]);
for(const snapshot of [false,true])for(const promo of [false,true]){
 const context=thermal();Object.assign(context.items[0],{name:payload,originalPrice:promo?150:100,...(snapshot?{taxableAmount:100,vatRate:0.05,vatAmount:5,finalLineTotal:105}:{})});
 assert.ok(buildThermalReceiptHtml(context).includes(escaped),'Every item rendering branch escapes service names');
}
for(const field of ['methodVariant','providerReferenceNumber']){
 const context=thermal();context.allocations=[{methodVariant:'card',customerChargedAmount:100,invoiceAllocationAmount:100,feeAmount:0,feeRate:0,[field]:payload}];
 const html=buildThermalReceiptHtml(context);
 assert.doesNotMatch(html,/<img src=x onerror=/i,`Raw allocation ${field}`);
 assert.ok(html.includes('&lt;img src=x onerror='),`Missing escaped allocation ${field}`);
}
const discount=thermal();Object.assign(discount,{discountAmount:10,discountType:'%',discountInput:payload});
assert.ok(buildThermalReceiptHtml(discount).includes(escaped));
assert.match(buildDepositReceiptHtml(deposit()),/First line<br\/>Second line/);
assert.match(buildPaymentReceiptHtml(balancePayment()),/Remaining Balance<\/span><span>AED 100\.00/);
const normal=buildThermalReceiptHtml(thermal());
assert.match(normal,/width: 72mm/);assert.match(normal,/AED 100\.00/);assert.match(normal,/<svg /);
assert.match(normal,/TEST Service.*Tooth #11/);
console.log('PASS: deposit, balance and thermal receipt text is escaped, including services, teeth, provider references and all item branches; layout, QR and amounts retained. No network or live data.');
