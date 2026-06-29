"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

type Patient = {
  id: string;
  name: string;
  phone: string | null;
};

type Receipt = {
  id: string;
  receipt_number?: number | null;
  patient_id: string;
  doctor_id: string;
  receptionist_id: string;
  payment_method?: string | null;
  subtotal: number;
  vat: number;
  total: number;
  notes: string | null;
  created_at?: string;
};

type LookupItem = {
  id: string;
  name: string;
};

type Clinic = {
  id: string;
  name: string;
  address?: string | null;
  room?: string | null;
  trn?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  logo?: string | null;
};

type ReceiptItem = {
  receipt_id: string;
  service_id: string;
  quantity: number;
  price: number;
  total: number;
};

// Modal Overlay Wrapper
function ModalOverlay({ isOpen, onClose, children, title }: { isOpen: boolean; onClose: () => void; children: React.ReactNode; title: string }) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-3xl border border-teal-100 bg-white shadow-2xl">
        <div className="sticky top-0 flex items-center justify-between border-b border-teal-100 bg-white px-6 py-4">
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
          <button onClick={onClose} className="text-2xl text-slate-400 hover:text-slate-600">
            ×
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

// Search Patient Modal
export function SearchPatientModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [patients, setPatients] = useState<Patient[]>([]);

  useEffect(() => {
    if (isOpen) {
      loadPatients();
    }
  }, [isOpen]);

  async function loadPatients() {
    const { data } = await supabase.from("patients").select("id, name, phone").order("name", { ascending: true });
    setPatients((data as Patient[]) || []);
  }

  const filteredPatients = useMemo(() => {
    const search = query.trim().toLowerCase();
    if (!search) return patients;
    return patients.filter((patient) => patient.name.toLowerCase().includes(search) || (patient.phone || "").toLowerCase().includes(search));
  }, [patients, query]);

  return (
    <ModalOverlay isOpen={isOpen} onClose={onClose} title="Search Patients">
      <div className="space-y-4">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name or phone..."
          className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-teal-400 focus:ring-4 focus:ring-teal-100"
          autoFocus
        />
        <div className="space-y-2 max-h-[60vh] overflow-y-auto">
          {filteredPatients.map((patient) => (
            <div key={patient.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-3 hover:bg-slate-100">
              <p className="text-sm font-semibold text-slate-900">{patient.name}</p>
              <p className="text-xs text-slate-500">{patient.phone || "No phone"}</p>
            </div>
          ))}
          {filteredPatients.length === 0 && <div className="text-center text-sm text-slate-500">No patients found</div>}
        </div>
      </div>
    </ModalOverlay>
  );
}

// Receipt History Modal
export function ReceiptHistoryModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [selectedReceiptId, setSelectedReceiptId] = useState<string>("");
  const [patients, setPatients] = useState<Patient[]>([]);

  useEffect(() => {
    if (isOpen) {
      loadHistory();
    }
  }, [isOpen]);

  async function loadHistory() {
    const [receiptResult, patientResult] = await Promise.all([
      supabase.from("receipts").select("*").order("created_at", { ascending: false }),
      supabase.from("patients").select("id, name, phone, patient_number"),
    ]);

    setReceipts((receiptResult.data as Receipt[]) || []);
    setPatients((patientResult.data as Patient[]) || []);

    if (!selectedReceiptId && receiptResult.data?.length) {
      setSelectedReceiptId(receiptResult.data[0].id);
    }
  }

  function getPatientName(patientId: string) {
    return patients.find((patient) => patient.id === patientId)?.name || "Unknown patient";
  }

  function formatReceiptNo(receipt: Receipt) {
    return receipt.receipt_number ? `#${String(receipt.receipt_number).padStart(5, "0")}` : `#${receipt.id.slice(0, 8)}`;
  }

  return (
    <ModalOverlay isOpen={isOpen} onClose={onClose} title="Receipt History">
      <div className="space-y-3 max-h-[60vh] overflow-y-auto">
        {receipts.map((receipt) => (
          <div key={receipt.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-3 hover:bg-slate-100">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-sm font-semibold text-slate-900">Receipt {formatReceiptNo(receipt)}</p>
                <p className="text-xs text-slate-500">{getPatientName(receipt.patient_id)}</p>
              </div>
              <p className="text-sm font-semibold text-teal-700">AED {Number(receipt.total || 0).toFixed(2)}</p>
            </div>
            <p className="text-xs text-slate-400 mt-1">{receipt.created_at ? new Date(receipt.created_at).toLocaleDateString() : "N/A"}</p>
          </div>
        ))}
        {receipts.length === 0 && <div className="text-center text-sm text-slate-500">No receipts found</div>}
      </div>
    </ModalOverlay>
  );
}

