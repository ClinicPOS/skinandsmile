// LOCALHOST ONLY: retained labelled register fixture, no financial deletion.
import fs from 'node:fs';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
const config=JSON.parse(fs.readFileSync(process.argv[2],'utf8').replace(/^\uFEFF/,''));assert.equal(config.API_URL,'http://127.0.0.1:54321');
const clinic='11111111-1111-4111-8111-111111111111',rec='33333333-3333-4333-8333-333333333333',register=randomUUID(),token=randomUUID(),foreign=randomUUID();
const headers={apikey:config.SERVICE_ROLE_KEY,Authorization:`Bearer ${config.SERVICE_ROLE_KEY}`,'Content-Type':'application/json'};
async function db(path,init={}){const r=await fetch(`${config.API_URL}/rest/v1/${path}`,{...init,headers});assert.ok(r.ok,await r.clone().text());const text=await r.text();return text?JSON.parse(text):null;}
async function get(auth){return fetch(`http://127.0.0.1:3001/api/cash-deductions?registerSessionId=${register}`,{headers:auth?{Cookie:`app-auth=${auth}`}:{}});}
try{
 await db('cash_register_sessions',{method:'POST',body:JSON.stringify({id:register,receptionist_id:rec,opened_at:'2026-10-08T00:00:00Z',closed_at:new Date().toISOString(),opening_cash:0,closing_cash:0})});
 await db('active_sessions',{method:'POST',body:JSON.stringify([{token,session_mode:'clinic',user_role:'receptionist',clinic_id:clinic,receptionist_id:rec,created_at:new Date().toISOString()},{token:foreign,session_mode:'clinic',user_role:'receptionist',clinic_id:'22222222-2222-4222-8222-222222222222',receptionist_id:'44444444-4444-4444-8444-444444444444',created_at:new Date().toISOString()}])});
 assert.equal((await get()).status,401);assert.equal((await get(foreign)).status,403);
 const response=await get(token);assert.equal(response.status,200,await response.clone().text());const result=await response.json();assert.equal(result.clinicId,clinic);assert.equal(result.summary.registerStatus,'closed');assert.ok(Number.isFinite(result.summary.cashCollected));
 console.log('PASS: real cash-summary database queries, receptionist login, foreign-clinic rejection, closed-register summary and finite reconciled total.');
}finally{for(const value of [token,foreign])await db(`active_sessions?token=eq.${value}`,{method:'DELETE'});}
