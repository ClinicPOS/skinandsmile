"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { receptionistIdsForClinic } from "../lib/clinic-scope";
import type {
  OutstandingBalance,
  BalancePayment,
  PaymentAllocation,
  PatientCredit,
  TreatmentPlan,
  TreatmentPlanPayment,
  TreatmentPlanPaymentAllocation,
  TreatmentPlanPaymentRecord,
  TreatmentPlanVisit,
  Clinic as ClinicRecord,
  Patient as PatientRecord,
} from "../lib/types";
import { rollupBalance, formatBalanceReference } from "../lib/outstanding-balances";
import { EditPatientModal } from "./edit-patient-modal";
import { buildReceiptQrHtml, getReceiptLogoPath, printHtmlWhenImagesReady } from "../lib/receipt-branding";
import { generateInvoiceHtml, generateTreatmentPlanPaymentInvoiceHtml } from "../lib/generate-invoice-html";
import { buildThermalReceiptHtml, type BuildThermalReceiptHtmlOptions } from "../lib/build-thermal-receipt-html";
import {
  buildPaymentAllocations,
  paymentVariantLabel,
  referenceRequiredForVariant,
  validatePaymentAllocations,
  PaymentAllocationDraft,
  PaymentMethodVariant,
} from "../lib/payment-allocation";
import { printTreatmentPlanPaymentReceipt } from "../lib/print-treatment-plan-payment-receipt";
import {
  calculateAllocationMaxRefundableInvoiceAmount,
  autoAllocateRefundAmounts,
  buildAllocationRefundRequests,
  calculateReceiptItemsRefundTotal,
  calculateReceiptMaxRefundableAmount,
  createAllocationBackedRefund,
  createLegacyBackedRefund,
  getRemainingAllocationAmounts,
  isNonRefundableSurchargeVariant,
  resolveRefundProcessingMode,
} from "../lib/receipt-refunds";
import { buildTreatmentPlanPaymentRpcArgs } from "../lib/treatment-plan-payment-records";
import { computeTreatmentPlanRollup } from "../lib/treatment-plan-rollup";
import { mapRegularReceiptRenderLine, summarizeRegularReceiptForRender } from "../lib/regular-receipt-rendering";

type Patient = {
  id: string;
  name: string;
  phone: string | null;
  patient_number?: number | null;
  clinic_file_no?: string | null;
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

const PLAN_PAYMENT_MODE_OPTIONS = ["Cash", "Card", "Tabby", "Tamara", "Split Payment"] as const;
type PlanPaymentMode = (typeof PLAN_PAYMENT_MODE_OPTIONS)[number];

const PLAN_ALLOCATION_METHOD_OPTIONS: Array<{ value: PaymentMethodVariant; label: string }> = [
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
  { value: "tabby_standard", label: "Tabby" },
  { value: "tabby_card", label: "Tabby Card" },
  { value: "tamara", label: "Tamara" },
];

function newPlanAllocationDraft(methodVariant: PaymentMethodVariant | "" = "", amount = ""): PaymentAllocationDraft {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    methodVariant,
    invoiceAllocationAmountInput: amount,
    providerReferenceNumber: "",
    terminalAuthorizationCode: "",
    cardNetwork: "",
  };
}

function planModeToVariant(mode: PlanPaymentMode): PaymentMethodVariant {
  if (mode === "Cash") return "cash";
  if (mode === "Card") return "card";
  if (mode === "Tabby") return "tabby_standard";
  if (mode === "Tamara") return "tamara";
  return "cash";
}

function legacyPaymentMethodToVariant(method: string): { methodVariant: PaymentMethodVariant; cardNetwork?: string; methodLabel: string } {
  const normalized = method.trim().toLowerCase();
  if (normalized === "cash") return { methodVariant: "cash", methodLabel: "Cash" };
  if (normalized === "visa") return { methodVariant: "card", cardNetwork: "Visa", methodLabel: "Visa" };
  if (normalized === "mastercard") return { methodVariant: "card", cardNetwork: "Mastercard", methodLabel: "Mastercard" };
  if (normalized === "tabby") return { methodVariant: "tabby_standard", methodLabel: "Tabby" };
  if (normalized === "tamara") return { methodVariant: "tamara", methodLabel: "Tamara" };
  if (normalized === "bank transfer") return { methodVariant: "card", methodLabel: "Bank Transfer" };
  return { methodVariant: "card", methodLabel: method || "Card" };
}

type SavedTreatmentPlanActionContext = {
  clinic: ClinicRecord | null;
  patientName: string;
  patientFileNo: string;
  planTitle: string;
  planAmount: number;
  plannedVisits: number;
  planNotes: string | null;
  cashierName: string;
  createdAt: string;
  referenceNo: string;
};

function buildTreatmentPlanSummaryHtml(context: SavedTreatmentPlanActionContext) {
  return generateInvoiceHtml({
    clinic: context.clinic,
    receiptNumber: context.referenceNo,
    invoiceStatus: "UNPAID",
    issuedAt: new Date(context.createdAt),
    cashierName: context.cashierName,
    patient: {
      name: context.patientName,
      phone: null,
      fileNumber: context.patientFileNo || undefined,
    },
    doctorName: null,
    items: [
      {
        description: `Treatment Plan — ${context.planTitle}`,
        quantity: 1,
        unitPrice: Number(context.planAmount || 0),
      },
    ],
    grandTotal: Number(context.planAmount || 0),
    amountPaid: 0,
    outstandingBalance: Number(context.planAmount || 0),
    treatmentPlanReference: context.planTitle,
    notes: [
      context.planNotes ? `Notes: ${context.planNotes}` : null,
      `Planned visits: ${context.plannedVisits}`,
      "Treatment plan saved by the clinic POS system.",
    ].filter(Boolean).join("\n"),
  });
}

