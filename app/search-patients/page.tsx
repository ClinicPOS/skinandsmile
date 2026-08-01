"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppFrame } from "../../components/app-frame";
import { supabase } from "../../lib/supabase";
import { getActiveClinicIdFromRegisterSession } from "../../lib/clinic-patient-files";
import { filterClinicsForAccess, useClinicAccess } from "../../lib/clinic-access";

type Patient = {
  id: string;
  name: string;
  phone: string | null;
  clinic_file_no: string;
};

type Clinic = {
  id: string;
  name: string;
};

export default function SearchPatientsPage() {
  const { accessSession, isLoaded, isManager, allowedClinicId } = useClinicAccess();
  const [query, setQuery] = useState("");
  const [patients, setPatients] = useState<Patient[]>([]);
  const [clinics, setClinics] = useState<Clinic[]>([]);
  const [selectedClinicId, setSelectedClinicId] = useState("");
  const [isSearching, setIsSearching] = useState(false);

  const loadClinicsAndPatients = useCallback(async () => {
    if (!isLoaded) return;
    const { data: clinicRows } = await supabase.from("clinics").select("id, name").order("name", { ascending: true });
    const clinicsData = filterClinicsForAccess((clinicRows || []) as Clinic[], accessSession);
    setClinics(clinicsData);
    const activeClinicId = getActiveClinicIdFromRegisterSession();
    const initialClinicId = allowedClinicId && clinicsData.some((c) => c.id === allowedClinicId)
      ? allowedClinicId
      : activeClinicId && clinicsData.some((c) => c.id === activeClinicId)
        ? activeClinicId
        : "";
    setSelectedClinicId(initialClinicId);
    if (initialClinicId) {
      await loadPatients(initialClinicId, "");
    }
  }, [accessSession, allowedClinicId, isLoaded]);

  useEffect(() => {
    if (!isLoaded) return;
    loadClinicsAndPatients();
  }, [loadClinicsAndPatients]);

  useEffect(() => {
    if (!selectedClinicId) return;

    const handle = setTimeout(() => {
      loadPatients(selectedClinicId, query);
    }, 300);

    return () => clearTimeout(handle);
  }, [query, selectedClinicId]);

  async function loadPatients(clinicId: string, search?: string) {
    const trimmed = (search || "").trim();
    setIsSearching(true);

    try {
      let q = supabase
        .from("clinic_patient_files")
        .select("file_no, patients!inner(id, name, phone)")
        .eq("clinic_id", clinicId)
        .order("file_no", { ascending: true })
        .limit(200);

      if (trimmed) {
        // Search by file number exact match first, then name/phone contains
        if (/^\d+$/.test(trimmed)) {
          q = q.eq("file_no", trimmed);
        } else {
          q = q.or(`name.ilike.%${trimmed}%,phone.ilike.%${trimmed}%`, { referencedTable: "patients" });
        }
      }

      const { data } = await q;

      const mapped = ((data || []) as Array<{ file_no: string; patients: { id: string; name: string; phone: string | null } | { id: string; name: string; phone: string | null }[] }>)
        .map((row) => {
          const p = Array.isArray(row.patients) ? row.patients[0] : row.patients;
          if (!p?.id) return null;
          return {
            id: p.id as string,
            name: String(p.name || ""),
            phone: (p.phone as string | null) ?? null,
            clinic_file_no: String(row.file_no || ""),
          } as Patient;
        })
        .filter((row): row is Patient => row !== null);

      setPatients(mapped);
    } finally {
      setIsSearching(false);
    }
  }

  const filteredPatients = useMemo(() => patients, [patients]);

  return (
    <AppFrame
      title="Search Patients"
      description="Look up patients quickly by name or phone number before opening receipts or treatment history."
    >
      <div className="space-y-6">
        <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
          <label className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">
            Clinic
          </label>
          <select
            value={selectedClinicId}
            onChange={async (e) => {
              const clinicId = e.target.value;
              setSelectedClinicId(clinicId);
              setPatients([]);
              if (clinicId) await loadPatients(clinicId, query);
            }}
            disabled={!isManager}
            className="mt-3 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
          >
            <option value="">Select clinic</option>
            {clinics.map((clinic) => (
              <option key={clinic.id} value={clinic.id}>
                {clinic.name}
              </option>
            ))}
          </select>

          <label className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">
            Search
          </label>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type file number, name, or phone to search"
            className="mt-3 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
          />
          {isSearching && (
            <p className="mt-2 text-xs text-slate-400">Searching…</p>
          )}
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
                  <p className="mt-1 text-xs text-slate-500">File No: {patient.clinic_file_no || "—"}</p>
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
