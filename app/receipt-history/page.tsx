"use client";

import { useEffect, useMemo, useState } from "react";
import { AppFrame } from "../../components/app-frame";
import { supabase } from "../../lib/supabase";
import { buildReceiptQrHtml, getReceiptLogoPath, printHtmlWhenImagesReady } from "../../lib/receipt-branding";
import { generateInvoiceHtml, generateTreatmentPlanPaymentInvoiceHtml, type InvoiceStatus } from "../../lib/generate-invoice-html";
import { buildThermalReceiptHtml as buildThermalReceiptHtmlShared, type BuildThermalReceiptHtmlOptions } from "../../lib/build-thermal-receipt-html";
import { useClinicAccess } from "../../lib/clinic-access";
import type { Clinic as ClinicRecord, TreatmentPlan, TreatmentPlanPayment, TreatmentPlanPaymentAllocation, TreatmentPlanPaymentRecord, TreatmentPlanVisit } from "../../lib/types";
import { printTreatmentPlanPaymentReceipt } from "../../lib/print-treatment-plan-payment-receipt";
import { computeTreatmentPlanRollup } from "../../lib/treatment-plan-rollup";
import { mapRegularReceiptRenderLine, summarizeRegularReceiptForRender } from "../../lib/regular-receipt-rendering";

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
  total_before_gateway_fee?: number | null;
  discount_amount?: number | null;
  amount_paid?: number | null;
  credit_applied?: number | null;
  gateway_fee?: number | null;
  gateway_fee_provider?: string | null;
  notes: string | null;
  created_at?: string;
};

type LookupItem = {
  id: string;
  name: string;
  clinic_id?: string;
  price?: number | null;
  standard_price?: number | null;
};

type Patient = {
  id: string;
  name: string;
  phone?: string | null;
  patient_number?: number | null;
};

type Clinic = ClinicRecord;

type ClinicPatientFile = {
  id: string;
  clinic_id: string;
  patient_id: string;
  file_no: string;
};

type ReceiptItem = {
  receipt_id: string;
  service_id: string;
  quantity: number;
  price: number;
  total: number;
  service_name_snapshot?: string | null;
  original_price?: number | null;
  teeth?: string[] | null;
  allocated_global_discount_amount?: number | null;
  taxable_amount?: number | null;
  vat_rate?: number | null;
  vat_amount?: number | null;
  final_line_total?: number | null;
};

type HistoryEntry = {
  id: string;
  kind: "receipt" | "treatment-plan";
  title: string;
  subtitle: string;
  patient_id: string;
  receptionist_id: string;
  created_at?: string | null;
  total: number;
  subtotal?: number;
  vat?: number;
  discount_amount?: number | null;
  payment_method?: string | null;
  notes?: string | null;
  receipt_number?: number | null;
  doctor_id?: string | null;
  gateway_fee?: number | null;
  gateway_fee_provider?: string | null;
  amount_paid?: number | null;
  credit_applied?: number | null;
  treatment_plan_title?: string | null;
  payment_fee_amount?: number | null;
  total_invoice_amount_settled?: number | null;
  total_vat_amount?: number | null;
  total_customer_charged_amount?: number | null;
  payment_method_summary?: string | null;
  treatment_plan_payment_allocations?: TreatmentPlanPaymentAllocation[];
  payment_allocations?: Array<{ method_variant?: string; customer_charged_amount?: number; invoice_allocation_amount?: number; fee_amount?: number; provider_reference_number?: string | null }>;
};

