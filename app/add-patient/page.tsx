"use client";

import { useEffect, useState } from "react";
import { AppFrame } from "../../components/app-frame";
import { supabase } from "../../lib/supabase";
import { COUNTRIES } from "../../lib/countries";
import { AddOutstandingBalanceModal } from "../../components/outstanding-balance-modals";
import type { Clinic, Patient, OutstandingBalance } from "../../lib/types";

export default function AddPatientPage() {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [dob, setDob] = useState("");
  const [sex, setSex] = useState("");
  const [nationality, setNationality] = useState("");
  const [nationalitySearch, setNationalitySearch] = useState("");
  const [showNationalitySuggestions, setShowNationalitySuggestions] = useState(false);
  const [nationalityHighlightIndex, setNationalityHighlightIndex] = useState(-1);
  const [emiratesId, setEmiratesId] = useState("");
  const [passportNumber, setPassportNumber] = useState("");
  const [mrn, setMrn] = useState("");
  const [fileNo, setFileNo] = useState("");

  const [saving, setSaving] = useState(false);
  const [lastAdded, setLastAdded] = useState<Patient | null>(null);
  const [clinics, setClinics] = useState<Clinic[]>([]);
  const [showBalanceModal, setShowBalanceModal] = useState(false);
  const [savedBalance, setSavedBalance] = useState<OutstandingBalance | null>(null);

  useEffect(() => {
    supabase
      .from("clinics")
      .select("*")
      .then(({ data }) => setClinics((data || []) as Clinic[]));
  }, []);

  function resetForm() {
    setName("");
    setPhone("");
    setEmail("");
    setNotes("");
    setDob("");
    setSex("");
    setNationality("");
    setNationalitySearch("");
    setEmiratesId("");
    setPassportNumber("");
    setMrn("");
    setFileNo("");
  }

  async function addPatient() {
    if (!name.trim()) {
      alert("Patient name is required.");
      return;
    }

    setSaving(true);
    try {
      let saved: Patient | null = null;
      let lastError: any = null;

      for (let attempt = 0; attempt < 5; attempt++) {
        let patientNumber: number;
        if (fileNo.trim()) {
          patientNumber = parseInt(fileNo.trim(), 10);
          if (!Number.isFinite(patientNumber)) {
            alert("File No. must be a number.");
            return;
          }
        } else {
          const { data: maxPatient } = await supabase
            .from("patients")
            .select("patient_number")
            .not("patient_number", "is", null)
            .order("patient_number", { ascending: false })
            .limit(1);
          patientNumber = ((maxPatient?.[0]?.patient_number as number) || 0) + 1;
        }

        const chosenNationality = nationality || nationalitySearch.trim() || null;

        const { data, error } = await supabase
          .from("patients")
          .insert([
            {
              name: name.trim(),
              // Live patients.phone column is NOT NULL; POS inserts "" too.
              phone: phone.trim(),
              email: email.trim() || null,
              notes: notes.trim() || null,
              date_of_birth: dob || null,
              sex: sex || null,
              nationality: chosenNationality,
              emirates_id: emiratesId.trim() || null,
              passport_number: passportNumber.trim() || null,
              mrn: mrn.trim() || null,
              patient_number: patientNumber,
            },
          ])
          .select("*")
          .single();

        if (!error) {
          saved = data as Patient;
          break;
        }
        lastError = error;
        if ((error as any).code !== "23505") break;
        if (fileNo.trim()) break;
      }

      if (!saved) {
        console.error("Add patient failed. Raw error:", lastError);
        console.error("Error keys:", lastError ? Object.keys(lastError) : "no error object");
        console.error("Error JSON:", JSON.stringify(lastError, null, 2));
        if (lastError?.code === "23505" && fileNo.trim()) {
          alert(`File No. ${fileNo.trim()} is already taken. Please pick another or leave it blank to auto-assign.`);
        } else {
          const detail =
            lastError?.message ||
            lastError?.details ||
            lastError?.hint ||
            lastError?.code ||
            "Empty error — likely RLS blocking the insert. Check DevTools Network tab for the request to /rest/v1/patients.";
          alert(`Error saving patient: ${detail}`);
        }
        return;
      }

      setLastAdded(saved);
      setSavedBalance(null);
      resetForm();
    } finally {
      setSaving(false);
    }
  }

  const filteredCountries = nationalitySearch.trim()
    ? COUNTRIES.filter((c) => c.toLowerCase().includes(nationalitySearch.toLowerCase()))
    : [];

  return (
    <AppFrame title="Add Patient" description="Register a new patient">
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Patients</h2>
          <p className="text-xs text-slate-500">Register a new patient. File No. is auto-assigned when left blank.</p>
        </div>

        {lastAdded && (
          <div className="rounded-2xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-800">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                Added <span className="font-semibold">{lastAdded.name}</span>
                {lastAdded.patient_number != null && (
                  <> — File No. <span className="font-semibold">#{String(lastAdded.patient_number).padStart(5, "0")}</span></>
                )}
              </span>
              <button
                onClick={() => setShowBalanceModal(true)}
                className="rounded-xl bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-amber-500"
              >
                Add Balance
              </button>
            </div>
            {savedBalance && (
              <p className="mt-2 text-xs text-amber-700">
                Outstanding balance of <span className="font-semibold">AED {Number(savedBalance.original_amount).toFixed(2)}</span> recorded
                {savedBalance.reference_number ? <> (Ref: {savedBalance.reference_number})</> : null}. You can add another if the patient has more than one old invoice.
              </p>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Patient name"
            className="rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
          />
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Phone"
            className="rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
          />
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            className="rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
          />
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes"
            className="rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
          />
          <input
            type="date"
            value={dob}
            onChange={(e) => setDob(e.target.value)}
            className="rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
          />
          <select
            value={sex}
            onChange={(e) => setSex(e.target.value)}
            className="rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
          >
            <option value="">Sex</option>
            <option value="Male">Male</option>
            <option value="Female">Female</option>
          </select>

          <div className="relative">
            <input
              type="text"
              value={nationalitySearch}
              onChange={(e) => {
                setNationalitySearch(e.target.value);
                setNationality("");
                setShowNationalitySuggestions(true);
                setNationalityHighlightIndex(-1);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setNationalityHighlightIndex((i) => Math.min(i + 1, filteredCountries.length - 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setNationalityHighlightIndex((i) => Math.max(i - 1, 0));
                } else if (e.key === "Enter" && nationalityHighlightIndex >= 0) {
                  e.preventDefault();
                  const selected = filteredCountries[nationalityHighlightIndex];
                  setNationality(selected);
                  setNationalitySearch(selected);
                  setShowNationalitySuggestions(false);
                  setNationalityHighlightIndex(-1);
                } else if (e.key === "Escape") {
                  setShowNationalitySuggestions(false);
                }
              }}
              onFocus={() => setShowNationalitySuggestions(true)}
              onBlur={() => setTimeout(() => setShowNationalitySuggestions(false), 150)}
              placeholder="Nationality"
              className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
            />
            {showNationalitySuggestions && filteredCountries.length > 0 && (
              <ul className="absolute z-50 mt-1 max-h-48 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">
                {filteredCountries.map((country, idx) => (
                  <li
                    key={country}
                    onMouseDown={() => {
                      setNationality(country);
                      setNationalitySearch(country);
                      setShowNationalitySuggestions(false);
                      setNationalityHighlightIndex(-1);
                    }}
                    className={`cursor-pointer px-4 py-2 text-sm transition ${
                      idx === nationalityHighlightIndex
                        ? "bg-cyan-50 text-cyan-700"
                        : "hover:bg-slate-50"
                    }`}
                  >
                    {country}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <input
            value={emiratesId}
            onChange={(e) => setEmiratesId(e.target.value)}
            placeholder="Emirates ID"
            className="rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
          />
          <input
            value={passportNumber}
            onChange={(e) => setPassportNumber(e.target.value)}
            placeholder="Passport Number"
            className="rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
          />
          <input
            value={mrn}
            onChange={(e) => setMrn(e.target.value)}
            placeholder="MRN (Medical Record No.)"
            className="rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
          />
          <input
            type="number"
            min="1"
            value={fileNo}
            onChange={(e) => setFileNo(e.target.value)}
            placeholder="File No. (auto if blank)"
            className="rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
          />
        </div>

        <button
          onClick={addPatient}
          disabled={saving}
          className="rounded-2xl bg-cyan-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? "Saving..." : "Add Patient"}
        </button>
      </div>

      <AddOutstandingBalanceModal
        isOpen={showBalanceModal}
        onClose={() => setShowBalanceModal(false)}
        patient={lastAdded}
        clinics={clinics}
        onSaved={(balance) => setSavedBalance(balance)}
      />
    </AppFrame>
  );
}
