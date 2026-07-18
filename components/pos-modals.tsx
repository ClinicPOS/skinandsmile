"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { receptionistIdsForClinic } from "../lib/clinic-scope";
import type {
  OutstandingBalance,
  BalancePayment,
  PatientCredit,
  TreatmentPlan,
  TreatmentPlanPayment,
  TreatmentPlanVisit,
  Clinic as ClinicRecord,
  Patient as PatientRecord,
} from "../lib/types";
import { rollupBalance, formatBalanceReference } from "../lib/outstanding-balances";
import { availableCredit } from "../lib/patient-credits";
import { ReceiveDepositModal } from "./patient-credit-modals";
import { EditPatientModal } from "./edit-patient-modal";

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
  amount_paid?: number | null;
  credit_applied?: number | null;
  gateway_fee?: number | null;
  gateway_fee_provider?: string | null;
  discount_amount?: number | null;
  notes: string | null;
  created_at?: string;
};

const TREATMENT_PLAN_PAYMENT_METHODS = ["Cash", "Card", "Visa", "Mastercard", "Tabby", "Tabby Card", "Tamara", "Tamara Card", "Bank Transfer"];

type LookupItem = {
  id: string;
  name: string;
  price?: number | null;
  clinic_id?: string | null;
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
  mrn?: string | null;
  notes?: string | null;
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

type ProfileSectionKey = "plans" | "outstanding" | "credits" | "clinical" | "treatment";

type Clinic = {
  id: string;
  name: string;
  address?: string | null;
  room?: string | null;
  trn?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  instagram?: string | null;
  facebook?: string | null;
  tiktok?: string | null;
  receipt_print_name?: string | null;
  receipt_title?: string | null;
  receipt_vat_note?: string | null;
  receipt_thank_you?: string | null;
  receipt_final_message?: string | null;
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
  clinicId,
  outstandingBalances = [],
  balancePayments = [],
  patientCredits = [],
  clinicsList = [],
  clinic = null,
  receptionistId = null,
  receptionistName = "Reception",
  registerSessionId = null,
  onCollectBalance,
  onCreditSaved,
  onPatientUpdated,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (patient: FullPatient) => void;
  patients: FullPatient[];
  clinicId?: string | null;
  outstandingBalances?: OutstandingBalance[];
  balancePayments?: BalancePayment[];
  patientCredits?: PatientCredit[];
  clinicsList?: Clinic[];
  clinic?: ClinicRecord | null;
  receptionistId?: string | null;
  receptionistName?: string;
  registerSessionId?: string | null;
  onCollectBalance?: (payload: { balance: OutstandingBalance; payments: BalancePayment[]; patient: FullPatient }) => void;
  onCreditSaved?: (credit: PatientCredit) => void;
  onPatientUpdated?: (patient: FullPatient) => void;
}) {
  const [view, setView] = useState<"search" | "profile">("search");
  const [query, setQuery] = useState("");
  const [selectedPatient, setSelectedPatient] = useState<FullPatient | null>(null);
  const [showDepositModal, setShowDepositModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [notes, setNotes] = useState<PatientNote[]>([]);
  const [profileReceipts, setProfileReceipts] = useState<Receipt[]>([]);
  const [profileReceiptItems, setProfileReceiptItems] = useState<ReceiptItem[]>([]);
  const [profileServices, setProfileServices] = useState<LookupItem[]>([]);
  const [treatmentPlans, setTreatmentPlans] = useState<TreatmentPlan[]>([]);
  const [treatmentPlanVisits, setTreatmentPlanVisits] = useState<TreatmentPlanVisit[]>([]);
  const [treatmentPlanPayments, setTreatmentPlanPayments] = useState<TreatmentPlanPayment[]>([]);
  const [doctors, setDoctors] = useState<LookupItem[]>([]);
  const [receptionists, setReceptionists] = useState<LookupItem[]>([]);
  const [clinics, setClinics] = useState<LookupItem[]>([]);
  const [lastVisit, setLastVisit] = useState<string | null>(null);
  const [isLoadingProfile, setIsLoadingProfile] = useState(false);
  const [expandedNoteIds, setExpandedNoteIds] = useState<Set<string>>(new Set());
  const [showAddNote, setShowAddNote] = useState(false);
  const [newNoteText, setNewNoteText] = useState("");
  const [isSavingNote, setIsSavingNote] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNoteText, setEditingNoteText] = useState("");
  const [expandedProfileSections, setExpandedProfileSections] = useState<Set<ProfileSectionKey>>(new Set());
  const [showNewTreatmentPlan, setShowNewTreatmentPlan] = useState(false);
  const [newPlanServiceId, setNewPlanServiceId] = useState("");
  const [newPlanTitle, setNewPlanTitle] = useState("");
  const [newPlanAmount, setNewPlanAmount] = useState("");
  const [newPlanVisits, setNewPlanVisits] = useState("5");
  const [newPlanNotes, setNewPlanNotes] = useState("");
  const [savingTreatmentPlan, setSavingTreatmentPlan] = useState(false);
  const [visitPlanId, setVisitPlanId] = useState<string | null>(null);
  const [visitDoctorId, setVisitDoctorId] = useState("");
  const [visitNotes, setVisitNotes] = useState("");
  const [savingTreatmentVisit, setSavingTreatmentVisit] = useState(false);
  const [paymentPlanId, setPaymentPlanId] = useState<string | null>(null);
  const [planPaymentAmount, setPlanPaymentAmount] = useState("");
  const [planPaymentMethod, setPlanPaymentMethod] = useState("Cash");
  const [planPaymentNotes, setPlanPaymentNotes] = useState("");
  const [savingTreatmentPayment, setSavingTreatmentPayment] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setView("search");
      setQuery("");
      setSelectedPatient(null);
      setExpandedNoteIds(new Set());
      setShowAddNote(false);
      setNewNoteText("");
      setShowDepositModal(false);
      setShowEditModal(false);
      setExpandedProfileSections(new Set());
      resetTreatmentPlanForms();
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

  const paymentsByBalanceId = useMemo(() => {
    const map = new Map<string, BalancePayment[]>();
    for (const p of balancePayments) {
      const arr = map.get(p.outstanding_balance_id) || [];
      arr.push(p);
      map.set(p.outstanding_balance_id, arr);
    }
    return map;
  }, [balancePayments]);

  const outstandingByPatient = useMemo(() => {
    const map = new Map<string, { remaining: number; count: number }>();
    for (const b of outstandingBalances) {
      const roll = rollupBalance(b, paymentsByBalanceId.get(b.id) || []);
      if (roll.remaining <= 0.0049) continue;
      const prev = map.get(b.patient_id) || { remaining: 0, count: 0 };
      map.set(b.patient_id, {
        remaining: prev.remaining + roll.remaining,
        count: prev.count + 1,
      });
    }
    return map;
  }, [outstandingBalances, paymentsByBalanceId]);

  const selectedPatientBalances = useMemo(() => {
    if (!selectedPatient) return [];
    return outstandingBalances
      .filter((b) => b.patient_id === selectedPatient.id)
      .sort((a, b) => (a.original_date < b.original_date ? 1 : -1));
  }, [outstandingBalances, selectedPatient]);

  // Total still owed by the selected patient across all clinics — shown in the
  // profile header alongside available credit.
  const selectedPatientOutstandingTotal = useMemo(() => {
    return selectedPatientBalances.reduce(
      (sum, b) => sum + rollupBalance(b, paymentsByBalanceId.get(b.id) || []).remaining,
      0
    );
  }, [selectedPatientBalances, paymentsByBalanceId]);

  const selectedPatientCredits = useMemo(() => {
    if (!selectedPatient) return [];
    return patientCredits
      .filter((c) => c.patient_id === selectedPatient.id)
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  }, [patientCredits, selectedPatient]);

  const selectedPatientAvailableCredit = useMemo(
    () => availableCredit(selectedPatientCredits),
    [selectedPatientCredits]
  );

  const clinicNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of clinicsList) map.set(c.id, c.name);
    return map;
  }, [clinicsList]);

  const clinicServiceOptions = useMemo(() => {
    return profileServices
      .filter((service) => !clinicId || !service.clinic_id || service.clinic_id === clinicId)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [profileServices, clinicId]);

  const treatmentPlanPaymentsByPlanId = useMemo(() => {
    const map = new Map<string, TreatmentPlanPayment[]>();
    for (const payment of treatmentPlanPayments) {
      const list = map.get(payment.treatment_plan_id) || [];
      list.push(payment);
      map.set(payment.treatment_plan_id, list);
    }
    return map;
  }, [treatmentPlanPayments]);

  const treatmentPlanVisitsByPlanId = useMemo(() => {
    const map = new Map<string, TreatmentPlanVisit[]>();
    for (const visit of treatmentPlanVisits) {
      const list = map.get(visit.treatment_plan_id) || [];
      list.push(visit);
      map.set(visit.treatment_plan_id, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => b.visit_number - a.visit_number);
    }
    return map;
  }, [treatmentPlanVisits]);

  const treatmentPlanSummary = useMemo(() => {
    return treatmentPlans.reduce(
      (summary, plan) => {
        const paid = (treatmentPlanPaymentsByPlanId.get(plan.id) || []).reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
        const remaining = Math.max(0, Number(plan.total_amount || 0) - paid);
        const visits = treatmentPlanVisitsByPlanId.get(plan.id)?.length || 0;
        summary.totalRemaining += remaining;
        if (plan.status === "Active") summary.activeCount += 1;
        summary.visits += visits;
        return summary;
      },
      { activeCount: 0, totalRemaining: 0, visits: 0 }
    );
  }, [treatmentPlans, treatmentPlanPaymentsByPlanId, treatmentPlanVisitsByPlanId]);

  function parseMoney(value: string) {
    const amount = Number(value.replace(/,/g, ".").trim());
    return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : 0;
  }

  function resetTreatmentPlanForms() {
    setShowNewTreatmentPlan(false);
    setNewPlanServiceId("");
    setNewPlanTitle("");
    setNewPlanAmount("");
    setNewPlanVisits("5");
    setNewPlanNotes("");
    setVisitPlanId(null);
    setVisitDoctorId("");
    setVisitNotes("");
    setPaymentPlanId(null);
    setPlanPaymentAmount("");
    setPlanPaymentMethod("Cash");
    setPlanPaymentNotes("");
  }

  function planPaid(planId: string) {
    return (treatmentPlanPaymentsByPlanId.get(planId) || []).reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  }

  function planRemaining(plan: TreatmentPlan) {
    return Math.max(0, Number(plan.total_amount || 0) - planPaid(plan.id));
  }

  function planVisitsCount(planId: string) {
    return treatmentPlanVisitsByPlanId.get(planId)?.length || 0;
  }

  function startPlanPayment(plan: TreatmentPlan) {
    if (!receptionistId) { alert("Open the register first."); return; }
    const remaining = planRemaining(plan);
    setPaymentPlanId(plan.id);
    setPlanPaymentAmount(remaining > 0 ? remaining.toFixed(2) : "");
    setPlanPaymentMethod("Cash");
    setPlanPaymentNotes("");
    setVisitPlanId(null);
  }

  function startPlanVisit(plan: TreatmentPlan) {
    setVisitPlanId(plan.id);
    setVisitDoctorId("");
    setVisitNotes("");
    setPaymentPlanId(null);
  }

  async function openProfile(patient: FullPatient) {
    setSelectedPatient(patient);
    setView("profile");
    setIsLoadingProfile(true);
    setNotes([]);
    setProfileReceipts([]);
    setProfileReceiptItems([]);
    setProfileServices([]);
    setTreatmentPlans([]);
    setTreatmentPlanVisits([]);
    setTreatmentPlanPayments([]);
    setLastVisit(null);
    setShowAddNote(false);
    setNewNoteText("");
    setExpandedNoteIds(new Set());
    setEditingNoteId(null);
    setEditingNoteText("");
    setExpandedProfileSections(new Set());
    resetTreatmentPlanForms();

    let notesQuery = supabase
      .from("patient_notes")
      .select("*")
      .eq("patient_id", patient.id)
      .order("created_at", { ascending: false });
    if (clinicId) notesQuery = notesQuery.eq("clinic_id", clinicId);

    let plansQuery = supabase
      .from("treatment_plans")
      .select("*")
      .eq("patient_id", patient.id)
      .order("created_at", { ascending: false });
    if (clinicId) plansQuery = plansQuery.eq("clinic_id", clinicId);

    const [notesResult, doctorsResult, receptionistsResult, clinicsResult, allReceptionistsResult, receiptsResult, servicesResult, plansResult] = await Promise.all([
      notesQuery,
      supabase.from("doctors").select("id, name"),
      supabase.from("receptionist").select("id, name"),
      supabase.from("clinics").select("id, name"),
      clinicId
        ? supabase.from("receptionist").select("id, clinic_id")
        : Promise.resolve({ data: [] as { id: string; clinic_id: string | null }[] }),
      supabase.from("receipts").select("*").eq("patient_id", patient.id).order("created_at", { ascending: false }),
      supabase.from("services").select("id, name, price, clinic_id"),
      plansQuery,
    ]);

    let receiptsQuery = supabase
      .from("receipts")
      .select("created_at")
      .eq("patient_id", patient.id)
      .order("created_at", { ascending: false })
      .limit(1);
    // receptionist_id is a uuid — an .eq() sentinel would 400, so skip the
    // query entirely when the clinic has no receptionists.
    let skipLastVisit = false;
    if (clinicId) {
      const ids = receptionistIdsForClinic(
        (allReceptionistsResult.data as { id: string; clinic_id: string | null }[]) || [],
        clinicId
      );
      if (ids.length === 0) {
        skipLastVisit = true;
      } else {
        receiptsQuery = receiptsQuery.in("receptionist_id", ids);
      }
    }
    const lastVisitResult = skipLastVisit
      ? { data: [] as { created_at: string }[] }
      : await receiptsQuery;

    let scopedProfileReceipts = (receiptsResult.data as Receipt[]) || [];
    if (clinicId) {
      const ids = new Set(
        receptionistIdsForClinic(
          (allReceptionistsResult.data as { id: string; clinic_id: string | null }[]) || [],
          clinicId
        )
      );
      scopedProfileReceipts = ids.size === 0
        ? []
        : scopedProfileReceipts.filter((receipt) => receipt.receptionist_id != null && ids.has(receipt.receptionist_id));
    }

    let profileItemsData: ReceiptItem[] = [];
    const profileReceiptIds = scopedProfileReceipts.map((receipt) => receipt.id);
    if (profileReceiptIds.length > 0) {
      const { data: itemsData } = await supabase
        .from("receipt_items")
        .select("receipt_id, service_id, quantity, price, total")
        .in("receipt_id", profileReceiptIds);
      profileItemsData = (itemsData as ReceiptItem[]) || [];
    }

    const plansData = (plansResult.data as TreatmentPlan[]) || [];
    let visitsData: TreatmentPlanVisit[] = [];
    let paymentsData: TreatmentPlanPayment[] = [];
    const planIds = plansData.map((plan) => plan.id);
    if (planIds.length > 0) {
      const [visitsResult, paymentsResult] = await Promise.all([
        supabase
          .from("treatment_plan_visits")
          .select("*")
          .in("treatment_plan_id", planIds)
          .order("visit_number", { ascending: false }),
        supabase
          .from("treatment_plan_payments")
          .select("*")
          .in("treatment_plan_id", planIds)
          .order("created_at", { ascending: false }),
      ]);
      visitsData = (visitsResult.data as TreatmentPlanVisit[]) || [];
      paymentsData = (paymentsResult.data as TreatmentPlanPayment[]) || [];
    }

    setNotes((notesResult.data as PatientNote[]) || []);
    setProfileReceipts(scopedProfileReceipts);
    setProfileReceiptItems(profileItemsData);
    setProfileServices((servicesResult.data as LookupItem[]) || []);
    setTreatmentPlans(plansData);
    setTreatmentPlanVisits(visitsData);
    setTreatmentPlanPayments(paymentsData);
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

  function toggleProfileSection(section: ProfileSectionKey) {
    setExpandedProfileSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  }

  function isProfileSectionOpen(section: ProfileSectionKey) {
    return expandedProfileSections.has(section);
  }

  async function saveNewNote() {
    if (!newNoteText.trim() || !selectedPatient) return;
    setIsSavingNote(true);
    const { error } = await supabase.from("patient_notes").insert({
      patient_id: selectedPatient.id,
      note: newNoteText.trim(),
      clinic_id: clinicId ?? null,
    });
    if (!error) {
      let refetch = supabase
        .from("patient_notes")
        .select("*")
        .eq("patient_id", selectedPatient.id)
        .order("created_at", { ascending: false });
      if (clinicId) refetch = refetch.eq("clinic_id", clinicId);
      const { data } = await refetch;
      setNotes((data as PatientNote[]) || []);
      setNewNoteText("");
      setShowAddNote(false);
    }
    setIsSavingNote(false);
  }

  async function saveTreatmentPlan() {
    if (!selectedPatient) return;
    if (!clinic?.id) { alert("Treatment plans need an active clinic. Open the register for a clinic first."); return; }
    const selectedService = clinicServiceOptions.find((service) => service.id === newPlanServiceId);
    const title = (newPlanTitle.trim() || selectedService?.name || "").trim();
    const amount = parseMoney(newPlanAmount);
    const plannedVisits = Math.max(1, Math.round(Number(newPlanVisits) || 0));
    if (!title) { alert("Enter a treatment name."); return; }
    if (amount <= 0) { alert("Treatment amount must be greater than 0."); return; }

    setSavingTreatmentPlan(true);
    try {
      const { data, error } = await supabase
        .from("treatment_plans")
        .insert([
          {
            patient_id: selectedPatient.id,
            clinic_id: clinic.id,
            service_id: selectedService?.id || null,
            title,
            total_amount: amount,
            planned_visits: plannedVisits,
            notes: newPlanNotes.trim() || null,
            created_by: receptionistId,
          },
        ])
        .select()
        .single();

      if (error) {
        console.error("Create treatment plan failed:", error);
        alert(`Error: ${error.message || "Unknown error"}`);
        return;
      }

      setTreatmentPlans((prev) => [data as TreatmentPlan, ...prev]);
      setShowNewTreatmentPlan(false);
      setNewPlanServiceId("");
      setNewPlanTitle("");
      setNewPlanAmount("");
      setNewPlanVisits("5");
      setNewPlanNotes("");
    } finally {
      setSavingTreatmentPlan(false);
    }
  }

  async function saveTreatmentVisit(plan: TreatmentPlan) {
    if (!selectedPatient) return;
    const nextVisitNumber = planVisitsCount(plan.id) + 1;
    if (nextVisitNumber > Number(plan.planned_visits || 1) + 20) {
      alert("This visit count looks too high. Check the treatment plan first.");
      return;
    }

    setSavingTreatmentVisit(true);
    try {
      const { data, error } = await supabase
        .from("treatment_plan_visits")
        .insert([
          {
            treatment_plan_id: plan.id,
            visit_number: nextVisitNumber,
            doctor_id: visitDoctorId || null,
            receptionist_id: receptionistId || null,
            notes: visitNotes.trim() || null,
          },
        ])
        .select()
        .single();

      if (error) {
        console.error("Record treatment visit failed:", error);
        alert(`Error: ${error.message || "Unknown error"}`);
        return;
      }

      const visit = data as TreatmentPlanVisit;
      setTreatmentPlanVisits((prev) => [visit, ...prev]);
      setVisitPlanId(null);
      setVisitDoctorId("");
      setVisitNotes("");

      if (nextVisitNumber >= Number(plan.planned_visits || 1) && planRemaining(plan) <= 0.0049 && plan.status === "Active") {
        const { data: updatedPlan } = await supabase
          .from("treatment_plans")
          .update({ status: "Completed", completed_at: new Date().toISOString() })
          .eq("id", plan.id)
          .select()
          .single();
        if (updatedPlan) {
          setTreatmentPlans((prev) => prev.map((item) => item.id === plan.id ? updatedPlan as TreatmentPlan : item));
        }
      }
    } finally {
      setSavingTreatmentVisit(false);
    }
  }

  async function saveTreatmentPayment(plan: TreatmentPlan) {
    if (!selectedPatient) return;
    if (!clinic?.id) { alert("Treatment plan payments need an active clinic."); return; }
    if (!receptionistId) { alert("Open the register first."); return; }
    const amount = parseMoney(planPaymentAmount);
    const remaining = planRemaining(plan);
    if (amount <= 0) { alert("Payment amount must be greater than 0."); return; }
    if (amount > remaining + 0.0049) {
      alert(`Amount exceeds remaining balance (AED ${remaining.toFixed(2)}).`);
      return;
    }

    setSavingTreatmentPayment(true);
    try {
      const { data, error } = await supabase
        .from("treatment_plan_payments")
        .insert([
          {
            treatment_plan_id: plan.id,
            patient_id: selectedPatient.id,
            clinic_id: clinic.id,
            amount,
            payment_method: planPaymentMethod,
            receptionist_id: receptionistId,
            register_session_id: registerSessionId,
            notes: planPaymentNotes.trim() || null,
          },
        ])
        .select()
        .single();

      if (error) {
        console.error("Collect treatment plan payment failed:", error);
        alert(`Error: ${error.message || "Unknown error"}`);
        return;
      }

      setTreatmentPlanPayments((prev) => [data as TreatmentPlanPayment, ...prev]);
      setPaymentPlanId(null);
      setPlanPaymentAmount("");
      setPlanPaymentMethod("Cash");
      setPlanPaymentNotes("");
    } finally {
      setSavingTreatmentPayment(false);
    }
  }

  async function refetchNotes(patientId: string) {
    let q = supabase
      .from("patient_notes")
      .select("*")
      .eq("patient_id", patientId)
      .order("created_at", { ascending: false });
    if (clinicId) q = q.eq("clinic_id", clinicId);
    const { data } = await q;
    setNotes((data as PatientNote[]) || []);
  }

  function startEditNote(note: PatientNote) {
    setEditingNoteId(note.id);
    setEditingNoteText(note.note);
  }

  function cancelEditNote() {
    setEditingNoteId(null);
    setEditingNoteText("");
  }

  async function saveEditNote() {
    if (!editingNoteId || !editingNoteText.trim() || !selectedPatient) return;
    setIsSavingNote(true);
    const { error } = await supabase
      .from("patient_notes")
      .update({ note: editingNoteText.trim() })
      .eq("id", editingNoteId);
    if (!error) {
      await refetchNotes(selectedPatient.id);
      cancelEditNote();
    }
    setIsSavingNote(false);
  }

  async function deleteNote(noteId: string) {
    if (!selectedPatient) return;
    if (!confirm("Delete this note? This cannot be undone.")) return;
    const { error } = await supabase.from("patient_notes").delete().eq("id", noteId);
    if (!error) {
      await refetchNotes(selectedPatient.id);
    }
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
                {filteredPatients.map((patient) => {
                  const owed = outstandingByPatient.get(patient.id);
                  return (
                    <button
                      key={patient.id}
                      onClick={() => openProfile(patient)}
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 p-3 text-left transition hover:border-teal-200 hover:bg-teal-50"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-slate-900">{patient.name}</p>
                        <div className="flex shrink-0 items-center gap-1.5">
                          {owed && owed.remaining > 0 && (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800" title="Outstanding balance">
                              AED {owed.remaining.toFixed(2)}
                            </span>
                          )}
                          {patient.patient_number != null && (
                            <span className="rounded-full bg-teal-100 px-2 py-0.5 text-xs font-semibold text-teal-700">
                              #{patient.patient_number}
                            </span>
                          )}
                        </div>
                      </div>
                      <p className="mt-0.5 text-xs text-slate-500">{patient.phone || "No phone"}</p>
                    </button>
                  );
                })}
              </div>

            </div>
          )}

          {/* ── PROFILE VIEW ── */}
          {view === "profile" && selectedPatient && (
            <div className="space-y-6">

              {/* Demographics card */}
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-bold text-slate-900">{selectedPatient.name}</h3>
                    <div className="mt-1 space-y-0.5 text-sm">
                      <p className="font-semibold text-teal-700">
                        File No.: {selectedPatient.patient_number != null
                          ? `#${String(selectedPatient.patient_number).padStart(5, "0")}`
                          : "Not assigned"}
                      </p>
                      {selectedPatient.mrn && <p className="text-slate-600">MRN: {selectedPatient.mrn}</p>}
                      {selectedPatient.phone && <p className="text-slate-600">Phone: {selectedPatient.phone}</p>}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      onClick={() => {
                        if (!receptionistId) { alert("Open the register first."); return; }
                        if (!clinic?.id) { alert("Deposits need an active clinic. Open the register for a clinic first."); return; }
                        setShowDepositModal(true);
                      }}
                      className="rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-500"
                    >
                      Receive Deposit
                    </button>
                    <button
                      onClick={() => setShowEditModal(true)}
                      className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-100"
                    >
                      Edit
                    </button>
                  </div>
                </div>
                <div className="mb-3 grid grid-cols-2 gap-2">
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Outstanding Balance</p>
                    <p className="text-base font-bold text-amber-800">AED {selectedPatientOutstandingTotal.toFixed(2)}</p>
                  </div>
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Available Credit</p>
                    <p className="text-base font-bold text-emerald-800">AED {selectedPatientAvailableCredit.toFixed(2)}</p>
                  </div>
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

              {selectedPatient.notes && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                  <p className="mb-2 text-xs font-bold uppercase tracking-wide text-amber-700">Medical History</p>
                  <p className="whitespace-pre-wrap text-sm text-slate-800">{selectedPatient.notes}</p>
                </div>
              )}

              <div className="rounded-2xl border border-cyan-200 bg-cyan-50 p-4">
                <div className="flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => toggleProfileSection("plans")}
                    className="flex flex-1 items-center justify-between text-left"
                  >
                    <span className="text-xs font-bold uppercase tracking-wide text-cyan-700">Active Treatment Plans</span>
                    <span className="text-xs font-semibold text-cyan-800">
                      {treatmentPlanSummary.activeCount} active · AED {treatmentPlanSummary.totalRemaining.toFixed(2)} due {isProfileSectionOpen("plans") ? "▲" : "▼"}
                    </span>
                  </button>
                  {isProfileSectionOpen("plans") && !showNewTreatmentPlan && (
                    <button
                      onClick={() => setShowNewTreatmentPlan(true)}
                      className="rounded-xl bg-cyan-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-cyan-500"
                    >
                      + New Plan
                    </button>
                  )}
                </div>

                {isProfileSectionOpen("plans") && showNewTreatmentPlan && (
                  <div className="mt-3 space-y-3 rounded-2xl border border-cyan-200 bg-white p-4">
                    <div>
                      <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Service / Treatment</label>
                      <select
                        value={newPlanServiceId}
                        onChange={(e) => {
                          const serviceId = e.target.value;
                          const service = clinicServiceOptions.find((item) => item.id === serviceId);
                          setNewPlanServiceId(serviceId);
                          if (service) {
                            setNewPlanTitle(service.name);
                            if (!newPlanAmount && service.price != null) setNewPlanAmount(String(Number(service.price || 0)));
                          }
                        }}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
                      >
                        <option value="">Custom treatment…</option>
                        {clinicServiceOptions.map((service) => (
                          <option key={service.id} value={service.id}>{service.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <div className="sm:col-span-3">
                        <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Plan Name</label>
                        <input
                          value={newPlanTitle}
                          onChange={(e) => setNewPlanTitle(e.target.value)}
                          placeholder="e.g. Denture"
                          className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Total AED</label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={newPlanAmount}
                          onChange={(e) => setNewPlanAmount(e.target.value)}
                          className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Visits</label>
                        <input
                          type="number"
                          min="1"
                          step="1"
                          value={newPlanVisits}
                          onChange={(e) => setNewPlanVisits(e.target.value)}
                          className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Status</label>
                        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-600">Active</div>
                      </div>
                    </div>
                    <textarea
                      value={newPlanNotes}
                      onChange={(e) => setNewPlanNotes(e.target.value)}
                      placeholder="Plan notes or stages, optional"
                      rows={2}
                      className="w-full resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={saveTreatmentPlan}
                        disabled={savingTreatmentPlan}
                        className="rounded-xl bg-cyan-600 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-cyan-500 disabled:opacity-50"
                      >
                        {savingTreatmentPlan ? "Saving…" : "Save Plan"}
                      </button>
                      <button
                        onClick={() => {
                          setShowNewTreatmentPlan(false);
                          setNewPlanServiceId("");
                          setNewPlanTitle("");
                          setNewPlanAmount("");
                          setNewPlanVisits("5");
                          setNewPlanNotes("");
                        }}
                        className="rounded-xl border border-slate-200 px-4 py-1.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {isProfileSectionOpen("plans") && (isLoadingProfile ? (
                  <p className="py-4 text-center text-sm text-cyan-700">Loading…</p>
                ) : treatmentPlans.length === 0 ? (
                  <p className="mt-3 text-sm text-cyan-700">No treatment plans yet.</p>
                ) : (
                  <div className="mt-3 space-y-3">
                    {treatmentPlans.map((plan) => {
                      const paid = planPaid(plan.id);
                      const remaining = planRemaining(plan);
                      const visits = treatmentPlanVisitsByPlanId.get(plan.id) || [];
                      const payments = treatmentPlanPaymentsByPlanId.get(plan.id) || [];
                      const completedVisits = visits.length;
                      const isFullyPaid = remaining <= 0.0049;
                      return (
                        <div key={plan.id} className="rounded-2xl border border-cyan-200 bg-white p-4">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-sm font-bold text-slate-900">{plan.title}</p>
                              <p className="mt-1 text-xs text-slate-500">
                                Visits {completedVisits} / {plan.planned_visits} · {isFullyPaid ? "Fully paid" : `AED ${remaining.toFixed(2)} remaining`}
                              </p>
                              {plan.notes && <p className="mt-1 text-xs text-slate-500">{plan.notes}</p>}
                            </div>
                            <div className="text-right text-xs">
                              <p className="font-semibold text-slate-500">Total</p>
                              <p className="text-base font-bold text-slate-900">AED {Number(plan.total_amount || 0).toFixed(2)}</p>
                              <p className="font-semibold text-emerald-700">Paid AED {paid.toFixed(2)}</p>
                            </div>
                          </div>
                          <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                            <div className="rounded-xl bg-cyan-50 px-3 py-2">
                              <p className="font-semibold uppercase text-cyan-700">Status</p>
                              <p className="text-sm font-bold text-slate-800">{plan.status}</p>
                            </div>
                            <div className="rounded-xl bg-emerald-50 px-3 py-2">
                              <p className="font-semibold uppercase text-emerald-700">Paid</p>
                              <p className="text-sm font-bold text-slate-800">AED {paid.toFixed(2)}</p>
                            </div>
                            <div className="rounded-xl bg-amber-50 px-3 py-2">
                              <p className="font-semibold uppercase text-amber-700">Balance</p>
                              <p className="text-sm font-bold text-slate-800">AED {remaining.toFixed(2)}</p>
                            </div>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button
                              onClick={() => startPlanVisit(plan)}
                              className="rounded-xl border border-cyan-200 bg-cyan-50 px-3 py-1.5 text-xs font-semibold text-cyan-700 transition hover:bg-cyan-100"
                            >
                              Add Visit
                            </button>
                            {remaining > 0.0049 && (
                              <button
                                onClick={() => startPlanPayment(plan)}
                                className="rounded-xl bg-cyan-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-cyan-500"
                              >
                                Collect Payment
                              </button>
                            )}
                          </div>

                          {visitPlanId === plan.id && (
                            <div className="mt-3 space-y-2 rounded-2xl border border-cyan-100 bg-cyan-50 p-3">
                              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                <div>
                                  <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Doctor</label>
                                  <select
                                    value={visitDoctorId}
                                    onChange={(e) => setVisitDoctorId(e.target.value)}
                                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
                                  >
                                    <option value="">Not selected</option>
                                    {doctors.map((doctor) => (
                                      <option key={doctor.id} value={doctor.id}>{doctor.name}</option>
                                    ))}
                                  </select>
                                </div>
                                <div>
                                  <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Visit Number</label>
                                  <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700">
                                    {completedVisits + 1} / {plan.planned_visits}
                                  </div>
                                </div>
                              </div>
                              <textarea
                                value={visitNotes}
                                onChange={(e) => setVisitNotes(e.target.value)}
                                placeholder="Visit note, optional"
                                rows={2}
                                className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
                              />
                              <div className="flex gap-2">
                                <button
                                  onClick={() => saveTreatmentVisit(plan)}
                                  disabled={savingTreatmentVisit}
                                  className="rounded-xl bg-cyan-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-cyan-500 disabled:opacity-50"
                                >
                                  {savingTreatmentVisit ? "Saving…" : "Save Visit"}
                                </button>
                                <button
                                  onClick={() => setVisitPlanId(null)}
                                  className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          )}

                          {paymentPlanId === plan.id && (
                            <div className="mt-3 space-y-2 rounded-2xl border border-emerald-100 bg-emerald-50 p-3">
                              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                <div>
                                  <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Amount Received</label>
                                  <input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={planPaymentAmount}
                                    onChange={(e) => setPlanPaymentAmount(e.target.value)}
                                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
                                  />
                                </div>
                                <div>
                                  <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Payment Method</label>
                                  <select
                                    value={planPaymentMethod}
                                    onChange={(e) => setPlanPaymentMethod(e.target.value)}
                                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
                                  >
                                    {TREATMENT_PLAN_PAYMENT_METHODS.map((method) => (
                                      <option key={method} value={method}>{method}</option>
                                    ))}
                                  </select>
                                </div>
                              </div>
                              <input
                                value={planPaymentNotes}
                                onChange={(e) => setPlanPaymentNotes(e.target.value)}
                                placeholder="Payment note, optional"
                                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
                              />
                              <div className="flex gap-2">
                                <button
                                  onClick={() => saveTreatmentPayment(plan)}
                                  disabled={savingTreatmentPayment}
                                  className="rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
                                >
                                  {savingTreatmentPayment ? "Saving…" : "Collect Payment"}
                                </button>
                                <button
                                  onClick={() => setPaymentPlanId(null)}
                                  className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          )}

                          {(visits.length > 0 || payments.length > 0) && (
                            <div className="mt-3 grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
                              {visits.length > 0 && (
                                <div>
                                  <p className="mb-1 font-bold uppercase text-slate-500">Recent Visits</p>
                                  <div className="space-y-1">
                                    {visits.slice(0, 3).map((visit) => (
                                      <p key={visit.id} className="rounded-lg bg-slate-50 px-2 py-1 text-slate-600">
                                        Visit {visit.visit_number} · {new Date(visit.visit_date).toLocaleDateString("en-GB")}{visit.notes ? ` · ${visit.notes}` : ""}
                                      </p>
                                    ))}
                                  </div>
                                </div>
                              )}
                              {payments.length > 0 && (
                                <div>
                                  <p className="mb-1 font-bold uppercase text-slate-500">Recent Payments</p>
                                  <div className="space-y-1">
                                    {payments.slice(0, 3).map((payment) => (
                                      <p key={payment.id} className="rounded-lg bg-slate-50 px-2 py-1 text-slate-600">
                                        AED {Number(payment.amount || 0).toFixed(2)} · {payment.payment_method} · {new Date(payment.created_at).toLocaleDateString("en-GB")}
                                      </p>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>

              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                <button
                  type="button"
                  onClick={() => toggleProfileSection("outstanding")}
                  className="flex w-full items-center justify-between text-left"
                >
                  <span className="text-xs font-bold uppercase tracking-wide text-amber-700">Outstanding Balances</span>
                  <span className="text-xs font-semibold text-amber-700">
                    AED {selectedPatientOutstandingTotal.toFixed(2)} {isProfileSectionOpen("outstanding") ? "▲" : "▼"}
                  </span>
                </button>
                {isProfileSectionOpen("outstanding") && (
                  selectedPatientBalances.length === 0 ? (
                    <p className="mt-3 text-sm text-amber-700">No outstanding balances.</p>
                  ) : (
                  <div className="space-y-2">
                    {selectedPatientBalances.map((bal) => {
                      const payments = paymentsByBalanceId.get(bal.id) || [];
                      const roll = rollupBalance(bal, payments);
                      const belongsToClinic = !clinicId || bal.clinic_id === clinicId;
                      return (
                        <div key={bal.id} className="rounded-xl border border-amber-200 bg-white p-3">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-xs font-semibold text-slate-500">
                                {clinicNameById.get(bal.clinic_id) || "Clinic"} · {new Date(bal.original_date).toLocaleDateString("en-GB")}
                              </p>
                              <p className="text-sm font-semibold text-slate-800">
                                {formatBalanceReference(bal)}
                              </p>
                              {bal.reason && (
                                <p className="mt-0.5 text-xs text-slate-500">{bal.reason}</p>
                              )}
                            </div>
                            <div className="text-right">
                              <p className={
                                roll.status === "Paid"
                                  ? "text-xs font-semibold uppercase text-emerald-700"
                                  : roll.status === "Partial"
                                  ? "text-xs font-semibold uppercase text-amber-700"
                                  : "text-xs font-semibold uppercase text-rose-700"
                              }>
                                {roll.status}
                              </p>
                              <p className="text-sm font-bold text-slate-900">AED {roll.remaining.toFixed(2)}</p>
                              <p className="text-[10px] text-slate-500">
                                of AED {Number(bal.original_amount).toFixed(2)}
                              </p>
                            </div>
                          </div>
                          {roll.remaining > 0.0049 && onCollectBalance && belongsToClinic && (
                            <div className="mt-3">
                              <button
                                onClick={() =>
                                  onCollectBalance({ balance: bal, payments, patient: selectedPatient })
                                }
                                className="rounded-xl bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-amber-500"
                              >
                                Collect Payment
                              </button>
                            </div>
                          )}
                          {roll.remaining > 0.0049 && !belongsToClinic && (
                            <p className="mt-2 text-[10px] italic text-slate-400">
                              Recorded at another clinic — collect from that clinic.
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  )
                )}
              </div>

              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                <button
                  type="button"
                  onClick={() => toggleProfileSection("credits")}
                  className="flex w-full items-center justify-between text-left"
                >
                  <span className="text-xs font-bold uppercase tracking-wide text-emerald-700">Patient Credit / Deposits</span>
                  <span className="text-xs font-semibold text-emerald-800">
                    Available: AED {selectedPatientAvailableCredit.toFixed(2)} {isProfileSectionOpen("credits") ? "▲" : "▼"}
                  </span>
                </button>
                {isProfileSectionOpen("credits") && (
                  selectedPatientCredits.length === 0 ? (
                    <p className="mt-3 text-sm text-emerald-700">No deposits or credit activity.</p>
                  ) : (
                  <div className="space-y-2">
                    {selectedPatientCredits.map((credit) => (
                      <div key={credit.id} className="rounded-xl border border-emerald-200 bg-white p-3">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-slate-500">
                              {clinicNameById.get(credit.clinic_id) || "Clinic"} · {new Date(credit.created_at).toLocaleDateString("en-GB")}
                            </p>
                            <p className="text-sm font-semibold text-slate-800">
                              {Number(credit.amount) > 0
                                ? credit.reason || "Deposit"
                                : "Applied to treatment"}
                            </p>
                            {credit.expected_treatment_date && (
                              <p className="mt-0.5 text-xs text-slate-500">
                                Expected treatment: {new Date(credit.expected_treatment_date).toLocaleDateString("en-GB")}
                              </p>
                            )}
                            {credit.notes && <p className="mt-0.5 text-xs text-slate-500">{credit.notes}</p>}
                          </div>
                          <div className="text-right">
                            <p className={
                              Number(credit.amount) > 0
                                ? "text-sm font-bold text-emerald-700"
                                : "text-sm font-bold text-slate-600"
                            }>
                              {Number(credit.amount) > 0 ? "+" : "−"} AED {Math.abs(Number(credit.amount)).toFixed(2)}
                            </p>
                            {credit.payment_method && (
                              <p className="text-[10px] text-slate-500">{credit.payment_method}</p>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  )
                )}
              </div>

              {/* Clinical Notes */}
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => toggleProfileSection("clinical")}
                    className="flex flex-1 items-center justify-between text-left"
                  >
                    <span className="text-sm font-bold uppercase tracking-wide text-slate-700">Clinical Notes</span>
                    <span className="text-xs font-semibold text-slate-500">
                      {notes.length} note{notes.length === 1 ? "" : "s"} {isProfileSectionOpen("clinical") ? "▲" : "▼"}
                    </span>
                  </button>
                  {isProfileSectionOpen("clinical") && !showAddNote && (
                    <button
                      onClick={() => setShowAddNote(true)}
                      className="rounded-xl bg-teal-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-teal-400"
                    >
                      + Add Note
                    </button>
                  )}
                </div>

                {isProfileSectionOpen("clinical") && showAddNote && (
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

                {isProfileSectionOpen("clinical") && (isLoadingProfile ? (
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
                      const isEditing = editingNoteId === note.id;
                      const contextLine = [clinic?.name, doctor ? `Dr. ${doctor.name}` : null, receptionist?.name]
                        .filter(Boolean)
                        .join(" · ");
                      return (
                        <div key={note.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                          <div className="mb-1 flex items-start justify-between gap-2">
                            <div>
                              <p className="text-xs font-semibold text-slate-500">
                                {new Date(note.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                                {" · "}
                                {new Date(note.created_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                              </p>
                              {contextLine && (
                                <p className="mt-1 text-xs text-slate-400">{contextLine}</p>
                              )}
                            </div>
                            {!isEditing && (
                              <div className="flex shrink-0 gap-1">
                                <button
                                  onClick={() => startEditNote(note)}
                                  className="rounded-full border border-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-500 transition hover:bg-slate-50 hover:text-teal-600"
                                >
                                  Edit
                                </button>
                                <button
                                  onClick={() => deleteNote(note.id)}
                                  className="rounded-full border border-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-500 transition hover:bg-red-50 hover:text-red-600"
                                >
                                  Delete
                                </button>
                              </div>
                            )}
                          </div>
                          {isEditing ? (
                            <div className="mt-2 space-y-2">
                              <textarea
                                value={editingNoteText}
                                onChange={(e) => setEditingNoteText(e.target.value)}
                                rows={4}
                                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-teal-400 focus:ring-4 focus:ring-teal-100"
                              />
                              <div className="flex gap-2">
                                <button
                                  onClick={saveEditNote}
                                  disabled={isSavingNote || !editingNoteText.trim()}
                                  className="rounded-xl bg-teal-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-teal-400 disabled:opacity-50"
                                >
                                  {isSavingNote ? "Saving…" : "Save"}
                                </button>
                                <button
                                  onClick={cancelEditNote}
                                  className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <>
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
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <button
                  type="button"
                  onClick={() => toggleProfileSection("treatment")}
                  className="flex w-full items-center justify-between text-left"
                >
                  <span className="text-sm font-bold uppercase tracking-wide text-slate-700">Treatment History</span>
                  <span className="text-xs font-semibold text-slate-500">
                    {profileReceipts.length} visit{profileReceipts.length === 1 ? "" : "s"} {isProfileSectionOpen("treatment") ? "▲" : "▼"}
                  </span>
                </button>

                {isProfileSectionOpen("treatment") && (isLoadingProfile ? (
                  <p className="py-4 text-center text-sm text-slate-400">Loading…</p>
                ) : profileReceipts.length === 0 ? (
                  <p className="py-4 text-center text-sm text-slate-400">No treatment history yet</p>
                ) : (
                  <div className="mt-3 space-y-3">
                    {profileReceipts.map((visit) => {
                      const visitItems = profileReceiptItems.filter((item) => item.receipt_id === visit.id);
                      const doctor = doctors.find((d) => d.id === visit.doctor_id);
                      const receptionist = receptionists.find((r) => r.id === visit.receptionist_id);
                      return (
                        <div key={visit.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                {visit.created_at ? new Date(visit.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "N/A"}
                                {" · "}
                                {visit.receipt_number ? `#${String(visit.receipt_number).padStart(5, "0")}` : visit.id.slice(0, 8)}
                              </p>
                              <p className="mt-1 text-xs text-slate-400">
                                {[doctor ? `Dr. ${doctor.name}` : null, receptionist?.name].filter(Boolean).join(" · ") || "Treatment visit"}
                              </p>
                            </div>
                            <span className="shrink-0 rounded-full bg-teal-100 px-2.5 py-1 text-xs font-bold text-teal-700">
                              AED {Number(visit.total || 0).toFixed(2)}
                            </span>
                          </div>
                          <div className="mt-3 space-y-1">
                            {visitItems.length === 0 ? (
                              <p className="text-sm text-slate-500">No services recorded</p>
                            ) : (
                              visitItems.map((item, index) => {
                                const service = profileServices.find((s) => s.id === item.service_id);
                                return (
                                  <div key={`${item.receipt_id}-${item.service_id}-${index}`} className="flex justify-between gap-3 text-sm text-slate-800">
                                    <span>{service?.name || "Service"} x{item.quantity || 1}</span>
                                    <span className="font-semibold">AED {Number(item.total || item.price || 0).toFixed(2)}</span>
                                  </div>
                                );
                              })
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
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

      <ReceiveDepositModal
        isOpen={showDepositModal}
        onClose={() => setShowDepositModal(false)}
        patient={selectedPatient}
        clinic={clinic}
        receptionistId={receptionistId}
        registerSessionId={registerSessionId}
        cashierName={receptionistName}
        existingCredits={selectedPatientCredits}
        onSaved={(credit) => onCreditSaved?.(credit)}
      />
      <EditPatientModal
        isOpen={showEditModal}
        onClose={() => setShowEditModal(false)}
        patient={selectedPatient}
        onSaved={(updated) => {
          const merged = { ...selectedPatient, ...(updated as PatientRecord) } as FullPatient;
          setSelectedPatient(merged);
          onPatientUpdated?.(merged);
        }}
      />
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

  // Refunds can't exceed money actually collected: partial-payment receipts
  // only took amount_paid (NULL = paid in full), minus prior refunds.
  function maxRefundableFor(receipt: Receipt): number {
    const paidAmount = Number(receipt.amount_paid ?? receipt.total ?? 0);
    const previouslyRefunded = (refundsMap[receipt.id] || []).reduce(
      (s: number, r: any) => s + Number(r.total_amount || 0),
      0
    );
    return Math.max(0, Math.round((paidAmount - previouslyRefunded) * 100) / 100);
  }

  function calcRefundTotal(): number {
    if (!refundTargetReceipt) return 0;
    if (refundAll) return maxRefundableFor(refundTargetReceipt);
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
    const maxRefundable = maxRefundableFor(refundTargetReceipt);

    if (totalRefund <= 0) {
      alert("Nothing left to refund — everything the patient paid has already been refunded.");
      setIsProcessingRefund(false);
      return;
    }
    if (totalRefund > maxRefundable + 0.0049) {
      alert(`Refund exceeds what the patient actually paid. Maximum refundable is AED ${maxRefundable.toFixed(2)}.`);
      setIsProcessingRefund(false);
      return;
    }

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

    // A fully refunded partial-payment receipt shouldn't keep chasing the
    // patient for the remainder — remove its auto-created outstanding balance,
    // unless payments were already collected against it (needs manual review).
    if (refundAll && refundTargetReceipt.amount_paid != null) {
      const { data: linkedBalances } = await supabase
        .from("outstanding_balances")
        .select("id")
        .eq("receipt_id", refundTargetReceipt.id);
      const balanceIds = (linkedBalances || []).map((b: any) => b.id);
      if (balanceIds.length > 0) {
        const { data: collected } = await supabase
          .from("balance_payments")
          .select("id")
          .in("outstanding_balance_id", balanceIds)
          .limit(1);
        if ((collected || []).length === 0) {
          await supabase.from("outstanding_balances").delete().in("id", balanceIds);
        } else {
          alert("Note: this receipt's outstanding balance already has collected payments, so it was kept. Review it in the Backend page.");
        }
      }
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
    const clinicDisplayName = (clinic?.receipt_print_name || clinic?.name || "Skin and Smile Dental Clinic")
      .replace(/\s*\([^)]*\)\s*/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
    const receiptTitle = clinic?.receipt_title || "TAX INVOICE";
    const isAlDanaClinic = (clinic?.name || "").toLowerCase().includes("al dana");
    const clinicAddress = clinic?.address || (
      isAlDanaClinic
        ? "Al Dana Center - 4th Floor room 408 - Al Maktoum Rd - Al Muraqqabat - Deira - Dubai"
        : "Al Satwa, Dubai, UAE"
    );
    const clinicRoom = clinic?.room ? `2nd Floor, Room ${clinic.room.replace(/^Room\s+/i, "")}` : "";
    const clinicTrn = clinic?.trn || "";
    const clinicPhone = clinic?.phone || (isAlDanaClinic ? "054 460 1011" : "");
    const clinicWhatsapp = clinic?.whatsapp || "";
    const isSkinAndSmile = !clinic || clinic.logo !== "altamuze";
    const clinicInstagram = clinic?.instagram || (isSkinAndSmile ? "@skinandsmiledentalclinic" : "");
    const clinicFacebook = clinic?.facebook || "";
    const clinicTiktok = clinic?.tiktok || (isSkinAndSmile ? "@skinandsmile" : "");
    const receiptVatNote = clinic?.receipt_vat_note || "VAT Included in Above Amount / الضريبة مشمولة في المبلغ أعلاه";
    const receiptThankYou = clinic?.receipt_thank_you || "Thank you for visiting us / شكراً لزيارتك لنا";
    const receiptFinalMessage = clinic?.receipt_final_message || "Thank you for Visiting US!";
    const socialHtml = clinicInstagram || clinicFacebook || clinicTiktok
      ? `<div class="footer-center" style="margin-top:6px;">Follow us:</div>${clinicInstagram ? `<div class="footer-center">Instagram: ${clinicInstagram}</div>` : ""}${clinicFacebook ? `<div class="footer-center">Facebook: ${clinicFacebook}</div>` : ""}${clinicTiktok ? `<div class="footer-center">TikTok: ${clinicTiktok}</div>` : ""}`
      : "";

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
    const paidAtSale = receipt.amount_paid != null ? Number(receipt.amount_paid) : total;
    const creditAtSale = Number(receipt.credit_applied || 0);
    const wasPartial = receipt.amount_paid != null && total - paidAtSale - creditAtSale > 0.0049;

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
      <div class="double">${receiptTitle}</div>
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
      ${Number(receipt.gateway_fee || 0) > 0 ? `<div class="row"><span>${receipt.gateway_fee_provider || "Installment"} Fee</span><span>AED ${Number(receipt.gateway_fee || 0).toFixed(2)}</span></div>` : ""}
      <div class="hr" style="margin:4px 0;"></div>
      <div class="row" style="font-weight:700;"><span>TOTAL / الإجمالي</span><span>AED ${total.toFixed(2)}</span></div>
      <div class="hr"></div>
      <div class="row"><span>Payment Method / طريقة الدفع</span><span>: ${(receipt.payment_method || "-").toUpperCase()}</span></div>
      ${creditAtSale > 0.0049 ? `<div class="row"><span>Patient Credit Used / الرصيد المستخدم</span><span>: - AED ${creditAtSale.toFixed(2)}</span></div>` : ""}
      <div class="row"><span>Amount Paid / المبلغ المدفوع</span><span>: AED ${paidAtSale.toFixed(2)}</span></div>
      ${wasPartial ? `<div class="row"><span>Outstanding at Sale / المتبقي</span><span>: AED ${(total - paidAtSale - creditAtSale).toFixed(2)}</span></div>` : ""}
      <div class="row" style="font-weight:700;"><span>Payment Status / حالة الدفع</span><span>: ${wasPartial ? "PARTIAL PAYMENT" : "PAID"}</span></div>
      ${receipt.notes ? `<div style="margin-top:4px;">Note / ملاحظة: ${receipt.notes}</div>` : ""}
      <div class="hr"></div>
      <div class="footer-center">${receiptVatNote}</div>
      <div class="footer-center">${receiptThankYou}</div>
      ${socialHtml}
      <div class="hr"></div>
      <div style="text-align:center;font-size:9px;line-height:1.4;">
        ${clinicPhone ? `<div>Phone: ${clinicPhone}</div>` : ""}
        ${clinicWhatsapp ? `<div>WhatsApp: ${clinicWhatsapp}</div>` : ""}
      </div>
      <div class="hr"></div>
      <div class="double">${receiptFinalMessage}</div>
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
                          {receipt.amount_paid != null &&
                            Number(receipt.total || 0) - Number(receipt.amount_paid) - Number(receipt.credit_applied || 0) > 0.0049 && (
                            <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-700">Partial</span>
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
export function TreatmentHistoryModal({
  isOpen,
  onClose,
  clinicId,
}: {
  isOpen: boolean;
  onClose: () => void;
  clinicId?: string | null;
}) {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, clinicId]);

  async function loadHistory() {
    const [patientResult, allReceiptsResult, serviceResult, receptionistsResult] = await Promise.all([
      supabase.from("patients").select("id, name, phone").order("name", { ascending: true }),
      supabase.from("receipts").select("*").order("created_at", { ascending: false }),
      supabase.from("services").select("id, name"),
      clinicId
        ? supabase.from("receptionist").select("id, clinic_id")
        : Promise.resolve({ data: [] as { id: string; clinic_id: string | null }[] }),
    ]);

    let scopedReceipts = (allReceiptsResult.data as Receipt[]) || [];
    if (clinicId) {
      const ids = new Set(
        receptionistIdsForClinic(
          (receptionistsResult.data as { id: string; clinic_id: string | null }[]) || [],
          clinicId
        )
      );
      scopedReceipts = scopedReceipts.filter((r) => r.receptionist_id != null && ids.has(r.receptionist_id));
    }

    const receiptIds = scopedReceipts.map((r) => r.id);
    let itemsData: ReceiptItem[] = [];
    if (receiptIds.length > 0) {
      const { data: items } = await supabase
        .from("receipt_items")
        .select("receipt_id, service_id, quantity, price, total")
        .in("receipt_id", receiptIds);
      itemsData = (items as ReceiptItem[]) || [];
    }

    setPatients((patientResult.data as Patient[]) || []);
    setReceipts(scopedReceipts);
    setServices((serviceResult.data as LookupItem[]) || []);
    setReceiptItems(itemsData);

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
                    .map((item, idx) => {
                      const service = services.find((s) => s.id === item.service_id);
                      return (
                        <p key={`${item.receipt_id}-${item.service_id}-${idx}`} className="text-sm text-slate-900">
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
