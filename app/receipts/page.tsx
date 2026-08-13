"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx-js-style";
import { AppFrame } from "../../components/app-frame";
import { supabase } from "../../lib/supabase";
import { Clinic, OutstandingBalance, BalancePayment, PatientCredit, Service, PaymentAllocation, PaymentAllocationRefund, PaymentRecord, TreatmentPlanPaymentAllocation, TreatmentPlanPaymentRecord, CashDeduction, CashDeductionType } from "../../lib/types";
import { calculateAge } from "../../lib/utils";
import { SearchPatientModal, ReceiptHistoryModal } from "../../components/pos-modals";
import { PosRegisterPatientModal } from "../../components/pos-register-patient-modal";
import { CollectBalancePaymentModal } from "../../components/outstanding-balance-modals";
import { PosPlanCheckoutModal } from "../../components/pos-plan-checkout-modal";
import { rollupBalance, formatBalanceReference } from "../../lib/outstanding-balances";
import { printPaymentReceipt } from "../../lib/print-payment-receipt";
import { availableCredit } from "../../lib/patient-credits";
import { COUNTRIES } from "../../lib/countries";
import { getAestheticServiceCategory } from "../../lib/service-categories";
import {
  buildPaymentAllocations,
  paymentSummaryLabel,
  paymentVariantLabel,
  normalizeProviderReference,
  PaymentAllocationDraft,
  PaymentMethodVariant,
  referenceRequiredForVariant,
  validatePaymentAllocations,
} from "../../lib/payment-allocation";
import { fromMinorUnits, roundCurrency, toMinorUnits, truncateCurrency } from "../../lib/money";
import { getInstallmentFeeProvider } from "../../lib/tabby-tamara-fees";
import { buildReceiptQrHtml, getReceiptLogoPath, printHtmlWhenImagesReady } from "../../lib/receipt-branding";
import { generateInvoiceHtml as buildInvoiceHtml, type InvoiceAllocationRow, type InvoiceStatus } from "../../lib/generate-invoice-html";
import { buildThermalReceiptHtml as buildThermalReceiptHtmlShared, type BuildThermalReceiptHtmlOptions } from "../../lib/build-thermal-receipt-html";
import { clinicAccessAllowsClinic, filterClinicsForAccess, useClinicAccess } from "../../lib/clinic-access";
import { extractLegacyCashAmount, getCashDeductionTypeLabel, getDubaiBusinessDate } from "../../lib/cash-deductions";
import { computeTreatmentPlanRollup } from "../../lib/treatment-plan-rollup";
import { getBusinessDayKeyForReporting, getPaymentBreakdownForReporting, summarizeStoredAllocationCollectionsForReporting, summarizeStoredAllocationRowsForReporting } from "../../lib/receipts-reporting";
import { mapRegularReceiptRenderLine } from "../../lib/regular-receipt-rendering";

type PosPricingService = {
  id?: string | null;
  name?: string | null;
  originalPrice?: number | null;
  price?: number | null;
  quantity?: number | null;
  vat_rate?: number | null;
  isVariablePriced?: boolean;
  minPrice?: number | null;
  maxPrice?: number | null;
};

type PosPricingLineSummary = {
  serviceId: string;
  serviceName: string;
  quantity: number;
  currentUnitPrice: number;
  originalUnitPrice: number | null;
  hasManualDiscount: boolean;
  originalLineTotal: number;
  discountedLineTotal: number;
  manualDiscountAmount: number;
  globalDiscountAmount: number;
  taxableAmount: number;
  vatRate: number | null;
  vatAmount: number;
  finalLineTotal: number;
  isVatConfigured: boolean;
};

type PosSuccessToast = {
  id: string;
  message: string;
};

type PaymentCompleteSnapshot = {
  receipt: any;
  receiptRef: string;
  patientName: string;
  completedAtLabel: string;
  lineItems: Array<{
    name: string;
    quantity: number;
    amount: number;
  }>;
  subtotal: number;
  discount: number;
  vat: number;
  totalPaid: number;
  paymentSummary: string;
  paymentRows: Array<{
    label: string;
    amount: number;
  }>;
};

function normalizeServiceVatRate(value: number | null | undefined): number | null {
  if (value === 0) return 0;
  if (value === 0.05) return 0.05;
  return null;
}

function getServiceVatLabel(value: number | null | undefined): string {
  if (value === 0) return "No VAT";
  if (value === 0.05) return "VAT 5%";
  return "VAT not configured";
}

function buildGlobalDiscountAllocationMinor(lineTotalsMinor: number[], globalDiscountMinor: number): number[] {
  if (globalDiscountMinor <= 0 || lineTotalsMinor.length === 0) {
    return lineTotalsMinor.map(() => 0);
  }

  const totalMinor = lineTotalsMinor.reduce((sum, value) => sum + value, 0);
  if (totalMinor <= 0) {
    return lineTotalsMinor.map(() => 0);
  }

  const provisional = lineTotalsMinor.map((lineMinor, index) => {
    if (lineMinor <= 0) {
      return { index, allocated: 0, remainder: -1 };
    }
    const exactShare = (lineMinor * globalDiscountMinor) / totalMinor;
    const allocated = Math.min(lineMinor, Math.floor(exactShare));
    return {
      index,
      allocated,
      remainder: exactShare - allocated,
    };
  });

  let remaining = globalDiscountMinor - provisional.reduce((sum, entry) => sum + entry.allocated, 0);
  const result = provisional.map((entry) => entry.allocated);
  const order = [...provisional].sort((a, b) => {
    if (b.remainder !== a.remainder) return b.remainder - a.remainder;
    return a.index - b.index;
  });

  while (remaining > 0) {
    let changed = false;
    for (const entry of order) {
      if (remaining <= 0) break;
      const maxAllowed = lineTotalsMinor[entry.index];
      if (result[entry.index] >= maxAllowed) continue;
      result[entry.index] += 1;
      remaining -= 1;
      changed = true;
    }
    if (!changed) break;
  }

  return result;
}

function summarizePosServicePricing(service: PosPricingService) {
  const originalPrice = Number(service.originalPrice ?? 0);
  const currentPrice = Number(service.price ?? 0);
  const quantity = Number(service.quantity ?? 1);
  const hasManualDiscount = originalPrice > 0 && originalPrice > currentPrice + 0.0049;
  const originalLineTotal = hasManualDiscount ? originalPrice * quantity : currentPrice * quantity;
  const discountedLineTotal = currentPrice * quantity;
  const manualDiscountAmount = hasManualDiscount ? (originalPrice - currentPrice) * quantity : 0;

  return {
    originalLineTotal,
    discountedLineTotal,
    manualDiscountAmount,
  };
}

function summarizeCartPricing(
  services: PosPricingService[],
  discountInput: string,
  discountType: "AED" | "%",
  birthdayDiscountApplied = false
) {
  const lineSummaries = services.map(summarizePosServicePricing);
  const originalSubtotal = lineSummaries.reduce((sum, line) => sum + line.originalLineTotal, 0);
  const discountedSubtotal = lineSummaries.reduce((sum, line) => sum + line.discountedLineTotal, 0);
  const itemDiscountAmount = lineSummaries.reduce((sum, line) => sum + line.manualDiscountAmount, 0);
  const parsedDiscountInput = parseFloat(discountInput) || 0;
  const birthdayDiscountAmount = birthdayDiscountApplied
    ? Math.min(discountedSubtotal, (discountedSubtotal * 5) / 100)
    : 0;
  const baseGlobalDiscountAmount = parsedDiscountInput <= 0
    ? 0
    : discountType === "%"
      ? Math.min(discountedSubtotal, (discountedSubtotal * parsedDiscountInput) / 100)
      : Math.min(discountedSubtotal, parsedDiscountInput);
  const globalDiscountAmount = Math.min(discountedSubtotal, baseGlobalDiscountAmount + birthdayDiscountAmount);
  const totalDiscount = Math.max(0, Math.min(originalSubtotal, itemDiscountAmount + globalDiscountAmount));
  const netSubtotal = Math.max(0, originalSubtotal - totalDiscount);

  const lineTotalsMinor = services.map((service) => {
    const quantity = Number(service.quantity ?? 1);
    const currentPrice = Number(service.price ?? 0);
    return Math.max(0, toMinorUnits(currentPrice * quantity));
  });
  const globalDiscountMinor = Math.max(0, toMinorUnits(globalDiscountAmount));
  const allocatedGlobalDiscountMinor = buildGlobalDiscountAllocationMinor(lineTotalsMinor, globalDiscountMinor);

  const lineDetails: PosPricingLineSummary[] = services.map((service, index) => {
    const quantity = Number(service.quantity ?? 1);
    const currentUnitPrice = Number(service.price ?? 0);
    const discountedLineTotalMinor = lineTotalsMinor[index] || 0;
    const originalUnitPrice = service.originalPrice != null ? Number(service.originalPrice) : null;
    const hasManualDiscount = originalUnitPrice != null && originalUnitPrice > currentUnitPrice + 0.0049;
    const originalLineTotalMinor = hasManualDiscount
      ? toMinorUnits(originalUnitPrice * quantity)
      : discountedLineTotalMinor;
    const manualDiscountMinor = Math.max(0, originalLineTotalMinor - discountedLineTotalMinor);
    const globalDiscountLineMinor = Math.min(discountedLineTotalMinor, allocatedGlobalDiscountMinor[index] || 0);
    const taxableMinor = Math.max(0, discountedLineTotalMinor - globalDiscountLineMinor);
    const vatRate = normalizeServiceVatRate(service.vat_rate);
    const vatMinor = vatRate != null ? toMinorUnits(fromMinorUnits(taxableMinor) * vatRate) : 0;
    const finalLineMinor = taxableMinor + vatMinor;

    return {
      serviceId: String(service.id || ""),
      serviceName: String(service.name || "Service"),
      quantity,
      currentUnitPrice,
      originalUnitPrice,
      hasManualDiscount,
      originalLineTotal: fromMinorUnits(originalLineTotalMinor),
      discountedLineTotal: fromMinorUnits(discountedLineTotalMinor),
      manualDiscountAmount: fromMinorUnits(manualDiscountMinor),
      globalDiscountAmount: fromMinorUnits(globalDiscountLineMinor),
      taxableAmount: fromMinorUnits(taxableMinor),
      vatRate,
      vatAmount: fromMinorUnits(vatMinor),
      finalLineTotal: fromMinorUnits(finalLineMinor),
      isVatConfigured: vatRate != null,
    };
  });

  const totalVat = roundCurrency(lineDetails.reduce((sum, line) => sum + line.vatAmount, 0));
  const finalInvoiceTotal = roundCurrency(netSubtotal + totalVat);
  const unconfiguredVatServices = lineDetails.filter((line) => !line.isVatConfigured);

  return {
    originalSubtotal,
    discountedSubtotal,
    itemDiscountAmount,
    globalDiscountAmount,
    totalDiscount,
    netSubtotal,
    totalVat,
    finalInvoiceTotal,
    lineDetails,
    unconfiguredVatServices,
  };
}

const paymentOptions = ["Cash", "Card", "Tabby", "Tabby Card", "Tamara", "Split Payment"];
const allocationMethodOptions: Array<{ value: PaymentMethodVariant; label: string }> = [
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
  { value: "tabby_standard", label: "Tabby" },
  { value: "tabby_card", label: "Tabby Card" },
  { value: "tamara", label: "Tamara" },
];

const POS_REGISTER_SESSION_KEY = "posRegisterSession";
const POS_RECENT_SERVICES_KEY = "posRecentServices";
const REGISTER_TABLE = "cash_register_sessions";

function recentServicesStorageKey(clinicId: string) {
  return `${POS_RECENT_SERVICES_KEY}:${clinicId}`;
}

function getDubaiDateParts(date: Date) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dubai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const parts = formatter.formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value || "";
  const month = parts.find((part) => part.type === "month")?.value || "";
  const day = parts.find((part) => part.type === "day")?.value || "";
  return { year, month, day };
}

function formatDubaiFileDate(date: Date) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dubai",
    day: "2-digit",
    month: "short",
    year: "numeric",
    weekday: "long",
  });

  const parts = formatter.formatToParts(date);
  const day = parts.find((part) => part.type === "day")?.value || "";
  const month = parts.find((part) => part.type === "month")?.value?.toUpperCase() || "";
  const year = parts.find((part) => part.type === "year")?.value || "";
  const weekday = parts.find((part) => part.type === "weekday")?.value?.toUpperCase() || "";
  return { day, month, year, weekday };
}

function getDubaiDayUtcRange(date: Date) {
  const { year, month, day } = getDubaiDateParts(date);
  const startIso = `${year}-${month}-${day}T00:00:00+04:00`;
  const endIso = `${year}-${month}-${day}T23:59:59.999+04:00`;
  return {
    startUtcIso: new Date(startIso).toISOString(),
    endUtcIso: new Date(endIso).toISOString(),
  };
}

function getPaymentBreakdown(paymentMethodRaw: string, totalAmount: number) {
  const breakdown = getPaymentBreakdownForReporting(paymentMethodRaw, totalAmount);
  return {
    ...breakdown,
    addOn: 0,
  };
}

function extractTransactionReference(paymentMethodRaw: string, channel: "card" | "tabby" | "tamara") {
  const raw = String(paymentMethodRaw || "");
  const lower = raw.toLowerCase();
  if (!lower.includes(channel)) return "";

  const referencePatterns = [
    /(ref(?:erence)?|rrn|auth|approval|txn|transaction)\s*[:#-]?\s*([a-z0-9-]{4,})/i,
    /\b([a-z0-9]{6,})\b/i,
  ];

  for (const pattern of referencePatterns) {
    const match = raw.match(pattern);
    if (match?.[2]) {
      return String(match[2]).toUpperCase();
    }
    if (match?.[1] && match[1].length >= 6) {
      return String(match[1]).toUpperCase();
    }
  }

  return "";
}

function summarizeStoredAllocationRows(rows: PaymentAllocation[]) {
  return summarizeStoredAllocationRowsForReporting(rows);
}

function normalizeServiceText(value: unknown): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getServiceDisplayName(service: Service): string {
  return String(service.display_name || service.name || "").trim();
}

function getServiceVariant(service: Service): string {
  return String(service.variant || service.description || "").trim();
}

function buildServiceSearchText(service: Service): string {
  return normalizeServiceText([
    service.display_name,
    service.name,
    service.variant,
    service.description,
    service.category,
    service.category_id,
    service.search_keywords,
    service.common_aliases,
  ].filter(Boolean).join(" "));
}

function createAllocationDraftRow(
  methodVariant: PaymentMethodVariant | "",
  invoiceAllocationAmountInput = ""
): PaymentAllocationDraft {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    methodVariant,
    invoiceAllocationAmountInput,
    providerReferenceNumber: "",
    terminalAuthorizationCode: "",
    cardNetwork: "",
  };
}

