import {sessionStorageConfiguration} from './session-storage';
export const MANAGER_PERMISSIONS=['doctors','services','receipt_design','reports','correction_approval','receptionists'] as const;
export type ManagerPermission=typeof MANAGER_PERMISSIONS[number];
export type NamedAccountAccess={id:string;name:string;role:'owner'|'clinic_manager';permissions:ManagerPermission[]};
export async function readNamedAccountAccess(accountId:string,clinicId:string|null):Promise<NamedAccountAccess|null>{
 const {url,headers}=sessionStorageConfiguration();
 const accountResponse=await fetch(`${url}/rest/v1/pos_accounts?id=eq.${encodeURIComponent(accountId)}&select=id,name,role,enabled`,{headers,cache:'no-store'});
 if(!accountResponse.ok)throw Error('Account access is unavailable');
 const accounts=await accountResponse.json();const account=accounts[0];
 if(!account?.enabled)return null;
 if(account.role==='owner')return {...account,permissions:[...MANAGER_PERMISSIONS]};
 if(account.role!=='clinic_manager'||!clinicId)return null;
 const response=await fetch(`${url}/rest/v1/pos_manager_access?account_id=eq.${encodeURIComponent(accountId)}&clinic_id=eq.${encodeURIComponent(clinicId)}&select=permissions,starts_on,ends_on`,{headers,cache:'no-store'});
 if(!response.ok)throw Error('Clinic access is unavailable');
 const rows=await response.json(),access=rows[0];
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Dubai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 if(!access||access.starts_on&&access.starts_on>day||access.ends_on&&access.ends_on<day)return null;
 return {...account,permissions:access.permissions.filter((p:string)=>MANAGER_PERMISSIONS.includes(p as ManagerPermission))};
}
