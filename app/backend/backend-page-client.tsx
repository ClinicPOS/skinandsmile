"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import { Patient, Doctor, Service, Receptionist, CashRegisterSession, Clinic, OutstandingBalance, BalancePayment, TreatmentPlan, TreatmentPlanPayment, TreatmentPlanPaymentRecord, TreatmentPlanVisit } from "../../lib/types";
import { calculateAge } from "../../lib/utils";
import { rollupBalance, formatBalanceReference } from "../../lib/outstanding-balances";
import { AddOutstandingBalanceModal } from "../../components/outstanding-balance-modals";
import { effectiveServiceCategory } from "../../lib/service-categories";
import { createClinicPatientFile, nextClinicFileNumber } from "../../lib/clinic-patient-files";
import { computeTreatmentPlanRollup } from "../../lib/treatment-plan-rollup";

const BACKEND_SELECTED_CLINIC_KEY = "backendSelectedClinicId";
const BACKEND_PATIENTS_PAGE_SIZE = 20;

export const dynamic = "force-dynamic";

type BackendSection =
  | "overview"
  | "clinics"
  | "patients"
  | "doctors"
  | "services"
  | "receptionists"
  | "treatment-plans"
  | "outstanding-balances"
  | "reports"
  | "branding"
  | "access"
  | "system-settings";

type VatRateDraft = "" | "0" | "0.05";

function parseVatRateDraft(value: VatRateDraft): number | null {
  if (value === "0") return 0;
  if (value === "0.05") return 0.05;
  return null;
}

function vatRateDraftFromValue(value: number | null | undefined): VatRateDraft {
  if (value === 0) return "0";
  if (value === 0.05) return "0.05";
  return "";
}

function formatVatRateLabel(value: number | null | undefined): string {
  if (value === 0) return "No VAT";
  if (value === 0.05) return "5% VAT";
  return "VAT not configured";
}

function resolveBackendSection(pathname: string): BackendSection {
  if (pathname.startsWith("/backend/clinics")) return "clinics";
  if (pathname.startsWith("/backend/patients")) return "patients";
  if (pathname.startsWith("/backend/doctors")) return "doctors";
  if (pathname.startsWith("/backend/services")) return "services";
  if (pathname.startsWith("/backend/receptionists")) return "receptionists";
  if (pathname.startsWith("/backend/treatment-plans")) return "treatment-plans";
  if (pathname.startsWith("/backend/outstanding-balances")) return "outstanding-balances";
  if (pathname.startsWith("/backend/reports")) return "reports";
  if (pathname.startsWith("/backend/branding")) return "branding";
  if (pathname.startsWith("/backend/access")) return "access";
  if (pathname.startsWith("/backend/system-settings")) return "system-settings";
  return "overview";
}

export default function BackendPage() {
  return (
    <Suspense fallback={<div className="min-h-[240px]" />}>
      <BackendPageContent />
    </Suspense>
  );
}

