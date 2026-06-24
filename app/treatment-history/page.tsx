"use client";

import { useEffect, useMemo, useState } from "react";
import { AppFrame } from "../../components/app-frame";
import { supabase } from "../../lib/supabase";

type Patient = {
  id: string;
  name: string;
  phone: string | null;
};

type Receipt = {
  id: string;
  patient_id: string;
  subtotal: number;
  vat: number;
  total: number;
  created_at?: string;
  notes: string | null;
};

type Service = {
  id: string;
  name: string;
};

type ReceiptItem = {
  receipt_id: string;
  service_id: string;
  quantity: number;
  total: number;
};

export default function TreatmentHistoryPage() {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [receiptItems, setReceiptItems] = useState<ReceiptItem[]>([]);
  const [selectedPatientId, setSelectedPatientId] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    const [patientResult, receiptResult, serviceResult, itemResult] = await Promise.all([
      supabase.from("patients").select("id, name, phone").order("name", { ascending: true }),
      supabase.from("receipts").select("id, patient_id, subtotal, vat, total, created_at, notes").order("created_at", { ascending: false }),
      supabase.from("services").select("id, name").order("name", { ascending: true }),
      supabase.from("receipt_items").select("receipt_id, service_id, quantity, total"),
    ]);

    setPatients((patientResult.data as Patient[]) || []);
    setReceipts((receiptResult.data as Receipt[]) || []);
    setServices((serviceResult.data as Service[]) || []);
    setReceiptItems((itemResult.data as ReceiptItem[]) || []);

    if (!selectedPatientId && patientResult.data?.length) {
      setSelectedPatientId(patientResult.data[0].id);
    }
  }

  const filteredPatients = useMemo(() => {
    const value = search.trim().toLowerCase();

    if (!value) {
      return patients;
    }

    return patients.filter((patient) => {
      return (
        patient.name.toLowerCase().includes(value) ||
        (patient.phone || "").toLowerCase().includes(value)
      );
    });
  }, [patients, search]);

  const selectedPatient = filteredPatients.find((patient) => patient.id === selectedPatientId) || patients.find((patient) => patient.id === selectedPatientId);
  const patientReceipts = receipts.filter((receipt) => receipt.patient_id === selectedPatient?.id);

  return (
    <AppFrame
      title="Patient Treatment History"
      description="Open a patient record and review their previous visits, receipts, and services."
    >
      <div className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
        <div className="space-y-4">
          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
            <label className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">
              Search patients
            </label>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Type a name or phone number"
              className="mt-3 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
            />
          </div>

          <div className="space-y-3">
            {filteredPatients.map((patient) => (
              <button
                key={patient.id}
                onClick={() => setSelectedPatientId(patient.id)}
                className={`w-full rounded-2xl border p-4 text-left transition hover:-translate-y-0.5 ${
                  patient.id === selectedPatientId
                    ? "border-cyan-300 bg-cyan-50 shadow-sm"
                    : "border-slate-200 bg-white"
                }`}
              >
                <p className="text-sm font-semibold text-slate-900">{patient.name}</p>
                <p className="mt-1 text-sm text-slate-500">{patient.phone || "No phone number saved"}</p>
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          {selectedPatient ? (
            <>
              <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">
                  Active patient
                </p>
                <h2 className="mt-2 text-2xl font-semibold text-slate-900">{selectedPatient.name}</h2>
                <p className="mt-2 text-sm text-slate-500">
                  {selectedPatient.phone || "No phone number saved"}
                </p>
              </div>

              <div className="space-y-3">
                {patientReceipts.map((receipt) => {
                  const lineItems = receiptItems
                    .filter((item) => item.receipt_id === receipt.id)
                    .map((item) => {
                      const service = services.find((entry) => entry.id === item.service_id);

                      return {
                        id: item.service_id,
                        name: service?.name || "Service",
                        quantity: item.quantity,
                        total: item.total,
                      };
                    });

                  return (
                    <div key={receipt.id} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">
                            Visit #{receipt.id.slice(0, 8)}
                          </p>
                          <p className="mt-1 text-sm text-slate-500">
                            {receipt.created_at ? new Date(receipt.created_at).toLocaleString() : "No date"}
                          </p>
                        </div>
                        <p className="text-sm font-semibold text-slate-900">
                          AED {Number(receipt.total || 0).toFixed(2)}
                        </p>
                      </div>

                      <div className="mt-4 space-y-2">
                        {lineItems.map((item) => (
                          <div key={item.id} className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3 text-sm">
                            <span className="font-medium text-slate-900">{item.name}</span>
                            <span className="text-slate-600">Qty {item.quantity}</span>
                          </div>
                        ))}
                      </div>

                      {receipt.notes && (
                        <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                          <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Notes</p>
                          <p className="mt-2">{receipt.notes}</p>
                        </div>
                      )}
                    </div>
                  );
                })}

                {patientReceipts.length === 0 && (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500">
                    No treatment history found for this patient.
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500">
              Select a patient to view treatment history.
            </div>
          )}
        </div>
      </div>
    </AppFrame>
  );
}
