"use client";

import { useEffect, useState } from "react";
import { AppFrame } from "../../components/app-frame";
import { supabase } from "../../lib/supabase";

export default function ReceptionistsPage() {
  const [name, setName] = useState("");
  const [shift, setShift] = useState("");
  const [pin, setPin] = useState("");
  const [receptionists, setReceptionists] = useState<any[]>([]);

  useEffect(() => {
    loadReceptionists();
  }, []);

  async function loadReceptionists() {
    const { data } = await supabase
      .from("receptionist")
      .select("*");

    if (data) {
      setReceptionists(data);
    }
  }

  async function saveReceptionist() {
    if (!name.trim()) {
      alert("Receptionist name is required.");
      return;
    }

    if (!/^\d{4}$/.test(pin)) {
      alert("Please set a 4-digit PIN.");
      return;
    }

    const { error } = await supabase.from("receptionist").insert([
      {
        name,
        shift,
        pin,
      },
    ]);

    if (error) {
      alert("Error saving receptionist");
      console.log(error);
    } else {
      alert("Receptionist saved successfully!");
      setName("");
      setShift("");
      setPin("");
      loadReceptionists();
    }
  }

  return (
    <AppFrame
      title="Receptionists"
      description="Organize front-desk staff and keep shift assignments easy to scan."
    >
      <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">
            New receptionist
          </p>
          <div className="mt-4 space-y-4">
            <input
              type="text"
              placeholder="Receptionist Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
            />

            <select
              value={shift}
              onChange={(e) => setShift(e.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
            >
              <option value="">Select Shift</option>
              <option value="Morning">Morning</option>
              <option value="Evening">Evening</option>
            </select>

            <input
              type="password"
              inputMode="numeric"
              placeholder="Set 4-digit PIN"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
            />

            <button
              onClick={saveReceptionist}
              className="inline-flex w-full items-center justify-center rounded-2xl bg-cyan-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-cyan-500"
            >
              Save Receptionist
            </button>
          </div>
        </div>

        <div>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-semibold text-slate-900">Receptionist List</h2>
            <p className="text-sm text-slate-500">{receptionists.length} records</p>
          </div>

          <div className="space-y-3">
            {receptionists.map((person) => (
              <div
                key={person.id}
                className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <p className="text-sm font-semibold text-slate-900">{person.name}</p>
                <p className="mt-1 text-sm text-slate-500">{person.shift}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppFrame>
  );
}
