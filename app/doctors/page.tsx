"use client";

import { useEffect, useState } from "react";
import { AppFrame } from "../../components/app-frame";
import { supabase } from "../../lib/supabase";

export default function DoctorsPage() {
  const [name, setName] = useState("");
  const [specialty, setSpecialty] = useState("");
  const [doctors, setDoctors] = useState<any[]>([]);

  useEffect(() => {
    loadDoctors();
  }, []);

  async function loadDoctors() {
    const { data } = await supabase
      .from("doctors")
      .select("*");

    if (data) {
      setDoctors(data);
    }
  }

  async function saveDoctor() {
    const { error } = await supabase.from("doctors").insert([
      {
        name,
        specialty,
      },
    ]);

    if (error) {
      alert("Error saving doctor");
      console.log(error);
    } else {
      alert("Doctor saved successfully!");
      setName("");
      setSpecialty("");
      loadDoctors();
    }
  }

  return (
    <AppFrame
      title="Doctors"
      description="Maintain clinician records and specialties in a clear, structured directory."
    >
      <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">
            New doctor
          </p>
          <div className="mt-4 space-y-4">
            <input
              type="text"
              placeholder="Doctor Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-teal-300 focus:ring-4 focus:ring-teal-100"
            />

            <input
              type="text"
              placeholder="Specialty"
              value={specialty}
              onChange={(e) => setSpecialty(e.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-teal-300 focus:ring-4 focus:ring-teal-100"
            />

            <button
              onClick={saveDoctor}
              className="inline-flex w-full items-center justify-center rounded-2xl bg-teal-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-teal-500"
            >
              Save Doctor
            </button>
          </div>
        </div>

        <div>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-semibold text-slate-900">Doctor List</h2>
            <p className="text-sm text-slate-500">{doctors.length} records</p>
          </div>

          <div className="space-y-3">
            {doctors.map((doctor) => (
              <div
                key={doctor.id}
                className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <p className="text-sm font-semibold text-slate-900">{doctor.name}</p>
                <p className="mt-1 text-sm text-slate-500">{doctor.specialty}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppFrame>
  );
}
