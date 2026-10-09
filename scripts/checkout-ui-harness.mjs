// Execute the real POS checkout function against localhost without browser automation.
import fs from 'node:fs'; import vm from 'node:vm'; import ts from 'typescript'; import assert from 'node:assert/strict'; import {webcrypto} from 'node:crypto';
function module(file) {const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports});return exports;}
export async function verifyCheckoutScreen({patient,file,service,clinic,receptionist,token,doctorId,registerId}) {
 const page=fs.readFileSync('app/receipts/page.tsx','utf8');const tree=ts.createSourceFile('page.tsx',page,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let target;
 function find(node){if(ts.isFunctionDeclaration(node)&&node.name?.text==='confirmPaymentAndSave')target=node;ts.forEachChild(node,find);}find(tree);assert.ok(target);
 const alerts=[],store=new Map();const scope={exports:{},console,crypto:webcrypto,sessionStorage:{getItem:key=>store.get(key)||null,setItem:(key,value)=>store.set(key,value)},checkoutRequest:{current:null},
  ...module('lib/receipt-insert.ts'),...module('lib/money.ts'),
  getCreditApplied:()=>0,getRemainingAfterCredit:()=>105,getAmountDueToday:()=>105,getOutstandingAfterPayment:()=>0,
  hasUnconfiguredVatServices:false,selectedPaymentMethod:'Cash',paymentAllocationDrafts:[],validatePaymentAllocations:()=>[],getCashTenderValidationErrors:()=>[],setPaymentValidationErrors:()=>{},
  buildComputedAllocationsForSave:()=>[{methodGroup:'cash',methodVariant:'cash',treatmentNetAmount:100,vatAmount:5,invoiceAllocationAmount:105,feeRate:0,feeAmount:0,customerChargedAmount:105,providerReferenceNumber:null,terminalAuthorizationCode:null,cardNetwork:null}],
  receptionistId:receptionist,loginReceptionistId:null,transactionPatientId:patient,patientId:patient,transactionPatientFileId:file,doctorId,activeClinic:{id:clinic},
  selectedServices:[{id:service,price:100,quantity:1}],validateTeethSelection:()=>true,setIsSavingReceipt:()=>{},
  pricingSummary:{lineDetails:[{quantity:1,originalUnitPrice:100,serviceName:'TEST CHECKOUT',discountedLineTotal:100,globalDiscountAmount:0,taxableAmount:100,vatRate:0.05,vatAmount:5,finalLineTotal:105,manualDiscountAmount:0}]},
  normalizeTeethForItem:()=>[],globalDiscountAmount:0,discountAmount:0,birthdayDiscountAmount:0,birthdayDiscountApplied:false,subtotal:100,vat:5,total:105,
  savePatientDetails:async()=>({ok:true}),registerSessionId:registerId,getPaymentSummaryForSave:()=> 'Cash',notes:'',setCurrentReceipt:()=>{},setPatientCredits:()=>{},setOutstandingBalances:()=>{},
  alert:message=>alerts.push(message),window:{confirm:()=>false},finalizeSuccessfulTransaction:()=>{},
  fetch:async(url,init={})=>{assert.ok(url.startsWith('/api/'),'Only local API paths allowed');return fetch(`http://127.0.0.1:3001${url}`,{...init,headers:{...init.headers,Cookie:`app-auth=${token}`}});}
 };
 vm.runInNewContext(ts.transpileModule(`${target.getText(tree)}\nexports.run=confirmPaymentAndSave;`,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,scope);
 const first=await scope.exports.run();assert.ok(first?.id,`Actual checkout UI failed: ${alerts.join(';')}`);
 const retry=await scope.exports.run();assert.equal(retry.id,first.id);assert.equal(alerts.length,0);
 assert.equal(store.get(`pos-checkout-request:${clinic}`),first.id,'Pending request ID must survive a page reload');
 return first.id;
}
