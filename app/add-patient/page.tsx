"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { AppFrame } from "../../components/app-frame";
import { supabase } from "../../lib/supabase";
import { COUNTRIES } from "../../lib/countries";
import { AddOutstandingBalanceModal } from "../../components/outstanding-balance-modals";
import {
  getActiveClinicIdFromRegisterSession,
} from "../../lib/clinic-patient-files";
import { filterClinicsForAccess, useClinicAccess } from "../../lib/clinic-access";
import {
  getEmiratesIdReaderMessage,
  mergeReaderPatientFields,
  readEmiratesIdCard,
} from "../../lib/emirates-id-reader";
import { registerPatientFromPos } from "../../lib/patient-registration";
import type { Clinic, Patient, OutstandingBalance } from "../../lib/types";

export default function AddPatientPage() {
  const { accessSession, isLoaded, isManager, allowedClinicId } = useClinicAccess();
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
  const [selectedClinicId, setSelectedClinicId] = useState("");

  const [saving, setSaving] = useState(false);
  const [lastAdded, setLastAdded] = useState<Patient | null>(null);
  const [clinics, setClinics] = useState<Clinic[]>([]);
  const [showBalanceModal, setShowBalanceModal] = useState(false);
  const [savedBalance, setSavedBalance] = useState<OutstandingBalance | null>(null);
  const [readerStatus, setReaderStatus] = useState("Ready");
  const [readerSkippedFields, setReaderSkippedFields] = useState<string[]>([]);
  const [readerPhoto, setReaderPhoto] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoaded) return;
    supabase
      .from("clinics")
      .select("*")
      .then(({ data }) => {
        const rows = filterClinicsForAccess((data || []) as Clinic[], accessSession);
        setClinics(rows);
        const activeClinicId = allowedClinicId && rows.some((c) => c.id === allowedClinicId)
          ? allowedClinicId
          : getActiveClinicIdFromRegisterSession();
        if (activeClinicId && rows.some((c) => c.id === activeClinicId)) {
          setSelectedClinicId(activeClinicId);
        }
      });
  }, [accessSession, allowedClinicId, isLoaded]);

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
    setReaderStatus("Ready");
    setReaderSkippedFields([]);
    setReaderPhoto(null);
  }

  async function handleReadEmiratesId() {
    setReaderStatus("Reading Emirates ID…");
    setReaderSkippedFields([]);
    setReaderPhoto(null);

    try {
      const result = await readEmiratesIdCard();
      const { updates, skippedFields } = mergeReaderPatientFields(
        {
          name,
          emiratesId,
          dateOfBirth: dob,
          sex,
          nationality: nationality || nationalitySearch,
          phone,
          email,
          passportNumber,
        },
        result.fields
      );

      if (updates.name) setName(updates.name);
      if (updates.emiratesId) setEmiratesId(updates.emiratesId);
      if (updates.dateOfBirth) setDob(updates.dateOfBirth);
      if (updates.sex) setSex(updates.sex);
      if (updates.nationality) {
        setNationality(updates.nationality);
        setNationalitySearch(updates.nationality);
      }
      if (updates.phone) setPhone(updates.phone);
      if (updates.email) setEmail(updates.email);
      if (updates.passportNumber) setPassportNumber(updates.passportNumber);

      setReaderPhoto(result.photoDataUrl);
      setReaderSkippedFields(skippedFields);
      setReaderStatus("Emirates ID read successfully");
    } catch (error) {
      setReaderPhoto(null);
      setReaderSkippedFields([]);
      setReaderStatus(getEmiratesIdReaderMessage(error));
    }
  }

  async function addPatient() {
    if (!name.trim()) {
      alert("Patient name is required.");
      return;
    }
    if (!selectedClinicId) {
      alert("Please select a clinic before adding a patient.");
      return;
    }

    setSaving(true);
    try {
      const result = await registerPatientFromPos({
        clinicId: selectedClinicId, fullName: name.trim(), mobile: phone.trim(),
        email: email.trim() || null, notes: notes.trim() || null, dateOfBirth: dob || null,
        sex: sex || null, nationality: nationality || nationalitySearch.trim() || null,
        emiratesId: emiratesId.trim() || null, passportNumber: passportNumber.trim() || null,
        mrn: mrn.trim() || null, fileNo: fileNo.trim() || null, clinicFileClinicalNotes: notes.trim() || null,
      });
      if (result.warnings.length) alert(result.warnings.join("\n"));
      if (!result.patient) {
        alert("Patient was saved. Refresh the patient list to open their profile. Do not register them again.");
        resetForm();
        return;
      }
      setLastAdded({ ...result.patient, id: result.patientId, name: String(result.patient.name || name), phone: result.patient.phone ?? "" } as Patient);
      setSavedBalance(null);
      resetForm();
    } catch (error) {
      alert(error instanceof Error ? error.message : "Patient could not be saved. Check the patient list before retrying.");
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

        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-900">Emirates ID Reader</p>
              <p className="mt-1 text-xs text-slate-500">{readerStatus}</p>
            </div>
            <button
              type="button"
              onClick={() => void handleReadEmiratesId()}
              disabled={readerStatus === "Reading Emirates ID…"}
              className="rounded-2xl border border-cyan-200 bg-white px-4 py-2 text-sm font-semibold text-cyan-700 transition hover:bg-cyan-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {readerStatus === "Reading Emirates ID…" ? "Reading Emirates ID…" : "Read Emirates ID"}
            </button>
          </div>
          {readerSkippedFields.length > 0 ? (
            <p className="mt-3 text-xs text-amber-700">
              Existing fields were left unchanged: {readerSkippedFields.join(", ")}.
            </p>
          ) : null}
          {readerPhoto ? (
            <div className="mt-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Emirates ID Photo</p>
              <Image
                src={readerPhoto}
                alt="Emirates ID Photo"
                width={96}
                height={112}
                unoptimized
                className="mt-2 h-28 w-24 rounded-xl border border-slate-200 object-cover"
              />
            </div>
          ) : null}
        </div>

        {lastAdded && (
          <div className="rounded-2xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-800">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                Added <span className="font-semibold">{lastAdded.name}</span>
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
          <select
            value={selectedClinicId}
            onChange={(e) => setSelectedClinicId(e.target.value)}
            disabled={!isManager}
            className="rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
          >
            <option value="">Select clinic</option>
            {clinics.map((clinic) => (
              <option key={clinic.id} value={clinic.id}>
                {clinic.name}
              </option>
            ))}
          </select>
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
