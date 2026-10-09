import {authorizeSecurityAdmin} from '../../../../lib/admin-security';
import {createProtectedDataClient} from '../../../../lib/protected-data-server';
import {isUuid} from '../../../../lib/patient-mutation-validation';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 const {error}=await authorizeSecurityAdmin();if(error)return error;
 const params=new URL(request.url).searchParams,clinicId=params.get('clinicId'),offset=Number(params.get('offset')||0),entity=params.get('entity');
 if((clinicId&&!isUuid(clinicId))||!Number.isSafeInteger(offset)||offset<0||offset>100000||(entity&&!/^[a-z_]{1,60}$/.test(entity)))return Response.json({error:'Invalid history filter.'},{status:400});
 try{let query=createProtectedDataClient().from('activity_log').select('id,occurred_at,clinic_id,action,entity_type,entity_id,actor_id,actor_role,actor_reference,actor_verified,reason,old_data,new_data').order('occurred_at',{ascending:false}).order('id',{ascending:false}).range(offset,offset+50);
 if(clinicId)query=query.eq('clinic_id',clinicId);if(entity)query=query.eq('entity_type',entity);
 const {data,error:queryError}=await query;if(queryError)throw queryError;
 const entries=(data||[]).slice(0,50);
 const ids=[...new Set(entries.map(row=>row.actor_id).filter(Boolean))];
 const names=new Map<string,string>();
 if(ids.length){const {data:staff,error:staffError}=await createProtectedDataClient().from('receptionist').select('id,name').in('id',ids);if(staffError)throw staffError;for(const person of staff||[])names.set(person.id,person.name||'Unnamed staff');}
 if(ids.length){const {data:accounts,error:accountError}=await createProtectedDataClient().from('pos_accounts').select('id,name').in('id',ids);if(accountError)throw accountError;for(const person of accounts||[])names.set(person.id,person.name);}
 return Response.json({entries:entries.map(row=>({...row,actor_name:row.actor_id?names.get(row.actor_id)||null:null})),hasMore:(data||[]).length>50},{headers:{'Cache-Control':'no-store'}});
 }catch{return Response.json({error:'Activity history is unavailable.'},{status:503});}
}
