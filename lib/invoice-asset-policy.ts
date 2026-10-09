export function invoiceAssetAllowed(value:string,resourceType:string,method:string,appOrigin:string,storageUrl?:string){
 if(method!=='GET'||!['image','font','stylesheet'].includes(resourceType))return false;
 if(/^data:(image\/|font\/|application\/(font-|x-font-))/i.test(value))return true;
 try{
  const url=new URL(value);if(url.username||url.password||!['http:','https:'].includes(url.protocol))return false;
  if(url.origin===appOrigin)return ['/images/','/fonts/','/_next/static/'].some(prefix=>url.pathname.startsWith(prefix));
  return !!storageUrl&&url.origin===new URL(storageUrl).origin&&url.pathname.startsWith('/storage/v1/object/public/')&&resourceType==='image';
 }catch{return false;}
}
