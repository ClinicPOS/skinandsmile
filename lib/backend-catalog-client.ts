export async function saveClinicDesign(clinicId:string,data:Record<string,unknown>):Promise<{error:{message:string;code?:string}|null}>{
 const reason='Clinic print layout updated';
 try{const response=await fetch('/api/workspace/catalog',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({clinicId,kind:'clinics',action:'update',id:clinicId,data,reason})});const result=await response.json();return response.ok?{error:null}:{error:{message:result.error||'Could not save design.'}};}catch{return {error:{message:'Could not save design.'}};}
}