export default function ReceiptsPage() {
  const { accessSession, isLoaded, isManager, allowedClinicId } = useClinicAccess();
  const [patients, setPatients] = useState<any[]>([]);
  const [clinicPatientFiles, setClinicPatientFiles] = useState<any[]>([]);
  const [registrationPatients, setRegistrationPatients] = useState<any[]>([]);
  const [registrationClinicPatientFiles, setRegistrationClinicPatientFiles] = useState<any[]>([]);
  const [doctors, setDoctors] = useState<any[]>([]);
  const [receptionists, setReceptionists] = useState<any[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [clinics, setClinics] = useState<Clinic[]>([]);
  const [activeClinic, setActiveClinic] = useState<Clinic | null>(null);

  const [patientId, setPatientId] = useState("");
  const [patientName, setPatientName] = useState("");
  const [patientPhoneInput, setPatientPhoneInput] = useState("");
  const [patientEmailInput, setPatientEmailInput] = useState("");
  const [patientDobInput, setPatientDobInput] = useState("");
  const [patientSexInput, setPatientSexInput] = useState("");
  const [patientEmiratesIdInput, setPatientEmiratesIdInput] = useState("");
  const [patientPassportInput, setPatientPassportInput] = useState("");
  const [patientMrnInput, setPatientMrnInput] = useState("");
  const [patientNationalityInput, setPatientNationalityInput] = useState("");
  const [patientFileNumberInput, setPatientFileNumberInput] = useState("");
  const [nationalitySearch, setNationalitySearch] = useState("");
  const [showNationalitySuggestions, setShowNationalitySuggestions] = useState(false);
  const [nationalityHighlightIndex, setNationalityHighlightIndex] = useState(-1);
  const [filteredPatients, setFilteredPatients] = useState<any[]>([]);
  const [showPatientSuggestions, setShowPatientSuggestions] = useState(false);
  const [transactionPatientId, setTransactionPatientId] = useState(""); // Track patient ID for current transaction
  const [transactionPatientFileId, setTransactionPatientFileId] = useState("");
  const [selectedPatientInfo, setSelectedPatientInfo] = useState<{
    date_of_birth?: string | null;
    sex?: string | null;
    nationality?: string | null;
    emirates_id?: string | null;
    passport_number?: string | null;
    mrn?: string | null;
    email?: string | null;
  } | null>(null);
  const [doctorId, setDoctorId] = useState("");
  const [receptionistId, setReceptionistId] = useState("");
  const [notes, setNotes] = useState("");
  const [selectedServices, setSelectedServices] = useState<any[]>([]);
  const [serviceSearch, setServiceSearch] = useState("");
  const [serviceCategory, setServiceCategory] = useState("all");
  const [serviceUsageFilter, setServiceUsageFilter] = useState<"all" | "frequent" | "recent" | "favorites">("all");
  const [recentServiceIds, setRecentServiceIds] = useState<string[]>([]);
  const [frequentlyUsedServiceIds, setFrequentlyUsedServiceIds] = useState<string[]>([]);
  const [favoriteServiceIds, setFavoriteServiceIds] = useState<string[]>([]);
  const [isLoadingFavorites, setIsLoadingFavorites] = useState(false);
  const [collapsedServiceCategories, setCollapsedServiceCategories] = useState<Record<string, boolean>>({});
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState("");
  const [paymentAllocationDrafts, setPaymentAllocationDrafts] = useState<PaymentAllocationDraft[]>([]);
  const [paymentValidationErrors, setPaymentValidationErrors] = useState<string[]>([]);
  const [cashReceivedByRow, setCashReceivedByRow] = useState<Record<string, string>>({});
  const [successToasts, setSuccessToasts] = useState<PosSuccessToast[]>([]);
  const [paymentCompleteSnapshot, setPaymentCompleteSnapshot] = useState<PaymentCompleteSnapshot | null>(null);
  const [applyCreditChecked, setApplyCreditChecked] = useState(false);
  const [discountInput, setDiscountInput] = useState("");
  const [discountType, setDiscountType] = useState<"AED" | "%">("AED");
  const [birthdayDiscountApplied, setBirthdayDiscountApplied] = useState(false);
  const [, setShowPrintModal] = useState(false);
  const [isSavingReceipt, setIsSavingReceipt] = useState(false);
  const [isDownloadingInvoice, setIsDownloadingInvoice] = useState(false);
  const [isPosUnlocked, setIsPosUnlocked] = useState(false);
  const [loginReceptionistId, setLoginReceptionistId] = useState("");
  const [pinInput, setPinInput] = useState("");
  const [openingCashInput, setOpeningCashInput] = useState("");
  const [openingCash, setOpeningCash] = useState<number | null>(null);
  const [registerOpenedAt, setRegisterOpenedAt] = useState("");
  const [showCloseRegisterModal, setShowCloseRegisterModal] = useState(false);
  const [closingCashInput, setClosingCashInput] = useState("");
  const [showPatientBackupModal, setShowPatientBackupModal] = useState(false);
  const [isLoadingPatientBackupSummary, setIsLoadingPatientBackupSummary] = useState(false);
  const [isDownloadingPatientBackup, setIsDownloadingPatientBackup] = useState(false);
  const [patientBackupError, setPatientBackupError] = useState("");
  const [patientBackupSummary, setPatientBackupSummary] = useState<{
    clinicName: string;
    patientCount: number;
    treatmentRecordCount: number;
    filename: string;
  } | null>(null);
  const [registerSessionId, setRegisterSessionId] = useState("");
  const [cashSalesTotal, setCashSalesTotal] = useState(0);
  const [expectedCashAmount, setExpectedCashAmount] = useState(0);
  const [isLoadingCashSummary, setIsLoadingCashSummary] = useState(false);
  const [cashDeductions, setCashDeductions] = useState<CashDeduction[]>([]);
  const [isLoadingCashDeductions, setIsLoadingCashDeductions] = useState(false);
  const [showCashDeductionModal, setShowCashDeductionModal] = useState(false);
  const [cashDeductionModalMode, setCashDeductionModalMode] = useState<"create" | "edit">("create");
  const [editingCashDeductionId, setEditingCashDeductionId] = useState("");
  const [cashDeductionType, setCashDeductionType] = useState<CashDeductionType>("expense");
  const [cashDeductionStaffId, setCashDeductionStaffId] = useState("");
  const [cashDeductionAmountInput, setCashDeductionAmountInput] = useState("");
  const [cashDeductionDescription, setCashDeductionDescription] = useState("");
  const [cashDeductionReferenceInput, setCashDeductionReferenceInput] = useState("");
  const [isSavingCashDeduction, setIsSavingCashDeduction] = useState(false);
  const [showVoidCashDeductionModal, setShowVoidCashDeductionModal] = useState(false);
  const [voidCashDeductionId, setVoidCashDeductionId] = useState("");
  const [voidCashDeductionReason, setVoidCashDeductionReason] = useState("");
  const [isVoidingCashDeduction, setIsVoidingCashDeduction] = useState(false);
  const [cashDeductionSummary, setCashDeductionSummary] = useState<{
    businessDate: string;
    registerStatus: "open" | "closed";
    cashCollected: number;
    activeDeductionsTotal: number;
    availableCash: number;
    totalCommissions: number;
    totalExpenses: number;
  }>({
    businessDate: "",
    registerStatus: "open",
    cashCollected: 0,
    activeDeductionsTotal: 0,
    availableCash: 0,
    totalCommissions: 0,
    totalExpenses: 0,
  });
  const [currentReceipt, setCurrentReceipt] = useState<any | null>(null);
  const [showSearchPatientModal, setShowSearchPatientModal] = useState(false);
  const [searchPatientModalInitialProfileId, setSearchPatientModalInitialProfileId] = useState<string | null>(null);
  const [showRegisterPatientModal, setShowRegisterPatientModal] = useState(false);
  const [showReceiptHistoryModal, setShowReceiptHistoryModal] = useState(false);
  const [outstandingBalances, setOutstandingBalances] = useState<OutstandingBalance[]>([]);
  const [balancePayments, setBalancePayments] = useState<BalancePayment[]>([]);
  const [patientCredits, setPatientCredits] = useState<PatientCredit[]>([]);
  const [collectBalanceContext, setCollectBalanceContext] = useState<{
    balance: OutstandingBalance;
    payments: BalancePayment[];
    patient: any;
  } | null>(null);
  const isProceedingRef = useRef(false);
  const [isProceeding, setIsProceeding] = useState(false);
  // Tooth numbers per cart item (parallel array matching selectedServices)
  const [cartItemTeeth, setCartItemTeeth] = useState<string[][]>([]);
  const [cartItemToothDrafts, setCartItemToothDrafts] = useState<string[]>([]);
  // Transaction type step
  const [showTransactionTypeModal, setShowTransactionTypeModal] = useState(false);
  // Treatment plan checkout
  const [showPlanCheckoutModal, setShowPlanCheckoutModal] = useState(false);
  // Active plans for selected patient
  const [patientActivePlans, setPatientActivePlans] = useState<any[]>([]);
  const [patientActivePlanPayments, setPatientActivePlanPayments] = useState<any[]>([]);
  const [patientActivePlanPaymentRecords, setPatientActivePlanPaymentRecords] = useState<any[]>([]);
  const [patientActivePlanVisits, setPatientActivePlanVisits] = useState<any[]>([]);

  useEffect(() => {
    if (!paymentCompleteSnapshot) return;
    const preventEscapeClose = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("keydown", preventEscapeClose, true);
    return () => window.removeEventListener("keydown", preventEscapeClose, true);
  }, [paymentCompleteSnapshot]);
  const [isLoadingActivePlans, setIsLoadingActivePlans] = useState(false);
  const router = useRouter();

  const visibleReceptionists = useMemo(() => {
    if (!allowedClinicId) return receptionists;
    return receptionists.filter((person) => person.clinic_id === allowedClinicId);
  }, [receptionists, allowedClinicId]);

  const clinicCommissionStaff = useMemo(() => {
    if (!activeClinic?.id) return [] as any[];
    return doctors.filter((doctor) => doctor.clinic_id === activeClinic.id);
  }, [doctors, activeClinic?.id]);

  const expenseFeatureEnabled = !!activeClinic?.enable_expenses;
  const commissionFeatureEnabled = !!activeClinic?.enable_commissions;
  const deductionFeatureEnabled = expenseFeatureEnabled || commissionFeatureEnabled;

  function resetCashDeductionForm(nextType?: CashDeductionType) {
    const resolvedType = nextType
      || (commissionFeatureEnabled && !expenseFeatureEnabled ? "commission" : "expense");
    setCashDeductionModalMode("create");
    setEditingCashDeductionId("");
    setCashDeductionType(resolvedType);
    setCashDeductionStaffId("");
    setCashDeductionAmountInput("");
    setCashDeductionDescription("");
    setCashDeductionReferenceInput("");
  }

  async function fetchCashDeductionState() {
    if (!registerSessionId) {
      return {
        entries: [] as CashDeduction[],
        summary: {
          businessDate: "",
          registerStatus: "open" as const,
          cashCollected: 0,
          activeDeductionsTotal: 0,
          availableCash: 0,
          totalCommissions: 0,
          totalExpenses: 0,
        },
      };
    }

    const response = await fetch(`/api/cash-deductions?registerSessionId=${encodeURIComponent(registerSessionId)}`, {
      cache: "no-store",
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.error || "Failed loading cash deductions.");
    }
    return payload as {
      entries: CashDeduction[];
      summary: {
        businessDate: string;
        registerStatus: "open" | "closed";
        cashCollected: number;
        activeDeductionsTotal: number;
        availableCash: number;
        totalCommissions: number;
        totalExpenses: number;
      };
    };
  }

  async function loadCashDeductions() {
    if (!isPosUnlocked || !registerSessionId) {
      setCashDeductions([]);
      setCashDeductionSummary({
        businessDate: "",
        registerStatus: "open",
        cashCollected: 0,
        activeDeductionsTotal: 0,
        availableCash: 0,
        totalCommissions: 0,
        totalExpenses: 0,
      });
      return;
    }

    setIsLoadingCashDeductions(true);
    try {
      const payload = await fetchCashDeductionState();
      setCashDeductions(payload.entries || []);
      setCashDeductionSummary(payload.summary);
    } catch (error) {
      console.error("Failed loading cash deductions", error);
      alert(error instanceof Error ? error.message : "Failed loading cash deductions.");
    } finally {
      setIsLoadingCashDeductions(false);
    }
  }

  function openCashDeductionEntry(entry?: CashDeduction) {
    if (entry) {
      setCashDeductionModalMode("edit");
      setEditingCashDeductionId(entry.id);
      setCashDeductionType(entry.type);
      setCashDeductionStaffId(entry.staff_id || "");
      setCashDeductionAmountInput(Number(entry.amount || 0).toFixed(2));
      setCashDeductionDescription(entry.description || "");
      setCashDeductionReferenceInput(entry.reference_number || "");
      setShowCashDeductionModal(true);
      return;
    }

    if (!deductionFeatureEnabled) return;

    if (expenseFeatureEnabled && !commissionFeatureEnabled) {
      resetCashDeductionForm("expense");
    } else if (commissionFeatureEnabled && !expenseFeatureEnabled) {
      resetCashDeductionForm("commission");
    } else {
      resetCashDeductionForm(cashDeductionType);
    }
    setShowCashDeductionModal(true);
  }

  useEffect(() => {
    if (!isLoaded) return;
    let startupClinicId: string | null = allowedClinicId || null;
    const savedSession = localStorage.getItem(POS_REGISTER_SESSION_KEY);
    if (savedSession) {
      try {
        const parsed = JSON.parse(savedSession);
        if (!clinicAccessAllowsClinic(accessSession, parsed?.clinicId || null)) {
          localStorage.removeItem(POS_REGISTER_SESSION_KEY);
        } else {
          startupClinicId = String(parsed?.clinicId || "").trim() || startupClinicId;
          if (parsed?.receptionistId) {
            setIsPosUnlocked(true);
            setReceptionistId(parsed.receptionistId);
            setLoginReceptionistId(parsed.receptionistId);
            setOpeningCash(Number(parsed.openingCash || 0));
            setRegisterOpenedAt(parsed.openedAt || "");
            setRegisterSessionId(parsed.registerSessionId || "");
          }
        }
      } catch {
        localStorage.removeItem(POS_REGISTER_SESSION_KEY);
      }
    }

    void loadData(startupClinicId);
  }, [accessSession, isLoaded]);

  useEffect(() => {
    if (!receptionistId || clinics.length === 0) return;
    const savedSession = localStorage.getItem(POS_REGISTER_SESSION_KEY);
    if (!savedSession) return;
    try {
      const parsed = JSON.parse(savedSession);
      if (!parsed?.clinicId) return;
      if (!clinicAccessAllowsClinic(accessSession, parsed.clinicId || null)) return;
      const clinic = clinics.find((c) => c.id === parsed.clinicId);
      if (clinic) setActiveClinic(clinic);
    } catch {
      // ignore
    }
  }, [receptionistId, clinics, accessSession]);

  useEffect(() => {
    if (!isPosUnlocked || !registerSessionId || !activeClinic?.id) {
      setCashDeductions([]);
      return;
    }
    void loadCashDeductions();
  }, [isPosUnlocked, registerSessionId, activeClinic?.id]);

  useEffect(() => {
    void loadClinicScopedPatientData(activeClinic?.id || allowedClinicId || null);
  }, [activeClinic?.id, allowedClinicId]);

  useEffect(() => {
    if (!activeClinic?.id) {
      setRecentServiceIds([]);
      setFrequentlyUsedServiceIds([]);
      setFavoriteServiceIds([]);
      return;
    }
    try {
      const raw = window.localStorage.getItem(recentServicesStorageKey(activeClinic.id));
      if (!raw) {
        setRecentServiceIds([]);
        return;
      }
      const parsed = JSON.parse(raw);
      setRecentServiceIds(Array.isArray(parsed) ? parsed.map((id) => String(id)) : []);
    } catch {
      setRecentServiceIds([]);
    }
  }, [activeClinic?.id]);

  useEffect(() => {
    loadFrequentlyUsedServices();
    loadFavoriteServices();
  }, [activeClinic?.id, receptionistId, loginReceptionistId, receptionists]);

  useEffect(() => {
    if (!showRegisterPatientModal) return;
    if (registrationPatients.length > 0 && registrationClinicPatientFiles.length > 0) return;
    void loadRegistrationLookupData();
  }, [showRegisterPatientModal, registrationPatients.length, registrationClinicPatientFiles.length]);

  async function loadFavoriteServices() {
    if (!activeClinic?.id) {
      setFavoriteServiceIds([]);
      return;
    }
    const activeReceptionistId = receptionistId || loginReceptionistId;
    if (!activeReceptionistId) {
      setFavoriteServiceIds([]);
      return;
    }

    setIsLoadingFavorites(true);
    const { data, error } = await supabase
      .from("service_favorites")
      .select("service_id")
      .eq("clinic_id", activeClinic.id)
      .or(`receptionist_id.eq.${activeReceptionistId},receptionist_id.is.null`);
    setIsLoadingFavorites(false);

    if (error) {
      console.warn("Failed loading service favorites", error);
      setFavoriteServiceIds([]);
      return;
    }

    const ids = new Set<string>();
    for (const row of data || []) {
      if (row.service_id) ids.add(String(row.service_id));
    }
    setFavoriteServiceIds([...ids]);
  }

  async function toggleFavorite(serviceId: string) {
    if (!activeClinic?.id) return;
    const activeReceptionistId = receptionistId || loginReceptionistId;
    if (!activeReceptionistId) {
      alert("Open the register first.");
      return;
    }

    const isFavorite = favoriteServiceIds.includes(serviceId);
    if (isFavorite) {
      const { error } = await supabase
        .from("service_favorites")
        .delete()
        .eq("clinic_id", activeClinic.id)
        .eq("receptionist_id", activeReceptionistId)
        .eq("service_id", serviceId);
      if (error) {
        alert(`Could not remove favorite: ${error.message || "unknown error"}`);
        return;
      }
      setFavoriteServiceIds((current) => current.filter((id) => id !== serviceId));
      return;
    }

    const { error } = await supabase
      .from("service_favorites")
      .insert([
        {
          clinic_id: activeClinic.id,
          receptionist_id: activeReceptionistId,
          service_id: serviceId,
        },
      ]);
    if (error) {
      alert(`Could not save favorite: ${error.message || "unknown error"}`);
      return;
    }
    setFavoriteServiceIds((current) => [...current, serviceId]);
  }

  async function loadFrequentlyUsedServices() {
    if (!activeClinic?.id) {
      setFrequentlyUsedServiceIds([]);
      return;
    }

    const clinicReceptionistIds = receptionists
      .filter((r) => r.clinic_id === activeClinic.id)
      .map((r) => String(r.id));
    if (clinicReceptionistIds.length === 0) {
      setFrequentlyUsedServiceIds([]);
      return;
    }

    const since = new Date();
    since.setDate(since.getDate() - 60);

    const { data: receiptsData, error: receiptsError } = await supabase
      .from("receipts")
      .select("id")
      .in("receptionist_id", clinicReceptionistIds)
      .gte("created_at", since.toISOString())
      .order("created_at", { ascending: false })
      .limit(600);

    if (receiptsError) {
      console.warn("Failed loading recent receipts for frequent services", receiptsError);
      setFrequentlyUsedServiceIds([]);
      return;
    }

    const receiptIds = (receiptsData || []).map((r) => String(r.id || "")).filter(Boolean);
    if (receiptIds.length === 0) {
      setFrequentlyUsedServiceIds([]);
      return;
    }

    const receiptItemsData: Array<{ service_id: string | null; quantity: number | null }> = [];
    const RECEIPT_ID_BATCH = 120;
    for (let index = 0; index < receiptIds.length; index += RECEIPT_ID_BATCH) {
      const receiptIdBatch = receiptIds.slice(index, index + RECEIPT_ID_BATCH);
      const { data, error: itemsError } = await supabase
        .from("receipt_items")
        .select("service_id, quantity")
        .in("receipt_id", receiptIdBatch);
      if (itemsError) {
        console.warn("Failed loading receipt items for frequent services", itemsError);
        setFrequentlyUsedServiceIds([]);
        return;
      }
      receiptItemsData.push(...((data || []) as Array<{ service_id: string | null; quantity: number | null }>));
    }

    const usageByServiceId = new Map<string, number>();
    for (const row of receiptItemsData || []) {
      const serviceId = String(row.service_id || "");
      if (!serviceId) continue;
      const qty = Math.max(1, Number(row.quantity || 1));
      usageByServiceId.set(serviceId, (usageByServiceId.get(serviceId) || 0) + qty);
    }
    const ranked = [...usageByServiceId.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 16)
      .map(([serviceId]) => serviceId);
    setFrequentlyUsedServiceIds(ranked);
  }

  // Loads all rows from a table by paginating through 1 000-row batches, working
  // around PostgREST's default max-rows cap.
  async function fetchAllRows(table: string, select: string): Promise<any[]> {
    const BATCH = 1000;
    let all: any[] = [];
    let from = 0;
    while (true) {
      const { data, error } = await supabase
        .from(table)
        .select(select)
        .range(from, from + BATCH - 1);
      if (error) {
        console.error(`fetchAllRows error on table "${table}" at range ${from}–${from + BATCH - 1}:`, error.message);
        break;
      }
      if (!data || data.length === 0) break;
      all = all.concat(data);
      if (data.length < BATCH) break;
      from += BATCH;
    }
    return all;
  }

  async function loadClinicScopedPatientData(clinicId: string | null | undefined) {
    if (!clinicId) {
      setClinicPatientFiles([]);
      setPatients([]);
      return;
    }

    const CLINIC_FILES_BATCH = 1000;
    const scopedClinicFiles: any[] = [];
    const scopedPatientsById = new Map<string, any>();
    for (let from = 0; ; from += CLINIC_FILES_BATCH) {
      const { data: clinicFileRows, error: clinicFilesError } = await supabase
        .from("clinic_patient_files")
        .select("id, clinic_id, patient_id, file_no, mrn, patients(*)")
        .eq("clinic_id", clinicId)
        .range(from, from + CLINIC_FILES_BATCH - 1);
      if (clinicFilesError) {
        console.warn("Failed loading clinic patient files", clinicFilesError);
        setClinicPatientFiles([]);
        setPatients([]);
        return;
      }
      const batchRows = clinicFileRows || [];
      if (batchRows.length === 0) break;
      for (const row of batchRows) {
        scopedClinicFiles.push({
          id: row.id,
          clinic_id: row.clinic_id,
          patient_id: row.patient_id,
          file_no: row.file_no,
          mrn: row.mrn,
        });
        const relatedPatient = Array.isArray(row.patients) ? row.patients[0] : row.patients;
        if (relatedPatient && relatedPatient.id) {
          scopedPatientsById.set(String(relatedPatient.id), relatedPatient);
        }
      }
      if (batchRows.length < CLINIC_FILES_BATCH) break;
    }

    setClinicPatientFiles(scopedClinicFiles);
    setPatients(Array.from(scopedPatientsById.values()));
  }

  async function loadRegistrationLookupData() {
    const [patientRows, clinicFileRows] = await Promise.all([
      fetchAllRows("patients", "*"),
      fetchAllRows("clinic_patient_files", "id, clinic_id, patient_id, file_no, mrn"),
    ]);
    setRegistrationPatients(patientRows);
    setRegistrationClinicPatientFiles(clinicFileRows);
  }

  async function loadData(initialClinicId?: string | null) {
    const [
      doctorResult,
      receptionistResult,
      serviceResult,
      clinicResult,
      balancesResult,
      balancePaymentsResult,
      patientCreditsResult,
    ] = await Promise.allSettled([
      supabase.from("doctors").select("*"),
      supabase.from("receptionist").select("*"),
      supabase.from("services").select("*"),
      supabase.from("clinics").select("*"),
      supabase.from("outstanding_balances").select("*"),
      supabase.from("balance_payments").select("*"),
      supabase.from("patient_credits").select("*"),
    ]);

    if (doctorResult.status === "fulfilled") {
      setDoctors((doctorResult.value.data || []) as any[]);
    }

    if (receptionistResult.status === "fulfilled") {
      const receptionistRows = ((receptionistResult.value.data || []) as any[]).filter((person) =>
        clinicAccessAllowsClinic(accessSession, person.clinic_id || null)
      );
      setReceptionists(receptionistRows);
    }

    if (serviceResult.status === "fulfilled") {
      setServices((serviceResult.value.data || []) as Service[]);
    }

    if (clinicResult.status === "fulfilled") {
      setClinics(filterClinicsForAccess((clinicResult.value.data || []) as Clinic[], accessSession));
    }

    if (balancesResult.status === "fulfilled" && !balancesResult.value.error) {
      setOutstandingBalances((balancesResult.value.data || []) as OutstandingBalance[]);
    }

    if (balancePaymentsResult.status === "fulfilled" && !balancePaymentsResult.value.error) {
      setBalancePayments((balancePaymentsResult.value.data || []) as BalancePayment[]);
    }

    // Tolerates databases that haven't run supabase-patient-credits-migration.sql yet.
    if (patientCreditsResult.status === "fulfilled" && !patientCreditsResult.value.error) {
      setPatientCredits((patientCreditsResult.value.data || []) as PatientCredit[]);
    }

    await loadClinicScopedPatientData(initialClinicId || allowedClinicId || null);
  }

  async function refetchBalancePayments() {
    const { data, error } = await supabase.from("balance_payments").select("*");
    if (!error) {
      setBalancePayments((data || []) as BalancePayment[]);
    }
  }

  // Returns "Free" for zero-price services, otherwise an AED amount string.
  function fmtServicePrice(amount: number, decimals = 2): string {
    return amount === 0 ? "Free" : `AED ${amount.toFixed(decimals)}`;
  }

  function addService(service: any) {
    const isVariable = service.pricing_type === 'variable';
    const cartItem = isVariable
      ? {
          ...service,
          price: Number(service.standard_price ?? service.price ?? 0),
          isVariablePriced: true,
          minPrice: service.min_price != null ? Number(service.min_price) : null,
          maxPrice: service.max_price != null ? Number(service.max_price) : null,
        }
      : service;
    setSelectedServices((current) => [...current, cartItem]);
    setCartItemTeeth((current) => [...current, []]);
    setCartItemToothDrafts((current) => [...current, ""]);

    const serviceId = String(service.id);
    setRecentServiceIds((current) => {
      const updated = [serviceId, ...current.filter((id) => id !== serviceId)].slice(0, 8);
      if (typeof window !== "undefined" && activeClinic?.id) {
        localStorage.setItem(recentServicesStorageKey(activeClinic.id), JSON.stringify(updated));
      }
      return updated;
    });
  }

  function removeService(index: number) {
    setSelectedServices((current) => {
      const updated = [...current];
      updated.splice(index, 1);
      return updated;
    });
    setCartItemTeeth((current) => {
      const updated = [...current];
      updated.splice(index, 1);
      return updated;
    });
    setCartItemToothDrafts((current) => {
      const updated = [...current];
      updated.splice(index, 1);
      return updated;
    });
  }

  function updateCartItemPrice(index: number, newPriceStr: string) {
    const parsed = parseFloat(newPriceStr);
    if (!Number.isFinite(parsed) || parsed < 0) return;
    setSelectedServices((current) => {
      const updated = [...current];
      const item = { ...updated[index] };
      if (item.isVariablePriced) {
        // Variable-range: clamp to allowed range, never treat as a discount/promo.
        const lo = item.minPrice != null ? Number(item.minPrice) : 0;
        const hi = item.maxPrice != null ? Number(item.maxPrice) : Number.MAX_SAFE_INTEGER;
        item.price = Math.min(hi, Math.max(lo, parsed));
        delete item.originalPrice;
      } else {
        const original = item.originalPrice ?? Number(item.price);
        if (parsed !== original) {
          item.originalPrice = original;
        } else {
          delete item.originalPrice;
        }
        item.price = parsed;
      }
      updated[index] = item;
      return updated;
    });
  }

  function updateCartItemQuantity(index: number, qty: number) {
    if (!Number.isFinite(qty) || qty < 1) return;
    setSelectedServices((current) => {
      const updated = [...current];
      updated[index] = { ...updated[index], quantity: Math.round(qty) };
      return updated;
    });
  }

  function parseToothTokens(raw: string): string[] {
    return raw
      .replace(/#/g, " ")
      .split(/[\s,،;]+/)
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
  }

  function setCartItemToothDraft(index: number, value: string) {
    setCartItemToothDrafts((current) => {
      const updated = [...current];
      while (updated.length <= index) updated.push("");
      updated[index] = value;
      return updated;
    });
  }

  function addToothToCartItem(index: number) {
    const draft = String(cartItemToothDrafts[index] || "");
    const tokens = parseToothTokens(draft);
    if (tokens.length === 0) return;
    setCartItemTeeth((current) => {
      const updated = [...current];
      while (updated.length <= index) updated.push([]);
      const existing = updated[index] || [];
      const seen = new Set(existing);
      for (const tooth of tokens) {
        if (!seen.has(tooth)) {
          existing.push(tooth);
          seen.add(tooth);
        }
      }
      updated[index] = existing;
      return updated;
    });
    setCartItemToothDraft(index, "");
  }

  function removeToothFromCartItem(index: number, tooth: string) {
    setCartItemTeeth((current) => {
      const updated = [...current];
      while (updated.length <= index) updated.push([]);
      updated[index] = (updated[index] || []).filter((item) => item !== tooth);
      return updated;
    });
  }

  function getTeethForItem(index: number): string[] {
    return cartItemTeeth[index] || [];
  }

  function serviceToothSelectionMode(service: any): "none" | "optional" | "required" {
    return (service?.tooth_selection_mode || "none") as "none" | "optional" | "required";
  }

  function shouldShowTeethInput(service: any): boolean {
    return serviceToothSelectionMode(service) !== "none";
  }

  function normalizeTeethForItem(service: any, index: number): string[] {
    return shouldShowTeethInput(service) ? getTeethForItem(index) : [];
  }

  function validateTeethSelection(): boolean {
    for (let i = 0; i < selectedServices.length; i++) {
      const service = selectedServices[i];
      if (serviceToothSelectionMode(service) === "required" && getTeethForItem(i).length === 0) {
        alert(`Please enter tooth numbers for ${service.name}.`);
        return false;
      }
    }
    return true;
  }

  function getTeethDisplay(index: number): string {
    const teeth = getTeethForItem(index);
    if (teeth.length === 0) return "";
    return `Tooth #${teeth.join(", #")}`;
  }

  function clearPosForm() {
    setPatientId("");
    setPatientName("");
    setPatientPhoneInput("");
    setPatientEmailInput("");
    setPatientDobInput("");
    setPatientSexInput("");
    setPatientEmiratesIdInput("");
    setPatientPassportInput("");
    setPatientMrnInput("");
    setPatientNationalityInput("");
    setNationalitySearch("");
    setPatientFileNumberInput("");
    setDoctorId("");
    setNotes("");
    setSelectedServices([]);
    setCartItemTeeth([]);
    setCartItemToothDrafts([]);
    setDiscountInput("");
    setDiscountType("AED");
    setBirthdayDiscountApplied(false);
    setTransactionPatientId("");
    setTransactionPatientFileId("");
    setSelectedPatientInfo(null);
    setPatientActivePlans([]);
    setPatientActivePlanPayments([]);
    setPatientActivePlanPaymentRecords([]);
    setPatientActivePlanVisits([]);
  }

  async function loadPatientActivePlans(pid: string, cid: string) {
    if (!pid || !cid) return;
    setIsLoadingActivePlans(true);
    try {
      const plansResult = await supabase
        .from("treatment_plans")
        .select("*")
        .eq("patient_id", pid)
        .eq("clinic_id", cid)
        .eq("status", "Active")
        .order("created_at", { ascending: false });

      const plans = (plansResult.data || []);
      if (plans.length > 0) {
        const planIds = plans.map((p: any) => p.id);
        const [visR, payR, payRecordsR] = await Promise.all([
          supabase.from("treatment_plan_visits").select("*").in("treatment_plan_id", planIds),
          supabase.from("treatment_plan_payments").select("*").in("treatment_plan_id", planIds),
          supabase.from("treatment_plan_payment_records").select("*").in("treatment_plan_id", planIds),
        ]);
        setPatientActivePlanVisits((visR.data || []) as any[]);
        setPatientActivePlanPayments((payR.data || []) as any[]);
        setPatientActivePlanPaymentRecords((payRecordsR.data || []) as any[]);
      } else {
        setPatientActivePlanVisits([]);
        setPatientActivePlanPayments([]);
        setPatientActivePlanPaymentRecords([]);
      }
      setPatientActivePlans(plans);
    } finally {
      setIsLoadingActivePlans(false);
    }
  }

  const birthdayDiscountEligible = useMemo(() => {
    const dateOfBirth = selectedPatientInfo?.date_of_birth || patientDobInput || null;
    if (!dateOfBirth) return false;

    const dob = new Date(dateOfBirth);
    if (Number.isNaN(dob.getTime())) return false;

    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Dubai",
      month: "2-digit",
    });
    const current = formatter.formatToParts(new Date());
    const currentMonth = current.find((part) => part.type === "month")?.value || "";
    const dobParts = formatter.formatToParts(dob);
    const dobMonth = dobParts.find((part) => part.type === "month")?.value || "";
    return dobMonth === currentMonth;
  }, [selectedPatientInfo?.date_of_birth, patientDobInput]);

  useEffect(() => {
    if (!birthdayDiscountEligible) {
      setBirthdayDiscountApplied(false);
    }
  }, [birthdayDiscountEligible]);

  const pricingSummary = summarizeCartPricing(selectedServices, discountInput, discountType, birthdayDiscountApplied);
  const subtotal = pricingSummary.originalSubtotal;
  const manualDiscountAmount = pricingSummary.itemDiscountAmount;
  const globalDiscountAmount = pricingSummary.globalDiscountAmount;
  const discountAmount = pricingSummary.totalDiscount;
  const birthdayDiscountAmount = birthdayDiscountEligible && birthdayDiscountApplied
    ? Math.min(pricingSummary.discountedSubtotal, pricingSummary.discountedSubtotal * 0.05)
    : 0;
  const preVatTotal = pricingSummary.netSubtotal;
  const vat = pricingSummary.totalVat;
  const total = pricingSummary.finalInvoiceTotal;
  const unconfiguredVatLines = pricingSummary.unconfiguredVatServices;
  const hasUnconfiguredVatServices = unconfiguredVatLines.length > 0;
  const previewAllocations = buildPaymentAllocations(paymentAllocationDrafts, getAmountDueToday(), total, vat);
  const livePaymentValidation = validatePaymentAllocations(paymentAllocationDrafts, getAmountDueToday());
  const isAllocationBalanced = toMinorUnits(getAmountDueToday()) === previewAllocations.reduce((sum, row) => sum + toMinorUnits(row.invoiceAllocationAmount), 0);

  const clinicServices = useMemo(() => {
    if (!activeClinic) return [] as Service[];
    return services
      .filter((s) => s.clinic_id === activeClinic.id && s.is_active !== false)
      .sort((a, b) => {
        const sortA = Number(a.sort_order ?? 0);
        const sortB = Number(b.sort_order ?? 0);
        if (sortA !== sortB) return sortA - sortB;
        return getServiceDisplayName(a).localeCompare(getServiceDisplayName(b));
      });
  }, [services, activeClinic]);

  const selectedServiceCountById = useMemo(() => {
    const counts = new Map<string, number>();
    for (const service of selectedServices) {
      const id = String(service.id || "");
      if (!id) continue;
      counts.set(id, (counts.get(id) || 0) + 1);
    }
    return counts;
  }, [selectedServices]);

  function getServiceCategoryName(service: Service): string {
    const normalized = String(service.category || service.category_id || "").trim();
    if (normalized) return normalized;
    const inferred = getAestheticServiceCategory(getServiceDisplayName(service));
    return inferred || "Other Services";
  }

  const clinicDbCategories = useMemo(() => {
    const set = new Set<string>();
    for (const s of clinicServices) {
      const c = getServiceCategoryName(s);
      if (c) set.add(c);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [clinicServices]);

  const categoryTabs = useMemo(
    () => [{ key: "all", label: "All categories" }, ...clinicDbCategories.map((c) => ({ key: `cat:${c}`, label: c }))],
    [clinicDbCategories]
  );

  useEffect(() => {
    setServiceCategory("all");
    setServiceUsageFilter("all");
    setCollapsedServiceCategories({});
  }, [activeClinic?.id]);

  const clinicDoctors = useMemo(() => {
    if (!activeClinic) return [];
    return doctors.filter((d) => d.clinic_id === activeClinic.id);
  }, [doctors, activeClinic]);

  const clinicScopedPatients = useMemo(() => {
    if (!activeClinic?.id) return [];
    const patientById = new Map<string, any>();
    for (const p of patients) patientById.set(String(p.id), p);

    return clinicPatientFiles
      .filter((file) => file.clinic_id === activeClinic.id)
      .map((file) => {
        const p = patientById.get(String(file.patient_id));
        // If the patients row is missing (data gap from import or deleted record),
        // still surface the file so receptionists can find it by file number or MRN.
        const base = p ?? {
          id: String(file.patient_id || file.id),
          name: `(File #${file.file_no} — record missing)`,
          phone: null,
          email: null,
          emirates_id: null,
          passport_number: null,
          patient_number: null,
          notes: null,
        };
        return {
          ...base,
          clinic_patient_file_id: file.id,
          clinic_file_no: file.file_no,
          clinic_file_mrn: file.mrn,
        };
      });
  }, [activeClinic, patients, clinicPatientFiles]);

  const filteredServices = useMemo(() => {
    const queryTokens = normalizeServiceText(serviceSearch).split(" ").filter(Boolean);
    const usageSet = new Set<string>(
      serviceUsageFilter === "recent"
        ? recentServiceIds
        : serviceUsageFilter === "frequent"
          ? frequentlyUsedServiceIds
          : serviceUsageFilter === "favorites"
            ? favoriteServiceIds
            : []
    );

    const filtered = clinicServices.filter((service) => {
      const serviceId = String(service.id || "");
      if (serviceUsageFilter !== "all" && !usageSet.has(serviceId)) return false;

      const categoryName = getServiceCategoryName(service);
      const inCategory = serviceCategory === "all" || categoryName === serviceCategory.slice(4);
      if (!inCategory) return false;

      if (queryTokens.length === 0) return true;
      const haystack = buildServiceSearchText(service);
      return queryTokens.every((token) => haystack.includes(token));
    });

    return filtered.sort((a, b) => {
      const aName = normalizeServiceText(getServiceDisplayName(a));
      const bName = normalizeServiceText(getServiceDisplayName(b));
      const queryPrefix = normalizeServiceText(serviceSearch);
      if (queryPrefix) {
        const aStarts = aName.startsWith(queryPrefix) ? 0 : 1;
        const bStarts = bName.startsWith(queryPrefix) ? 0 : 1;
        if (aStarts !== bStarts) return aStarts - bStarts;
      }
      const sortA = Number(a.sort_order ?? 0);
      const sortB = Number(b.sort_order ?? 0);
      if (sortA !== sortB) return sortA - sortB;
      return aName.localeCompare(bName);
    });
  }, [
    clinicServices,
    serviceCategory,
    serviceSearch,
    serviceUsageFilter,
    recentServiceIds,
    frequentlyUsedServiceIds,
    favoriteServiceIds,
  ]);

  const groupedFilteredServices = useMemo(() => {
    const groups = new Map<string, Service[]>();
    for (const service of filteredServices) {
      const categoryName = getServiceCategoryName(service);
      const arr = groups.get(categoryName) || [];
      arr.push(service);
      groups.set(categoryName, arr);
    }
    const categoryOrder = [...groups.keys()].sort((a, b) =>
      a === "Other Services" ? 1 : b === "Other Services" ? -1 : a.localeCompare(b)
    );
    return categoryOrder.map((categoryName) => ({
      categoryName,
      services: groups.get(categoryName) || [],
    }));
  }, [filteredServices]);

  const balancePaymentsByBalanceId = useMemo(() => {
    const map = new Map<string, BalancePayment[]>();
    for (const p of balancePayments) {
      const arr = map.get(p.outstanding_balance_id) || [];
      arr.push(p);
      map.set(p.outstanding_balance_id, arr);
    }
    return map;
  }, [balancePayments]);

  const selectedPatientBalancesInClinic = useMemo(() => {
    if (!patientId || !activeClinic?.id) return [];
    return outstandingBalances
      .filter((b) => b.patient_id === patientId && b.clinic_id === activeClinic.id)
      .map((b) => ({ balance: b, payments: balancePaymentsByBalanceId.get(b.id) || [] }))
      .map(({ balance, payments }) => ({ balance, payments, rollup: rollupBalance(balance, payments) }))
      .filter(({ rollup }) => rollup.remaining > 0.0049)
      .sort((a, b) => (a.balance.original_date < b.balance.original_date ? 1 : -1));
  }, [outstandingBalances, balancePaymentsByBalanceId, patientId, activeClinic]);

  // Credit available to the patient of the transaction being checked out,
  // scoped to the active clinic (deposits belong to the clinic that took them).
  const transactionPatientCredits = useMemo(() => {
    if (!transactionPatientId) return [];
    return patientCredits.filter(
      (c) => c.patient_id === transactionPatientId && (!activeClinic?.id || c.clinic_id === activeClinic.id)
    );
  }, [patientCredits, transactionPatientId, activeClinic]);

  const checkoutAvailableCredit = useMemo(
    () => availableCredit(transactionPatientCredits),
    [transactionPatientCredits]
  );

  function selectPatient(patient: any) {
    setPatientId(patient.id);
    setPatientName(patient.name);
    setPatientPhoneInput(patient.phone || "");
    setPatientEmailInput(patient.email || "");
    setPatientDobInput(patient.date_of_birth || "");
    setPatientSexInput(patient.sex || "");
    setPatientNationalityInput(patient.nationality || "");
    setNationalitySearch(patient.nationality || "");
    setPatientFileNumberInput(String(patient.clinic_file_no || patient.patient_number || ""));
    setPatientEmiratesIdInput(patient.emirates_id || "");
    setPatientPassportInput(patient.passport_number || "");
    setPatientMrnInput(patient.clinic_file_mrn || patient.mrn || "");
    setTransactionPatientFileId(String(patient.clinic_patient_file_id || ""));
    setSelectedPatientInfo({
      date_of_birth: patient.date_of_birth,
      sex: patient.sex,
      nationality: patient.nationality,
      emirates_id: patient.emirates_id,
      passport_number: patient.passport_number,
      mrn: patient.mrn,
      email: patient.email,
    });
    setShowPatientSuggestions(false);
    setFilteredPatients([]);
    if (patient.id && activeClinic?.id) {
      loadPatientActivePlans(patient.id, activeClinic.id);
    }
  }

  function openSearchPatientPicker() {
    setSearchPatientModalInitialProfileId(null);
    setShowSearchPatientModal(true);
  }

  function openViewPatientProfile() {
    if (!patientId) return;
    setSearchPatientModalInitialProfileId(patientId);
    setShowSearchPatientModal(true);
  }

  function parseMoneyInput(value: string) {
    const normalized = value.replace(/,/g, ".").trim();
    return Number(normalized);
  }

  function buildPatientDetailsPayload() {
    return {
      name: patientName.trim() || null,
      phone: patientPhoneInput.trim() || null,
      email: patientEmailInput.trim() || null,
      date_of_birth: patientDobInput || null,
      sex: patientSexInput || null,
      nationality: patientNationalityInput.trim() || null,
      emirates_id: patientEmiratesIdInput.trim() || null,
      passport_number: patientPassportInput.trim() || null,
      mrn: patientMrnInput.trim() || null,
    };
  }

  async function savePatientDetails(patientIdToSave: string) {
    if (!patientIdToSave) {
      return { ok: false as const, error: null as Error | null };
    }

    const payload = buildPatientDetailsPayload();
    const sanitizedPayload = Object.fromEntries(
      Object.entries(payload).filter(([, value]) => value !== null && value !== "")
    ) as Record<string, string>;

    if (Object.keys(sanitizedPayload).length === 0) {
      return { ok: true as const, error: null as Error | null };
    }

    const { error } = await supabase.from("patients").update(sanitizedPayload).eq("id", patientIdToSave);
    if (error) {
      console.error("Patient detail save error", error);
      return { ok: false as const, error };
    }

    setPatients((prev) =>
      prev.map((patient) => {
        if (patient.id !== patientIdToSave) return patient;
        return { ...patient, ...sanitizedPayload };
      })
    );

    return { ok: true as const, error: null as Error | null };
  }

  async function openRegister() {
    if (!loginReceptionistId) {
      alert("Please select receptionist.");
      return;
    }

    if (receptionists.length === 0) {
      alert("No receptionists found. Please add one in the Receptionists page first.");
      return;
    }

    const selectedReceptionist = receptionists.find((person) => person.id === loginReceptionistId);
    if (!selectedReceptionist) {
      alert("Selected receptionist was not found.");
      return;
    }

    const receptionistPin = String(selectedReceptionist.pin || "");
    if (!receptionistPin) {
      alert("This receptionist does not have a PIN yet. Set PIN in backend first.");
      return;
    }

    if (pinInput !== receptionistPin) {
      alert("Invalid PIN.");
      return;
    }

    const clinicForReceptionist = clinics.find((c) => c.id === selectedReceptionist.clinic_id);
    if (!clinicForReceptionist) {
      alert("This receptionist is not assigned to a clinic. Please assign one in the Backend > Receptionists section.");
      return;
    }
    if (!clinicAccessAllowsClinic(accessSession, clinicForReceptionist.id)) {
      alert("This receptionist is not allowed for the clinic you opened.");
      return;
    }

    const parsedOpeningCash = Number(openingCashInput);
    if (!Number.isFinite(parsedOpeningCash) || parsedOpeningCash < 0) {
      alert("Please enter a valid opening cash amount.");
      return;
    }

    const openedAt = new Date().toISOString();

    let createdRegisterSessionId = "";
    const { data: registerData, error: registerError } = await supabase
      .from(REGISTER_TABLE)
      .insert([
        {
          receptionist_id: loginReceptionistId,
          opening_cash: parsedOpeningCash,
          opened_at: openedAt,
        },
      ])
      .select("id")
      .single();

    if (registerError) {
      if (registerError.code === "23505") {
        // Already has an open session — resume it
        const { data: existing } = await supabase
          .from(REGISTER_TABLE)
          .select("id, opening_cash, opened_at")
          .eq("receptionist_id", loginReceptionistId)
          .is("closed_at", null)
          .single();
        if (existing) {
          createdRegisterSessionId = String(existing.id);
        } else {
          alert("A register session already exists but could not be retrieved. Please contact support.");
          return;
        }
      } else {
        console.warn("Register session insert warning", registerError);
        alert(
          "Register opened locally, but shift log was not saved to database. Please create table 'cash_register_sessions' if not configured."
        );
      }
    } else if (registerData) {
      createdRegisterSessionId = String(registerData.id);
    }

    const session = {
      receptionistId: loginReceptionistId,
      clinicId: clinicForReceptionist.id,
      openingCash: parsedOpeningCash,
      openedAt,
      registerSessionId: createdRegisterSessionId,
    };

    localStorage.setItem(POS_REGISTER_SESSION_KEY, JSON.stringify(session));

    setReceptionistId(loginReceptionistId);
    setOpeningCash(parsedOpeningCash);
    setRegisterOpenedAt(openedAt);
    setRegisterSessionId(createdRegisterSessionId);
    setActiveClinic(clinicForReceptionist);
    setIsPosUnlocked(true);
    setPinInput("");
    setOpeningCashInput("");

  }

  async function closeRegister() {
    const parsedClosingCash = parseMoneyInput(closingCashInput);
    if (!Number.isFinite(parsedClosingCash) || parsedClosingCash < 0) {
      alert("Please enter a valid closing cash amount.");
      return;
    }

    const latestExpectedCash = Number(expectedCashAmount || 0);
    const latestCashSales = Number(cashSalesTotal || 0);
    const variance = parsedClosingCash - latestExpectedCash;

    if (registerSessionId) {
      const { error: closeError } = await supabase
        .from(REGISTER_TABLE)
        .update({
          closing_cash: parsedClosingCash,
          variance,
          closed_at: new Date().toISOString(),
        })
        .eq("id", registerSessionId);

      if (closeError) {
        console.warn("Register session update warning", closeError);
        alert(
          "Register closed locally, but closing cash was not saved to database."
        );
      }
    }

    alert(
      `Register closed. Opening cash: AED ${Number(openingCash || 0).toFixed(2)} | Cash collected: AED ${latestCashSales.toFixed(2)} | Cash deductions: AED ${Number(cashDeductionSummary.activeDeductionsTotal || 0).toFixed(2)} | Expected cash: AED ${latestExpectedCash.toFixed(2)} | Actual closing cash: AED ${parsedClosingCash.toFixed(2)} | Difference: AED ${variance.toFixed(2)}`
    );

    localStorage.removeItem(POS_REGISTER_SESSION_KEY);
    setIsPosUnlocked(false);
    setActiveClinic(null);
    setShowCloseRegisterModal(false);
    setClosingCashInput("");
    setOpeningCash(null);
    setRegisterOpenedAt("");
    setRegisterSessionId("");
    setReceptionistId("");
    setLoginReceptionistId("");
    setCashSalesTotal(0);
    setExpectedCashAmount(0);
    setCashDeductions([]);
    setCashDeductionSummary({
      businessDate: "",
      registerStatus: "open",
      cashCollected: 0,
      activeDeductionsTotal: 0,
      availableCash: 0,
      totalCommissions: 0,
      totalExpenses: 0,
    });
    setShowCashDeductionModal(false);
    setShowVoidCashDeductionModal(false);
    resetCashDeductionForm();

    // Reset in-progress receipt on register close.
    setPatientId("");
    setPatientName("");
    setPatientPhoneInput("");
    setPatientEmailInput("");
    setPatientDobInput("");
    setPatientSexInput("");
    setPatientNationalityInput("");
    setPatientFileNumberInput("");
    setNationalitySearch("");
    setShowNationalitySuggestions(false);
    setPatientEmiratesIdInput("");
    setPatientPassportInput("");
    setPatientMrnInput("");
    setSelectedPatientInfo(null);
    setTransactionPatientId("");
    setTransactionPatientFileId("");
    setDoctorId("");
    setSelectedPaymentMethod("");
    setPaymentAllocationDrafts([]);
    setPaymentValidationErrors([]);
    setCashReceivedByRow({});
    setApplyCreditChecked(false);
    setNotes("");
    setSelectedServices([]);
    setDiscountInput("");
    setDiscountType("AED");
    setFilteredPatients([]);
    setShowPatientSuggestions(false);
    setShowPaymentModal(false);
    setShowPrintModal(false);
  }

  async function getShiftCashSalesTotal() {
    const activeReceptionistId = receptionistId || loginReceptionistId;
    if (!activeReceptionistId || !registerOpenedAt) {
      return 0;
    }

    const [receiptsRes, balancePaymentsRes, depositsRes] = await Promise.all([
      supabase
        .from("receipts")
        .select("total, amount_paid")
        .eq("receptionist_id", activeReceptionistId)
        .ilike("payment_method", "Cash%")
        .gte("created_at", registerOpenedAt),
      supabase
        .from("balance_payments")
        .select("amount")
        .eq("receptionist_id", activeReceptionistId)
        .ilike("payment_method", "Cash%")
        .gte("created_at", registerOpenedAt),
      supabase
        .from("patient_credits")
        .select("amount")
        .eq("receptionist_id", activeReceptionistId)
        .gt("amount", 0)
        .ilike("payment_method", "Cash%")
        .gte("created_at", registerOpenedAt),
    ]);

    if (receiptsRes.error) {
      console.warn("Failed loading cash sales summary", receiptsRes.error);
    }
    if (balancePaymentsRes.error && balancePaymentsRes.error.code !== "42P01") {
      console.warn("Failed loading balance payments for shift", balancePaymentsRes.error);
    }
    if (depositsRes.error && depositsRes.error.code !== "42P01") {
      console.warn("Failed loading patient deposits for shift", depositsRes.error);
    }

    // amount_paid is what actually entered the drawer; NULL means paid in full.
    const receiptsTotal = (receiptsRes.data || []).reduce(
      (sum, row) => sum + Number(row.amount_paid ?? row.total ?? 0),
      0
    );
    const balancePaymentsTotal = (balancePaymentsRes.data || []).reduce((sum, row) => sum + Number(row.amount || 0), 0);
    // Cash deposits (advance payments) also enter the drawer.
    const depositsTotal = (depositsRes.data || []).reduce((sum, row) => sum + Number(row.amount || 0), 0);
    return receiptsTotal + balancePaymentsTotal + depositsTotal;
  }

  async function openCloseRegisterModal() {
    setShowCloseRegisterModal(true);
    setClosingCashInput("");
    setIsLoadingCashSummary(true);
    try {
      const payload = await fetchCashDeductionState();
      setCashDeductions(payload.entries || []);
      setCashDeductionSummary(payload.summary);
      setCashSalesTotal(Number(payload.summary.cashCollected || 0));
      setExpectedCashAmount(
        Number(openingCash || 0) + Number(payload.summary.cashCollected || 0) - Number(payload.summary.activeDeductionsTotal || 0)
      );
    } catch (error) {
      console.error("Failed loading close-register summary", error);
      const shiftCashSales = await getShiftCashSalesTotal();
      const expected = Number(openingCash || 0) + shiftCashSales;
      setCashSalesTotal(shiftCashSales);
      setExpectedCashAmount(expected);
    } finally {
      setIsLoadingCashSummary(false);
    }
  }

  async function saveCashDeduction() {
    if (!activeClinic?.id || !registerSessionId) {
      alert("Open the register first.");
      return;
    }
    if (isSavingCashDeduction) return;

    const parsedAmount = parseMoneyInput(cashDeductionAmountInput);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      alert("Enter a valid deduction amount greater than zero.");
      return;
    }
    if (!cashDeductionDescription.trim()) {
      alert("Description / reason is required.");
      return;
    }
    if (cashDeductionType === "commission" && !cashDeductionStaffId) {
      alert("Select the staff member receiving this commission.");
      return;
    }
    setIsSavingCashDeduction(true);
    try {
      const url = cashDeductionModalMode === "edit" && editingCashDeductionId
        ? `/api/cash-deductions/${editingCashDeductionId}`
        : "/api/cash-deductions";
      const method = cashDeductionModalMode === "edit" ? "PATCH" : "POST";
      const response = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          registerSessionId,
          type: cashDeductionType,
          staffId: cashDeductionType === "commission" ? cashDeductionStaffId : null,
          paidToName: cashDeductionType === "commission"
            ? clinicCommissionStaff.find((doctor) => doctor.id === cashDeductionStaffId)?.name || ""
            : cashDeductionDescription.trim(),
          amount: parsedAmount,
          description: cashDeductionDescription.trim(),
          referenceNumber: cashDeductionReferenceInput.trim(),
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || "Failed saving cash deduction.");
      }

      setCashDeductions((payload?.entries || []) as CashDeduction[]);
      if (payload?.summary) {
        setCashDeductionSummary(payload.summary);
        setCashSalesTotal(Number(payload.summary.cashCollected || 0));
      }
      pushSuccessToast(
        cashDeductionType === "commission"
          ? cashDeductionModalMode === "edit" ? "Commission updated" : "Commission saved"
          : cashDeductionModalMode === "edit" ? "Expense updated" : "Expense saved"
      );
      setShowCashDeductionModal(false);
      resetCashDeductionForm();
    } catch (error) {
      alert(error instanceof Error ? error.message : "Failed saving cash deduction.");
    } finally {
      setIsSavingCashDeduction(false);
    }
  }

  async function voidCashDeduction() {
    if (!voidCashDeductionId) {
      return;
    }
    if (!voidCashDeductionReason.trim()) {
      alert("Enter a reason for voiding this entry.");
      return;
    }
    if (isVoidingCashDeduction) return;

    setIsVoidingCashDeduction(true);
    try {
      const response = await fetch(`/api/cash-deductions/${voidCashDeductionId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          operation: "void",
          voidReason: voidCashDeductionReason.trim(),
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || "Failed voiding cash deduction.");
      }
      setCashDeductions((payload?.entries || []) as CashDeduction[]);
      if (payload?.summary) {
        setCashDeductionSummary(payload.summary);
        setCashSalesTotal(Number(payload.summary.cashCollected || 0));
      }
      setShowVoidCashDeductionModal(false);
      setVoidCashDeductionId("");
      setVoidCashDeductionReason("");
    } catch (error) {
      alert(error instanceof Error ? error.message : "Failed voiding cash deduction.");
    } finally {
      setIsVoidingCashDeduction(false);
    }
  }

  async function downloadDailyIncomeReport() {
    if (!activeClinic?.id) {
      alert("No active clinic found for this register.");
      return;
    }

    const now = new Date();
    const { startUtcIso, endUtcIso } = getDubaiDayUtcRange(now);

    const { data: clinicReceptionists, error: receptionistsError } = await supabase
      .from("receptionist")
      .select("id, name")
      .eq("clinic_id", activeClinic.id);

    if (receptionistsError) {
      console.error("Failed loading clinic receptionists", receptionistsError);
      alert("Could not prepare report. Please try again.");
      return;
    }

    const receptionistRows = clinicReceptionists || [];
    const receptionistIds = receptionistRows.map((r) => r.id).filter(Boolean);

    if (receptionistIds.length === 0) {
      alert("No receptionists assigned to this clinic.");
      return;
    }

    // select("*") so the report keeps working whether or not optional columns
    // (amount_paid, credit_applied) exist in the live database.
    const { data: receiptsData, error: receiptsError } = await supabase
      .from("receipts")
      .select("*")
      .in("receptionist_id", receptionistIds)
      .gte("created_at", startUtcIso)
      .lte("created_at", endUtcIso)
      .order("created_at", { ascending: true });

    if (receiptsError) {
      console.error("Failed loading receipts for report", receiptsError);
      alert("Could not load receipts for this report.");
      return;
    }

    const receipts = receiptsData || [];
    const receiptIds = receipts.map((r) => r.id).filter(Boolean);
    let paymentRecordsForDay: PaymentRecord[] = [];
    let paymentAllocationsForDay: PaymentAllocation[] = [];
    let paymentAllocationRefundsForDay: PaymentAllocationRefund[] = [];
    const paymentRecordsByReceiptId = new Map<string, PaymentRecord[]>();
    const paymentAllocationsByReceiptId = new Map<string, PaymentAllocation[]>();

    const { data: paymentRecordsData, error: paymentRecordsError } = await supabase
      .from("payment_records")
      .select("*")
      .eq("clinic_id", activeClinic.id)
      .gte("created_at", startUtcIso)
      .lte("created_at", endUtcIso)
      .order("created_at", { ascending: true });
    if (paymentRecordsError) {
      console.warn("Failed loading payment records for report", paymentRecordsError);
    } else {
      paymentRecordsForDay = (paymentRecordsData || []) as PaymentRecord[];
      paymentRecordsForDay.forEach((row) => {
        const key = String(row.receipt_id || "");
        if (!key) return;
        if (!paymentRecordsByReceiptId.has(key)) paymentRecordsByReceiptId.set(key, []);
        paymentRecordsByReceiptId.get(key)?.push(row);
      });
      const paymentRecordIds = paymentRecordsForDay.map((row) => row.id);
      if (paymentRecordIds.length > 0) {
        const [allocRes, refundRes] = await Promise.all([
          supabase.from("payment_allocations").select("*").in("payment_id", paymentRecordIds),
          supabase.from("payment_allocation_refunds").select("*").in("payment_id", paymentRecordIds),
        ]);
        if (allocRes.error) {
          console.warn("Failed loading payment allocations for report", allocRes.error);
        } else {
          paymentAllocationsForDay = (allocRes.data || []) as PaymentAllocation[];
          const receiptIdByPaymentId = new Map<string, string>();
          paymentRecordsForDay.forEach((row) => {
            const paymentId = String(row.id || "");
            const receiptId = String(row.receipt_id || "");
            if (paymentId && receiptId) receiptIdByPaymentId.set(paymentId, receiptId);
          });
          paymentAllocationsForDay.forEach((row) => {
            const receiptId = receiptIdByPaymentId.get(String(row.payment_id || ""));
            if (!receiptId) return;
            if (!paymentAllocationsByReceiptId.has(receiptId)) paymentAllocationsByReceiptId.set(receiptId, []);
            paymentAllocationsByReceiptId.get(receiptId)?.push(row);
          });
        }
        if (refundRes.error) {
          console.warn("Failed loading allocation refunds for report", refundRes.error);
        } else {
          paymentAllocationRefundsForDay = (refundRes.data || []) as PaymentAllocationRefund[];
        }
      }
    }
    const patientIds = [...new Set(receipts.map((r) => r.patient_id).filter(Boolean))];
    const doctorIds = [...new Set(receipts.map((r) => r.doctor_id).filter(Boolean))];
    const patientMap = new Map<string, { 
      name: string;
      phone: string;
      nationality: string;
      date_of_birth: string;
      patient_number: string;
    }>();
    const doctorMap = new Map<string, string>();

    if (patientIds.length > 0) {
      const { data: patientsData, error: patientsError } = await supabase
        .from("patients")
        .select("id, name, phone, nationality, date_of_birth, patient_number")
        .in("id", patientIds);

      if (patientsError) {
        console.error("Failed loading patients for report", patientsError);
        alert("Could not load patient details for this report.");
        return;
      }

      (patientsData || []).forEach((patient) => {
        patientMap.set(String(patient.id), {
          name: String(patient.name || ""),
          phone: String(patient.phone || ""),
          nationality: String(patient.nationality || ""),
          date_of_birth: patient.date_of_birth ? new Date(patient.date_of_birth).toLocaleDateString("en-GB") : "",
          patient_number: patient.patient_number ? String(patient.patient_number) : "",
        });
      });
    }

    if (doctorIds.length > 0) {
      const { data: doctorsData, error: doctorsError } = await supabase
        .from("doctors")
        .select("id, name")
        .in("id", doctorIds);

      if (doctorsError) {
        console.error("Failed loading doctors for report", doctorsError);
      } else {
        (doctorsData || []).forEach((doctor) => {
          doctorMap.set(String(doctor.id), String(doctor.name || ""));
        });
      }
    }

    const treatmentMap = new Map<string, string[]>();
    if (receiptIds.length > 0) {
      const { data: receiptItemsData, error: receiptItemsError } = await supabase
        .from("receipt_items")
        .select("receipt_id, service_id, quantity")
        .in("receipt_id", receiptIds);

      if (receiptItemsError) {
        console.error("Failed loading receipt items for report", receiptItemsError);
      } else {
        const serviceIds = [...new Set((receiptItemsData || []).map((item) => item.service_id).filter(Boolean))];
        const serviceNameMap = new Map<string, string>();

        if (serviceIds.length > 0) {
          const { data: servicesData, error: servicesError } = await supabase
            .from("services")
            .select("id, name")
            .in("id", serviceIds);

          if (servicesError) {
            console.error("Failed loading services for report", servicesError);
          } else {
            (servicesData || []).forEach((service) => {
              serviceNameMap.set(String(service.id), String(service.name || ""));
            });
          }
        }

        (receiptItemsData || []).forEach((item) => {
          const receiptId = String(item.receipt_id || "");
          const serviceName = serviceNameMap.get(String(item.service_id || "")) || "";
          if (!receiptId || !serviceName) {
            return;
          }
          const qty = Math.max(1, Number(item.quantity || 1));
          const serviceLabel = qty > 1 ? `${serviceName} x${qty}` : serviceName;

          if (!treatmentMap.has(receiptId)) {
            treatmentMap.set(receiptId, []);
          }

          treatmentMap.get(receiptId)?.push(serviceLabel);
        });
      }
    }
    const refundMap = new Map<string, number>();
    const refundMethodTotals = {
      cash: 0,
      card: 0,
      tabby: 0,
      tabbyCard: 0,
      tamara: 0,
      bankTransfer: 0,
      insurance: 0,
      legacyUnallocated: 0,
    };
    const todaysSalesRefundTotal = { amount: 0 };
    const previousSalesRefundTotal = { amount: 0 };
    const refundReceiptIds = new Set<string>();
    const modernRefundIds = new Set<string>();
    const allocationById = new Map<string, PaymentAllocation>();
    paymentAllocationsForDay.forEach((allocation) => {
      allocationById.set(String(allocation.id || ""), allocation);
    });

    paymentAllocationRefundsForDay.forEach((refund) => {
      const refundId = String(refund.refund_id || "");
      const receiptId = String(refund.receipt_id || "");
      if (refundId) {
        modernRefundIds.add(refundId);
      }
      if (receiptId) {
        refundReceiptIds.add(receiptId);
      }
      const refundAmount = Number(refund.total_returned_amount || 0);
      const current = refundMap.get(receiptId) || 0;
      refundMap.set(receiptId, current + refundAmount);
      const allocation = allocationById.get(String(refund.payment_allocation_id || ""));
      const methodBucket = allocation?.method_variant === "cash"
        ? "cash"
        : allocation?.method_variant === "card"
          ? "card"
          : allocation?.method_variant === "tabby_standard"
            ? "tabby"
            : allocation?.method_variant === "tabby_card"
              ? "tabbyCard"
              : allocation?.method_variant === "tamara"
                ? "tamara"
                : "legacyUnallocated";
      refundMethodTotals[methodBucket as keyof typeof refundMethodTotals] += refundAmount;
    });

    const legacyRefundsForDay: Array<{ refund_id: string; receipt_id: string; total_amount: number; created_at: string | null }> = [];
    if (receiptIds.length > 0) {
      const { data: refundsData, error: refundsError } = await supabase
        .from("refunds")
        .select("id, receipt_id, total_amount, created_at")
        .in("receipt_id", receiptIds)
        .gte("created_at", startUtcIso)
        .lte("created_at", endUtcIso);

      if (refundsError) {
        console.error("Failed loading refunds for report", refundsError);
      } else {
        (refundsData || []).forEach((refund) => {
          const refundId = String(refund.id || "");
          const receiptId = String(refund.receipt_id || "");
          if (!receiptId || modernRefundIds.has(refundId)) return;
          refundReceiptIds.add(receiptId);
          const refundAmount = Number(refund.total_amount || 0);
          if (!refundAmount) return;
          legacyRefundsForDay.push({
            refund_id: refundId,
            receipt_id: receiptId,
            total_amount: refundAmount,
            created_at: refund.created_at || null,
          });
          const current = refundMap.get(receiptId) || 0;
          refundMap.set(receiptId, current + refundAmount);
          refundMethodTotals.legacyUnallocated += refundAmount;
        });
      }
    }

    if (refundReceiptIds.size > 0) {
      const { data: refundReceiptRows, error: refundReceiptError } = await supabase
        .from("receipts")
        .select("id, created_at")
        .in("id", [...refundReceiptIds]);
      if (refundReceiptError) {
        console.warn("Failed loading refund receipt metadata", refundReceiptError);
      } else {
        const refundReceiptMap = new Map<string, { created_at: string | null }>();
        (refundReceiptRows || []).forEach((receipt) => {
          refundReceiptMap.set(String(receipt.id), receipt);
        });

        paymentAllocationRefundsForDay.forEach((refund) => {
          const receiptId = String(refund.receipt_id || "");
          const receiptRecord = refundReceiptMap.get(receiptId);
          const refundAmount = Number(refund.total_returned_amount || 0);
          if (!refundAmount) return;
          const isTodaySalesRefund = receiptRecord?.created_at
            ? getBusinessDayKeyForReporting(receiptRecord.created_at) === getBusinessDayKeyForReporting(now)
            : false;
          if (isTodaySalesRefund) {
            todaysSalesRefundTotal.amount += refundAmount;
          } else {
            previousSalesRefundTotal.amount += refundAmount;
          }
        });

        legacyRefundsForDay.forEach((refund) => {
          const receiptRecord = refundReceiptMap.get(refund.receipt_id);
          const isTodaySalesRefund = receiptRecord?.created_at
            ? getBusinessDayKeyForReporting(receiptRecord.created_at) === getBusinessDayKeyForReporting(now)
            : false;
          if (isTodaySalesRefund) {
            todaysSalesRefundTotal.amount += refund.total_amount;
          } else {
            previousSalesRefundTotal.amount += refund.total_amount;
          }
        });
      }
    }

    // Payments collected today against old outstanding balances — reported
    // separately from treatment revenue.
    let balanceCollectionsTotal = 0;
    let cashBalanceCollectionsTotal = 0;
    const { data: balancePaymentsData, error: balancePaymentsError } = await supabase
      .from("balance_payments")
      .select("amount, payment_method")
      .in("receptionist_id", receptionistIds)
      .gte("created_at", startUtcIso)
      .lte("created_at", endUtcIso);
    if (balancePaymentsError) {
      console.warn("Failed loading balance payments for report", balancePaymentsError);
    } else {
      balanceCollectionsTotal = (balancePaymentsData || []).reduce((s, p) => s + Number(p.amount || 0), 0);
      cashBalanceCollectionsTotal = (balancePaymentsData || []).reduce(
        (sum, payment) => sum + extractLegacyCashAmount(String(payment.payment_method || ""), Number(payment.amount || 0)),
        0
      );
    }

    // Deposits (advance payments) received today — also separate from
    // treatment revenue; they are money held on patients' accounts.
    let depositsReceivedTotal = 0;
    let cashDepositsReceivedTotal = 0;
    const { data: depositsData, error: depositsError } = await supabase
      .from("patient_credits")
      .select("amount, payment_method")
      .in("receptionist_id", receptionistIds)
      .gt("amount", 0)
      .gte("created_at", startUtcIso)
      .lte("created_at", endUtcIso);
    if (depositsError) {
      console.warn("Failed loading patient deposits for report", depositsError);
    } else {
      depositsReceivedTotal = (depositsData || []).reduce((s, p) => s + Number(p.amount || 0), 0);
      cashDepositsReceivedTotal = (depositsData || []).reduce(
        (sum, deposit) => sum + extractLegacyCashAmount(String(deposit.payment_method || ""), Number(deposit.amount || 0)),
        0
      );
    }

    let activeCashDeductions: CashDeduction[] = [];
    const reportBusinessDate = getDubaiBusinessDate(now);
    const { data: cashDeductionData, error: cashDeductionError } = await supabase
      .from("cash_deductions")
      .select("*")
      .eq("clinic_id", activeClinic.id)
      .eq("business_date", reportBusinessDate)
      .eq("status", "active")
      .order("created_at", { ascending: true });
    if (cashDeductionError && cashDeductionError.code !== "42P01") {
      console.warn("Failed loading cash deductions for report", cashDeductionError);
    } else {
      activeCashDeductions = (cashDeductionData || []) as CashDeduction[];
    }

    const treatmentPlanRows: Array<(string | number)[]> = [];
    const treatmentPlanPaymentSummaries: Array<{
      methodVariant: PaymentMethodVariant;
      invoiceAllocated: number;
      feeAmount: number;
      customerChargedAmount: number;
      allocationCount: number;
    }> = [];
    const treatmentPlansById = new Map<string, any>();
    const treatmentPlanVisitCounts = new Map<string, number>();
    const treatmentPlanPaidToDate = new Map<string, number>();
    const relevantTreatmentPlanIds = new Set<string>();
    let treatmentPlanTabbyFeeTotal = 0;
    let treatmentPlanTamaraFeeTotal = 0;
    let treatmentPlanPaymentRecordsForDay: Array<(TreatmentPlanPaymentRecord & { treatment_plans?: any; patients?: any })> = [];
    let treatmentPlanPaymentAllocationsForDay: TreatmentPlanPaymentAllocation[] = [];
    const treatmentPlanAllocationsByPaymentId = new Map<string, TreatmentPlanPaymentAllocation[]>();

    const { data: treatmentPlansCreatedData, error: treatmentPlansCreatedError } = await supabase
      .from("treatment_plans")
      .select("id, patient_id, clinic_patient_file_id, title, total_amount, planned_visits, status, notes, created_at, completed_at, patients(name, patient_number)")
      .eq("clinic_id", activeClinic.id)
      .gte("created_at", startUtcIso)
      .lte("created_at", endUtcIso)
      .order("created_at", { ascending: true });
    if (treatmentPlansCreatedError) {
      console.warn("Failed loading treatment plans created today", treatmentPlansCreatedError);
    } else {
      (treatmentPlansCreatedData || []).forEach((plan: any) => {
        treatmentPlansById.set(String(plan.id), plan);
        relevantTreatmentPlanIds.add(String(plan.id));
      });
    }

    const { data: treatmentPlanVisitsTodayData, error: treatmentPlanVisitsTodayError } = await supabase
      .from("treatment_plan_visits")
      .select("treatment_plan_id")
      .in("receptionist_id", receptionistIds)
      .gte("created_at", startUtcIso)
      .lte("created_at", endUtcIso);
    if (treatmentPlanVisitsTodayError) {
      console.warn("Failed loading treatment plan visits today", treatmentPlanVisitsTodayError);
    } else {
      (treatmentPlanVisitsTodayData || []).forEach((visit: any) => {
        const planId = String(visit.treatment_plan_id || "");
        if (planId) relevantTreatmentPlanIds.add(planId);
      });
    }

    // Payments collected against multi-visit treatment plans today. These are
    // real cash/card collections, but the full plan price must not be counted
    // again on every visit.
    let treatmentPlanCollectionsTotal = 0;
    let treatmentPlanInitialSalesTotal = 0;
    const { data: treatmentPlanPaymentRecordsData, error: treatmentPlanPaymentRecordsError } = await supabase
      .from("treatment_plan_payment_records")
      .select("id, treatment_plan_id, patient_id, clinic_id, receptionist_id, register_session_id, total_invoice_amount_settled, total_vat_amount, total_payment_fee_amount, total_customer_charged_amount, payment_method_summary, is_split, status, created_by, legacy_treatment_plan_payment_id, created_at, updated_at, treatment_plans(created_at, clinic_patient_file_id, title, total_amount, planned_visits, status), patients(name, patient_number)")
      .eq("clinic_id", activeClinic.id)
      .gte("created_at", startUtcIso)
      .lte("created_at", endUtcIso)
      .order("created_at", { ascending: true });
    if (treatmentPlanPaymentRecordsError) {
      console.warn("Failed loading treatment plan payment records for report", treatmentPlanPaymentRecordsError);
    } else {
      treatmentPlanPaymentRecordsForDay = (treatmentPlanPaymentRecordsData || []) as Array<(TreatmentPlanPaymentRecord & { treatment_plans?: any; patients?: any })>;
      treatmentPlanCollectionsTotal = treatmentPlanPaymentRecordsForDay.reduce((sum, payment) => sum + Number(payment.total_customer_charged_amount || 0), 0);
      treatmentPlanPaymentRecordsForDay.forEach((payment) => {
        const planId = String(payment.treatment_plan_id || "");
        if (planId) relevantTreatmentPlanIds.add(planId);
      });

      const treatmentPlanPaymentRecordIds = treatmentPlanPaymentRecordsForDay.map((payment) => payment.id).filter(Boolean);
      if (treatmentPlanPaymentRecordIds.length > 0) {
        const { data: treatmentPlanPaymentAllocationsData, error: treatmentPlanPaymentAllocationsError } = await supabase
          .from("treatment_plan_payment_allocations")
          .select("*")
          .in("payment_id", treatmentPlanPaymentRecordIds);
        if (treatmentPlanPaymentAllocationsError) {
          console.warn("Failed loading treatment plan payment allocations for report", treatmentPlanPaymentAllocationsError);
        } else {
          treatmentPlanPaymentAllocationsForDay = (treatmentPlanPaymentAllocationsData || []) as TreatmentPlanPaymentAllocation[];
          treatmentPlanPaymentAllocationsForDay.forEach((allocation) => {
            const paymentId = String(allocation.payment_id || "");
            if (!paymentId) return;
            if (!treatmentPlanAllocationsByPaymentId.has(paymentId)) treatmentPlanAllocationsByPaymentId.set(paymentId, []);
            treatmentPlanAllocationsByPaymentId.get(paymentId)?.push(allocation);
          });
        }
      }
    }

    if (relevantTreatmentPlanIds.size > 0) {
      const planIds = [...relevantTreatmentPlanIds];
      const missingPlanIds = planIds.filter((planId) => !treatmentPlansById.has(planId));

      if (missingPlanIds.length > 0) {
        const { data: missingPlansData, error: missingPlansError } = await supabase
          .from("treatment_plans")
          .select("id, patient_id, clinic_patient_file_id, title, total_amount, planned_visits, status, notes, created_at, completed_at, patients(name, patient_number)")
          .eq("clinic_id", activeClinic.id)
          .in("id", missingPlanIds)
          .order("created_at", { ascending: true });
        if (missingPlansError) {
          console.warn("Failed loading treatment plan details for report", missingPlansError);
        } else {
          (missingPlansData || []).forEach((plan: any) => {
            treatmentPlansById.set(String(plan.id), plan);
          });
        }
      }

      const [allPlanPaymentsResult, allPlanVisitsResult] = await Promise.all([
        supabase
          .from("treatment_plan_payment_records")
          .select("treatment_plan_id, total_invoice_amount_settled, created_at")
          .in("treatment_plan_id", planIds)
          .lte("created_at", endUtcIso),
        supabase
          .from("treatment_plan_visits")
          .select("treatment_plan_id")
          .in("treatment_plan_id", planIds),
      ]);

      if (!allPlanPaymentsResult.error) {
        (allPlanPaymentsResult.data || []).forEach((payment: any) => {
          const planId = String(payment.treatment_plan_id || "");
          treatmentPlanPaidToDate.set(planId, (treatmentPlanPaidToDate.get(planId) || 0) + Number(payment.total_invoice_amount_settled || 0));
        });
      }
      if (!allPlanVisitsResult.error) {
        (allPlanVisitsResult.data || []).forEach((visit: any) => {
          const planId = String(visit.treatment_plan_id || "");
          treatmentPlanVisitCounts.set(planId, (treatmentPlanVisitCounts.get(planId) || 0) + 1);
        });
      }

      [...treatmentPlansById.values()].forEach((plan: any) => {
        const patient = Array.isArray(plan.patients) ? plan.patients[0] : plan.patients;
        const planId = String(plan.id || "");
        const totalAmount = Number(plan.total_amount || 0);
        const paidToDate = treatmentPlanPaidToDate.get(planId) || 0;
        const completedVisits = Math.max(
          treatmentPlanVisitCounts.get(planId) || 0,
          plan?.clinic_patient_file_id ? 1 : 0
        );
        treatmentPlanRows.push([
          new Date(plan.created_at || now).toLocaleTimeString("en-US", {
            timeZone: "Asia/Dubai",
            hour: "2-digit",
            minute: "2-digit",
            hour12: true,
          }),
          patient?.name || "",
          patient?.patient_number ? String(patient.patient_number) : "",
          plan.title || "Treatment Plan",
          plan.status || "",
          totalAmount,
          paidToDate,
          Math.max(0, totalAmount - paidToDate),
          `${completedVisits} / ${Number(plan.planned_visits || 1)}`,
          plan.notes || "",
        ]);
      });
    }

    const treatmentPlanPaymentRows: Array<(string | number)[]> = [];
    let grossRevenue = 0;
    let totalDiscounts = 0;
    let regularTreatmentValueTotal = 0;
    let regularInvoiceValueTotal = 0;
    let totalVat = 0;
    let totalRefunds = 0;
    let regularPatientPaymentsTotal = 0;
    let creditUsedTotal = 0;
    let outstandingCreatedTotal = 0;
    let cashTotal = 0;
    let cardTotal = 0;
    let tabbyTotal = 0;
    let tabbyCardTotal = 0;
    let tabbyFeeTotal = 0;
    let tamaraTotal = 0;
    let tamaraFeeTotal = 0;
    let insuranceTotal = 0;
    let bankTransferTotal = 0;
    let legacyUnallocatedTotal = 0;
    let tabbyInvoiceAllocationTotal = 0;
    let tabbyCardInvoiceAllocationTotal = 0;
    let tamaraInvoiceAllocationTotal = 0;
    let tabbySurchargeCollectedTotal = 0;
    let tabbyCardSurchargeCollectedTotal = 0;
    let tamaraSurchargeCollectedTotal = 0;
    let cashTreatmentPlanCollectionsTotal = 0;
    treatmentPlanPaymentRecordsForDay.forEach((payment) => {
      const plan = Array.isArray(payment.treatment_plans) ? payment.treatment_plans[0] : payment.treatment_plans;
      const patient = Array.isArray(payment.patients) ? payment.patients[0] : payment.patients;
      const planId = String(payment.treatment_plan_id || "");
      const totalAmount = Number(plan?.total_amount || 0);
      const invoiceSettled = Number(payment.total_invoice_amount_settled || 0);
      const paidAfterToday = treatmentPlanPaidToDate.get(planId) || invoiceSettled;
      const remainingAfterToday = Math.max(0, totalAmount - paidAfterToday);
      const paymentAllocations = treatmentPlanAllocationsByPaymentId.get(String(payment.id || "")) || [];
      const allocationNotes = paymentAllocations
        .map((allocation) => {
          const label = paymentVariantLabel(allocation.method_variant as PaymentMethodVariant);
          const fee = Number(allocation.fee_amount || 0);
          const charged = Number(allocation.customer_charged_amount || 0);
          return `${label}: Invoice AED ${Number(allocation.invoice_allocation_amount || 0).toFixed(2)}${fee > 0 ? ` | Fee AED ${fee.toFixed(2)}` : ""} | Charged AED ${charged.toFixed(2)}`;
        })
        .join(" || ");

      const structuredCashCollection = paymentAllocations.reduce((sum, allocation) => {
        if (allocation.method_variant !== "cash") return sum;
        return sum + Number(allocation.customer_charged_amount || 0);
      }, 0);
      const fallbackCashCollection = paymentAllocations.length === 0
        ? extractLegacyCashAmount(String(payment.payment_method_summary || ""), Number(payment.total_customer_charged_amount || 0))
        : 0;
      cashTreatmentPlanCollectionsTotal += structuredCashCollection + fallbackCashCollection;

      const planCreatedBusinessDate = plan?.created_at ? getBusinessDayKeyForReporting(plan.created_at) : null;
      const paymentBusinessDate = getBusinessDayKeyForReporting(payment.created_at || now);
      const isInitialSalePayment = Boolean(planCreatedBusinessDate && planCreatedBusinessDate === paymentBusinessDate);
      if (isInitialSalePayment) {
        treatmentPlanInitialSalesTotal += Number(payment.total_invoice_amount_settled || 0);
      }

      paymentAllocations.forEach((allocation) => {
        const feeAmount = Number(allocation.fee_amount || 0);
        const customerChargedAmount = Number(allocation.customer_charged_amount || 0);
        const invoiceAllocationAmount = Number(allocation.invoice_allocation_amount || 0);
        if (allocation.method_variant === "cash") {
          cashTotal += customerChargedAmount;
        } else if (allocation.method_variant === "card") {
          cardTotal += customerChargedAmount;
        } else if (allocation.method_variant === "tabby_standard") {
          tabbyTotal += customerChargedAmount;
          tabbyFeeTotal += feeAmount;
          tabbyInvoiceAllocationTotal += invoiceAllocationAmount;
          tabbySurchargeCollectedTotal += feeAmount;
        } else if (allocation.method_variant === "tabby_card") {
          tabbyCardTotal += customerChargedAmount;
          tabbyCardInvoiceAllocationTotal += invoiceAllocationAmount;
          tabbyCardSurchargeCollectedTotal += feeAmount;
        } else if (allocation.method_variant === "tamara") {
          tamaraTotal += customerChargedAmount;
          tamaraFeeTotal += feeAmount;
          tamaraInvoiceAllocationTotal += invoiceAllocationAmount;
          tamaraSurchargeCollectedTotal += feeAmount;
        } else {
          legacyUnallocatedTotal += customerChargedAmount;
        }
        treatmentPlanPaymentSummaries.push({
          methodVariant: allocation.method_variant as PaymentMethodVariant,
          invoiceAllocated: Number(allocation.invoice_allocation_amount || 0),
          feeAmount,
          customerChargedAmount,
          allocationCount: 1,
        });
      });

      const completedVisits = Math.max(
        treatmentPlanVisitCounts.get(planId) || 0,
        plan?.clinic_patient_file_id ? 1 : 0
      );
      treatmentPlanPaymentRows.push([
        new Date(payment.created_at || now).toLocaleTimeString("en-US", {
          timeZone: "Asia/Dubai",
          hour: "2-digit",
          minute: "2-digit",
          hour12: true,
        }),
        patient?.name || "",
        patient?.patient_number ? String(patient.patient_number) : "",
        plan?.title || "Treatment Plan",
        totalAmount,
        invoiceSettled,
        paidAfterToday,
        remainingAfterToday,
        `${completedVisits} / ${Number(plan?.planned_visits || 1)}`,
        payment.payment_method_summary || "",
        allocationNotes,
      ]);
    });

    const detailHeaders = [
      "Time",
      "Receipt Number",
      "Patient Name",
      "Nationality",
      "Patient ID Number",
      "Birthdate",
      "Dentist",
      "Treatments Performed",
      "Gross Total",
      "Promo / Discount",
      "Net Total",
      "VAT",
      "Cash",
      "Card",
      "Card Transaction Reference",
      "Tabby",
      "Tabby Transaction Reference",
      "Tabby Card",
      "Tabby Fee",
      "Tamara",
      "Tamara Transaction Reference",
      "Tamara Fee",
      "Insurance",
      "Refund Amount",
      "Payment Method",
      "Paid Today",
      "Credit Used",
      "Outstanding",
    ];

    const detailRows: Array<(string | number)[]> = [];

    receipts.forEach((receipt) => {
      const receiptId = String(receipt.id || "");
      const structuredPaymentAllocations = paymentAllocationsByReceiptId.get(receiptId) || [];
      const structuredPaymentRecords = paymentRecordsByReceiptId.get(receiptId) || [];
      const structuredPaymentSummary = structuredPaymentAllocations.length > 0
        ? summarizeStoredAllocationRows(structuredPaymentAllocations)
        : null;
      const createdAt = new Date(receipt.created_at || now);
      const patientInfo = patientMap.get(String(receipt.patient_id || ""));
      const doctorName = doctorMap.get(String(receipt.doctor_id || "")) || "";
      const paymentMethodRaw = String(receipt.payment_method || "");
      const discountAmount = Number(receipt.discount_amount || 0);
      const netTotal = Number(receipt.total || 0);
      const vatAmount = Number(receipt.vat || 0);
      const grossTotal = Number(receipt.subtotal || 0);
      const regularTreatmentValue = grossTotal - discountAmount;
      const regularInvoiceValue = regularTreatmentValue + vatAmount;
      const refundAmount = Number(refundMap.get(receiptId) || 0);
      // NULL amount_paid = paid in full; the breakdown reflects money actually received.
      const paidToday = Number(receipt.amount_paid ?? receipt.total ?? 0);
      const gatewayFee = Number(receipt.gateway_fee || 0);
      const gatewayProvider = String(receipt.gateway_fee_provider || getInstallmentFeeProvider(paymentMethodRaw) || "").toLowerCase();
      // Prepaid patient credit covering part of the invoice — not money
      // received today and not outstanding either.
      const creditUsed = Number(receipt.credit_applied || 0);
      const invoiceSettled = structuredPaymentRecords.length > 0
        ? structuredPaymentRecords.reduce((sum, row) => sum + Number(row.total_invoice_amount_settled || 0), 0)
        : Math.max(0, Math.min(netTotal, Number(receipt.amount_paid ?? receipt.total ?? 0)));
      const outstandingCreated = Math.max(0, truncateCurrency(netTotal - invoiceSettled - creditUsed));
      const receiptCollectionAmount = structuredPaymentRecords.reduce(
        (sum, row) => sum + Number(row.total_customer_charged_amount || 0),
        0
      ) || Math.max(0, Number(receipt.amount_paid ?? receipt.total ?? 0));
      const structuredCollectionSummary = structuredPaymentAllocations.length > 0
        ? summarizeStoredAllocationCollectionsForReporting(structuredPaymentAllocations)
        : null;
      const breakdown = structuredPaymentAllocations.length > 0
        ? {
            cash: structuredCollectionSummary?.cash || 0,
            card: structuredCollectionSummary?.card || 0,
            tabby: structuredCollectionSummary?.tabby || 0,
            tabbyCard: structuredCollectionSummary?.tabbyCard || 0,
            tamara: structuredCollectionSummary?.tamara || 0,
            insurance: 0,
            bankTransfer: 0,
            legacyUnallocated: structuredCollectionSummary?.legacyUnallocated || 0,
            mop: structuredPaymentAllocations.length > 1 ? "SPLIT" : "STRUCTURED",
          }
        : getPaymentBreakdown(paymentMethodRaw, Math.max(0, receiptCollectionAmount));
      const tabbyFee = structuredPaymentSummary
        ? structuredPaymentSummary.tabbyFee
        : (gatewayProvider.includes("tabby") ? gatewayFee : 0);
      const tabbyCardFee = structuredPaymentSummary
        ? structuredPaymentSummary.tabbyCardFee
        : (gatewayProvider.includes("tabby card") ? gatewayFee : 0);
      const tamaraFee = structuredPaymentSummary ? structuredPaymentSummary.tamaraFee : (gatewayProvider.includes("tamara") ? gatewayFee : 0);
      const cardReference = structuredPaymentSummary?.references.card || extractTransactionReference(paymentMethodRaw, "card");
      const tabbyReference = structuredPaymentSummary?.references.tabby || extractTransactionReference(paymentMethodRaw, "tabby");
      const tamaraReference = structuredPaymentSummary?.references.tamara || extractTransactionReference(paymentMethodRaw, "tamara");

      grossRevenue += grossTotal;
      totalDiscounts += discountAmount;
      regularTreatmentValueTotal += regularTreatmentValue;
      regularInvoiceValueTotal += regularInvoiceValue;
      totalVat += vatAmount;
      totalRefunds += refundAmount;
      regularPatientPaymentsTotal += receiptCollectionAmount;
      creditUsedTotal += creditUsed;
      outstandingCreatedTotal += outstandingCreated;

      cashTotal += breakdown.cash;
      cardTotal += breakdown.card;
      tabbyTotal += breakdown.tabby;
      tabbyCardTotal += breakdown.tabbyCard;
      tabbyFeeTotal += structuredCollectionSummary?.tabbySurcharge || tabbyFee;
      tabbySurchargeCollectedTotal += structuredCollectionSummary?.tabbySurcharge || tabbyFee;
      tabbyCardSurchargeCollectedTotal += structuredCollectionSummary?.tabbyCardSurcharge || tabbyCardFee;
      tamaraTotal += breakdown.tamara;
      tamaraFeeTotal += structuredCollectionSummary?.tamaraSurcharge || tamaraFee;
      tamaraSurchargeCollectedTotal += structuredCollectionSummary?.tamaraSurcharge || tamaraFee;
      insuranceTotal += breakdown.insurance;
      bankTransferTotal += breakdown.bankTransfer;
      legacyUnallocatedTotal += breakdown.legacyUnallocated;
      tabbyInvoiceAllocationTotal += structuredCollectionSummary?.tabbyInvoice || 0;
      tabbyCardInvoiceAllocationTotal += structuredCollectionSummary?.tabbyCardInvoice || 0;
      tamaraInvoiceAllocationTotal += structuredCollectionSummary?.tamaraInvoice || 0;

      const treatments = (treatmentMap.get(receiptId) || []).join("\n") || "CONSULTATION";

      detailRows.push([
        createdAt.toLocaleTimeString("en-US", {
          timeZone: "Asia/Dubai",
          hour: "2-digit",
          minute: "2-digit",
          hour12: true,
        }),
        receipt.receipt_number ? String(receipt.receipt_number).padStart(5, "0") : String(receiptId).slice(0, 8),
        patientInfo?.name || "",
        patientInfo?.nationality || "",
        patientInfo?.patient_number || "",
        patientInfo?.date_of_birth || "",
        doctorName,
        treatments,
        grossTotal,
        discountAmount,
        netTotal,
        vatAmount,
        breakdown.cash,
        breakdown.card,
        cardReference,
        breakdown.tabby,
        tabbyReference,
        breakdown.tabbyCard,
        tabbyFee,
        breakdown.tamara,
        tamaraReference,
        tamaraFee,
        breakdown.insurance,
        refundAmount,
        paymentMethodRaw,
        receiptCollectionAmount,
        creditUsed,
        outstandingCreated,
      ]);
    });

    const totalMoneyCollected = regularPatientPaymentsTotal + treatmentPlanCollectionsTotal + balanceCollectionsTotal + depositsReceivedTotal;
    const grossPatientMoneyReceived = totalMoneyCollected;
    const refundsReturnedTodayTotalAmount = todaysSalesRefundTotal.amount + previousSalesRefundTotal.amount;
    const netPatientMoneyReceived = grossPatientMoneyReceived - refundsReturnedTodayTotalAmount;
    const totalCommissions = activeCashDeductions
      .filter((entry) => entry.type === "commission")
      .reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
    const totalExpenses = activeCashDeductions
      .filter((entry) => entry.type === "expense")
      .reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
    const totalCashDeductions = totalCommissions + totalExpenses;
    const cashGrossCollectedToday = cashTotal;
    const cashRefundsToday = refundMethodTotals.cash;
    const cashCollectedForDeductions = cashGrossCollectedToday;
    const cashAfterDeductions = cashGrossCollectedToday - totalCashDeductions;
    const uniquePatients = new Set(receipts.map((r) => String(r.patient_id || "")).filter(Boolean)).size;
    const birthdayDiscountTotal = receipts.reduce((sum, receipt) => sum + Number(receipt.birthday_discount_amount || 0), 0);
    const netCollectionsAfterDeductions = netPatientMoneyReceived - totalCashDeductions;
    const balanceCollectionBreakdown = (balancePaymentsData || []).reduce((summary, payment) => {
      const breakdown = getPaymentBreakdownForReporting(String(payment.payment_method || ""), Number(payment.amount || 0));
      summary.cash += breakdown.cash;
      summary.card += breakdown.card;
      summary.tabby += breakdown.tabby;
      summary.tabbyCard += breakdown.tabbyCard;
      summary.tamara += breakdown.tamara;
      summary.insurance += breakdown.insurance;
      summary.bankTransfer += breakdown.bankTransfer;
      summary.legacyUnallocated += breakdown.legacyUnallocated;
      return summary;
    }, {
      cash: 0,
      card: 0,
      tabby: 0,
      tabbyCard: 0,
      tamara: 0,
      insurance: 0,
      bankTransfer: 0,
      legacyUnallocated: 0,
    });

    const depositBreakdown = (depositsData || []).reduce((summary, deposit) => {
      const breakdown = getPaymentBreakdownForReporting(String(deposit.payment_method || ""), Number(deposit.amount || 0));
      summary.cash += breakdown.cash;
      summary.card += breakdown.card;
      summary.tabby += breakdown.tabby;
      summary.tabbyCard += breakdown.tabbyCard;
      summary.tamara += breakdown.tamara;
      summary.insurance += breakdown.insurance;
      summary.bankTransfer += breakdown.bankTransfer;
      summary.legacyUnallocated += breakdown.legacyUnallocated;
      return summary;
    }, {
      cash: 0,
      card: 0,
      tabby: 0,
      tabbyCard: 0,
      tamara: 0,
      insurance: 0,
      bankTransfer: 0,
      legacyUnallocated: 0,
    });

    cashTotal += balanceCollectionBreakdown.cash + depositBreakdown.cash;
    cardTotal += balanceCollectionBreakdown.card + depositBreakdown.card;
    tabbyTotal += balanceCollectionBreakdown.tabby + depositBreakdown.tabby;
    tabbyCardTotal += balanceCollectionBreakdown.tabbyCard + depositBreakdown.tabbyCard;
    tamaraTotal += balanceCollectionBreakdown.tamara + depositBreakdown.tamara;
    insuranceTotal += balanceCollectionBreakdown.insurance + depositBreakdown.insurance;
    bankTransferTotal += balanceCollectionBreakdown.bankTransfer + depositBreakdown.bankTransfer;
    legacyUnallocatedTotal += balanceCollectionBreakdown.legacyUnallocated + depositBreakdown.legacyUnallocated;

    const workbook = XLSX.utils.book_new();
    const normalizeReportCellValue = (value: string | number) => (
      typeof value === "number" && Number.isFinite(value) ? truncateCurrency(value) : value
    );
    const normalizeReportRows = (rows: (string | number)[][]) => rows.map((row) => row.map(normalizeReportCellValue));
    const thinBorder = {
      top: { style: "thin", color: { rgb: "D9D9D9" } },
      bottom: { style: "thin", color: { rgb: "D9D9D9" } },
      left: { style: "thin", color: { rgb: "D9D9D9" } },
      right: { style: "thin", color: { rgb: "D9D9D9" } },
    };

    const reportDateText = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Dubai",
      day: "2-digit",
      month: "long",
      year: "numeric",
    }).format(now);
    const weekdayText = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Dubai",
      weekday: "long",
    }).format(now);
    const generatedAtText = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Dubai",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    }).format(now);

    const summaryRows: (string | number)[][] = [
      ["End-of-Day Report", "", "", ""],
      ["", "", "", ""],
      ["Report Information", "", "", ""],
      ["Clinic Name", activeClinic.name, "", ""],
      ["Report Date", reportDateText, "", ""],
      ["Day of Week", weekdayText, "", ""],
      ["Generated Date & Time", generatedAtText, "", ""],
      ["", "", "", ""],
      ["TODAY'S COLLECTION SUMMARY", "", "", ""],
      ["Regular Treatment Collections", regularPatientPaymentsTotal, "", ""],
      ["Treatment Plan Collections", treatmentPlanCollectionsTotal, "", ""],
      ["Old Balance Collections", balanceCollectionsTotal, "", ""],
      ["Advance Payments / Prepayments", depositsReceivedTotal, "", ""],
      ["TOTAL MONEY COLLECTED", totalMoneyCollected, "", ""],
      ["Refunds", refundsReturnedTodayTotalAmount, "", ""],
      ["NET MONEY COLLECTED", totalMoneyCollected - refundsReturnedTodayTotalAmount, "", ""],
      ["Commissions", totalCommissions, "", ""],
      ["Expenses", totalExpenses, "", ""],
      ["FINAL COLLECTION AFTER DEDUCTIONS", netCollectionsAfterDeductions, "", ""],
      ["", "", "", ""],
      ["SALES / INVOICE", "", "", ""],
      ["Regular Treatment Invoice", regularInvoiceValueTotal, "", ""],
      ["VAT (5%) Collected Today", totalVat, "", ""],
      ["New Treatment Plan Sales", treatmentPlanInitialSalesTotal, "", ""],
      ["TOTAL INVOICE SALES", regularInvoiceValueTotal + treatmentPlanInitialSalesTotal, "", ""],
      ["", "", "", ""],
      ["DISCOUNTS / PROMOTIONS", "", "", ""],
      ["Birthday Discounts", birthdayDiscountTotal, "", ""],
      ["", "", "", ""],
      ["PAYMENT BREAKDOWN", "", "", ""],
      ["Payment Method", "Collected", "Refunds", "Net"],
      ["Cash", cashTotal, refundMethodTotals.cash, cashTotal - refundMethodTotals.cash],
      ["Card", cardTotal, refundMethodTotals.card, cardTotal - refundMethodTotals.card],
      ["Tabby", tabbyTotal, refundMethodTotals.tabby, tabbyTotal - refundMethodTotals.tabby],
      ["Tabby Card", tabbyCardTotal, refundMethodTotals.tabbyCard, tabbyCardTotal - refundMethodTotals.tabbyCard],
      ["Tamara", tamaraTotal, refundMethodTotals.tamara, tamaraTotal - refundMethodTotals.tamara],
      ["Bank Transfer", bankTransferTotal, refundMethodTotals.bankTransfer, bankTransferTotal - refundMethodTotals.bankTransfer],
      ...(legacyUnallocatedTotal !== 0 ? [["Legacy / Unallocated", legacyUnallocatedTotal, refundMethodTotals.legacyUnallocated, legacyUnallocatedTotal - refundMethodTotals.legacyUnallocated]] : []),
      ["TOTAL", cashTotal + cardTotal + tabbyTotal + tabbyCardTotal + tamaraTotal + bankTransferTotal + legacyUnallocatedTotal, refundMethodTotals.cash + refundMethodTotals.card + refundMethodTotals.tabby + refundMethodTotals.tabbyCard + refundMethodTotals.tamara + refundMethodTotals.bankTransfer + refundMethodTotals.legacyUnallocated, (cashTotal + cardTotal + tabbyTotal + tabbyCardTotal + tamaraTotal + bankTransferTotal + legacyUnallocatedTotal) - (refundMethodTotals.cash + refundMethodTotals.card + refundMethodTotals.tabby + refundMethodTotals.tabbyCard + refundMethodTotals.tamara + refundMethodTotals.bankTransfer + refundMethodTotals.legacyUnallocated)],
      ["", "", "", ""],
      ["BNPL SURCHARGES", "", "", ""],
      ...(tabbySurchargeCollectedTotal !== 0 ? [["Tabby Surcharge", tabbySurchargeCollectedTotal, "", ""]] : []),
      ...(tabbyCardSurchargeCollectedTotal !== 0 ? [["Tabby Card Surcharge", tabbyCardSurchargeCollectedTotal, "", ""]] : []),
      ...(tamaraSurchargeCollectedTotal !== 0 ? [["Tamara Surcharge", tamaraSurchargeCollectedTotal, "", ""]] : []),
      ...(tabbySurchargeCollectedTotal !== 0 || tabbyCardSurchargeCollectedTotal !== 0 || tamaraSurchargeCollectedTotal !== 0 ? [["TOTAL BNPL SURCHARGES", tabbySurchargeCollectedTotal + tabbyCardSurchargeCollectedTotal + tamaraSurchargeCollectedTotal, "", ""]] : []),
      ...(tabbySurchargeCollectedTotal !== 0 || tabbyCardSurchargeCollectedTotal !== 0 || tamaraSurchargeCollectedTotal !== 0 ? [["BNPL surcharges are included in Total Money Collected but excluded from treatment/invoice value.", "", "", ""]] : []),
      ["", "", "", ""],
      ["CASH RECONCILIATION", "", "", ""],
      ["Cash Collected", cashTotal, "", ""],
      ["Cash Refunds", refundMethodTotals.cash, "", ""],
      ["Commissions", totalCommissions, "", ""],
      ["Expenses", totalExpenses, "", ""],
      ["EXPECTED CASH AFTER DEDUCTIONS", cashTotal - refundMethodTotals.cash - totalCommissions - totalExpenses, "", ""],
      ["", "", "", ""],
      ["ACTIVITY", "", "", ""],
      ["Regular Receipts", receipts.length, "", ""],
      ["Treatment Plan Visits", treatmentPlanVisitsTodayData?.length || 0, "", ""],
      ["Treatment Plan Payments", treatmentPlanPaymentRecordsForDay.length, "", ""],
      ["Old Balance Payments", (balancePaymentsData || []).length, "", ""],
      ["Advance Payments", (depositsData || []).length, "", ""],
      ["Refund Transactions", paymentAllocationRefundsForDay.length + legacyRefundsForDay.length, "", ""],
    ];

    const summarySheet = XLSX.utils.aoa_to_sheet(normalizeReportRows(summaryRows));
    summarySheet["!cols"] = [{ wch: 36 }, { wch: 18 }, { wch: 16 }, { wch: 16 }];
    const mergeRows: number[] = summaryRows.reduce((rows: number[], row, index) => {
      const label = typeof row[0] === "string" ? row[0].toUpperCase() : "";
      if (["REPORT INFORMATION", "TODAY'S COLLECTION SUMMARY", "SALES / INVOICE", "DISCOUNTS / PROMOTIONS", "PAYMENT BREAKDOWN", "BNPL SURCHARGES", "CASH RECONCILIATION", "ACTIVITY"].includes(label)) {
        rows.push(index + 1);
      }
      return rows;
    }, []);
    summarySheet["!merges"] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 3 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: 3 } },
      ...mergeRows.filter((row) => row > 2).map((row) => ({ s: { r: row - 1, c: 0 }, e: { r: row - 1, c: 3 } })),
    ];

    const styleSummaryCell = (row: number, col: number, style: Record<string, unknown>) => {
      const ref = XLSX.utils.encode_cell({ r: row - 1, c: col - 1 });
      const cell = (summarySheet as any)[ref];
      if (!cell) return;
      cell.s = { ...(cell.s || {}), ...style };
    };

    const isSectionHeaderRow = (row: number) => {
      const cellValue = summaryRows[row - 1]?.[0];
      const label = typeof cellValue === "string" ? cellValue.toUpperCase() : "";
      return ["REPORT INFORMATION", "TODAY'S COLLECTION SUMMARY", "SALES / INVOICE", "DISCOUNTS / PROMOTIONS", "PAYMENT BREAKDOWN", "BNPL SURCHARGES", "CASH RECONCILIATION", "ACTIVITY"].includes(label);
    };

    const isSubtotalRow = (row: number) => {
      const cellValue = summaryRows[row - 1]?.[0];
      const label = typeof cellValue === "string" ? cellValue : "";
      return [
        "TOTAL MONEY COLLECTED",
        "NET MONEY COLLECTED",
        "FINAL COLLECTION AFTER DEDUCTIONS",
        "TOTAL INVOICE SALES",
        "TOTAL",
        "TOTAL BNPL SURCHARGES",
        "EXPECTED CASH AFTER DEDUCTIONS",
      ].includes(label);
    };

    for (let row = 1; row <= summaryRows.length; row++) {
      for (let col = 1; col <= 4; col++) {
        const value = summaryRows[row - 1]?.[col - 1];
        const isNumeric = typeof value === "number";
        const isNegative = isNumeric && Number(value) < 0;
        const isHeaderRow = isSectionHeaderRow(row);
        const isTotal = isSubtotalRow(row);

        styleSummaryCell(row, col, {
          border: thinBorder,
          font: {
            name: "Calibri",
            sz: 11,
            bold: isHeaderRow || isTotal,
            color: { rgb: isNegative ? "C0392B" : isHeaderRow ? "FFFFFF" : "1F2937" },
          },
          fill: isHeaderRow
            ? { fgColor: { rgb: "1F4E78" } }
            : isTotal
              ? { fgColor: { rgb: "FFF2CC" } }
              : undefined,
          alignment: {
            vertical: "center",
            horizontal: isNumeric || col >= 2 ? "right" : "left",
            wrapText: true,
          },
        });

        if (isNumeric) {
          styleSummaryCell(row, col, {
            numFmt: "#,##0.00",
            alignment: { horizontal: "right", vertical: "center" },
          });
        }
      }
    }

    styleSummaryCell(1, 1, {
      fill: { fgColor: { rgb: "0B132B" } },
      font: { name: "Calibri", sz: 16, bold: true, color: { rgb: "FFFFFF" } },
      alignment: { horizontal: "center", vertical: "center" },
    });
    for (let col = 2; col <= 4; col++) {
      styleSummaryCell(1, col, {
        fill: { fgColor: { rgb: "0B132B" } },
      });
    }

    styleSummaryCell(2, 1, {
      fill: { fgColor: { rgb: "E5E7EB" } },
      font: { name: "Calibri", sz: 13, bold: true, color: { rgb: "111827" } },
      alignment: { horizontal: "center", vertical: "center" },
    });
    for (let col = 2; col <= 4; col++) {
      styleSummaryCell(2, col, {
        fill: { fgColor: { rgb: "E5E7EB" } },
      });
    }

    styleSummaryCell(3, 1, {
      font: { name: "Calibri", sz: 11, bold: true, color: { rgb: "374151" } },
    });
    styleSummaryCell(3, 2, {
      font: { name: "Calibri", sz: 11, bold: false, color: { rgb: "374151" } },
    });
    styleSummaryCell(4, 1, {
      font: { name: "Calibri", sz: 11, bold: true, color: { rgb: "374151" } },
    });
    styleSummaryCell(4, 2, {
      font: { name: "Calibri", sz: 11, bold: false, color: { rgb: "374151" } },
    });

    const blankDetailRow = new Array(detailHeaders.length).fill("") as string[];
    const visibleDetailRows = detailRows.length > 0 ? detailRows : [blankDetailRow];
    const detailsData: (string | number)[][] = [detailHeaders, ...visibleDetailRows, new Array(detailHeaders.length).fill("") as string[]];
    const detailsSheet = XLSX.utils.aoa_to_sheet(normalizeReportRows(detailsData));
    const totalsRow = visibleDetailRows.length + 2;

    const writeCell = (address: string, value: string | number) => {
      const safeValue = normalizeReportCellValue(value);
      (detailsSheet as any)[address] = { ...(detailsSheet as any)[address], v: safeValue };
    };

    writeCell(`A${totalsRow}`, "TOTALS");

    // Store computed totals as values. Formula cells have caused Excel repairs
    // when the report has no normal receipt rows but other EOD collections exist.
    ["I", "J", "K", "L", "M", "N", "P", "R", "S", "U", "V", "W", "Y", "Z", "AA"].forEach((col) => {
      const colIndex = XLSX.utils.decode_col(col);
      const computed = detailRows.reduce((s, row) => s + Number(row[colIndex] || 0), 0);
      writeCell(`${col}${totalsRow}`, computed);
    });

    const lastDetailColumn = XLSX.utils.encode_col(detailHeaders.length - 1);
    detailsSheet["!autofilter"] = { ref: `A1:${lastDetailColumn}${totalsRow}` };
    detailsSheet["!freeze"] = { xSplit: 0, ySplit: 1 };

    const autoWidths = detailHeaders.map((header, index) => {
      let maxLength = String(header).length;
      visibleDetailRows.forEach((row) => {
        const value = row[index] == null ? "" : String(row[index]);
        const longestLine = value
          .split("\n")
          .reduce((max, part) => (part.length > max ? part.length : max), 0);
        if (longestLine > maxLength) {
          maxLength = longestLine;
        }
      });

      const padding = index === 7 || index === 23 ? 6 : 3;
      return { wch: Math.min(48, Math.max(10, maxLength + padding)) };
    });

    autoWidths[7] = { wch: 42 };
    autoWidths[14] = { wch: 26 };
    autoWidths[16] = { wch: 30 };
    autoWidths[19] = { wch: 30 };
    autoWidths[23] = { wch: 34 };
    detailsSheet["!cols"] = autoWidths;

    const styleDetailsCell = (row: number, col: number, style: Record<string, unknown>) => {
      const ref = XLSX.utils.encode_cell({ r: row - 1, c: col - 1 });
      const cell = (detailsSheet as any)[ref];
      if (!cell) return;
      cell.s = { ...(cell.s || {}), ...style };
    };

    for (let col = 1; col <= detailHeaders.length; col++) {
      styleDetailsCell(1, col, {
        fill: { fgColor: { rgb: "1F4E78" } },
        font: { name: "Calibri", sz: 11, bold: true, color: { rgb: "FFFFFF" } },
        alignment: { horizontal: "center", vertical: "center", wrapText: true },
        border: thinBorder,
      });
    }

    const currencyCols = new Set([9, 10, 11, 12, 13, 14, 16, 18, 19, 21, 22, 23, 25, 27, 28, 29]);
    for (let row = 2; row <= totalsRow; row++) {
      const isTotalsRow = row === totalsRow;
      const isEvenDataRow = row % 2 === 0;
      for (let col = 1; col <= detailHeaders.length; col++) {
        const baseStyle: Record<string, unknown> = {
          border: thinBorder,
          font: { name: "Calibri", sz: 10, color: { rgb: "111827" }, bold: isTotalsRow },
          alignment: {
            vertical: "top",
            horizontal: currencyCols.has(col) ? "right" : col === 8 || col === 24 ? "left" : "center",
            wrapText: col === 8 || col === 24,
          },
          fill: isTotalsRow
            ? { fgColor: { rgb: "FFF2CC" } }
            : isEvenDataRow
              ? { fgColor: { rgb: "F8FAFC" } }
              : { fgColor: { rgb: "FFFFFF" } },
        };

        if (currencyCols.has(col)) {
          baseStyle.numFmt = "#,##0.00";
        }

        styleDetailsCell(row, col, baseStyle);
      }
    }

    XLSX.utils.book_append_sheet(workbook, summarySheet, "Daily Summary");
    XLSX.utils.book_append_sheet(workbook, detailsSheet, "Transaction Details");

    const planHeaders = [
      "Created Time",
      "Patient Name",
      "Patient ID Number",
      "Treatment Plan",
      "Status",
      "Plan Total",
      "Paid To Date",
      "Remaining",
      "Visit Progress",
      "Notes",
    ];
    const planData = [
      planHeaders,
      ...(treatmentPlanRows.length > 0
        ? treatmentPlanRows
        : [["", "No treatment plans created, visited, or paid today", "", "", "", "", "", "", "", ""]]),
    ];
    const planSheet = XLSX.utils.aoa_to_sheet(normalizeReportRows(planData));
    planSheet["!autofilter"] = { ref: `A1:J${planData.length}` };
    planSheet["!freeze"] = { xSplit: 0, ySplit: 1 };
    planSheet["!cols"] = [
      { wch: 14 },
      { wch: 32 },
      { wch: 16 },
      { wch: 32 },
      { wch: 14 },
      { wch: 14 },
      { wch: 14 },
      { wch: 14 },
      { wch: 16 },
      { wch: 36 },
    ];

    const stylePlanCell = (row: number, col: number, style: Record<string, unknown>) => {
      const ref = XLSX.utils.encode_cell({ r: row - 1, c: col - 1 });
      const cell = (planSheet as any)[ref];
      if (!cell) return;
      cell.s = { ...(cell.s || {}), ...style };
    };

    for (let col = 1; col <= planHeaders.length; col++) {
      stylePlanCell(1, col, {
        fill: { fgColor: { rgb: "1F4E78" } },
        font: { name: "Calibri", sz: 11, bold: true, color: { rgb: "FFFFFF" } },
        alignment: { horizontal: "center", vertical: "center", wrapText: true },
        border: thinBorder,
      });
    }
    const planCurrencyCols = new Set([6, 7, 8]);
    for (let row = 2; row <= planData.length; row++) {
      for (let col = 1; col <= planHeaders.length; col++) {
        stylePlanCell(row, col, {
          border: thinBorder,
          font: { name: "Calibri", sz: 10, color: { rgb: "111827" } },
          alignment: {
            vertical: "top",
            horizontal: planCurrencyCols.has(col) ? "right" : col === 2 || col === 4 || col === 10 ? "left" : "center",
            wrapText: col === 2 || col === 4 || col === 10,
          },
          fill: row % 2 === 0 ? { fgColor: { rgb: "F8FAFC" } } : { fgColor: { rgb: "FFFFFF" } },
          ...(planCurrencyCols.has(col) ? { numFmt: "#,##0.00" } : {}),
        });
      }
    }
    XLSX.utils.book_append_sheet(workbook, planSheet, "Treatment Plans");

    const planPaymentHeaders = [
      "Time",
      "Patient Name",
      "Patient ID Number",
      "Treatment Plan",
      "Plan Total",
      "Paid Today",
      "Paid To Date",
      "Remaining",
      "Visit Progress",
      "Payment Method",
      "Notes",
    ];
    const planPaymentData = [
      planPaymentHeaders,
      ...(treatmentPlanPaymentRows.length > 0
        ? treatmentPlanPaymentRows
        : [["", "No treatment plan payments today", "", "", "", "", "", "", "", "", ""]]),
    ];
    const planPaymentSheet = XLSX.utils.aoa_to_sheet(normalizeReportRows(planPaymentData));
    planPaymentSheet["!autofilter"] = { ref: `A1:K${planPaymentData.length}` };
    planPaymentSheet["!freeze"] = { xSplit: 0, ySplit: 1 };
    planPaymentSheet["!cols"] = [
      { wch: 12 },
      { wch: 32 },
      { wch: 16 },
      { wch: 28 },
      { wch: 14 },
      { wch: 14 },
      { wch: 14 },
      { wch: 14 },
      { wch: 16 },
      { wch: 18 },
      { wch: 30 },
    ];

    const stylePlanPaymentCell = (row: number, col: number, style: Record<string, unknown>) => {
      const ref = XLSX.utils.encode_cell({ r: row - 1, c: col - 1 });
      const cell = (planPaymentSheet as any)[ref];
      if (!cell) return;
      cell.s = { ...(cell.s || {}), ...style };
    };

    for (let col = 1; col <= planPaymentHeaders.length; col++) {
      stylePlanPaymentCell(1, col, {
        fill: { fgColor: { rgb: "1F4E78" } },
        font: { name: "Calibri", sz: 11, bold: true, color: { rgb: "FFFFFF" } },
        alignment: { horizontal: "center", vertical: "center", wrapText: true },
        border: thinBorder,
      });
    }
    const planPaymentCurrencyCols = new Set([5, 6, 7, 8]);
    for (let row = 2; row <= planPaymentData.length; row++) {
      for (let col = 1; col <= planPaymentHeaders.length; col++) {
        stylePlanPaymentCell(row, col, {
          border: thinBorder,
          font: { name: "Calibri", sz: 10, color: { rgb: "111827" } },
          alignment: {
            vertical: "top",
            horizontal: planPaymentCurrencyCols.has(col) ? "right" : col === 2 || col === 11 ? "left" : "center",
            wrapText: col === 2 || col === 11,
          },
          fill: row % 2 === 0 ? { fgColor: { rgb: "F8FAFC" } } : { fgColor: { rgb: "FFFFFF" } },
          ...(planPaymentCurrencyCols.has(col) ? { numFmt: "#,##0.00" } : {}),
        });
      }
    }
    XLSX.utils.book_append_sheet(workbook, planPaymentSheet, "Treatment Plan Payments");

    if (paymentRecordsForDay.length > 0) {
      const receiptMap = new Map(receipts.map((receipt) => [String(receipt.id), receipt]));
      const receptionistNameMap = new Map(receptionistRows.map((row) => [String(row.id), String(row.name || "")]));
      const allocationsByPaymentId = new Map<string, PaymentAllocation[]>();
      paymentAllocationsForDay.forEach((row) => {
        const key = String(row.payment_id || "");
        if (!allocationsByPaymentId.has(key)) allocationsByPaymentId.set(key, []);
        allocationsByPaymentId.get(key)?.push(row);
      });
      const refundsByPaymentId = new Map<string, PaymentAllocationRefund[]>();
      paymentAllocationRefundsForDay.forEach((row) => {
        const key = String(row.payment_id || "");
        if (!refundsByPaymentId.has(key)) refundsByPaymentId.set(key, []);
        refundsByPaymentId.get(key)?.push(row);
      });

      const transactionHeaders = [
        "Transaction Date & Time",
        "Payment ID",
        "Invoice/Treatment ID",
        "Patient Name",
        "Patient Number",
        "Clinic",
        "Cashier/User",
        "Treatment Net Amount",
        "VAT Amount",
        "Invoice Amount Settled",
        "Payment Method Summary",
        "Is Split",
        "Total Payment Fee",
        "Total Customer Charged",
        "Total Refunded",
        "Payment Status",
      ];
      const transactionRows = paymentRecordsForDay.map((payment) => {
        const receipt = receiptMap.get(String(payment.receipt_id || ""));
        const patient = patientMap.get(String(receipt?.patient_id || ""));
        const allocationRows = allocationsByPaymentId.get(String(payment.id || "")) || [];
        const treatmentNet = allocationRows.reduce((sum, row) => sum + Number(row.treatment_net_amount || 0), 0);
        const refundedTotal = (refundsByPaymentId.get(String(payment.id || "")) || []).reduce(
          (sum, row) => sum + Number(row.total_returned_amount || 0),
          0
        );
        return [
          new Date(payment.created_at || now).toLocaleString("en-GB", { timeZone: "Asia/Dubai" }),
          payment.id,
          payment.receipt_id,
          patient?.name || "",
          patient?.patient_number || "",
          activeClinic.name,
          receptionistNameMap.get(String(payment.receptionist_id || "")) || "",
          treatmentNet,
          Number(payment.total_vat_amount || 0),
          Number(payment.total_invoice_amount_settled || 0),
          payment.payment_method_summary || "",
          payment.is_split ? "Yes" : "No",
          Number(payment.total_payment_fee_amount || 0),
          Number(payment.total_customer_charged_amount || 0),
          refundedTotal,
          payment.status || "",
        ];
      });
      const transactionSheet = XLSX.utils.aoa_to_sheet(normalizeReportRows([transactionHeaders, ...transactionRows]));
      transactionSheet["!autofilter"] = { ref: `A1:P${Math.max(2, transactionRows.length + 1)}` };
      transactionSheet["!freeze"] = { xSplit: 0, ySplit: 1 };
      transactionSheet["!cols"] = transactionHeaders.map((header) => ({ wch: Math.max(14, header.length + 2) }));
      XLSX.utils.book_append_sheet(workbook, transactionSheet, "Transactions");

      const allocationHeaders = [
        "Transaction Date & Time",
        "Payment ID",
        "Allocation ID",
        "Invoice/Treatment ID",
        "Clinic",
        "Cashier/User",
        "Payment Method Group",
        "Payment Method Variant",
        "Card Network",
        "Treatment Net Amount Allocated",
        "VAT Allocated",
        "Invoice Amount Allocated",
        "Fee Rate",
        "Fee Amount",
        "Customer Charged Amount",
        "Provider Reference Number",
        "Terminal Authorization Code",
        "Allocation Status",
        "Refunded Treatment Amount",
        "Refunded VAT Amount",
        "Refunded Fee Amount",
        "Net Customer Amount After Refunds",
      ];
      const allocationRows = paymentAllocationsForDay.map((row) => {
        const payment = paymentRecordsForDay.find((record) => String(record.id) === String(row.payment_id));
        const allocationRefunds = paymentAllocationRefundsForDay.filter(
          (refund) => String(refund.payment_allocation_id) === String(row.id)
        );
        const totalAllocationRefunded = allocationRefunds.reduce((sum, refund) => sum + Number(refund.total_returned_amount || 0), 0);
        return [
          new Date(payment?.created_at || now).toLocaleString("en-GB", { timeZone: "Asia/Dubai" }),
          row.payment_id,
          row.id,
          payment?.receipt_id || "",
          activeClinic.name,
          receptionistNameMap.get(String(payment?.receptionist_id || "")) || "",
          row.method_group,
          row.method_variant,
          row.card_network || "",
          Number(row.treatment_net_amount || 0),
          Number(row.vat_amount || 0),
          Number(row.invoice_allocation_amount || 0),
          Number(row.fee_rate || 0),
          Number(row.fee_amount || 0),
          Number(row.customer_charged_amount || 0),
          row.provider_reference_number || "",
          row.terminal_authorization_code || "",
          row.status || "",
          Number(row.refunded_treatment_amount || 0),
          Number(row.refunded_vat_amount || 0),
          Number(row.refunded_fee_amount || 0),
          truncateCurrency(Number(row.customer_charged_amount || 0) - totalAllocationRefunded),
        ];
      });
      const allocationSheet = XLSX.utils.aoa_to_sheet(normalizeReportRows([allocationHeaders, ...allocationRows]));
      allocationSheet["!autofilter"] = { ref: `A1:V${Math.max(2, allocationRows.length + 1)}` };
      allocationSheet["!freeze"] = { xSplit: 0, ySplit: 1 };
      allocationSheet["!cols"] = allocationHeaders.map((header) => ({ wch: Math.max(14, header.length + 2) }));
      XLSX.utils.book_append_sheet(workbook, allocationSheet, "Payment Allocations");

      const refundHeaders = [
        "Refund Date & Time",
        "Refund ID",
        "Original Payment ID",
        "Original Allocation ID",
        "Invoice/Treatment ID",
        "Payment Method Group",
        "Payment Method Variant",
        "Refunded Treatment Amount",
        "Refunded VAT Amount",
        "Reversed Payment Fee",
        "Total Returned To Customer",
        "Provider Reference",
        "Refund Reason",
        "Processed By",
        "Refund Status",
      ];
      const refundRows = paymentAllocationRefundsForDay.map((row) => {
        const allocation = paymentAllocationsForDay.find((allocationRow) => String(allocationRow.id) === String(row.payment_allocation_id));
        return [
          new Date(row.created_at || now).toLocaleString("en-GB", { timeZone: "Asia/Dubai" }),
          row.id,
          row.payment_id,
          row.payment_allocation_id,
          row.receipt_id,
          allocation?.method_group || "",
          allocation?.method_variant || "",
          Number(row.refunded_treatment_amount || 0),
          Number(row.refunded_vat_amount || 0),
          Number(row.reversed_fee_amount || 0),
          Number(row.total_returned_amount || 0),
          allocation?.provider_reference_number || "",
          row.reason || "",
          receptionistNameMap.get(String(row.processed_by || "")) || "",
          row.status || "",
        ];
      });
      const refundSheet = XLSX.utils.aoa_to_sheet(normalizeReportRows([refundHeaders, ...refundRows]));
      refundSheet["!autofilter"] = { ref: `A1:O${Math.max(2, refundRows.length + 1)}` };
      refundSheet["!freeze"] = { xSplit: 0, ySplit: 1 };
      refundSheet["!cols"] = refundHeaders.map((header) => ({ wch: Math.max(14, header.length + 2) }));
      XLSX.utils.book_append_sheet(workbook, refundSheet, "Refunds");

      const summaryHeaders = [
        "Payment Method",
        "Invoice Amount Allocated",
        "Payment Fees Charged",
        "Total Customer Charged",
        "Refunds",
        "Net Amount After Refunds",
        "Number of Payment Allocations",
      ];
      const methodRows: Array<{ key: PaymentMethodVariant; label: string }> = [
        { key: "cash", label: "Cash" },
        { key: "card", label: "Card" },
        { key: "tabby_standard", label: "Tabby" },
        { key: "tabby_card", label: "Tabby Card" },
        { key: "tamara", label: "Tamara" },
      ];
      const dailySummaryRows = methodRows.map((entry) => {
        const rows = paymentAllocationsForDay.filter((row) => row.method_variant === entry.key);
        const treatmentPlanRowsForMethod = treatmentPlanPaymentSummaries.filter((row) => row.methodVariant === entry.key);
        const refunds = paymentAllocationRefundsForDay.filter((row) => {
          const allocation = paymentAllocationsForDay.find((allocationRow) => String(allocationRow.id) === String(row.payment_allocation_id));
          return allocation?.method_variant === entry.key;
        });
        const invoiceAllocated = rows.reduce((sum, row) => sum + Number(row.invoice_allocation_amount || 0), 0)
          + treatmentPlanRowsForMethod.reduce((sum, row) => sum + row.invoiceAllocated, 0);
        const fees = rows.reduce((sum, row) => sum + Number(row.fee_amount || 0), 0)
          + treatmentPlanRowsForMethod.reduce((sum, row) => sum + row.feeAmount, 0);
        const charged = rows.reduce((sum, row) => sum + Number(row.customer_charged_amount || 0), 0)
          + treatmentPlanRowsForMethod.reduce((sum, row) => sum + row.customerChargedAmount, 0);
        const refunded = refunds.reduce((sum, row) => sum + Number(row.total_returned_amount || 0), 0);
        const treatmentPlanAllocationCount = treatmentPlanRowsForMethod.reduce((sum, row) => sum + row.allocationCount, 0);
        return [entry.label, invoiceAllocated, fees, charged, refunded, truncateCurrency(charged - refunded), rows.length + treatmentPlanAllocationCount];
      });
      const summarySheetRows = [summaryHeaders, ...dailySummaryRows];
      const dailySummarySheet = XLSX.utils.aoa_to_sheet(normalizeReportRows(summarySheetRows));
      dailySummarySheet["!autofilter"] = { ref: `A1:G${summarySheetRows.length}` };
      dailySummarySheet["!freeze"] = { xSplit: 0, ySplit: 1 };
      dailySummarySheet["!cols"] = summaryHeaders.map((header) => ({ wch: Math.max(18, header.length + 2) }));
      XLSX.utils.book_append_sheet(workbook, dailySummarySheet, "Daily Payment Summary");
    }

    const fileDate = formatDubaiFileDate(now);
    const fileName = `EOD RECONCILIATION ${activeClinic.name.toUpperCase()} ${fileDate.day} ${fileDate.month} ${fileDate.year}.xlsx`;
    XLSX.writeFile(workbook, fileName);
  }

  function filenameFromDisposition(headerValue: string | null): string {
    if (!headerValue) return "";
    const match = headerValue.match(/filename="([^"]+)"/i);
    return match?.[1] || "";
  }

  async function openPatientBackupModal() {
    if (!activeClinic?.id) {
      alert("No active clinic found for this register.");
      return;
    }
    setPatientBackupError("");
    setPatientBackupSummary(null);
    setShowPatientBackupModal(true);
    setIsLoadingPatientBackupSummary(true);
    try {
      const res = await fetch("/api/patient-backup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "preview",
          clinicId: activeClinic.id,
          receptionistId: receptionistId || loginReceptionistId || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPatientBackupError(String(data?.error || "Could not prepare backup preview."));
        return;
      }
      setPatientBackupSummary({
        clinicName: String(data.clinicName || activeClinic.name || ""),
        patientCount: Number(data.patientCount || 0),
        treatmentRecordCount: Number(data.treatmentRecordCount || 0),
        filename: String(data.filename || ""),
      });
    } catch {
      setPatientBackupError("Could not prepare backup preview.");
    } finally {
      setIsLoadingPatientBackupSummary(false);
    }
  }

  async function downloadPatientBackup() {
    if (!activeClinic?.id || isDownloadingPatientBackup) return;
    setPatientBackupError("");
    setIsDownloadingPatientBackup(true);
    try {
      const res = await fetch("/api/patient-backup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "download",
          clinicId: activeClinic.id,
          receptionistId: receptionistId || loginReceptionistId || null,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setPatientBackupError(String(data?.error || "Could not download backup."));
        return;
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const fallbackName = patientBackupSummary?.filename || "Patient_Backup.xlsx";
      a.href = url;
      a.download = filenameFromDisposition(res.headers.get("Content-Disposition")) || fallbackName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setShowPatientBackupModal(false);
      alert("Patient backup downloaded successfully.");
    } catch {
      setPatientBackupError("Could not download backup.");
    } finally {
      setIsDownloadingPatientBackup(false);
    }
  }

  async function proceedToPayment() {
    if (isProceedingRef.current) return;

    // Guard checks before locking — these never need rollback
    if (!isPosUnlocked) {
      alert("Open the register first to use POS.");
      return;
    }
    if (!receptionistId || selectedServices.length === 0) {
      alert("Please add at least one service.");
      return;
    }
    if (!patientId) {
      alert("Select or register a patient before continuing.");
      return;
    }
    if (hasUnconfiguredVatServices) {
      const names = [...new Set(unconfiguredVatLines.map((line) => line.serviceName))].join(", ");
      alert(`VAT not configured for: ${names}. Configure VAT in Backend > Services before checkout.`);
      return;
    }
    if (!validateTeethSelection()) return;
    if (!activeClinic?.id) {
      alert("Open the register for a clinic first.");
      return;
    }

    isProceedingRef.current = true;
    setIsProceeding(true);
    try {
    const finalPatientId = patientId;
    const finalPatientFileId = transactionPatientFileId || "";
    const finalClinicFileNo = patientFileNumberInput.trim();

    // Persist the patient details for the selected or newly created patient.
    if (patientId) {
      const patientSaveResult = await savePatientDetails(patientId);
      if (!patientSaveResult.ok) {
        console.warn("Existing patient details could not be fully saved.");
      }
    }

    if (!finalPatientId) {
      alert("Missing patient. Please select or create a patient first.");
      return;
    }

    // Set the transaction patient ID to use throughout the payment/print flow
    setTransactionPatientId(finalPatientId);
    setTransactionPatientFileId(finalPatientFileId);
    if (finalClinicFileNo) setPatientFileNumberInput(finalClinicFileNo);
    setSelectedPaymentMethod("");
    setPaymentAllocationDrafts([]);
    setPaymentValidationErrors([]);
    setCashReceivedByRow({});
    setApplyCreditChecked(false);
    setShowTransactionTypeModal(true);
    } finally {
      isProceedingRef.current = false;
      setIsProceeding(false);
    }
  }

  function selectPaymentMethod(method: string) {
    setSelectedPaymentMethod(method);
    setPaymentValidationErrors([]);
    const amountDue = getAmountDueToday();
    const amountDueText = amountDue.toFixed(2);
    if (method === "Split Payment") {
      const halfMinor = Math.floor(toMinorUnits(amountDue) / 2);
      const firstAmount = fromMinorUnits(halfMinor);
      const secondAmount = fromMinorUnits(Math.max(0, toMinorUnits(amountDue) - halfMinor));
      const cashDraft = createAllocationDraftRow("cash", firstAmount.toFixed(2));
      const cardDraft = createAllocationDraftRow("card", secondAmount.toFixed(2));
      setPaymentAllocationDrafts([cashDraft, cardDraft]);
      setCashReceivedByRow({ [cashDraft.id]: firstAmount.toFixed(2) });
      return;
    }
    if (method === "Cash") {
      const cashDraft = createAllocationDraftRow("cash", amountDueText);
      setPaymentAllocationDrafts([cashDraft]);
      setCashReceivedByRow({ [cashDraft.id]: amountDueText });
      return;
    }
    if (method === "Card") {
      setPaymentAllocationDrafts([createAllocationDraftRow("card", amountDueText)]);
      setCashReceivedByRow({});
      return;
    }
    if (method === "Tabby") {
      setPaymentAllocationDrafts([createAllocationDraftRow("tabby_standard", amountDueText)]);
      setCashReceivedByRow({});
      return;
    }
    if (method === "Tabby Card") {
      setPaymentAllocationDrafts([createAllocationDraftRow("tabby_card", amountDueText)]);
      setCashReceivedByRow({});
      return;
    }
    if (method === "Tamara") {
      setPaymentAllocationDrafts([createAllocationDraftRow("tamara", amountDueText)]);
      setCashReceivedByRow({});
      return;
    }
    setPaymentAllocationDrafts([]);
    setCashReceivedByRow({});
  }

  function getNumericInput(value: string) {
    const num = parseMoneyInput(value);
    return Number.isFinite(num) ? num : 0;
  }

  function getCashReceivedAmount(rowId: string) {
    return Math.max(0, getNumericInput(cashReceivedByRow[rowId] || ""));
  }

  function getInvoiceAllocationAmountFromDraft(row: PaymentAllocationDraft) {
    return Math.max(0, getNumericInput(row.invoiceAllocationAmountInput));
  }

  function getCashChangeForDraft(row: PaymentAllocationDraft) {
    if (row.methodVariant !== "cash") return 0;
    const allocated = getInvoiceAllocationAmountFromDraft(row);
    const received = getCashReceivedAmount(row.id);
    return Math.max(0, received - allocated);
  }

  function getCashTenderValidationErrors() {
    const errors: string[] = [];
    const cashRows = paymentAllocationDrafts.filter((row) => row.methodVariant === "cash");
    cashRows.forEach((row, index) => {
      const allocated = getInvoiceAllocationAmountFromDraft(row);
      const received = getCashReceivedAmount(row.id);
      if (allocated > 0.0049 && received + 0.0049 < allocated) {
        const rowLabel = selectedPaymentMethod === "Split Payment" ? `Cash allocation #${index + 1}` : "Cash received";
        errors.push(`${rowLabel} must be at least AED ${allocated.toFixed(2)}.`);
      }
    });
    return errors;
  }

  function pushSuccessToast(message: string) {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setSuccessToasts((current) => [...current, { id, message }]);
    setTimeout(() => {
      setSuccessToasts((current) => current.filter((toast) => toast.id !== id));
    }, 3500);
  }

  // Credit is a payment source, not a payment method: it reduces the amount
  // due before the method is chosen, and never exceeds the treatment total —
  // any surplus stays on the patient's account for future visits.
  function getCreditApplied() {
    if (!applyCreditChecked) return 0;
    return Math.min(checkoutAvailableCredit, Math.round(total * 100) / 100);
  }

  // What still has to be paid with a real payment method after credit.
  function getRemainingAfterCredit() {
    return Math.max(0, Math.round((total - getCreditApplied()) * 100) / 100);
  }

  // Money the patient pays at checkout via payment methods (excludes credit).
  // This flow now always settles the full post-credit invoice amount.
  function getAmountDueToday() {
    return getRemainingAfterCredit();
  }

  // Remainder that becomes an outstanding balance when > 0.
  function getOutstandingAfterPayment() {
    return Math.max(0, Math.round((getRemainingAfterCredit() - getAmountDueToday()) * 100) / 100);
  }

  function updateAllocationDraft(rowId: string, patch: Partial<PaymentAllocationDraft>) {
    setPaymentAllocationDrafts((current) => {
      const updated = current.map((row) => (row.id === rowId ? { ...row, ...patch } : row));
      if (selectedPaymentMethod !== "Split Payment" || updated.length < 2) {
        return updated;
      }
      const changedIndex = updated.findIndex((row) => row.id === rowId);
      if (changedIndex < 0 || changedIndex >= updated.length - 1 || !Object.prototype.hasOwnProperty.call(patch, "invoiceAllocationAmountInput")) {
        return updated;
      }

      const amountDueMinor = toMinorUnits(getAmountDueToday());
      const usedBeforeLastMinor = updated
        .slice(0, updated.length - 1)
        .reduce((sum, row) => sum + Math.max(0, toMinorUnits(getNumericInput(row.invoiceAllocationAmountInput))), 0);
      const remainingMinor = Math.max(0, amountDueMinor - usedBeforeLastMinor);
      const lastIndex = updated.length - 1;
      updated[lastIndex] = {
        ...updated[lastIndex],
        invoiceAllocationAmountInput: fromMinorUnits(remainingMinor).toFixed(2),
      };
      return updated;
    });
  }

  function addAnotherPaymentMethodRow() {
    setPaymentAllocationDrafts((current) => [...current, createAllocationDraftRow("card", "")]);
  }

  function allowedVariantsForSelectedMethod(method: string): PaymentMethodVariant[] {
    if (method === "Cash") return ["cash"];
    if (method === "Card") return ["card"];
    if (method === "Tabby") return ["tabby_standard", "tabby_card"];
    if (method === "Tabby Card") return ["tabby_card"];
    if (method === "Tamara") return ["tamara"];
    return allocationMethodOptions.map((opt) => opt.value);
  }

  function buildComputedAllocationsForSave() {
    return buildPaymentAllocations(paymentAllocationDrafts, getAmountDueToday(), total, vat);
  }

  function getPaymentSummaryForSave() {
    const rows = buildComputedAllocationsForSave();
    if (rows.length === 0) {
      return selectedPaymentMethod;
    }
    return paymentSummaryLabel(rows, { includeAmounts: true, includeReferences: true });
  }

  function buildPaymentCompleteSnapshot(savedReceipt: any): PaymentCompleteSnapshot {
    const computedAllocations = getRemainingAfterCredit() <= 0.0049 ? [] : buildComputedAllocationsForSave();
    const paymentRows = computedAllocations.length > 0
      ? computedAllocations.map((row) => ({
          label: paymentVariantLabel(row.methodVariant),
          amount: Number(row.customerChargedAmount || 0),
        }))
      : [{
          label: savedReceipt?.payment_method || selectedPaymentMethod || "Payment",
          amount: Number(savedReceipt?.total || total || 0),
        }];
    const receiptRef = savedReceipt?.receipt_number
      ? `#${String(savedReceipt.receipt_number).padStart(5, "0")}`
      : savedReceipt?.id
        ? `#${String(savedReceipt.id).slice(0, 8).toUpperCase()}`
        : "-";
    const lineItems = pricingSummary.lineDetails.map((line) => ({
      name: line.serviceName,
      quantity: line.quantity,
      amount: line.finalLineTotal,
    }));
    const patientLabel =
      patients.find((p) => String(p.id) === String(transactionPatientId))?.name
      || patientName
      || "Patient";
    const completedAtSource = savedReceipt?.created_at ? new Date(savedReceipt.created_at) : new Date();
    const completedAtLabel = completedAtSource.toLocaleString();

    return {
      receipt: savedReceipt,
      receiptRef,
      patientName: patientLabel,
      completedAtLabel,
      lineItems,
      subtotal,
      discount: discountAmount,
      vat,
      totalPaid: Number(savedReceipt?.total ?? total),
      paymentSummary: savedReceipt?.payment_method || getPaymentSummaryForSave() || selectedPaymentMethod || "-",
      paymentRows,
    };
  }

  function buildPaymentDetailsHtml() {
    const rows = buildComputedAllocationsForSave();
    if (rows.length === 0) {
      return `<div class="meta-row"><span class="label">Payment / الدفع</span><span>${selectedPaymentMethod || "-"}</span></div>`;
    }
    const detailRows = rows
      .map((row) => {
        const refHtml = row.providerReferenceNumber
          ? `<div class="meta-row"><span class="label">${paymentVariantLabel(row.methodVariant)} Ref</span><span>${row.providerReferenceNumber}</span></div>`
          : "";
        return `
          <div class="meta-row"><span class="label">${paymentVariantLabel(row.methodVariant)}</span><span>AED ${row.customerChargedAmount.toFixed(2)}</span></div>
          <div class="meta-row"><span class="label">Invoice Allocated</span><span>AED ${row.invoiceAllocationAmount.toFixed(2)}</span></div>
          ${row.feeAmount > 0 ? `<div class="meta-row"><span class="label">Fee (${(row.feeRate * 100).toFixed(1)}%)</span><span>AED ${row.feeAmount.toFixed(2)}</span></div>` : ""}
          ${refHtml}
        `;
      })
      .join("");
    return `
      <div class="meta-row"><span class="label">Payment / الدفع</span><span>${paymentSummaryLabel(rows).toUpperCase()}</span></div>
      ${detailRows}
    `;
  }

  async function continueFromPaymentModal() {
    const remainingAfterCredit = getRemainingAfterCredit();
    const dueToday = getAmountDueToday();
    const outstanding = getOutstandingAfterPayment();
    const validationMessages: string[] = [];

    if (hasUnconfiguredVatServices) {
      const names = [...new Set(unconfiguredVatLines.map((line) => line.serviceName))].join(", ");
      validationMessages.push(`VAT not configured for: ${names}. Configure VAT in Backend > Services before checkout.`);
    }

    // Fully covered by patient credit — no payment method needed.
    if (remainingAfterCredit > 0.0049) {
      if (!selectedPaymentMethod) {
        validationMessages.push("Please select a payment method.");
      }

      // Free services (e.g. consultations priced at 0) are legitimate — only
      // require a payment amount when there is actually something to pay.
      if (dueToday <= 0) {
        validationMessages.push("Amount to pay must be greater than 0.");
      }

      const allocationErrors = validatePaymentAllocations(paymentAllocationDrafts, dueToday);
      allocationErrors.forEach((error) => validationMessages.push(error.message));
      const cashTenderErrors = getCashTenderValidationErrors();
      cashTenderErrors.forEach((error) => validationMessages.push(error));
      if (allocationErrors.length === 0) {
        const computed = buildComputedAllocationsForSave();
        const invoiceMinor = toMinorUnits(dueToday);
        const allocatedMinor = computed.reduce((sum, row) => sum + toMinorUnits(row.invoiceAllocationAmount), 0);
        if (allocatedMinor !== invoiceMinor) {
          const diffMinor = invoiceMinor - allocatedMinor;
          if (diffMinor > 0) {
            validationMessages.push(`Remaining amount is AED ${fromMinorUnits(diffMinor).toFixed(2)}.`);
          } else {
            validationMessages.push(`Overallocation by AED ${fromMinorUnits(Math.abs(diffMinor)).toFixed(2)}.`);
          }
          const referencesToCheck = computed
            .filter((row) => row.providerReferenceNumber && (row.methodGroup === "tabby" || row.methodGroup === "tamara"))
            .map((row) => ({
              methodGroup: row.methodGroup,
              normalized: normalizeProviderReference(row.providerReferenceNumber || ""),
            }))
            .filter((entry) => entry.normalized);
          if (referencesToCheck.length > 0) {
            const { data: existingRefs, error: refError } = await supabase
              .from("payment_allocations")
              .select("method_group, provider_reference_normalized")
              .in("provider_reference_normalized", referencesToCheck.map((entry) => entry.normalized))
              .in("method_group", [...new Set(referencesToCheck.map((entry) => entry.methodGroup))]);
            if (refError) {
              validationMessages.push(`Could not validate provider references: ${refError.message}`);
            } else {
              const existingRefKeys = new Set(
                (existingRefs || []).map((row: any) => `${String(row.method_group || "")}:${String(row.provider_reference_normalized || "")}`)
              );
              referencesToCheck.forEach((entry) => {
                const key = `${entry.methodGroup}:${entry.normalized}`;
                if (existingRefKeys.has(key)) {
                  validationMessages.push(`Duplicate provider reference already exists for ${entry.methodGroup.toUpperCase()}: ${entry.normalized}`);
                }
              });
            }
          }
        }
      }
    }

    if ((outstanding > 0.0049 || getCreditApplied() > 0.0049) && !activeClinic?.id) {
      validationMessages.push("Partial payments and patient credit need an active clinic. Open the register for a clinic first.");
    }

    if (validationMessages.length > 0) {
      setPaymentValidationErrors(validationMessages);
      return;
    }

    setPaymentValidationErrors([]);
    const savedReceipt = await confirmPaymentAndSave();
    if (!savedReceipt) {
      return;
    }
    setPaymentCompleteSnapshot(buildPaymentCompleteSnapshot(savedReceipt));
    setShowPaymentModal(false);
    setShowPrintModal(false);
    pushSuccessToast("Payment completed");
  }

  async function confirmPaymentAndSave() {
    const creditApplied = getCreditApplied();
    const isFullyCoveredByCredit = getRemainingAfterCredit() <= 0.0049;
    const dueToday = getAmountDueToday();

    if (hasUnconfiguredVatServices) {
      const names = [...new Set(unconfiguredVatLines.map((line) => line.serviceName))].join(", ");
      alert(`VAT not configured for: ${names}. Configure VAT in Backend > Services before checkout.`);
      return false;
    }

    if (!selectedPaymentMethod && !isFullyCoveredByCredit) {
      alert("Please select a payment method first.");
      return false;
    }
    if (!isFullyCoveredByCredit) {
      const allocationErrors = validatePaymentAllocations(paymentAllocationDrafts, dueToday);
      if (allocationErrors.length > 0) {
        setPaymentValidationErrors(allocationErrors.map((error) => error.message));
        alert(allocationErrors[0].message);
        return false;
      }
      const cashTenderErrors = getCashTenderValidationErrors();
      if (cashTenderErrors.length > 0) {
        setPaymentValidationErrors(cashTenderErrors);
        alert(cashTenderErrors[0]);
        return false;
      }
      const allocatedMinor = buildComputedAllocationsForSave().reduce((sum, row) => sum + toMinorUnits(row.invoiceAllocationAmount), 0);
      if (allocatedMinor !== toMinorUnits(dueToday)) {
        alert("Payment allocations must equal the amount to pay.");
        return false;
      }
    }

    const activeReceptionistId = receptionistId || loginReceptionistId;

    if (!transactionPatientId || !activeReceptionistId || selectedServices.length === 0) {
      alert("Please complete the receipt before finishing the transaction.");
      return false;
    }

    if (!validateTeethSelection()) {
      return false;
    }

    setIsSavingReceipt(true);

    const computedAllocations = isFullyCoveredByCredit ? [] : buildComputedAllocationsForSave();
    const totalPaymentFees = computedAllocations.reduce((sum, row) => sum + row.feeAmount, 0);
    const roundedPaymentFees = Math.round(totalPaymentFees * 100) / 100;
    const amountPaidToday = Math.round((getAmountDueToday() + roundedPaymentFees) * 100) / 100;
    const outstandingRemainder = getOutstandingAfterPayment();
    const isPartialPayment = outstandingRemainder > 0.0049;
    const totalWithPaymentFees = Math.round((total + roundedPaymentFees) * 100) / 100;
    const feeProviders = [...new Set(computedAllocations
      .filter((row) => row.feeAmount > 0)
      .map((row) => (row.methodGroup === "tabby" ? "Tabby" : row.methodGroup === "tamara" ? "Tamara" : ""))
      .filter(Boolean))];
    const gatewayFeeProvider = feeProviders.length === 1 ? feeProviders[0] : feeProviders.length > 1 ? "Mixed" : null;
    const receiptItemLineSummaries = pricingSummary.lineDetails;

    if (receiptItemLineSummaries.length !== selectedServices.length) {
      alert("Receipt pricing summary is out of sync with the selected services. Please review the cart and try again.");
      setIsSavingReceipt(false);
      return false;
    }

    const receiptItemDrafts = selectedServices.map((service, index) => {
      const lineSummary = receiptItemLineSummaries[index];
      const serviceId = String(service.id || "");
      if (!lineSummary || !serviceId) {
        return null;
      }

      const currentUnitPrice = roundCurrency(Number(service.price ?? 0));
      const originalUnitPrice = roundCurrency(
        lineSummary.originalUnitPrice != null ? Number(lineSummary.originalUnitPrice) : currentUnitPrice
      );

      return {
        service_id: serviceId,
        quantity: lineSummary.quantity,
        price: currentUnitPrice,
        total: lineSummary.discountedLineTotal,
        original_price: originalUnitPrice,
        teeth: normalizeTeethForItem(service, index),
        service_name_snapshot: lineSummary.serviceName,
        allocated_global_discount_amount: lineSummary.globalDiscountAmount,
        taxable_amount: lineSummary.taxableAmount,
        vat_rate: lineSummary.vatRate,
        vat_amount: lineSummary.vatAmount,
        final_line_total: lineSummary.finalLineTotal,
      };
    });

    if (receiptItemDrafts.some((item) => item == null)) {
      alert("One or more receipt items could not be prepared for saving. Please review the cart and try again.");
      setIsSavingReceipt(false);
      return false;
    }

    const preparedReceiptItemDrafts = receiptItemDrafts.filter((item): item is NonNullable<typeof item> => item != null);
    const totalGlobalDiscountMinor = preparedReceiptItemDrafts.reduce(
      (sum, item) => sum + toMinorUnits(item.allocated_global_discount_amount),
      0
    );
    const totalManualDiscountMinor = receiptItemLineSummaries.reduce(
      (sum, line) => sum + toMinorUnits(line.manualDiscountAmount),
      0
    );
    const totalVatMinor = preparedReceiptItemDrafts.reduce((sum, item) => sum + toMinorUnits(item.vat_amount), 0);
    const totalFinalLineMinor = preparedReceiptItemDrafts.reduce((sum, item) => sum + toMinorUnits(item.final_line_total), 0);

    if (totalGlobalDiscountMinor !== toMinorUnits(globalDiscountAmount)) {
      alert("Allocated global discount does not match the receipt discount. Please review the cart and try again.");
      setIsSavingReceipt(false);
      return false;
    }

    if (totalManualDiscountMinor + totalGlobalDiscountMinor !== toMinorUnits(discountAmount)) {
      alert("Receipt discount totals are out of sync. Please review the cart and try again.");
      setIsSavingReceipt(false);
      return false;
    }

    if (totalVatMinor !== toMinorUnits(vat)) {
      alert("VAT totals are out of sync. Please review the cart and try again.");
      setIsSavingReceipt(false);
      return false;
    }

    if (totalFinalLineMinor !== toMinorUnits(total)) {
      alert("Receipt line totals are out of sync. Please review the cart and try again.");
      setIsSavingReceipt(false);
      return false;
    }

    if ((isPartialPayment || creditApplied > 0.0049) && !activeClinic?.id) {
      alert("Partial payments and patient credit need an active clinic. Open the register for a clinic first.");
      setIsSavingReceipt(false);
      return false;
    }

    try {
    const patientIdToPersist = transactionPatientId || patientId;
    if (patientIdToPersist) {
      const patientSaveResult = await savePatientDetails(patientIdToPersist);
      if (!patientSaveResult.ok) {
        console.warn("Patient details could not be fully saved before receipt completion.");
      }
    }

    const { data: receiptData, error: receiptError } = await supabase
      .from("receipts")
      .insert([
        {
          patient_id: transactionPatientId,
          patient_file_id: transactionPatientFileId || null,
          doctor_id: doctorId || null,
          receptionist_id: activeReceptionistId,
          subtotal: subtotal,
          vat: vat,
          total: totalWithPaymentFees,
          total_before_gateway_fee: total,
          gateway_fee: roundedPaymentFees > 0 ? roundedPaymentFees : null,
          gateway_fee_provider: gatewayFeeProvider,
          discount_amount: discountAmount > 0 ? discountAmount : null,
          birthday_discount_amount: birthdayDiscountAmount > 0 ? birthdayDiscountAmount : null,
          discount_reason: birthdayDiscountApplied ? "Birthday Discount 5%" : null,
          notes: null,
          payment_method: isFullyCoveredByCredit && creditApplied > 0.0049
            ? `Patient Credit (AED ${creditApplied.toFixed(2)})`
            : getPaymentSummaryForSave(),
          // Only set on partial payments so the insert keeps working on databases
          // that haven't run supabase-partial-payments-migration.sql yet.
          // NULL amount_paid = paid in full. When credit is used, amount_paid is
          // always set to the money actually received (credit excluded).
          ...(isPartialPayment || creditApplied > 0.0049 || roundedPaymentFees > 0 ? { amount_paid: amountPaidToday } : {}),
          // Portion covered by prepaid patient credit; only written when used so
          // databases without supabase-credit-applied-migration.sql keep working.
          ...(creditApplied > 0.0049 ? { credit_applied: creditApplied } : {}),
        },
      ])
      .select()
      .single();

    if (receiptError || !receiptData) {
      console.error("Receipt insert error", receiptError);
      alert(`Error saving receipt: ${receiptError?.message || "unknown error"}`);
      return false;
    }

    const items = preparedReceiptItemDrafts.map((item) => {
      return {
        receipt_id: receiptData.id,
        service_id: item.service_id,
        quantity: item.quantity,
        price: item.price,
        total: item.total,
        original_price: item.original_price,
        teeth: item.teeth,
        service_name_snapshot: item.service_name_snapshot,
        allocated_global_discount_amount: item.allocated_global_discount_amount,
        taxable_amount: item.taxable_amount,
        vat_rate: item.vat_rate,
        vat_amount: item.vat_amount,
        final_line_total: item.final_line_total,
      };
    });

    const { data: itemsData, error: itemsError } = await supabase.from("receipt_items").insert(items).select();

    if (itemsError || !itemsData) {
      console.error("Receipt items insert error", itemsError);
      alert(`Error saving receipt items: ${itemsError?.message || "unknown error"}`);
      return false;
    }

    setCurrentReceipt(receiptData);

    const receiptRef = receiptData.receipt_number
      ? `#${String(receiptData.receipt_number).padStart(5, "0")}`
      : `#${String(receiptData.id).slice(0, 8).toUpperCase()}`;

    if (!isFullyCoveredByCredit && computedAllocations.length > 0 && activeClinic?.id) {
      const rpcAllocations = computedAllocations.map((row) => ({
        method_group: row.methodGroup,
        method_variant: row.methodVariant,
        treatment_net_amount: row.treatmentNetAmount,
        vat_amount: row.vatAmount,
        invoice_allocation_amount: row.invoiceAllocationAmount,
        fee_rate: row.feeRate,
        fee_amount: row.feeAmount,
        customer_charged_amount: row.customerChargedAmount,
        provider_reference_number: row.providerReferenceNumber,
        terminal_authorization_code: row.terminalAuthorizationCode,
        card_network: row.cardNetwork,
        status: "completed",
      }));
      const invoiceSettled = computedAllocations.reduce((sum, row) => sum + row.invoiceAllocationAmount, 0);
      const vatSettled = computedAllocations.reduce((sum, row) => sum + row.vatAmount, 0);
      const feeSettled = computedAllocations.reduce((sum, row) => sum + row.feeAmount, 0);
      const customerChargedSettled = computedAllocations.reduce((sum, row) => sum + row.customerChargedAmount, 0);

      const { data: paymentRecordId, error: paymentRecordError } = await supabase.rpc("create_payment_record_with_allocations", {
        p_receipt_id: receiptData.id,
        p_clinic_id: activeClinic.id,
        p_receptionist_id: activeReceptionistId,
        p_total_invoice_amount_settled: Math.round(invoiceSettled * 100) / 100,
        p_total_vat_amount: Math.round(vatSettled * 100) / 100,
        p_total_payment_fee_amount: Math.round(feeSettled * 100) / 100,
        p_total_customer_charged_amount: Math.round(customerChargedSettled * 100) / 100,
        p_payment_method_summary: paymentSummaryLabel(computedAllocations, { includeAmounts: true }),
        p_is_split: computedAllocations.length > 1,
        p_status: "completed",
        p_allocations: rpcAllocations,
        p_created_by: activeReceptionistId,
      });
      if (paymentRecordError) {
        console.error("Payment allocation save error", paymentRecordError);
        alert(`Receipt saved, but payment allocations were not recorded: ${paymentRecordError.message}`);
      } else if (paymentRecordId) {
        await supabase.from("payment_records").select("id").eq("id", paymentRecordId).maybeSingle();
      }
    }

    // Deduct the applied credit from the patient's ledger (negative row).
    if (creditApplied > 0.0049) {
      const { data: creditRow, error: creditError } = await supabase
        .from("patient_credits")
        .insert([
          {
            patient_id: transactionPatientId,
            clinic_id: activeClinic!.id,
            amount: -creditApplied,
            reason: `Applied to receipt ${receiptRef}`,
            receipt_id: receiptData.id,
            receptionist_id: activeReceptionistId,
            register_session_id: registerSessionId || null,
          },
        ])
        .select()
        .single();

      if (creditError || !creditRow) {
        console.error("Credit deduction insert error", creditError);
        alert(
          `Receipt saved, but deducting the applied patient credit of AED ${creditApplied.toFixed(2)} failed: ${creditError?.message || "unknown error"}. The patient's available credit was NOT reduced — please correct it.`
        );
      } else {
        setPatientCredits((prev) => [creditRow as PatientCredit, ...prev]);
      }
    }

    if (isPartialPayment) {
      const { data: balanceData, error: balanceError } = await supabase
        .from("outstanding_balances")
        .insert([
          {
            patient_id: transactionPatientId,
            clinic_id: activeClinic!.id,
            original_date: new Date().toLocaleDateString("en-CA"),
            original_amount: outstandingRemainder,
            reason: creditApplied > 0.0049
              ? `Partial payment at POS — paid AED ${amountPaidToday.toFixed(2)} + credit AED ${creditApplied.toFixed(2)} of AED ${totalWithPaymentFees.toFixed(2)}`
              : `Partial payment at POS — paid AED ${amountPaidToday.toFixed(2)} of AED ${totalWithPaymentFees.toFixed(2)}`,
            reference_number: receiptRef,
            created_by: activeReceptionistId,
            receipt_id: receiptData.id,
          },
        ])
        .select()
        .single();

      if (balanceError || !balanceData) {
        console.error("Outstanding balance insert error", balanceError);
        alert(
          `Receipt saved, but recording the outstanding balance of AED ${outstandingRemainder.toFixed(2)} failed: ${balanceError?.message || "unknown error"}. Add it manually from the Backend page.`
        );
      } else {
        setOutstandingBalances((prev) => [balanceData as OutstandingBalance, ...prev]);
      }
    }

    if (notes.trim()) {
      if (!activeClinic?.id) {
        alert("Receipt saved, but the clinical note was not saved because no clinic is active.");
      } else {
        const { error: noteError } = await supabase.from("patient_notes").insert({
          patient_id: transactionPatientId,
          receipt_id: receiptData.id,
          note: notes.trim(),
          doctor_id: doctorId || null,
          receptionist_id: activeReceptionistId,
          clinic_id: activeClinic.id,
        });
        if (noteError) {
          console.error("Patient note save error", noteError.message, noteError.code, noteError.details, noteError.hint);
        }
      }
    }

    return receiptData;
    } finally {
      setIsSavingReceipt(false);
    }
  }

  function finalizeSuccessfulTransaction() {
    setShowPrintModal(false);
    setPaymentCompleteSnapshot(null);
    setShowPaymentModal(false);
    setPatientId("");
    setPatientName("");
    setPatientPhoneInput("");
    setPatientEmailInput("");
    setPatientDobInput("");
    setPatientSexInput("");
    setPatientNationalityInput("");
    setPatientFileNumberInput("");
    setNationalitySearch("");
    setShowNationalitySuggestions(false);
    setPatientEmiratesIdInput("");
    setPatientPassportInput("");
    setPatientMrnInput("");
    setSelectedPatientInfo(null);
    setTransactionPatientId("");
    setTransactionPatientFileId("");
    setDoctorId("");
    setSelectedPaymentMethod("");
    setPaymentAllocationDrafts([]);
    setCashReceivedByRow({});
    setPaymentValidationErrors([]);
    setApplyCreditChecked(false);
    setNotes("");
    setSelectedServices([]);
    setDiscountInput("");
    setDiscountType("AED");
    setBirthdayDiscountApplied(false);
    setFilteredPatients([]);
    setShowPatientSuggestions(false);
    router.refresh();
  }

  /** Build the A4 invoice HTML for the current transaction using the clinic brand theme. */
  function generateInvoiceHtml(savedReceipt?: any): string {
    const now = new Date();
    const receiptForInvoice = savedReceipt ?? currentReceipt;
    const invoiceNumber = receiptForInvoice?.receipt_number
      ? `#${String(receiptForInvoice.receipt_number).padStart(5, "0")}`
      : `INV-${String(now.getTime()).slice(-6)}`;

    const selectedPatient = patients.find((p) => p.id === transactionPatientId);
    const doctorForInvoice = doctors.find((d) => d.id === doctorId);
    const activeReceptionistId = receptionistId || loginReceptionistId;
    const cashierForInvoice = receptionists.find((r: any) => r.id === activeReceptionistId)?.name;

    const isFullyCoveredByCredit = getRemainingAfterCredit() <= 0.0049;
    const computedAllocs = isFullyCoveredByCredit ? [] : buildComputedAllocationsForSave();
    const creditApplied = getCreditApplied();
    const grandTotal = total + computedAllocs.reduce((s, r) => s + r.feeAmount, 0);
    const amountPaid = isFullyCoveredByCredit ? grandTotal : computedAllocs.reduce((s, r) => s + r.customerChargedAmount, 0) + creditApplied;
    const outstandingBalance = getOutstandingAfterPayment();

    const allocRows: InvoiceAllocationRow[] = computedAllocs.map((row) => ({
      methodLabel: paymentVariantLabel(row.methodVariant),
      invoiceAllocationAmount: row.invoiceAllocationAmount,
      feeAmount: row.feeAmount,
      customerChargedAmount: row.customerChargedAmount,
      providerReferenceNumber: row.providerReferenceNumber,
      terminalAuthorizationCode: row.terminalAuthorizationCode,
    }));

    const invoiceStatus: InvoiceStatus =
      outstandingBalance > 0.005 ? "PARTIALLY PAID"
      : amountPaid < 0.005 ? "UNPAID"
      : "PAID";

    return buildInvoiceHtml({
      clinic: activeClinic,
      receiptNumber: invoiceNumber,
      invoiceStatus,
      issuedAt: now,
      posReceiptNumber: invoiceNumber,
      cashierName: cashierForInvoice,
      patient: {
        name: selectedPatient?.name || patientName || "-",
        phone: selectedPatient?.phone || patientPhoneInput || null,
        email: selectedPatient?.email || patientEmailInput || null,
        fileNumber: patientFileNumberInput.trim() || null,
        patientNumber: selectedPatient?.patient_number ?? null,
      },
      doctorName: doctorForInvoice?.name || null,
      items: selectedServices.map((svc, i) => {
        const lineSummary = pricingSummary.lineDetails[i];
        const renderLine = mapRegularReceiptRenderLine({
          service_name_snapshot: svc.name,
          quantity: svc.quantity ?? 1,
          price: Number(svc.price),
          total: lineSummary?.discountedLineTotal ?? Number(svc.price) * Number(svc.quantity ?? 1),
          original_price: svc.originalPrice != null ? Number(svc.originalPrice) : null,
          allocated_global_discount_amount: lineSummary?.globalDiscountAmount ?? 0,
          taxable_amount: lineSummary?.taxableAmount ?? null,
          vat_rate: lineSummary?.vatRate ?? null,
          vat_amount: lineSummary?.vatAmount ?? null,
          final_line_total: lineSummary?.finalLineTotal ?? null,
          teeth: cartItemTeeth[i] || [],
        });
        return {
          description: renderLine.name,
          quantity: renderLine.quantity,
          originalUnitPrice: renderLine.originalUnitPrice,
          unitPrice: renderLine.soldUnitPrice,
          discountAmount: renderLine.totalDiscountAmount,
          allocatedGlobalDiscountAmount: renderLine.allocatedGlobalDiscountAmount,
          taxableAmount: renderLine.taxableAmount ?? undefined,
          vatRate: renderLine.vatRate ?? undefined,
          vatAmount: renderLine.vatAmount ?? undefined,
          finalLineTotal: renderLine.finalLineTotal ?? undefined,
          teeth: renderLine.teeth,
        };
      }),
      totalDiscount: discountAmount,
      vatAmount: vat,
      paymentFeeAmount: computedAllocs.reduce((s, r) => s + r.feeAmount, 0),
      grandTotal,
      creditApplied: creditApplied > 0.005 ? creditApplied : 0,
      amountPaid,
      outstandingBalance,
      paymentAllocations: allocRows,
      notes: notes.trim() || null,
    });
  }

  /** Download the invoice as an A4 PDF using the server-side Puppeteer renderer. */
  async function downloadInvoicePdf(savedReceipt?: any) {
    const html = generateInvoiceHtml(savedReceipt);
    const clinicSlug = (activeClinic?.name || "Clinic").replace(/\s+/g, "_").replace(/[^\w-]/g, "");
    const receiptForFilename = savedReceipt ?? currentReceipt;
    const invoiceNum = receiptForFilename?.receipt_number
      ? String(receiptForFilename.receipt_number).padStart(5, "0")
      : String(Date.now()).slice(-6);
    const dateStr = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Dubai" }); // YYYY-MM-DD
    const filename = `${clinicSlug}_Invoice_${invoiceNum}_${dateStr}.pdf`;

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
    }
  }

  /** Print the invoice as a full A4 page via a popup window. */
  function printInvoiceA4(savedReceipt?: any) {
    printHtmlWhenImagesReady(generateInvoiceHtml(savedReceipt), "Please allow popups to print the invoice.");
  }


  function buildThermalReceiptHtml(title: string, savedReceipt?: any) {
    const now = new Date();
    const receiptForDisplay = savedReceipt ?? currentReceipt;
    const invoiceNo = receiptForDisplay?.receipt_number
      ? `#${String(receiptForDisplay.receipt_number).padStart(5, "0")}`
      : "DRAFT";
    const dateValue = now.toLocaleDateString("en-GB");
    const timeValue = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });

    const selectedPatient = patients.find((p) => p.id === transactionPatientId);
    const patientNameForReceipt = selectedPatient?.name || patientName || "-";
    const patientMobileForReceipt = selectedPatient?.phone || patientPhoneInput || "-";
    const patientIdForReceipt = patientFileNumberInput.trim()
      ? `#${patientFileNumberInput.trim()}`
      : selectedPatient?.patient_number
      ? `#${String(selectedPatient.patient_number).padStart(5, "0")}`
      : "-";
    const doctorNameForReceipt = doctors.find((d) => d.id === doctorId)?.name || "-";
    const cashierName =
      receptionists.find((person) => person.id === (receptionistId || loginReceptionistId))?.name || "Reception";

    const receiptAllocations = buildComputedAllocationsForSave();
    const allocationFeeTotal = receiptAllocations.reduce((sum, row) => sum + row.feeAmount, 0);
    const paidTodayForReceipt = Math.round((getAmountDueToday() + allocationFeeTotal) * 100) / 100;
    const creditUsedForReceipt = getCreditApplied();
    const remainingForReceipt = getRemainingAfterCredit();
    const outstandingForReceipt = getOutstandingAfterPayment();
    const originalSubtotal = subtotal;

    const options: BuildThermalReceiptHtmlOptions = {
      title,
      clinic: activeClinic,
      invoiceNumber: invoiceNo,
      dateValue,
      timeValue,
      cashierName,
      doctorName: doctorNameForReceipt,
      patientName: patientNameForReceipt,
      patientPhone: patientMobileForReceipt,
      patientFileNumber: String(patientIdForReceipt),
      doctorField: activeClinic?.name === "Skin & Smile Aesthetic Clinic" ? "Aesthetician / المختصة" : "Doctor / الطبيب",
      items: selectedServices.map((service, index) => ({
        ...(() => {
          const lineSummary = pricingSummary.lineDetails[index];
          const renderLine = mapRegularReceiptRenderLine({
            service_name_snapshot: service.name,
            quantity: service.quantity ?? 1,
            price: Number(service.price),
            total: lineSummary?.discountedLineTotal ?? Number(service.price) * Number(service.quantity ?? 1),
            original_price: service.originalPrice != null ? Number(service.originalPrice) : null,
            allocated_global_discount_amount: lineSummary?.globalDiscountAmount ?? 0,
            taxable_amount: lineSummary?.taxableAmount ?? null,
            vat_rate: lineSummary?.vatRate ?? null,
            vat_amount: lineSummary?.vatAmount ?? null,
            final_line_total: lineSummary?.finalLineTotal ?? null,
            teeth: normalizeTeethForItem(service, index).map(String),
          });
          return {
            name: renderLine.name,
            quantity: renderLine.quantity,
            price: renderLine.soldUnitPrice,
            originalPrice: renderLine.originalUnitPrice ?? undefined,
            allocatedGlobalDiscountAmount: renderLine.allocatedGlobalDiscountAmount,
            taxableAmount: renderLine.taxableAmount ?? undefined,
            vatRate: renderLine.vatRate ?? undefined,
            vatAmount: renderLine.vatAmount ?? undefined,
            finalLineTotal: renderLine.finalLineTotal ?? undefined,
            teeth: renderLine.teeth,
          };
        })(),
      })),
      subtotal,
      discountAmount,
      discountType,
      discountInput,
      vat,
      total,
      allocations: receiptAllocations,
      manualDiscountAmount,
      globalDiscountAmount,
      creditUsed: creditUsedForReceipt,
      outstandingBalance: outstandingForReceipt,
      notes: notes.trim(),
      paymentMethod: selectedPaymentMethod,
    };

    return buildThermalReceiptHtmlShared(options);
  }

  function printReceipt(savedReceipt?: any) {
    const receiptHtml = buildThermalReceiptHtml("Receipt", savedReceipt);

    try {
      printHtmlWhenImagesReady(receiptHtml);
    } catch (error) {
      alert("Error opening print dialog. Please check browser settings.");
    }
  }

  return (
    <AppFrame
      title="POS System"
      description="Process transactions with patient, doctor, and service details in one flow."
      workspaceType="pos"
    >
      {!isPosUnlocked ? (
        <div className="mx-auto max-w-xl rounded-3xl border border-teal-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-teal-700/80">
            POS Access
          </p>
          <h2 className="mt-2 text-2xl font-semibold text-slate-900">Open Register</h2>
          <p className="mt-2 text-sm text-slate-600">
            {isManager
              ? "Select receptionist, enter PIN, and add opening cash before starting the shift."
              : "This POS is locked to your selected clinic. Choose that clinic's receptionist, enter PIN, and add opening cash."}
          </p>

          <div className="mt-5 grid gap-4">
            {receptionists.length === 0 ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                No receptionists are available yet. Add one in the Receptionists page before opening the register.
                <a href="/receptionists" className="ml-2 font-semibold underline">
                  Go to Receptionists
                </a>
              </div>
            ) : null}

            <div className="space-y-2">
              <label className="block text-sm font-semibold text-slate-700">Receptionist</label>
              <select
                value={loginReceptionistId}
                onChange={(e) => setLoginReceptionistId(e.target.value)}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-teal-400 focus:ring-4 focus:ring-teal-100"
              >
                <option value="">Select Receptionist</option>
                {visibleReceptionists.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-semibold text-slate-700">PIN</label>
              <input
                type="password"
                value={pinInput}
                onChange={(e) => setPinInput(e.target.value)}
                placeholder="Enter PIN"
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-teal-400 focus:ring-4 focus:ring-teal-100"
              />
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-semibold text-slate-700">Opening Cash (AED)</label>
              <input
                type="number"
                min="0"
                value={openingCashInput}
                onChange={(e) => setOpeningCashInput(e.target.value)}
                placeholder="e.g. 500"
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-teal-400 focus:ring-4 focus:ring-teal-100"
              />
            </div>

            <button
              onClick={openRegister}
              className="inline-flex items-center justify-center rounded-2xl bg-teal-700 px-5 py-3 text-sm font-semibold text-white transition hover:bg-teal-600"
            >
              Open POS Register
            </button>
          </div>
        </div>
      ) : (
      <div className="grid gap-5 lg:grid-cols-[200px_minmax(0,1fr)_minmax(340px,380px)] xl:gap-6">
        <aside className="flex flex-col rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5 lg:sticky lg:top-24 lg:self-start lg:max-h-[calc(100vh-8rem)] lg:overflow-y-auto">
          <div className="rounded-2xl border border-teal-200 bg-teal-50/60 p-3">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-700">Register Open</p>
            <p className="mt-2 text-sm font-semibold text-slate-800">{activeClinic?.name || ""}</p>
            <p className="mt-1 text-xs text-slate-700">
              Receptionist: {receptionists.find((person) => person.id === receptionistId)?.name || "-"}
            </p>
            <p className="mt-1 text-xs text-slate-700">Opening Cash: AED {Number(openingCash || 0).toFixed(2)}</p>
            <p className="mt-1 text-[11px] text-slate-500">
              Opened at: {registerOpenedAt ? new Date(registerOpenedAt).toLocaleString() : "-"}
            </p>
          </div>

          <div className="my-4 border-t border-slate-200" />

          <div className="space-y-2">
            <button
              onClick={openPatientBackupModal}
              disabled={isLoadingPatientBackupSummary || isDownloadingPatientBackup}
              className="inline-flex w-full items-center justify-center rounded-2xl border border-cyan-200 bg-cyan-50 px-3 py-2 text-sm font-semibold text-cyan-800 transition hover:bg-cyan-100 disabled:opacity-50"
            >
              {isLoadingPatientBackupSummary ? "Preparing Backup..." : "Download Patient Backup"}
            </button>
            <button
              onClick={downloadDailyIncomeReport}
              className="inline-flex w-full items-center justify-center rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-100"
            >
              Print Report
            </button>
            <button
              onClick={() => setShowReceiptHistoryModal(true)}
              className="inline-flex w-full items-center justify-center rounded-2xl border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-800 transition hover:bg-sky-100"
            >
              Receipt History
            </button>
            {deductionFeatureEnabled && (
              <button
                onClick={() => openCashDeductionEntry()}
                className="inline-flex w-full items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
              >
                Expense / Commission
              </button>
            )}
          </div>

          <div className="mt-4 pt-1 lg:mt-auto">
            <button
              onClick={openCloseRegisterModal}
              className="inline-flex w-full items-center justify-center rounded-2xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              Close Register
            </button>
          </div>
        </aside>

        <div className="min-w-0 space-y-6">
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="mt-1 grid gap-2 sm:grid-cols-2">
              <button
                onClick={openSearchPatientPicker}
                className="rounded-2xl border border-teal-300 bg-teal-50 px-4 py-2 text-sm font-semibold text-teal-700 transition hover:bg-teal-100"
              >
                Search Patient
              </button>
              <button
                onClick={() => setShowRegisterPatientModal(true)}
                className="rounded-2xl border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-100"
              >
                + Register Patient
              </button>
            </div>
            <div className="mt-4 space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-500">Selected Patient</p>
                {!patientId ? (
                  <div className="mt-2">
                    <p className="text-sm text-slate-700">No patient selected</p>
                    <p className="mt-1 text-xs text-slate-500">Search or register a patient to continue.</p>
                  </div>
                ) : (
                  <div className="mt-2 space-y-2">
                    <p className="text-base font-semibold text-slate-900">{patientName || "—"}</p>
                    {birthdayDiscountEligible && (
                      <button
                        type="button"
                        onClick={() => setBirthdayDiscountApplied((current) => !current)}
                        className={`mt-2 inline-flex items-center rounded-xl border px-2.5 py-1.5 text-[11px] font-semibold transition ${
                          birthdayDiscountApplied
                            ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                            : "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
                        }`}
                      >
                        {birthdayDiscountApplied
                          ? `Birthday 5% Applied · AED ${birthdayDiscountAmount.toFixed(2)}`
                          : "Apply Birthday 5%"}
                      </button>
                    )}
                    {(patientFileNumberInput || patientPhoneInput) && (
                      <div className="grid gap-1 text-sm text-slate-600 sm:grid-cols-2">
                        {patientFileNumberInput && <p>File #{patientFileNumberInput}</p>}
                        {patientPhoneInput && <p>{patientPhoneInput}</p>}
                      </div>
                    )}
                    <div className="pt-1 flex flex-wrap gap-2">
                      <button
                        onClick={openSearchPatientPicker}
                        className="rounded-xl border border-cyan-300 bg-white px-3 py-1.5 text-xs font-semibold text-cyan-700 transition hover:bg-cyan-50"
                      >
                        Change Patient
                      </button>
                      <button
                        onClick={openViewPatientProfile}
                        className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
                      >
                        View Patient
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-2">
                  <label className="block text-sm font-semibold text-slate-700">
                    {activeClinic?.name === "Skin & Smile Aesthetic Clinic" ? "Aesthetician" : "Doctor / Therapist"}{" "}
                    <span className="font-normal text-slate-400">(Optional)</span>
                  </label>
                  <select
                    value={doctorId}
                    onChange={(e) => setDoctorId(e.target.value)}
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-cyan-400 focus:ring-4 focus:ring-cyan-100"
                  >
                    <option value="">{activeClinic?.name === "Skin & Smile Aesthetic Clinic" ? "No aesthetician" : "No doctor / therapist"}</option>
                    {clinicDoctors.map((doctor) => (
                      <option key={doctor.id} value={doctor.id}>
                        {doctor.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="block text-sm font-semibold text-slate-700">Notes (Optional)</label>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Add visit/treatment notes for this transaction"
                    className="min-h-[88px] w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-cyan-400 focus:ring-4 focus:ring-cyan-100"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4 shadow-sm sm:p-5">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-cyan-600">Services</p>
                <h2 className="mt-2 text-xl font-semibold text-slate-900">Clinic Treatments</h2>
              </div>
              <p className="text-sm text-slate-500">{filteredServices.length} shown</p>
            </div>

            <div className="sticky top-2 z-10 space-y-3 bg-slate-50 pb-2">
              <input
                type="text"
                value={serviceSearch}
                onChange={(e) => setServiceSearch(e.target.value)}
                placeholder="Search by name, variant, category, keyword, or alias"
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-cyan-400 focus:ring-4 focus:ring-cyan-100"
              />

              <div className="grid gap-2">
                {isLoadingFavorites && (
                  <p className="text-xs text-slate-500">Refreshing favorites…</p>
                )}
                <div className="flex flex-wrap gap-2">
                  {[
                    { key: "all", label: "All", count: clinicServices.length },
                    { key: "frequent", label: "Frequently Used", count: frequentlyUsedServiceIds.length },
                    { key: "recent", label: "Recently Used", count: recentServiceIds.length },
                    { key: "favorites", label: "Favorites", count: favoriteServiceIds.length },
                  ].map((mode) => {
                    const isActive = serviceUsageFilter === mode.key;
                    return (
                      <button
                        key={mode.key}
                        type="button"
                        onClick={() => setServiceUsageFilter(mode.key as "all" | "frequent" | "recent" | "favorites")}
                        className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                          isActive
                            ? "bg-cyan-600 text-white"
                            : "border border-slate-200 bg-white text-slate-600 hover:border-cyan-300"
                        }`}
                      >
                        {mode.label} <span className="opacity-80">({mode.count})</span>
                      </button>
                    );
                  })}
                </div>

                <div className="sm:hidden">
                  <select
                    value={serviceCategory}
                    onChange={(e) => setServiceCategory(e.target.value)}
                    className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none focus:border-cyan-400 focus:ring-4 focus:ring-cyan-100"
                  >
                    {categoryTabs.map((category) => (
                      <option key={category.key} value={category.key}>
                        {category.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="hidden flex-wrap gap-2 sm:flex">
                  {categoryTabs.map((category) => {
                    const isActive = serviceCategory === category.key;
                    return (
                      <button
                        key={category.key}
                        type="button"
                        onClick={() => setServiceCategory(category.key)}
                        className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                          isActive
                            ? "bg-slate-900 text-white"
                            : "border border-slate-200 bg-white text-slate-600 hover:border-cyan-300"
                        }`}
                      >
                        {category.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="mt-4 lg:max-h-[58vh] lg:overflow-y-auto lg:pr-1">
              {filteredServices.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
                  No services found. Try a different search or filter.
                </div>
              ) : serviceCategory === "all" ? (
                <div className="space-y-4">
                  {groupedFilteredServices.map(({ categoryName, services: categoryServices }) => {
                    const isCollapsed = !!collapsedServiceCategories[categoryName];
                    return (
                      <section key={categoryName} className="rounded-2xl border border-slate-200 bg-white p-3 sm:p-4">
                        <button
                          type="button"
                          onClick={() =>
                            setCollapsedServiceCategories((current) => ({
                              ...current,
                              [categoryName]: !current[categoryName],
                            }))
                          }
                          className="flex w-full items-center justify-between gap-3 text-left"
                        >
                          <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-slate-700">
                            {categoryName}
                          </h3>
                          <span className="text-xs font-semibold text-slate-500">
                            {categoryServices.length} {categoryServices.length === 1 ? "service" : "services"} {isCollapsed ? "▸" : "▾"}
                          </span>
                        </button>
                        {!isCollapsed && (
                          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                            {categoryServices.map((service) => {
                              const serviceId = String(service.id || "");
                              const selectedCount = selectedServiceCountById.get(serviceId) || 0;
                              const displayName = getServiceDisplayName(service);
                              const variant = getServiceVariant(service);
                              const isVariable = service.pricing_type === 'variable';
                              const basePrice = Number(service.promo_price ?? service.standard_price ?? service.price ?? 0);
                              const isFavorite = favoriteServiceIds.includes(serviceId);
                              return (
                                <div key={service.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                      <p className="text-sm font-semibold text-slate-900">{displayName}</p>
                                      {variant && <p className="mt-0.5 text-xs text-slate-500">{variant}</p>}
                                    </div>
                                    <div className="flex items-center gap-1">
                                      <button
                                        type="button"
                                        onClick={() => toggleFavorite(serviceId)}
                                        className={`rounded-full px-2 py-1 text-xs font-semibold ${
                                          isFavorite ? "bg-amber-100 text-amber-700" : "bg-white text-slate-500"
                                        }`}
                                        title={isFavorite ? "Remove from favorites" : "Add to favorites"}
                                      >
                                        ★
                                      </button>
                                      {isVariable ? (
                                        <span className="rounded-xl bg-violet-100 px-2.5 py-1 text-xs font-semibold text-violet-700">
                                          {service.min_price != null && service.max_price != null
                                            ? `AED ${Number(service.min_price).toFixed(0)}–${Number(service.max_price).toFixed(0)}`
                                            : `AED ${basePrice.toFixed(0)}`}
                                        </span>
                                      ) : (
                                        <span className="rounded-xl bg-cyan-100 px-2.5 py-1 text-xs font-semibold text-cyan-700">
                                          {fmtServicePrice(basePrice, 0)}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                  <div className="mt-2 flex flex-wrap gap-1.5">
                                    {Number(service.default_visit_count || 1) > 1 && (
                                      <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">
                                        Default visits: {Number(service.default_visit_count)}
                                      </span>
                                    )}
                                    {service.active_plan_recommended && (
                                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                                        Active Plan recommended
                                      </span>
                                    )}
                                    {service.tooth_selection_mode === "required" && (
                                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                                        Tooth required
                                      </span>
                                    )}
                                    {service.tooth_selection_mode === "optional" && (
                                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                                        Tooth optional
                                      </span>
                                    )}
                                  </div>
                                  <div className="mt-3 flex items-center justify-between gap-2">
                                    <button
                                      type="button"
                                      onClick={() => addService(service)}
                                      className="rounded-xl bg-cyan-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-cyan-500"
                                    >
                                      {selectedCount > 0 ? "Add again" : "Add"}
                                    </button>
                                    {selectedCount > 0 && (
                                      <span className="rounded-full bg-teal-100 px-2.5 py-1 text-xs font-semibold text-teal-700">
                                        ✓ Selected {selectedCount > 1 ? `(${selectedCount})` : ""}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </section>
                    );
                  })}
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {filteredServices.map((service) => {
                    const serviceId = String(service.id || "");
                    const selectedCount = selectedServiceCountById.get(serviceId) || 0;
                    const displayName = getServiceDisplayName(service);
                    const variant = getServiceVariant(service);
                    const isVariable = service.pricing_type === 'variable';
                    const basePrice = Number(service.promo_price ?? service.standard_price ?? service.price ?? 0);
                    const isFavorite = favoriteServiceIds.includes(serviceId);
                    return (
                      <div key={service.id} className="rounded-2xl border border-slate-200 bg-white p-3 text-left shadow-sm">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-slate-900">{displayName}</p>
                            {variant && <p className="mt-0.5 text-xs text-slate-500">{variant}</p>}
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => toggleFavorite(serviceId)}
                              className={`rounded-full px-2 py-1 text-xs font-semibold ${
                                isFavorite ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-500"
                              }`}
                              title={isFavorite ? "Remove from favorites" : "Add to favorites"}
                            >
                              ★
                            </button>
                            {isVariable ? (
                              <span className="rounded-xl bg-violet-100 px-2.5 py-1 text-xs font-semibold text-violet-700">
                                {service.min_price != null && service.max_price != null
                                  ? `AED ${Number(service.min_price).toFixed(0)}–${Number(service.max_price).toFixed(0)}`
                                  : `AED ${basePrice.toFixed(0)}`}
                              </span>
                            ) : (
                              <span className="rounded-xl bg-cyan-100 px-2.5 py-1 text-xs font-semibold text-cyan-700">
                                {fmtServicePrice(basePrice, 0)}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {Number(service.default_visit_count || 1) > 1 && (
                            <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">
                              Default visits: {Number(service.default_visit_count)}
                            </span>
                          )}
                          {service.active_plan_recommended && (
                            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                              Active Plan recommended
                            </span>
                          )}
                          {service.tooth_selection_mode === "required" && (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                              Tooth required
                            </span>
                          )}
                          {service.tooth_selection_mode === "optional" && (
                            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                              Tooth optional
                            </span>
                          )}
                        </div>
                        <div className="mt-3 flex items-center justify-between gap-2">
                          <button
                            type="button"
                            onClick={() => addService(service)}
                            className="rounded-xl bg-cyan-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-cyan-500"
                          >
                            {selectedCount > 0 ? "Add again" : "Add"}
                          </button>
                          {selectedCount > 0 && (
                            <span className="rounded-full bg-teal-100 px-2.5 py-1 text-xs font-semibold text-teal-700">
                              ✓ Selected {selectedCount > 1 ? `(${selectedCount})` : ""}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {patientId && selectedPatientBalancesInClinic.length > 0 && (
              <div className="mt-4 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-amber-800">
                      Outstanding Balance
                    </p>
                    <p className="mt-1 text-sm text-amber-900">
                      This patient has {selectedPatientBalancesInClinic.length} unpaid balance{selectedPatientBalancesInClinic.length > 1 ? "s" : ""} totalling{" "}
                      <span className="font-bold">
                        AED {selectedPatientBalancesInClinic.reduce((s, x) => s + x.rollup.remaining, 0).toFixed(2)}
                      </span>
                      .
                    </p>
                  </div>
                </div>
                <ul className="mt-2 space-y-1">
                  {selectedPatientBalancesInClinic.map(({ balance, payments, rollup }) => (
                    <li key={balance.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white px-3 py-2 text-xs">
                      <span className="text-slate-700">
                        {new Date(balance.original_date).toLocaleDateString("en-GB")} · {formatBalanceReference(balance)} · AED {rollup.remaining.toFixed(2)}
                      </span>
                      <button
                        onClick={() => {
                          if (!receptionistId) { alert("Open the register first."); return; }
                          const patientRow = patients.find((p) => p.id === patientId);
                          if (!patientRow) { alert("Patient not found — refresh the page and try again."); return; }
                          setCollectBalanceContext({ balance, payments, patient: patientRow });
                        }}
                        className="rounded-xl bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-500"
                      >
                        Collect Payment
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {patientId && patientActivePlans.length > 0 && (
              <div className="mt-4 rounded-2xl border border-cyan-300 bg-cyan-50 px-4 py-3">
                <p className="mb-2 text-xs font-bold uppercase tracking-wide text-cyan-800">
                  Active Treatment Plans
                </p>
                {isLoadingActivePlans ? (
                  <p className="text-xs text-cyan-600">Loading…</p>
                ) : (
                  <div className="space-y-2">
                    {patientActivePlans.map((plan) => {
                      const planPayments = patientActivePlanPayments.filter((p: any) => p.treatment_plan_id === plan.id);
                      const planPaymentRecords = patientActivePlanPaymentRecords.filter((p: any) => p.treatment_plan_id === plan.id);
                      const planVisits = patientActivePlanVisits.filter((v: any) => v.treatment_plan_id === plan.id);
                      const rollup = computeTreatmentPlanRollup(plan, {
                        structuredPayments: planPaymentRecords,
                        legacyPayments: planPayments,
                      });
                      const remaining = rollup.remainingBalance;
                      return (
                        <div key={plan.id} className="flex items-center justify-between gap-3 rounded-xl bg-white px-3 py-2 text-xs">
                          <div>
                            <span className="font-semibold text-slate-800">{plan.title}</span>
                            <span className="ml-2 text-slate-500">
                              Visit {planVisits.length}/{plan.planned_visits} · AED {remaining.toFixed(2)} due
                            </span>
                          </div>
                          <button
                            onClick={openSearchPatientPicker}
                            className="rounded-xl bg-cyan-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-cyan-500"
                          >
                            Continue Plan
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <aside className="space-y-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6 lg:sticky lg:top-24 lg:self-start lg:z-20">
          <div className="rounded-3xl border border-teal-300 bg-gradient-to-br from-teal-100 to-cyan-100 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-teal-600">Cart</p>
                <h2 className="mt-2 text-xl font-semibold text-teal-900">Selected services</h2>
              </div>
              <span className="rounded-full bg-teal-500 px-3 py-1 text-sm font-semibold text-white">
                {selectedServices.length} items
              </span>
            </div>

            <div className="mt-5 space-y-3 lg:max-h-[44vh] lg:overflow-y-auto lg:pr-1">
              {selectedServices.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-teal-400 bg-white/50 px-4 py-8 text-center text-sm text-teal-600">
                  Add services to build the receipt.
                </div>
              ) : (
                selectedServices.map((service, index) => {
                  const lineSummary = pricingSummary.lineDetails[index];
                  const vatConfigured = lineSummary?.isVatConfigured ?? false;
                  const vatLabel = lineSummary ? getServiceVatLabel(lineSummary.vatRate) : "VAT not configured";
                  return (
                  <div
                    key={`${service.id}-${index}`}
                    className={`flex items-center justify-between rounded-2xl border bg-white p-4 shadow-sm ${
                      vatConfigured ? "border-teal-200" : "border-rose-300"
                    }`}
                  >
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-teal-500 text-xs font-bold text-white">
                        {index + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold text-teal-900">{service.name}</p>
                        {service.requires_quantity ? (
                          <div className="mt-1 space-y-1.5">
                            <div className="flex items-center gap-1.5 text-xs">
                              {service.originalPrice != null && (
                                <span className="text-slate-400 line-through">AED {Number(service.originalPrice).toFixed(2)}</span>
                              )}
                              <span className="text-teal-600">AED</span>
                              <input
                                type="number"
                                min={service.isVariablePriced && service.minPrice != null ? service.minPrice : 0}
                                max={service.isVariablePriced && service.maxPrice != null ? service.maxPrice : undefined}
                                step="0.01"
                                value={Number(service.price)}
                                onChange={(e) => updateCartItemPrice(index, e.target.value)}
                                className="w-20 rounded-lg border border-teal-200 bg-teal-50 px-2 py-0.5 font-semibold text-teal-900 outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
                              />
                              <span className="text-slate-500">per {service.billing_unit || "Unit"}</span>
                            </div>
                            {service.isVariablePriced && service.minPrice != null && service.maxPrice != null && (
                              <p className="text-[10px] text-violet-500">Range: AED {Number(service.minPrice).toFixed(0)}–{Number(service.maxPrice).toFixed(0)}</p>
                            )}
                            <div className="flex flex-wrap items-center gap-2 text-[11px]">
                              <span className={`rounded-full px-2 py-0.5 font-semibold ${
                                vatConfigured
                                  ? lineSummary?.vatRate === 0.05
                                    ? "bg-emerald-100 text-emerald-700"
                                    : "bg-slate-100 text-slate-700"
                                  : "bg-rose-100 text-rose-700"
                              }`}>
                                {vatLabel}
                              </span>
                              {lineSummary && vatConfigured && (
                                <span className="text-slate-500">
                                  Taxable AED {lineSummary.taxableAmount.toFixed(2)} + VAT AED {lineSummary.vatAmount.toFixed(2)} = AED {lineSummary.finalLineTotal.toFixed(2)}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => updateCartItemQuantity(index, (service.quantity ?? 1) - 1)}
                                className="flex h-6 w-6 items-center justify-center rounded-lg bg-teal-100 text-sm font-bold text-teal-700 hover:bg-teal-200"
                              >−</button>
                              <input
                                type="number"
                                min="1"
                                value={service.quantity ?? 1}
                                onChange={(e) => updateCartItemQuantity(index, Number(e.target.value))}
                                className="w-12 rounded-lg border border-teal-200 bg-teal-50 px-2 py-0.5 text-center text-xs font-semibold text-teal-900 outline-none focus:border-teal-400"
                              />
                              <button
                                onClick={() => updateCartItemQuantity(index, (service.quantity ?? 1) + 1)}
                                className="flex h-6 w-6 items-center justify-center rounded-lg bg-teal-100 text-sm font-bold text-teal-700 hover:bg-teal-200"
                              >+</button>
                              <span className="text-xs text-slate-500">{service.billing_unit || "Unit"}</span>
                              <span className="ml-auto text-xs font-bold text-teal-900">
                                = {fmtServicePrice(Number(service.price) * (service.quantity ?? 1))}
                              </span>
                            </div>
                          </div>
                        ) : (
                          <div className="mt-1 space-y-0.5">
                            <div className="flex items-center gap-1.5">
                              {service.originalPrice != null && (
                                <span className="text-xs text-slate-400 line-through">AED {Number(service.originalPrice).toFixed(2)}</span>
                              )}
                              {Number(service.price) === 0 && !service.isVariablePriced ? (
                                <span className="rounded-lg bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">Free</span>
                              ) : (
                                <>
                                  <span className="text-xs font-medium text-teal-600">AED</span>
                                  <input
                                    type="number"
                                    min={service.isVariablePriced && service.minPrice != null ? service.minPrice : 0}
                                    max={service.isVariablePriced && service.maxPrice != null ? service.maxPrice : undefined}
                                    step="0.01"
                                    value={Number(service.price)}
                                    onChange={(e) => updateCartItemPrice(index, e.target.value)}
                                    className="w-20 rounded-lg border border-teal-200 bg-teal-50 px-2 py-0.5 text-xs font-semibold text-teal-900 outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
                                  />
                                </>
                              )}
                            </div>
                            {service.isVariablePriced && service.minPrice != null && service.maxPrice != null && (
                              <p className="text-[10px] text-violet-500">Range: AED {Number(service.minPrice).toFixed(0)}–{Number(service.maxPrice).toFixed(0)}</p>
                            )}
                            <div className="flex flex-wrap items-center gap-2 text-[11px]">
                              <span className={`rounded-full px-2 py-0.5 font-semibold ${
                                vatConfigured
                                  ? lineSummary?.vatRate === 0.05
                                    ? "bg-emerald-100 text-emerald-700"
                                    : "bg-slate-100 text-slate-700"
                                  : "bg-rose-100 text-rose-700"
                              }`}>
                                {vatLabel}
                              </span>
                              {lineSummary && vatConfigured && (
                                <span className="text-slate-500">
                                  Taxable AED {lineSummary.taxableAmount.toFixed(2)} + VAT AED {lineSummary.vatAmount.toFixed(2)} = AED {lineSummary.finalLineTotal.toFixed(2)}
                                </span>
                              )}
                            </div>
                          </div>
                        )}
                        {shouldShowTeethInput(service) && (
                          <div className="mt-1.5 space-y-1.5">
                            {getTeethForItem(index).length > 0 && (
                              <div className="flex flex-wrap gap-1">
                                {getTeethForItem(index).map((tooth) => (
                                  <button
                                    key={`${index}-${tooth}`}
                                    type="button"
                                    onClick={() => removeToothFromCartItem(index, tooth)}
                                    className="rounded-full bg-teal-100 px-2 py-0.5 text-[11px] font-semibold text-teal-800"
                                    title="Remove tooth"
                                  >
                                    #{tooth} ×
                                  </button>
                                ))}
                              </div>
                            )}
                            <div className="flex items-center gap-1.5">
                              <input
                                type="text"
                                inputMode="numeric"
                                placeholder={serviceToothSelectionMode(service) === "required" ? "Add tooth # (required)" : "Add tooth #"}
                                value={cartItemToothDrafts[index] || ""}
                                onChange={(e) => setCartItemToothDraft(index, e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    addToothToCartItem(index);
                                  }
                                }}
                                className="w-full rounded-lg border border-teal-100 bg-teal-50 px-2 py-1 text-xs text-teal-700 outline-none placeholder:text-teal-300 focus:border-teal-300"
                              />
                              <button
                                type="button"
                                onClick={() => addToothToCartItem(index)}
                                className="rounded-lg bg-teal-600 px-2 py-1 text-[11px] font-semibold text-white"
                              >
                                Add
                              </button>
                            </div>
                            <p className="text-[11px] text-teal-700/80">Tip: enter one or many (e.g. 14 or 14,15).</p>
                          </div>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => removeService(index)}
                      className="rounded-full bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-500 transition hover:bg-red-100 hover:text-red-600"
                    >
                      Remove
                    </button>
                  </div>
                )})
              )}
            </div>
          </div>

          <div className="rounded-3xl bg-slate-950 p-5 text-white shadow-lg">
            <div className="space-y-3 text-sm text-slate-300">
              {hasUnconfiguredVatServices && (
                <div className="rounded-2xl border border-rose-300 bg-rose-500/10 px-3 py-2 text-rose-200">
                  VAT not configured for {unconfiguredVatLines.map((line) => line.serviceName).join(", ")}. Configure VAT in Backend &gt; Services before checkout.
                </div>
              )}
              <div className="flex items-center justify-between">
                <span>Subtotal</span>
                <span>AED {subtotal.toFixed(2)}</span>
              </div>
              {manualDiscountAmount > 0 && (
                <div className="flex items-center justify-between text-amber-300">
                  <span>Promo / Price Adjustments</span>
                  <span>- AED {manualDiscountAmount.toFixed(2)}</span>
                </div>
              )}
              {globalDiscountAmount > 0 && (
                <div className="flex items-center justify-between text-rose-400">
                  <span>Global Discount {discountType === "%" ? `(${discountInput}%)` : ""}</span>
                  <span>- AED {globalDiscountAmount.toFixed(2)}</span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span>Taxable Subtotal</span>
                <span>AED {preVatTotal.toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>VAT</span>
                <span>AED {vat.toFixed(2)}</span>
              </div>
              <div className="border-t border-white/10 pt-4 text-base font-semibold text-white">
                <div className="flex items-center justify-between">
                  <span>Total</span>
                  <span>AED {total.toFixed(2)}</span>
                </div>
              </div>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-1">
              <button
                onClick={proceedToPayment}
                disabled={isProceeding || hasUnconfiguredVatServices}
                className="inline-flex items-center justify-center rounded-3xl bg-cyan-500 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-cyan-500/20 transition hover:bg-cyan-400 disabled:opacity-50"
              >
                {isProceeding ? "Processing..." : "Proceed to Payment"}
              </button>
            </div>

            {showPaymentModal && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                <div className="mx-4 flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
                  <div className="shrink-0 border-b border-slate-200 px-5 py-4">
                    <h3 className="text-lg font-semibold text-slate-900">PAYMENT</h3>
                  </div>

                  <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-5">
                  <div className="mb-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Amount Due</p>
                    <p className="mt-1 text-2xl font-bold text-slate-900">AED {getAmountDueToday().toFixed(2)}</p>
                    {checkoutAvailableCredit > 0.0049 && (
                      <div className="mt-3 space-y-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2">
                        <div className="flex items-center justify-between text-sm text-emerald-800">
                          <span>Available Patient Credit</span>
                          <span className="font-semibold">AED {checkoutAvailableCredit.toFixed(2)}</span>
                        </div>
                        <label className="flex items-center gap-2 text-sm font-semibold text-emerald-800">
                          <input
                            type="checkbox"
                            checked={applyCreditChecked}
                            onChange={(e) => setApplyCreditChecked(e.target.checked)}
                            className="h-4 w-4 accent-emerald-600"
                          />
                          Apply Patient Credit
                        </label>
                        {applyCreditChecked && (
                          <>
                            <div className="flex items-center justify-between text-sm text-emerald-800">
                              <span>Credit Applied</span>
                              <span className="font-semibold">- AED {getCreditApplied().toFixed(2)}</span>
                            </div>
                            <div className="flex items-center justify-between border-t border-emerald-200 pt-1 text-sm font-bold text-emerald-900">
                              <span>Remaining Amount Due</span>
                              <span>AED {getRemainingAfterCredit().toFixed(2)}</span>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                    {getRemainingAfterCredit() <= 0.0049 && (
                      <p className="mt-2 text-xs font-semibold text-emerald-700">
                        Fully covered by patient credit — no payment method needed.
                      </p>
                    )}
                  </div>

                  {getRemainingAfterCredit() > 0.0049 && (
                  <>
                  <p className="mb-2 text-xs text-slate-500">
                    Choose how to collect this payment.
                  </p>
                  <div className="grid gap-3">
                    {paymentOptions.map((method) => (
                      <button
                        key={method}
                        onClick={() => selectPaymentMethod(method)}
                        className={`rounded-2xl border px-4 py-3 text-sm font-semibold transition ${
                          selectedPaymentMethod === method
                            ? "border-cyan-500 bg-cyan-50 text-cyan-700"
                            : "border-slate-200 bg-slate-50 text-slate-900 hover:border-cyan-400 hover:bg-cyan-50"
                        }`}
                      >
                        {method}
                      </button>
                    ))}
                  </div>

                  {selectedPaymentMethod && (
                    <div className="mt-4 space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                      {paymentAllocationDrafts.map((row, index) => {
                        const allowedVariants = allowedVariantsForSelectedMethod(selectedPaymentMethod);
                        const computedRow = previewAllocations.find((entry) => entry.id === row.id);
                        const methodVariant = row.methodVariant as PaymentMethodVariant;
                        const isSplit = selectedPaymentMethod === "Split Payment";
                        const isCashRow = methodVariant === "cash";
                        const isTabbyRow = methodVariant === "tabby_standard" || methodVariant === "tabby_card";
                        const isTamaraRow = methodVariant === "tamara";
                        const cashChange = getCashChangeForDraft(row);
                        return (
                          <div key={row.id} className="rounded-xl border border-slate-200 bg-white p-3">
                            {isSplit && (
                              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.15em] text-slate-500">
                                Payment {index + 1}
                              </p>
                            )}
                            <div className="grid gap-2 sm:grid-cols-2">
                              <div>
                                <label className="block text-xs font-semibold text-slate-600">Payment Method</label>
                                {isSplit ? (
                                  <select
                                    value={row.methodVariant}
                                    onChange={(e) => updateAllocationDraft(row.id, { methodVariant: e.target.value as PaymentMethodVariant })}
                                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                                  >
                                    <option value="">Select</option>
                                    {allocationMethodOptions.filter((opt) => allowedVariants.includes(opt.value)).map((opt) => (
                                      <option key={opt.value} value={opt.value}>
                                        {opt.label}
                                      </option>
                                    ))}
                                  </select>
                                ) : (
                                  <div className="mt-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-900">
                                    {paymentVariantLabel(methodVariant)}
                                  </div>
                                )}
                              </div>
                              <div>
                                <label className="block text-xs font-semibold text-slate-600">
                                  {isSplit ? "Invoice Amount Allocated (AED)" : "Invoice Amount (AED)"}
                                </label>
                                {isSplit ? (
                                  <input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={row.invoiceAllocationAmountInput}
                                    onChange={(e) => updateAllocationDraft(row.id, { invoiceAllocationAmountInput: e.target.value })}
                                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                                  />
                                ) : (
                                  <div className="mt-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-900">
                                    AED {getInvoiceAllocationAmountFromDraft(row).toFixed(2)}
                                  </div>
                                )}
                              </div>
                              {referenceRequiredForVariant(methodVariant) && (
                                <div>
                                  <label className="block text-xs font-semibold text-slate-600">Provider Reference Number</label>
                                  <input
                                    type="text"
                                    value={row.providerReferenceNumber}
                                    onChange={(e) => updateAllocationDraft(row.id, { providerReferenceNumber: e.target.value })}
                                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                                  />
                                </div>
                              )}
                              {methodVariant === "tabby_card" && (
                                <div>
                                  <label className="block text-xs font-semibold text-slate-600">Terminal Authorization Code (optional)</label>
                                  <input
                                    type="text"
                                    value={row.terminalAuthorizationCode}
                                    onChange={(e) => updateAllocationDraft(row.id, { terminalAuthorizationCode: e.target.value })}
                                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                                  />
                                </div>
                              )}
                              {methodVariant === "card" && (
                                <div>
                                  <label className="block text-xs font-semibold text-slate-600">Card Network (optional)</label>
                                  <div className="mt-2 flex items-center gap-4 text-sm text-slate-700">
                                    <label className="inline-flex items-center gap-2">
                                      <input
                                        type="checkbox"
                                        checked={row.cardNetwork.toLowerCase() === "visa"}
                                        onChange={(e) =>
                                          updateAllocationDraft(row.id, {
                                            cardNetwork: e.target.checked ? "Visa" : "",
                                          })
                                        }
                                        className="h-4 w-4 accent-cyan-600"
                                      />
                                      Visa
                                    </label>
                                    <label className="inline-flex items-center gap-2">
                                      <input
                                        type="checkbox"
                                        checked={row.cardNetwork.toLowerCase() === "mastercard"}
                                        onChange={(e) =>
                                          updateAllocationDraft(row.id, {
                                            cardNetwork: e.target.checked ? "Mastercard" : "",
                                          })
                                        }
                                        className="h-4 w-4 accent-cyan-600"
                                      />
                                      Mastercard
                                    </label>
                                  </div>
                                </div>
                              )}
                            </div>
                            {isCashRow && (
                              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                                <div>
                                  <label className="block text-xs font-semibold text-slate-600">Cash Received (AED)</label>
                                  <input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={cashReceivedByRow[row.id] || ""}
                                    onChange={(e) => setCashReceivedByRow((current) => ({ ...current, [row.id]: e.target.value }))}
                                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                                  />
                                </div>
                                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2">
                                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700">Change</p>
                                  <p className="mt-1 text-lg font-bold text-emerald-800">AED {cashChange.toFixed(2)}</p>
                                </div>
                              </div>
                            )}
                            {(isTabbyRow || isTamaraRow) && (
                              <div className="mt-3 rounded-xl border border-cyan-200 bg-cyan-50 px-3 py-2">
                                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-700">
                                  Amount to Collect via {isTabbyRow ? paymentVariantLabel(methodVariant) : "Tamara"}
                                </p>
                                <p className="mt-1 text-lg font-bold text-cyan-900">
                                  AED {(computedRow?.customerChargedAmount || 0).toFixed(2)}
                                </p>
                              </div>
                            )}
                            {selectedPaymentMethod === "Split Payment" && paymentAllocationDrafts.length > 2 && index > 1 && (
                              <button
                                type="button"
                                onClick={() => {
                                  setPaymentAllocationDrafts((rows) => rows.filter((draft) => draft.id !== row.id));
                                  setCashReceivedByRow((current) => {
                                    const updated = { ...current };
                                    delete updated[row.id];
                                    return updated;
                                  });
                                }}
                                className="mt-2 text-xs font-semibold text-rose-600 hover:text-rose-500"
                              >
                                Remove this row
                              </button>
                            )}
                          </div>
                        );
                      })}

                      {selectedPaymentMethod === "Split Payment" && (
                        <button
                          type="button"
                          onClick={addAnotherPaymentMethodRow}
                          className="w-full rounded-xl border border-dashed border-cyan-300 bg-cyan-50 px-3 py-2 text-sm font-semibold text-cyan-700 hover:bg-cyan-100"
                        >
                          + Add Payment Method
                        </button>
                      )}
                    </div>
                  )}

                  {(paymentValidationErrors.length > 0 || livePaymentValidation.length > 0 || getCashTenderValidationErrors().length > 0) && (
                    <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                      {[...new Set([
                        ...paymentValidationErrors,
                        ...livePaymentValidation.map((error) => error.message),
                        ...getCashTenderValidationErrors(),
                      ])].map((message) => (
                        <p key={message}>• {message}</p>
                      ))}
                    </div>
                  )}
                  </>
                  )}
                  </div>

                  <div className="shrink-0 border-t border-slate-200 bg-white p-4">
                    {selectedPaymentMethod === "Split Payment" && (
                      <div className="mb-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                        <div className="flex items-center justify-between">
                          <span>Remaining Invoice Balance</span>
                          <span className="font-semibold">
                            AED {Math.max(0, getAmountDueToday() - previewAllocations.reduce((sum, row) => sum + row.invoiceAllocationAmount, 0)).toFixed(2)}
                          </span>
                        </div>
                      </div>
                    )}
                    <button
                      onClick={continueFromPaymentModal}
                      disabled={
                        isSavingReceipt
                        || !isAllocationBalanced
                        || livePaymentValidation.length > 0
                        || getCashTenderValidationErrors().length > 0
                      }
                      className="w-full rounded-2xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-cyan-400 disabled:opacity-50"
                    >
                      {isSavingReceipt ? "Completing Payment..." : "Complete Payment"}
                    </button>
                    <button
                      onClick={() => {
                        setShowPaymentModal(false);
                        setCashReceivedByRow({});
                      }}
                      className="mt-3 w-full rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}

            {paymentCompleteSnapshot && (
              <div className="fixed inset-0 flex items-center justify-center bg-black/50 z-50">
                <div className="rounded-3xl bg-white p-6 shadow-2xl max-w-xl w-full mx-4">
                  <div className="text-center">
                    <div className="mx-auto mb-2 flex h-11 w-11 items-center justify-center rounded-full bg-emerald-100 text-2xl text-emerald-700">
                      ✓
                    </div>
                    <h3 className="text-xl font-semibold text-slate-900">Payment Complete</h3>
                    <p className="mt-1 text-sm text-slate-600">Receipt / Invoice #</p>
                    <p className="text-base font-semibold text-slate-900">{paymentCompleteSnapshot.receiptRef}</p>
                  </div>

                  <div className="mt-4 space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-slate-500">Patient</span>
                      <span className="text-right font-semibold text-slate-900">{paymentCompleteSnapshot.patientName}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-slate-500">Date</span>
                      <span className="text-right font-semibold text-slate-900">{paymentCompleteSnapshot.completedAtLabel}</span>
                    </div>
                  </div>

                  <div className="mt-4 space-y-2">
                    {paymentCompleteSnapshot.lineItems.map((line, index) => (
                      <div key={`${line.name}-${index}`} className="flex items-center justify-between gap-3 text-sm">
                        <span className="text-slate-700">{line.name} × {line.quantity}</span>
                        <span className="font-semibold text-slate-900">AED {line.amount.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>

                  <div className="mt-4 border-t border-slate-200 pt-3 space-y-1.5 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-600">Subtotal</span>
                      <span className="font-semibold text-slate-900">AED {paymentCompleteSnapshot.subtotal.toFixed(2)}</span>
                    </div>
                    {paymentCompleteSnapshot.discount > 0.0049 && (
                      <div className="flex items-center justify-between text-amber-700">
                        <span>Promo / Price Adjustments</span>
                        <span className="font-semibold">- AED {paymentCompleteSnapshot.discount.toFixed(2)}</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between">
                      <span className="text-slate-600">VAT</span>
                      <span className="font-semibold text-slate-900">AED {paymentCompleteSnapshot.vat.toFixed(2)}</span>
                    </div>
                    <div className="flex items-center justify-between border-t border-slate-200 pt-2 text-base">
                      <span className="font-semibold text-slate-900">Total Paid</span>
                      <span className="font-bold text-slate-900">AED {paymentCompleteSnapshot.totalPaid.toFixed(2)}</span>
                    </div>
                  </div>

                  <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm">
                    <p className="font-semibold text-slate-900">Payment</p>
                    {paymentCompleteSnapshot.paymentRows.map((row, index) => (
                      <div key={`${row.label}-${index}`} className="mt-1 flex items-center justify-between">
                        <span className="text-slate-700">{row.label}</span>
                        <span className="font-semibold text-slate-900">AED {row.amount.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>

                  <div className="grid gap-3">
                    <button
                      onClick={() => printReceipt(paymentCompleteSnapshot.receipt)}
                      className="inline-flex items-center justify-center rounded-2xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-cyan-400"
                    >
                      Print Receipt
                    </button>
                    <button
                      onClick={finalizeSuccessfulTransaction}
                      className="inline-flex items-center justify-center rounded-2xl border border-cyan-300 bg-cyan-50 px-4 py-2 text-sm font-semibold text-cyan-700 transition hover:bg-cyan-100"
                    >
                      Done
                    </button>
                  </div>
                </div>
              </div>
            )}

            {showCashDeductionModal && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
                <div className="mx-4 w-full max-w-lg rounded-3xl bg-white p-6 text-slate-900 shadow-2xl">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-semibold text-slate-900">Expense / Commission</h3>
                    </div>
                    <button
                      onClick={() => {
                        if (isSavingCashDeduction) return;
                        setShowCashDeductionModal(false);
                        resetCashDeductionForm();
                      }}
                      className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-500 transition hover:bg-slate-50"
                    >
                      Close
                    </button>
                  </div>

                  {expenseFeatureEnabled && commissionFeatureEnabled && (
                    <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Type</p>
                      <div className="mt-3 flex flex-wrap gap-3">
                        {(["expense", "commission"] as CashDeductionType[]).map((type) => (
                          <label key={type} className="inline-flex items-center gap-2 text-sm font-medium text-slate-700">
                            <input
                              type="radio"
                              name="cashDeductionType"
                              value={type}
                              checked={cashDeductionType === type}
                              onChange={() => {
                                setCashDeductionType(type);
                                setCashDeductionStaffId("");
                              }}
                              className="h-4 w-4 accent-violet-600"
                            />
                            {getCashDeductionTypeLabel(type)}
                          </label>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="mt-4 grid gap-4">
                    {cashDeductionType === "commission" ? (
                      <div className="space-y-2">
                        <label className="block text-sm font-semibold text-slate-700">Commission For</label>
                        <select
                          value={cashDeductionStaffId}
                          onChange={(e) => {
                            const nextStaffId = e.target.value;
                            setCashDeductionStaffId(nextStaffId);
                          }}
                          className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-violet-400 focus:bg-white focus:ring-4 focus:ring-violet-100"
                        >
                          <option value="">Select Aesthetician / Staff</option>
                          {clinicCommissionStaff.map((doctor) => (
                            <option key={doctor.id} value={doctor.id}>
                              {doctor.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : null}

                    <div className="space-y-2">
                      <label className="block text-sm font-semibold text-slate-700">Amount (AED)</label>
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={cashDeductionAmountInput}
                        onChange={(e) => setCashDeductionAmountInput(e.target.value)}
                        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-violet-400 focus:bg-white focus:ring-4 focus:ring-violet-100"
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="block text-sm font-semibold text-slate-700">Description</label>
                      <textarea
                        value={cashDeductionDescription}
                        onChange={(e) => setCashDeductionDescription(e.target.value)}
                        rows={3}
                        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-violet-400 focus:bg-white focus:ring-4 focus:ring-violet-100"
                      />
                    </div>
                  </div>

                  <div className="mt-5 grid gap-3 sm:grid-cols-2">
                    <button
                      onClick={() => {
                        if (isSavingCashDeduction) return;
                        setShowCashDeductionModal(false);
                        resetCashDeductionForm();
                      }}
                      disabled={isSavingCashDeduction}
                      className="inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={saveCashDeduction}
                      disabled={isSavingCashDeduction}
                      className="inline-flex items-center justify-center rounded-2xl bg-violet-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet-600 disabled:opacity-50"
                    >
                      {isSavingCashDeduction ? "Saving..." : "Save"}
                    </button>
                  </div>

                  <div className="mt-5 border-t border-slate-200 pt-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Recent Entries</p>
                    <div className="mt-3 max-h-56 space-y-2 overflow-y-auto">
                      {isLoadingCashDeductions ? (
                        <p className="text-sm text-slate-500">Loading...</p>
                      ) : cashDeductions.length === 0 ? (
                        <p className="rounded-2xl border border-dashed border-slate-200 px-4 py-3 text-sm text-slate-500">
                          No expense or commission entries in this register session.
                        </p>
                      ) : (
                        cashDeductions.map((entry) => (
                          <div key={entry.id} className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="text-xs font-semibold text-slate-700">
                                  {getCashDeductionTypeLabel(entry.type)} · AED {Number(entry.amount || 0).toFixed(2)}
                                </p>
                                <p className="truncate text-sm text-slate-900">{entry.description}</p>
                                <p className="text-[11px] text-slate-500">
                                  {new Date(entry.created_at).toLocaleString()}
                                  {entry.status === "voided" ? " · Voided" : ""}
                                </p>
                              </div>
                              {entry.status === "active" && (
                                <div className="flex shrink-0 gap-1">
                                  <button
                                    onClick={() => openCashDeductionEntry(entry)}
                                    className="rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-700 transition hover:bg-white"
                                  >
                                    Edit
                                  </button>
                                  <button
                                    onClick={() => {
                                      setVoidCashDeductionId(entry.id);
                                      setVoidCashDeductionReason("");
                                      setShowVoidCashDeductionModal(true);
                                    }}
                                    className="rounded-lg border border-rose-200 px-2 py-1 text-[11px] font-semibold text-rose-700 transition hover:bg-rose-50"
                                  >
                                    Void
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {showVoidCashDeductionModal && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
                <div className="mx-4 w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
                  <h3 className="text-lg font-semibold text-slate-900">Void Cash Deduction</h3>
                  <p className="mt-1 text-sm text-slate-500">
                    Enter the reason for voiding this entry. The record will remain in history for audit purposes.
                  </p>
                  <div className="mt-4 space-y-2">
                    <label className="block text-sm font-semibold text-slate-700">Void reason</label>
                    <textarea
                      value={voidCashDeductionReason}
                      onChange={(e) => setVoidCashDeductionReason(e.target.value)}
                      rows={3}
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-rose-400 focus:ring-4 focus:ring-rose-100"
                    />
                  </div>
                  <div className="mt-5 grid gap-3 sm:grid-cols-2">
                    <button
                      onClick={voidCashDeduction}
                      disabled={isVoidingCashDeduction}
                      className="inline-flex items-center justify-center rounded-2xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-500 disabled:opacity-50"
                    >
                      {isVoidingCashDeduction ? "Voiding..." : "Confirm Void"}
                    </button>
                    <button
                      onClick={() => {
                        if (isVoidingCashDeduction) return;
                        setShowVoidCashDeductionModal(false);
                        setVoidCashDeductionId("");
                        setVoidCashDeductionReason("");
                      }}
                      disabled={isVoidingCashDeduction}
                      className="inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}

            {showCloseRegisterModal && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
                <div className="mx-4 w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
                  <h3 className="mb-2 text-lg font-semibold text-slate-900">Close Register</h3>
                  <p className="text-sm text-slate-600">
                    Enter cash currently in drawer to close cashier for this shift.
                  </p>

                  <div className="mt-4 rounded-2xl border border-teal-200 bg-teal-50 p-4 text-sm text-slate-700">
                    {isLoadingCashSummary ? (
                      <p>Loading expected cash...</p>
                    ) : (
                      <div className="space-y-1">
                        <p>Opening Cash: AED {Number(openingCash || 0).toFixed(2)}</p>
                        <p>Cash Collected During Shift: AED {cashSalesTotal.toFixed(2)}</p>
                        <p>Cash Deductions: AED {Number(cashDeductionSummary.activeDeductionsTotal || 0).toFixed(2)}</p>
                        <p className="font-semibold text-teal-800">
                          Expected Cash Before Closing: AED {expectedCashAmount.toFixed(2)}
                        </p>
                      </div>
                    )}
                  </div>

                  <div className="mt-4 space-y-2">
                    <label className="block text-sm font-semibold text-slate-700">Closing Cash (AED)</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={closingCashInput}
                      onChange={(e) => setClosingCashInput(e.target.value)}
                      placeholder="e.g. 750"
                      className="w-full rounded-2xl border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm text-cyan-950 outline-none transition placeholder:text-cyan-300 focus:border-cyan-400 focus:bg-white focus:ring-4 focus:ring-cyan-100"
                    />
                  </div>

                  <div className="mt-5 grid gap-3 sm:grid-cols-2">
                    <button
                      onClick={closeRegister}
                      className="inline-flex items-center justify-center rounded-2xl bg-teal-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-teal-600"
                    >
                      Confirm Close
                    </button>
                    <button
                      onClick={() => {
                        setShowCloseRegisterModal(false);
                        setClosingCashInput("");
                      }}
                      className="inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}

            {showPatientBackupModal && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
                <div className="mx-4 w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl">
                  <h3 className="text-lg font-semibold text-slate-900">Download Patient Backup</h3>

                  <div className="mt-3 space-y-2 text-sm text-slate-700">
                    <p>
                      <span className="font-semibold">Clinic:</span>{" "}
                      {patientBackupSummary?.clinicName || activeClinic?.name || "-"}
                    </p>
                    <p className="flex items-center gap-2">
                      <span className="font-semibold">Patients:</span>{" "}
                      {isLoadingPatientBackupSummary && !patientBackupSummary ? (
                        <span className="flex items-center gap-1.5 text-slate-400">
                          <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                          </svg>
                          Loading…
                        </span>
                      ) : patientBackupSummary ? (
                        <span className="font-semibold text-teal-700">{patientBackupSummary.patientCount.toLocaleString()}</span>
                      ) : "—"}
                    </p>
                    <p className="flex items-center gap-2">
                      <span className="font-semibold">Treatment records:</span>{" "}
                      {isLoadingPatientBackupSummary && !patientBackupSummary ? (
                        <span className="flex items-center gap-1.5 text-slate-400">
                          <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                          </svg>
                          Loading…
                        </span>
                      ) : patientBackupSummary ? (
                        <span className="font-semibold text-teal-700">{patientBackupSummary.treatmentRecordCount.toLocaleString()}</span>
                      ) : "—"}
                    </p>
                  </div>

                  <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                    This file contains confidential patient information.
                  </div>

                  {/* Download progress bar */}
                  {isDownloadingPatientBackup && (
                    <div className="mt-4 space-y-2">
                      <div className="flex items-center justify-between text-xs font-medium text-cyan-700">
                        <span className="flex items-center gap-1.5">
                          <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                          </svg>
                          Building Excel workbook…
                        </span>
                        <span className="text-slate-400">Please wait</span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full animate-[progressBar_1.6s_ease-in-out_infinite] rounded-full bg-cyan-500" />
                      </div>
                    </div>
                  )}

                  {patientBackupError && (
                    <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                      {patientBackupError}
                    </div>
                  )}

                  <div className="mt-5 grid gap-3 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={downloadPatientBackup}
                      disabled={!patientBackupSummary || isLoadingPatientBackupSummary || isDownloadingPatientBackup}
                      className="inline-flex items-center justify-center gap-2 rounded-2xl bg-cyan-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-cyan-600 disabled:opacity-50"
                    >
                      {isDownloadingPatientBackup ? (
                        <>
                          <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                          </svg>
                          Downloading…
                        </>
                      ) : isLoadingPatientBackupSummary ? (
                        <>
                          <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                          </svg>
                          Preparing…
                        </>
                      ) : (
                        <>
                          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
                          </svg>
                          Download Excel
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (isDownloadingPatientBackup) return;
                        setShowPatientBackupModal(false);
                      }}
                      disabled={isDownloadingPatientBackup}
                      className="inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </aside>
      </div>
      )}

      <div className="pointer-events-none fixed right-4 top-24 z-[80] flex w-72 max-w-[92vw] flex-col gap-2">
        {successToasts.map((toast) => (
          <div
            key={toast.id}
            className="rounded-2xl border border-emerald-200 bg-white px-4 py-3 text-sm font-medium text-slate-800 shadow-lg"
          >
            <span className="mr-2 text-emerald-700">✓</span>
            {toast.message}
          </div>
        ))}
      </div>

      <SearchPatientModal
        isOpen={showSearchPatientModal}
        initialProfilePatientId={searchPatientModalInitialProfileId}
        onClose={() => {
          setShowSearchPatientModal(false);
          setSearchPatientModalInitialProfileId(null);
        }}
        onSelect={(patient) => {
          selectPatient(patient);
          setShowSearchPatientModal(false);
          setSearchPatientModalInitialProfileId(null);
        }}
        patients={clinicScopedPatients}
        clinicId={activeClinic?.id ?? null}
        outstandingBalances={outstandingBalances}
        balancePayments={balancePayments}
        patientCredits={patientCredits}
        clinicsList={clinics}
        clinic={activeClinic ?? null}
        receptionistId={receptionistId || loginReceptionistId || null}
        receptionistName={
          receptionists.find((p: any) => p.id === (receptionistId || loginReceptionistId))?.name || "Reception"
        }
        registerSessionId={registerSessionId || null}
        onCreditSaved={(credit) => setPatientCredits((prev) => [credit, ...prev])}
        onPatientUpdated={(updated) => {
          setPatients((prev) => prev.map((p) => (p.id === updated.id ? { ...p, ...updated } : p)));
          if (patientId === updated.id) selectPatient(updated);
          pushSuccessToast("Patient updated");
        }}
        onCollectBalance={({ balance, payments, patient }) => {
          if (!receptionistId) { alert("Open the register first."); return; }
          setShowSearchPatientModal(false);
          setSearchPatientModalInitialProfileId(null);
          setCollectBalanceContext({ balance, payments, patient });
        }}
      />
      <PosRegisterPatientModal
        isOpen={showRegisterPatientModal}
        clinicId={activeClinic?.id ?? null}
        patients={registrationPatients.length > 0 ? registrationPatients : patients}
        clinicPatientFiles={registrationClinicPatientFiles.length > 0 ? registrationClinicPatientFiles : clinicPatientFiles}
        onClose={() => setShowRegisterPatientModal(false)}
        onPatientRegistered={({ patient, successMessage }) => {
          setPatients((prev) => {
            const exists = prev.some((row) => String(row.id) === String(patient.id));
            if (exists) {
              return prev.map((row) => (String(row.id) === String(patient.id) ? { ...row, ...patient } : row));
            }
            return [...prev, patient];
          });
          setClinicPatientFiles((prev) => {
            const exists = prev.some((row) => String(row.id) === String(patient.clinic_patient_file_id));
            if (exists) return prev;
            return [
              ...prev,
              {
                id: String(patient.clinic_patient_file_id),
                clinic_id: String(activeClinic?.id || ""),
                patient_id: String(patient.id),
                file_no: String(patient.clinic_file_no || ""),
                mrn: patient.clinic_file_mrn || patient.mrn || null,
              },
            ];
          });
          setRegistrationPatients((prev) => {
            const exists = prev.some((row) => String(row.id) === String(patient.id));
            if (exists) {
              return prev.map((row) => (String(row.id) === String(patient.id) ? { ...row, ...patient } : row));
            }
            return [...prev, patient];
          });
          setRegistrationClinicPatientFiles((prev) => {
            const exists = prev.some((row) => String(row.id) === String(patient.clinic_patient_file_id));
            if (exists) {
              return prev.map((row) => (
                String(row.id) === String(patient.clinic_patient_file_id)
                  ? {
                      ...row,
                      clinic_id: String(activeClinic?.id || row.clinic_id || ""),
                      patient_id: String(patient.id),
                      file_no: String(patient.clinic_file_no || ""),
                      mrn: patient.clinic_file_mrn || patient.mrn || null,
                    }
                  : row
              ));
            }
            return [
              ...prev,
              {
                id: String(patient.clinic_patient_file_id),
                clinic_id: String(activeClinic?.id || ""),
                patient_id: String(patient.id),
                file_no: String(patient.clinic_file_no || ""),
                mrn: patient.clinic_file_mrn || patient.mrn || null,
              },
            ];
          });
          selectPatient(patient);
          setShowRegisterPatientModal(false);
          if (successMessage.toLowerCase().includes("registered")) {
            pushSuccessToast("Patient registered");
          } else {
            pushSuccessToast("Patient selected");
          }
        }}
      />
      <ReceiptHistoryModal isOpen={showReceiptHistoryModal} onClose={() => setShowReceiptHistoryModal(false)} clinicId={activeClinic?.id} clinic={activeClinic ?? null} />
      <CollectBalancePaymentModal
        isOpen={collectBalanceContext !== null}
        onClose={() => setCollectBalanceContext(null)}
        balance={collectBalanceContext?.balance ?? null}
        patient={collectBalanceContext?.patient ?? null}
        clinic={activeClinic ?? null}
        existingPayments={collectBalanceContext?.payments ?? []}
        receptionistId={receptionistId || null}
        registerSessionId={registerSessionId || null}
        onCollected={(payment, ctx) => {
          setBalancePayments((prev) => [payment, ...prev]);
          const cashierName =
            receptionists.find((p: any) => p.id === (receptionistId || loginReceptionistId))?.name || "Reception";
          const totalPaidBefore = (collectBalanceContext?.payments || []).reduce(
            (s, p) => s + Number(p.amount || 0),
            0
          );
          printPaymentReceipt({
            balance: ctx.balance,
            payment,
            patient: ctx.patient,
            clinic: ctx.clinic,
            cashierName,
            totalPaidBefore,
            remainingAfter: ctx.remainingAfter,
          });
          refetchBalancePayments();
        }}
      />

      {/* Transaction Type Selection */}
      {showTransactionTypeModal && (
        <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl border border-slate-100 bg-white p-8 shadow-2xl">
            <h2 className="mb-2 text-xl font-bold text-slate-900">How should this be recorded?</h2>
            <p className="mb-6 text-sm text-slate-500">Choose how this treatment visit is handled.</p>
            <div className="space-y-3">
              <button
                onClick={() => { setShowTransactionTypeModal(false); setShowPaymentModal(true); }}
                className="w-full rounded-2xl border-2 border-slate-200 bg-white p-5 text-left transition hover:border-teal-300 hover:bg-teal-50"
              >
                <p className="text-base font-bold text-slate-900">Regular Transaction</p>
                <p className="mt-1 text-sm text-slate-500">One visit or immediate checkout. Payment collected now.</p>
              </button>
              <button
                onClick={() => { setShowTransactionTypeModal(false); setShowPlanCheckoutModal(true); }}
                className="w-full rounded-2xl border-2 border-cyan-200 bg-cyan-50 p-5 text-left transition hover:border-cyan-400 hover:bg-cyan-100"
              >
                <p className="text-base font-bold text-cyan-900">Active Treatment Plan</p>
                <p className="mt-1 text-sm text-slate-600">Multiple visits, staged treatment, or payments over time.</p>
              </button>
            </div>
            <button onClick={() => setShowTransactionTypeModal(false)} className="mt-4 w-full text-center text-sm text-slate-400 hover:text-slate-600">← Back</button>
          </div>
        </div>
      )}

      {/* Treatment Plan Checkout Modal */}
      {showPlanCheckoutModal && transactionPatientId && activeClinic && (
        <PosPlanCheckoutModal
          isOpen={showPlanCheckoutModal}
          onClose={() => setShowPlanCheckoutModal(false)}
          onSaved={(plan, payments) => {
            const totalCollected = (payments || []).reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
            alert(
              `Treatment plan "${plan.title}" created successfully!${payments.length > 0 ? ` Payment of AED ${totalCollected.toFixed(2)} recorded.` : ""}`
            );
            clearPosForm();
          }}
          patientId={transactionPatientId}
          patientName={patientName}
          clinicId={activeClinic.id}
          clinicPatientFileId={transactionPatientFileId}
          patientFileNo={patientFileNumberInput}
          doctorId={doctorId}
          receptionistId={receptionistId || loginReceptionistId}
          receptionistName={
            receptionists.find((person: any) => person.id === (receptionistId || loginReceptionistId))?.name || "Reception"
          }
          registerSessionId={registerSessionId}
          services={selectedServices.map((s, i) => ({ ...s, teeth: getTeethForItem(i) }))}
          subtotal={subtotal}
          total={total}
          discountAmount={discountAmount}
          vat={vat}
          clinic={activeClinic}
        />
      )}
    </AppFrame>
  );
}
