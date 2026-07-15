"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

type Patient = {
  id: string;
  name: string;
  phone: string | null;
  patient_number?: number | null;
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
  discount_amount?: number | null;
  notes: string | null;
  created_at?: string;
};

type LookupItem = {
  id: string;
  name: string;
};

type FullPatient = {
  id: string;
  name: string;
  phone: string | null;
  email?: string | null;
  date_of_birth?: string | null;
  sex?: string | null;
  nationality?: string | null;
  emirates_id?: string | null;
  passport_number?: string | null;
  patient_number?: number | null;
  address?: string | null;
};

type PatientNote = {
  id: string;
  patient_id: string;
  receipt_id: string | null;
  note: string;
  doctor_id: string | null;
  receptionist_id: string | null;
  clinic_id: string | null;
  created_at: string;
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
export function SearchPatientModal({
  isOpen,
  onClose,
  onSelect,
  patients,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (patient: FullPatient) => void;
  patients: FullPatient[];
}) {
  const [view, setView] = useState<"search" | "profile">("search");
  const [query, setQuery] = useState("");
  const [selectedPatient, setSelectedPatient] = useState<FullPatient | null>(null);
  const [notes, setNotes] = useState<PatientNote[]>([]);
  const [doctors, setDoctors] = useState<LookupItem[]>([]);
  const [receptionists, setReceptionists] = useState<LookupItem[]>([]);
  const [clinics, setClinics] = useState<LookupItem[]>([]);
  const [lastVisit, setLastVisit] = useState<string | null>(null);
  const [isLoadingProfile, setIsLoadingProfile] = useState(false);
  const [expandedNoteIds, setExpandedNoteIds] = useState<Set<string>>(new Set());
  const [showAddNote, setShowAddNote] = useState(false);
  const [newNoteText, setNewNoteText] = useState("");
  const [isSavingNote, setIsSavingNote] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setView("search");
      setQuery("");
      setSelectedPatient(null);
      setExpandedNoteIds(new Set());
      setShowAddNote(false);
      setNewNoteText("");
    }
  }, [isOpen]);

  const filteredPatients = useMemo(() => {
    const search = query.trim().toLowerCase();
    if (!search) return patients;
    return patients.filter(
      (p) =>
        p.name.toLowerCase().includes(search) ||
        (p.phone || "").toLowerCase().includes(search) ||
        (p.email || "").toLowerCase().includes(search) ||
        (p.emirates_id || "").toLowerCase().includes(search) ||
        (p.passport_number || "").toLowerCase().includes(search) ||
        String(p.patient_number ?? "").includes(search)
    );
  }, [patients, query]);

  async function openProfile(patient: FullPatient) {
    setSelectedPatient(patient);
    setView("profile");
    setIsLoadingProfile(true);
    setNotes([]);
    setLastVisit(null);
    setShowAddNote(false);
    setNewNoteText("");
    setExpandedNoteIds(new Set());

    const [notesResult, doctorsResult, receptionistsResult, clinicsResult, lastVisitResult] = await Promise.all([
      supabase.from("patient_notes").select("*").eq("patient_id", patient.id).order("created_at", { ascending: false }),
      supabase.from("doctors").select("id, name"),
      supabase.from("receptionist").select("id, name"),
      supabase.from("clinics").select("id, name"),
      supabase.from("receipts").select("created_at").eq("patient_id", patient.id).order("created_at", { ascending: false }).limit(1),
    ]);

    setNotes((notesResult.data as PatientNote[]) || []);
    setDoctors((doctorsResult.data as LookupItem[]) || []);
    setReceptionists((receptionistsResult.data as LookupItem[]) || []);
    setClinics((clinicsResult.data as LookupItem[]) || []);
    setLastVisit(lastVisitResult.data?.[0]?.created_at || null);
    setIsLoadingProfile(false);
  }

  function toggleNote(id: string) {
    setExpandedNoteIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function saveNewNote() {
    if (!newNoteText.trim() || !selectedPatient) return;
    setIsSavingNote(true);
    const { error } = await supabase.from("patient_notes").insert({
      patient_id: selectedPatient.id,
      note: newNoteText.trim(),
    });
    if (!error) {
      const { data } = await supabase
        .from("patient_notes")
        .select("*")
        .eq("patient_id", selectedPatient.id)
        .order("created_at", { ascending: false });
      setNotes((data as PatientNote[]) || []);
      setNewNoteText("");
      setShowAddNote(false);
    }
    setIsSavingNote(false);
  }

  function calcAge(dob: string | null | undefined): number | null {
    if (!dob) return null;
    const today = new Date();
    const birth = new Date(dob);
    let age = today.getFullYear() - birth.getFullYear();
    const m = today.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
    return age;
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="relative flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-teal-100 bg-white shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between border-b border-teal-100 bg-white px-6 py-4">
          {view === "profile" ? (
            <button
              onClick={() => setView("search")}
              className="flex items-center gap-1.5 text-sm font-semibold text-teal-600 transition hover:text-teal-800"
            >
              ← Back to Search
            </button>
          ) : (
            <h2 className="text-lg font-semibold text-slate-900">Search Patients</h2>
          )}
          <button onClick={onClose} className="text-2xl text-slate-400 hover:text-slate-600">×</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">

          {/* ── SEARCH VIEW ── */}
          {view === "search" && (
            <div className="space-y-4">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by name, phone, email, Emirates ID, passport…"
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-teal-400 focus:ring-4 focus:ring-teal-100"
                autoFocus
              />
              <div className="space-y-2">
                {filteredPatients.length === 0 && (
                  <p className="py-6 text-center text-sm text-slate-400">No patients found</p>
                )}
                {filteredPatients.map((patient) => (
                  <button
                    key={patient.id}
                    onClick={() => openProfile(patient)}
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 p-3 text-left transition hover:border-teal-200 hover:bg-teal-50"
                  >
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold text-slate-900">{patient.name}</p>
                      {patient.patient_number != null && (
                        <span className="rounded-full bg-teal-100 px-2 py-0.5 text-xs font-semibold text-teal-700">
                          #{patient.patient_number}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500">{patient.phone || "No phone"}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── PROFILE VIEW ── */}
          {view === "profile" && selectedPatient && (
            <div className="space-y-6">

              {/* Demographics card */}
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="mb-3">
                  <h3 className="text-lg font-bold text-slate-900">{selectedPatient.name}</h3>
                  {selectedPatient.patient_number != null && (
                    <span className="text-xs font-semibold text-teal-600">Patient #{selectedPatient.patient_number}</span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                  {calcAge(selectedPatient.date_of_birth) !== null && (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Age</p>
                      <p className="text-slate-800">{calcAge(selectedPatient.date_of_birth)} yrs</p>
                    </div>
                  )}
                  {selectedPatient.sex && (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Gender</p>
                      <p className="text-slate-800">{selectedPatient.sex}</p>
                    </div>
                  )}
                  {selectedPatient.nationality && (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Nationality</p>
                      <p className="text-slate-800">{selectedPatient.nationality}</p>
                    </div>
                  )}
                  {selectedPatient.phone && (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Mobile</p>
                      <p className="text-slate-800">{selectedPatient.phone}</p>
                    </div>
                  )}
                  {selectedPatient.email && (
                    <div className="col-span-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Email</p>
                      <p className="break-all text-slate-800">{selectedPatient.email}</p>
                    </div>
                  )}
                  {selectedPatient.address && (
                    <div className="col-span-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Address</p>
                      <p className="text-slate-800">{selectedPatient.address}</p>
                    </div>
                  )}
                  {selectedPatient.emirates_id && (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Emirates ID</p>
                      <p className="text-slate-800">{selectedPatient.emirates_id}</p>
                    </div>
                  )}
                  {selectedPatient.passport_number && (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Passport No.</p>
                      <p className="text-slate-800">{selectedPatient.passport_number}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Last Visit</p>
                    <p className="text-slate-800">
                      {lastVisit
                        ? new Date(lastVisit).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
                        : isLoadingProfile ? "…" : "No visits yet"}
                    </p>
                  </div>
                </div>
              </div>

              {/* Clinical Notes */}
              <div>
                <div className="mb-3 flex items-center justify-between">
                  <h4 className="text-sm font-bold uppercase tracking-wide text-slate-700">Clinical Notes</h4>
                  {!showAddNote && (
                    <button
                      onClick={() => setShowAddNote(true)}
                      className="rounded-xl bg-teal-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-teal-400"
                    >
                      + Add Note
                    </button>
                  )}
                </div>

                {showAddNote && (
                  <div className="mb-4 space-y-3 rounded-2xl border border-teal-200 bg-teal-50 p-4">
                    <textarea
                      value={newNoteText}
                      onChange={(e) => setNewNoteText(e.target.value)}
                      placeholder="Enter clinical note…"
                      rows={3}
                      autoFocus
                      className="w-full resize-none rounded-xl border border-teal-200 bg-white px-3 py-2 text-sm outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={saveNewNote}
                        disabled={isSavingNote || !newNoteText.trim()}
                        className="rounded-xl bg-teal-500 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-teal-400 disabled:opacity-50"
                      >
                        {isSavingNote ? "Saving…" : "Save Note"}
                      </button>
                      <button
                        onClick={() => { setShowAddNote(false); setNewNoteText(""); }}
                        className="rounded-xl border border-slate-200 px-4 py-1.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-100"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {isLoadingProfile ? (
                  <p className="py-4 text-center text-sm text-slate-400">Loading…</p>
                ) : notes.length === 0 ? (
                  <p className="py-4 text-center text-sm text-slate-400">No clinical notes yet</p>
                ) : (
                  <div className="space-y-3">
                    {notes.map((note) => {
                      const doctor = doctors.find((d) => d.id === note.doctor_id);
                      const receptionist = receptionists.find((r) => r.id === note.receptionist_id);
                      const clinic = clinics.find((c) => c.id === note.clinic_id);
                      const isExpanded = expandedNoteIds.has(note.id);
                      const isLong = note.note.length > 160;
                      const contextLine = [clinic?.name, doctor ? `Dr. ${doctor.name}` : null, receptionist?.name]
                        .filter(Boolean)
                        .join(" · ");
                      return (
                        <div key={note.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                          <p className="mb-1 text-xs font-semibold text-slate-500">
                            {new Date(note.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                            {" · "}
                            {new Date(note.created_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                          </p>
                          {contextLine && (
                            <p className="mb-2 text-xs text-slate-400">{contextLine}</p>
                          )}
                          <p className={`whitespace-pre-wrap text-sm text-slate-800 ${!isExpanded && isLong ? "line-clamp-3" : ""}`}>
                            {note.note}
                          </p>
                          {isLong && (
                            <button
                              onClick={() => toggleNote(note.id)}
                              className="mt-1 text-xs font-semibold text-teal-600 transition hover:text-teal-800"
                            >
                              {isExpanded ? "Show less" : "Show more"}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer — profile view only */}
        {view === "profile" && selectedPatient && (
          <div className="flex gap-3 border-t border-slate-100 bg-white px-6 py-4">
            <button
              onClick={() => { onSelect(selectedPatient); onClose(); }}
              className="flex-1 rounded-2xl bg-teal-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-teal-400"
            >
              Select Patient
            </button>
            <button
              onClick={onClose}
              className="rounded-2xl border border-slate-200 px-6 py-3 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
            >
              Close
            </button>
          </div>
        )}

      </div>
    </div>
  );
}

// Receipt History Modal
export function ReceiptHistoryModal({
  isOpen,
  onClose,
  clinicId,
  clinic,
}: {
  isOpen: boolean;
  onClose: () => void;
  clinicId: string | null | undefined;
  clinic: Clinic | null;
}) {
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [services, setServices] = useState<LookupItem[]>([]);
  const [doctors, setDoctors] = useState<LookupItem[]>([]);
  const [allReceptionists, setAllReceptionists] = useState<LookupItem[]>([]);
  const [receiptItemsMap, setReceiptItemsMap] = useState<Record<string, any[]>>({});
  const [refundsMap, setRefundsMap] = useState<Record<string, any[]>>({});
  const [expandedReceiptId, setExpandedReceiptId] = useState<string | null>(null);
  const [loadingItemsFor, setLoadingItemsFor] = useState<string | null>(null);

  const [view, setView] = useState<"list" | "refund">("list");
  const [refundTargetReceipt, setRefundTargetReceipt] = useState<Receipt | null>(null);
  const [refundItems, setRefundItems] = useState<any[]>([]);
  const [checkedItems, setCheckedItems] = useState<Record<string, boolean>>({});
  const [refundAll, setRefundAll] = useState(false);
  const [refundReason, setRefundReason] = useState("");
  const [isProcessingRefund, setIsProcessingRefund] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setView("list");
      setExpandedReceiptId(null);
      setReceiptItemsMap({});
      setRefundsMap({});
      loadHistory();
    }
  }, [isOpen]);

  async function loadHistory() {
    if (!clinicId) {
      setReceipts([]);
      setPatients([]);
      return;
    }

    const { data: clinicReceptionists } = await supabase
      .from("receptionist")
      .select("id")
      .eq("clinic_id", clinicId);

    const receptionistIds = (clinicReceptionists || []).map((r: { id: string }) => r.id);

    if (receptionistIds.length === 0) {
      setReceipts([]);
      setPatients([]);
      return;
    }

    const [receiptResult, patientResult, servicesResult, doctorsResult, receptionistsResult] = await Promise.all([
      supabase.from("receipts").select("*").in("receptionist_id", receptionistIds).order("created_at", { ascending: false }),
      supabase.from("patients").select("id, name, phone, patient_number"),
      supabase.from("services").select("id, name"),
      supabase.from("doctors").select("id, name"),
      supabase.from("receptionist").select("id, name"),
    ]);

    setReceipts((receiptResult.data as Receipt[]) || []);
    setPatients((patientResult.data as Patient[]) || []);
    setServices((servicesResult.data as LookupItem[]) || []);
    setDoctors((doctorsResult.data as LookupItem[]) || []);
    setAllReceptionists((receptionistsResult.data as LookupItem[]) || []);
  }

  async function loadReceiptItems(receiptId: string) {
    if (receiptItemsMap[receiptId]) return;
    setLoadingItemsFor(receiptId);
    const [itemsRes, refundsRes] = await Promise.all([
      supabase.from("receipt_items").select("*").eq("receipt_id", receiptId),
      supabase.from("refunds").select("*").eq("receipt_id", receiptId).order("created_at", { ascending: false }),
    ]);
    setReceiptItemsMap((prev) => ({ ...prev, [receiptId]: itemsRes.data || [] }));
    setRefundsMap((prev) => ({ ...prev, [receiptId]: refundsRes.data || [] }));
    setLoadingItemsFor(null);
  }

  function toggleExpand(receiptId: string) {
    if (expandedReceiptId === receiptId) {
      setExpandedReceiptId(null);
    } else {
      setExpandedReceiptId(receiptId);
      loadReceiptItems(receiptId);
    }
  }

  function startRefund(receipt: Receipt) {
    setRefundTargetReceipt(receipt);
    setRefundItems(receiptItemsMap[receipt.id] || []);
    setCheckedItems({});
    setRefundAll(false);
    setRefundReason("");
    setView("refund");
  }

  function calcRefundTotal(): number {
    if (!refundTargetReceipt) return 0;
    if (refundAll) return Number(refundTargetReceipt.total || 0);
    const itemsToRefund = refundItems.filter((i) => checkedItems[i.id]);
    const receiptVat = Number(refundTargetReceipt.vat || 0);
    const receiptSubtotal = Number(refundTargetReceipt.subtotal || 0);
    const sub = itemsToRefund.reduce((s, i) => s + Number(i.total || i.price || 0), 0);
    const proportionalVat = receiptSubtotal > 0 ? (sub / receiptSubtotal) * receiptVat : 0;
    return Math.round((sub + proportionalVat) * 100) / 100;
  }

  async function processRefund() {
    if (!refundTargetReceipt) return;
    if (!refundReason.trim()) { alert("Please enter a reason."); return; }
    const itemsToRefund = refundAll ? refundItems : refundItems.filter((i) => checkedItems[i.id]);
    if (!refundAll && itemsToRefund.length === 0) { alert("Select at least one item."); return; }

    setIsProcessingRefund(true);
    const totalRefund = calcRefundTotal();

    const { data: refundData, error: refundError } = await supabase
      .from("refunds")
      .insert([{
        receipt_id: refundTargetReceipt.id,
        receptionist_id: refundTargetReceipt.receptionist_id,
        refunded_by: null,
        reason: refundReason.trim(),
        total_amount: totalRefund,
        payment_method: refundTargetReceipt.payment_method,
      }])
      .select()
      .single();

    if (refundError || !refundData) {
      alert(`Error: ${refundError?.message || "unknown"}`);
      setIsProcessingRefund(false);
      return;
    }

    if (itemsToRefund.length > 0) {
      await supabase.from("refund_items").insert(
        itemsToRefund.map((item) => ({
          refund_id: refundData.id,
          receipt_item_id: item.id,
          service_id: item.service_id,
          service_name: services.find((s) => s.id === item.service_id)?.name || "Unknown",
          amount: Number(item.total || item.price || 0),
        }))
      );
    }

    setRefundsMap((prev) => ({
      ...prev,
      [refundTargetReceipt.id]: [refundData, ...(prev[refundTargetReceipt.id] || [])],
    }));
    setIsProcessingRefund(false);
    setView("list");
    alert(`Refund of AED ${totalRefund.toFixed(2)} processed successfully.`);
  }

  function reprintReceipt(receipt: Receipt) {
    const logoPath = clinic?.logo === "altamuze" ? "/images/logo5.jpg" : "/images/logo6.jpg";
    const clinicDisplayName = clinic?.name?.toUpperCase() || "SKIN & SMILE DENTAL CLINIC";
    const clinicAddress = clinic?.address || "Al Satwa, Dubai, UAE";
    const clinicRoom = clinic?.room ? `2nd Floor, Room ${clinic.room.replace(/^Room\s+/i, "")}` : "";
    const clinicTrn = clinic?.trn || "";
    const clinicPhone = clinic?.phone || "";
    const clinicWhatsapp = clinic?.whatsapp || "";
    const isSkinAndSmile = !clinic || clinic.logo !== "altamuze";

    const receiptDate = receipt.created_at ? new Date(receipt.created_at) : new Date();
    const dateValue = receiptDate.toLocaleDateString("en-GB");
    const timeValue = receiptDate.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
    const invoiceNo = receipt.receipt_number
      ? `#${String(receipt.receipt_number).padStart(5, "0")}`
      : `#${receipt.id.slice(0, 8)}`;

    const patient = patients.find((p) => p.id === receipt.patient_id);
    const patientName = patient?.name || "-";
    const patientPhone = patient?.phone || "-";
    const patientIdStr = patient?.patient_number
      ? `#${String(patient.patient_number).padStart(5, "0")}`
      : "-";
    const doctorName = doctors.find((d) => d.id === receipt.doctor_id)?.name || "-";
    const cashierName = allReceptionists.find((r) => r.id === receipt.receptionist_id)?.name || "Reception";

    const items = receiptItemsMap[receipt.id] || [];
    const itemsHtml = items.map((item) => {
      const name = services.find((s) => s.id === item.service_id)?.name || "Service";
      return `<div class="row item-row"><span class="item-name">${name}</span><span class="amount">AED ${Number(item.total || item.price || 0).toFixed(2)}</span></div>`;
    }).join("");

    const subtotal = Number(receipt.subtotal || 0);
    const vatAmount = Number(receipt.vat || 0);
    const total = Number(receipt.total || 0);
    const discountAmount = Number(receipt.discount_amount || 0);

    const html = `<!doctype html><html><head><meta charset="utf-8"/><title>Reprint</title><style>
      *{box-sizing:border-box;}
      body{font-family:Arial,Helvetica,sans-serif;width:72mm;margin:0;padding:2mm;font-size:10px;line-height:1.25;color:#000;background:#fff;overflow-x:hidden;-webkit-text-size-adjust:100%;font-weight:500;}
      .center{text-align:center;}.hr{border-top:1px dashed #000;margin:5px 0;}
      .double{border-top:2px solid #000;border-bottom:2px solid #000;padding:3px 0;margin:5px 0;text-align:center;font-weight:700;}
      .logo-wrap{display:flex;justify-content:center;margin-bottom:4px;}.logo{max-width:48mm;max-height:26mm;object-fit:contain;}
      .clinic-name{text-align:center;font-size:14px;font-weight:700;line-height:1.1;}.address{text-align:center;font-size:9px;line-height:1.25;margin-top:4px;}
      .row{display:flex;justify-content:space-between;gap:6px;margin:1px 0;}.row span:first-child{min-width:30mm;}
      .row span:last-child{text-align:right;flex:1;min-width:0;overflow-wrap:anywhere;word-break:break-word;}
      .head-row{display:flex;justify-content:space-between;font-weight:700;}.item-row{margin:2px 0;}
      .item-name{flex:1;min-width:0;overflow-wrap:anywhere;}.amount{text-align:right;white-space:nowrap;}
      .footer-center{text-align:center;margin-top:4px;}.reprint-badge{text-align:center;font-size:9px;font-weight:700;letter-spacing:2px;color:#555;margin:4px 0;}
      @media print{@page{size:80mm auto;margin:0;}body{width:72mm;}*{color:#000!important;border-color:#000!important;background-color:#fff!important;}.logo{width:100%;max-width:66mm;height:auto;}}
    </style></head><body>
      <div class="logo-wrap" id="logo-wrap"><img src="${logoPath}" alt="logo" class="logo" onerror="document.getElementById('logo-wrap').style.display='none'"/></div>
      <div class="double">TAX INVOICE</div>
      <div class="reprint-badge">*** REPRINT ***</div>
      <div class="clinic-name">${clinicDisplayName}</div>
      <div class="address">
        ${clinicAddress.split(/\\n|\n/).map((l: string) => `<div>${l}</div>`).join("")}
        ${clinicRoom ? `<div>${clinicRoom}</div>` : ""}
        ${clinicTrn ? `<div style="margin-top:2px;font-weight:700;">TRN: ${clinicTrn}</div>` : ""}
      </div>
      <div class="hr"></div>
      <div class="row"><span>Invoice No / رقم الفاتورة</span><span>: ${invoiceNo}</span></div>
      <div class="row"><span>Date / التاريخ</span><span>: ${dateValue}</span></div>
      <div class="row"><span>Time / الوقت</span><span>: ${timeValue}</span></div>
      <div class="row"><span>Cashier / أمين الصندوق</span><span>: ${cashierName}</span></div>
      <div class="row"><span>Doctor / الطبيب</span><span>: ${doctorName}</span></div>
      <div class="row"><span>Patient Name / اسم المريض</span><span>: ${patientName}</span></div>
      <div class="row"><span>Patient ID / معرف المريض</span><span>: ${patientIdStr}</span></div>
      <div class="row"><span>Mobile / الهاتف</span><span>: ${patientPhone}</span></div>
      <div class="hr"></div>
      <div class="head-row"><span>DESCRIPTION / الوصف</span><span>AMOUNT / المبلغ</span></div>
      <div class="hr" style="margin-top:2px;"></div>
      ${itemsHtml || '<div class="center">No services</div>'}
      <div class="hr"></div>
      <div class="row"><span>Subtotal / الإجمالي الجزئي</span><span>AED ${subtotal.toFixed(2)}</span></div>
      ${discountAmount > 0 ? `<div class="row"><span>Discount / خصم</span><span>- AED ${discountAmount.toFixed(2)}</span></div>` : ""}
      <div class="row"><span>VAT</span><span>AED ${vatAmount.toFixed(2)}</span></div>
      <div class="hr" style="margin:4px 0;"></div>
      <div class="row" style="font-weight:700;"><span>TOTAL / الإجمالي</span><span>AED ${total.toFixed(2)}</span></div>
      <div class="hr"></div>
      <div class="row"><span>Payment Method / طريقة الدفع</span><span>: ${(receipt.payment_method || "-").toUpperCase()}</span></div>
      <div class="row"><span>Amount Paid / المبلغ المدفوع</span><span>: AED ${total.toFixed(2)}</span></div>
      ${receipt.notes ? `<div style="margin-top:4px;">Note / ملاحظة: ${receipt.notes}</div>` : ""}
      <div class="hr"></div>
      <div class="footer-center">VAT Included in Above Amount / الضريبة مشمولة في المبلغ أعلاه</div>
      <div class="footer-center">Thank you for visiting us / شكراً لزيارتك لنا</div>
      ${isSkinAndSmile ? `<div class="footer-center" style="margin-top:6px;">Follow us:</div><div class="footer-center">Instagram: @skinandsmiledentalclinic</div><div class="footer-center">TikTok: @skinandsmile</div>` : ""}
      <div class="hr"></div>
      <div style="text-align:center;font-size:9px;line-height:1.4;">
        ${clinicPhone ? `<div>Phone: ${clinicPhone}</div>` : ""}
        ${clinicWhatsapp ? `<div>WhatsApp: ${clinicWhatsapp}</div>` : ""}
      </div>
      <div class="hr"></div>
      <div class="double">Thank you for Visiting US!</div>
    </body></html>`;

    const w = window.open("", "_blank", "width=400,height=600");
    if (!w) { alert("Please allow popups to print."); return; }
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 500);
  }

  function formatReceiptNo(receipt: Receipt) {
    return receipt.receipt_number ? `#${String(receipt.receipt_number).padStart(5, "0")}` : `#${receipt.id.slice(0, 8)}`;
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="relative flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-teal-100 bg-white shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between border-b border-teal-100 bg-white px-6 py-4">
          {view === "refund" ? (
            <>
              <button
                onClick={() => setView("list")}
                className="flex items-center gap-1.5 text-sm font-semibold text-teal-600 transition hover:text-teal-800"
              >
                ← Back
              </button>
              <h2 className="text-base font-semibold text-slate-900">Process Refund</h2>
            </>
          ) : (
            <h2 className="text-lg font-semibold text-slate-900">Receipt History</h2>
          )}
          <button onClick={onClose} className="text-2xl text-slate-400 hover:text-slate-600">×</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">

          {/* ── LIST VIEW ── */}
          {view === "list" && (
            <div className="space-y-3">
              {!clinicId ? (
                <p className="text-center text-sm text-slate-500">Open the register to view receipt history.</p>
              ) : receipts.length === 0 ? (
                <p className="text-center text-sm text-slate-500">No receipts found</p>
              ) : receipts.map((receipt) => {
                const isExpanded = expandedReceiptId === receipt.id;
                const patient = patients.find((p) => p.id === receipt.patient_id);
                const items = receiptItemsMap[receipt.id];
                const refundsList = refundsMap[receipt.id];
                const isLoading = loadingItemsFor === receipt.id;
                const hasRefund = refundsList && refundsList.length > 0;

                return (
                  <div key={receipt.id} className={`overflow-hidden rounded-2xl border bg-white transition ${isExpanded ? "border-teal-200 shadow-sm" : "border-slate-200"}`}>
                    <button onClick={() => toggleExpand(receipt.id)} className="w-full p-4 text-left hover:bg-slate-50">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-slate-900">{formatReceiptNo(receipt)}</span>
                          {hasRefund && (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">Refunded</span>
                          )}
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-bold text-teal-700">AED {Number(receipt.total || 0).toFixed(2)}</span>
                          <span className="text-xs text-slate-400">{isExpanded ? "▲" : "▼"}</span>
                        </div>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-2 text-xs text-slate-500">
                        <span>{patient?.name || "Unknown patient"}</span>
                        <span>·</span>
                        <span>{receipt.created_at ? new Date(receipt.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "N/A"}</span>
                        <span>·</span>
                        <span>{(receipt.payment_method || "–").toUpperCase()}</span>
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="border-t border-slate-100 bg-slate-50 px-4 pb-4">
                        {isLoading ? (
                          <p className="py-4 text-center text-xs text-slate-400">Loading items…</p>
                        ) : items ? (
                          <>
                            <div className="py-3 space-y-1.5">
                              {items.length === 0 ? (
                                <p className="text-xs text-slate-400">No items recorded</p>
                              ) : items.map((item: any) => (
                                <div key={item.id} className="flex justify-between text-sm">
                                  <span className="text-slate-700">{services.find((s) => s.id === item.service_id)?.name || "Service"}</span>
                                  <span className="font-medium text-slate-900">AED {Number(item.total || item.price || 0).toFixed(2)}</span>
                                </div>
                              ))}
                            </div>

                            {refundsList && refundsList.length > 0 && (
                              <div className="mb-3 space-y-1">
                                {refundsList.map((r: any) => (
                                  <div key={r.id} className="flex items-center justify-between rounded-xl bg-amber-50 px-3 py-2 text-xs">
                                    <span className="font-semibold text-amber-700">Refund: {r.reason || "–"}</span>
                                    <span className="font-bold text-amber-800">AED {Number(r.total_amount || 0).toFixed(2)}</span>
                                  </div>
                                ))}
                              </div>
                            )}

                            <div className="flex gap-2 pt-1">
                              <button
                                onClick={() => reprintReceipt(receipt)}
                                className="flex-1 rounded-xl bg-slate-700 px-3 py-2 text-xs font-semibold text-white transition hover:bg-slate-600"
                              >
                                Reprint
                              </button>
                              <button
                                onClick={() => startRefund(receipt)}
                                disabled={hasRefund}
                                className="flex-1 rounded-xl bg-amber-500 px-3 py-2 text-xs font-semibold text-white transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                Refund
                              </button>
                            </div>
                          </>
                        ) : null}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* ── REFUND VIEW ── */}
          {view === "refund" && refundTargetReceipt && (
            <div className="space-y-5">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-sm font-bold text-slate-900">{formatReceiptNo(refundTargetReceipt)}</p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {patients.find((p) => p.id === refundTargetReceipt.patient_id)?.name || "Unknown patient"}
                  {" · "}
                  {refundTargetReceipt.created_at ? new Date(refundTargetReceipt.created_at).toLocaleDateString("en-GB") : "N/A"}
                  {" · Total: AED "}
                  {Number(refundTargetReceipt.total || 0).toFixed(2)}
                </p>
              </div>

              <label className="flex cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  checked={refundAll}
                  onChange={(e) => { setRefundAll(e.target.checked); setCheckedItems({}); }}
                  className="h-4 w-4 rounded accent-teal-500"
                />
                <span className="text-sm font-semibold text-slate-700">Refund full amount</span>
              </label>

              {!refundAll && (
                <div className="space-y-2">
                  {refundItems.map((item) => (
                    <label key={item.id} className="flex cursor-pointer items-center justify-between rounded-2xl border border-slate-200 bg-white p-3 hover:bg-slate-50">
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={!!checkedItems[item.id]}
                          onChange={(e) => setCheckedItems((prev) => ({ ...prev, [item.id]: e.target.checked }))}
                          className="h-4 w-4 rounded accent-teal-500"
                        />
                        <span className="text-sm text-slate-800">{services.find((s) => s.id === item.service_id)?.name || "Service"}</span>
                      </div>
                      <span className="text-sm font-semibold text-slate-900">AED {Number(item.total || item.price || 0).toFixed(2)}</span>
                    </label>
                  ))}
                </div>
              )}

              <div className="flex justify-between rounded-2xl border border-teal-200 bg-teal-50 px-4 py-3">
                <span className="text-sm font-bold text-teal-800">Refund Total</span>
                <span className="text-sm font-bold text-teal-800">AED {calcRefundTotal().toFixed(2)}</span>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">Reason (required)</label>
                <textarea
                  value={refundReason}
                  onChange={(e) => setRefundReason(e.target.value)}
                  placeholder="Enter refund reason…"
                  rows={3}
                  className="w-full resize-none rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
                />
              </div>

              <div className="flex gap-3">
                <button
                  onClick={processRefund}
                  disabled={isProcessingRefund || !refundReason.trim() || (!refundAll && Object.values(checkedItems).filter(Boolean).length === 0)}
                  className="flex-1 rounded-2xl bg-amber-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-amber-400 disabled:opacity-50"
                >
                  {isProcessingRefund ? "Processing…" : "Process Refund"}
                </button>
                <button
                  onClick={() => setView("list")}
                  className="rounded-2xl border border-slate-200 px-6 py-3 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
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
