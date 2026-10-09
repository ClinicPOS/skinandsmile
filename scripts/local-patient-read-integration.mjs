// Disposable localhost test only. Never accepts a remote database or app URL.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const status = JSON.parse(fs.readFileSync(process.argv[2], 'utf8').replace(/^\uFEFF/, ''));
assert.equal(status.API_URL, 'http://127.0.0.1:54321', 'Only the disposable local Supabase is permitted');
const app = 'http://127.0.0.1:3001';
const headers = { apikey: status.SERVICE_ROLE_KEY, Authorization: `Bearer ${status.SERVICE_ROLE_KEY}`, 'Content-Type':'application/json' };
const clinics = ['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222'];
const created = [];
const createdPatients = [];
const exportsCreated = [];
async function rest(path, init={}) {
  const res = await fetch(`${status.API_URL}/rest/v1/${path}`, { ...init, headers });
  assert.ok(res.ok, `Local database operation failed (${res.status})`);
  return res;
}
try {
  const unauth = await fetch(`${app}/api/patients/search?clinicId=${clinics[0]}`);
  assert.equal(unauth.status,401);
  const anonHeaders={apikey:status.ANON_KEY,Authorization:`Bearer ${status.ANON_KEY}`,'Content-Type':'application/json'};
  for(const table of ['patients','clinic_patient_files','patient_backup_exports']) {
    const denied=await fetch(`${status.API_URL}/rest/v1/${table}?select=id&limit=1`,{headers:anonHeaders});
    assert.ok([401,403].includes(denied.status),`Anonymous ${table} access must be denied`);
  }
  for(const [name,args] of [['get_clinic_birthday_patients',{p_clinic_id:clinics[0],p_target_date:'2026-10-07'}],['ensure_patient_clinic_file',{p_patient_id:'77777777-7777-4777-8777-777777777777',p_clinic_id:clinics[0],p_mrn_input:null,p_file_no:null}]]) {
    const denied=await fetch(`${status.API_URL}/rest/v1/rpc/${name}`,{method:'POST',headers:anonHeaders,body:JSON.stringify(args)});
    assert.ok([401,403,404].includes(denied.status),`Anonymous ${name} execution must be denied`);
  }
  for (const [index,clinic] of clinics.entries()) {
    const token=randomUUID();
    await rest('active_sessions',{ method:'POST', body:JSON.stringify({token,session_mode:'clinic',clinic_id:clinic,user_role:'receptionist',created_at:new Date().toISOString()}) });
    created.push(token);
    const cookie={Cookie:`app-auth=${token}`};
    const res=await fetch(`${app}/api/patients/search?clinicId=${clinic}`,{headers:cookie});
    assert.equal(res.status,200);
    const {patients}=await res.json();
    assert.ok(patients.length>0);
    const ownIds=new Set((await (await rest(`clinic_patient_files?clinic_id=eq.${clinic}&select=patient_id`)).json()).map(r=>r.patient_id));
    assert.ok(patients.every(p=>ownIds.has(p.id)));
    const records=await fetch(`${app}/api/patients/clinic-records?clinicId=${clinic}`,{headers:cookie});
    assert.equal(records.status,200);
    const snapshot=await records.json();
    assert.ok(snapshot.patients.every(p=>ownIds.has(p.id)));
    assert.ok(snapshot.files.every(f=>f.clinic_id===clinic));
    assert.equal((await fetch(`${app}/api/patients/clinic-records?clinicId=${clinics[1-index]}`,{headers:cookie})).status,403);
    const exact=await fetch(`${app}/api/patients/search?${new URLSearchParams({clinicId:clinic,q:patients[0].clinic_file_no})}`,{headers:cookie});
    assert.equal(exact.status,200);
    assert.ok((await exact.json()).patients.some(p=>p.id===patients[0].id));
    const name=await fetch(`${app}/api/patients/search?${new URLSearchParams({clinicId:clinic,q:patients[0].name})}`,{headers:cookie});
    assert.equal(name.status,200);
    assert.ok((await name.json()).patients.some(p=>p.id===patients[0].id));
    const punctuation=await fetch(`${app}/api/patients/search?${new URLSearchParams({clinicId:clinic,q:'x",id.not.is.null)'})}`,{headers:cookie});
    assert.equal(punctuation.status,200);
    assert.equal((await punctuation.json()).patients.length,0);
    assert.equal((await fetch(`${app}/api/patients/search?clinicId=${clinics[1-index]}`,{headers:cookie})).status,403);
    const receipts=await (await rest(`receipts?clinic_id=eq.${clinic}&select=patient_id&limit=1`)).json();
    const requested=receipts.length?[receipts[0].patient_id]:[];
    const report=await fetch(`${app}/api/patients/report-details`,{method:'POST',headers:{...cookie,'Content-Type':'application/json'},body:JSON.stringify({clinicId:clinic,patientIds:requested})});
    assert.equal(report.status,200);
    const details=await report.json();
    assert.ok(details.patients.every(p=>requested.includes(p.id)));
    assert.ok(details.fileNumbers.every(([id])=>ownIds.has(id)));
    const forbidden=await fetch(`${app}/api/patients/report-details`,{method:'POST',headers:{...cookie,'Content-Type':'application/json'},body:JSON.stringify({clinicId:clinics[1-index],patientIds:[]})});
    assert.equal(forbidden.status,403);
    const unrelated = index === 0 ? '99999999-9999-4999-8999-999999999999' : '77777777-7777-4777-8777-777777777777';
    const wrongPatient=await fetch(`${app}/api/patients/report-details`,{method:'POST',headers:{...cookie,'Content-Type':'application/json'},body:JSON.stringify({clinicId:clinic,patientIds:[unrelated]})});
    assert.equal(wrongPatient.status,403);
    const mrn=await fetch(`${app}/api/patients/mrn-matches?${new URLSearchParams({clinicId:clinic,mrn:'TEST-UNUSED-MRN'})}`,{headers:cookie});
    assert.equal(mrn.status,200);
    const wrongMrn=await fetch(`${app}/api/patients/mrn-matches?${new URLSearchParams({clinicId:clinics[1-index],mrn:'TEST-UNUSED-MRN'})}`,{headers:cookie});
    assert.equal(wrongMrn.status,403);
    for (const path of ['history', 'birthdays']) {
      const suffix = path === 'birthdays' ? '&date=2026-10-07' : '';
      assert.equal((await fetch(`${app}/api/patients/${path}?clinicId=${clinic}${suffix}`,{headers:cookie})).status,200);
      assert.equal((await fetch(`${app}/api/patients/${path}?clinicId=${clinics[1-index]}${suffix}`,{headers:cookie})).status,403);
    }
    assert.equal((await fetch(`${app}/api/admin/patients`,{headers:cookie})).status,403);
    assert.equal((await fetch(`${app}/api/admin/clinic-files`,{headers:cookie})).status,403);
    assert.equal((await fetch(`${app}/api/patients/simple`,{method:'POST',headers:{...cookie,'Content-Type':'application/json'},body:JSON.stringify({patient:{name:'TEST DENIED',phone:''}})})).status,403);
    if(index===0) {
      const preview=await fetch(`${app}/api/patient-backup`,{method:'POST',headers:{...cookie,'Content-Type':'application/json'},body:JSON.stringify({action:'preview',clinicId:clinic,receptionistId:'33333333-3333-4333-8333-333333333333'})});
      assert.equal(preview.status,200);
      const previewResult=await preview.json();
      assert.equal(previewResult.patientCount,ownIds.size);
      const download=await fetch(`${app}/api/patient-backup`,{method:'POST',headers:{...cookie,'Content-Type':'application/json'},body:JSON.stringify({action:'download',clinicId:clinic,receptionistId:'33333333-3333-4333-8333-333333333333'})});
      assert.equal(download.status,200);
      const exportId=download.headers.get('x-export-id');assert.ok(exportId);exportsCreated.push(exportId);
      const bytes=Buffer.from(await download.arrayBuffer());assert.equal(bytes.readUInt32LE(0),0x04034b50);
      if(process.env.LOCAL_BACKUP_QA_OUTPUT) fs.writeFileSync(process.env.LOCAL_BACKUP_QA_OUTPUT,bytes);
      const audit=await (await rest(`patient_backup_exports?export_id=eq.${exportId}&select=export_status,patient_count,treatment_record_count`)).json();
      assert.equal(audit[0]?.export_status,'success');assert.equal(audit[0]?.patient_count,previewResult.patientCount);assert.equal(audit[0]?.treatment_record_count,previewResult.treatmentRecordCount);
      const input={clinicId:clinic,fullName:`TEST AUTOMATED ${randomUUID()}`,mobile:'',fileNo:`TEST-${randomUUID().slice(0,8)}`};
      const registered=await fetch(`${app}/api/patients/register`,{method:'POST',headers:{...cookie,'Content-Type':'application/json'},body:JSON.stringify(input)});
      assert.equal(registered.status,201);
      const saved=await registered.json();createdPatients.push({id:saved.patientId,name:input.fullName});
      const patientResponse=await fetch(`${app}/api/patients/${saved.patientId}`,{method:'PATCH',headers:{...cookie,'Content-Type':'application/json'},body:JSON.stringify({clinicId:clinic,updates:{notes:'TEST AUTOMATED NOTE'}})});
      assert.equal(patientResponse.status,200);
      const fileResponse=await fetch(`${app}/api/patients/${saved.patientId}/clinic-file`,{method:'PATCH',headers:{...cookie,'Content-Type':'application/json'},body:JSON.stringify({clinicId:clinic,fileNo:input.fileNo+'A'})});
      assert.equal(fileResponse.status,200);
      const duplicate=await fetch(`${app}/api/patients/${saved.patientId}/clinic-file`,{method:'PATCH',headers:{...cookie,'Content-Type':'application/json'},body:JSON.stringify({clinicId:clinic,fileNo:patients[0].clinic_file_no})});
      assert.equal(duplicate.status,409);
      const wrongLink=await fetch(`${app}/api/patients/99999999-9999-4999-8999-999999999999/clinic-link`,{method:'POST',headers:{...cookie,'Content-Type':'application/json'},body:JSON.stringify({clinicId:clinic})});
      assert.equal(wrongLink.status,403);
    }
  }
  for (const [mode,role] of [['manager','owner'],['reports','reports']]) {
    const token=randomUUID();
    await rest('active_sessions',{method:'POST',body:JSON.stringify({token,session_mode:mode,clinic_id:null,user_role:role,...(mode==='manager'?{account_id:(await (await rest('pos_accounts?role=eq.owner&select=id')).json())[0].id}:{}),created_at:new Date().toISOString()})});
    created.push(token);
    const cookie={Cookie:`app-auth=${token}`};
    assert.equal((await fetch(`${app}/api/patients/search?clinicId=${clinics[0]}`,{headers:cookie})).status,mode==='manager'?200:403);
    assert.equal((await fetch(`${app}/api/patients/mrn-matches?clinicId=${clinics[0]}&mrn=TEST-UNUSED`,{headers:cookie})).status,mode==='manager'?200:403);
    assert.equal((await fetch(`${app}/api/patients/clinic-records?clinicId=${clinics[0]}`,{headers:cookie})).status,mode==='manager'?200:403);
    assert.equal((await fetch(`${app}/api/patients/report-details`,{method:'POST',headers:{...cookie,'Content-Type':'application/json'},body:JSON.stringify({clinicId:clinics[0],patientIds:[]})})).status,mode==='manager'?200:403);
    for(const path of ['admin/patients','admin/clinic-files']) assert.equal((await fetch(`${app}/api/${path}`,{headers:cookie})).status,mode==='manager'?200:403);
    for(const path of ['history','birthdays']) assert.equal((await fetch(`${app}/api/patients/${path}?clinicId=${clinics[0]}&date=2026-10-07`,{headers:cookie})).status,mode==='manager'?200:403);
  }
  console.log('PASS: restricted local patient tables/RPCs deny anonymous access; both clinic workflows, registration/editing/duplicate files, cross-clinic linking, history, birthday and backup-preview routes verified; manager access and reports-role denial verified.');
} finally {
  for(const id of exportsCreated) await rest(`patient_backup_exports?export_id=eq.${id}`,{method:'DELETE'});
  for(const patient of createdPatients) {
    const matches=await (await rest(`patients?id=eq.${patient.id}&select=id,name`)).json();
    assert.equal(matches[0]?.name,patient.name,'Only the newly created disposable test patient may be removed');
    await rest(`clinic_patient_files?patient_id=eq.${patient.id}`,{method:'DELETE'});
    await rest(`patients?id=eq.${patient.id}`,{method:'DELETE'});
  }
  for(const token of created) await rest(`active_sessions?token=eq.${token}`,{method:'DELETE'});
  console.log('Temporary local test sessions removed.');
}
