import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import ts from 'typescript';

const source=fs.readFileSync('app/receipts/page.tsx','utf8');
const ast=ts.createSourceFile('page.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let declaration;
function visit(node){if(ts.isFunctionDeclaration(node)&&node.name?.text==='downloadDailyIncomeReport')declaration=node;ts.forEachChild(node,visit);}
visit(ast);
assert.ok(declaration);
let requests=[],downloads=[],alerts=[];
const scope={eodDate:'2026-10-12',activeClinic:{id:'test-clinic'},isDownloadingEod:false,setIsDownloadingEod:()=>{},performance,Error,alert:m=>alerts.push(m),console:{info(){}},XLSX:{writeFile:(wb,name)=>downloads.push(name)},fetch:async(url,options)=>{requests.push(JSON.parse(options.body));return {ok:true,json:async()=>({workbook:{},fileName:'12 OCT 2026.xlsx',warnings:['DRAFT: approval pending']})};}};
vm.createContext(scope);
vm.runInContext(ts.transpileModule(declaration.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,scope);
await scope.downloadDailyIncomeReport();
assert.equal(requests[0].day,'2026-10-12');
assert.equal(downloads[0],'12 OCT 2026.xlsx');
assert.equal(alerts[0],'DRAFT: approval pending');
scope.eodDate='';await scope.downloadDailyIncomeReport();assert.equal(requests.length,1);assert.equal(alerts.at(-1),'Choose the EOD date first.');
scope.eodDate='2026-10-12';scope.isDownloadingEod=true;await scope.downloadDailyIncomeReport();assert.equal(requests.length,1);
console.log('PASS: selected historical EOD date sent, server filename retained, DRAFT warning retained, blank date and repeated download blocked.');
