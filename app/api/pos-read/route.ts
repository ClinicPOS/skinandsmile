import {createProtectedDataClient} from '../../../lib/protected-data-server';
import {readAppSession} from '../../../lib/api-session';
import {readNamedAccountAccess} from '../../../lib/account-access';
import {isUuid} from '../../../lib/patient-mutation-validation';
export const dynamic='force-dynamic';
const direct=new Set(['receipts','outstanding_balances','patient_credits','treatment_plans','treatment_plan_payments','treatment_plan_payment_records','payment_records','payment_allocation_refunds','cash_deductions','birthday_greetings','service_favorites','doctors','services','receptionist']);
const parents:Record<string,{join:string;filter:string}>={
 receipt_items:{join:'pos_scope_receipt!inner(clinic_id,receptionist_id)',filter:'__scope.clinic_id'},
 refunds:{join:'receipts!inner(clinic_id,receptionist_id)',filter:'__scope.clinic_id'},
 refund_items:{join:'refunds!inner(receipts!inner(clinic_id,receptionist_id))',filter:'__scope.receipts.clinic_id'},
 payment_allocations:{join:'payment_records!inner(clinic_id)',filter:'__scope.clinic_id'},
 treatment_plan_payment_allocations:{join:'treatment_plan_payment_records!inner(clinic_id)',filter:'__scope.clinic_id'},
 treatment_plan_visits:{join:'treatment_plans!inner(clinic_id)',filter:'__scope.clinic_id'},
 balance_payments:{join:'outstanding_balances!inner(clinic_id)',filter:'__scope.clinic_id'},
 cash_register_sessions:{join:'receptionist!inner(clinic_id)',filter:'__scope.clinic_id'},
 patient_treatment_visits:{join:'clinic_patient_files!inner(clinic_id)',filter:'__scope.clinic_id'},
};
export async function POST(request:Request){
 const body=await request.json().catch(()=>null);
 if(!body||typeof body.table!=='string'||!direct.has(body.table)&&!parents[body.table]&&body.table!=='clinics'||typeof body.query!=='string'||body.query.length>25000)return Response.json({message:'Unsupported data request.'},{status:400});
 const query=new URLSearchParams(body.query),select=query.get('select')||'*';
 // Permit only the two shallow relations actually used by screens. Arbitrary
 // embeds could otherwise traverse from an authorized row into another clinic.
 const embeds=[...select.matchAll(/(?:^|,)\s*([^,()]+)\(([^()]*)\)/g)];
 let flat=select;
 for(const match of embeds){
  const allowed=body.table==='birthday_greetings'&&match[1].trim()==='receptionist'&&match[2].trim()==='name'
   ||body.table==='treatment_plan_payment_records'&&match[1].trim()==='treatment_plans'&&match[2].split(',').every(field=>['created_at','clinic_patient_file_id','title','total_amount','planned_visits','status','is_legacy','historical_amount_paid'].includes(field.trim()));
  if(!allowed)return Response.json({message:'Related records are not available through this request.'},{status:403});
  flat=flat.replace(match[0],'');
 }
 if(/[()]/.test(flat))return Response.json({message:'Unsupported related-record request.'},{status:403});
 if(select.includes('__scope')||[...query.keys()].some(key=>key.includes('__scope'))||/\b(pin|token|pos_accounts|active_sessions|pos_manager_access)\b/i.test(select)||/receptionist\s*\([^)]*\*/i.test(select))return Response.json({message:'Private fields are not available.'},{status:403});
 const {session,errorResponse}=await readAppSession(createProtectedDataClient());
 // Login's public clinic picker is limited to names and IDs.
 const publicClinics=!session&&body.table==='clinics'&&select.replace(/\s/g,'')==='id,name';
 if(!session&&!publicClinics)return errorResponse!;
 let owner=session?.userRole==='owner';
 if(session&&!owner&&session.userRole!=='receptionist'&&session.userRole!=='clinic_manager'&&body.table!=='clinics')return Response.json({message:'Forbidden.'},{status:403});
 if(session?.userRole==='clinic_manager'){
  const access=await readNamedAccountAccess(session.accountId!,session.clinicId);
  const permission=body.table==='doctors'?'doctors':body.table==='services'?'services':'reports';
  if(!access?.permissions.includes(permission))return Response.json({message:'Forbidden.'},{status:403});
 }
 if(body.table==='receptionist')query.set('select','id,name,clinic_id,shift');
 if(parents[body.table]&&query.has('clinic_id')){
  const filter=query.get('clinic_id')!;
  if(!filter.startsWith('eq.')||!isUuid(filter.slice(3)))return Response.json({message:'Invalid clinic filter.'},{status:400});
  if(!owner&&session?.clinicId!==filter.slice(3))return Response.json({message:'Forbidden clinic.'},{status:403});
  query.delete('clinic_id');query.set('select',`${select},__scope:${parents[body.table].join}`);query.append(parents[body.table].filter,filter);
 }
 if(session&&!owner&&session.clinicId){
  let receiptScope='';
  if(['receipts','receipt_items','refunds','refund_items'].includes(body.table)){
   const {data,error}=await createProtectedDataClient().from('receptionist').select('id').eq('clinic_id',session.clinicId);
   if(error)return Response.json({message:'Clinic history could not be verified.'},{status:503});
   receiptScope=`(clinic_id.eq.${session.clinicId}${data?.length?`,and(clinic_id.is.null,receptionist_id.in.(${data.map(row=>row.id).join(',')}))`:''})`;
  }
  if(body.table==='clinics')query.append('id',`eq.${session.clinicId}`);
  else if(body.table==='receipts')query.append('or',receiptScope);
  else if(parents[body.table]){const parent=parents[body.table];query.set('select',`${select},__scope:${parent.join}`);if(receiptScope)query.append(parent.filter.replace('clinic_id','or'),receiptScope);else query.append(parent.filter,`eq.${session.clinicId}`);}
  else if(body.table==='services')query.append('or',`(clinic_id.eq.${session.clinicId},clinic_id.is.null)`);
  else query.append('clinic_id',`eq.${session.clinicId}`);
 }
 try{
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVER_SECRET_KEY;
  if(!url||!key)throw Error('Protected data is not configured');
  const headers={apikey:key,Authorization:`Bearer ${key}`};
  const outputHeaders:Record<string,string>={...headers};
  if(typeof body.range==='string'&&/^\d+-\d+$/.test(body.range)){outputHeaders.Range=body.range;outputHeaders['Range-Unit']='items';}
  if(body.accept==='application/vnd.pgrst.object+json')outputHeaders.Accept=body.accept;
  if(body.count==='exact')outputHeaders.Prefer='count=exact';
  const response=await fetch(`${url}/rest/v1/${body.table}?${query}`,{headers:outputHeaders,cache:'no-store'});
  const data=await response.json().catch(()=>null);
  const clean=(row:Record<string,unknown>)=>{const {__scope,...rest}=row;return rest;};
  const value=response.ok?(Array.isArray(data)?data.map(clean):data&&clean(data)): {message:'Requested records could not be loaded.',code:data?.code,...(data?.code==='PGRST116'&&typeof data.details==='string'?{details:data.details}:{})};
  return Response.json(value,{status:response.status,headers:{'Cache-Control':'no-store',...(response.headers.get('content-range')?{'Content-Range':response.headers.get('content-range')!}:{})}});
 }catch{return Response.json({message:'Records are temporarily unavailable.'},{status:503});}
}
