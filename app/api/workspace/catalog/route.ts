import {authorizeWorkspace} from '../../../../lib/workspace-server';
import {createProtectedDataClient} from '../../../../lib/protected-data-server';
import {isUuid} from '../../../../lib/patient-mutation-validation';
import type {ManagerPermission} from '../../../../lib/account-access';
const kinds={doctors:'doctors',services:'services',clinics:'receipt_design'} as const;
export const dynamic='force-dynamic';
export async function GET(request:Request){const p=new URL(request.url).searchParams,clinicId=p.get('clinicId'),kind=p.get('kind') as keyof typeof kinds;
 if(!isUuid(clinicId)||!Object.hasOwn(kinds,kind))return Response.json({error:'Select a clinic and section.'},{status:400});
 const {error}=await authorizeWorkspace(clinicId,kinds[kind]);if(error)return error;
 try{let query=createProtectedDataClient().from(kind).select('*');query=kind==='clinics'?query.eq('id',clinicId):query.eq('clinic_id',clinicId).order('name');
 const {data,error:queryError}=await query;if(queryError)throw queryError;return Response.json({records:data||[]},{headers:{'Cache-Control':'no-store'}});
 }catch{return Response.json({error:'Could not load clinic records.'},{status:503});}}
export async function POST(request:Request){const body=await request.json().catch(()=>null),kind=body?.kind as keyof typeof kinds;
 if(!isUuid(body?.clinicId)||!Object.hasOwn(kinds,kind)||!['create','update','archive'].includes(body?.action)||body.action!=='create'&&!isUuid(body.id)||typeof body.reason!=='string'||body.reason.trim().length<3||body.reason.length>1000||!body.data||typeof body.data!=='object'||Array.isArray(body.data))return Response.json({error:'Valid clinic, record, fields and reason are required.'},{status:400});
 const {session,error}=await authorizeWorkspace(body.clinicId,kinds[kind] as ManagerPermission);if(error||!session)return error!;
 const data=body.action==='archive'?{is_active:false}:body.data;
 for(const [key,value] of Object.entries(data)){
  if(typeof value==='string'&&(value.length>2000||/[<>\u0000]/.test(value)))return Response.json({error:'Text must be plain text, up to 2,000 characters.'},{status:400});
  if(key==='logo'&&value!=null&&(typeof value!=='string'||!['skin-smile','altamuze','al-jameelah','al-qima'].includes(value)&&!/^\/images\/[a-zA-Z0-9._/-]+$/.test(value)))return Response.json({error:'Choose a supported clinic logo.'},{status:400});
  if((key==='name'||key==='display_name')&&(typeof value!=='string'||!value.trim()||value.length>200))return Response.json({error:'Enter a name up to 200 characters.'},{status:400});
  if(['price','standard_price','min_price','max_price'].includes(key)&&value!=null&&(typeof value!=='number'||!Number.isFinite(value)||value<0||value>1000000))return Response.json({error:'Enter a valid nonnegative price.'},{status:400});
  if(key==='vat_rate'&&value!==0&&value!==0.05)return Response.json({error:'Select 0% or 5% VAT.'},{status:400});
  if(['is_active','requires_quantity','active_plan_recommended','thermal_logo_high_contrast'].includes(key)&&typeof value!=='boolean')return Response.json({error:'Invalid on/off value.'},{status:400});
  if((key.startsWith('thermal_')||key.startsWith('a4_invoice_'))&&typeof value==='number'&&(!Number.isFinite(value)||Math.abs(value)>300))return Response.json({error:'Invalid layout measurement.'},{status:400});
  if(key.endsWith('_color')&&value!=null&&(typeof value!=='string'||!/^#[0-9a-fA-F]{6}$/.test(value)))return Response.json({error:'Choose a valid color.'},{status:400});
  if(['receipt_qr_url','a4_invoice_logo_url'].includes(key)&&value){try{const url=new URL(String(value));if(!['https:'].includes(url.protocol)&&!(process.env.NODE_ENV!=='production'&&url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname)))throw Error();if(/["'\s]/.test(String(value)))throw Error();}catch{return Response.json({error:'Use a valid secure web address.'},{status:400});}}
 }
 if(kind==='services'&&body.action==='create'&&(typeof data.price!=='number'||![0,0.05].includes(data.vat_rate)))return Response.json({error:'Service price and VAT are required.'},{status:400});
 try{const {data:saved,error:saveError}=await createProtectedDataClient().rpc('manage_clinic_catalog',{p_account_id:session.accountId,p_clinic_id:body.clinicId,p_kind:kind,p_action:body.action,p_entity_id:body.action==='create'?null:body.id,p_data:data,p_reason:body.reason.trim()});
 if(saveError)return Response.json({error:saveError.code==='42501'?'Permission changed. Sign in again.':saveError.code==='P0002'?'Record not found in this clinic.':'Fields could not be saved. Check values and clinic ownership.'},{status:saveError.code==='42501'?403:saveError.code==='P0002'?404:400});
 return Response.json({record:saved},{headers:{'Cache-Control':'no-store'}});
 }catch{return Response.json({error:'Clinic changes are unavailable.'},{status:503});}}