function BackendPageContent() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeSection = resolveBackendSection(pathname);
  const requestedClinicId = searchParams.get("clinicId") || "";

  type BackendPatient = {
    id: string;
    patient_number: number | null;
    name: string;
    phone: string | null;
    email: string | null;
    notes: string | null;
    date_of_birth: string | null;
    sex: string | null;
    nationality: string | null;
    emirates_id: string | null;
    passport_number: string | null;
    mrn: string | null;
    address: string | null;
    clinic_file_no: string;
    clinic_patient_file_id: string;
  };

  type ClinicPatientFileRow = {
    id: string;
    file_no: string;
    patient_id: string;
    patients:
      | {
          id: string;
          patient_number: number | null;
          name: string | null;
          phone: string | null;
          email: string | null;
          notes: string | null;
          date_of_birth: string | null;
          sex: string | null;
          nationality: string | null;
          emirates_id: string | null;
          passport_number: string | null;
          mrn: string | null;
          address: string | null;
        }
      | Array<{
          id: string;
          patient_number: number | null;
          name: string | null;
          phone: string | null;
          email: string | null;
          notes: string | null;
          date_of_birth: string | null;
          sex: string | null;
          nationality: string | null;
          emirates_id: string | null;
          passport_number: string | null;
          mrn: string | null;
          address: string | null;
        }>
      | null;
  };

  const [patients, setPatients] = useState<BackendPatient[]>([]);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [receptionists, setReceptionists] = useState<Receptionist[]>([]);
  const [cashRegisterSessions, setCashRegisterSessions] = useState<CashRegisterSession[]>([]);
  const [clinics, setClinics] = useState<Clinic[]>([]);
  const [selectedClinicId, setSelectedClinicId] = useState<string>("");
  const [isRegisterTableReady, setIsRegisterTableReady] = useState(true);
  const [activeSessions, setActiveSessions] = useState<{ token: string; ip: string; user_agent: string; created_at: string }[]>([]);
  const [loginLogs, setLoginLogs] = useState<{ id: string; ip: string; user_agent: string; success: boolean; created_at: string }[]>([]);

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
  const [patientMrn, setPatientMrn] = useState("");

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
  const [editingPatientMrn, setEditingPatientMrn] = useState("");
  const [patientPage, setPatientPage] = useState(1);
  const [expandedPatientId, setExpandedPatientId] = useState<string | null>(null);
  const [outstandingBalances, setOutstandingBalances] = useState<OutstandingBalance[]>([]);
  const [balancePayments, setBalancePayments] = useState<BalancePayment[]>([]);
  const [treatmentPlans, setTreatmentPlans] = useState<TreatmentPlan[]>([]);
  const [treatmentPlanPayments, setTreatmentPlanPayments] = useState<TreatmentPlanPayment[]>([]);
  const [treatmentPlanPaymentRecords, setTreatmentPlanPaymentRecords] = useState<TreatmentPlanPaymentRecord[]>([]);
  const [treatmentPlanVisits, setTreatmentPlanVisits] = useState<TreatmentPlanVisit[]>([]);
  const [patientNamesById, setPatientNamesById] = useState<Record<string, string>>({});
  const [addBalancePatient, setAddBalancePatient] = useState<Patient | null>(null);

  const [doctorName, setDoctorName] = useState("");
  const [doctorSpecialty, setDoctorSpecialty] = useState("");
  const [editingDoctorId, setEditingDoctorId] = useState("");
  const [editingDoctorName, setEditingDoctorName] = useState("");
  const [editingDoctorSpecialty, setEditingDoctorSpecialty] = useState("");

  const [serviceName, setServiceName] = useState("");
  const [servicePrice, setServicePrice] = useState("");
  const [serviceVatRate, setServiceVatRate] = useState<VatRateDraft>("");
  const [serviceCategory, setServiceCategory] = useState("");
  const [editingServiceId, setEditingServiceId] = useState("");
  const [editingServiceName, setEditingServiceName] = useState("");
  const [editingServiceVariant, setEditingServiceVariant] = useState("");
  const [editingServicePrice, setEditingServicePrice] = useState("");
  const [editingServiceVatRate, setEditingServiceVatRate] = useState<VatRateDraft>("");
  const [editingServiceCategory, setEditingServiceCategory] = useState("");
  const [editingServiceDefaultVisitCount, setEditingServiceDefaultVisitCount] = useState("1");
  const [editingServiceSortOrder, setEditingServiceSortOrder] = useState("0");
  const [editingServiceActivePlanRecommended, setEditingServiceActivePlanRecommended] = useState(false);
  const [editingServiceIsActive, setEditingServiceIsActive] = useState(true);
  const [editingServiceCanonicalId, setEditingServiceCanonicalId] = useState("");
  const [editingServiceBillingUnit, setEditingServiceBillingUnit] = useState("Session");
  const [editingServiceRequiresQuantity, setEditingServiceRequiresQuantity] = useState(false);
  const [editingServiceToothSelectionMode, setEditingServiceToothSelectionMode] = useState<"none" | "optional" | "required">("none");
  const [editingServicePricingType, setEditingServicePricingType] = useState<"fixed" | "variable">("fixed");
  const [editingServiceMinPrice, setEditingServiceMinPrice] = useState("");
  const [editingServiceMaxPrice, setEditingServiceMaxPrice] = useState("");
  const [servicePage, setServicePage] = useState(1);
  const [duplicateCanonicalTargets, setDuplicateCanonicalTargets] = useState<Record<string, string>>({});

  const [receptionistName, setReceptionistName] = useState("");
  const [receptionistShift, setReceptionistShift] = useState("");
  const [receptionistPin, setReceptionistPin] = useState("");
  const [editingReceptionistId, setEditingReceptionistId] = useState("");
  const [editingReceptionistName, setEditingReceptionistName] = useState("");
  const [editingReceptionistShift, setEditingReceptionistShift] = useState("");
  const [editingReceptionistPin, setEditingReceptionistPin] = useState("");
  const [editingReceptionistClinicId, setEditingReceptionistClinicId] = useState("");
  const [receiptDraftClinicId, setReceiptDraftClinicId] = useState("");
  const [receiptAddress, setReceiptAddress] = useState("");
  const [receiptRoom, setReceiptRoom] = useState("");
  const [receiptPhone, setReceiptPhone] = useState("");
  const [receiptWhatsapp, setReceiptWhatsapp] = useState("");
  const [receiptInstagram, setReceiptInstagram] = useState("");
  const [receiptFacebook, setReceiptFacebook] = useState("");
  const [receiptTiktok, setReceiptTiktok] = useState("");
  const [receiptPrintName, setReceiptPrintName] = useState("");
  const [receiptTitle, setReceiptTitle] = useState("");
  const [receiptVatNote, setReceiptVatNote] = useState("");
  const [receiptThankYou, setReceiptThankYou] = useState("");
  const [receiptFinalMessage, setReceiptFinalMessage] = useState("");
  const [receiptQrUrl, setReceiptQrUrl] = useState("");
  const [receiptTrn, setReceiptTrn] = useState("");
  const [receiptLogo, setReceiptLogo] = useState("");
  const [clinicExpensesEnabledDraft, setClinicExpensesEnabledDraft] = useState(false);
  const [clinicCommissionsEnabledDraft, setClinicCommissionsEnabledDraft] = useState(false);
  const [isSavingClinicDeductionSettings, setIsSavingClinicDeductionSettings] = useState(false);

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
      || String(patient.phone || "").toLowerCase().includes(keyword)
      || String(patient.clinic_file_no || "").toLowerCase().includes(keyword)
      || String(patient.patient_number || "").toLowerCase().includes(keyword)
    );
  }, [patients, patientSearch]);

  const patientTotalPages = Math.max(1, Math.ceil(filteredPatients.length / BACKEND_PATIENTS_PAGE_SIZE));
  const currentPatientPage = Math.min(patientPage, patientTotalPages);
  const pagedPatients = useMemo(() => {
    const start = (currentPatientPage - 1) * BACKEND_PATIENTS_PAGE_SIZE;
    return filteredPatients.slice(start, start + BACKEND_PATIENTS_PAGE_SIZE);
  }, [filteredPatients, currentPatientPage]);

  const balancesByPatient = useMemo(() => {
    const map = new Map<string, OutstandingBalance[]>();
    for (const b of outstandingBalances) {
      const arr = map.get(b.patient_id) || [];
      arr.push(b);
      map.set(b.patient_id, arr);
    }
    return map;
  }, [outstandingBalances]);

  const paymentsByBalance = useMemo(() => {
    const map = new Map<string, BalancePayment[]>();
    for (const p of balancePayments) {
      const arr = map.get(p.outstanding_balance_id) || [];
      arr.push(p);
      map.set(p.outstanding_balance_id, arr);
    }
    return map;
  }, [balancePayments]);

  const clinicNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of clinics) map.set(c.id, c.name);
    return map;
  }, [clinics]);

  const patientNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const patient of patients) {
      map.set(patient.id, patient.name || "Unknown patient");
    }
    for (const [patientId, patientName] of Object.entries(patientNamesById)) {
      if (patientName) map.set(patientId, patientName);
    }
    return map;
  }, [patients, patientNamesById]);

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
    return map;
  }, [treatmentPlanVisits]);

  const visibleClinicOutstandingBalanceGroups = useMemo(() => {
    const groups = new Map<string, {
      clinicId: string;
      clinicName: string;
      items: Array<{
        id: string;
        kind: "balance" | "treatment_plan";
        label: string;
        remaining: number;
        status: string;
        patientName: string;
        originalDate?: string;
        balance?: OutstandingBalance;
        detailLines?: string[];
      }>;
    }>();

    for (const balance of outstandingBalances) {
      const clinicId = balance.clinic_id || "";
      if (selectedClinicId && clinicId !== selectedClinicId) continue;
      const clinicName = clinicNameById.get(clinicId) || "Unknown clinic";
      const payments = paymentsByBalance.get(balance.id) || [];
      const roll = rollupBalance(balance, payments);
      if (roll.remaining <= 0.0049) continue;
      const paymentLines = payments
        .slice()
        .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime())
        .slice(0, 3)
        .map((payment) => `Collected AED ${Number(payment.amount || 0).toFixed(2)} on ${new Date(payment.created_at).toLocaleDateString("en-GB")} via ${payment.payment_method || "unknown"}`);
      const group = groups.get(clinicId) || {
        clinicId,
        clinicName,
        items: [],
      };
      group.items.push({
        id: `balance-${balance.id}`,
        kind: "balance",
        label: formatBalanceReference(balance),
        remaining: roll.remaining,
        status: roll.status,
        patientName: patientNameById.get(balance.patient_id) || "Unknown patient",
        originalDate: balance.original_date,
        balance,
        detailLines: paymentLines.length > 0 ? [`Paid ${payments.length} time${payments.length === 1 ? "" : "s"}`].concat(paymentLines) : undefined,
      });
      groups.set(clinicId, group);
    }

    for (const plan of treatmentPlans) {
      if (plan.status !== "Active") continue;
      const clinicId = plan.clinic_id || "";
      if (selectedClinicId && clinicId !== selectedClinicId) continue;
      const clinicName = clinicNameById.get(clinicId) || "Unknown clinic";
      const rollup = computeTreatmentPlanRollup(plan, {
        structuredPayments: treatmentPlanPaymentRecordsByPlanId.get(plan.id) || [],
        legacyPayments: treatmentPlanPaymentsByPlanId.get(plan.id) || [],
      });
      const paid = rollup.totalPaidToDate;
      const remaining = rollup.remainingBalance;
      const completedVisits = (treatmentPlanVisitsByPlanId.get(plan.id) || []).length;
      const shownVisits = Math.max(completedVisits, plan.clinic_patient_file_id ? 1 : 0);
      const totalVisits = Math.max(1, Number(plan.planned_visits || 0));
      const visitSummary = `${Math.min(shownVisits, totalVisits)}/${totalVisits} visits`;
      const group = groups.get(clinicId) || {
        clinicId,
        clinicName,
        items: [],
      };
      group.items.push({
        id: `plan-${plan.id}`,
        kind: "treatment_plan",
        label: plan.title || "Active treatment plan",
        remaining,
        status: "Unpaid",
        patientName: patientNameById.get(plan.patient_id) || "Unknown patient",
        originalDate: plan.created_at,
        detailLines: [visitSummary, `Paid AED ${paid.toFixed(2)} of AED ${Number(plan.total_amount || 0).toFixed(2)}`],
      });
      groups.set(clinicId, group);
    }

    return [...groups.values()].sort((a, b) => a.clinicName.localeCompare(b.clinicName));
  }, [outstandingBalances, paymentsByBalance, treatmentPlans, treatmentPlanPaymentRecordsByPlanId, treatmentPlanPaymentsByPlanId, treatmentPlanVisitsByPlanId, clinicNameById, patientNameById, selectedClinicId]);

  const selectedClinic = useMemo(
    () => clinics.find((c) => c.id === selectedClinicId) || null,
    [clinics, selectedClinicId]
  );
  const outstandingBalanceGroupsOnly = useMemo(
    () => visibleClinicOutstandingBalanceGroups
      .map((group) => ({ ...group, items: group.items.filter((item) => item.kind === "balance") }))
      .filter((group) => group.items.length > 0),
    [visibleClinicOutstandingBalanceGroups]
  );
  const treatmentPlanGroupsOnly = useMemo(
    () => visibleClinicOutstandingBalanceGroups
      .map((group) => ({ ...group, items: group.items.filter((item) => item.kind === "treatment_plan") }))
      .filter((group) => group.items.length > 0),
    [visibleClinicOutstandingBalanceGroups]
  );
  const showCrudSections =
    activeSection === "patients"
    || activeSection === "doctors"
    || activeSection === "services"
    || activeSection === "receptionists";
  const isReceiptDraftForSelectedClinic = receiptDraftClinicId === selectedClinicId;
  const defaultReceiptPrintName = (selectedClinic?.name || "Skin and Smile Dental Clinic").replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s{2,}/g, " ").trim();
  const isSkinAndSmileReceipt = !selectedClinic || selectedClinic.logo !== "altamuze";
  const receiptAddressValue = isReceiptDraftForSelectedClinic ? receiptAddress : (selectedClinic?.address || "");
  const receiptRoomValue = isReceiptDraftForSelectedClinic ? receiptRoom : (selectedClinic?.room || "");
  const receiptPhoneValue = isReceiptDraftForSelectedClinic ? receiptPhone : (selectedClinic?.phone || "");
  const receiptWhatsappValue = isReceiptDraftForSelectedClinic ? receiptWhatsapp : (selectedClinic?.whatsapp || "");
  const receiptInstagramValue = isReceiptDraftForSelectedClinic ? receiptInstagram : (selectedClinic?.instagram || "");
  const receiptFacebookValue = isReceiptDraftForSelectedClinic ? receiptFacebook : (selectedClinic?.facebook || "");
  const receiptTiktokValue = isReceiptDraftForSelectedClinic ? receiptTiktok : (selectedClinic?.tiktok || (isSkinAndSmileReceipt ? "@skinandsmile" : ""));
  const receiptPrintNameValue = isReceiptDraftForSelectedClinic ? receiptPrintName : (selectedClinic?.receipt_print_name || defaultReceiptPrintName);
  const receiptTitleValue = isReceiptDraftForSelectedClinic ? receiptTitle : (selectedClinic?.receipt_title || "TAX INVOICE");
  const receiptVatNoteValue = isReceiptDraftForSelectedClinic ? receiptVatNote : (selectedClinic?.receipt_vat_note || "VAT Included in Above Amount / الضريبة مشمولة في المبلغ أعلاه");
  const receiptThankYouValue = isReceiptDraftForSelectedClinic ? receiptThankYou : (selectedClinic?.receipt_thank_you || "Thank you for visiting us / شكراً لزيارتك لنا");
  const receiptFinalMessageValue = isReceiptDraftForSelectedClinic ? receiptFinalMessage : (selectedClinic?.receipt_final_message || "Thank you for Visiting US!");
  const receiptQrUrlValue = isReceiptDraftForSelectedClinic ? receiptQrUrl : (selectedClinic?.receipt_qr_url || "");
  const receiptTrnValue = isReceiptDraftForSelectedClinic ? receiptTrn : (selectedClinic?.trn || "");
  const receiptLogoValue = isReceiptDraftForSelectedClinic ? receiptLogo : (selectedClinic?.logo || "");

  function startReceiptDraft(clinic: Clinic | null) {
    setReceiptDraftClinicId(clinic?.id || "");
    setReceiptAddress(clinic?.address || "");
    setReceiptRoom(clinic?.room || "");
    setReceiptPhone(clinic?.phone || "");
    setReceiptWhatsapp(clinic?.whatsapp || "");
    setReceiptInstagram(clinic?.instagram || "");
    setReceiptFacebook(clinic?.facebook || "");
    setReceiptTiktok(clinic?.tiktok || (clinic?.logo !== "altamuze" ? "@skinandsmile" : ""));
    setReceiptPrintName(clinic?.receipt_print_name || (clinic?.name || "Skin and Smile Dental Clinic").replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s{2,}/g, " ").trim());
    setReceiptTitle(clinic?.receipt_title || "TAX INVOICE");
    setReceiptVatNote(clinic?.receipt_vat_note || "VAT Included in Above Amount / الضريبة مشمولة في المبلغ أعلاه");
    setReceiptThankYou(clinic?.receipt_thank_you || "Thank you for visiting us / شكراً لزيارتك لنا");
    setReceiptFinalMessage(clinic?.receipt_final_message || "Thank you for Visiting US!");
    setReceiptQrUrl(clinic?.receipt_qr_url || "");
    setReceiptTrn(clinic?.trn || "");
    setReceiptLogo(clinic?.logo || "");
  }

  function ensureReceiptDraftForSelectedClinic() {
    if (isReceiptDraftForSelectedClinic) return;
    startReceiptDraft(selectedClinic);
  }

  useEffect(() => {
    setClinicExpensesEnabledDraft(!!selectedClinic?.enable_expenses);
    setClinicCommissionsEnabledDraft(!!selectedClinic?.enable_commissions);
  }, [selectedClinic?.id, selectedClinic?.enable_expenses, selectedClinic?.enable_commissions]);

  async function saveClinicDeductionSettings() {
    if (!selectedClinicId) {
      alert("Please select a clinic first.");
      return;
    }

    setIsSavingClinicDeductionSettings(true);
    try {
      const response = await fetch("/api/clinic-deduction-settings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          clinicId: selectedClinicId,
          enableExpenses: clinicExpensesEnabledDraft,
          enableCommissions: clinicCommissionsEnabledDraft,
        }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || "Failed updating clinic settings.");
      }

      setClinics((prev) =>
        prev.map((clinic) =>
          clinic.id === selectedClinicId
            ? {
                ...clinic,
                enable_expenses: !!payload?.enableExpenses,
                enable_commissions: !!payload?.enableCommissions,
              }
            : clinic
        )
      );

      alert("Clinic expense and commission settings updated.");
    } catch (error) {
      alert(error instanceof Error ? error.message : "Failed updating clinic settings.");
    } finally {
      setIsSavingClinicDeductionSettings(false);
    }
  }

  async function deleteBalance(id: string) {
    if (!confirm("Delete this outstanding balance? Any recorded payments will also be removed.")) return;
    const { error } = await supabase.from("outstanding_balances").delete().eq("id", id);
    if (error) {
      alert(`Delete failed: ${error.message || error.code || "Unknown error"}`);
      return;
    }
    setOutstandingBalances((prev) => prev.filter((b) => b.id !== id));
    setBalancePayments((prev) => prev.filter((p) => p.outstanding_balance_id !== id));
  }

  async function deleteTreatmentPlan(id: string) {
    if (!confirm("Delete this active treatment plan? Its related payments and visits will also be removed, and the reports will stop reflecting it.")) return;

    const [paymentsResult, visitsResult, planResult] = await Promise.allSettled([
      supabase.from("treatment_plan_payments").delete().eq("treatment_plan_id", id),
      supabase.from("treatment_plan_visits").delete().eq("treatment_plan_id", id),
      supabase.from("treatment_plans").delete().eq("id", id),
    ]);

    const planError = planResult.status === "fulfilled" ? planResult.value.error : null;
    if (planError) {
      alert(`Delete failed: ${planError.message || planError.code || "Unknown error"}`);
      return;
    }

    if (paymentsResult.status === "fulfilled" && paymentsResult.value.error && paymentsResult.value.error.code !== "42P01" && paymentsResult.value.error.code !== "42501") {
      console.warn("Failed deleting treatment plan payments", paymentsResult.value.error);
    }
    if (visitsResult.status === "fulfilled" && visitsResult.value.error && visitsResult.value.error.code !== "42P01" && visitsResult.value.error.code !== "42501") {
      console.warn("Failed deleting treatment plan visits", visitsResult.value.error);
    }

    setTreatmentPlans((prev) => prev.filter((plan) => plan.id !== id));
    setTreatmentPlanPayments((prev) => prev.filter((payment) => payment.treatment_plan_id !== id));
    setTreatmentPlanPaymentRecords((prev) => prev.filter((payment) => payment.treatment_plan_id !== id));
  }

  const displayedDoctors = useMemo(() =>
    selectedClinicId ? doctors.filter(d => d.clinic_id === selectedClinicId) : [],
    [doctors, selectedClinicId]
  );

  const displayedServices = useMemo(() => {
    if (!selectedClinicId) return [];
    return services
      .filter(s => s.clinic_id === selectedClinicId)
      .sort((a, b) => {
        const sortA = Number(a.sort_order ?? 0);
        const sortB = Number(b.sort_order ?? 0);
        if (sortA !== sortB) return sortA - sortB;
        const catA = (a.category || "").toLowerCase();
        const catB = (b.category || "").toLowerCase();
        if (catA !== catB) {
          if (!catA) return 1; // uncategorized last
          if (!catB) return -1;
          return catA < catB ? -1 : 1;
        }
        const nameA = String(a.display_name || a.name || "");
        const nameB = String(b.display_name || b.name || "");
        return nameA.localeCompare(nameB);
      });
  }, [services, selectedClinicId]);

  function normalizeReviewName(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  const duplicateReview = useMemo(() => {
    const exactNameGroups = new Map<string, Service[]>();
    const caseInsensitiveNameGroups = new Map<string, Service[]>();
    const normalizedNameGroups = new Map<string, Service[]>();
    const missingCategory: Service[] = [];
    const missingOrZeroPrice: Service[] = [];
    const inconsistentSpacingOrPunctuation: Service[] = [];

    for (const service of displayedServices) {
      const displayName = String(service.display_name || service.name || "").trim();
      const exactName = displayName;
      const lowerName = displayName.toLowerCase();
      const normalizedName = normalizeReviewName(displayName);

      if (!exactNameGroups.has(exactName)) exactNameGroups.set(exactName, []);
      exactNameGroups.get(exactName)?.push(service);

      if (!caseInsensitiveNameGroups.has(lowerName)) caseInsensitiveNameGroups.set(lowerName, []);
      caseInsensitiveNameGroups.get(lowerName)?.push(service);

      if (!normalizedNameGroups.has(normalizedName)) normalizedNameGroups.set(normalizedName, []);
      normalizedNameGroups.get(normalizedName)?.push(service);

      if (!String(service.category || "").trim()) missingCategory.push(service);
      if (!Number(service.price || 0)) missingOrZeroPrice.push(service);

      const hasSpacingIssue =
        displayName !== displayName.trim() ||
        /\s{2,}/.test(displayName) ||
        /\s+[.,/-]/.test(displayName) ||
        /[.,/-]\S/.test(displayName);
      if (hasSpacingIssue) {
        inconsistentSpacingOrPunctuation.push(service);
      }
    }

    const exactDuplicates = [...exactNameGroups.entries()]
      .filter(([name, rows]) => name && rows.length > 1)
      .map(([, rows]) => rows);
    const caseOnlyDuplicates = [...caseInsensitiveNameGroups.values()]
      .filter((rows) => rows.length > 1 && new Set(rows.map((s) => String(s.display_name || s.name || "").trim())).size > 1);
    const similarDifferentPrice = [...normalizedNameGroups.values()]
      .filter((rows) => rows.length > 1)
      .filter((rows) => {
        const prices = new Set(rows.map((s) => Number(s.price || 0).toFixed(2)));
        return prices.size > 1;
      });

    return {
      exactDuplicates,
      caseOnlyDuplicates,
      similarDifferentPrice,
      missingCategory,
      missingOrZeroPrice,
      inconsistentSpacingOrPunctuation,
    };
  }, [displayedServices]);

  const existingServiceCategories = useMemo(() => {
    // Categories are per-clinic: only suggest what the selected clinic's
    // services effectively use — saved categories plus the legacy keyword
    // groups — deduped case-insensitively so "facial services" can't sit
    // next to "Facial Services".
    const map = new Map<string, string>();
    for (const s of services) {
      if (!selectedClinicId || s.clinic_id !== selectedClinicId) continue;
      const c = effectiveServiceCategory(s);
      if (c && !map.has(c.toLowerCase())) map.set(c.toLowerCase(), c);
    }
    return [...map.values()].sort((a, b) => a.localeCompare(b));
  }, [services, selectedClinicId]);

  // Reuse an existing category's exact spelling when the typed value matches
  // it ignoring case, so typos in casing don't create duplicate categories.
  function canonicalServiceCategory(input: string): string | null {
    const trimmed = input.trim();
    if (!trimmed) return null;
    const match = existingServiceCategories.find((c) => c.toLowerCase() === trimmed.toLowerCase());
    return match || trimmed;
  }

  const serviceTotalPages = Math.max(1, Math.ceil(displayedServices.length / 10));
  const pagedServices = useMemo(() => {
    const start = (servicePage - 1) * 10;
    return displayedServices.slice(start, start + 10);
  }, [displayedServices, servicePage]);

  useEffect(() => { setServicePage(1); }, [selectedClinicId]);

  useEffect(() => {
    if (!selectedClinicId) return;
    if (typeof window === "undefined") return;
    window.localStorage.setItem(BACKEND_SELECTED_CLINIC_KEY, selectedClinicId);
  }, [selectedClinicId]);

  useEffect(() => {
    if (!requestedClinicId) return;
    if (!clinics.some((clinic) => clinic.id === requestedClinicId)) return;
    if (selectedClinicId === requestedClinicId) return;
    setSelectedClinicId(requestedClinicId);
    startReceiptDraft(clinics.find((clinic) => clinic.id === requestedClinicId) || null);
  }, [clinics, requestedClinicId, selectedClinicId]);

  const displayedReceptionists = useMemo(() =>
    selectedClinicId ? receptionists.filter(r => r.clinic_id === selectedClinicId) : [],
    [receptionists, selectedClinicId]
  );

  const displayedCashSessions = useMemo(() => {
    if (!selectedClinicId) return [] as CashRegisterSession[];
    const ids = new Set(receptionists.filter(r => r.clinic_id === selectedClinicId).map(r => r.id));
    return cashRegisterSessions.filter(s => s.receptionist_id != null && ids.has(s.receptionist_id));
  }, [cashRegisterSessions, receptionists, selectedClinicId]);

  useEffect(() => {
    loadAll();
  }, []);

  useEffect(() => {
    const requiredPatientIds = Array.from(new Set([
      ...outstandingBalances.map((balance) => balance.patient_id).filter(Boolean),
      ...treatmentPlans.map((plan) => plan.patient_id).filter(Boolean),
    ] as string[]));

    if (requiredPatientIds.length === 0) return;

    const missingIds = requiredPatientIds.filter((patientId) => {
      if (!patientId) return false;
      if (patients.some((patient) => patient.id === patientId)) return false;
      return !patientNamesById[patientId];
    });

    if (missingIds.length === 0) return;

    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from("patients")
        .select("id, name")
        .in("id", missingIds);

      if (cancelled || error) return;

      const nextNames = Object.fromEntries((data || []).filter(Boolean).map((patient: { id: string; name: string | null }) => [patient.id, patient.name || "Unknown patient"]));
      if (Object.keys(nextNames).length > 0) {
        setPatientNamesById((current) => ({ ...current, ...nextNames }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [outstandingBalances, treatmentPlans, patients, patientNamesById]);

  async function revokeSession(token: string) {
    await supabase.from("active_sessions").delete().eq("token", token);
    setActiveSessions((prev) => prev.filter((s) => s.token !== token));
  }

  async function loadAll() {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const [
      clinicsResult,
      servicesResult,
      doctorsResult,
      receptionistsResult,
    ] = await Promise.all([
      supabase.from("clinics").select("*").order("name"),
      supabase.from("services").select("*"),
      supabase.from("doctors").select("*"),
      supabase.from("receptionist").select("*"),
    ]);

    const clinicRows = (clinicsResult.data || []) as Clinic[];
    setClinics(clinicRows);
    const resolvedClinicId = (() => {
      const saved = typeof window !== "undefined" ? window.localStorage.getItem(BACKEND_SELECTED_CLINIC_KEY) : "";
      if (requestedClinicId && clinicRows.some((c) => c.id === requestedClinicId)) return requestedClinicId;
      if (saved && clinicRows.some((c) => c.id === saved)) return saved;
      return clinicRows[0]?.id ?? "";
    })();
    setSelectedClinicId(resolvedClinicId);
    setServices((servicesResult.data || []) as Service[]);
    setDoctors((doctorsResult.data || []) as Doctor[]);
    setReceptionists((receptionistsResult.data || []) as Receptionist[]);

    const [
      clinicPatientsResult,
      cashSessionsResult,
      sessionsResult,
      logsResult,
      balancesResult,
      balancePaymentsResult,
      treatmentPlansResult,
      treatmentPlanPaymentsResult,
      treatmentPlanVisitsResult,
      treatmentPlanPaymentRecordsResult,
    ] = await Promise.allSettled([
      resolvedClinicId
        ? supabase
            .from("clinic_patient_files")
            .select("id, file_no, patient_id, patients(id, patient_number, name, phone, email, notes, date_of_birth, sex, nationality, emirates_id, passport_number, mrn, address)")
            .eq("clinic_id", resolvedClinicId)
            .order("file_no", { ascending: true })
        : Promise.resolve({ data: [], error: null }),
      supabase
        .from("cash_register_sessions")
        .select("*")
        .gte("opened_at", startOfDay.toISOString())
        .order("opened_at", { ascending: false }),
      supabase.from("active_sessions").select("*").order("created_at", { ascending: false }),
      supabase.from("login_logs").select("*").order("created_at", { ascending: false }).limit(20),
      supabase.from("outstanding_balances").select("*").order("original_date", { ascending: false }),
      supabase.from("balance_payments").select("*").order("created_at", { ascending: false }),
      supabase.from("treatment_plans").select("*").order("created_at", { ascending: false }),
      supabase.from("treatment_plan_payments").select("*").order("created_at", { ascending: false }),
      supabase.from("treatment_plan_visits").select("*").order("visit_number", { ascending: true }),
      supabase.from("treatment_plan_payment_records").select("*").order("created_at", { ascending: false }),
    ]);

    if (clinicPatientsResult.status === "fulfilled") {
      if (clinicPatientsResult.value.error) {
        console.warn("Failed loading clinic patients", clinicPatientsResult.value.error);
        setPatients([]);
      } else {
        const mappedPatients = ((clinicPatientsResult.value.data || []) as ClinicPatientFileRow[])
          .map((row) => {
            const patient = Array.isArray(row.patients) ? row.patients[0] : row.patients;
            if (!patient?.id) return null;
            return {
              id: patient.id,
              patient_number: patient.patient_number,
              name: patient.name || "Unknown patient",
              phone: patient.phone || null,
              email: patient.email || null,
              notes: patient.notes || null,
              date_of_birth: patient.date_of_birth || null,
              sex: patient.sex || null,
              nationality: patient.nationality || null,
              emirates_id: patient.emirates_id || null,
              passport_number: patient.passport_number || null,
              mrn: patient.mrn || null,
              address: patient.address || null,
              clinic_file_no: String(row.file_no || ""),
              clinic_patient_file_id: row.id,
            };
          })
          .filter((patient): patient is BackendPatient => patient !== null);
        setPatients(mappedPatients);
      }
    }
    if (sessionsResult.status === "fulfilled") {
      setActiveSessions((sessionsResult.value.data || []) as typeof activeSessions);
    }
    if (logsResult.status === "fulfilled") {
      setLoginLogs((logsResult.value.data || []) as typeof loginLogs);
    }

    if (balancesResult.status === "fulfilled") {
      if (balancesResult.value.error) {
        if (balancesResult.value.error.code !== "42P01") {
          console.warn("Failed loading outstanding balances", balancesResult.value.error);
        }
        setOutstandingBalances([]);
      } else {
        setOutstandingBalances((balancesResult.value.data || []) as OutstandingBalance[]);
      }
    }

    if (balancePaymentsResult.status === "fulfilled") {
      if (balancePaymentsResult.value.error) {
        if (balancePaymentsResult.value.error.code !== "42P01") {
          console.warn("Failed loading balance payments", balancePaymentsResult.value.error);
        }
        setBalancePayments([]);
      } else {
        setBalancePayments((balancePaymentsResult.value.data || []) as BalancePayment[]);
      }
    }

    if (treatmentPlansResult.status === "fulfilled") {
      if (treatmentPlansResult.value.error) {
        if (treatmentPlansResult.value.error.code !== "42P01") {
          console.warn("Failed loading treatment plans", treatmentPlansResult.value.error);
        }
        setTreatmentPlans([]);
      } else {
        setTreatmentPlans((treatmentPlansResult.value.data || []) as TreatmentPlan[]);
      }
    }

    if (treatmentPlanPaymentsResult.status === "fulfilled") {
      if (treatmentPlanPaymentsResult.value.error) {
        if (treatmentPlanPaymentsResult.value.error.code !== "42P01") {
          console.warn("Failed loading treatment plan payments", treatmentPlanPaymentsResult.value.error);
        }
        setTreatmentPlanPayments([]);
      } else {
        setTreatmentPlanPayments((treatmentPlanPaymentsResult.value.data || []) as TreatmentPlanPayment[]);
      }
    }

    if (treatmentPlanVisitsResult.status === "fulfilled") {
      if (treatmentPlanVisitsResult.value.error) {
        if (treatmentPlanVisitsResult.value.error.code !== "42P01") {
          console.warn("Failed loading treatment plan visits", treatmentPlanVisitsResult.value.error);
        }

        if (treatmentPlanPaymentRecordsResult.status === "fulfilled") {
          if (treatmentPlanPaymentRecordsResult.value.error) {
            if (treatmentPlanPaymentRecordsResult.value.error.code !== "42P01") {
              console.warn("Failed loading structured treatment plan payments", treatmentPlanPaymentRecordsResult.value.error);
            }
            setTreatmentPlanPaymentRecords([]);
          } else {
            setTreatmentPlanPaymentRecords((treatmentPlanPaymentRecordsResult.value.data || []) as TreatmentPlanPaymentRecord[]);
          }
        }
        setTreatmentPlanVisits([]);
      } else {
        setTreatmentPlanVisits((treatmentPlanVisitsResult.value.data || []) as TreatmentPlanVisit[]);
      }
    }

    if (cashSessionsResult.status === "fulfilled") {
      if (cashSessionsResult.value.error) {
        setCashRegisterSessions([]);
        if (cashSessionsResult.value.error.code === "42P01") {
          setIsRegisterTableReady(false);
        } else {
          setIsRegisterTableReady(true);
          console.warn("Failed loading cash register sessions", cashSessionsResult.value.error);
        }
      } else {
        setIsRegisterTableReady(true);
        setCashRegisterSessions((cashSessionsResult.value.data || []) as CashRegisterSession[]);
      }
    }
  }

  function getReceptionistNameById(id: string) {
    return receptionists.find((person) => person.id === id)?.name || "Unknown";
  }

  function downloadCSV(filename: string, rows: string[][]) {
    const content = rows
      .map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob(["\ufeff" + content], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function exportData() {
    const { data: allPatientsData } = await supabase
      .from("patients")
      .select("id, patient_number, name, phone, email, date_of_birth, sex, nationality, emirates_id, passport_number, mrn, notes");

    const allPatients = (allPatientsData || []) as Patient[];
    const { data: receipts } = await supabase
      .from("receipts")
      .select("id, receipt_number, created_at, patient_id, receptionist_id, payment_method, subtotal, discount_amount, total");

    const allReceipts = receipts || [];
    const filteredReceipts = !selectedClinicId
      ? []
      : allReceipts.filter((r) => {
          const rec = receptionists.find((p) => p.id === r.receptionist_id);
          return rec?.clinic_id === selectedClinicId;
        });

    // Build patient → clinics visited map and last visit date
    const patientClinicMap: Record<string, Set<string>> = {};
    const patientLastVisit: Record<string, string> = {};
    for (const r of allReceipts) {
      const rec = receptionists.find((p) => p.id === r.receptionist_id);
      const clinic = clinics.find((c) => c.id === rec?.clinic_id);
      if (clinic && r.patient_id) {
        if (!patientClinicMap[r.patient_id]) patientClinicMap[r.patient_id] = new Set();
        patientClinicMap[r.patient_id].add(clinic.name);
      }
      if (r.patient_id) {
        const existing = patientLastVisit[r.patient_id];
        if (!existing || r.created_at > existing) patientLastVisit[r.patient_id] = r.created_at;
      }
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Patients CSV — always all patients
    const patientRows: string[][] = [
      ["Patient #", "Name", "Phone", "Email", "Date of Birth", "Sex", "Nationality", "Emirates ID", "Passport No.", "MRN", "Notes", "Clinics Visited", "Last Visit", "Days Since Last Visit"],
    ];
    for (const p of allPatients) {
      const clinicsVisited = [...(patientClinicMap[p.id] || [])].join(", ");
      const lastVisitRaw = patientLastVisit[p.id];
      const lastVisitStr = lastVisitRaw ? new Date(lastVisitRaw).toLocaleDateString("en-GB") : "Never";
      const daysSince = lastVisitRaw
        ? Math.floor((today.getTime() - new Date(lastVisitRaw).setHours(0, 0, 0, 0)) / 86400000)
        : "";
      patientRows.push([
        String(p.patient_number || ""),
        p.name || "",
        p.phone || "",
        p.email || "",
        p.date_of_birth || "",
        p.sex || "",
        p.nationality || "",
        p.emirates_id || "",
        p.passport_number || "",
        p.mrn || "",
        p.notes || "",
        clinicsVisited,
        lastVisitStr,
        String(daysSince),
      ]);
    }

    // Receipts CSV — filtered by selected clinic
    const receiptRows: string[][] = [
      ["Receipt #", "Date", "Time", "Patient", "Clinic", "Receptionist", "Payment Method", "Subtotal (AED)", "Discount (AED)", "Total (AED)"],
    ];
    for (const r of filteredReceipts) {
      const patient = allPatients.find((p) => p.id === r.patient_id);
      const rec = receptionists.find((p) => p.id === r.receptionist_id);
      const clinic = clinics.find((c) => c.id === rec?.clinic_id);
      const date = new Date(r.created_at);
      receiptRows.push([
        r.receipt_number ? String(r.receipt_number).padStart(5, "0") : "",
        date.toLocaleDateString("en-GB"),
        date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true }),
        patient?.name || "",
        clinic?.name || "",
        rec?.name || "",
        r.payment_method || "",
        Number(r.subtotal || 0).toFixed(2),
        Number(r.discount_amount || 0).toFixed(2),
        Number(r.total || 0).toFixed(2),
      ]);
    }

    const dateStr = new Date().toISOString().split("T")[0];
    const clinicLabel = !selectedClinicId ? "clinic" : (clinics.find((c) => c.id === selectedClinicId)?.name || "clinic").replace(/\s+/g, "-").toLowerCase();
    downloadCSV(`patients_${dateStr}.csv`, patientRows);
    setTimeout(() => downloadCSV(`receipts_${clinicLabel}_${dateStr}.csv`, receiptRows), 400);
  }

  async function addPatient() {
    if (!patientName.trim()) {
      alert("Patient name is required.");
      return;
    }
    if (!selectedClinicId) {
      alert("Please select a clinic before adding a patient.");
      return;
    }

    const { data: patientData, error } = await supabase
      .from("patients")
      .insert([
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
          mrn: patientMrn || null,
        },
      ])
      .select("*")
      .single();

    if (error || !patientData) {
      alert("Error saving patient");
      return;
    }

    try {
      const fileNo = await nextClinicFileNumber(selectedClinicId);
      const clinicFile = await createClinicPatientFile({
        clinicId: selectedClinicId,
        patientId: String(patientData.id),
        fileNo,
        mrn: patientMrn || null,
        clinicalNotes: patientNotes || null,
      });
      setPatients((prev) => [
        {
          id: String(patientData.id),
          patient_number: patientData.patient_number ?? null,
          name: String(patientData.name || ""),
          phone: patientData.phone ?? null,
          email: patientData.email ?? null,
          notes: patientData.notes ?? null,
          date_of_birth: patientData.date_of_birth ?? null,
          sex: patientData.sex ?? null,
          nationality: patientData.nationality ?? null,
          emirates_id: patientData.emirates_id ?? null,
          passport_number: patientData.passport_number ?? null,
          mrn: patientData.mrn ?? null,
          address: patientData.address ?? null,
          clinic_file_no: clinicFile.file_no,
          clinic_patient_file_id: clinicFile.id,
        },
        ...prev,
      ]);
    } catch (clinicFileError) {
      await supabase.from("patients").delete().eq("id", patientData.id);
      alert(clinicFileError instanceof Error ? clinicFileError.message : "Failed to create clinic patient file");
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
    setPatientMrn("");
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
        mrn: editingPatientMrn || null,
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
    setEditingPatientMrn("");
    setPatients((prev) =>
      prev.map((patient) =>
        patient.id === id
          ? {
              ...patient,
              name: editingPatientName,
              phone: editingPatientPhone,
              email: editingPatientEmail,
              notes: editingPatientNotes,
              date_of_birth: editingPatientDob || null,
              sex: editingPatientSex || null,
              nationality: editingPatientNationality || null,
              emirates_id: editingPatientEmiratesId || null,
              passport_number: editingPatientPassportNumber || null,
              mrn: editingPatientMrn || null,
            }
          : patient
      )
    );
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
    setPatients((prev) => prev.filter((patient) => patient.id !== id));
  }

  async function addDoctor() {
    if (!doctorName.trim()) {
      alert("Doctor name is required.");
      return;
    }
    if (!selectedClinicId) {
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
    const parsedVatRate = parseVatRateDraft(serviceVatRate);
    if (serviceVatRate === "" || parsedVatRate == null) {
      alert("Please select a VAT rate for the new service.");
      return;
    }
    if (!selectedClinicId) {
      alert("Please select a specific clinic before adding a service.");
      return;
    }

    const { error } = await supabase.from("services").insert([
      {
        name: serviceName.trim(),
        display_name: serviceName.trim(),
        variant: null,
        price: parsedPrice,
        standard_price: parsedPrice,
        vat_rate: parsedVatRate,
        clinic_id: selectedClinicId,
        category: canonicalServiceCategory(serviceCategory),
        category_id: canonicalServiceCategory(serviceCategory),
        search_keywords: null,
        common_aliases: null,
        default_visit_count: 1,
        sort_order: 0,
        active_plan_recommended: false,
        is_active: true,
        requires_quantity: false,
        billing_unit: "Session",
        tooth_selection_mode: "none",
      },
    ]);

    if (error) {
      if (error.message?.includes("vat_rate")) {
        alert(`Error saving service: ${error.message}. Please apply the services VAT migration first.`);
        return;
      }
      alert("Error saving service");
      return;
    }

    setServiceName("");
    setServicePrice("");
    setServiceVatRate("");
    setServiceCategory("");
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
    const parsedVatRate = parseVatRateDraft(editingServiceVatRate);
    const parsedVisitCount = Math.max(1, Number(editingServiceDefaultVisitCount || 1));
    if (!Number.isFinite(parsedVisitCount)) {
      alert("Please enter a valid default visit count.");
      return;
    }
    const parsedSortOrder = Number(editingServiceSortOrder || 0);
    if (!Number.isFinite(parsedSortOrder)) {
      alert("Please enter a valid sort order.");
      return;
    }

    let parsedMinPrice: number | null = null;
    let parsedMaxPrice: number | null = null;
    if (editingServicePricingType === "variable") {
      parsedMinPrice = editingServiceMinPrice !== "" ? Number(editingServiceMinPrice) : null;
      parsedMaxPrice = editingServiceMaxPrice !== "" ? Number(editingServiceMaxPrice) : null;
      if (parsedMinPrice !== null && (!Number.isFinite(parsedMinPrice) || parsedMinPrice < 0)) {
        alert("Please enter a valid minimum price.");
        return;
      }
      if (parsedMaxPrice !== null && (!Number.isFinite(parsedMaxPrice) || parsedMaxPrice < 0)) {
        alert("Please enter a valid maximum price.");
        return;
      }
      if (parsedMinPrice !== null && parsedMaxPrice !== null && parsedMinPrice > parsedMaxPrice) {
        alert("Minimum price cannot exceed maximum price.");
        return;
      }
    }

    const baseUpdate = {
      name: editingServiceName.trim(),
      display_name: editingServiceName.trim(),
      variant: editingServiceVariant.trim() || null,
      price: parsedPrice,
      standard_price: parsedPrice,
      vat_rate: parsedVatRate,
      category: canonicalServiceCategory(editingServiceCategory),
      category_id: canonicalServiceCategory(editingServiceCategory),
      default_visit_count: Math.round(parsedVisitCount),
      sort_order: Math.round(parsedSortOrder),
      active_plan_recommended: editingServiceActivePlanRecommended,
      is_active: editingServiceIsActive,
      canonical_service_id: editingServiceCanonicalId || null,
      requires_quantity: editingServiceRequiresQuantity,
      billing_unit: editingServiceBillingUnit,
      tooth_selection_mode: editingServiceToothSelectionMode,
    };

    const pricingFields = {
      pricing_type: editingServicePricingType,
      min_price: editingServicePricingType === "variable" ? parsedMinPrice : null,
      max_price: editingServicePricingType === "variable" ? parsedMaxPrice : null,
    };

    const { error } = await supabase
      .from("services")
      .update({ ...baseUpdate, ...pricingFields })
      .eq("id", id);

    if (error) {
      // If the variable-pricing migration hasn't been applied yet, fall back
      // to saving the base fields so existing services still update correctly.
      const isMissingColumn =
        error.message?.includes("column") &&
        (error.message?.includes("pricing_type") ||
          error.message?.includes("vat_rate") ||
          error.message?.includes("min_price") ||
          error.message?.includes("max_price"));
      if (isMissingColumn) {
        if (error.message?.includes("vat_rate")) {
          alert(`Error updating service: ${error.message}. Please apply the services VAT migration first.`);
          return;
        }
        const fallback = await supabase
          .from("services")
          .update(baseUpdate)
          .eq("id", id);
        if (fallback.error) {
          alert(`Error updating service: ${fallback.error.message}`);
          return;
        }
        alert(
          "Service saved (without pricing range — please apply the variable-pricing migration to Supabase to enable min/max price)."
        );
      } else {
        alert(`Error updating service: ${error.message}`);
        return;
      }
    }

    setEditingServiceId("");
    setEditingServiceName("");
    setEditingServiceVariant("");
    setEditingServicePrice("");
    setEditingServiceVatRate("");
    setEditingServiceDefaultVisitCount("1");
    setEditingServiceSortOrder("0");
    setEditingServiceActivePlanRecommended(false);
    setEditingServiceIsActive(true);
    setEditingServiceCanonicalId("");
    setEditingServiceBillingUnit("Session");
    setEditingServiceRequiresQuantity(false);
    setEditingServiceToothSelectionMode("none");
    setEditingServicePricingType("fixed");
    setEditingServiceMinPrice("");
    setEditingServiceMaxPrice("");
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

  async function markServiceInactive(id: string) {
    const { error } = await supabase
      .from("services")
      .update({ is_active: false })
      .eq("id", id);
    if (error) {
      alert(`Could not mark inactive: ${error.message || "unknown error"}`);
      return;
    }
    loadAll();
  }

  async function mapServiceToCanonical(serviceId: string, canonicalServiceId: string) {
    if (!canonicalServiceId || canonicalServiceId === serviceId) {
      alert("Choose a different canonical service.");
      return;
    }

    const { error } = await supabase
      .from("services")
      .update({ canonical_service_id: canonicalServiceId })
      .eq("id", serviceId);
    if (error) {
      alert(`Could not map canonical service: ${error.message || "unknown error"}`);
      return;
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

    if (!selectedClinicId) {
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

  async function saveReceiptPrintSettings() {
    if (!selectedClinicId) {
      alert("Please select a clinic first.");
      return;
    }

    const payload = {
      address: receiptAddressValue.trim() || null,
      room: receiptRoomValue.trim() || null,
      phone: receiptPhoneValue.trim() || null,
      whatsapp: receiptWhatsappValue.trim() || null,
      instagram: receiptInstagramValue.trim() || null,
      facebook: receiptFacebookValue.trim() || null,
      tiktok: receiptTiktokValue.trim() || null,
      receipt_print_name: receiptPrintNameValue.trim() || null,
      receipt_title: receiptTitleValue.trim() || null,
      receipt_vat_note: receiptVatNoteValue.trim() || null,
      receipt_thank_you: receiptThankYouValue.trim() || null,
      receipt_final_message: receiptFinalMessageValue.trim() || null,
      receipt_qr_url: receiptQrUrlValue.trim() || null,
      trn: receiptTrnValue.trim() || null,
      logo: receiptLogoValue.trim() || null,
    };

    const { error } = await supabase
      .from("clinics")
      .update(payload)
      .eq("id", selectedClinicId);

    if (error) {
      alert(`Error updating clinic receipt settings: ${error.message || error.code || "Unknown error"}`);
      return;
    }

    setClinics((prev) =>
      prev.map((clinic) => (clinic.id === selectedClinicId ? { ...clinic, ...payload } : clinic))
    );
    setReceiptDraftClinicId(selectedClinicId);
    setReceiptAddress(payload.address || "");
    setReceiptRoom(payload.room || "");
    setReceiptPhone(payload.phone || "");
    setReceiptWhatsapp(payload.whatsapp || "");
    setReceiptInstagram(payload.instagram || "");
    setReceiptFacebook(payload.facebook || "");
    setReceiptTiktok(payload.tiktok || "");
    setReceiptPrintName(payload.receipt_print_name || "");
    setReceiptTitle(payload.receipt_title || "");
    setReceiptVatNote(payload.receipt_vat_note || "");
    setReceiptThankYou(payload.receipt_thank_you || "");
    setReceiptFinalMessage(payload.receipt_final_message || "");
    setReceiptQrUrl(payload.receipt_qr_url || "");
    setReceiptTrn(payload.trn || "");
    setReceiptLogo(payload.logo || "");
    alert("Clinic receipt print settings updated.");
  }

  return (
    <div className="relative z-0 space-y-8">
      {(activeSection === "overview" || activeSection === "clinics") && (
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,0.7fr)]">
          <div className="relative overflow-hidden rounded-[28px] border border-slate-200/80 bg-white/92 p-5 shadow-[0_20px_80px_-35px_rgba(14,116,144,0.18)] backdrop-blur">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-700">Selected Clinic</p>
            <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-2xl font-semibold text-slate-950">{selectedClinic?.name || "Clinic"}</h3>
                <p className="mt-2 max-w-2xl text-sm text-slate-500">
                  Use the left navigation for dedicated management screens. Shared thermal branding and A4 invoice branding are now separated into their own routes.
                </p>
              </div>
              <button
                onClick={exportData}
                className="rounded-2xl border border-teal-300 bg-teal-50 px-4 py-2 text-sm font-semibold text-teal-700 transition hover:bg-teal-100"
              >
                ↓ Export Data
              </button>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {[
                ["Room", selectedClinic?.room || "—"],
                ["Phone", selectedClinic?.phone || "—"],
                ["TRN", selectedClinic?.trn || "—"],
                ["Printed Name", selectedClinic?.receipt_print_name || defaultReceiptPrintName],
              ].map(([label, value]) => (
                <div key={label} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">{label}</p>
                  <p className="mt-2 text-sm font-medium text-slate-900">{value}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="relative overflow-hidden rounded-[28px] border border-slate-200/80 bg-white/92 p-5 shadow-[0_20px_80px_-35px_rgba(14,116,144,0.18)] backdrop-blur">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">Quick Routes</p>
            <div className="mt-4 grid gap-3">
              {[
                ["/backend/receipt-branding", "Thermal Receipt & Reprint", "Shared thermal branding used by both receipt printing and reprint."],
                ["/backend/a4-invoice-design", "A4 Invoice Design", "A4-only logo, colors, slogan, and placement. Safe from thermal changes."],
                ["/backend/outstanding-balances", "Outstanding Balances", "Collections, partial balances, and delete actions."],
                ["/backend/access", "Access & PINs", "Active sessions, login attempts, and backend access status."],
              ].map(([href, label, description]) => (
                <Link
                  key={href}
                  href={`${href}${requestedClinicId ? `?clinicId=${requestedClinicId}` : selectedClinicId ? `?clinicId=${selectedClinicId}` : ""}`}
                  className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 transition hover:border-cyan-300 hover:bg-cyan-50"
                >
                  <p className="text-sm font-semibold text-slate-900">{label}</p>
                  <p className="mt-1 text-xs text-slate-500">{description}</p>
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}

      {activeSection === "overview" && (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {recordSummary.map((item) => (
          <div key={item.label} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{item.label}</p>
            <p className="mt-2 text-2xl font-semibold text-slate-900">{item.value}</p>
          </div>
        ))}
      </div>
      )}

      {(activeSection === "overview" || activeSection === "outstanding-balances" || activeSection === "treatment-plans") && (
      <div className="rounded-[28px] border border-amber-200 bg-amber-50 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              {activeSection === "treatment-plans" ? "Active treatment plan balances" : "Outstanding balances by clinic"}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              {activeSection === "treatment-plans"
                ? "Review every active treatment plan, including fully paid ones."
                : "Review who still owes per clinic. Delete is available only from this backend view after unlock."}
            </p>
          </div>
        </div>

        {(activeSection === "treatment-plans" ? treatmentPlanGroupsOnly : activeSection === "outstanding-balances" ? outstandingBalanceGroupsOnly : visibleClinicOutstandingBalanceGroups).length === 0 ? (
          <p className="mt-4 text-sm text-slate-600">No outstanding balances found.</p>
        ) : (
          <div className="mt-4 space-y-3">
            {(activeSection === "treatment-plans" ? treatmentPlanGroupsOnly : activeSection === "outstanding-balances" ? outstandingBalanceGroupsOnly : visibleClinicOutstandingBalanceGroups).map((group) => (
              <div key={group.clinicId} className="rounded-2xl border border-amber-200 bg-white p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{group.clinicName}</p>
                    <p className="text-xs text-slate-500">
                      {group.items.length} {activeSection === "treatment-plans" ? "active treatment plan" : "outstanding balance"}{group.items.length === 1 ? "" : "s"}
                    </p>
                  </div>
                  <p className="text-sm font-semibold text-amber-700">
                    Total AED {group.items.reduce((sum, item) => sum + item.remaining, 0).toFixed(2)}
                  </p>
                </div>

                <div className="mt-3 space-y-2">
                  {group.items.map((item) => {
                    const balanceId = item.kind === "balance" ? item.balance?.id : null;
                    return (
                      <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 px-3 py-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-800">{item.patientName}</p>
                          <p className="text-xs text-slate-500">
                            {item.kind === "balance" && item.balance
                              ? `${formatBalanceReference(item.balance)} · ${new Date(item.balance.original_date).toLocaleDateString("en-GB")}`
                              : `${item.label} · ${item.originalDate ? new Date(item.originalDate).toLocaleDateString("en-GB") : "No date"}`}
                          </p>
                          {item.detailLines && item.detailLines.length > 0 && (
                            <div className="mt-1 space-y-0.5 text-[11px] text-slate-500">
                              {item.detailLines.map((line, index) => (
                                <p key={`${item.id}-detail-${index}`} className="leading-snug">{line}</p>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`text-sm font-semibold ${item.status === "Paid" ? "text-emerald-700" : item.status === "Partial" ? "text-amber-700" : "text-rose-700"}`}>
                            {item.kind === "balance"
                              ? `${item.status} · AED ${item.remaining.toFixed(2)}`
                              : `${item.status === "Unpaid" ? "Active plan" : item.status} · AED ${item.remaining.toFixed(2)}`}
                          </span>
                          {balanceId ? (
                            <button
                              onClick={() => deleteBalance(balanceId)}
                              className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-50"
                            >
                              Delete
                            </button>
                          ) : null}
                          {item.kind === "treatment_plan" ? (
                            <button
                              onClick={() => deleteTreatmentPlan(item.id.replace("plan-", ""))}
                              className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-50"
                            >
                              Delete plan
                            </button>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      )}

      {(activeSection === "clinics" || activeSection === "branding" || activeSection === "reports" || activeSection === "system-settings") && (
        <div className="grid items-start gap-6 xl:grid-cols-3">
          {(activeSection === "clinics" || activeSection === "branding") && (
            <>
              <Link
                href={`${"/backend/receipt-branding"}${selectedClinicId ? `?clinicId=${selectedClinicId}` : ""}`}
                className="relative overflow-hidden rounded-[28px] border border-cyan-200 bg-white/92 p-5 shadow-[0_20px_80px_-35px_rgba(14,116,144,0.18)] transition hover:border-cyan-300 hover:bg-cyan-50"
              >
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-700">Shared Branding</p>
                <h3 className="mt-3 text-lg font-semibold text-slate-950">Thermal Receipt & Reprint</h3>
                <p className="mt-2 text-sm text-slate-500">
                  Edit the shared thermal logo, printed name, VAT note, QR, socials, and footer copy used by both thermal printing and reprint.
                </p>
              </Link>
              <Link
                href={`${"/backend/a4-invoice-design"}${selectedClinicId ? `?clinicId=${selectedClinicId}` : ""}`}
                className="relative overflow-hidden rounded-[28px] border border-amber-200 bg-white/92 p-5 shadow-[0_20px_80px_-35px_rgba(245,158,11,0.18)] transition hover:border-amber-300 hover:bg-amber-50"
              >
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-amber-700">A4 Branding</p>
                <h3 className="mt-3 text-lg font-semibold text-slate-950">A4 Invoice Design</h3>
                <p className="mt-2 text-sm text-slate-500">
                  Manage A4-only logo uploads, size, alignment, offsets, colors, and slogan without changing thermal receipts.
                </p>
              </Link>
            </>
          )}

          {(activeSection === "clinics" || activeSection === "system-settings") && (
            <div className="relative overflow-hidden rounded-[28px] border border-violet-200 bg-white/92 p-5 shadow-[0_20px_80px_-35px_rgba(124,58,237,0.2)] xl:col-span-2">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-violet-700">Clinic Cash Deductions</p>
              <h3 className="mt-3 text-lg font-semibold text-slate-950">Expenses & Commissions</h3>
              <p className="mt-2 text-sm text-slate-500">
                Control whether receptionists can record cash deductions for this clinic while a register is open. Turning a switch off stops new entries only; historical records remain available.
              </p>

              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={clinicExpensesEnabledDraft}
                    onChange={(e) => setClinicExpensesEnabledDraft(e.target.checked)}
                    className="mt-1 h-4 w-4 rounded accent-violet-600"
                  />
                  <span>
                    <span className="block text-sm font-semibold text-slate-900">Enable Expenses</span>
                    <span className="mt-1 block text-xs text-slate-500">
                      Show the POS deduction flow for supplier, shop, and petty-cash style expenses.
                    </span>
                  </span>
                </label>
                <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={clinicCommissionsEnabledDraft}
                    onChange={(e) => setClinicCommissionsEnabledDraft(e.target.checked)}
                    className="mt-1 h-4 w-4 rounded accent-violet-600"
                  />
                  <span>
                    <span className="block text-sm font-semibold text-slate-900">Enable Commissions</span>
                    <span className="mt-1 block text-xs text-slate-500">
                      Allow commission deductions for aestheticians or staff selected from this clinic&apos;s doctor list.
                    </span>
                  </span>
                </label>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  onClick={saveClinicDeductionSettings}
                  disabled={isSavingClinicDeductionSettings || !selectedClinicId}
                  className="rounded-2xl bg-violet-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet-600 disabled:opacity-50"
                >
                  {isSavingClinicDeductionSettings ? "Saving..." : "Save Cash Deduction Settings"}
                </button>
                <p className="text-xs text-slate-500">
                  Current clinic: <span className="font-semibold text-slate-700">{selectedClinic?.name || "Select a clinic"}</span>
                </p>
              </div>
            </div>
          )}

          {(activeSection === "reports" || activeSection === "system-settings") && (
            <>
              <Link
                href="/reports"
                className="relative overflow-hidden rounded-[28px] border border-emerald-200 bg-white/92 p-5 shadow-[0_20px_80px_-35px_rgba(16,185,129,0.18)] transition hover:border-emerald-300 hover:bg-emerald-50"
              >
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-emerald-700">Analytics</p>
                <h3 className="mt-3 text-lg font-semibold text-slate-950">Open Reports Workspace</h3>
                <p className="mt-2 text-sm text-slate-500">
                  Continue using the existing reports route while the backend dashboard routes are rolled out incrementally.
                </p>
              </Link>
              <div className="relative overflow-hidden rounded-[28px] border border-slate-200/80 bg-white/92 p-5 shadow-[0_20px_80px_-35px_rgba(14,116,144,0.18)]">
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">System Tools</p>
                <h3 className="mt-3 text-lg font-semibold text-slate-950">Exports & Operational Checks</h3>
                <p className="mt-2 text-sm text-slate-500">
                  Export patient and receipt data, verify cashier sessions, and use this page as the compatibility home for system-level actions.
                </p>
                <button
                  onClick={exportData}
                  className="mt-4 rounded-2xl border border-teal-300 bg-teal-50 px-4 py-2 text-sm font-semibold text-teal-700 transition hover:bg-teal-100"
                >
                  ↓ Export Data
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {activeSection === "patients" && (
        <div className="rounded-[28px] border border-slate-200 bg-white/92 p-5 shadow-[0_20px_80px_-35px_rgba(14,116,144,0.18)]">
          <h2 className="text-lg font-semibold text-slate-900">Patients</h2>
          <p className="mt-1 text-sm text-slate-500">
            Showing only patients linked to the selected clinic. Large clinics are paginated for easier browsing.
          </p>
          <input
            value={patientSearch}
            onChange={(e) => {
              setPatientSearch(e.target.value);
              setPatientPage(1);
            }}
            placeholder="Search name, phone, file no, or patient number"
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
            <input
              value={patientMrn}
              onChange={(e) => setPatientMrn(e.target.value)}
              placeholder="MRN (Medical Record No.)"
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
                    <input
                      value={editingPatientMrn}
                      onChange={(e) => setEditingPatientMrn(e.target.value)}
                      placeholder="MRN (Medical Record No.)"
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
                  <>
                    <button
                      className="flex w-full items-center justify-between gap-3 text-left"
                      onClick={() => setExpandedPatientId(expandedPatientId === patient.id ? null : patient.id)}
                    >
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{patient.name}</p>
                        <p className="text-xs text-slate-500">
                          {patient.phone || "-"}
                          {" "}· File No: {patient.clinic_file_no || "—"}
                          {patient.patient_number ? ` · Patient #${patient.patient_number}` : ""}
                        </p>
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
                        {patient.mrn && (
                          <p className="text-xs text-slate-400">MRN: {patient.mrn}</p>
                        )}
                        {patient.notes && (
                          <p className="text-xs italic text-slate-400">{patient.notes}</p>
                        )}
                        {(() => {
                          const patientBalances = balancesByPatient.get(patient.id) || [];
                          if (patientBalances.length === 0) return null;
                          return (
                            <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 p-2">
                              <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                                Outstanding Balances
                              </p>
                              <ul className="mt-1 space-y-1">
                                {patientBalances.map((bal) => {
                                  const roll = rollupBalance(bal, paymentsByBalance.get(bal.id) || []);
                                  return (
                                    <li key={bal.id} className="flex items-center justify-between gap-2 text-xs">
                                      <span className="min-w-0 truncate text-slate-700">
                                        {clinicNameById.get(bal.clinic_id) || "—"} · {new Date(bal.original_date).toLocaleDateString("en-GB")} · {formatBalanceReference(bal)}
                                      </span>
                                      <span className="flex items-center gap-2 shrink-0">
                                        <span className={
                                          roll.status === "Paid"
                                            ? "text-emerald-700"
                                            : roll.status === "Partial"
                                            ? "text-amber-700"
                                            : "text-rose-700"
                                        }>
                                          AED {roll.remaining.toFixed(2)} · {roll.status}
                                        </span>
                                        <button
                                          onClick={() => deleteBalance(bal.id)}
                                          className="text-[10px] font-semibold text-rose-600 hover:underline"
                                          title="Delete balance"
                                        >
                                          ×
                                        </button>
                                      </span>
                                    </li>
                                  );
                                })}
                              </ul>
                            </div>
                          );
                        })()}
                        <div className="flex flex-wrap gap-2 pt-2">
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
                              setEditingPatientMrn(patient.mrn || "");
                              setExpandedPatientId(null);
                            }}
                            className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => setAddBalancePatient(patient)}
                            className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100"
                          >
                            + Add Balance
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
                  </>
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
              <span className="text-xs text-slate-500">Page {currentPatientPage} of {patientTotalPages}</span>
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
        )}

        {activeSection === "doctors" && (
        <div className="rounded-[28px] border border-slate-200 bg-white/92 p-5 shadow-[0_20px_80px_-35px_rgba(14,116,144,0.18)]">
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
        )}

        {activeSection === "services" && (
        <div className="rounded-[28px] border border-slate-200 bg-white/92 p-5 shadow-[0_20px_80px_-35px_rgba(14,116,144,0.18)]">
          <h2 className="text-lg font-semibold text-slate-900">Services</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <input
              value={serviceName}
              onChange={(e) => setServiceName(e.target.value)}
              placeholder="Service name"
              className="rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100 sm:col-span-2"
            />
            <input
              type="number"
              value={servicePrice}
              onChange={(e) => setServicePrice(e.target.value)}
              placeholder="Price"
              className="rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
            />
            <div className="space-y-1">
              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">VAT Rate</label>
              <select
                value={serviceVatRate}
                onChange={(e) => setServiceVatRate(e.target.value as VatRateDraft)}
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
              >
                <option value="">Select VAT rate</option>
                <option value="0">No VAT</option>
                <option value="0.05">5% VAT</option>
              </select>
              <p className="text-[11px] text-slate-500">Required for new services.</p>
            </div>
            <input
              list="service-category-options"
              value={serviceCategory}
              onChange={(e) => setServiceCategory(e.target.value)}
              placeholder="Category (pick existing or type a new one)"
              className="rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100 sm:col-span-2"
            />
            <datalist id="service-category-options">
              {existingServiceCategories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
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
                      placeholder={editingServicePricingType === "variable" ? "Suggested price" : "Price"}
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none"
                    />
                    <div className="space-y-1">
                      <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">VAT Rate</label>
                      <select
                        value={editingServiceVatRate}
                        onChange={(e) => setEditingServiceVatRate(e.target.value as VatRateDraft)}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none"
                      >
                        <option value="">Not configured</option>
                        <option value="0">No VAT</option>
                        <option value="0.05">5% VAT</option>
                      </select>
                      {editingServiceVatRate === "" && (
                        <p className="text-[11px] text-amber-700">Legacy service: VAT has not been configured yet.</p>
                      )}
                    </div>
                    <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <div className="flex items-center gap-3">
                        <label className="text-xs font-semibold text-slate-500">Pricing Type</label>
                        <select
                          value={editingServicePricingType}
                          onChange={(e) => setEditingServicePricingType(e.target.value as "fixed" | "variable")}
                          className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm outline-none"
                        >
                          <option value="fixed">Fixed price</option>
                          <option value="variable">Variable range</option>
                        </select>
                      </div>
                      {editingServicePricingType === "variable" && (
                        <div className="flex items-center gap-2">
                          <div className="flex-1">
                            <label className="mb-1 block text-[11px] font-semibold text-violet-600">Min Price</label>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={editingServiceMinPrice}
                              onChange={(e) => setEditingServiceMinPrice(e.target.value)}
                              placeholder="Min"
                              className="w-full rounded-xl border border-violet-200 px-3 py-2 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                            />
                          </div>
                          <span className="mt-5 text-slate-400">–</span>
                          <div className="flex-1">
                            <label className="mb-1 block text-[11px] font-semibold text-violet-600">Max Price</label>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={editingServiceMaxPrice}
                              onChange={(e) => setEditingServiceMaxPrice(e.target.value)}
                              placeholder="Max"
                              className="w-full rounded-xl border border-violet-200 px-3 py-2 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                    <input
                      value={editingServiceVariant}
                      onChange={(e) => setEditingServiceVariant(e.target.value)}
                      placeholder="Variant / short description"
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none"
                    />
                    <input
                      list="service-category-options"
                      value={editingServiceCategory}
                      onChange={(e) => setEditingServiceCategory(e.target.value)}
                      placeholder="Category (pick existing or type a new one)"
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none"
                    />
                    <select
                      value={editingServiceCanonicalId}
                      onChange={(e) => setEditingServiceCanonicalId(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none"
                    >
                      <option value="">Canonical service: none</option>
                      {displayedServices
                        .filter((s) => s.id !== service.id)
                        .map((s) => (
                          <option key={s.id} value={s.id}>
                            {String(s.display_name || s.name || "")}
                          </option>
                        ))}
                    </select>
                    <div className="flex flex-wrap items-center gap-4">
                      <div className="flex items-center gap-2">
                        <label className="text-xs font-semibold text-slate-500">Default Visits</label>
                        <input
                          type="number"
                          min="1"
                          value={editingServiceDefaultVisitCount}
                          onChange={(e) => setEditingServiceDefaultVisitCount(e.target.value)}
                          className="w-20 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none"
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <label className="text-xs font-semibold text-slate-500">Sort Order</label>
                        <input
                          type="number"
                          value={editingServiceSortOrder}
                          onChange={(e) => setEditingServiceSortOrder(e.target.value)}
                          className="w-20 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none"
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <label className="text-xs font-semibold text-slate-500">Billing Unit</label>
                        <select
                          value={editingServiceBillingUnit}
                          onChange={(e) => setEditingServiceBillingUnit(e.target.value)}
                          className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-cyan-300"
                        >
                          {["Session", "Tooth", "Syringe", "Area", "Unit", "Pack", "Other"].map((u) => (
                            <option key={u} value={u}>{u}</option>
                          ))}
                        </select>
                      </div>
                      <div className="flex items-center gap-2">
                        <label className="text-xs font-semibold text-slate-500">Tooth Selection</label>
                        <select
                          value={editingServiceToothSelectionMode}
                          onChange={(e) => setEditingServiceToothSelectionMode(e.target.value as "none" | "optional" | "required")}
                          className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-cyan-300"
                        >
                          <option value="none">Off</option>
                          <option value="optional">Optional</option>
                          <option value="required">Required</option>
                        </select>
                      </div>
                      <label className="flex cursor-pointer items-center gap-2">
                        <input
                          type="checkbox"
                          checked={editingServiceRequiresQuantity}
                          onChange={(e) => setEditingServiceRequiresQuantity(e.target.checked)}
                          className="h-4 w-4 rounded accent-cyan-600"
                        />
                        <span className="text-sm text-slate-700">Requires Quantity</span>
                      </label>
                      <label className="flex cursor-pointer items-center gap-2">
                        <input
                          type="checkbox"
                          checked={editingServiceActivePlanRecommended}
                          onChange={(e) => setEditingServiceActivePlanRecommended(e.target.checked)}
                          className="h-4 w-4 rounded accent-cyan-600"
                        />
                        <span className="text-sm text-slate-700">Plan recommended</span>
                      </label>
                      <label className="flex cursor-pointer items-center gap-2">
                        <input
                          type="checkbox"
                          checked={editingServiceIsActive}
                          onChange={(e) => setEditingServiceIsActive(e.target.checked)}
                          className="h-4 w-4 rounded accent-cyan-600"
                        />
                        <span className="text-sm text-slate-700">Active</span>
                      </label>
                    </div>
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
                      <p className="text-sm font-semibold text-slate-900">
                        {service.display_name || service.name}
                        {service.is_active === false && (
                          <span className="ml-2 rounded-full bg-slate-200 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600">Inactive</span>
                        )}
                      </p>
                      {service.variant && (
                        <p className="text-xs text-slate-500">{service.variant}</p>
                      )}
                      <p className="flex items-center gap-1.5 text-sm text-slate-500">
                        AED {Number(service.price || 0).toFixed(2)} / {service.billing_unit || "Session"}
                        {service.category && (
                          <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-600">{service.category}</span>
                        )}
                        {Number(service.default_visit_count || 1) > 1 && (
                          <span className="rounded-full bg-indigo-100 px-1.5 py-0.5 text-xs font-semibold text-indigo-700">Visits {Number(service.default_visit_count)}</span>
                        )}
                        {service.requires_quantity && (
                          <span className="rounded-full bg-cyan-100 px-1.5 py-0.5 text-xs font-semibold text-cyan-700">Qty</span>
                        )}
                        {service.tooth_selection_mode && service.tooth_selection_mode !== "none" && (
                          <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-700">
                            Teeth {service.tooth_selection_mode === "required" ? "On" : "Opt"}
                          </span>
                        )}
                        {service.active_plan_recommended && (
                          <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-xs font-semibold text-emerald-700">Plan</span>
                        )}
                        <span
                          className={`rounded-full px-1.5 py-0.5 text-xs font-semibold ${
                            service.vat_rate == null
                              ? "bg-amber-100 text-amber-700"
                              : service.vat_rate === 0.05
                                ? "bg-emerald-100 text-emerald-700"
                                : "bg-slate-100 text-slate-600"
                          }`}
                        >
                          {formatVatRateLabel(service.vat_rate)}
                        </span>
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          setEditingServiceId(service.id);
                          setEditingServiceName(service.display_name || service.name || "");
                          setEditingServiceVariant(service.variant || service.description || "");
                          setEditingServicePrice(String(service.price ?? ""));
                          setEditingServiceVatRate(vatRateDraftFromValue(service.vat_rate));
                          setEditingServiceCategory(service.category || "");
                          setEditingServiceDefaultVisitCount(String(service.default_visit_count || 1));
                          setEditingServiceSortOrder(String(service.sort_order ?? 0));
                          setEditingServiceActivePlanRecommended(Boolean(service.active_plan_recommended));
                          setEditingServiceIsActive(service.is_active !== false);
                          setEditingServiceCanonicalId(service.canonical_service_id || "");
                          setEditingServiceBillingUnit(service.billing_unit || "Session");
                          setEditingServiceRequiresQuantity(service.requires_quantity ?? false);
                          setEditingServiceToothSelectionMode((service.tooth_selection_mode as "none" | "optional" | "required") || "none");
                          setEditingServicePricingType((service.pricing_type as "fixed" | "variable") || "fixed");
                          setEditingServiceMinPrice(service.min_price != null ? String(service.min_price) : "");
                          setEditingServiceMaxPrice(service.max_price != null ? String(service.max_price) : "");
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
                      {service.is_active !== false && (
                        <button
                          onClick={() => markServiceInactive(service.id)}
                          className="rounded-xl bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white"
                        >
                          Inactivate
                        </button>
                      )}
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

          <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <h3 className="text-sm font-semibold text-amber-900">Duplicate & Quality Review</h3>
            <p className="mt-1 text-xs text-amber-800">
              Review only. Historical receipts may reference old rows, so do not delete duplicates blindly.
            </p>

            <div className="mt-3 space-y-3 text-xs text-slate-700">
              <p>Exact duplicate names: <span className="font-semibold">{duplicateReview.exactDuplicates.length}</span></p>
              <p>Case-only duplicates: <span className="font-semibold">{duplicateReview.caseOnlyDuplicates.length}</span></p>
              <p>Similar names, different prices: <span className="font-semibold">{duplicateReview.similarDifferentPrice.length}</span></p>
              <p>Missing categories: <span className="font-semibold">{duplicateReview.missingCategory.length}</span></p>
              <p>Missing/zero prices: <span className="font-semibold">{duplicateReview.missingOrZeroPrice.length}</span></p>
              <p>Inconsistent spacing/punctuation: <span className="font-semibold">{duplicateReview.inconsistentSpacingOrPunctuation.length}</span></p>
            </div>

            <div className="mt-4 space-y-3">
              {[...duplicateReview.exactDuplicates, ...duplicateReview.caseOnlyDuplicates, ...duplicateReview.similarDifferentPrice]
                .slice(0, 12)
                .map((group, index) => (
                  <div key={`dup-${index}`} className="rounded-xl border border-amber-200 bg-white p-3">
                    <p className="text-xs font-semibold text-slate-700">
                      {group.map((s) => String(s.display_name || s.name || "")).join(" · ")}
                    </p>
                    <div className="mt-2 space-y-2">
                      {group.map((service) => {
                        const mappedValue = duplicateCanonicalTargets[service.id] || service.canonical_service_id || "";
                        return (
                          <div key={service.id} className="rounded-lg border border-slate-200 p-2">
                            <p className="text-xs text-slate-700">
                              {String(service.display_name || service.name || "")} — AED {Number(service.price || 0).toFixed(2)}
                            </p>
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                onClick={() => markServiceInactive(service.id)}
                                className="rounded-lg bg-amber-500 px-2 py-1 text-[11px] font-semibold text-white"
                              >
                                Mark inactive
                              </button>
                              <select
                                value={mappedValue}
                                onChange={(e) =>
                                  setDuplicateCanonicalTargets((current) => ({ ...current, [service.id]: e.target.value }))
                                }
                                className="rounded-lg border border-slate-200 px-2 py-1 text-[11px]"
                              >
                                <option value="">Map to canonical service</option>
                                {displayedServices
                                  .filter((s) => s.id !== service.id)
                                  .map((s) => (
                                    <option key={s.id} value={s.id}>
                                      {String(s.display_name || s.name || "")}
                                    </option>
                                  ))}
                              </select>
                              <button
                                type="button"
                                onClick={() => mapServiceToCanonical(service.id, mappedValue)}
                                className="rounded-lg bg-slate-900 px-2 py-1 text-[11px] font-semibold text-white"
                              >
                                Save mapping
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </div>
        )}

        {activeSection === "receptionists" && (
        <div className="rounded-[28px] border border-slate-200 bg-white/92 p-5 shadow-[0_20px_80px_-35px_rgba(14,116,144,0.18)]">
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
              <option value="Mid Shift">Mid Shift</option>
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
                      <option value="Mid Shift">Mid Shift</option>
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
      )}
      {(activeSection === "system-settings" || activeSection === "overview") && (
      <div className="rounded-[28px] border border-slate-200 bg-white/92 p-5 shadow-[0_20px_80px_-35px_rgba(14,116,144,0.18)]">
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
        ) : displayedCashSessions.length === 0 ? (
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
                {displayedCashSessions.map((session) => {
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
      )}

      {/* Login Sessions */}
      {(activeSection === "access" || activeSection === "overview") && (
      <div className="rounded-[28px] border border-slate-200 bg-white/92 p-5 shadow-[0_20px_80px_-35px_rgba(14,116,144,0.18)]">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Active Sessions</h2>
            <p className="mt-1 text-sm text-slate-500">People currently logged into the app. Remove anyone you don&apos;t recognise.</p>
          </div>
          <button onClick={loadAll} className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50">Refresh</button>
        </div>
        {activeSessions.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">No active sessions.</div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-slate-700">IP Address</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-700">Browser / Device</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-700">Logged In</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-700"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {activeSessions.map((s) => (
                  <tr key={s.token}>
                    <td className="px-4 py-3 text-slate-800">{s.ip}</td>
                    <td className="px-4 py-3 text-slate-600 max-w-xs truncate">{s.user_agent}</td>
                    <td className="px-4 py-3 text-slate-600">{new Date(s.created_at).toLocaleString()}</td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => { if (confirm("Remove this session? That person will be logged out.")) revokeSession(s.token); }}
                        className="rounded-lg bg-red-50 px-3 py-1 text-xs font-semibold text-red-600 hover:bg-red-100 transition"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-6">
          <h3 className="mb-3 text-sm font-semibold text-slate-700">Recent Login Attempts</h3>
          {loginLogs.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">No login attempts recorded.</div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-slate-200">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">IP Address</th>
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">Browser / Device</th>
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">Time</th>
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">Result</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {loginLogs.map((log) => (
                    <tr key={log.id}>
                      <td className="px-4 py-3 text-slate-800">{log.ip}</td>
                      <td className="px-4 py-3 text-slate-600 max-w-xs truncate">{log.user_agent}</td>
                      <td className="px-4 py-3 text-slate-600">{new Date(log.created_at).toLocaleString()}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${log.success ? "bg-teal-100 text-teal-700" : "bg-red-100 text-red-700"}`}>
                          {log.success ? "Success" : "Failed"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
      )}
      <AddOutstandingBalanceModal
        isOpen={addBalancePatient !== null}
        onClose={() => setAddBalancePatient(null)}
        patient={addBalancePatient}
        clinics={clinics}
        createdBy={null}
        onSaved={(bal) => {
          setOutstandingBalances((prev) => [bal, ...prev]);
        }}
      />
    </div>
  );
}
