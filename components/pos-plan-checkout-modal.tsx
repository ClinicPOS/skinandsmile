"use client";

import { useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import type { Clinic, TreatmentPlan, TreatmentPlanPayment } from "../lib/types";
import {
  buildPaymentAllocations,
  paymentSummaryLabel,
  paymentVariantLabel,
  PaymentAllocationDraft,
  PaymentMethodVariant,
  referenceRequiredForVariant,
  validatePaymentAllocations,
} from "../lib/payment-allocation";
import { toMinorUnits } from "../lib/money";
import { generateTreatmentPlanPaymentInvoiceHtml } from "../lib/generate-invoice-html";
import { printTreatmentPlanPaymentReceipt } from "../lib/print-treatment-plan-payment-receipt";
import { printHtmlWhenImagesReady } from "../lib/receipt-branding";
import { buildTreatmentPlanPaymentRpcArgs } from "../lib/treatment-plan-payment-records";

const PAYMENT_MODE_OPTIONS = ["Cash", "Card", "Tabby", "Tamara", "Split Payment"] as const;
const PAYMENT_ARRANGEMENTS = [
  "Full payment today",
  "Down payment + remaining balance",
  "Payment per visit",
  "50% now / 50% later",
  "Custom schedule",
  "No payment today",
];
const ALLOCATION_METHOD_OPTIONS: Array<{ value: PaymentMethodVariant; label: string }> = [
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
  { value: "tabby_standard", label: "Tabby" },
  { value: "tabby_card", label: "Tabby Card" },
  { value: "tamara", label: "Tamara" },
];

type PostSaveActionAllocation = {
  methodLabel: string;
  invoiceAllocationAmount: number;
  feeAmount: number;
  customerChargedAmount: number;
  providerReferenceNumber?: string | null;
  terminalAuthorizationCode?: string | null;
};

type PostSaveActionContext = {
  clinic: Clinic | null;
  patientName: string;
  patientFileNo: string;
  planTitle: string;
  planTotalAmount: number;
  paymentArrangement: string;
  agreedTotal: number;
  amountSettledToday: number;
  remainingAfterToday: number;
  totalFeeAmount: number;
  totalCustomerPaid: number;
  cashierName: string;
  services: Array<{ id: string; name: string; price: number; quantity?: number; teeth?: string[] }>;
  allocations: PostSaveActionAllocation[];
  plannedVisits: number;
  completedVisits: number;
  createdAt?: string;
  referenceNo?: string;
};

function newAllocationDraft(methodVariant: PaymentMethodVariant | "" = "", amount = ""): PaymentAllocationDraft {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    methodVariant,
    invoiceAllocationAmountInput: amount,
    providerReferenceNumber: "",
    terminalAuthorizationCode: "",
    cardNetwork: "",
  };
}

function modeToVariant(mode: string): PaymentMethodVariant {
  if (mode === "Cash") return "cash";
  if (mode === "Card") return "card";
  if (mode === "Tabby") return "tabby_standard";
  if (mode === "Tamara") return "tamara";
  return "cash";
}

