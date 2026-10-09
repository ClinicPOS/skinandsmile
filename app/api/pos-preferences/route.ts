import {createProtectedDataClient} from '../../../lib/protected-data-server';
import {readAppSession} from '../../../lib/api-session';
import {isUuid} from '../../../lib/patient-mutation-validation';
import {getDubaiBusinessDate} from '../../../lib/cash-deductions';
export async function POST(request:Request){
 const db=createProtectedDataClient(),{session,errorResponse}=await readAppSession(db);if(!session)return errorResponse!;
 if(session.userRole!=='receptionist'||!session.receptionistId||!session.clinicId)return Response.json({error:'Sign in as a receptionist first.'},{status:403});
 const b=await request.json().catch(()=>null);
 if(b?.kind==='favorite'&&isUuid(b.serviceId)&&typeof b.enabled==='boolean'){
  const {data:service,error}=await db.from('services').select('id').eq('id',b.serviceId).or(`clinic_id.eq.${session.clinicId},clinic_id.is.null`).maybeSingle();if(error)return Response.json({error:'Service verification failed.'},{status:503});if(!service)return Response.json({error:'Service is not available in this clinic.'},{status:403});
  const scope={clinic_id:session.clinicId,receptionist_id:session.receptionistId,service_id:b.serviceId};
  const result=b.enabled?await db.from('service_favorites').insert(scope):await db.from('service_favorites').delete().match(scope);
  // The existing personal-favorite index is partial. PostgREST upsert cannot
  // infer that predicate; a duplicate insert is a successful retry only if
  // the exact scoped favorite already exists.
  if(b.enabled&&result.error?.code==='23505'){
   const existing=await db.from('service_favorites').select('id').match(scope).maybeSingle();
   if(!existing.error&&existing.data)return Response.json({record:scope});
  }
  if(result.error)return Response.json({error:'Favorite change was not saved.'},{status:409});return Response.json({record:scope});
 }
 if(b?.kind==='greeting'&&isUuid(b.patientId)){
  const {data:file,error}=await db.from('clinic_patient_files').select('id').eq('patient_id',b.patientId).eq('clinic_id',session.clinicId).maybeSingle();if(error)return Response.json({error:'Patient verification failed.'},{status:503});if(!file)return Response.json({error:'Patient is not registered in this clinic.'},{status:403});
  const payload={clinic_id:session.clinicId,patient_id:b.patientId,birthday_date:getDubaiBusinessDate(),receptionist_id:session.receptionistId};
  const inserted=await db.from('birthday_greetings').insert(payload).select('greeted_at,receptionist_id,receptionist(name)').single();
  if(inserted.error?.code==='23505'){const existing=await db.from('birthday_greetings').select('greeted_at,receptionist_id,receptionist(name)').eq('clinic_id',session.clinicId).eq('patient_id',b.patientId).eq('birthday_date',payload.birthday_date).single();if(existing.error)return Response.json({error:'Greeting could not be confirmed.'},{status:503});return Response.json({record:existing.data});}
  if(inserted.error)return Response.json({error:'Greeting was not saved.'},{status:409});return Response.json({record:inserted.data});
 }
 return Response.json({error:'Unsupported staff preference.'},{status:400});
}
