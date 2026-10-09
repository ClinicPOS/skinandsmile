export async function createPosEntry(kind:'plan'|'deposit'|'legacy_balance',data:Record<string,unknown>):Promise<{data:any;error:{message:string}|null}>{
 const bytes=new TextEncoder().encode(JSON.stringify({kind,data}));const digest=await crypto.subtle.digest('SHA-256',bytes);const key='pos-entry-'+Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
 let requestId=sessionStorage.getItem(key);if(!requestId){requestId=crypto.randomUUID();sessionStorage.setItem(key,requestId);}
 try{const r=await fetch('/api/pos-entries',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind,data,requestId})});const result=await r.json();if(!r.ok)return {data:null,error:{message:result.error||'Entry could not be saved.'}};Object.defineProperty(result.record,'__requestKey',{value:key});return {data:result.record,error:null};}catch{return {data:null,error:{message:'Save could not be confirmed. Retry without changing the entry.'}};}
}
export function completePosEntry(record:unknown){const key=(record as {__requestKey?:string})?.__requestKey;if(key)sessionStorage.removeItem(key);}
