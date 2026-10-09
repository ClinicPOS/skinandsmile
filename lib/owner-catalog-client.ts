export async function saveOwnerCatalog(kind:'services'|'doctors',action:'create'|'update'|'archive',data:Record<string,unknown>,id?:string){try{
 let clinicId=data.clinic_id;
 if(action!=='create'){const lookup=await fetch('/api/pos-read',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({table:kind,query:`select=clinic_id&id=eq.${id}`})});const records=await lookup.json();if(!lookup.ok||!records[0]?.clinic_id)return {error:{message:'Choose a clinic-specific record. Shared catalog changes require separate review.'}};clinicId=records[0].clinic_id;}
 const {clinic_id,...fields}=data;
 const r=await fetch('/api/workspace/catalog',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind,action,id,data:fields,clinicId,reason:'Owner updated clinic catalog'})});const result=await r.json();return {error:r.ok?null:{message:result.error||'Catalog change was not saved.'}};
}catch{return {error:{message:'Catalog change could not be confirmed.'}};}}
