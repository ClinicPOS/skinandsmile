import type {Clinic} from './types';

export type VerifiedRegisterState = {
 clinic: Clinic;
 identity: {receptionistId:string;receptionistName:string;clinicId:string} | null;
 register: {id:string;receptionist_id:string;opening_cash:number;opened_at:string;closed_at:string|null} | null;
};

export async function loadVerifiedRegister(signal?:AbortSignal):Promise<VerifiedRegisterState>{
 const controller=new AbortController();
 const abort=()=>controller.abort();
 signal?.addEventListener('abort',abort,{once:true});
 if(signal?.aborted)controller.abort();
 const timer=setTimeout(abort,15000);
 try{
 const response=await fetch('/api/register',{cache:'no-store',signal:controller.signal});
 const data=await response.json().catch(()=>null);
 if(!response.ok||!data)throw new Error(data?.error||'Could not verify the signed-in receptionist. Please retry.');
 if(!data.clinic?.id||data.identity&&data.identity.clinicId!==data.clinic.id||data.register&&(!data.identity||data.register.receptionist_id!==data.identity.receptionistId||data.register.closed_at!=null))throw new Error('The saved register does not match your current login. Please retry verification.');
 if(data.register&&(!data.register.id||!Number.isFinite(Number(data.register.opening_cash))||Number(data.register.opening_cash)<0||!Number.isFinite(Date.parse(data.register.opened_at))))throw new Error('The saved register details could not be verified. Please retry.');
 return data;
 }catch(error){
  if(controller.signal.aborted&&!signal?.aborted)throw new Error('Register verification timed out. Your register has not been changed. Please retry.');
  throw error;
 }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