// Treatment History Modal
export function TreatmentHistoryModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [services, setServices] = useState<LookupItem[]>([]);
  const [receiptItems, setReceiptItems] = useState<ReceiptItem[]>([]);
  const [selectedPatientId, setSelectedPatientId] = useState<string>("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (isOpen) {
      loadHistory();
    }
  }, [isOpen]);

  async function loadHistory() {
    const [patientResult, receiptResult, serviceResult, itemResult] = await Promise.all([
      supabase.from("patients").select("id, name, phone").order("name", { ascending: true }),
      supabase.from("receipts").select("*").order("created_at", { ascending: false }),
      supabase.from("services").select("id, name"),
      supabase.from("receipt_items").select("receipt_id, service_id, quantity, price, total"),
    ]);

    setPatients((patientResult.data as Patient[]) || []);
    setReceipts((receiptResult.data as Receipt[]) || []);
    setServices((serviceResult.data as LookupItem[]) || []);
    setReceiptItems((itemResult.data as ReceiptItem[]) || []);

    if (patientResult.data?.length) {
      setSelectedPatientId(patientResult.data[0].id);
    }
  }

  const filteredPatients = useMemo(() => {
    const search = query.trim().toLowerCase();
    if (!search) return patients;
    return patients.filter((p) => p.name.toLowerCase().includes(search));
  }, [patients, query]);

  const patientVisits = useMemo(() => {
    if (!selectedPatientId) return [];
    return receipts.filter((r) => r.patient_id === selectedPatientId);
  }, [receipts, selectedPatientId]);

  return (
    <ModalOverlay isOpen={isOpen} onClose={onClose} title="Treatment History">
      <div className="grid gap-4 md:grid-cols-[0.8fr_1.2fr] max-h-[60vh]">
        <div className="border-r border-slate-200 pr-4 overflow-y-auto">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search patients..."
            className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm mb-3 outline-none focus:border-teal-400"
          />
          <div className="space-y-2">
            {filteredPatients.map((patient) => (
              <button
                key={patient.id}
                onClick={() => setSelectedPatientId(patient.id)}
                className={`w-full text-left rounded-2xl p-2 text-sm transition ${
                  selectedPatientId === patient.id ? "bg-teal-100 text-teal-900 font-semibold" : "hover:bg-slate-100"
                }`}
              >
                {patient.name}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-y-auto">
          <div className="space-y-2">
            {patientVisits.map((visit) => (
              <div key={visit.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs text-slate-500 font-semibold uppercase">
                  {visit.created_at ? new Date(visit.created_at).toLocaleDateString() : "N/A"}
                </p>
                <div className="mt-2 space-y-1">
                  {receiptItems
                    .filter((item) => item.receipt_id === visit.id)
                    .map((item) => {
                      const service = services.find((s) => s.id === item.service_id);
                      return (
                        <p key={`${item.receipt_id}-${item.service_id}`} className="text-sm text-slate-900">
                          {service?.name || "Service"} x{item.quantity}
                        </p>
                      );
                    })}
                </div>
                <p className="mt-2 text-sm font-semibold text-teal-700">AED {Number(visit.total).toFixed(2)}</p>
              </div>
            ))}
            {patientVisits.length === 0 && <div className="text-center text-sm text-slate-500">No visits recorded</div>}
          </div>
        </div>
      </div>
    </ModalOverlay>
  );
}
