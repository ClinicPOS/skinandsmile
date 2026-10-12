import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
export function testModuleLoader(globals={},overrides={},sources={}) {
 const cache=new Map();
 function load(file){
  file=path.resolve(file);
  if(!path.extname(file))file+=fs.existsSync(file+'.ts')?'.ts':'.tsx';
  if(cache.has(file))return cache.get(file);
  const exports={};cache.set(file,exports);
  const compiled=ts.transpileModule(sources[file]??fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  vm.runInNewContext(compiled,{exports,require:name=>{
   if(name in overrides)return overrides[name];
   if(name==='server-only')return {};
   if(name.endsWith('/supabase'))return {supabase:{}};
   return name.startsWith('.')?load(path.resolve(path.dirname(file),name)):require(name);
  },console,Error,process:{env:{}},URL,URLSearchParams,Response,Headers,Date,Intl,performance,fetch,AbortController,setTimeout,clearTimeout,...globals},{filename:file});
  return exports;
 }
 return load;
}
