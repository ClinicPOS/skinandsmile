"use client";

import { useEffect, useState } from "react";
import { AppFrame } from "../../components/app-frame";
import { supabase } from "../../lib/supabase";

export default function PatientsPage() {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [patients, setPatients] = useState<any[]>([]);

  useEffect(() => {
    loadPatients();
  }, []);

  async function loadPatients() {
    const { data } = await supabase
      .from("patients")
      .select("*")
      .order("created_at", { ascending: false });

    if (data) {
      setPatients(data);
    }
  }

  async function savePatient() {
    const { error } = await supabase.from("patients").insert([
      {
        name: name,
        phone: phone,
      },
    ]);

    if (error) {
      alert("Error saving patient");
      console.log(error);
    } else {
      alert("Patient saved successfully!");
      setName("");
      setPhone("");
      loadPatients();
    }
  }

  return (
    <AppFrame
      title="Patients"
      description="Register patient details and keep the front-desk records organized."
    >
      <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">
            New patient
          </p>
          <div className="mt-4 space-y-4">
            <input
              type="text"
              placeholder="Patient Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
            />

            <input
              type="text"
              placeholder="Phone Number"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
            />

            <button
              onClick={savePatient}
              className="inline-flex w-full items-center justify-center rounded-2xl bg-cyan-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-cyan-500"
            >
              Save Patient
            </button>
          </div>
        </div>

        <div>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-semibold text-slate-900">Patient List</h2>
            <p className="text-sm text-slate-500">{patients.length} records</p>
          </div>

          <div className="space-y-3">
            {patients.map((patient) => (
              <div
                key={patient.id}
                className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <p className="text-sm font-semibold text-slate-900">{patient.name}</p>
                <p className="mt-1 text-sm text-slate-500">{patient.phone}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppFrame>
  );
}