export default function ReceiptHistoryPage() {
  const { allowedClinicId, isLoaded } = useClinicAccess();
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [doctors, setDoctors] = useState<LookupItem[]>([]);
  const [receptionists, setReceptionists] = useState<LookupItem[]>([]);
  const [services, setServices] = useState<LookupItem[]>([]);
  const [receiptItems, setReceiptItems] = useState<ReceiptItem[]>([]);
  const [clinics, setClinics] = useState<Clinic[]>([]);
  const [clinicPatientFiles, setClinicPatientFiles] = useState<ClinicPatientFile[]>([]);
  const [treatmentPlanPaymentRecords, setTreatmentPlanPaymentRecords] = useState<TreatmentPlanPaymentRecord[]>([]);
  const [legacyTreatmentPlanPayments, setLegacyTreatmentPlanPayments] = useState<TreatmentPlanPayment[]>([]);
  const [treatmentPlanPaymentAllocations, setTreatmentPlanPaymentAllocations] = useState<TreatmentPlanPaymentAllocation[]>([]);
  const [treatmentPlans, setTreatmentPlans] = useState<TreatmentPlan[]>([]);
  const [treatmentPlanVisits, setTreatmentPlanVisits] = useState<TreatmentPlanVisit[]>([]);
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);
  const [selectedReceiptId, setSelectedReceiptId] = useState<string>("");
  const [isDownloadingInvoice, setIsDownloadingInvoice] = useState(false);

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

  useEffect(() => {
    if (!isLoaded) return;
    loadHistory();
  }, [isLoaded]);

  async function loadHistory() {
    const [receiptResult, patientResult, doctorResult, receptionistResult, serviceResult, itemResult, clinicResult, clinicPatientFileResult, treatmentPlanResult, treatmentPlanVisitResult, treatmentPlanPaymentResult, legacyTreatmentPlanPaymentResult, treatmentPlanAllocationResult] = await Promise.all([
      supabase.from("receipts").select("*").order("created_at", { ascending: false }),
      fetchAllRows("patients", "id, name, phone, patient_number"),
      supabase.from("doctors").select("id, name").order("name", { ascending: true }),
      supabase.from("receptionist").select("id, name, clinic_id").order("name", { ascending: true }),
      supabase.from("services").select("id, name, price, standard_price, pricing_type").order("name", { ascending: true }),
      supabase.from("receipt_items").select("receipt_id, service_id, quantity, price, total, original_price, service_name_snapshot, teeth, allocated_global_discount_amount, taxable_amount, vat_rate, vat_amount, final_line_total"),
      supabase.from("clinics").select("*"),
      fetchAllRows("clinic_patient_files", "id, clinic_id, patient_id, file_no"),
      supabase.from("treatment_plans").select("*").order("created_at", { ascending: false }),
      supabase.from("treatment_plan_visits").select("id, treatment_plan_id, visit_number, created_at").order("visit_number", { ascending: true }),
      supabase.from("treatment_plan_payment_records").select("*").order("created_at", { ascending: false }),
      supabase.from("treatment_plan_payments").select("*").order("created_at", { ascending: false }),
      supabase.from("treatment_plan_payment_allocations").select("*").order("created_at", { ascending: false }),
    ]);

    const receiptsRows = (receiptResult.data as Receipt[]) || [];
    const treatmentPlanRows = (treatmentPlanResult.data as TreatmentPlan[]) || [];
    const treatmentPlanVisitRows = (treatmentPlanVisitResult.data as TreatmentPlanVisit[]) || [];
    const treatmentPlanPaymentRows = (treatmentPlanPaymentResult.data as TreatmentPlanPaymentRecord[]) || [];
    const legacyTreatmentPlanPaymentRows = (legacyTreatmentPlanPaymentResult.data as TreatmentPlanPayment[]) || [];
    const treatmentPlanAllocationRows = (treatmentPlanAllocationResult.data as TreatmentPlanPaymentAllocation[]) || [];

    const regularEntries: HistoryEntry[] = receiptsRows.map((receipt) => ({
      id: receipt.id,
      kind: "receipt" as const,
      title: `Receipt ${receipt.receipt_number ? `#${String(receipt.receipt_number).padStart(5, "0")}` : `#${receipt.id.slice(0, 8).toUpperCase()}`}`,
      subtitle: "Regular receipt",
      patient_id: receipt.patient_id,
      receptionist_id: receipt.receptionist_id,
      created_at: receipt.created_at,
      total: Number(receipt.total || 0),
      subtotal: Number(receipt.subtotal || 0),
      vat: Number(receipt.vat || 0),
      payment_method: receipt.payment_method || null,
      notes: receipt.notes || null,
      receipt_number: receipt.receipt_number ?? null,
      doctor_id: receipt.doctor_id ?? null,
      gateway_fee: receipt.gateway_fee ?? null,
      gateway_fee_provider: receipt.gateway_fee_provider ?? null,
      amount_paid: (receipt as any).amount_paid ?? null,
      credit_applied: (receipt as any).credit_applied ?? null,
    }));

    const planEntries: HistoryEntry[] = treatmentPlanPaymentRows.map((record) => {
      const plan = treatmentPlanRows.find((entry) => entry.id === record.treatment_plan_id) || null;
      return {
        id: record.id,
        kind: "treatment-plan" as const,
        title: `Treatment Plan Payment ${record.id.slice(0, 8).toUpperCase()}`,
        subtitle: plan?.title || "Treatment plan payment",
        patient_id: record.patient_id,
        receptionist_id: record.receptionist_id,
        created_at: record.created_at,
        total: Number(record.total_customer_charged_amount || 0),
        subtotal: Number(record.total_invoice_amount_settled || 0),
        vat: Number(record.total_vat_amount || 0),
        payment_method: record.payment_method_summary || null,
        notes: `Treatment plan payment`,
        treatment_plan_title: plan?.title || null,
        payment_fee_amount: Number(record.total_payment_fee_amount || 0),
        total_invoice_amount_settled: Number(record.total_invoice_amount_settled || 0),
        total_vat_amount: Number(record.total_vat_amount || 0),
        total_customer_charged_amount: Number(record.total_customer_charged_amount || 0),
        payment_method_summary: record.payment_method_summary || null,
        treatment_plan_payment_allocations: treatmentPlanAllocationRows.filter((allocation) => allocation.payment_id === record.id),
      };
    });

    const combinedEntries = [...regularEntries, ...planEntries].sort((a, b) => {
      const left = a.created_at ? new Date(a.created_at).getTime() : 0;
      const right = b.created_at ? new Date(b.created_at).getTime() : 0;
      return right - left;
    });

    setReceipts(receiptsRows);
    setPatients((patientResult as Patient[]) || []);
    setDoctors((doctorResult.data as LookupItem[]) || []);
    setReceptionists((receptionistResult.data as LookupItem[]) || []);
    setServices((serviceResult.data as LookupItem[]) || []);
    setReceiptItems((itemResult.data as ReceiptItem[]) || []);
    setClinics((clinicResult.data as Clinic[]) || []);
    setClinicPatientFiles((clinicPatientFileResult as ClinicPatientFile[]) || []);
    setTreatmentPlanPaymentRecords(treatmentPlanPaymentRows);
    setLegacyTreatmentPlanPayments(legacyTreatmentPlanPaymentRows);
    setTreatmentPlanPaymentAllocations(treatmentPlanAllocationRows);
    setTreatmentPlans(treatmentPlanRows);
    setTreatmentPlanVisits(treatmentPlanVisitRows);
    setHistoryEntries(combinedEntries);

    if (!selectedReceiptId && combinedEntries.length) {
      setSelectedReceiptId(combinedEntries[0].id);
    }
  }

  const visibleReceipts = useMemo(() => {
    if (!allowedClinicId) return historyEntries;
    const clinicReceptionistIds = new Set(
      receptionists.filter((receptionist) => receptionist.clinic_id === allowedClinicId).map((receptionist) => receptionist.id)
    );
    return historyEntries.filter((entry) => clinicReceptionistIds.has(entry.receptionist_id));
  }, [allowedClinicId, historyEntries, receptionists]);

  useEffect(() => {
    if (!selectedReceiptId && visibleReceipts.length > 0) {
      setSelectedReceiptId(visibleReceipts[0].id);
      return;
    }
    if (selectedReceiptId && !visibleReceipts.some((entry) => entry.id === selectedReceiptId)) {
      setSelectedReceiptId(visibleReceipts[0]?.id || "");
    }
  }, [selectedReceiptId, visibleReceipts]);

  const selectedReceipt = visibleReceipts.find((entry) => entry.id === selectedReceiptId);

  function remainingAfterPlanPayment(plan: TreatmentPlan | null, paymentDate: string | null | undefined) {
    if (!plan) return 0;
    return computeTreatmentPlanRollup(plan, {
      structuredPayments: treatmentPlanPaymentRecords.filter((entry) => entry.treatment_plan_id === plan.id),
      legacyPayments: legacyTreatmentPlanPayments.filter((entry) => entry.treatment_plan_id === plan.id),
      asOf: paymentDate || undefined,
    }).remainingBalance;
  }

  const selectedReceiptLineItems = useMemo(() => {
    if (!selectedReceipt) {
      return [];
    }

    if (selectedReceipt.kind === "treatment-plan") {
      return [
        {
          id: selectedReceipt.id,
          name: selectedReceipt.treatment_plan_title || "Treatment plan payment",
          quantity: 1,
          price: Number(selectedReceipt.total || 0),
          originalPrice: null,
          total: Number(selectedReceipt.total || 0),
        },
      ];
    }

    return receiptItems
      .filter((item) => item.receipt_id === selectedReceipt.id)
      .map((item) => {
        const service = services.find((entry) => entry.id === item.service_id);
        const renderLine = mapRegularReceiptRenderLine(item, {
          serviceName: service?.name || "Service",
          fallbackOriginalUnitPrice: item.original_price != null
            ? Number(item.original_price)
            : service?.standard_price != null
              ? Number(service.standard_price)
              : service?.price != null
                ? Number(service.price)
                : null,
        });

        return {
          id: item.service_id,
          name: renderLine.name,
          quantity: renderLine.quantity,
          price: renderLine.soldUnitPrice,
          originalPrice: renderLine.originalUnitPrice,
          total: item.total,
          allocatedGlobalDiscountAmount: renderLine.allocatedGlobalDiscountAmount,
          taxableAmount: renderLine.taxableAmount,
          vatRate: renderLine.vatRate,
          vatAmount: renderLine.vatAmount,
          finalLineTotal: renderLine.finalLineTotal,
          teeth: renderLine.teeth,
          totalDiscountAmount: renderLine.totalDiscountAmount,
        };
      });
  }, [receiptItems, selectedReceipt, services]);

  function getPatientName(patientId: string) {
    return patients.find((patient) => patient.id === patientId)?.name || "Unknown patient";
  }

  function buildThermalReceiptHtmlForSelected(): string {
    if (!selectedReceipt || selectedReceipt.kind === "treatment-plan") return "";
    const regularSelectedReceiptLineItems = selectedReceiptLineItems as any[];

    const receptionist = receptionists.find((r) => r.id === selectedReceipt.receptionist_id);
    const clinic = clinics.find((c) => c.id === receptionist?.clinic_id) ?? clinics[0];
    const patient = patients.find((p) => p.id === selectedReceipt.patient_id);
    const patientClinicFile = clinicPatientFiles.find((file) => file.clinic_id === clinic?.id && file.patient_id === selectedReceipt.patient_id) || null;
    const doctor = doctors.find((d) => d.id === selectedReceipt.doctor_id);
    const issuedAt = selectedReceipt.created_at ? new Date(selectedReceipt.created_at) : new Date();

    const invoiceNo = selectedReceipt.receipt_number
      ? `#${String(selectedReceipt.receipt_number).padStart(5, "0")}`
      : selectedReceipt.id.slice(0, 8).toUpperCase();
    const dateValue = issuedAt.toLocaleDateString("en-GB");
    const timeValue = issuedAt.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });

    const patientName = patient?.name || "-";
    const patientPhone = patient?.phone || "-";
    const patientFileNumber = patientClinicFile?.file_no
      ? `#${String(patientClinicFile.file_no)}`
      : patient?.patient_number
        ? `#${String(patient.patient_number).padStart(5, "0")}`
        : "-";
    const doctorName = doctor?.name || "-";
    const cashierName = receptionist?.name || "Reception";

    const summary = summarizeRegularReceiptForRender(selectedReceipt as any, regularSelectedReceiptLineItems.map((item) => ({
      name: item.name,
      quantity: item.quantity,
      soldUnitPrice: Number(item.price ?? 0),
      soldLineTotal: Number(item.total ?? 0),
      originalUnitPrice: item.originalPrice != null ? Number(item.originalPrice) : null,
      originalLineTotal: item.originalPrice != null ? Number(item.originalPrice) * Number(item.quantity ?? 1) : null,
      manualDiscountAmount: Math.max(0, (item.originalPrice != null ? Number(item.originalPrice) * Number(item.quantity ?? 1) : Number(item.total ?? 0)) - Number(item.total ?? 0)),
      allocatedGlobalDiscountAmount: Number(item.allocatedGlobalDiscountAmount ?? 0),
      totalDiscountAmount: Number(item.totalDiscountAmount ?? 0),
      taxableAmount: item.taxableAmount != null ? Number(item.taxableAmount) : null,
      vatRate: item.vatRate != null ? Number(item.vatRate) : null,
      vatAmount: item.vatAmount != null ? Number(item.vatAmount) : null,
      finalLineTotal: item.finalLineTotal != null ? Number(item.finalLineTotal) : null,
      isSnapshotBacked: item.taxableAmount != null && item.vatRate != null && item.vatAmount != null && item.finalLineTotal != null,
      hasTruePromo: item.originalPrice != null && Number(item.originalPrice) * Number(item.quantity ?? 1) > Number(item.total ?? 0) + 0.0049,
      hasPriceIncrease: false,
      teeth: item.teeth || [],
    })));
    const amountPaidRaw = (selectedReceipt as any).amount_paid;
    const amountPaid = amountPaidRaw != null ? Number(amountPaidRaw) : summary.finalTotal;
    const outstandingBalance = Math.max(0, summary.finalTotal - amountPaid);

    const options: BuildThermalReceiptHtmlOptions = {
      title: "Receipt",
      clinic: clinic as any,
      invoiceNumber: invoiceNo,
      dateValue,
      timeValue,
      cashierName,
      doctorName,
      patientName,
      patientPhone,
      patientFileNumber,
      doctorField: clinic?.name === "Skin & Smile Aesthetic Clinic" ? "Aesthetician / المختصة" : "Doctor / الطبيب",
      items: regularSelectedReceiptLineItems.map((item) => ({
        name: item.name,
        quantity: item.quantity,
        price: Number(item.price ?? 0),
        originalPrice: item.originalPrice != null ? Number(item.originalPrice) : undefined,
        allocatedGlobalDiscountAmount: item.allocatedGlobalDiscountAmount ?? undefined,
        taxableAmount: item.taxableAmount ?? undefined,
        vatRate: item.vatRate ?? undefined,
        vatAmount: item.vatAmount ?? undefined,
        finalLineTotal: item.finalLineTotal ?? undefined,
        teeth: item.teeth || [],
      })),
      subtotal: summary.subtotal,
      discountAmount: summary.discountAmount,
      vat: summary.vat,
      total: summary.invoiceTotalBeforeGatewayFee,
      paymentFeeAmount: summary.paymentFeeAmount,
      allocations: (selectedReceipt.payment_allocations || []).map((allocation: any) => ({
        methodVariant: allocation.method_variant || "payment",
        customerChargedAmount: Number(allocation.customer_charged_amount || 0),
        invoiceAllocationAmount: Number(allocation.invoice_allocation_amount || 0),
        feeAmount: Number(allocation.fee_amount || 0),
        feeRate: allocation.fee_amount && allocation.invoice_allocation_amount ? 
          Number(allocation.fee_amount) / Number(allocation.invoice_allocation_amount) : 0,
        providerReferenceNumber: allocation.provider_reference_number,
      })),
      creditUsed: 0,
      outstandingBalance,
      manualDiscountAmount: summary.useSnapshotSummary ? summary.manualDiscountAmount : undefined,
      globalDiscountAmount: summary.useSnapshotSummary ? summary.globalDiscountAmount : undefined,
      notes: selectedReceipt.notes || "",
      paymentMethod: selectedReceipt.payment_method || "",
    };

    return buildThermalReceiptHtmlShared(options);
  }

  function buildInvoiceHtmlForSelected(): string {
    if (!selectedReceipt) return "";
    const receptionist = receptionists.find((r) => r.id === selectedReceipt.receptionist_id);
    const clinic = clinics.find((c) => c.id === receptionist?.clinic_id) ?? clinics[0] ?? null;
    const patient = patients.find((p) => p.id === selectedReceipt.patient_id);
    const doctor = doctors.find((d) => d.id === selectedReceipt.doctor_id);
    const issuedAt = selectedReceipt.created_at ? new Date(selectedReceipt.created_at) : new Date();
    const patientClinicFile = clinicPatientFiles.find((file) => file.clinic_id === clinic?.id && file.patient_id === selectedReceipt.patient_id) || null;

    if (selectedReceipt.kind === "treatment-plan") {
      const paymentRecord = treatmentPlanPaymentRecords.find((entry) => entry.id === selectedReceipt.id) || null;
      const plan = treatmentPlans.find((entry) => entry.id === paymentRecord?.treatment_plan_id) || null;
      const visitsCompleted = treatmentPlanVisits.filter((visit) => visit.treatment_plan_id === plan?.id).length;
      const completedVisits = Math.max(visitsCompleted, plan?.clinic_patient_file_id ? 1 : 0);
      return generateTreatmentPlanPaymentInvoiceHtml({
        clinic: clinic as any,
        receiptNumber: selectedReceipt.title,
        issuedAt,
        cashierName: receptionist?.name ?? null,
        patient: {
          name: patient?.name || "-",
          phone: patient?.phone ?? null,
          fileNumber: patientClinicFile?.file_no
            || (plan?.clinic_patient_file_id ? clinicPatientFiles.find((file) => file.id === plan.clinic_patient_file_id)?.file_no : undefined)
            || (patient?.patient_number != null ? String(patient.patient_number) : undefined),
        },
        doctorName: doctor?.name ?? null,
        planTitle: selectedReceipt.treatment_plan_title || selectedReceipt.title,
        planTotalAmount: Number(plan?.total_amount || selectedReceipt.total_invoice_amount_settled || 0),
        amountSettledToday: Number(selectedReceipt.total_invoice_amount_settled ?? selectedReceipt.total ?? 0),
        paymentFeeAmount: Number(selectedReceipt.payment_fee_amount ?? 0),
        paymentAllocations: (selectedReceipt.treatment_plan_payment_allocations || []).map((allocation) => ({
          methodLabel: allocation.method_variant ? allocation.method_variant.replace(/_/g, " ").toUpperCase() : "Payment",
          invoiceAllocationAmount: Number(allocation.invoice_allocation_amount || 0),
          feeAmount: Number(allocation.fee_amount || 0),
          customerChargedAmount: Number(allocation.customer_charged_amount || 0),
          providerReferenceNumber: allocation.provider_reference_number,
          terminalAuthorizationCode: allocation.terminal_authorization_code,
        })),
        remainingAfterToday: remainingAfterPlanPayment(plan, selectedReceipt.created_at),
        plannedVisits: plan?.planned_visits ?? null,
        completedVisits,
        notes: selectedReceipt.notes || null,
      });
    }
    const regularSelectedReceiptLineItems = selectedReceiptLineItems as any[];

    const invoiceNum = selectedReceipt.receipt_number
      ? `#${String(selectedReceipt.receipt_number).padStart(5, "0")}`
      : selectedReceipt.id.slice(0, 8).toUpperCase();
    const summary = summarizeRegularReceiptForRender(selectedReceipt as any, regularSelectedReceiptLineItems.map((item) => ({
      name: item.name,
      quantity: item.quantity,
      soldUnitPrice: Number(item.price ?? 0),
      soldLineTotal: Number(item.total ?? 0),
      originalUnitPrice: item.originalPrice != null ? Number(item.originalPrice) : null,
      originalLineTotal: item.originalPrice != null ? Number(item.originalPrice) * Number(item.quantity ?? 1) : null,
      manualDiscountAmount: Math.max(0, (item.originalPrice != null ? Number(item.originalPrice) * Number(item.quantity ?? 1) : Number(item.total ?? 0)) - Number(item.total ?? 0)),
      allocatedGlobalDiscountAmount: Number(item.allocatedGlobalDiscountAmount ?? 0),
      totalDiscountAmount: Number(item.totalDiscountAmount ?? 0),
      taxableAmount: item.taxableAmount != null ? Number(item.taxableAmount) : null,
      vatRate: item.vatRate != null ? Number(item.vatRate) : null,
      vatAmount: item.vatAmount != null ? Number(item.vatAmount) : null,
      finalLineTotal: item.finalLineTotal != null ? Number(item.finalLineTotal) : null,
      isSnapshotBacked: item.taxableAmount != null && item.vatRate != null && item.vatAmount != null && item.finalLineTotal != null,
      hasTruePromo: item.originalPrice != null && Number(item.originalPrice) * Number(item.quantity ?? 1) > Number(item.total ?? 0) + 0.0049,
      hasPriceIncrease: false,
      teeth: item.teeth || [],
    })));
    const amountPaidRaw = (selectedReceipt as any).amount_paid;
    const amountPaid = amountPaidRaw != null ? Number(amountPaidRaw) : summary.finalTotal;
    const outstandingBalance = Math.max(0, summary.finalTotal - amountPaid);
    const invoiceStatus: InvoiceStatus =
      outstandingBalance > 0.005 ? "PARTIALLY PAID"
      : amountPaid < 0.005 ? "UNPAID"
      : "PAID";

    return generateInvoiceHtml({
      clinic: clinic as any,
      receiptNumber: invoiceNum,
      invoiceStatus,
      issuedAt,
      posReceiptNumber: invoiceNum,
      cashierName: receptionist?.name ?? null,
      patient: {
        name: patient?.name || "-",
        phone: patient?.phone ?? null,
        fileNumber: patientClinicFile?.file_no || (patient?.patient_number != null ? String(patient.patient_number) : undefined),
      },
      doctorName: doctor?.name ?? null,
      items: regularSelectedReceiptLineItems.map((item) => ({
        description: item.name,
        quantity: item.quantity,
        originalUnitPrice: item.originalPrice != null ? Number(item.originalPrice) : null,
        unitPrice: Number(item.price ?? 0),
        discountAmount: item.totalDiscountAmount,
        allocatedGlobalDiscountAmount: item.allocatedGlobalDiscountAmount ?? undefined,
        taxableAmount: item.taxableAmount ?? undefined,
        vatRate: item.vatRate ?? undefined,
        vatAmount: item.vatAmount ?? undefined,
        finalLineTotal: item.finalLineTotal ?? undefined,
        teeth: item.teeth || [],
      })),
      totalDiscount: summary.discountAmount,
      vatAmount: summary.vat,
      paymentFeeAmount: summary.paymentFeeAmount,
      grandTotal: summary.finalTotal,
      amountPaid,
      outstandingBalance,
      notes: selectedReceipt.notes || null,
    });
  }

  async function downloadInvoicePdfFromHistory() {
    if (!selectedReceipt) return;
    const html = buildInvoiceHtmlForSelected();
    const receptionist = receptionists.find((r) => r.id === selectedReceipt.receptionist_id);
    const clinic = clinics.find((c) => c.id === receptionist?.clinic_id) ?? clinics[0];
    const clinicSlug = (clinic?.name || "Clinic").replace(/\s+/g, "_").replace(/[^\w-]/g, "");
    const invoiceNum = selectedReceipt.kind === "receipt" && selectedReceipt.receipt_number
      ? String(selectedReceipt.receipt_number).padStart(5, "0")
      : selectedReceipt.id.slice(0, 8).toUpperCase();
    const dateStr = new Date(selectedReceipt.created_at || Date.now()).toLocaleDateString("en-CA", { timeZone: "Asia/Dubai" });
    const filename = `${clinicSlug}_Invoice_${invoiceNum}_${dateStr}.pdf`;

    setIsDownloadingInvoice(true);
    try {
      const res = await fetch("/api/generate-invoice-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ html, filename }),
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
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (err: any) {
      alert(`Invoice download failed: ${err?.message || "Unknown error"}`);
    } finally {
      setIsDownloadingInvoice(false);
    }
  }


  function printSelectedReceipt() {
    if (!selectedReceipt) return;

    if (selectedReceipt.kind === "treatment-plan") {
      const receptionist = receptionists.find((r) => r.id === selectedReceipt.receptionist_id);
      const clinic = clinics.find((c) => c.id === receptionist?.clinic_id) ?? clinics[0];
      const patient = patients.find((p) => p.id === selectedReceipt.patient_id);
      const paymentRecord = treatmentPlanPaymentRecords.find((entry) => entry.id === selectedReceipt.id) || null;
      const plan = treatmentPlans.find((entry) => entry.id === paymentRecord?.treatment_plan_id) || null;
      const patientClinicFile = clinicPatientFiles.find((file) => file.id === plan?.clinic_patient_file_id)
        || clinicPatientFiles.find((file) => file.clinic_id === clinic?.id && file.patient_id === selectedReceipt.patient_id)
        || null;
      const planTitle = selectedReceipt.treatment_plan_title || selectedReceipt.title || "Treatment Plan";
      const allocationRows = (selectedReceipt.treatment_plan_payment_allocations || []).map((allocation) => ({
        methodLabel: allocation.method_variant ? allocation.method_variant.replace(/_/g, " ").toUpperCase() : "Payment",
        invoiceAllocationAmount: Number(allocation.invoice_allocation_amount || 0),
        feeAmount: Number(allocation.fee_amount || 0),
        customerChargedAmount: Number(allocation.customer_charged_amount || 0),
      }));
      printTreatmentPlanPaymentReceipt({
        clinic: clinic as any,
        patientName: patient?.name || "-",
        patientFileNo: patientClinicFile?.file_no || (patient?.patient_number ? String(patient.patient_number) : undefined),
        planTitle,
        paymentArrangement: selectedReceipt.notes?.startsWith("Payment arrangement:")
          ? selectedReceipt.notes.replace("Payment arrangement:", "").trim()
          : "Treatment plan payment",
        agreedTotal: Number(plan?.total_amount || selectedReceipt.total || 0),
        amountSettledToday: Number(selectedReceipt.total_invoice_amount_settled ?? selectedReceipt.total ?? 0),
        remainingAfterToday: remainingAfterPlanPayment(plan, selectedReceipt.created_at),
        totalFeeAmount: Number(selectedReceipt.payment_fee_amount ?? 0),
        totalCustomerPaid: Number(selectedReceipt.total_customer_charged_amount ?? selectedReceipt.total ?? 0),
        cashierName: receptionist?.name || "Reception",
        services: [
          {
            name: planTitle,
            price: Number(selectedReceipt.total_invoice_amount_settled ?? selectedReceipt.total ?? 0),
            quantity: 1,
          },
        ],
        allocations: allocationRows,
        createdAt: selectedReceipt.created_at || undefined,
        referenceNo: selectedReceipt.title,
      });
      return;
    }

    const receiptHtml = buildThermalReceiptHtmlForSelected();
    try {
      printHtmlWhenImagesReady(receiptHtml);
    } catch (error) {
      alert("Error opening print dialog. Please check browser settings.");
    }
  }

  const doctorName = doctors.find((doctor) => doctor.id === selectedReceipt?.doctor_id)?.name || "Unknown doctor";
  const receptionistName = receptionists.find((person) => person.id === selectedReceipt?.receptionist_id)?.name || "Unknown receptionist";

  function formatReceiptNo(receipt: { id: string; receipt_number?: number | null }) {
    return receipt.receipt_number
      ? `#${String(receipt.receipt_number).padStart(5, "0")}`
      : `#${receipt.id.slice(0, 8)}`;
  }

  return (
    <AppFrame
      title="Receipt History"
      description="Review previous receipts in a premium dental-style workspace and print thermal copies quickly."
      actionLabel="New Receipt"
      actionHref="/receipts"
    >
      <div className="relative overflow-hidden rounded-[28px] border border-teal-100/70 bg-gradient-to-br from-white via-cyan-50/60 to-teal-50/70 p-4 shadow-[0_18px_50px_-24px_rgba(15,23,42,0.35)] sm:p-6">
        <div className="pointer-events-none absolute -left-10 -top-10 h-44 w-44 rounded-full bg-teal-200/30 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-14 -right-10 h-52 w-52 rounded-full bg-cyan-200/30 blur-2xl" />

        <div className="grid gap-6 xl:grid-cols-[0.95fr_1.15fr]">
          <div className="rounded-3xl border border-white/80 bg-white/85 p-4 shadow-sm backdrop-blur sm:p-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-teal-700">Receipt Archive</p>
                <h3 className="mt-1 text-lg font-semibold text-slate-900">Patient Visit Ledger</h3>
              </div>
              <div className="rounded-2xl border border-teal-100 bg-teal-50 px-3 py-1.5 text-xs font-semibold text-teal-700">
                {visibleReceipts.length} Records
              </div>
            </div>

            <div className="space-y-3">
              {visibleReceipts.map((receipt) => (
                <button
                  key={receipt.id}
                  onClick={() => setSelectedReceiptId(receipt.id)}
                  className={`w-full rounded-2xl border p-4 text-left transition duration-200 hover:-translate-y-0.5 ${
                    receipt.id === selectedReceiptId
                      ? "border-teal-300 bg-gradient-to-r from-teal-50 to-cyan-50 shadow-sm"
                      : "border-slate-200 bg-white hover:border-teal-200"
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">Receipt {formatReceiptNo(receipt)}</p>
                      <p className="mt-1 text-sm text-slate-600">{getPatientName(receipt.patient_id)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-teal-700">AED {Number(receipt.total || 0).toFixed(2)}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {receipt.created_at ? new Date(receipt.created_at).toLocaleString() : "No date"}
                      </p>
                    </div>
                  </div>
                </button>
              ))}

              {visibleReceipts.length === 0 && (
                <div className="rounded-2xl border border-dashed border-teal-200 bg-teal-50/60 p-8 text-center text-sm text-teal-800">
                  No receipts have been saved yet.
                </div>
              )}
            </div>
          </div>

          <div className="space-y-5 print:text-black">
            {selectedReceipt ? (
              <div className="relative overflow-hidden rounded-3xl border border-slate-200/80 bg-white p-5 shadow-[0_20px_35px_-24px_rgba(15,23,42,0.45)] print:border-black print:bg-white sm:p-6">
                <div
                  className="pointer-events-none absolute -right-10 -top-12 h-48 w-48 rounded-full bg-cyan-100/70"
                  style={{
                    backgroundImage: "radial-gradient(circle at 40% 40%, rgba(20,184,166,0.2), rgba(186,230,253,0.35))",
                  }}
                />
                <div
                  className="pointer-events-none absolute bottom-5 right-6 h-20 w-20 bg-contain bg-center bg-no-repeat opacity-10"
                  style={{ backgroundImage: "url('/images/logo2.png')" }}
                />

                <div className="relative z-10 flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.3em] text-teal-700 print:text-black">
                      Printable Thermal Receipt
                    </p>
                    <h2 className="mt-2 text-2xl font-semibold text-slate-900 print:text-black">
                      Receipt {formatReceiptNo(selectedReceipt)}
                    </h2>
                    <p className="mt-1 text-sm text-slate-500">Premium dental clinic format</p>
                  </div>

                  <button
                    onClick={printSelectedReceipt}
                    className="inline-flex items-center justify-center rounded-2xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-cyan-400 print:hidden"
                  >
                    🖨 Print Thermal Receipt
                  </button>
                  <button
                    onClick={() => printHtmlWhenImagesReady(buildInvoiceHtmlForSelected(), "Please allow popups to print the invoice.")}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-700 transition hover:bg-amber-100 print:hidden"
                  >
                    🖨 Print A4 Invoice
                  </button>
                </div>

                <div className="relative z-10 mt-5 grid gap-3 text-sm text-slate-700 sm:grid-cols-2">
                  <div className="rounded-2xl border border-teal-100 bg-gradient-to-br from-white to-teal-50/40 p-4">
                    <p className="text-xs uppercase tracking-[0.25em] text-teal-700">Patient</p>
                    <p className="mt-2 font-semibold text-slate-900">{getPatientName(selectedReceipt.patient_id)}</p>
                  </div>
                  <div className="rounded-2xl border border-teal-100 bg-gradient-to-br from-white to-teal-50/40 p-4">
                    <p className="text-xs uppercase tracking-[0.25em] text-teal-700">Doctor</p>
                    <p className="mt-2 font-semibold text-slate-900">{doctorName}</p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-white p-4">
                    <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Receptionist</p>
                    <p className="mt-2 font-semibold text-slate-900">{receptionistName}</p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-white p-4">
                    <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Date</p>
                    <p className="mt-2 font-semibold text-slate-900">
                      {selectedReceipt.created_at ? new Date(selectedReceipt.created_at).toLocaleString() : "No date"}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:col-span-2">
                    <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Payment Method</p>
                    <p className="mt-2 font-semibold text-slate-900">{selectedReceipt.payment_method || "Not recorded"}</p>
                  </div>
                </div>

                <div className="relative z-10 mt-5 space-y-3">
                  {selectedReceiptLineItems.map((item) => (
                    <div key={item.id} className="flex items-center justify-between rounded-2xl border border-slate-100 bg-white px-4 py-3 text-sm shadow-sm">
                      <div>
                        <p className="font-semibold text-slate-900">{item.name}</p>
                        <p className="text-slate-500">Qty {item.quantity}</p>
                      </div>
                      <p className="font-semibold text-slate-900">AED {Number(item.total || 0).toFixed(2)}</p>
                    </div>
                  ))}
                </div>

                <div className="relative z-10 mt-5 grid gap-2 rounded-2xl bg-gradient-to-r from-slate-900 to-teal-900 px-4 py-4 text-sm text-slate-100 print:bg-white print:text-black">
                  <div className="flex items-center justify-between">
                    <span>Subtotal</span>
                    <span>AED {Number(selectedReceipt.subtotal || 0).toFixed(2)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>VAT</span>
                    <span>AED {Number(selectedReceipt.vat || 0).toFixed(2)}</span>
                  </div>
                  <div className="flex items-center justify-between border-t border-white/20 pt-2 text-base font-semibold text-white print:border-black print:text-black">
                    <span>Total</span>
                    <span>AED {Number(selectedReceipt.total || 0).toFixed(2)}</span>
                  </div>
                </div>

                {selectedReceipt.notes && (
                  <div className="relative z-10 mt-5 rounded-2xl border border-teal-100 bg-teal-50/40 p-4 text-sm text-slate-700 print:border-black print:bg-white print:text-black">
                    <p className="text-xs uppercase tracking-[0.3em] text-teal-700">Notes</p>
                    <p className="mt-2">{selectedReceipt.notes}</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-teal-200 bg-teal-50/60 p-8 text-center text-sm text-teal-800">
                Select a receipt to view and print it.
              </div>
            )}
          </div>
        </div>
      </div>
    </AppFrame>
  );
}
