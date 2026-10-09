import fs from 'node:fs';import assert from 'node:assert/strict';import XLSX from 'xlsx-js-style';
const c=JSON.parse(fs.readFileSync(process.argv[2],'utf8').replace(/^\uFEFF/,''));assert.equal(c.API_URL,'http://127.0.0.1:54321');
const workbook=XLSX.readFile(process.argv[3]),rows=XLSX.utils.sheet_to_json(workbook.Sheets['Daily Summary'],{header:1});
const value=label=>Number(rows.find(row=>row[0]===label)?.[1]);
let cookie;
try{
 const login=await fetch('http://127.0.0.1:3001/api/auth/staff-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'owner.demo@local.test',password:'LocalOwnerTestOnly!42'})});assert.equal(login.status,200);cookie=login.headers.get('set-cookie').match(/app-auth=[^;]+/)[0];
 const response=await fetch('http://127.0.0.1:3001/api/reports/ceo-dashboard',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({period:'custom',customStart:process.env.LOCAL_EOD_REPORT_DAY||'2026-10-08',customEnd:process.env.LOCAL_EOD_REPORT_DAY||'2026-10-08',clinicId:'11111111-1111-4111-8111-111111111111',includeHistoricalData:true})});assert.equal(response.status,200,await response.clone().text());const data=await response.json();
 const equal=(actual,expected,label)=>assert.ok(Math.abs(Number(actual)-expected)<0.011,label+': '+actual+' versus '+expected);
 equal(data.overview.netSales,value('NET MONEY COLLECTED'),'CEO net money equals EOD');
 equal(data.overview.customerCollections,value('TOTAL MONEY COLLECTED'),'CEO gross collections equals EOD');
 equal(data.overview.netCollectionsAfterDeductions,value('FINAL COLLECTION AFTER DEDUCTIONS'),'CEO net after deductions equals EOD');
 equal(data.cashManagement.cashAfterDeductions,value('EXPECTED CASH AFTER DEDUCTIONS'),'CEO cash after refunds and deductions equals EOD');
 equal(data.clinicPerformance.reduce((sum,row)=>sum+row.netSales,0),data.overview.netSales,'Clinic totals equal overall total');
 const trend=data.trends.sales.points;equal(trend.reduce((sum,row)=>sum+Number(row.netSales),0),data.overview.netSales,'Daily trend equals overall net');
 console.log('PASS: actual CEO and EOD gross/net collections, refunds/deductions, cash, clinic totals and daily trend reconcile.');
}finally{if(cookie)await fetch('http://127.0.0.1:3001/api/auth/logout',{method:'POST',headers:{Cookie:cookie}});}
