"use client";
import {useEffect,useState} from "react";
import {AppFrame} from "../../components/app-frame";
import {supabase} from "../../lib/supabase";
export default function ReceptionistsPage(){
 const [staff,setStaff]=useState<{id:string;name:string;shift:string|null}[]>([]);
 const [error,setError]=useState("");
 useEffect(()=>{supabase.from("receptionist").select("id,name,clinic_id,shift").then(({data,error})=>{if(error)setError("Could not load staff.");else setStaff(data||[]);});},[]);
 return <AppFrame title="Receptionists" description="Front-desk staff and shift assignments.">
  <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
   <h2 className="text-xl font-semibold">Manage staff accounts</h2>
   <p className="mt-3 text-sm text-slate-600">The owner can add staff and change PINs in Backend. Each account belongs to a clinic.</p>
   <a href="/backend" className="mt-4 inline-block rounded-2xl bg-cyan-600 px-5 py-3 text-sm font-semibold text-white">Open Backend</a>
  </div>
  {error&&<p role="alert">{error}</p>}
  <div className="mt-6 space-y-3">{staff.map(person=><div key={person.id} className="rounded-2xl border border-slate-200 p-4"><p className="font-semibold">{person.name}</p><p>{person.shift}</p></div>)}</div>
 </AppFrame>;
}
