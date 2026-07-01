"use client";

import { useEffect, useState } from "react";
import { AppFrame } from "../../components/app-frame";
import { supabase } from "../../lib/supabase";
import { Patient } from "../../lib/types";
import { calculateAge } from "../../lib/utils";

export default function PatientsPage() {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [sex, setSex] = useState("");
  const [nationality, setNationality] = useState("");
  const [emiratesId, setEmiratesId] = useState("");
  const [passportNumber, setPassportNumber] = useState("");

  const [patients, setPatients] = useState<Patient[]>([]);
  const [search, setSearch] = useState("");

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
    if (!name.trim()) {
      alert("Patient name is required.");
      return;
    }

    const { data: maxPatient } = await supabase
      .from("patients")
      .select("patient_number")
      .not("patient_number", "is", null)
      .order("patient_number", { ascending: false })
      .limit(1);
    const nextNumber = ((maxPatient?.[0]?.patient_number as number) || 0) + 1;

    const { error } = await supabase.from("patients").insert([
      {
        name: name.trim(),
        phone: phone.trim() || null,
        email: email.trim() || null,
        notes: notes.trim() || null,
        date_of_birth: dateOfBirth || null,
        sex: sex || null,
        nationality: nationality.trim() || null,
        emirates_id: emiratesId.trim() || null,
        passport_number: passportNumber.trim() || null,
        patient_number: nextNumber,
      },
    ]);

    if (error) {
      alert("Error saving patient");
      console.error(error);
      return;
    }

    setName("");
    setPhone("");
    setEmail("");
    setNotes("");
    setDateOfBirth("");
    setSex("");
    setNationality("");
    setEmiratesId("");
    setPassportNumber("");
    loadPatients();
  }

  const filteredPatients = patients.filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      (p.phone || "").includes(search) ||
      (p.emirates_id || "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <AppFrame
      title="Patients"
      description="Register patient details and keep the front-desk records organized."
    >
      <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr]">
        {/* Add Patient Form */}
        <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">
            New patient
          </p>
          <div className="mt-4 space-y-3">
            <input
              type="text"
              placeholder="Patient Name *"
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

            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
            />

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs text-slate-500">
                  Date of Birth
                </label>
                <input
                  type="date"
                  value={dateOfBirth}
                  onChange={(e) => setDateOfBirth(e.target.value)}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500">Sex</label>
                <select
                  value={sex}
                  onChange={(e) => setSex(e.target.value)}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
                >
                  <option value="">Select</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                </select>
              </div>
            </div>

            <input
              type="text"
              placeholder="Nationality (e.g. Emirati, Filipino)"
              value={nationality}
              onChange={(e) => setNationality(e.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
            />

            <input
              type="text"
              placeholder="Emirates ID (optional)"
              value={emiratesId}
              onChange={(e) => setEmiratesId(e.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
            />

            <input
              type="text"
              placeholder="Passport Number (optional)"
              value={passportNumber}
              onChange={(e) => setPassportNumber(e.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
            />

            <textarea
              placeholder="Notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
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

        {/* Patient List */}
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xl font-semibold text-slate-900">Patient List</h2>
            <p className="text-sm text-slate-500">{patients.length} records</p>
          </div>

          <input
            type="text"
            placeholder="Search by name, phone or Emirates ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="mb-4 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
          />

          <div className="space-y-3">
            {filteredPatients.map((patient) => {
              const age = calculateAge(patient.date_of_birth);
              return (
                <div
                  key={patient.id}
                  className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold text-slate-900">
                      {patient.name}
                    </p>
                    {patient.sex && (
                      <span className="shrink-0 rounded-full bg-cyan-50 px-2 py-0.5 text-xs font-medium text-cyan-700">
                        {patient.sex}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-500">
                    {patient.phone && <span>{patient.phone}</span>}
                    {age !== null && <span>{age} yrs</span>}
                    {patient.nationality && <span>{patient.nationality}</span>}
                    {patient.emirates_id && (
                      <span>ID: {patient.emirates_id}</span>
                    )}
                    {patient.passport_number && (
                      <span>Passport: {patient.passport_number}</span>
                    )}
                    {patient.email && <span>{patient.email}</span>}
                    {patient.notes && (
                      <span className="italic">{patient.notes}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </AppFrame>
  );
}
