"use client";
import {useState} from 'react';

export function TreatmentPlanCancelButton({planId,onCancelled}:{planId:string;onCancelled:()=>void}){
 const [open,setOpen]=useState(false),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function cancel(){setBusy(true);setError('');try{const response=await fetch('/api/workspace/treatment-plan-cancellation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({planId,reason})});const result=await response.json();if(!response.ok)throw Error(result.error||'Could not cancel the plan.');onCancelled();setOpen(false);}catch(e){setError(e instanceof Error?e.message:'Could not cancel the plan.');}finally{setBusy(false);}}
 return <div className="text-sm"><button type="button" disabled={busy} onClick={()=>setOpen(!open)} className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-700">Cancel unused plan</button>{open&&<div className="mt-2 max-w-sm space-y-2"><p>Only an unpaid plan with no visits can be cancelled here. Its original record stays in the activity history.</p><label className="block">Reason<textarea value={reason} onChange={e=>setReason(e.target.value)} maxLength={1000} className="block w-full rounded border p-2" /></label>{error&&<p role="alert" className="text-red-700">{error}</p>}<button type="button" disabled={busy||reason.trim().length<3} onClick={cancel} className="rounded bg-rose-700 px-3 py-2 text-white disabled:opacity-50">{busy?'Saving…':'Confirm cancellation'}</button></div>}</div>;
}