export function PosPlanCheckoutModal({
  isOpen,
  onClose,
  onSaved,
  patientId,
  patientName,
  clinicId,
  clinicPatientFileId,
  patientFileNo,
  doctorId,
  receptionistId,
  receptionistName,
  registerSessionId,
  services,
  subtotal,
  total,
  discountAmount,
  vat,
  clinic,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSaved: (plan: TreatmentPlan, payments: TreatmentPlanPayment[]) => void;
  patientId: string;
  patientName: string;
  clinicId: string;
  clinicPatientFileId: string;
  patientFileNo: string;
  doctorId: string;
  receptionistId: string;
  receptionistName: string;
  registerSessionId: string;
  services: Array<{ id: string; name: string; price: number; quantity?: number; teeth?: string[] }>;
  subtotal: number;
  total: number;
  discountAmount: number;
  vat: number;
  clinic: Clinic | null;
}) {
  const defaultTitle = services.length === 1 ? services[0].name : `Treatment Plan — ${services.map((s) => s.name).join(", ")}`;
  const [planTitle, setPlanTitle] = useState(defaultTitle);
  const [plannedVisits, setPlannedVisits] = useState("5");
  const [agreedTotal, setAgreedTotal] = useState(String(total.toFixed(2)));
  const [paymentArrangement, setPaymentArrangement] = useState("Full payment today");
  const [amountToday, setAmountToday] = useState(String(total.toFixed(2)));
  const [paymentMode, setPaymentMode] = useState<(typeof PAYMENT_MODE_OPTIONS)[number]>("Cash");
  const [paymentAllocationDrafts, setPaymentAllocationDrafts] = useState<PaymentAllocationDraft[]>([]);
  const [paymentValidationErrors, setPaymentValidationErrors] = useState<string[]>([]);
  const [planNotes, setPlanNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState<"config" | "payment">("config");
  const [postSaveActionContext, setPostSaveActionContext] = useState<PostSaveActionContext | null>(null);
  const [isDownloadingInvoice, setIsDownloadingInvoice] = useState(false);

  const agreedTotalNum = parseFloat(agreedTotal) || 0;
  const amountTodayNum = parseFloat(amountToday) || 0;
  const remainingAfterToday = Math.max(0, agreedTotalNum - amountTodayNum);
  const amountTodayMinor = toMinorUnits(amountTodayNum);

  const previewAllocations = useMemo(() => {
    if (amountTodayNum <= 0.001 || paymentAllocationDrafts.length === 0) return [];
    return buildPaymentAllocations(paymentAllocationDrafts, amountTodayNum, amountTodayNum, 0);
  }, [amountTodayNum, paymentAllocationDrafts]);

  const allocationInvoiceMinor = previewAllocations.reduce((sum, allocation) => sum + toMinorUnits(allocation.invoiceAllocationAmount), 0);
  const allocationBalanced = amountTodayMinor === allocationInvoiceMinor;
  const paymentFeeTotal = previewAllocations.reduce((sum, allocation) => sum + allocation.feeAmount, 0);
  const customerChargeTotal = previewAllocations.reduce((sum, allocation) => sum + allocation.customerChargedAmount, 0);

  function buildPostSaveActionContext(
    allocations: PostSaveActionAllocation[],
    createdAt?: string,
    referenceNo?: string,
  ): PostSaveActionContext {
    return {
      clinic,
      patientName,
      patientFileNo,
      planTitle: planTitle.trim(),
      planTotalAmount: agreedTotalNum,
      paymentArrangement,
      agreedTotal: agreedTotalNum,
      amountSettledToday: amountTodayNum,
      remainingAfterToday,
      totalFeeAmount: paymentFeeTotal,
      totalCustomerPaid: customerChargeTotal,
      cashierName: receptionistName || "Reception",
      services,
      allocations,
      plannedVisits: parseInt(plannedVisits, 10) || 1,
      completedVisits: 1,
      createdAt,
      referenceNo,
    };
  }

  async function handleDownloadInvoicePdf() {
    if (!postSaveActionContext) return;
    setIsDownloadingInvoice(true);
    try {
      const html = generateTreatmentPlanPaymentInvoiceHtml({
        clinic: postSaveActionContext.clinic,
        receiptNumber: postSaveActionContext.referenceNo || `TPP-${String(postSaveActionContext.createdAt || Date.now()).slice(0, 8)}`,
        issuedAt: new Date(postSaveActionContext.createdAt || Date.now()),
        cashierName: postSaveActionContext.cashierName,
        patient: {
          name: postSaveActionContext.patientName,
          phone: null,
          fileNumber: postSaveActionContext.patientFileNo || undefined,
        },
        doctorName: undefined,
        planTitle: postSaveActionContext.planTitle,
        planTotalAmount: postSaveActionContext.planTotalAmount,
        amountSettledToday: postSaveActionContext.amountSettledToday,
        paymentFeeAmount: postSaveActionContext.totalFeeAmount,
        paymentAllocations: postSaveActionContext.allocations.map((allocation) => ({
          methodLabel: allocation.methodLabel,
          invoiceAllocationAmount: allocation.invoiceAllocationAmount,
          feeAmount: allocation.feeAmount,
          customerChargedAmount: allocation.customerChargedAmount,
          providerReferenceNumber: allocation.providerReferenceNumber,
          terminalAuthorizationCode: allocation.terminalAuthorizationCode,
        })),
        remainingAfterToday: postSaveActionContext.remainingAfterToday,
        plannedVisits: postSaveActionContext.plannedVisits,
        completedVisits: postSaveActionContext.completedVisits,
        notes: `Payment arrangement: ${postSaveActionContext.paymentArrangement}`,
      });
      const res = await fetch("/api/generate-invoice-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ html, filename: `${postSaveActionContext.planTitle.replace(/\s+/g, "_").slice(0, 40)}_Invoice.pdf` }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(`Could not generate invoice PDF: ${err.error || res.statusText}`);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${postSaveActionContext.planTitle.replace(/\s+/g, "_").slice(0, 40)}_Invoice.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (error: any) {
      alert(`Invoice download failed: ${error?.message || "Unknown error"}`);
    } finally {
      setIsDownloadingInvoice(false);
    }
  }

  function handlePrintA4Invoice() {
    if (!postSaveActionContext) return;
    const html = generateTreatmentPlanPaymentInvoiceHtml({
      clinic: postSaveActionContext.clinic,
      receiptNumber: postSaveActionContext.referenceNo || `TPP-${String(postSaveActionContext.createdAt || Date.now()).slice(0, 8)}`,
      issuedAt: new Date(postSaveActionContext.createdAt || Date.now()),
      cashierName: postSaveActionContext.cashierName,
      patient: {
        name: postSaveActionContext.patientName,
        phone: null,
        fileNumber: postSaveActionContext.patientFileNo || undefined,
      },
      doctorName: undefined,
      planTitle: postSaveActionContext.planTitle,
      planTotalAmount: postSaveActionContext.planTotalAmount,
      amountSettledToday: postSaveActionContext.amountSettledToday,
      paymentFeeAmount: postSaveActionContext.totalFeeAmount,
      paymentAllocations: postSaveActionContext.allocations.map((allocation) => ({
        methodLabel: allocation.methodLabel,
        invoiceAllocationAmount: allocation.invoiceAllocationAmount,
        feeAmount: allocation.feeAmount,
        customerChargedAmount: allocation.customerChargedAmount,
        providerReferenceNumber: allocation.providerReferenceNumber,
        terminalAuthorizationCode: allocation.terminalAuthorizationCode,
      })),
      remainingAfterToday: postSaveActionContext.remainingAfterToday,
      plannedVisits: postSaveActionContext.plannedVisits,
      completedVisits: postSaveActionContext.completedVisits,
      notes: `Payment arrangement: ${postSaveActionContext.paymentArrangement}`,
    });
    printHtmlWhenImagesReady(html, "Please allow popups to print the invoice.");
  }

  function handlePrintReceipt() {
    if (!postSaveActionContext) return;
    printTreatmentPlanPaymentReceipt({
      clinic: postSaveActionContext.clinic,
      patientName: postSaveActionContext.patientName,
      patientFileNo: postSaveActionContext.patientFileNo,
      planTitle: postSaveActionContext.planTitle,
      paymentArrangement: postSaveActionContext.paymentArrangement,
      agreedTotal: postSaveActionContext.agreedTotal,
      amountSettledToday: postSaveActionContext.amountSettledToday,
      remainingAfterToday: postSaveActionContext.remainingAfterToday,
      totalFeeAmount: postSaveActionContext.totalFeeAmount,
      totalCustomerPaid: postSaveActionContext.totalCustomerPaid,
      cashierName: postSaveActionContext.cashierName,
      services: postSaveActionContext.services,
      allocations: postSaveActionContext.allocations.map((allocation) => ({
        methodLabel: allocation.methodLabel,
        invoiceAllocationAmount: allocation.invoiceAllocationAmount,
        feeAmount: allocation.feeAmount,
        customerChargedAmount: allocation.customerChargedAmount,
      })),
      createdAt: postSaveActionContext.createdAt,
      referenceNo: postSaveActionContext.referenceNo,
    });
  }

  if (!isOpen) return null;

  function prepareDraftsForMode(mode: (typeof PAYMENT_MODE_OPTIONS)[number]) {
    if (amountTodayNum <= 0.001) {
      setPaymentAllocationDrafts([]);
      return;
    }

    if (mode !== "Split Payment") {
      const variant = modeToVariant(mode);
      setPaymentAllocationDrafts([newAllocationDraft(variant, amountTodayNum.toFixed(2))]);
      return;
    }

    setPaymentAllocationDrafts([
      newAllocationDraft("cash", amountTodayNum.toFixed(2)),
      newAllocationDraft("card", "0.00"),
    ]);
  }

  function applyRemainingToLastRow(drafts: PaymentAllocationDraft[], editedIndex: number) {
    if (paymentMode !== "Split Payment" || drafts.length < 2) return drafts;
    const lastIndex = drafts.length - 1;
    if (editedIndex === lastIndex) return drafts;

    const sumPrevious = drafts
      .slice(0, lastIndex)
      .reduce((sum, row) => sum + (parseFloat(String(row.invoiceAllocationAmountInput || "0").replace(/,/g, ".")) || 0), 0);
    const remaining = Math.max(0, Math.round((amountTodayNum - sumPrevious) * 100) / 100);

    const next = [...drafts];
    next[lastIndex] = {
      ...next[lastIndex],
      invoiceAllocationAmountInput: remaining.toFixed(2),
    };
    return next;
  }

  function goToPayment() {
    if (!planTitle.trim()) { alert("Please enter a plan name."); return; }
    const visits = parseInt(plannedVisits, 10);
    if (!Number.isFinite(visits) || visits < 1) { alert("Planned visits must be at least 1."); return; }
    if (amountTodayNum < 0) { alert("Amount today cannot be negative."); return; }
    if (amountTodayNum > agreedTotalNum + 0.001) { alert("Amount today cannot exceed the agreed total."); return; }
    if (amountTodayNum <= 0.001) {
      handleSave();
      return;
    }

    prepareDraftsForMode(paymentMode);
    setPaymentValidationErrors([]);
    setStep("payment");
  }

  async function handleSave() {
    setSaving(true);
    try {
      const visits = parseInt(plannedVisits, 10);
      const { data: planData, error: planError } = await supabase
        .from("treatment_plans")
        .insert([{
          patient_id: patientId,
          clinic_id: clinicId,
          clinic_patient_file_id: clinicPatientFileId || null,
          service_id: services.length === 1 ? services[0].id : null,
          title: planTitle.trim(),
          total_amount: agreedTotalNum,
          planned_visits: visits,
          notes: planNotes.trim() || null,
          payment_arrangement: paymentArrangement,
          created_by: receptionistId,
          status: "Active",
        }])
        .select()
        .single();

      if (planError || !planData) {
        alert(`Error creating treatment plan: ${planError?.message || "Unknown error"}`);
        return;
      }

      let savedPayments: TreatmentPlanPayment[] = [];
      let structuredPaymentRecord: { payment_record_id: string; created_at: string } | null = null;

      if (amountTodayNum > 0.001) {
        const validationErrors = validatePaymentAllocations(paymentAllocationDrafts, amountTodayNum);
        if (validationErrors.length > 0) {
          setPaymentValidationErrors(validationErrors.map((error) => error.message));
          setStep("payment");
          alert("Please fix payment allocation issues before saving.");
          return;
        }

        const allocations = buildPaymentAllocations(paymentAllocationDrafts, amountTodayNum, amountTodayNum, 0);
        const { data: pmtData, error: pmtError } = await supabase
          .rpc("create_treatment_plan_payment_record_with_allocations", buildTreatmentPlanPaymentRpcArgs({
            treatmentPlanId: planData.id,
            patientId,
            clinicId,
            receptionistId,
            registerSessionId,
            paymentNotePrefix: `Initial payment for plan: ${planTitle.trim()}`,
            allocations,
          }))
          .single();

        if (pmtError) {
          alert(`Plan created but payment failed: ${pmtError.message || "Unknown error"}`);
        } else {
          structuredPaymentRecord = pmtData as { payment_record_id: string; created_at: string };
          const { data: legacyPayments, error: legacyPaymentsError } = await supabase
            .from("treatment_plan_payments")
            .select("*")
            .eq("treatment_plan_id", planData.id)
            .order("created_at", { ascending: false });
          if (legacyPaymentsError) {
            alert(`Plan payment saved, but reloading the payment rows failed: ${legacyPaymentsError.message || "Unknown error"}`);
          } else {
            savedPayments = (legacyPayments as TreatmentPlanPayment[]) || [];
          }
          const totalCustomerPaid = allocations.reduce((sum, allocation) => sum + allocation.customerChargedAmount, 0);
          const totalFee = allocations.reduce((sum, allocation) => sum + allocation.feeAmount, 0);
          const referenceNo = structuredPaymentRecord?.payment_record_id
            ? `TPP-${String(structuredPaymentRecord.payment_record_id).slice(0, 8).toUpperCase()}`
            : undefined;

          setPostSaveActionContext(buildPostSaveActionContext(
            allocations.map((allocation) => ({
              methodLabel: paymentVariantLabel(allocation.methodVariant),
              invoiceAllocationAmount: allocation.invoiceAllocationAmount,
              feeAmount: allocation.feeAmount,
              customerChargedAmount: allocation.customerChargedAmount,
              providerReferenceNumber: allocation.providerReferenceNumber,
              terminalAuthorizationCode: allocation.terminalAuthorizationCode,
            })),
            structuredPaymentRecord?.created_at,
            referenceNo,
          ));
        }
      }

      onSaved(planData as TreatmentPlan, savedPayments);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="relative flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-3xl border border-cyan-100 bg-white shadow-2xl">
        <div className="sticky top-0 flex items-center justify-between border-b border-cyan-100 bg-white px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Active Treatment Plan</h2>
            <p className="text-xs text-slate-500">{patientName}{patientFileNo ? ` · File #${patientFileNo}` : ""}</p>
          </div>
          <button onClick={onClose} className="text-2xl text-slate-400 hover:text-slate-600">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {step === "config" ? (
            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Selected Services</p>
                <div className="space-y-1">
                  {services.map((service, index) => {
                    const teethStr = service.teeth && service.teeth.length > 0 ? ` — Tooth #${service.teeth.join(", #")}` : "";
                    return (
                      <div key={index} className="flex items-center justify-between text-sm">
                        <span className="text-slate-800">{service.name}{teethStr}</span>
                        <span className="font-semibold text-slate-700">AED {(Number(service.price) * (service.quantity ?? 1)).toFixed(2)}</span>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-2 flex justify-between border-t border-slate-200 pt-2 text-sm font-bold text-slate-900">
                  <span>Total</span>
                  <span>AED {total.toFixed(2)}</span>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Plan Name</label>
                <input
                  value={planTitle}
                  onChange={(event) => setPlanTitle(event.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Agreed Total (AED)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={agreedTotal}
                    onChange={(event) => setAgreedTotal(event.target.value)}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Planned Visits</label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={plannedVisits}
                    onChange={(event) => setPlannedVisits(event.target.value)}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Payment Arrangement</label>
                <select
                  value={paymentArrangement}
                  onChange={(event) => {
                    const value = event.target.value;
                    setPaymentArrangement(value);
                    if (value === "Full payment today") setAmountToday(String(parseFloat(agreedTotal) || 0));
                    else if (value === "50% now / 50% later") setAmountToday(String(Math.round((parseFloat(agreedTotal) || 0) * 0.5 * 100) / 100));
                    else if (value === "No payment today") setAmountToday("0");
                    else if (value === "Payment per visit") {
                      const visits = parseInt(plannedVisits, 10) || 1;
                      setAmountToday(String(Math.round((parseFloat(agreedTotal) || 0) / visits * 100) / 100));
                    }
                  }}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
                >
                  {PAYMENT_ARRANGEMENTS.map((arrangement) => <option key={arrangement} value={arrangement}>{arrangement}</option>)}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Amount Paid Today (AED)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={amountToday}
                  onChange={(event) => setAmountToday(event.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
                />
                {amountTodayNum < agreedTotalNum - 0.001 && (
                  <p className="mt-1 text-xs text-amber-600">
                    Remaining balance after today: AED {remainingAfterToday.toFixed(2)}
                  </p>
                )}
              </div>

              {amountTodayNum > 0.001 && (
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Payment Mode</label>
                  <div className="grid grid-cols-3 gap-2">
                    {PAYMENT_MODE_OPTIONS.map((mode) => (
                      <button
                        key={mode}
                        onClick={() => setPaymentMode(mode)}
                        className={`rounded-xl border px-2 py-1.5 text-xs font-semibold transition ${paymentMode === mode ? "border-cyan-300 bg-cyan-600 text-white" : "border-slate-200 bg-white text-slate-700 hover:border-cyan-200"}`}
                      >
                        {mode}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Plan Notes (Optional)</label>
                <textarea
                  value={planNotes}
                  onChange={(event) => setPlanNotes(event.target.value)}
                  rows={2}
                  placeholder="Treatment stages, notes…"
                  className="w-full resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
                />
              </div>

              <button
                onClick={goToPayment}
                className="w-full rounded-2xl bg-cyan-600 py-3 text-sm font-semibold text-white transition hover:bg-cyan-500"
              >
                {amountTodayNum > 0.001 ? "Proceed to Payment →" : "Save Plan"}
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-slate-600">Plan</span>
                  <span className="font-semibold text-slate-900">{planTitle}</span>
                </div>
                <div className="mt-1 flex items-center justify-between">
                  <span className="text-slate-600">Invoice amount being paid</span>
                  <span className="font-semibold text-slate-900">AED {amountTodayNum.toFixed(2)}</span>
                </div>
                <div className="mt-1 flex items-center justify-between">
                  <span className="text-slate-600">Remaining plan balance</span>
                  <span className="font-semibold text-amber-700">AED {remainingAfterToday.toFixed(2)}</span>
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  Enter the amount being settled against the invoice. The Tabby/Tamara fee will be calculated separately.
                </p>
              </div>

              <div className="space-y-3">
                {paymentAllocationDrafts.map((row, index) => {
                  const variant = row.methodVariant as PaymentMethodVariant;
                  const rowComputed = previewAllocations.find((allocation) => allocation.id === row.id);
                  const needsReference = variant ? referenceRequiredForVariant(variant) : false;
                  const isCard = variant === "card";
                  const isTabbyCard = variant === "tabby_card";

                  return (
                    <div key={row.id} className="rounded-2xl border border-slate-200 p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-xs font-semibold uppercase text-slate-500">Payment #{index + 1}</span>
                        {paymentAllocationDrafts.length > 1 && (
                          <button
                            type="button"
                            onClick={() => {
                              setPaymentAllocationDrafts((prev) => {
                                const next = prev.filter((draft) => draft.id !== row.id);
                                return applyRemainingToLastRow(next, Math.max(0, index - 1));
                              });
                            }}
                            className="text-xs font-semibold text-rose-600 hover:text-rose-700"
                          >
                            Remove
                          </button>
                        )}
                      </div>

                      <div className="grid gap-2 sm:grid-cols-2">
                        <div>
                          <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Payment method</label>
                          <select
                            value={row.methodVariant}
                            onChange={(event) => {
                              const value = event.target.value as PaymentMethodVariant | "";
                              setPaymentAllocationDrafts((prev) => {
                                const next = [...prev];
                                next[index] = { ...next[index], methodVariant: value };
                                return next;
                              });
                            }}
                            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-cyan-300"
                          >
                            <option value="">Select method</option>
                            {ALLOCATION_METHOD_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Invoice amount allocated</label>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={row.invoiceAllocationAmountInput}
                            onChange={(event) => {
                              const value = event.target.value;
                              setPaymentAllocationDrafts((prev) => {
                                const next = [...prev];
                                next[index] = { ...next[index], invoiceAllocationAmountInput: value };
                                return applyRemainingToLastRow(next, index);
                              });
                            }}
                            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-cyan-300"
                          />
                        </div>
                      </div>

                      {isCard && (
                        <div className="mt-2">
                          <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Card network (optional)</label>
                          <div className="flex items-center gap-4 text-sm text-slate-700">
                            <label className="inline-flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={String(row.cardNetwork || "").toLowerCase() === "visa"}
                                onChange={(event) => {
                                  const checked = event.target.checked;
                                  setPaymentAllocationDrafts((prev) => {
                                    const next = [...prev];
                                    next[index] = { ...next[index], cardNetwork: checked ? "Visa" : "" };
                                    return next;
                                  });
                                }}
                                className="h-4 w-4 accent-cyan-600"
                              />
                              Visa
                            </label>
                            <label className="inline-flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={String(row.cardNetwork || "").toLowerCase() === "mastercard"}
                                onChange={(event) => {
                                  const checked = event.target.checked;
                                  setPaymentAllocationDrafts((prev) => {
                                    const next = [...prev];
                                    next[index] = { ...next[index], cardNetwork: checked ? "Mastercard" : "" };
                                    return next;
                                  });
                                }}
                                className="h-4 w-4 accent-cyan-600"
                              />
                              Mastercard
                            </label>
                          </div>
                        </div>
                      )}

                      {needsReference && (
                        <div className="mt-2">
                          <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">
                            {variant === "tamara" ? "Tamara reference number" : "Tabby reference number"}
                          </label>
                          <input
                            value={row.providerReferenceNumber}
                            onChange={(event) => {
                              const value = event.target.value;
                              setPaymentAllocationDrafts((prev) => {
                                const next = [...prev];
                                next[index] = { ...next[index], providerReferenceNumber: value };
                                return next;
                              });
                            }}
                            placeholder={variant === "tamara" ? "Tamara reference number" : "Tabby reference number"}
                            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-cyan-300"
                          />
                        </div>
                      )}

                      {isTabbyCard && (
                        <div className="mt-2">
                          <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Terminal authorization code (optional)</label>
                          <input
                            value={row.terminalAuthorizationCode}
                            onChange={(event) => {
                              const value = event.target.value;
                              setPaymentAllocationDrafts((prev) => {
                                const next = [...prev];
                                next[index] = { ...next[index], terminalAuthorizationCode: value };
                                return next;
                              });
                            }}
                            placeholder="Authorization code"
                            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-cyan-300"
                          />
                        </div>
                      )}

                      <div className="mt-2 rounded-xl border border-cyan-200 bg-cyan-50 p-2 text-xs text-cyan-900">
                        <div className="flex items-center justify-between">
                          <span>Fee rate</span>
                          <span className="font-semibold">{rowComputed ? `${(rowComputed.feeRate * 100).toFixed(1)}%` : "0.0%"}</span>
                        </div>
                        <div className="mt-1 flex items-center justify-between">
                          <span>Payment fee</span>
                          <span className="font-semibold">AED {rowComputed ? rowComputed.feeAmount.toFixed(2) : "0.00"}</span>
                        </div>
                        <div className="mt-1 flex items-center justify-between border-t border-cyan-200 pt-1 font-bold">
                          <span>Amount to collect</span>
                          <span>AED {rowComputed ? rowComputed.customerChargedAmount.toFixed(2) : "0.00"}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}

                <button
                  type="button"
                  onClick={() => {
                    setPaymentAllocationDrafts((prev) => {
                      const next = [...prev, newAllocationDraft("", "0.00")];
                      return applyRemainingToLastRow(next, Math.max(0, next.length - 2));
                    });
                  }}
                  className="w-full rounded-xl border border-dashed border-cyan-300 py-2 text-sm font-semibold text-cyan-700 hover:bg-cyan-50"
                >
                  + Add another payment method
                </button>
              </div>

              {paymentValidationErrors.length > 0 && (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
                  <p className="font-semibold">Please fix the following:</p>
                  <ul className="mt-1 list-disc pl-4">
                    {[...new Set(paymentValidationErrors)].map((message) => (
                      <li key={message}>{message}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm">
                <p className="font-semibold text-slate-700">Payment Summary</p>
                <div className="mt-1 flex items-center justify-between">
                  <span className="text-slate-600">Invoice amount being paid</span>
                  <span className="font-semibold">AED {amountTodayNum.toFixed(2)}</span>
                </div>
                <div className="mt-1 flex items-center justify-between">
                  <span className="text-slate-600">Payment fee</span>
                  <span className="font-semibold">AED {paymentFeeTotal.toFixed(2)}</span>
                </div>
                <div className="mt-1 flex items-center justify-between">
                  <span className="text-slate-700">Total customer pays</span>
                  <span className="font-bold text-slate-900">AED {customerChargeTotal.toFixed(2)}</span>
                </div>
                {previewAllocations.length > 0 && (
                  <div className="mt-2 border-t border-slate-200 pt-2 text-xs text-slate-600">
                    {previewAllocations.map((allocation) => (
                      <div key={allocation.id} className="mt-1 flex items-center justify-between">
                        <span>Collect through {paymentVariantLabel(allocation.methodVariant)}</span>
                        <span className="font-semibold text-slate-800">AED {allocation.customerChargedAmount.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setStep("config")}
                  className="flex-1 rounded-2xl border border-slate-200 py-3 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
                >
                  ← Back
                </button>
                <button
                  onClick={async () => {
                    const validationErrors = validatePaymentAllocations(paymentAllocationDrafts, amountTodayNum);
                    setPaymentValidationErrors(validationErrors.map((error) => error.message));
                    if (validationErrors.length > 0) return;
                    await handleSave();
                  }}
                  disabled={saving || !allocationBalanced || previewAllocations.length === 0}
                  className="flex-1 rounded-2xl bg-cyan-600 py-3 text-sm font-semibold text-white transition hover:bg-cyan-500 disabled:opacity-50"
                >
                  {saving ? "Saving…" : `Save Plan & Collect (${paymentSummaryLabel(previewAllocations) || "Payment"})`}
                </button>
              </div>

              {!allocationBalanced && (
                <p className="text-center text-xs font-semibold text-amber-700">
                  Allocations must match AED {amountTodayNum.toFixed(2)} before you can continue.
                </p>
              )}
            </div>
          )}

          {postSaveActionContext && (
            <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/55 backdrop-blur-sm">
              <div className="mx-4 w-full max-w-md rounded-3xl border border-cyan-100 bg-white p-6 shadow-2xl">
                <p className="text-xs font-bold uppercase tracking-[0.3em] text-cyan-700">Plan Payment Saved</p>
                <h3 className="mt-2 text-xl font-semibold text-slate-900">What would you like to do next?</h3>
                <p className="mt-2 text-sm text-slate-600">Print the invoice or keep going without sharing it.</p>

                <div className="mt-5 grid gap-3">
                  <button
                    onClick={handlePrintReceipt}
                    className="rounded-2xl bg-slate-900 px-3 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
                  >
                    Print Receipt
                  </button>
                  <button
                    onClick={handlePrintA4Invoice}
                    className="rounded-2xl border border-amber-300 bg-amber-50 px-3 py-3 text-sm font-semibold text-amber-700 transition hover:bg-amber-100"
                  >
                    🖨 Print A4 Invoice
                  </button>
                  <button
                    onClick={() => setPostSaveActionContext(null)}
                    className="rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                  >
                    Done
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
