"use client";

import { useEffect, useMemo, useState } from "react";
import { AppFrame } from "../../components/app-frame";
import { supabase } from "../../lib/supabase";

type Patient = {
  id: string;
  name: string;
  phone: string | null;
};

export default function SearchPatientsPage() {
  const [query, setQuery] = useState("");
  const [patients, setPatients] = useState<Patient[]>([]);

  useEffect(() => {
    loadPatients();
  }, []);

  async function loadPatients() {
    const { data } = await supabase
      .from("patients")
      .select("id, name, phone")
      .order("name", { ascending: true });

    setPatients((data as Patient[]) || []);
  }

  const filteredPatients = useMemo(() => {
    const search = query.trim().toLowerCase();

    if (!search) {
      return patients;
    }

    return patients.filter((patient) => {
      return (
        patient.name.toLowerCase().includes(search) ||
        (patient.phone || "").toLowerCase().includes(search)
      );
    });
  }, [patients, query]);

  return (
    <AppFrame
      title="Search Patients"
      description="Look up patients quickly by name or phone number before opening receipts or treatment history."
    >
      <div className="space-y-6">
        <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
          <label className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">
            Search
          </label>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by patient name or phone"
            className="mt-3 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
          />
        </div>

        <div className="grid gap-3">
          {filteredPatients.map((patient) => (
            <div
              key={patient.id}
              className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-slate-900">{patient.name}</p>
                  <p className="mt-1 text-sm text-slate-500">
                    {patient.phone || "No phone number saved"}
                  </p>
                </div>
                <p className="text-xs font-medium uppercase tracking-[0.3em] text-slate-400">
                  Patient
                </p>
              </div>
            </div>
          ))}

          {filteredPatients.length === 0 && (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500">
              No patients match that search.
            </div>
          )}
        </div>
      </div>
    </AppFrame>
  );
}
