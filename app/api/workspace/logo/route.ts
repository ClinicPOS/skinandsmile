import {randomUUID} from 'node:crypto';
import {authorizeWorkspace} from '../../../../lib/workspace-server';
import {createProtectedDataClient} from '../../../../lib/protected-data-server';
import {isUuid} from '../../../../lib/patient-mutation-validation';
import {A4_INVOICE_LOGO_BUCKET} from '../../../../lib/a4-invoice-branding';
export async function POST(request:Request){
 const clinicId=new URL(request.url).searchParams.get('clinicId');
 if(!isUuid(clinicId))return Response.json({error:'Choose a clinic.'},{status:400});
 const {error}=await authorizeWorkspace(clinicId,'receipt_design');if(error)return error;
 if(Number(request.headers.get('content-length'))>6*1024*1024)return Response.json({error:'Logo must be under 5 MB.'},{status:413});
 try{
  const form=await request.formData(),file=form.get('file');
  if(!(file instanceof File)||file.size<8||file.size>5*1024*1024)return Response.json({error:'Choose a PNG or JPEG under 5 MB.'},{status:400});
  const bytes=new Uint8Array(await file.arrayBuffer());
  const png=[137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v),jpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
  if(!png&&!jpeg)return Response.json({error:'Only PNG or JPEG logos are supported.'},{status:400});
  const client=createProtectedDataClient(),path=`${clinicId}/${randomUUID()}.${png?'png':'jpg'}`;
  const uploaded=await client.storage.from(A4_INVOICE_LOGO_BUCKET).upload(path,bytes,{contentType:png?'image/png':'image/jpeg',upsert:false});
  if(uploaded.error)throw uploaded.error;
  return Response.json({url:client.storage.from(A4_INVOICE_LOGO_BUCKET).getPublicUrl(path).data.publicUrl},{headers:{'Cache-Control':'no-store'}});
 }catch{return Response.json({error:'Could not upload logo. Check image format and logo storage setup.'},{status:503});}
}