type LookupItem = {
  id: string;
  name: string;
  price?: number | null;
  standard_price?: number | null;
  pricing_type?: string | null;
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
  clinic_file_no?: string | null;
  clinic_file_mrn?: string | null;
  clinic_patient_file_id?: string | null;
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

type ProfileSectionKey = "plans" | "outstanding" | "credits" | "clinical" | "treatment" | "imported";

type HistoricalVisit = {
  id: string;
  visit_date: string | null;
  treatment_description: string | null;
  fee_aed: number | null;
  original_dentist_name: string | null;
  visit_sequence: number;
};

type ClinicSummary = {
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
  thermal_logo_width_mm?: number | null;
  thermal_logo_max_height_mm?: number | null;
  thermal_logo_alignment?: string | null;
  thermal_logo_offset_x_mm?: number | null;
  thermal_logo_offset_y_mm?: number | null;
  thermal_logo_high_contrast?: boolean | null;
  thermal_text_weight?: number | null;
  thermal_font_size_px?: number | null;
};

type ReceiptItem = {
  receipt_id: string;
  service_id: string;
  quantity: number;
  price: number;
  total: number;
  original_price?: number | null;
  service_name_snapshot?: string | null;
  teeth?: string[] | null;
  allocated_global_discount_amount?: number | null;
  taxable_amount?: number | null;
  vat_rate?: number | null;
  vat_amount?: number | null;
  final_line_total?: number | null;
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
  clinicsList?: ClinicSummary[];
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
  const [showEditModal, setShowEditModal] = useState(false);
  const [notes, setNotes] = useState<PatientNote[]>([]);
  const [profileReceipts, setProfileReceipts] = useState<Receipt[]>([]);
  const [profileReceiptItems, setProfileReceiptItems] = useState<ReceiptItem[]>([]);
  const [profileServices, setProfileServices] = useState<LookupItem[]>([]);
  const [treatmentPlans, setTreatmentPlans] = useState<TreatmentPlan[]>([]);
  const [treatmentPlanVisits, setTreatmentPlanVisits] = useState<TreatmentPlanVisit[]>([]);
  const [treatmentPlanPayments, setTreatmentPlanPayments] = useState<TreatmentPlanPayment[]>([]);
  const [treatmentPlanPaymentRecords, setTreatmentPlanPaymentRecords] = useState<TreatmentPlanPaymentRecord[]>([]);
  const [historicalVisits, setHistoricalVisits] = useState<HistoricalVisit[]>([]);
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
  const [savedTreatmentPlanActionContext, setSavedTreatmentPlanActionContext] = useState<SavedTreatmentPlanActionContext | null>(null);
  const [isDownloadingTreatmentPlanPdf, setIsDownloadingTreatmentPlanPdf] = useState(false);
  // Legacy treatment form
  const [showLegacyTreatmentForm, setShowLegacyTreatmentForm] = useState(false);
  const [legacyServiceId, setLegacyServiceId] = useState("");
  const [legacyTitle, setLegacyTitle] = useState("");
  const [legacyDoctorId, setLegacyDoctorId] = useState("");
  const [legacyStartDate, setLegacyStartDate] = useState("");
  const [legacyTotalVisits, setLegacyTotalVisits] = useState("5");
  const [legacyVisitsCompleted, setLegacyVisitsCompleted] = useState("0");
  const [legacyAgreedTotal, setLegacyAgreedTotal] = useState("");
  const [legacyHistoricalPaid, setLegacyHistoricalPaid] = useState("");
  const [legacyPaymentToday, setLegacyPaymentToday] = useState("0");
  const [legacyPaymentTodayMethod, setLegacyPaymentTodayMethod] = useState("Cash");
  const [legacyPaymentArrangement, setLegacyPaymentArrangement] = useState("Custom schedule");
  const [legacyOriginalRef, setLegacyOriginalRef] = useState("");
  const [legacyNotes, setLegacyNotes] = useState("");
  const [savingLegacy, setSavingLegacy] = useState(false);
  const [visitPlanId, setVisitPlanId] = useState<string | null>(null);
  const [visitDoctorId, setVisitDoctorId] = useState("");
  const [visitNotes, setVisitNotes] = useState("");
  const [savingTreatmentVisit, setSavingTreatmentVisit] = useState(false);
  const [paymentPlanId, setPaymentPlanId] = useState<string | null>(null);
  const [planPaymentAmount, setPlanPaymentAmount] = useState("");
  const [planPaymentMode, setPlanPaymentMode] = useState<PlanPaymentMode>("Cash");
  const [planPaymentDrafts, setPlanPaymentDrafts] = useState<PaymentAllocationDraft[]>([]);
  const [planPaymentValidationErrors, setPlanPaymentValidationErrors] = useState<string[]>([]);
  const [savingTreatmentPayment, setSavingTreatmentPayment] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setView("search");
      setQuery("");
      setSelectedPatient(null);
      setExpandedNoteIds(new Set());
      setShowAddNote(false);
      setNewNoteText("");
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
        String(p.clinic_file_no ?? p.patient_number ?? "").includes(search)
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

  const treatmentPlanPaymentsByPlanId = useMemo(() => {
    const map = new Map<string, TreatmentPlanPayment[]>();
    for (const payment of treatmentPlanPayments) {
      const list = map.get(payment.treatment_plan_id) || [];
      list.push(payment);
      map.set(payment.treatment_plan_id, list);
    }
    return map;
  }, [treatmentPlanPayments]);

  const treatmentPlanPaymentRecordsByPlanId = useMemo(() => {
    const map = new Map<string, TreatmentPlanPaymentRecord[]>();
    for (const payment of treatmentPlanPaymentRecords) {
      const list = map.get(payment.treatment_plan_id) || [];
      list.push(payment);
      map.set(payment.treatment_plan_id, list);
    }
    return map;
  }, [treatmentPlanPaymentRecords]);

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

  // Outstanding total = unpaid outstanding-balance records + unpaid treatment-plan balances.
  const selectedPatientOutstandingTotal = useMemo(() => {
    const balanceTotal = selectedPatientBalances.reduce(
      (sum, b) => sum + rollupBalance(b, paymentsByBalanceId.get(b.id) || []).remaining,
      0
    );
    const planTotal = treatmentPlans.reduce((sum, plan) => {
      const rollup = computeTreatmentPlanRollup(plan, {
        structuredPayments: treatmentPlanPaymentRecordsByPlanId.get(plan.id) || [],
        legacyPayments: treatmentPlanPaymentsByPlanId.get(plan.id) || [],
      });
      return sum + rollup.remainingBalance;
    }, 0);
    return balanceTotal + planTotal;
  }, [selectedPatientBalances, paymentsByBalanceId, treatmentPlans, treatmentPlanPaymentRecordsByPlanId, treatmentPlanPaymentsByPlanId]);

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

  const treatmentPlanSummary = useMemo(() => {
    return treatmentPlans.reduce(
      (summary, plan) => {
        const rollup = computeTreatmentPlanRollup(plan, {
          structuredPayments: treatmentPlanPaymentRecordsByPlanId.get(plan.id) || [],
          legacyPayments: treatmentPlanPaymentsByPlanId.get(plan.id) || [],
        });
        const remaining = rollup.remainingBalance;
        const visits = treatmentPlanVisitsByPlanId.get(plan.id)?.length || 0;
        summary.totalRemaining += remaining;
        if (plan.status === "Active") summary.activeCount += 1;
        summary.visits += visits;
        return summary;
      },
      { activeCount: 0, totalRemaining: 0, visits: 0 }
    );
  }, [treatmentPlans, treatmentPlanPaymentRecordsByPlanId, treatmentPlanPaymentsByPlanId, treatmentPlanVisitsByPlanId]);

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
    setPlanPaymentMode("Cash");
    setPlanPaymentDrafts([]);
    setPlanPaymentValidationErrors([]);
  }

  function resetLegacyForm() {
    setShowLegacyTreatmentForm(false);
    setLegacyServiceId("");
    setLegacyTitle("");
    setLegacyDoctorId("");
    setLegacyStartDate("");
    setLegacyTotalVisits("5");
    setLegacyVisitsCompleted("0");
    setLegacyAgreedTotal("");
    setLegacyHistoricalPaid("");
    setLegacyPaymentToday("0");
    setLegacyPaymentTodayMethod("Cash");
    setLegacyPaymentArrangement("Custom schedule");
    setLegacyOriginalRef("");
    setLegacyNotes("");
  }

  async function saveLegacyTreatment() {
    if (!selectedPatient) return;
    if (!clinic?.id) { alert("Treatment plans need an active clinic. Open the register for a clinic first."); return; }
    if (!receptionistId) { alert("Open the register first."); return; }
    const title = legacyTitle.trim();
    if (!title) { alert("Enter a treatment name."); return; }
    const agreedTotal = parseMoney(legacyAgreedTotal);
    if (agreedTotal <= 0) { alert("Agreed total must be greater than 0."); return; }
    const totalVisits = Math.max(1, Math.round(Number(legacyTotalVisits) || 1));
    const visitsCompleted = Math.max(0, Math.round(Number(legacyVisitsCompleted) || 0));
    const historicalPaid = Math.max(0, parseMoney(legacyHistoricalPaid));
    const paymentToday = Math.max(0, parseMoney(legacyPaymentToday));

    setSavingLegacy(true);
    try {
      const notesText = [
        legacyNotes.trim(),
        legacyOriginalRef.trim() ? `Original Ref: ${legacyOriginalRef.trim()}` : "",
      ].filter(Boolean).join(" | ") || null;

      const { data: planData, error: planError } = await supabase
        .from("treatment_plans")
        .insert([{
          patient_id: selectedPatient.id,
          clinic_id: clinic.id,
          service_id: legacyServiceId || null,
          title,
          total_amount: agreedTotal,
          planned_visits: totalVisits,
          notes: notesText,
          payment_arrangement: legacyPaymentArrangement || null,
          historical_amount_paid: historicalPaid,
          is_legacy: true,
          created_by: receptionistId,
          status: "Active",
        }])
        .select()
        .single();

      if (planError || !planData) {
        alert(`Error creating legacy plan: ${planError?.message || "Unknown error"}`);
        return;
      }

      // Add completed visits as historical visit records
      for (let i = 0; i < visitsCompleted; i++) {
        await supabase.from("treatment_plan_visits").insert([{
          treatment_plan_id: planData.id,
          visit_number: i + 1,
          visit_date: legacyStartDate || new Date().toISOString().slice(0, 10),
          receptionist_id: receptionistId,
          notes: "Imported historical visit",
        }]);
      }
      if (visitsCompleted > 0) {
        const { data: importedVisits } = await supabase
          .from("treatment_plan_visits")
          .select("*")
          .eq("treatment_plan_id", planData.id)
          .order("visit_number", { ascending: false });
        if (importedVisits) {
          setTreatmentPlanVisits((prev) => [...(importedVisits as TreatmentPlanVisit[]), ...prev.filter((row) => row.treatment_plan_id !== planData.id)]);
        }
      }

      // Record today's payment if applicable (NOT historical)
      if (paymentToday > 0.001) {
        const method = legacyPaymentMethodToVariant(legacyPaymentTodayMethod);
        const paymentDraft = newPlanAllocationDraft(method.methodVariant, paymentToday.toFixed(2));
        paymentDraft.cardNetwork = method.cardNetwork || "";
        const allocations = buildPaymentAllocations([paymentDraft], paymentToday, paymentToday, 0);
        const { error: paymentTodayError } = await supabase
          .rpc("create_treatment_plan_payment_record_with_allocations", buildTreatmentPlanPaymentRpcArgs({
            treatmentPlanId: planData.id,
            patientId: selectedPatient.id,
            clinicId: clinic.id,
            receptionistId,
            registerSessionId,
            paymentNotePrefix: `Legacy import payment today (${method.methodLabel}): ${title}`,
            allocations,
          }))
          .single();
        if (paymentTodayError) {
          alert(`Legacy plan saved, but today's payment could not be recorded: ${paymentTodayError.message || "Unknown error"}`);
        } else {
          const [legacyPaymentsResult, structuredPaymentsResult] = await Promise.all([
            supabase
              .from("treatment_plan_payments")
              .select("*")
              .eq("treatment_plan_id", planData.id)
              .order("created_at", { ascending: false }),
            supabase
              .from("treatment_plan_payment_records")
              .select("*")
              .eq("treatment_plan_id", planData.id)
              .order("created_at", { ascending: false }),
          ]);
          if (!legacyPaymentsResult.error) {
            const nextRows = (legacyPaymentsResult.data as TreatmentPlanPayment[]) || [];
            setTreatmentPlanPayments((prev) => [...nextRows, ...prev.filter((row) => row.treatment_plan_id !== planData.id)]);
          }
          if (!structuredPaymentsResult.error) {
            const nextRows = (structuredPaymentsResult.data as TreatmentPlanPaymentRecord[]) || [];
            setTreatmentPlanPaymentRecords((prev) => [...nextRows, ...prev.filter((row) => row.treatment_plan_id !== planData.id)]);
          }
        }
      }

      setTreatmentPlans((prev) => [planData as TreatmentPlan, ...prev]);
      resetLegacyForm();
    } finally {
      setSavingLegacy(false);
    }
  }

  function planPaid(plan: TreatmentPlan, asOf?: string | Date) {
    return computeTreatmentPlanRollup(plan, {
      structuredPayments: treatmentPlanPaymentRecordsByPlanId.get(plan.id) || [],
      legacyPayments: treatmentPlanPaymentsByPlanId.get(plan.id) || [],
      asOf,
    }).totalPaidToDate;
  }

  function planRemaining(plan: TreatmentPlan, asOf?: string | Date) {
    return computeTreatmentPlanRollup(plan, {
      structuredPayments: treatmentPlanPaymentRecordsByPlanId.get(plan.id) || [],
      legacyPayments: treatmentPlanPaymentsByPlanId.get(plan.id) || [],
      asOf,
    }).remainingBalance;
  }

  function planVisitsCount(planId: string) {
    return treatmentPlanVisitsByPlanId.get(planId)?.length || 0;
  }

  function planCompletedVisits(plan: TreatmentPlan) {
    return Math.max(planVisitsCount(plan.id), plan.clinic_patient_file_id ? 1 : 0);
  }

  function startPlanPayment(plan: TreatmentPlan) {
    if (!receptionistId) { alert("Open the register first."); return; }
    const remaining = planRemaining(plan);
    const amountStr = remaining > 0 ? remaining.toFixed(2) : "";
    setPaymentPlanId(plan.id);
    setPlanPaymentAmount(amountStr);
    setPlanPaymentMode("Cash");
    setPlanPaymentDrafts([newPlanAllocationDraft("cash", amountStr)]);
    setPlanPaymentValidationErrors([]);
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
    setTreatmentPlanPaymentRecords([]);
    setHistoricalVisits([]);
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

    const [notesResult, doctorsResult, receptionistsResult, clinicsResult, allReceptionistsResult, receiptsResult, servicesResult, plansResult, historicalVisitsResult] = await Promise.all([
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
      patient.clinic_patient_file_id
        ? supabase
            .from("patient_treatment_visits")
            .select("id, visit_date, treatment_description, fee_aed, original_dentist_name, visit_sequence")
            .eq("patient_file_id", patient.clinic_patient_file_id)
            .order("visit_date", { ascending: false })
        : Promise.resolve({ data: [] as HistoricalVisit[] }),
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
    let paymentRecordsData: TreatmentPlanPaymentRecord[] = [];
    const planIds = plansData.map((plan) => plan.id);
    if (planIds.length > 0) {
      const [visitsResult, paymentsResult, paymentRecordsResult] = await Promise.all([
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
        supabase
          .from("treatment_plan_payment_records")
          .select("*")
          .in("treatment_plan_id", planIds)
          .order("created_at", { ascending: false }),
      ]);
      visitsData = (visitsResult.data as TreatmentPlanVisit[]) || [];
      paymentsData = (paymentsResult.data as TreatmentPlanPayment[]) || [];
      paymentRecordsData = (paymentRecordsResult.data as TreatmentPlanPaymentRecord[]) || [];
    }

    setNotes((notesResult.data as PatientNote[]) || []);
    setProfileReceipts(scopedProfileReceipts);
    setProfileReceiptItems(profileItemsData);
    setProfileServices((servicesResult.data as LookupItem[]) || []);
    setTreatmentPlans(plansData);
    setTreatmentPlanVisits(visitsData);
    setTreatmentPlanPayments(paymentsData);
    setTreatmentPlanPaymentRecords(paymentRecordsData);
    setDoctors((doctorsResult.data as LookupItem[]) || []);
    setReceptionists((receptionistsResult.data as LookupItem[]) || []);
    setClinics((clinicsResult.data as LookupItem[]) || []);
    setLastVisit(lastVisitResult.data?.[0]?.created_at || null);
    setHistoricalVisits((historicalVisitsResult.data as HistoricalVisit[]) || []);
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
      setSavedTreatmentPlanActionContext({
        clinic: clinic ?? null,
        patientName: selectedPatient.name,
        patientFileNo: selectedPatient.clinic_file_no || (selectedPatient.patient_number != null ? String(selectedPatient.patient_number) : ""),
        planTitle: title,
        planAmount: amount,
        plannedVisits,
        planNotes: newPlanNotes.trim() || null,
        cashierName: receptionistName || "Reception",
        createdAt: (data as TreatmentPlan).created_at || new Date().toISOString(),
        referenceNo: `TP-${String((data as TreatmentPlan).id).slice(0, 8).toUpperCase()}`,
      });
    } finally {
      setSavingTreatmentPlan(false);
    }
  }

  async function downloadSavedTreatmentPlanPdf() {
    if (!savedTreatmentPlanActionContext) return;
    setIsDownloadingTreatmentPlanPdf(true);
    try {
      const html = buildTreatmentPlanSummaryHtml(savedTreatmentPlanActionContext);
      const res = await fetch("/api/generate-invoice-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          html,
          filename: `${savedTreatmentPlanActionContext.planTitle.replace(/\s+/g, "_").slice(0, 40)}_TreatmentPlan.pdf`,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(`Could not generate PDF: ${err.error || res.statusText}`);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${savedTreatmentPlanActionContext.planTitle.replace(/\s+/g, "_").slice(0, 40)}_TreatmentPlan.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (error: any) {
      alert(`PDF download failed: ${error?.message || "Unknown error"}`);
    } finally {
      setIsDownloadingTreatmentPlanPdf(false);
    }
  }

  function printSavedTreatmentPlanA4() {
    if (!savedTreatmentPlanActionContext) return;
    const html = buildTreatmentPlanSummaryHtml(savedTreatmentPlanActionContext);
    printHtmlWhenImagesReady(html, "Please allow popups to print the treatment plan.");
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

    const invoiceAmount = parseMoney(planPaymentAmount);
    const remaining = planRemaining(plan);
    if (invoiceAmount <= 0) { alert("Payment amount must be greater than 0."); return; }
    if (invoiceAmount > remaining + 0.0049) {
      alert(`Amount exceeds remaining balance (AED ${remaining.toFixed(2)}).`);
      return;
    }

    const validationErrors = validatePaymentAllocations(planPaymentDrafts, invoiceAmount);
    if (validationErrors.length > 0) {
      setPlanPaymentValidationErrors(validationErrors.map((e) => e.message));
      return;
    }

    setSavingTreatmentPayment(true);
    try {
      const allocations = buildPaymentAllocations(planPaymentDrafts, invoiceAmount, invoiceAmount, 0);
      const { data, error } = await supabase
        .rpc("create_treatment_plan_payment_record_with_allocations", buildTreatmentPlanPaymentRpcArgs({
          treatmentPlanId: plan.id,
          patientId: selectedPatient.id,
          clinicId: clinic.id,
          receptionistId,
          registerSessionId,
          paymentNotePrefix: `Plan payment: ${plan.title}`,
          allocations,
        }))
        .single();

      if (error) {
        console.error("Collect treatment plan payment failed:", error);
        alert(`Error: ${error.message || "Unknown error"}`);
        return;
      }

      const paymentRecord = data as { payment_record_id: string; created_at: string };
      const [refreshedPaymentsResult, refreshedRecordsResult] = await Promise.all([
        supabase
          .from("treatment_plan_payments")
          .select("*")
          .eq("treatment_plan_id", plan.id)
          .order("created_at", { ascending: false }),
        supabase
          .from("treatment_plan_payment_records")
          .select("*")
          .eq("treatment_plan_id", plan.id)
          .order("created_at", { ascending: false }),
      ]);
      if (refreshedPaymentsResult.error) {
        alert(`Payment saved, but reloading treatment plan payments failed: ${refreshedPaymentsResult.error.message || "Unknown error"}`);
      } else {
        setTreatmentPlanPayments((refreshedPaymentsResult.data as TreatmentPlanPayment[]) || []);
      }
      if (refreshedRecordsResult.error) {
        alert(`Payment saved, but reloading structured treatment plan payments failed: ${refreshedRecordsResult.error.message || "Unknown error"}`);
      } else {
        setTreatmentPlanPaymentRecords((refreshedRecordsResult.data as TreatmentPlanPaymentRecord[]) || []);
      }
      setPaymentPlanId(null);
      setPlanPaymentAmount("");
      setPlanPaymentMode("Cash");
      setPlanPaymentDrafts([]);
      setPlanPaymentValidationErrors([]);

      // Print receipt
      const totalFee = allocations.reduce((sum, a) => sum + a.feeAmount, 0);
      const totalCustomerPaid = allocations.reduce((sum, a) => sum + a.customerChargedAmount, 0);
      const newRemaining = Math.max(0, remaining - invoiceAmount);
      printTreatmentPlanPaymentReceipt({
        clinic,
        patientName: selectedPatient.name,
        patientFileNo: selectedPatient.clinic_file_no || (selectedPatient.patient_number != null ? String(selectedPatient.patient_number) : undefined),
        planTitle: plan.title,
        paymentArrangement: plan.payment_arrangement || "—",
        agreedTotal: Number(plan.total_amount || 0),
        amountSettledToday: invoiceAmount,
        remainingAfterToday: newRemaining,
        totalFeeAmount: totalFee,
        totalCustomerPaid,
        cashierName: receptionistName || "Reception",
        services: [],
        allocations: allocations.map((a) => ({
          methodLabel: paymentVariantLabel(a.methodVariant),
          invoiceAllocationAmount: a.invoiceAllocationAmount,
          feeAmount: a.feeAmount,
          customerChargedAmount: a.customerChargedAmount,
        })),
        createdAt: paymentRecord.created_at,
        referenceNo: paymentRecord.payment_record_id ? `TPP-${String(paymentRecord.payment_record_id).slice(0, 8).toUpperCase()}` : undefined,
      });
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
                          {(patient.clinic_file_no || patient.patient_number != null) && (
                            <span className="rounded-full bg-teal-100 px-2 py-0.5 text-xs font-semibold text-teal-700">
                              #{patient.clinic_file_no || patient.patient_number}
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
                        File No.: {(selectedPatient.clinic_file_no || selectedPatient.patient_number != null)
                          ? `#${String(selectedPatient.clinic_file_no || selectedPatient.patient_number)}`
                          : "Not assigned"}
                      </p>
                      {(selectedPatient.clinic_file_mrn || selectedPatient.mrn) && <p className="text-slate-600">MRN: {selectedPatient.clinic_file_mrn || selectedPatient.mrn}</p>}
                      {selectedPatient.phone && <p className="text-slate-600">Phone: {selectedPatient.phone}</p>}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      onClick={() => setShowEditModal(true)}
                      className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-100"
                    >
                      Edit
                    </button>
                  </div>
                </div>
                <div className="mb-3">
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Outstanding Balance</p>
                    <p className="text-base font-bold text-amber-800">AED {selectedPatientOutstandingTotal.toFixed(2)}</p>
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
                  {isProfileSectionOpen("plans") && !showNewTreatmentPlan && !showLegacyTreatmentForm && (
                    <>
                      <button
                        onClick={() => setShowNewTreatmentPlan(true)}
                        className="rounded-xl bg-cyan-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-cyan-500"
                      >
                        + New Plan
                      </button>
                      <button
                        onClick={() => setShowLegacyTreatmentForm(true)}
                        className="rounded-xl border border-cyan-200 bg-white px-3 py-1.5 text-xs font-semibold text-cyan-600 transition hover:bg-cyan-50"
                      >
                        Add Legacy
                      </button>
                    </>
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

                {isProfileSectionOpen("plans") && showLegacyTreatmentForm && (
                  <div className="mt-3 space-y-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
                    <p className="text-xs font-bold uppercase tracking-wide text-amber-700">Add Legacy Treatment Plan</p>
                    <div>
                      <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Service / Treatment</label>
                      <select
                        value={legacyServiceId}
                        onChange={(e) => {
                          const sId = e.target.value;
                          setLegacyServiceId(sId);
                          const svc = clinicServiceOptions.find((item) => item.id === sId);
                          if (svc && !legacyTitle) setLegacyTitle(svc.name);
                        }}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-amber-300"
                      >
                        <option value="">Custom treatment…</option>
                        {clinicServiceOptions.map((s) => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Plan Name</label>
                      <input
                        value={legacyTitle}
                        onChange={(e) => setLegacyTitle(e.target.value)}
                        placeholder="e.g. Denture (Legacy)"
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-amber-300"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Agreed Total (AED)</label>
                        <input
                          type="number" min="0" step="0.01"
                          value={legacyAgreedTotal}
                          onChange={(e) => setLegacyAgreedTotal(e.target.value)}
                          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-amber-300"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Historical Paid (AED)</label>
                        <input
                          type="number" min="0" step="0.01"
                          value={legacyHistoricalPaid}
                          onChange={(e) => setLegacyHistoricalPaid(e.target.value)}
                          placeholder="0.00"
                          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-amber-300"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Total Visits</label>
                        <input
                          type="number" min="1" step="1"
                          value={legacyTotalVisits}
                          onChange={(e) => setLegacyTotalVisits(e.target.value)}
                          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-amber-300"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Visits Completed</label>
                        <input
                          type="number" min="0" step="1"
                          value={legacyVisitsCompleted}
                          onChange={(e) => setLegacyVisitsCompleted(e.target.value)}
                          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-amber-300"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Start Date</label>
                        <input
                          type="date"
                          value={legacyStartDate}
                          onChange={(e) => setLegacyStartDate(e.target.value)}
                          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-amber-300"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Payment Today (AED)</label>
                        <input
                          type="number" min="0" step="0.01"
                          value={legacyPaymentToday}
                          onChange={(e) => setLegacyPaymentToday(e.target.value)}
                          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-amber-300"
                        />
                      </div>
                    </div>
                    {Number(legacyPaymentToday) > 0.001 && (
                      <div>
                        <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Payment Method Today</label>
                        <div className="grid grid-cols-3 gap-2">
                          {["Cash", "Card", "Visa", "Mastercard", "Bank Transfer"].map((m) => (
                            <button
                              key={m}
                              onClick={() => setLegacyPaymentTodayMethod(m)}
                              className={`rounded-xl border px-2 py-1.5 text-xs font-semibold transition ${legacyPaymentTodayMethod === m ? "border-amber-300 bg-amber-500 text-white" : "border-slate-200 bg-white text-slate-700 hover:border-amber-200"}`}
                            >
                              {m}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    <div>
                      <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Original Reference</label>
                      <input
                        value={legacyOriginalRef}
                        onChange={(e) => setLegacyOriginalRef(e.target.value)}
                        placeholder="e.g. old receipt number"
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-amber-300"
                      />
                    </div>
                    <textarea
                      value={legacyNotes}
                      onChange={(e) => setLegacyNotes(e.target.value)}
                      placeholder="Notes or context for this legacy plan"
                      rows={2}
                      className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-amber-300"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={saveLegacyTreatment}
                        disabled={savingLegacy}
                        className="rounded-xl bg-amber-600 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-amber-500 disabled:opacity-50"
                      >
                        {savingLegacy ? "Saving…" : "Save Legacy Plan"}
                      </button>
                      <button
                        onClick={resetLegacyForm}
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
                      const paid = planPaid(plan);
                      const remaining = planRemaining(plan);
                      const visits = treatmentPlanVisitsByPlanId.get(plan.id) || [];
                      const payments = treatmentPlanPaymentsByPlanId.get(plan.id) || [];
                      const completedVisits = planCompletedVisits(plan);
                      const remainingVisits = Math.max(0, Number(plan.planned_visits || 0) - completedVisits);
                      const isFullyPaid = remaining <= 0.0049;
                      return (
                        <div key={plan.id} className="rounded-2xl border border-cyan-200 bg-white p-4">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-sm font-bold text-slate-900">{plan.title}</p>
                              <p className="mt-1 text-xs text-slate-500">
                                Visits {completedVisits} / {plan.planned_visits} · {remainingVisits} more visit{remainingVisits === 1 ? "" : "s"} · {isFullyPaid ? "Fully paid" : `AED ${remaining.toFixed(2)} remaining`}
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
                                    {Math.min(completedVisits + 1, Number(plan.planned_visits || 0))} / {plan.planned_visits}
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
                            <div className="mt-3 space-y-3 rounded-2xl border border-emerald-100 bg-emerald-50 p-3">
                              <p className="text-xs font-bold uppercase text-emerald-700">Collect Payment</p>
                              {/* Invoice amount to collect */}
                              <div>
                                <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Invoice amount to collect (AED)</label>
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={planPaymentAmount}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setPlanPaymentAmount(val);
                                    const amt = parseFloat(val) || 0;
                                    if (planPaymentMode !== "Split Payment") {
                                      const variant = planModeToVariant(planPaymentMode);
                                      setPlanPaymentDrafts([newPlanAllocationDraft(variant, amt > 0 ? amt.toFixed(2) : "")]);
                                    }
                                  }}
                                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-300"
                                />
                                <p className="mt-0.5 text-xs text-slate-500">Max: AED {remaining.toFixed(2)}</p>
                              </div>
                              {/* Payment mode selector */}
                              <div>
                                <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Payment Mode</label>
                                <div className="grid grid-cols-3 gap-2">
                                  {PLAN_PAYMENT_MODE_OPTIONS.map((mode) => (
                                    <button
                                      key={mode}
                                      type="button"
                                      onClick={() => {
                                        setPlanPaymentMode(mode);
                                        const amt = parseFloat(planPaymentAmount) || 0;
                                        if (mode === "Split Payment") {
                                          setPlanPaymentDrafts([
                                            newPlanAllocationDraft("cash", amt > 0 ? amt.toFixed(2) : ""),
                                            newPlanAllocationDraft("card", "0.00"),
                                          ]);
                                        } else {
                                          const variant = planModeToVariant(mode);
                                          setPlanPaymentDrafts([newPlanAllocationDraft(variant, amt > 0 ? amt.toFixed(2) : "")]);
                                        }
                                        setPlanPaymentValidationErrors([]);
                                      }}
                                      className={`rounded-xl border px-2 py-1.5 text-xs font-semibold transition ${planPaymentMode === mode ? "border-emerald-300 bg-emerald-600 text-white" : "border-slate-200 bg-white text-slate-700 hover:border-emerald-200"}`}
                                    >
                                      {mode}
                                    </button>
                                  ))}
                                </div>
                              </div>
                              {/* Allocation rows */}
                              {planPaymentDrafts.map((row, draftIndex) => {
                                const variant = row.methodVariant as PaymentMethodVariant;
                                const invoiceAmt = parseFloat(planPaymentAmount) || 0;
                                const rowAllocations = invoiceAmt > 0 ? buildPaymentAllocations(planPaymentDrafts, invoiceAmt, invoiceAmt, 0) : [];
                                const rowComputed = rowAllocations.find((a) => a.id === row.id);
                                const needsRef = variant ? referenceRequiredForVariant(variant) : false;
                                const isCard = variant === "card";
                                const isTabbyCard = variant === "tabby_card";
                                return (
                                  <div key={row.id} className="rounded-xl border border-slate-200 bg-white p-3">
                                    {planPaymentMode === "Split Payment" && (
                                      <div className="mb-2 flex items-center justify-between">
                                        <span className="text-xs font-semibold uppercase text-slate-500">Payment #{draftIndex + 1}</span>
                                        {planPaymentDrafts.length > 1 && (
                                          <button type="button" onClick={() => {
                                            setPlanPaymentDrafts((prev) => prev.filter((d) => d.id !== row.id));
                                          }} className="text-xs font-semibold text-rose-600 hover:text-rose-700">Remove</button>
                                        )}
                                      </div>
                                    )}
                                    <div className="grid gap-2 sm:grid-cols-2">
                                      {planPaymentMode === "Split Payment" && (
                                        <div>
                                          <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Method</label>
                                          <select
                                            value={row.methodVariant}
                                            onChange={(e) => {
                                              const val = e.target.value as PaymentMethodVariant | "";
                                              setPlanPaymentDrafts((prev) => {
                                                const next = [...prev];
                                                next[draftIndex] = { ...next[draftIndex], methodVariant: val };
                                                return next;
                                              });
                                            }}
                                            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-300"
                                          >
                                            <option value="">Select method</option>
                                            {PLAN_ALLOCATION_METHOD_OPTIONS.map((opt) => (
                                              <option key={opt.value} value={opt.value}>{opt.label}</option>
                                            ))}
                                          </select>
                                        </div>
                                      )}
                                      {planPaymentMode === "Split Payment" && (
                                        <div>
                                          <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Invoice amount</label>
                                          <input
                                            type="number" min="0" step="0.01"
                                            value={row.invoiceAllocationAmountInput}
                                            onChange={(e) => {
                                              const val = e.target.value;
                                              setPlanPaymentDrafts((prev) => {
                                                const next = [...prev];
                                                next[draftIndex] = { ...next[draftIndex], invoiceAllocationAmountInput: val };
                                                // auto-fill last row
                                                if (draftIndex < next.length - 1) return next;
                                                return next;
                                              });
                                            }}
                                            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-300"
                                          />
                                        </div>
                                      )}
                                    </div>
                                    {isCard && (
                                      <div className="mt-2">
                                        <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Card network (optional)</label>
                                        <div className="flex items-center gap-4 text-sm text-slate-700">
                                          {["Visa", "Mastercard"].map((network) => (
                                            <label key={network} className="inline-flex items-center gap-2">
                                              <input
                                                type="checkbox"
                                                checked={String(row.cardNetwork || "").toLowerCase() === network.toLowerCase()}
                                                onChange={(e) => {
                                                  const checked = e.target.checked;
                                                  setPlanPaymentDrafts((prev) => {
                                                    const next = [...prev];
                                                    next[draftIndex] = { ...next[draftIndex], cardNetwork: checked ? network : "" };
                                                    return next;
                                                  });
                                                }}
                                                className="h-4 w-4 accent-emerald-600"
                                              />
                                              {network}
                                            </label>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                    {needsRef && (
                                      <div className="mt-2">
                                        <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">
                                          {variant === "tamara" ? "Tamara reference" : "Tabby reference"}
                                        </label>
                                        <input
                                          value={row.providerReferenceNumber}
                                          onChange={(e) => {
                                            const val = e.target.value;
                                            setPlanPaymentDrafts((prev) => {
                                              const next = [...prev];
                                              next[draftIndex] = { ...next[draftIndex], providerReferenceNumber: val };
                                              return next;
                                            });
                                          }}
                                          placeholder={variant === "tamara" ? "Tamara reference number" : "Tabby reference number"}
                                          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-300"
                                        />
                                      </div>
                                    )}
                                    {isTabbyCard && (
                                      <div className="mt-2">
                                        <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Terminal auth (optional)</label>
                                        <input
                                          value={row.terminalAuthorizationCode}
                                          onChange={(e) => {
                                            const val = e.target.value;
                                            setPlanPaymentDrafts((prev) => {
                                              const next = [...prev];
                                              next[draftIndex] = { ...next[draftIndex], terminalAuthorizationCode: val };
                                              return next;
                                            });
                                          }}
                                          placeholder="Authorization code"
                                          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-300"
                                        />
                                      </div>
                                    )}
                                    {rowComputed && (rowComputed.feeAmount > 0 || rowComputed.customerChargedAmount > 0) && (
                                      <div className="mt-2 rounded-xl border border-cyan-200 bg-cyan-50 p-2 text-xs text-cyan-900">
                                        {rowComputed.feeAmount > 0 && (
                                          <div className="flex justify-between">
                                            <span>Fee ({(rowComputed.feeRate * 100).toFixed(1)}%)</span>
                                            <span className="font-semibold">AED {rowComputed.feeAmount.toFixed(2)}</span>
                                          </div>
                                        )}
                                        <div className="mt-1 flex justify-between border-t border-cyan-200 pt-1 font-bold">
                                          <span>Collect</span>
                                          <span>AED {rowComputed.customerChargedAmount.toFixed(2)}</span>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                              {planPaymentMode === "Split Payment" && (
                                <button
                                  type="button"
                                  onClick={() => setPlanPaymentDrafts((prev) => [...prev, newPlanAllocationDraft("", "0.00")])}
                                  className="w-full rounded-xl border border-dashed border-emerald-300 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
                                >
                                  + Add method
                                </button>
                              )}
                              {/* Summary */}
                              {planPaymentDrafts.length > 0 && (() => {
                                const invoiceAmt = parseFloat(planPaymentAmount) || 0;
                                if (invoiceAmt <= 0) return null;
                                const allocs = buildPaymentAllocations(planPaymentDrafts, invoiceAmt, invoiceAmt, 0);
                                const totalFee = allocs.reduce((sum, a) => sum + a.feeAmount, 0);
                                const totalCharged = allocs.reduce((sum, a) => sum + a.customerChargedAmount, 0);
                                if (totalFee <= 0 && allocs.length < 2) return null;
                                return (
                                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700">
                                    <div className="flex justify-between"><span>Invoice settled</span><span>AED {invoiceAmt.toFixed(2)}</span></div>
                                    {totalFee > 0 && <div className="flex justify-between text-cyan-700"><span>Total fee</span><span>AED {totalFee.toFixed(2)}</span></div>}
                                    <div className="mt-1 flex justify-between border-t border-slate-200 pt-1 font-bold text-slate-900">
                                      <span>Total customer pays</span><span>AED {totalCharged.toFixed(2)}</span>
                                    </div>
                                  </div>
                                );
                              })()}
                              {/* Validation errors */}
                              {planPaymentValidationErrors.length > 0 && (
                                <div className="rounded-xl border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700">
                                  {[...new Set(planPaymentValidationErrors)].map((msg) => <p key={msg}>• {msg}</p>)}
                                </div>
                              )}
                              <div className="flex gap-2">
                                <button
                                  onClick={() => saveTreatmentPayment(plan)}
                                  disabled={savingTreatmentPayment}
                                  className="rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
                                >
                                  {savingTreatmentPayment ? "Saving…" : "Collect & Print Receipt"}
                                </button>
                                <button
                                  onClick={() => { setPaymentPlanId(null); setPlanPaymentValidationErrors([]); }}
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

              {/* Imported Treatment History */}
              {historicalVisits.length > 0 && (
                <div className="rounded-3xl border border-slate-200 bg-white p-5">
                  <button
                    type="button"
                    onClick={() => toggleProfileSection("imported")}
                    className="flex w-full items-center justify-between text-left"
                  >
                    <span className="text-sm font-bold uppercase tracking-wide text-slate-700">Past Treatments (Imported)</span>
                    <span className="text-xs font-semibold text-slate-500">
                      {historicalVisits.length} record{historicalVisits.length === 1 ? "" : "s"} {isProfileSectionOpen("imported") ? "▲" : "▼"}
                    </span>
                  </button>

                  {isProfileSectionOpen("imported") && (
                    <div className="mt-3 space-y-3">
                      {historicalVisits.map((hv) => (
                        <div key={hv.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                {hv.visit_date
                                  ? new Date(hv.visit_date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
                                  : "Date unknown"}
                              </p>
                              {hv.original_dentist_name && (
                                <p className="mt-0.5 text-xs text-slate-400">Dr. {hv.original_dentist_name}</p>
                              )}
                            </div>
                            {hv.fee_aed != null && (
                              <span className="shrink-0 rounded-full bg-indigo-100 px-2.5 py-1 text-xs font-bold text-indigo-700">
                                AED {Number(hv.fee_aed).toFixed(2)}
                              </span>
                            )}
                          </div>
                          {hv.treatment_description && (
                            <p className="mt-2 text-sm text-slate-700">{hv.treatment_description}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
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

      {savedTreatmentPlanActionContext && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-md rounded-3xl border border-cyan-100 bg-white p-6 shadow-2xl">
            <p className="text-xs font-bold uppercase tracking-[0.3em] text-cyan-700">Treatment Plan Saved</p>
            <h3 className="mt-2 text-xl font-semibold text-slate-900">Do you want to print it?</h3>
            <p className="mt-2 text-sm text-slate-600">
              Choose how you want to share this active treatment plan.
            </p>

            <div className="mt-5 grid gap-3">
              <button
                onClick={() => printHtmlWhenImagesReady(buildTreatmentPlanSummaryHtml(savedTreatmentPlanActionContext), "Please allow popups to print the treatment plan.")}
                className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
              >
                Print Summary
              </button>
              <button
                onClick={() => printHtmlWhenImagesReady(buildTreatmentPlanSummaryHtml(savedTreatmentPlanActionContext), "Please allow popups to print the treatment plan.")}
                className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-700 transition hover:bg-amber-100"
              >
                🖨 Print A4 Invoice
              </button>
              <button
                onClick={() => setSavedTreatmentPlanActionContext(null)}
                className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

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
  clinic: ClinicRecord | null;
}) {
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [services, setServices] = useState<LookupItem[]>([]);
  const [doctors, setDoctors] = useState<LookupItem[]>([]);
  const [allReceptionists, setAllReceptionists] = useState<LookupItem[]>([]);
  const [treatmentPlanPayments, setTreatmentPlanPayments] = useState<TreatmentPlanPaymentRecord[]>([]);
  const [legacyTreatmentPlanPayments, setLegacyTreatmentPlanPayments] = useState<TreatmentPlanPayment[]>([]);
  const [treatmentPlanAllocations, setTreatmentPlanAllocations] = useState<TreatmentPlanPaymentAllocation[]>([]);
  const [treatmentPlans, setTreatmentPlans] = useState<TreatmentPlan[]>([]);
  const [receiptItemsMap, setReceiptItemsMap] = useState<Record<string, any[]>>({});
  const [refundsMap, setRefundsMap] = useState<Record<string, any[]>>({});
  const [paymentRecordIdsMap, setPaymentRecordIdsMap] = useState<Record<string, string[]>>({});
  const [paymentAllocationsMap, setPaymentAllocationsMap] = useState<Record<string, PaymentAllocation[]>>({});
  const [expandedReceiptId, setExpandedReceiptId] = useState<string | null>(null);
  const [loadingItemsFor, setLoadingItemsFor] = useState<string | null>(null);

  const [view, setView] = useState<"list" | "refund">("list");
  const [refundTargetReceipt, setRefundTargetReceipt] = useState<Receipt | null>(null);
  const [refundItems, setRefundItems] = useState<any[]>([]);
  const [checkedItems, setCheckedItems] = useState<Record<string, boolean>>({});
  const [checkedRefundAllocations, setCheckedRefundAllocations] = useState<Record<string, boolean>>({});
  const [refundAllocationAmountInputs, setRefundAllocationAmountInputs] = useState<Record<string, string>>({});
  const [refundAll, setRefundAll] = useState(false);
  const [refundReason, setRefundReason] = useState("");
  const [isProcessingRefund, setIsProcessingRefund] = useState(false);
  const [downloadingTreatmentPlanInvoiceId, setDownloadingTreatmentPlanInvoiceId] = useState<string | null>(null);
  const [downloadingRegularReceiptId, setDownloadingRegularReceiptId] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setView("list");
      setExpandedReceiptId(null);
      setReceiptItemsMap({});
      setRefundsMap({});
      setPaymentRecordIdsMap({});
      setPaymentAllocationsMap({});
      loadHistory();
    }
  }, [isOpen]);

  async function fetchAllRows(table: string, select: string): Promise<any[]> {
    const BATCH = 1000;
    let all: any[] = [];
    let from = 0;
    while (true) {
      const { data, error } = await supabase
        .from(table)
        .select(select)
        .range(from, from + BATCH - 1);
      if (error || !data || data.length === 0) break;
      all = all.concat(data);
      if (data.length < BATCH) break;
      from += BATCH;
    }
    return all;
  }

  async function loadHistory() {
    if (!clinicId) {
      setReceipts([]);
      setPatients([]);
      setTreatmentPlanPayments([]);
      setLegacyTreatmentPlanPayments([]);
      setTreatmentPlanAllocations([]);
      setTreatmentPlans([]);
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
      setTreatmentPlanPayments([]);
      setLegacyTreatmentPlanPayments([]);
      setTreatmentPlanAllocations([]);
      setTreatmentPlans([]);
      return;
    }

    const [receiptResult, patientResult, servicesResult, doctorsResult, receptionistsResult, treatmentPlanResult, treatmentPlanPaymentResult, legacyTreatmentPlanPaymentsResult, treatmentPlanAllocationResult] = await Promise.all([
      supabase.from("receipts").select("*").in("receptionist_id", receptionistIds).order("created_at", { ascending: false }),
      fetchAllRows("patients", "id, name, phone, patient_number"),
      supabase.from("services").select("id, name"),
      supabase.from("doctors").select("id, name"),
      supabase.from("receptionist").select("id, name"),
      supabase.from("treatment_plans").select("*").in("created_by", receptionistIds).order("created_at", { ascending: false }),
      supabase.from("treatment_plan_payment_records").select("*").in("receptionist_id", receptionistIds).order("created_at", { ascending: false }),
      supabase.from("treatment_plan_payments").select("*").in("receptionist_id", receptionistIds).order("created_at", { ascending: false }),
      supabase.from("treatment_plan_payment_allocations").select("*").order("created_at", { ascending: false }),
    ]);

    const loadedReceipts = (receiptResult.data as Receipt[]) || [];
    const loadedPatients = ((patientResult as Patient[]) || []).map((p) => ({ ...p }));
    const patientIds = [...new Set([
      ...loadedReceipts.map((r) => String(r.patient_id || "")).filter(Boolean),
      ...((treatmentPlanPaymentResult.data as TreatmentPlanPaymentRecord[]) || []).map((r) => String(r.patient_id || "")).filter(Boolean),
    ])];
    if (patientIds.length > 0) {
      const { data: clinicFiles } = await supabase
        .from("clinic_patient_files")
        .select("patient_id, file_no")
        .eq("clinic_id", clinicId)
        .in("patient_id", patientIds);
      const fileNoByPatientId = new Map<string, string>();
      (clinicFiles || []).forEach((f: any) => {
        fileNoByPatientId.set(String(f.patient_id), String(f.file_no || ""));
      });
      loadedPatients.forEach((p) => {
        p.clinic_file_no = fileNoByPatientId.get(String(p.id)) || null;
      });
    }

    setReceipts(loadedReceipts);
    setPatients(loadedPatients);
    setServices((servicesResult.data as LookupItem[]) || []);
    setDoctors((doctorsResult.data as LookupItem[]) || []);
    setAllReceptionists((receptionistsResult.data as LookupItem[]) || []);
    setTreatmentPlans((treatmentPlanResult.data as TreatmentPlan[]) || []);
    setTreatmentPlanPayments((treatmentPlanPaymentResult.data as TreatmentPlanPaymentRecord[]) || []);
    setLegacyTreatmentPlanPayments((legacyTreatmentPlanPaymentsResult.data as TreatmentPlanPayment[]) || []);
    setTreatmentPlanAllocations((treatmentPlanAllocationResult.data as TreatmentPlanPaymentAllocation[]) || []);
  }

  function remainingAfterPayment(plan: TreatmentPlan | null, paymentDate: string | null | undefined) {
    if (!plan) return 0;
    return computeTreatmentPlanRollup(plan, {
      structuredPayments: treatmentPlanPayments.filter((entry) => entry.treatment_plan_id === plan.id),
      legacyPayments: legacyTreatmentPlanPayments.filter((entry) => entry.treatment_plan_id === plan.id),
      asOf: paymentDate || undefined,
    }).remainingBalance;
  }

  async function loadReceiptItems(receiptId: string) {
    if (receiptItemsMap[receiptId] && refundsMap[receiptId] && paymentRecordIdsMap[receiptId] && paymentAllocationsMap[receiptId]) {
      return {
        items: receiptItemsMap[receiptId] || [],
        refunds: refundsMap[receiptId] || [],
        paymentRecordIds: paymentRecordIdsMap[receiptId] || [],
        allocations: paymentAllocationsMap[receiptId] || [],
      };
    }
    setLoadingItemsFor(receiptId);
    const [itemsRes, refundsRes, paymentRecordsRes] = await Promise.all([
      supabase.from("receipt_items").select("*").eq("receipt_id", receiptId),
      supabase.from("refunds").select("*").eq("receipt_id", receiptId).order("created_at", { ascending: false }),
      supabase.from("payment_records").select("id").eq("receipt_id", receiptId).order("created_at", { ascending: false }),
    ]);
    const loadedItems = itemsRes.data || [];
    const loadedRefunds = refundsRes.data || [];
    setReceiptItemsMap((prev) => ({ ...prev, [receiptId]: loadedItems }));
    setRefundsMap((prev) => ({ ...prev, [receiptId]: loadedRefunds }));
    const paymentRecordIds = (paymentRecordsRes.data || []).map((row: { id: string }) => row.id).filter(Boolean);
    setPaymentRecordIdsMap((prev) => ({ ...prev, [receiptId]: paymentRecordIds }));
    let loadedAllocations: PaymentAllocation[] = [];
    if (paymentRecordIds.length > 0) {
      const { data: allocationRows } = await supabase
        .from("payment_allocations")
        .select("*")
        .in("payment_id", paymentRecordIds)
        .order("created_at", { ascending: true });
      loadedAllocations = (allocationRows || []) as PaymentAllocation[];
      setPaymentAllocationsMap((prev) => ({ ...prev, [receiptId]: loadedAllocations }));
    } else {
      setPaymentAllocationsMap((prev) => ({ ...prev, [receiptId]: [] }));
    }
    setLoadingItemsFor(null);
    return {
      items: loadedItems,
      refunds: loadedRefunds,
      paymentRecordIds,
      allocations: loadedAllocations,
    };
  }

  const treatmentPlanPaymentEntries = useMemo(() => {
    return treatmentPlanPayments.map((record) => {
      const plan = treatmentPlans.find((entry) => entry.id === record.treatment_plan_id) || null;
      const allocations = treatmentPlanAllocations.filter((allocation) => allocation.payment_id === record.id);
      return {
        record,
        plan,
        allocations,
      };
    });
  }, [treatmentPlanAllocations, treatmentPlanPayments, treatmentPlans]);

  function toggleExpand(receiptId: string) {
    if (expandedReceiptId === receiptId) {
      setExpandedReceiptId(null);
    } else {
      setExpandedReceiptId(receiptId);
      loadReceiptItems(receiptId);
    }
  }

  const refundTargetAllocations = useMemo(
    () => (refundTargetReceipt ? (paymentAllocationsMap[refundTargetReceipt.id] || []) : []),
    [paymentAllocationsMap, refundTargetReceipt]
  );

  const refundTargetPaymentRecordCount = useMemo(
    () => (refundTargetReceipt ? (paymentRecordIdsMap[refundTargetReceipt.id] || []).length : 0),
    [paymentRecordIdsMap, refundTargetReceipt]
  );
  const refundMode = useMemo(
    () => resolveRefundProcessingMode({ paymentRecordCount: refundTargetPaymentRecordCount, allocationCount: refundTargetAllocations.length }),
    [refundTargetAllocations.length, refundTargetPaymentRecordCount]
  );
  const modernMaxRefundableAmount = useMemo(
    () => calculateAllocationMaxRefundableInvoiceAmount(refundTargetAllocations),
    [refundTargetAllocations]
  );
  const selectedRefundItemRows = useMemo(
    () => (refundAll ? refundItems : refundItems.filter((item) => checkedItems[item.id])),
    [checkedItems, refundAll, refundItems]
  );

  const refundTargetTotal = useMemo(() => {
    if (!refundTargetReceipt) return 0;
    if (refundAll) {
      if (refundMode === "modern") return modernMaxRefundableAmount;
      return calculateReceiptMaxRefundableAmount(refundTargetReceipt, refundsMap[refundTargetReceipt.id] || []);
    }
    return calculateReceiptItemsRefundTotal(refundTargetReceipt, selectedRefundItemRows);
  }, [modernMaxRefundableAmount, refundAll, refundMode, refundTargetReceipt, refundsMap, selectedRefundItemRows]);

  const selectedRefundAllocationIds = useMemo(
    () => Object.entries(checkedRefundAllocations).filter(([, value]) => value).map(([key]) => key),
    [checkedRefundAllocations]
  );

  const selectedRefundAllocationTotal = useMemo(
    () => selectedRefundAllocationIds.reduce((sum, id) => sum + Number(refundAllocationAmountInputs[id] || 0), 0),
    [refundAllocationAmountInputs, selectedRefundAllocationIds]
  );

  function rebalanceRefundAllocationInputs(nextCheckedAllocations: Record<string, boolean>, nextRefundTotal: number) {
    const nextSelectedIds = Object.entries(nextCheckedAllocations).filter(([, value]) => value).map(([key]) => key);
    setRefundAllocationAmountInputs(
      nextSelectedIds.length > 0
        ? autoAllocateRefundAmounts(nextRefundTotal, refundTargetAllocations, nextSelectedIds)
        : {}
    );
  }

  function handleRefundItemToggle(itemId: string, checked: boolean) {
    if (!refundTargetReceipt) return;
    setCheckedItems((prev) => {
      const next = { ...prev, [itemId]: checked };
      if (refundMode === "modern" && !refundAll) {
        const nextItems = refundItems.filter((item) => next[item.id]);
        const nextTotal = calculateReceiptItemsRefundTotal(refundTargetReceipt, nextItems);
        rebalanceRefundAllocationInputs(checkedRefundAllocations, nextTotal);
      }
      return next;
    });
  }

  function toggleRefundAllocation(allocationId: string) {
    if (refundMode !== "modern") return;
    setCheckedRefundAllocations((prev) => {
      const next = { ...prev, [allocationId]: !prev[allocationId] };
      rebalanceRefundAllocationInputs(next, refundTargetTotal);
      return next;
    });
  }

  function handleRefundAllToggle(checked: boolean) {
    if (!refundTargetReceipt) return;
    setRefundAll(checked);
    if (refundMode !== "modern") {
      if (checked) setCheckedItems({});
      return;
    }
    if (checked) {
      setCheckedItems({});
      rebalanceRefundAllocationInputs(checkedRefundAllocations, modernMaxRefundableAmount);
      return;
    }
    rebalanceRefundAllocationInputs(checkedRefundAllocations, 0);
  }

  async function startRefund(receipt: Receipt) {
    const loaded = await loadReceiptItems(receipt.id);
    const allocations = loaded?.allocations || paymentAllocationsMap[receipt.id] || [];
    const paymentRecordCount = (loaded?.paymentRecordIds || paymentRecordIdsMap[receipt.id] || []).length;
    const mode = resolveRefundProcessingMode({ paymentRecordCount, allocationCount: allocations.length });
    setRefundTargetReceipt(receipt);
    setRefundItems(loaded?.items || receiptItemsMap[receipt.id] || []);
    setCheckedItems({});
    const initialCheckedAllocations = mode === "modern"
      ? Object.fromEntries(allocations.map((allocation) => [allocation.id, true]))
      : {};
    setCheckedRefundAllocations(initialCheckedAllocations);
    setRefundAllocationAmountInputs(
      mode === "modern"
        ? autoAllocateRefundAmounts(0, allocations, allocations.map((allocation) => allocation.id))
        : {}
    );
    setRefundAll(false);
    setRefundReason("");
    setView("refund");
  }

  function printTreatmentPlanPaymentRecord(record: TreatmentPlanPaymentRecord, plan: TreatmentPlan | null, allocations: TreatmentPlanPaymentAllocation[]) {
    const patient = patients.find((p) => p.id === record.patient_id);
    const receptionist = allReceptionists.find((r) => r.id === record.receptionist_id);
    const treatmentPlanReceiptAllocations = allocations.map((allocation) => ({
      methodLabel: allocation.method_variant ? allocation.method_variant.replace(/_/g, " ").toUpperCase() : "Payment",
      invoiceAllocationAmount: Number(allocation.invoice_allocation_amount || 0),
      feeAmount: Number(allocation.fee_amount || 0),
      customerChargedAmount: Number(allocation.customer_charged_amount || 0),
      providerReferenceNumber: allocation.provider_reference_number,
      terminalAuthorizationCode: allocation.terminal_authorization_code,
    }));

    printTreatmentPlanPaymentReceipt({
      clinic,
      patientName: patient?.name || "-",
      patientFileNo: patient?.clinic_file_no || (patient?.patient_number != null ? String(patient.patient_number) : undefined),
      planTitle: plan?.title || "Treatment plan payment",
      paymentArrangement: plan?.payment_arrangement || "Treatment plan payment",
      agreedTotal: Number(plan?.total_amount || record.total_invoice_amount_settled || 0),
      amountSettledToday: Number(record.total_invoice_amount_settled || 0),
      remainingAfterToday: remainingAfterPayment(plan, record.created_at),
      totalFeeAmount: Number(record.total_payment_fee_amount || 0),
      totalCustomerPaid: Number(record.total_customer_charged_amount || 0),
      cashierName: receptionist?.name || "Reception",
      services: plan ? [{ name: plan.title, price: Number(record.total_invoice_amount_settled || 0), quantity: 1 }] : [],
      allocations: treatmentPlanReceiptAllocations,
      createdAt: record.created_at,
      referenceNo: `TPP-${String(record.id).slice(0, 8).toUpperCase()}`,
    });
  }

  function printTreatmentPlanPaymentInvoice(record: TreatmentPlanPaymentRecord, plan: TreatmentPlan | null, allocations: TreatmentPlanPaymentAllocation[]) {
    const patient = patients.find((p) => p.id === record.patient_id);
    const receptionist = allReceptionists.find((r) => r.id === record.receptionist_id);
    const html = generateTreatmentPlanPaymentInvoiceHtml({
      clinic,
      receiptNumber: `TPP-${String(record.id).slice(0, 8).toUpperCase()}`,
      issuedAt: new Date(record.created_at || Date.now()),
      cashierName: receptionist?.name || "Reception",
      patient: {
        name: patient?.name || "-",
        phone: null,
        fileNumber: patient?.clinic_file_no || (patient?.patient_number != null ? String(patient.patient_number) : undefined),
      },
      doctorName: null,
      planTitle: plan?.title || "Treatment plan payment",
      planTotalAmount: Number(plan?.total_amount || record.total_invoice_amount_settled || 0),
      amountSettledToday: Number(record.total_invoice_amount_settled || 0),
      paymentFeeAmount: Number(record.total_payment_fee_amount || 0),
      paymentAllocations: allocations.map((allocation) => ({
        methodLabel: allocation.method_variant ? allocation.method_variant.replace(/_/g, " ").toUpperCase() : "Payment",
        invoiceAllocationAmount: Number(allocation.invoice_allocation_amount || 0),
        feeAmount: Number(allocation.fee_amount || 0),
        customerChargedAmount: Number(allocation.customer_charged_amount || 0),
        providerReferenceNumber: allocation.provider_reference_number,
        terminalAuthorizationCode: allocation.terminal_authorization_code,
      })),
      remainingAfterToday: remainingAfterPayment(plan, record.created_at),
      plannedVisits: plan?.planned_visits ?? null,
      completedVisits: plan?.clinic_patient_file_id ? 1 : 0,
      notes: plan?.notes || null,
    });
    printHtmlWhenImagesReady(html, "Please allow popups to print the invoice.");
  }

  async function downloadTreatmentPlanPaymentInvoice(record: TreatmentPlanPaymentRecord, plan: TreatmentPlan | null, allocations: TreatmentPlanPaymentAllocation[]) {
    const patient = patients.find((p) => p.id === record.patient_id);
    const receptionist = allReceptionists.find((r) => r.id === record.receptionist_id);
    const html = generateTreatmentPlanPaymentInvoiceHtml({
      clinic,
      receiptNumber: `TPP-${String(record.id).slice(0, 8).toUpperCase()}`,
      issuedAt: new Date(record.created_at || Date.now()),
      cashierName: receptionist?.name || "Reception",
      patient: {
        name: patient?.name || "-",
        phone: null,
        fileNumber: patient?.clinic_file_no || (patient?.patient_number != null ? String(patient.patient_number) : undefined),
      },
      doctorName: null,
      planTitle: plan?.title || "Treatment plan payment",
      planTotalAmount: Number(plan?.total_amount || record.total_invoice_amount_settled || 0),
      amountSettledToday: Number(record.total_invoice_amount_settled || 0),
      paymentFeeAmount: Number(record.total_payment_fee_amount || 0),
      paymentAllocations: allocations.map((allocation) => ({
        methodLabel: allocation.method_variant ? allocation.method_variant.replace(/_/g, " ").toUpperCase() : "Payment",
        invoiceAllocationAmount: Number(allocation.invoice_allocation_amount || 0),
        feeAmount: Number(allocation.fee_amount || 0),
        customerChargedAmount: Number(allocation.customer_charged_amount || 0),
        providerReferenceNumber: allocation.provider_reference_number,
        terminalAuthorizationCode: allocation.terminal_authorization_code,
      })),
      remainingAfterToday: remainingAfterPayment(plan, record.created_at),
      plannedVisits: plan?.planned_visits ?? null,
      completedVisits: plan?.clinic_patient_file_id ? 1 : 0,
      notes: plan?.notes || null,
    });
    printHtmlWhenImagesReady(html, "Please allow popups to print the invoice.");
  }

  // Refunds can't exceed money actually collected: partial-payment receipts
  // only took amount_paid (NULL = paid in full), minus prior refunds.
  function maxRefundableFor(receipt: Receipt): number {
    if (refundMode === "modern") return modernMaxRefundableAmount;
    return calculateReceiptMaxRefundableAmount(receipt, refundsMap[receipt.id] || []);
  }

  function calcRefundTotal(): number {
    if (!refundTargetReceipt) return 0;
    if (refundAll) return maxRefundableFor(refundTargetReceipt);
    return calculateReceiptItemsRefundTotal(refundTargetReceipt, selectedRefundItemRows);
  }

  async function processRefund() {
    if (!refundTargetReceipt) return;
    if (!refundReason.trim()) { alert("Please enter a reason."); return; }
    if (!refundAll && selectedRefundItemRows.length === 0) { alert("Select at least one item."); return; }
    if (refundMode === "admin_review") {
      alert("This receipt has a payment record but no payment allocations. Refund is blocked for safety. Please ask admin to review this receipt.");
      return;
    }

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

    const baseRefundItemRows = selectedRefundItemRows.map((item) => ({
      receipt_item_id: item.id,
      service_id: item.service_id,
      service_name: services.find((s) => s.id === item.service_id)?.name || "Unknown",
      amount: Number(item.total || item.price || 0),
    }));

    let result:
      | { kind: "modern"; refundData: any; warningMessage?: string }
      | { kind: "legacy"; refundData: any };
    if (refundMode === "legacy") {
      try {
        const legacyResult = await createLegacyBackedRefund({
          supabase,
          receiptId: refundTargetReceipt.id,
          receptionistId: refundTargetReceipt.receptionist_id,
          refundedBy: null,
          reason: refundReason.trim(),
          totalAmount: totalRefund,
          paymentMethod: refundTargetReceipt.payment_method || "Legacy receipt refund",
          refundItemRows: baseRefundItemRows,
        });
        result = { kind: "legacy", refundData: legacyResult.refundData };
      } catch (error) {
        alert(`Error: ${error instanceof Error ? error.message : String(error)}`);
        setIsProcessingRefund(false);
        return;
      }
    } else {
      const { requests, error } = buildAllocationRefundRequests({
        allocations: refundTargetAllocations,
        selectedAllocationIds: selectedRefundAllocationIds,
        requestedAmountsByAllocationId: refundAllocationAmountInputs,
        expectedRefundAmount: totalRefund,
      });
      if (error) {
        alert(error);
        setIsProcessingRefund(false);
        return;
      }
      try {
        const modernResult = await createAllocationBackedRefund({
          supabase,
          receiptId: refundTargetReceipt.id,
          receptionistId: refundTargetReceipt.receptionist_id,
          processedBy: refundTargetReceipt.receptionist_id,
          refundedBy: null,
          reason: refundReason.trim(),
          requests,
          refundItemRows: baseRefundItemRows,
        });
        result = { kind: "modern", refundData: modernResult.refundData, warningMessage: modernResult.warningMessage };
      } catch (error) {
        alert(`Error: ${error instanceof Error ? error.message : String(error)}`);
        setIsProcessingRefund(false);
        return;
      }
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
      [refundTargetReceipt.id]: [result.refundData, ...(prev[refundTargetReceipt.id] || [])],
    }));
    setIsProcessingRefund(false);
    if (result.kind === "modern" && result.warningMessage) {
      alert(result.warningMessage);
    }
    setView("list");
    alert(`Refund of AED ${Number(result.refundData.total_amount || totalRefund).toFixed(2)} processed successfully.`);
  }

  async function reprintReceipt(receipt: Receipt) {
    let receiptItems = receiptItemsMap[receipt.id] || [];
    
    // Load items if not already in the map
    if (receiptItems.length === 0) {
      const { data } = await supabase.from("receipt_items").select("*").eq("receipt_id", receipt.id);
      receiptItems = data || [];
    }
    
    const receptionist = allReceptionists.find((r) => r.id === receipt.receptionist_id);
    const receiptDate = receipt.created_at ? new Date(receipt.created_at) : new Date();
    const dateValue = receiptDate.toLocaleDateString("en-GB");
    const timeValue = receiptDate.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
    const patient = patients.find((p) => p.id === receipt.patient_id);
    const patientFileNo = patient?.clinic_file_no
      ? `#${String(patient.clinic_file_no)}`
      : patient?.patient_number
      ? `#${String(patient.patient_number).padStart(5, "0")}`
      : "-";
    
    const renderLines = receiptItems.map((item) => {
      const service = services.find((s) => s.id === item.service_id);
      return mapRegularReceiptRenderLine(item, {
        serviceName: service?.name || "Service",
        fallbackOriginalUnitPrice: item.original_price != null
          ? Number(item.original_price)
          : service?.standard_price != null
            ? Number(service.standard_price)
            : service?.price != null
              ? Number(service.price)
              : null,
      });
    });
    const thermalItems = renderLines.map((line) => ({
      name: line.name,
      quantity: line.quantity,
      price: line.soldUnitPrice,
      originalPrice: line.originalUnitPrice ?? undefined,
      allocatedGlobalDiscountAmount: line.allocatedGlobalDiscountAmount,
      taxableAmount: line.taxableAmount ?? undefined,
      vatRate: line.vatRate ?? undefined,
      vatAmount: line.vatAmount ?? undefined,
      finalLineTotal: line.finalLineTotal ?? undefined,
      teeth: line.teeth,
    }));
    const summary = summarizeRegularReceiptForRender(receipt as any, renderLines);

    const options: BuildThermalReceiptHtmlOptions = {
      title: "REPRINT",
      clinic,
      invoiceNumber: receipt.receipt_number
        ? `#${String(receipt.receipt_number).padStart(5, "0")}`
        : `#${String(receipt.id).slice(0, 8).toUpperCase()}`,
      dateValue,
      timeValue,
      cashierName: receptionist?.name || "Reception",
      doctorName: doctors.find((d) => d.id === receipt.doctor_id)?.name || "-",
      patientName: patient?.name || "-",
      patientPhone: patient?.phone || "-",
      patientFileNumber: patientFileNo,
      doctorField: doctors.find((d) => d.id === receipt.doctor_id)?.name || "-",
      items: thermalItems,
      subtotal: summary.subtotal,
      discountAmount: summary.discountAmount,
      vat: summary.vat,
      total: summary.invoiceTotalBeforeGatewayFee,
      paymentFeeAmount: summary.paymentFeeAmount,
      allocations: [],
      manualDiscountAmount: summary.useSnapshotSummary ? summary.manualDiscountAmount : undefined,
      globalDiscountAmount: summary.useSnapshotSummary ? summary.globalDiscountAmount : undefined,
      creditUsed: Number(receipt.credit_applied || 0),
      outstandingBalance: receipt.amount_paid != null 
        ? Math.max(0, Number(receipt.total || 0) - Number(receipt.amount_paid))
        : 0,
      paymentMethod: receipt.payment_method || "-",
      notes: receipt.notes || "",
    };

    const html = buildThermalReceiptHtml(options);
    printHtmlWhenImagesReady(html, "Please allow popups to print.");
  }

  async function downloadRegularReceiptInvoice(receipt: Receipt) {
    const receptionist = allReceptionists.find((r) => r.id === receipt.receptionist_id);
    const clinicForReceipt = clinic || null;
    const patient = patients.find((p) => p.id === receipt.patient_id);
    const doctorName = doctors.find((d) => d.id === receipt.doctor_id)?.name || null;
    let receiptItems = receiptItemsMap[receipt.id] || [];
    
    if (receiptItems.length === 0) {
      const { data } = await supabase.from("receipt_items").select("*").eq("receipt_id", receipt.id);
      receiptItems = data || [];
    }

    const renderLines = receiptItems.map((item: any) => {
      const service = services.find((s) => s.id === item.service_id);
      return mapRegularReceiptRenderLine(item, {
        serviceName: service?.name || "Service",
        fallbackOriginalUnitPrice: item.original_price != null
          ? Number(item.original_price)
          : service?.standard_price != null
            ? Number(service.standard_price)
            : service?.price != null
              ? Number(service.price)
              : null,
      });
    });
    const summary = summarizeRegularReceiptForRender(receipt as any, renderLines);
    const total = summary.finalTotal;
    const paidAtSale = receipt.amount_paid != null ? Number(receipt.amount_paid) : total;
    const creditAtSale = Number(receipt.credit_applied || 0);
    const outstandingBalance = Math.max(0, total - paidAtSale - creditAtSale);

    const html = generateInvoiceHtml({
      clinic: clinicForReceipt,
      receiptNumber: receipt.receipt_number ? `#${String(receipt.receipt_number).padStart(5, "0")}` : `#${receipt.id.slice(0, 8)}`,
      invoiceStatus: outstandingBalance > 0.005 ? "PARTIALLY PAID" : "PAID",
      issuedAt: receipt.created_at ? new Date(receipt.created_at) : new Date(),
      posReceiptNumber: receipt.receipt_number ? `#${String(receipt.receipt_number).padStart(5, "0")}` : undefined,
      cashierName: receptionist?.name || "Reception",
      patient: {
        name: patient?.name || "-",
        phone: patient?.phone || null,
        fileNumber: patient?.clinic_file_no || (patient?.patient_number != null ? String(patient.patient_number) : undefined),
      },
      doctorName,
      items: renderLines.map((line) => ({
        description: line.name,
        quantity: line.quantity,
        originalUnitPrice: line.originalUnitPrice,
        unitPrice: line.soldUnitPrice,
        discountAmount: line.totalDiscountAmount,
        allocatedGlobalDiscountAmount: line.allocatedGlobalDiscountAmount,
        taxableAmount: line.taxableAmount ?? undefined,
        vatRate: line.vatRate ?? undefined,
        vatAmount: line.vatAmount ?? undefined,
        finalLineTotal: line.finalLineTotal ?? undefined,
      })),
      totalDiscount: summary.discountAmount,
      vatAmount: summary.vat,
      paymentFeeAmount: summary.paymentFeeAmount,
      grandTotal: total,
      amountPaid: paidAtSale,
      outstandingBalance,
      notes: receipt.notes || null,
    });
    printHtmlWhenImagesReady(html, "Please allow popups to print the invoice.");
  }

  function formatReceiptNo(receipt: Receipt) {
    return receipt.receipt_number ? `#${String(receipt.receipt_number).padStart(5, "0")}` : `#${receipt.id.slice(0, 8)}`;
  }

  function formatTreatmentPlanPaymentNo(record: TreatmentPlanPaymentRecord) {
    return `TPP-${String(record.id).slice(0, 8).toUpperCase()}`;
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
            <div className="space-y-4">
              {!clinicId ? (
                <p className="text-center text-sm text-slate-500">Open the register to view receipt history.</p>
              ) : receipts.length === 0 && treatmentPlanPaymentEntries.length === 0 ? (
                <p className="text-center text-sm text-slate-500">No receipts found</p>
              ) : (
                <>
                  {treatmentPlanPaymentEntries.length > 0 && (
                    <details className="rounded-2xl border border-cyan-100 bg-cyan-50/60 p-4">
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-bold text-cyan-900">Treatment Plan Payments</p>
                          <span className="rounded-full bg-cyan-100 px-2 py-0.5 text-xs font-semibold text-cyan-700">
                            {treatmentPlanPaymentEntries.length}
                          </span>
                        </div>
                        <span className="text-xs font-semibold text-cyan-700">Show / Hide</span>
                      </summary>
                      <div className="mt-3 space-y-3">
                        {treatmentPlanPaymentEntries.map(({ record, plan, allocations }) => {
                          const patient = patients.find((p) => p.id === record.patient_id);
                          return (
                            <div key={record.id} className="rounded-2xl border border-cyan-100 bg-white p-4 shadow-sm">
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <p className="text-sm font-semibold text-slate-900">{formatTreatmentPlanPaymentNo(record)}</p>
                                  <p className="mt-1 text-sm text-slate-600">{patient?.name || "Unknown patient"}</p>
                                  <p className="mt-1 text-xs text-slate-500">{plan?.title || "Treatment plan payment"}</p>
                                </div>
                                <div className="text-right">
                                  <p className="text-sm font-semibold text-cyan-700">AED {Number(record.total_customer_charged_amount || 0).toFixed(2)}</p>
                                  <p className="mt-1 text-xs text-slate-500">
                                    {record.created_at ? new Date(record.created_at).toLocaleString() : "No date"}
                                  </p>
                                </div>
                              </div>
                              <div className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
                                <div className="rounded-xl bg-slate-50 px-3 py-2">
                                  <p className="font-semibold text-slate-500">Invoice settled</p>
                                  <p className="font-bold text-slate-800">AED {Number(record.total_invoice_amount_settled || 0).toFixed(2)}</p>
                                </div>
                                <div className="rounded-xl bg-slate-50 px-3 py-2">
                                  <p className="font-semibold text-slate-500">Payment fee</p>
                                  <p className="font-bold text-slate-800">AED {Number(record.total_payment_fee_amount || 0).toFixed(2)}</p>
                                </div>
                                <div className="rounded-xl bg-slate-50 px-3 py-2 sm:col-span-2">
                                  <p className="font-semibold text-slate-500">Payment method</p>
                                  <p className="font-bold text-slate-800">{record.payment_method_summary || "-"}</p>
                                </div>
                              </div>
                              {allocations.length > 0 && (
                                <div className="mt-3 space-y-1 rounded-xl border border-cyan-100 bg-cyan-50 px-3 py-2 text-xs text-cyan-900">
                                  {allocations.map((allocation) => (
                                    <div key={allocation.id} className="flex items-center justify-between gap-3">
                                      <span>{allocation.method_variant ? allocation.method_variant.replace(/_/g, " ").toUpperCase() : "Payment"}</span>
                                      <span className="font-semibold">AED {Number(allocation.customer_charged_amount || 0).toFixed(2)}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                              <div className="mt-3 flex gap-2">
                                <button
                                  onClick={() => printTreatmentPlanPaymentRecord(record, plan, allocations)}
                                  className="flex-1 rounded-xl bg-slate-700 px-3 py-2 text-xs font-semibold text-white transition hover:bg-slate-600"
                                >
                                  Print Receipt
                                </button>
                                <button
                                  onClick={() => printTreatmentPlanPaymentInvoice(record, plan, allocations)}
                                  className="flex-1 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700 transition hover:bg-amber-100"
                                >
                                  Print A4 Invoice
                                </button>
                                
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </details>
                  )}

                  {receipts.length > 0 && (
                    <div className="space-y-3">
                      {receipts.map((receipt) => {
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
                                        onClick={() => {
                                          setDownloadingRegularReceiptId(receipt.id);
                                          downloadRegularReceiptInvoice(receipt)
                                            .finally(() => setDownloadingRegularReceiptId(null));
                                        }}
                                        disabled={downloadingRegularReceiptId === receipt.id}
                                        className="flex-1 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700 transition hover:bg-amber-100 disabled:opacity-60"
                                      >
                                        {downloadingRegularReceiptId === receipt.id ? "Generating…" : "Print A4 Invoice"}
                                      </button>
                                      <button
                                        onClick={() => startRefund(receipt)}
                                        className="flex-1 rounded-xl bg-amber-500 px-3 py-2 text-xs font-semibold text-white transition hover:bg-amber-400"
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
                </>
              )}
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
                  onChange={(e) => handleRefundAllToggle(e.target.checked)}
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
                          onChange={(e) => handleRefundItemToggle(item.id, e.target.checked)}
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

              {refundMode === "modern" && (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">Original payment allocations</p>
                      <p className="mt-0.5 text-xs text-slate-500">Choose which original payment method should fund this refund.</p>
                    </div>
                    <p className="text-sm font-semibold text-slate-700">Target: AED {refundTargetTotal.toFixed(2)}</p>
                  </div>
                  <div className="mt-3 space-y-2">
                    {refundTargetAllocations.map((allocation) => {
                      const remaining = getRemainingAllocationAmounts(allocation);
                      return (
                        <label key={allocation.id} className="block rounded-2xl border border-slate-200 bg-white p-3">
                          <div className="flex items-start gap-3">
                            <input
                              type="checkbox"
                              checked={!!checkedRefundAllocations[allocation.id]}
                              onChange={() => toggleRefundAllocation(allocation.id)}
                              className="mt-1 h-4 w-4 rounded accent-teal-500"
                            />
                            <div className="flex-1">
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <p className="text-sm font-semibold text-slate-900">{paymentVariantLabel(allocation.method_variant)}</p>
                                  <p className="text-xs text-slate-500">
                                    Invoice remaining AED {remaining.invoice.toFixed(2)}
                                    {allocation.provider_reference_number ? ` · Ref ${allocation.provider_reference_number}` : ""}
                                  </p>
                                </div>
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={refundAllocationAmountInputs[allocation.id] || ""}
                                  onChange={(e) => setRefundAllocationAmountInputs((prev) => ({ ...prev, [allocation.id]: e.target.value }))}
                                  placeholder={remaining.invoice.toFixed(2)}
                                  className="w-28 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
                                />
                              </div>
                              {isNonRefundableSurchargeVariant(allocation.method_variant) && Number(allocation.fee_amount || 0) > 0 && (
                                <p className="mt-2 text-xs font-medium text-amber-700">
                                  Original fee AED {Number(allocation.fee_amount || 0).toFixed(2)} stays on record and is not refunded.
                                </p>
                              )}
                            </div>
                          </div>
                        </label>
                      );
                    })}
                    <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-3 py-2 text-xs text-slate-600">
                      Selected allocation total: AED {selectedRefundAllocationTotal.toFixed(2)}
                      {" · "}
                      Remaining to assign: AED {Math.max(0, refundTargetTotal - selectedRefundAllocationTotal).toFixed(2)}
                    </div>
                  </div>
                </div>
              )}
              {refundMode === "legacy" && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  Legacy receipt refund: this receipt predates structured payment allocations, so refund uses compatibility mode.
                </div>
              )}
              {refundMode === "admin_review" && (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                  This receipt has payment records but missing payment allocations. Refund is blocked for safety; ask admin to review.
                </div>
              )}

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
                  disabled={
                    isProcessingRefund
                    || !refundReason.trim()
                    || (!refundAll && Object.values(checkedItems).filter(Boolean).length === 0)
                    || refundMode === "admin_review"
                    || (refundMode === "modern" && selectedRefundAllocationIds.length === 0)
                  }
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
