export function effectiveApprovers(settings:{primary_approver_id:string;backup_approver_id:string|null;temporary_approver_id:string|null;temporary_start:string|null;temporary_end:string|null},day:string){
 const temporary=!!settings.temporary_approver_id&&!!settings.temporary_start&&!!settings.temporary_end&&day>=settings.temporary_start&&day<=settings.temporary_end;
 return {primaryId:temporary?settings.temporary_approver_id!:settings.primary_approver_id,backupId:settings.backup_approver_id,temporary};
}
export function dubaiDay(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Dubai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
export function validDate(value:unknown){return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;}
