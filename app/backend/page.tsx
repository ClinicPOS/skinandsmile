"use client";

import { useEffect, useMemo, useState } from "react";
import { AppFrame } from "../../components/app-frame";
import { supabase } from "../../lib/supabase";
import { Patient, Doctor, Service, Receptionist, CashRegisterSession, Clinic } from "../../lib/types";
import { calculateAge } from "../../lib/utils";

const BACKEND_PIN = "0404";

export default function BackendPage() {
  const [pinInput, setPinInput] = useState("");
  const [isUnlocked, setIsUnlocked] = useState(false);

  const [patients, setPatients] = useState<Patient[]>([]);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [receptionists, setReceptionists] = useState<Receptionist[]>([]);
  const [cashRegisterSessions, setCashRegisterSessions] = useState<CashRegisterSession[]>([]);
  const [clinics, setClinics] = useState<Clinic[]>([]);
  const [selectedClinicId, setSelectedClinicId] = useState<string>("all");
  const [isRegisterTableReady, setIsRegisterTableReady] = useState(true);

  const [patientName, setPatientName] = useState("");
  const [patientPhone, setPatientPhone] = useState("");
  const [patientEmail, setPatientEmail] = useState("");
  const [patientNotes, setPatientNotes] = useState("");
  const [patientSearch, setPatientSearch] = useState("");
  const [patientDateOfBirth, setPatientDateOfBirth] = useState("");
  const [patientSex, setPatientSex] = useState("");
  const [patientNationality, setPatientNationality] = useState("");
  const [patientEmiratesId, setPatientEmiratesId] = useState("");
  const [patientPassportNumber, setPatientPassportNumber] = useState("");

  const [editingPatientId, setEditingPatientId] = useState("");
  const [editingPatientName, setEditingPatientName] = useState("");
  const [editingPatientPhone, setEditingPatientPhone] = useState("");
  const [editingPatientEmail, setEditingPatientEmail] = useState("");
  const [editingPatientNotes, setEditingPatientNotes] = useState("");
  const [editingPatientDob, setEditingPatientDob] = useState("");
  const [editingPatientSex, setEditingPatientSex] = useState("");
  const [editingPatientNationality, setEditingPatientNationality] = useState("");
  const [editingPatientEmiratesId, setEditingPatientEmiratesId] = useState("");
  const [editingPatientPassportNumber, setEditingPatientPassportNumber] = useState("");
  const [patientPage, setPatientPage] = useState(1);
  const [expandedPatientId, setExpandedPatientId] = useState<string | null>(null);

  const [doctorName, setDoctorName] = useState("");
  const [doctorSpecialty, setDoctorSpecialty] = useState("");
  const [editingDoctorId, setEditingDoctorId] = useState("");
  const [editingDoctorName, setEditingDoctorName] = useState("");
  const [editingDoctorSpecialty, setEditingDoctorSpecialty] = useState("");

  const [serviceName, setServiceName] = useState("");
  const [servicePrice, setServicePrice] = useState("");
  const [editingServiceId, setEditingServiceId] = useState("");
  const [editingServiceName, setEditingServiceName] = useState("");
  const [editingServicePrice, setEditingServicePrice] = useState("");
  const [servicePage, setServicePage] = useState(1);

  const [receptionistName, setReceptionistName] = useState("");
  const [receptionistShift, setReceptionistShift] = useState("");
  const [receptionistPin, setReceptionistPin] = useState("");
  const [editingReceptionistId, setEditingReceptionistId] = useState("");
  const [editingReceptionistName, setEditingReceptionistName] = useState("");
  const [editingReceptionistShift, setEditingReceptionistShift] = useState("");
  const [editingReceptionistPin, setEditingReceptionistPin] = useState("");
  const [editingReceptionistClinicId, setEditingReceptionistClinicId] = useState("");

  // Refunds state - removed

  const recordSummary = useMemo(
    () => [
      { label: "Patients", value: patients.length },
      { label: "Doctors", value: doctors.length },
      { label: "Services", value: services.length },
      { label: "Receptionists", value: receptionists.length },
      { label: "Sessions Today", value: cashRegisterSessions.length },
    ],
    [
      patients.length,
      doctors.length,
      services.length,
      receptionists.length,
      cashRegisterSessions.length,
    ]
  );

  const filteredPatients = useMemo(() => {
    const keyword = patientSearch.trim().toLowerCase();
    if (!keyword) return patients;
    return patients.filter((patient) =>
      String(patient.name || "").toLowerCase().includes(keyword)
    );
  }, [patients, patientSearch]);

  const patientTotalPages = Math.max(1, Math.ceil(filteredPatients.length / 5));
  const pagedPatients = useMemo(() => {
    const start = (patientPage - 1) * 5;
    return filteredPatients.slice(start, start + 5);
  }, [filteredPatients, patientPage]);

  useEffect(() => { setPatientPage(1); }, [patientSearch]);

  const displayedDoctors = useMemo(() =>
    selectedClinicId === "all" ? doctors : doctors.filter(d => d.clinic_id === selectedClinicId),
    [doctors, selectedClinicId]
  );

  const displayedServices = useMemo(() =>
    selectedClinicId === "all" ? services : services.filter(s => s.clinic_id === selectedClinicId),
    [services, selectedClinicId]
  );

  const serviceTotalPages = Math.max(1, Math.ceil(displayedServices.length / 10));
  const pagedServices = useMemo(() => {
    const start = (servicePage - 1) * 10;
    return displayedServices.slice(start, start + 10);
  }, [displayedServices, servicePage]);

  useEffect(() => { setServicePage(1); }, [selectedClinicId]);

  const displayedReceptionists = useMemo(() =>
    selectedClinicId === "all" ? receptionists : receptionists.filter(r => r.clinic_id === selectedClinicId),
    [receptionists, selectedClinicId]
  );

  useEffect(() => {
    if (isUnlocked) {
      loadAll();
    }
  }, [isUnlocked]);

  async function loadAll() {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const [
      patientsResult,
      doctorsResult,
      servicesResult,
      receptionistsResult,
      cashSessionsResult,
      clinicsResult,
    ] = await Promise.all([
      supabase.from("patients").select("*"),
      supabase.from("doctors").select("*"),
      supabase.from("services").select("*"),
      supabase.from("receptionist").select("*"),
      supabase
        .from("cash_register_sessions")
        .select("*")
        .gte("opened_at", startOfDay.toISOString())
        .order("opened_at", { ascending: false }),
      supabase.from("clinics").select("*").order("name"),
    ]);

    setPatients((patientsResult.data || []) as Patient[]);
    setDoctors((doctorsResult.data || []) as Doctor[]);
    setServices((servicesResult.data || []) as Service[]);
    setReceptionists((receptionistsResult.data || []) as Receptionist[]);
    setClinics((clinicsResult.data || []) as Clinic[]);

    if (cashSessionsResult.error) {
      setCashRegisterSessions([]);
      if (cashSessionsResult.error.code === "42P01") {
        setIsRegisterTableReady(false);
      } else {
        setIsRegisterTableReady(true);
        console.warn("Failed loading cash register sessions", cashSessionsResult.error);
      }
    } else {
      setIsRegisterTableReady(true);
      setCashRegisterSessions((cashSessionsResult.data || []) as CashRegisterSession[]);
    }
  }

  function getReceptionistNameById(id: string) {
    return receptionists.find((person) => person.id === id)?.name || "Unknown";
  }

  function unlockBackend() {
    if (pinInput === BACKEND_PIN) {
      setIsUnlocked(true);
      return;
    }
    alert("Invalid PIN");
  }

  async function addPatient() {
    if (!patientName.trim()) {
      alert("Patient name is required.");
      return;
    }

    const { error } = await supabase.from("patients").insert([
      {
        name: patientName,
        phone: patientPhone,
        email: patientEmail,
        notes: patientNotes,
        date_of_birth: patientDateOfBirth || null,
        sex: patientSex || null,
        nationality: patientNationality || null,
        emirates_id: patientEmiratesId || null,
        passport_number: patientPassportNumber || null,
      },
    ]);

    if (error) {
      alert("Error saving patient");
      return;
    }

    setPatientName("");
    setPatientPhone("");
    setPatientEmail("");
    setPatientNotes("");
    setPatientDateOfBirth("");
    setPatientSex("");
    setPatientNationality("");
    setPatientEmiratesId("");
    setPatientPassportNumber("");
    loadAll();
  }

  async function updatePatient(id: string) {
    if (!editingPatientName.trim()) {
      alert("Patient name is required.");
      return;
    }

    const { error } = await supabase
      .from("patients")
      .update({
        name: editingPatientName,
        phone: editingPatientPhone,
        email: editingPatientEmail,
        notes: editingPatientNotes,
        date_of_birth: editingPatientDob || null,
        sex: editingPatientSex || null,
        nationality: editingPatientNationality || null,
        emirates_id: editingPatientEmiratesId || null,
        passport_number: editingPatientPassportNumber || null,
      })
      .eq("id", id);

    if (error) {
      alert("Error updating patient");
      return;
    }

    setEditingPatientId("");
    setEditingPatientName("");
    setEditingPatientPhone("");
    setEditingPatientEmail("");
    setEditingPatientNotes("");
    setEditingPatientDob("");
    setEditingPatientSex("");
    setEditingPatientNationality("");
    setEditingPatientEmiratesId("");
    setEditingPatientPassportNumber("");
    loadAll();
  }

  async function deletePatient(id: string) {
    const confirmed = window.confirm("Delete this patient?");
    if (!confirmed) {
      return;
    }

    const { error } = await supabase.from("patients").delete().eq("id", id);
    if (error) {
      alert("Error deleting patient");
      return;
    }

    if (editingPatientId === id) {
      setEditingPatientId("");
      setEditingPatientName("");
      setEditingPatientPhone("");
      setEditingPatientEmail("");
      setEditingPatientNotes("");
      setEditingPatientDob("");
      setEditingPatientSex("");
      setEditingPatientNationality("");
      setEditingPatientEmiratesId("");
      setEditingPatientPassportNumber("");
    }
    loadAll();
  }

  async function addDoctor() {
    if (!doctorName.trim()) {
      alert("Doctor name is required.");
      return;
    }
    if (selectedClinicId === "all") {
      alert("Please select a specific clinic before adding a doctor.");
      return;
    }

    const { error } = await supabase.from("doctors").insert([
      {
        name: doctorName,
        specialty: doctorSpecialty,
        clinic_id: selectedClinicId,
      },
    ]);

    if (error) {
      alert("Error saving doctor");
      return;
    }

    setDoctorName("");
    setDoctorSpecialty("");
    loadAll();
  }

  async function updateDoctor(id: string) {
    if (!editingDoctorName.trim()) {
      alert("Doctor name is required.");
      return;
    }

    const { error } = await supabase
      .from("doctors")
      .update({ name: editingDoctorName, specialty: editingDoctorSpecialty })
      .eq("id", id);

    if (error) {
      alert("Error updating doctor");
      return;
    }

    setEditingDoctorId("");
    setEditingDoctorName("");
    setEditingDoctorSpecialty("");
    loadAll();
  }

  async function deleteDoctor(id: string) {
    const confirmed = window.confirm("Delete this doctor?");
    if (!confirmed) {
      return;
    }

    const { error } = await supabase.from("doctors").delete().eq("id", id);
    if (error) {
      alert("Error deleting doctor");
      return;
    }

    if (editingDoctorId === id) {
      setEditingDoctorId("");
      setEditingDoctorName("");
      setEditingDoctorSpecialty("");
    }
    loadAll();
  }

  async function addService() {
    if (!serviceName.trim()) {
      alert("Service name is required.");
      return;
    }

    const parsedPrice = Number(servicePrice);
    if (!Number.isFinite(parsedPrice) || parsedPrice < 0) {
      alert("Please enter a valid service price.");
      return;
    }

    if (selectedClinicId === "all") {
      alert("Please select a specific clinic before adding a service.");
      return;
    }

    const { error } = await supabase.from("services").insert([
      {
        name: serviceName,
        price: parsedPrice,
        clinic_id: selectedClinicId,
      },
    ]);

    if (error) {
      alert("Error saving service");
      return;
    }

    setServiceName("");
    setServicePrice("");
    loadAll();
  }

  async function updateService(id: string) {
    if (!editingServiceName.trim()) {
      alert("Service name is required.");
      return;
    }

    const parsedPrice = Number(editingServicePrice);
    if (!Number.isFinite(parsedPrice) || parsedPrice < 0) {
      alert("Please enter a valid service price.");
      return;
    }

    const { error } = await supabase
      .from("services")
      .update({ name: editingServiceName, price: parsedPrice })
      .eq("id", id);

    if (error) {
      alert("Error updating service");
      return;
    }

    setEditingServiceId("");
    setEditingServiceName("");
    setEditingServicePrice("");
    loadAll();
  }

  async function deleteService(id: string) {
    const confirmed = window.confirm("Delete this service?");
    if (!confirmed) {
      return;
    }

    const { error } = await supabase.from("services").delete().eq("id", id);
    if (error) {
      alert("Error deleting service");
      return;
    }

    if (editingServiceId === id) {
      setEditingServiceId("");
      setEditingServiceName("");
      setEditingServicePrice("");
    }
    loadAll();
  }

  async function addReceptionist() {
    if (!receptionistName.trim()) {
      alert("Receptionist name is required.");
      return;
    }

    if (!/^\d{4}$/.test(receptionistPin)) {
      alert("Please enter a 4-digit PIN for the receptionist.");
      return;
    }

    if (selectedClinicId === "all") {
      alert("Please select a specific clinic before adding a receptionist.");
      return;
    }

    const { error } = await supabase.from("receptionist").insert([
      {
        name: receptionistName,
        shift: receptionistShift,
        pin: receptionistPin,
        clinic_id: selectedClinicId,
      },
    ]);

    if (error) {
      alert("Error saving receptionist");
      return;
    }

    setReceptionistName("");
    setReceptionistShift("");
    setReceptionistPin("");
    loadAll();
  }

  async function updateReceptionist(id: string) {
    if (!editingReceptionistName.trim()) {
      alert("Receptionist name is required.");
      return;
    }

    if (editingReceptionistPin && !/^\d{4}$/.test(editingReceptionistPin)) {
      alert("New PIN must be exactly 4 digits.");
      return;
    }

    const updatePayload: { name: string; shift: string; pin?: string; clinic_id?: string } = {
      name: editingReceptionistName,
      shift: editingReceptionistShift,
      clinic_id: editingReceptionistClinicId || undefined,
    };

    if (editingReceptionistPin) {
      updatePayload.pin = editingReceptionistPin;
    }

    const { error } = await supabase
      .from("receptionist")
      .update(updatePayload)
      .eq("id", id);

    if (error) {
      alert("Error updating receptionist");
      return;
    }

    setEditingReceptionistId("");
    setEditingReceptionistName("");
    setEditingReceptionistShift("");
    setEditingReceptionistPin("");
    setEditingReceptionistClinicId("");
    loadAll();
  }

  async function deleteReceptionist(id: string) {
    const confirmed = window.confirm("Delete this receptionist?");
    if (!confirmed) {
      return;
    }

    const { error } = await supabase.from("receptionist").delete().eq("id", id);
    if (error) {
      alert("Error deleting receptionist");
      return;
    }

    if (editingReceptionistId === id) {
      setEditingReceptionistId("");
      setEditingReceptionistName("");
      setEditingReceptionistShift("");
      setEditingReceptionistPin("");
    }
    loadAll();
  }

  if (!isUnlocked) {
    return (
      <AppFrame
        title="Backend"
        description="Protected area for managing patients, doctors, services, and receptionists."
      >
        <div className="mx-auto max-w-md rounded-3xl border border-slate-200 bg-slate-50 p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">
            Enter PIN to continue
          </p>
          <div className="mt-4 space-y-4">
            <input
              type="password"
              placeholder="PIN"
              value={pinInput}
              onChange={(e) => setPinInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  unlockBackend();
                }
              }}
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
            />
            <button
              onClick={unlockBackend}
              className="inline-flex w-full items-center justify-center rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              Open Backend
            </button>
            <a
              href="/receipt-log"
              className="inline-flex w-full items-center justify-center rounded-2xl border border-teal-300 bg-teal-50 px-5 py-3 text-sm font-semibold text-teal-700 transition hover:bg-teal-100"
            >
              View Receipts
            </a>
          </div>
        </div>
      </AppFrame>
    );
  }

  return (
    <AppFrame
      title="Backend"
      description="One screen for clinic master data: patients, doctors, services, and receptionists."
    >
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <span className="text-sm font-semibold text-slate-700">Viewing clinic:</span>
        <select
          value={selectedClinicId}
          onChange={(e) => setSelectedClinicId(e.target.value)}
          className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
        >
          <option value="all">All Clinics</option>
          {clinics.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        {selectedClinicId !== "all" && (
          <span className="rounded-full bg-cyan-100 px-3 py-1 text-xs font-semibold text-cyan-700">
            {clinics.find(c => c.id === selectedClinicId)?.room}
          </span>
        )}
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {recordSummary.map((item) => (
          <div key={item.label} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{item.label}</p>
            <p className="mt-2 text-2xl font-semibold text-slate-900">{item.value}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <div className="rounded-3xl border border-slate-200 bg-white p-5">
          <h2 className="text-lg font-semibold text-slate-900">Patients</h2>
          <input
            value={patientSearch}
            onChange={(e) => setPatientSearch(e.target.value)}
            placeholder="Search patient by name"
            className="mt-4 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
          />
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <input
              value={patientName}
              onChange={(e) => setPatientName(e.target.value)}
              placeholder="Patient name"
              className="rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
            />
            <input
              value={patientPhone}
              onChange={(e) => setPatientPhone(e.target.value)}
              placeholder="Phone"
              className="rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
            />
            <input
              value={patientEmail}
              onChange={(e) => setPatientEmail(e.target.value)}
              placeholder="Email"
              className="rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
            />
            <input
              value={patientNotes}
              onChange={(e) => setPatientNotes(e.target.value)}
              placeholder="Notes"
              className="rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
            />
            <input
              type="date"
              value={patientDateOfBirth}
              onChange={(e) => setPatientDateOfBirth(e.target.value)}
              title="Date of Birth"
              className="rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
            />
            <select
              value={patientSex}
              onChange={(e) => setPatientSex(e.target.value)}
              className="rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
            >
              <option value="">Sex</option>
              <option value="Male">Male</option>
              <option value="Female">Female</option>
            </select>
            <input
              value={patientNationality}
              onChange={(e) => setPatientNationality(e.target.value)}
              placeholder="Nationality"
              className="rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
            />
            <input
              value={patientEmiratesId}
              onChange={(e) => setPatientEmiratesId(e.target.value)}
              placeholder="Emirates ID"
              className="rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
            />
            <input
              value={patientPassportNumber}
              onChange={(e) => setPatientPassportNumber(e.target.value)}
              placeholder="Passport Number"
              className="rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
            />
          </div>
          <button
            onClick={addPatient}
            className="mt-3 rounded-2xl bg-cyan-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-cyan-500"
          >
            Add Patient
          </button>

          <div className="mt-4 space-y-2">
            {pagedPatients.map((patient) => (
              <div key={patient.id} className="rounded-2xl border border-slate-200 p-3">
                {editingPatientId === patient.id ? (
                  <div className="space-y-2">
                    <input
                      value={editingPatientName}
                      onChange={(e) => setEditingPatientName(e.target.value)}
                      placeholder="Name"
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none"
                    />
                    <input
                      value={editingPatientPhone}
                      onChange={(e) => setEditingPatientPhone(e.target.value)}
                      placeholder="Phone"
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none"
                    />
                    <input
                      value={editingPatientEmail}
                      onChange={(e) => setEditingPatientEmail(e.target.value)}
                      placeholder="Email"
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none"
                    />
                    <input
                      value={editingPatientNotes}
                      onChange={(e) => setEditingPatientNotes(e.target.value)}
                      placeholder="Notes"
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="mb-0.5 block text-xs text-slate-500">Date of Birth</label>
                        <input
                          type="date"
                          value={editingPatientDob}
                          onChange={(e) => setEditingPatientDob(e.target.value)}
                          className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none"
                        />
                      </div>
                      <div>
                        <label className="mb-0.5 block text-xs text-slate-500">Sex</label>
                        <select
                          value={editingPatientSex}
                          onChange={(e) => setEditingPatientSex(e.target.value)}
                          className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none"
                        >
                          <option value="">Select</option>
                          <option value="Male">Male</option>
                          <option value="Female">Female</option>
                        </select>
                      </div>
                    </div>
                    <input
                      value={editingPatientNationality}
                      onChange={(e) => setEditingPatientNationality(e.target.value)}
                      placeholder="Nationality"
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none"
                    />
                    <input
                      value={editingPatientEmiratesId}
                      onChange={(e) => setEditingPatientEmiratesId(e.target.value)}
                      placeholder="Emirates ID"
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none"
                    />
                    <input
                      value={editingPatientPassportNumber}
                      onChange={(e) => setEditingPatientPassportNumber(e.target.value)}
                      placeholder="Passport Number"
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => updatePatient(patient.id)}
                        className="rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditingPatientId("")}
                        className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <button
                      className="flex w-full items-center justify-between gap-3 text-left"
                      onClick={() => setExpandedPatientId(expandedPatientId === patient.id ? null : patient.id)}
                    >
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{patient.name}</p>
                        <p className="text-xs text-slate-500">{patient.phone || "-"}</p>
                      </div>
                      <span className="text-slate-400 text-xs">{expandedPatientId === patient.id ? "▲" : "▼"}</span>
                    </button>
                    {expandedPatientId === patient.id && (
                      <div className="mt-2 border-t border-slate-100 pt-2 space-y-0.5">
                        <p className="text-xs text-slate-500">{patient.email || "-"}</p>
                        {(patient.date_of_birth || patient.sex || patient.nationality) && (
                          <p className="text-xs text-slate-400">
                            {[
                              patient.sex,
                              patient.date_of_birth ? `${calculateAge(patient.date_of_birth)} yrs` : null,
                              patient.nationality,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                        )}
                        {patient.emirates_id && (
                          <p className="text-xs text-slate-400">ID: {patient.emirates_id}</p>
                        )}
                        {patient.passport_number && (
                          <p className="text-xs text-slate-400">Passport: {patient.passport_number}</p>
                        )}
                        {patient.notes && (
                          <p className="text-xs italic text-slate-400">{patient.notes}</p>
                        )}
                        <div className="flex gap-2 pt-2">
                          <button
                            onClick={() => {
                              setEditingPatientId(patient.id);
                              setEditingPatientName(patient.name || "");
                              setEditingPatientPhone(patient.phone || "");
                              setEditingPatientEmail(patient.email || "");
                              setEditingPatientNotes(patient.notes || "");
                              setEditingPatientDob(patient.date_of_birth || "");
                              setEditingPatientSex(patient.sex || "");
                              setEditingPatientNationality(patient.nationality || "");
                              setEditingPatientEmiratesId(patient.emirates_id || "");
                              setEditingPatientPassportNumber(patient.passport_number || "");
                              setExpandedPatientId(null);
                            }}
                            className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => deletePatient(patient.id)}
                            className="rounded-xl bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
          {patientTotalPages > 1 && (
            <div className="mt-3 flex items-center justify-between">
              <button
                onClick={() => setPatientPage((p) => Math.max(1, p - 1))}
                disabled={patientPage === 1}
                className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 disabled:opacity-40"
              >
                ← Prev
              </button>
              <span className="text-xs text-slate-500">Page {patientPage} of {patientTotalPages}</span>
              <button
                onClick={() => setPatientPage((p) => Math.min(patientTotalPages, p + 1))}
                disabled={patientPage >= patientTotalPages}
                className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 disabled:opacity-40"
              >
                Next →
              </button>
            </div>
          )}
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-5">
          <h2 className="text-lg font-semibold text-slate-900">Doctors / Aestheticians</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <input
              value={doctorName}
              onChange={(e) => setDoctorName(e.target.value)}
              placeholder="Doctor / Aesthetician name"
              className="rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-teal-300 focus:ring-4 focus:ring-teal-100"
            />
            <input
              value={doctorSpecialty}
              onChange={(e) => setDoctorSpecialty(e.target.value)}
              placeholder="Specialty"
              className="rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-teal-300 focus:ring-4 focus:ring-teal-100"
            />
          </div>
          <button
            onClick={addDoctor}
            className="mt-3 rounded-2xl bg-teal-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-500"
          >
            Add Doctor / Aesthetician
          </button>

          <div className="mt-4 space-y-2">
            {displayedDoctors.map((doctor) => (
              <div key={doctor.id} className="rounded-2xl border border-slate-200 p-3">
                {editingDoctorId === doctor.id ? (
                  <div className="space-y-2">
                    <input
                      value={editingDoctorName}
                      onChange={(e) => setEditingDoctorName(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none"
                    />
                    <input
                      value={editingDoctorSpecialty}
                      onChange={(e) => setEditingDoctorSpecialty(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => updateDoctor(doctor.id)}
                        className="rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditingDoctorId("")}
                        className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{doctor.name}</p>
                      <p className="text-sm text-slate-500">{doctor.specialty || "-"}</p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          setEditingDoctorId(doctor.id);
                          setEditingDoctorName(doctor.name || "");
                          setEditingDoctorSpecialty(doctor.specialty || "");
                        }}
                        className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => deleteDoctor(doctor.id)}
                        className="rounded-xl bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-5">
          <h2 className="text-lg font-semibold text-slate-900">Services</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <input
              value={serviceName}
              onChange={(e) => setServiceName(e.target.value)}
              placeholder="Service name"
              className="rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
            />
            <input
              type="number"
              value={servicePrice}
              onChange={(e) => setServicePrice(e.target.value)}
              placeholder="Price"
              className="rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
            />
          </div>
          <button
            onClick={addService}
            className="mt-3 rounded-2xl bg-cyan-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-cyan-500"
          >
            Add Service
          </button>

          <div className="mt-4 space-y-2">
            {pagedServices.map((service) => (
              <div key={service.id} className="rounded-2xl border border-slate-200 p-3">
                {editingServiceId === service.id ? (
                  <div className="space-y-2">
                    <input
                      value={editingServiceName}
                      onChange={(e) => setEditingServiceName(e.target.value)}
                      placeholder="Service name"
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none"
                    />
                    <input
                      type="number"
                      value={editingServicePrice}
                      onChange={(e) => setEditingServicePrice(e.target.value)}
                      placeholder="Price"
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => updateService(service.id)}
                        className="rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditingServiceId("")}
                        className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{service.name}</p>
                      <p className="text-sm text-slate-500">AED {Number(service.price || 0).toFixed(2)}</p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          setEditingServiceId(service.id);
                          setEditingServiceName(service.name || "");
                          setEditingServicePrice(String(service.price ?? ""));
                        }}
                        className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => deleteService(service.id)}
                        className="rounded-xl bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
          {serviceTotalPages > 1 && (
            <div className="mt-3 flex items-center justify-between">
              <button
                onClick={() => setServicePage((p) => Math.max(1, p - 1))}
                disabled={servicePage === 1}
                className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 disabled:opacity-40"
              >
                ← Prev
              </button>
              <span className="text-xs text-slate-500">Page {servicePage} of {serviceTotalPages}</span>
              <button
                onClick={() => setServicePage((p) => Math.min(serviceTotalPages, p + 1))}
                disabled={servicePage >= serviceTotalPages}
                className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 disabled:opacity-40"
              >
                Next →
              </button>
            </div>
          )}
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-5">
          <h2 className="text-lg font-semibold text-slate-900">Receptionists</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <input
              value={receptionistName}
              onChange={(e) => setReceptionistName(e.target.value)}
              placeholder="Receptionist name"
              className="rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
            />
            <select
              value={receptionistShift}
              onChange={(e) => setReceptionistShift(e.target.value)}
              className="rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
            >
              <option value="">Select shift</option>
              <option value="Morning">Morning</option>
              <option value="Evening">Evening</option>
            </select>
            <input
              type="password"
              inputMode="numeric"
              value={receptionistPin}
              onChange={(e) => setReceptionistPin(e.target.value)}
              placeholder="Set 4-digit PIN"
              className="sm:col-span-2 rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
            />
          </div>
          <button
            onClick={addReceptionist}
            className="mt-3 rounded-2xl bg-cyan-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-cyan-500"
          >
            Add Receptionist
          </button>

          <div className="mt-4 space-y-2">
            {displayedReceptionists.map((person) => (
              <div key={person.id} className="rounded-2xl border border-slate-200 p-3">
                {editingReceptionistId === person.id ? (
                  <div className="space-y-2">
                    <input
                      value={editingReceptionistName}
                      onChange={(e) => setEditingReceptionistName(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none"
                    />
                    <select
                      value={editingReceptionistShift}
                      onChange={(e) => setEditingReceptionistShift(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none"
                    >
                      <option value="">Select shift</option>
                      <option value="Morning">Morning</option>
                      <option value="Evening">Evening</option>
                    </select>
                    <select
                      value={editingReceptionistClinicId}
                      onChange={(e) => setEditingReceptionistClinicId(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none"
                    >
                      <option value="">Assign Clinic</option>
                      {clinics.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                    <input
                      type="password"
                      inputMode="numeric"
                      value={editingReceptionistPin}
                      onChange={(e) => setEditingReceptionistPin(e.target.value)}
                      placeholder="New 4-digit PIN (optional)"
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => updateReceptionist(person.id)}
                        className="rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => {
                          setEditingReceptionistId("");
                          setEditingReceptionistPin("");
                          setEditingReceptionistClinicId("");
                        }}
                        className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{person.name}</p>
                      <p className="text-sm text-slate-500">{person.shift || "-"}</p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          setEditingReceptionistId(person.id);
                          setEditingReceptionistName(person.name || "");
                          setEditingReceptionistShift(person.shift || "");
                          setEditingReceptionistPin("");
                          setEditingReceptionistClinicId(person.clinic_id || "");
                        }}
                        className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => deleteReceptionist(person.id)}
                        className="rounded-xl bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-6 rounded-3xl border border-slate-200 bg-white p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Cashier Sessions (Today)</h2>
            <p className="mt-1 text-sm text-slate-500">
              Track opening and closing cash for each receptionist shift.
            </p>
          </div>
          <button
            onClick={loadAll}
            className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            Refresh
          </button>
        </div>

        {!isRegisterTableReady ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            Cashier sessions table is not set up yet. Create table <strong>cash_register_sessions</strong> in Supabase to enable this report.
          </div>
        ) : cashRegisterSessions.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
            No cashier sessions recorded today.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-slate-700">Receptionist</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-700">Opened</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-700">Closed</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-700">Opening Cash</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-700">Closing Cash</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-700">Difference</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-700">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {cashRegisterSessions.map((session) => {
                  const isOpen = !session.closed_at;
                  return (
                    <tr key={session.id}>
                      <td className="px-4 py-3 text-slate-800">{getReceptionistNameById(session.receptionist_id)}</td>
                      <td className="px-4 py-3 text-slate-600">{new Date(session.opened_at).toLocaleString()}</td>
                      <td className="px-4 py-3 text-slate-600">
                        {session.closed_at ? new Date(session.closed_at).toLocaleString() : "-"}
                      </td>
                      <td className="px-4 py-3 text-slate-800">AED {Number(session.opening_cash || 0).toFixed(2)}</td>
                      <td className="px-4 py-3 text-slate-800">
                        {session.closing_cash == null ? "-" : `AED ${Number(session.closing_cash).toFixed(2)}`}
                      </td>
                      <td className="px-4 py-3 text-slate-800">
                        {session.variance == null ? "-" : `AED ${Number(session.variance).toFixed(2)}`}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                            isOpen
                              ? "bg-teal-100 text-teal-700"
                              : "bg-slate-100 text-slate-700"
                          }`}
                        >
                          {isOpen ? "Open" : "Closed"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

      </div>
    </AppFrame>
  );
}
