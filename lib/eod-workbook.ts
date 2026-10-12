import "server-only";
import type {SupabaseClient} from "@supabase/supabase-js";
type EodContext={supabase:SupabaseClient;activeClinic:{id:string;name:string};fetch:(input:string,init?:RequestInit)=>Promise<Response>;loadClinicHistoryPatients:(clinicId:string,patientIds:string[])=>Promise<any[]>;now:Date};
import * as SheetJS from "xlsx-js-style";
import { PaymentAllocation, PaymentAllocationRefund, PaymentRecord, TreatmentPlanPaymentAllocation, TreatmentPlanPaymentRecord, CashDeduction } from "./types";
import { paymentVariantLabel, PaymentMethodVariant } from "./payment-allocation";
import { roundCurrency, truncateCurrency } from "./money";
import { getInstallmentFeeProvider } from "./tabby-tamara-fees";
import { extractLegacyCashAmount, getDubaiBusinessDate } from "./cash-deductions";
import { computeTreatmentPlanRollup } from "./treatment-plan-rollup";
import { getBusinessDayKeyForReporting, getPaymentBreakdownForReporting, summarizeStoredAllocationCollectionsForReporting, summarizeStoredAllocationRowsForReporting } from "./receipts-reporting";
import { reportClinicFileNumber } from "./clinic-file-numbers";
function getDubaiDayUtcRange(date: Date) {
  const { year, month, day } = getDubaiDateParts(date);
  const startIso = `${year}-${month}-${day}T00:00:00+04:00`;
  const endIso = `${year}-${month}-${day}T23:59:59.999+04:00`;
  return {
    startUtcIso: new Date(startIso).toISOString(),
    endUtcIso: new Date(endIso).toISOString(),
  };
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
function summarizeStoredAllocationRows(rows: PaymentAllocation[]) {
  return summarizeStoredAllocationRowsForReporting(rows);
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
// The existing workbook calculation was moved intact from the POS page.
// All data dependencies are supplied by the authorized server request.
export async function buildEodWorkbook({supabase, activeClinic, fetch, loadClinicHistoryPatients, now: reportNow}: EodContext) {
const output:{result?:{workbook:SheetJS.WorkBook;fileName:string;warnings:string[]}}={}; let workbookStarted=0; const started=performance.now(); const warnings:string[]=[];
const XLSX={...SheetJS,writeFile:(workbook:SheetJS.WorkBook,fileName:string)=>{output.result={workbook,fileName,warnings};}};
const alert=(message:string)=>{if(message.includes("unresolved correction/refund requests"))warnings.push(message);else throw new Error(message);};
async function downloadDailyIncomeReport() {
    if (!activeClinic?.id) {
      alert("No active clinic found for this register.");
      return;
    }

    const now = reportNow;
    const { startUtcIso, endUtcIso } = getDubaiDayUtcRange(now);
    const reportDay = now.toLocaleDateString("en-CA", {timeZone:"Asia/Dubai"});
    const eodResponse = await fetch("/api/workspace/eod?clinicId="+activeClinic.id+"&day="+reportDay,{cache:"no-store"});
    const eodCheck = await eodResponse.json();
    if(!eodResponse.ok){alert(eodCheck.error||"Could not check EOD approvals. Try again.");return;}
    const pendingCorrections: Array<{id:string;receipt_id:string;plan_payment_id?:string;kind:string;status:string;requested_reason:string;created_at:string}> = eodCheck.pending||[];
    const correctionChanges: Array<{receipt_id:string;kind:string;requested_reason:string;approver:string;completed_at:string;replacement_receipt_id:string}> = eodCheck.changes||[];
    if(pendingCorrections.length)alert("There are "+pendingCorrections.length+" unresolved correction/refund requests. This export will be marked DRAFT. Ask the manager to resolve them before sending final EOD.");

    const { data: clinicReceptionists, error: receptionistsError } = await supabase
      .from("receptionist")
      .select("id, name")
      .eq("clinic_id", activeClinic.id);

    if (receptionistsError) {
      console.error("Failed loading clinic receptionists", receptionistsError);
      alert("Required report data could not be loaded. EOD was not exported. Please retry.");
      return;
      alert("Could not prepare report. Please try again.");
      return;
    }

    const receptionistRows = clinicReceptionists || [];
    const receptionistIds = receptionistRows.map((r) => r.id).filter(Boolean);

    if (receptionistIds.length === 0) {
      alert("No receptionists assigned to this clinic.");
      return;
    }

    // Independent day reads share this verified request and run concurrently.
    const initialReads = await Promise.all([
supabase
      .from("receipts")
      .select("*")
      .or(`clinic_id.eq.${activeClinic.id},and(clinic_id.is.null,receptionist_id.in.(${receptionistIds.join(',')}))`)
      .gte("created_at", startUtcIso)
      .lte("created_at", endUtcIso)
      .order("created_at", { ascending: true }),
supabase
      .from("payment_records")
      .select("*")
      .neq('status','cancelled')
      .eq("clinic_id", activeClinic.id)
      .gte("created_at", startUtcIso)
      .lte("created_at", endUtcIso)
      .order("created_at", { ascending: true }),
supabase.from('payment_allocation_refunds').select('*').is("accounting_void_request_id", null).eq('clinic_id',activeClinic.id).eq('status','completed').gte('created_at',startUtcIso).lte('created_at',endUtcIso),
supabase
      .from("balance_payments")
      .select("amount, payment_method").neq("status", "cancelled")
      .eq("clinic_id",activeClinic.id)
      .gte("created_at", startUtcIso)
      .lte("created_at", endUtcIso),
supabase
      .from("patient_credits")
      .select("amount, payment_method").neq("status", "cancelled")
      .eq("clinic_id",activeClinic.id)
      .gt("amount", 0)
      .gte("created_at", startUtcIso)
      .lte("created_at", endUtcIso),
supabase
      .from("cash_deductions")
      .select("*")
      .eq("clinic_id", activeClinic.id)
      .eq("business_date", getDubaiBusinessDate(now))
      .eq("status", "active")
      .order("created_at", { ascending: true })
    ]);
    // select("*") so the report keeps working whether or not optional columns
    // (amount_paid, credit_applied) exist in the live database.
    const { data: receiptsData, error: receiptsError } = initialReads[0];

    if (receiptsError) {
      console.error("Failed loading receipts for report", receiptsError);
      alert("Required report data could not be loaded. EOD was not exported. Please retry.");
      return;
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

    const { data: paymentRecordsData, error: paymentRecordsError } = initialReads[1];
    if (paymentRecordsError) {
      console.warn("Failed loading payment records for report", paymentRecordsError);
      alert("Required report data could not be loaded. EOD was not exported. Please retry.");
      return;
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
          supabase.from("payment_allocation_refunds").select("*").is("accounting_void_request_id", null).in("payment_id", paymentRecordIds),
        ]);
        if (allocRes.error) {
          console.warn("Failed loading payment allocations for report", allocRes.error);
      alert("Required report data could not be loaded. EOD was not exported. Please retry.");
      return;
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
      alert("Required report data could not be loaded. EOD was not exported. Please retry.");
      return;
        } else {
          paymentAllocationRefundsForDay = (refundRes.data || []) as PaymentAllocationRefund[];
        }
      }
    }
    // Returns are reported on the return day even when the sale was earlier.
    const returnsResult=initialReads[2];
    if(returnsResult.error){alert('Refund records could not be verified. EOD was not exported.');return;}
    paymentAllocationRefundsForDay=(returnsResult.data||[]) as PaymentAllocationRefund[];
    const missingRefundAllocationIds=[...new Set(paymentAllocationRefundsForDay.map(row=>row.payment_allocation_id))].filter(id=>!paymentAllocationsForDay.some(row=>row.id===id));
    for(let offset=0;offset<missingRefundAllocationIds.length;offset+=100){const result=await supabase.from('payment_allocations').select('*').in('id',missingRefundAllocationIds.slice(offset,offset+100));if(result.error){alert('Refund payment methods could not be verified. EOD was not exported.');return;}paymentAllocationsForDay.push(...(result.data||[]) as PaymentAllocation[]);}
    const patientIds = [...new Set(receipts.map((r) => r.patient_id).filter(Boolean))];
    let clinicFileNumbers: Map<string, string>;
    let reportPatients: Array<{ id: string; name: string; phone: string; nationality: string | null; date_of_birth: string | null }>;
    try {
      const response = await fetch("/api/patients/report-details", {
        method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
        body: JSON.stringify({ clinicId: activeClinic.id, patientIds }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Patient details could not be loaded.");
      clinicFileNumbers = new Map(result.fileNumbers);
      reportPatients = result.patients;
    } catch (error) {
      alert(error instanceof Error ? error.message : "Patient details could not be loaded.");
      return;
    }
    const doctorIds = [...new Set(receipts.map((r) => r.doctor_id).filter(Boolean))];
    const patientMap = new Map<string, {
      name: string;
      phone: string;
      nationality: string;
      date_of_birth: string;
      file_no: string;
    }>();
    const doctorMap = new Map<string, string>();

    if (patientIds.length > 0) {
      const patientsData = reportPatients;

      (patientsData || []).forEach((patient) => {
        patientMap.set(String(patient.id), {
          name: String(patient.name || ""),
          phone: String(patient.phone || ""),
          nationality: String(patient.nationality || ""),
          date_of_birth: patient.date_of_birth ? new Date(patient.date_of_birth).toLocaleDateString("en-GB") : "",
          file_no: reportClinicFileNumber(clinicFileNumbers, patient.id),
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
      alert("Required report data could not be loaded. EOD was not exported. Please retry.");
      return;
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
      alert("Required report data could not be loaded. EOD was not exported. Please retry.");
      return;
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
      alert("Required report data could not be loaded. EOD was not exported. Please retry.");
      return;
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
          : allocation?.method_variant === "bank_transfer"
            ? "bankTransfer"
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
    {
      const { data: refundsData, error: refundsError } = await supabase
        .from("refunds")
        .select("id, receipt_id, total_amount, created_at").is("accounting_void_request_id", null)
        .eq("clinic_id",activeClinic.id)
        .gte("created_at", startUtcIso)
        .lte("created_at", endUtcIso);

      if (refundsError) {
        alert('Refund records could not be verified. EOD was not exported.');return;
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
      alert("Required report data could not be loaded. EOD was not exported. Please retry.");
      return;
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
    const { data: balancePaymentsData, error: balancePaymentsError } = initialReads[3];
    if (balancePaymentsError) {
      console.warn("Failed loading balance payments for report", balancePaymentsError);
      alert("Required report data could not be loaded. EOD was not exported. Please retry.");
      return;
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
    const { data: depositsData, error: depositsError } = initialReads[4];
    if (depositsError) {
      console.warn("Failed loading patient deposits for report", depositsError);
      alert("Required report data could not be loaded. EOD was not exported. Please retry.");
      return;
    } else {
      depositsReceivedTotal = (depositsData || []).reduce((s, p) => s + Number(p.amount || 0), 0);
      cashDepositsReceivedTotal = (depositsData || []).reduce(
        (sum, deposit) => sum + extractLegacyCashAmount(String(deposit.payment_method || ""), Number(deposit.amount || 0)),
        0
      );
    }

    let activeCashDeductions: CashDeduction[] = [];
    const reportBusinessDate = getDubaiBusinessDate(now);
    const { data: cashDeductionData, error: cashDeductionError } = initialReads[5];
    if (cashDeductionError) {
      console.warn("Failed loading cash deductions for report", cashDeductionError);
      alert("Required report data could not be loaded. EOD was not exported. Please retry.");
      return;
    } else {
      activeCashDeductions = (cashDeductionData || []) as CashDeduction[];
    }

    let planPatientDetails = new Map<string, any>();
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
    const treatmentPlanRollups = new Map<string, ReturnType<typeof computeTreatmentPlanRollup>>();
    const relevantTreatmentPlanIds = new Set<string>();
    let treatmentPlanTabbyFeeTotal = 0;
    let treatmentPlanTamaraFeeTotal = 0;
    let treatmentPlanPaymentRecordsForDay: Array<(TreatmentPlanPaymentRecord & { treatment_plans?: any; patients?: any })> = [];
    let treatmentPlanPaymentAllocationsForDay: TreatmentPlanPaymentAllocation[] = [];
    const treatmentPlanAllocationsByPaymentId = new Map<string, TreatmentPlanPaymentAllocation[]>();

    const [
      { data: treatmentPlansCreatedData, error: treatmentPlansCreatedError },
      { data: treatmentPlanVisitsTodayData, error: treatmentPlanVisitsTodayError },
      { data: treatmentPlanPaymentRecordsData, error: treatmentPlanPaymentRecordsError }
    ] = await Promise.all([
      supabase
      .from("treatment_plans")
      .select("id, patient_id, clinic_patient_file_id, title, total_amount, planned_visits, status, notes, is_legacy, historical_amount_paid, created_at, completed_at, cancelled_at")
      .eq("clinic_id", activeClinic.id)
      .gte("created_at", startUtcIso)
      .lte("created_at", endUtcIso)
      .order("created_at", { ascending: true }),
      supabase
      .from("treatment_plan_visits")
      .select("treatment_plan_id")
      .in("receptionist_id", receptionistIds)
      .gte("created_at", startUtcIso)
      .lte("created_at", endUtcIso),
      supabase
      .from("treatment_plan_payment_records")
      .select("id, treatment_plan_id, patient_id, clinic_id, receptionist_id, register_session_id, total_invoice_amount_settled, total_vat_amount, total_payment_fee_amount, total_customer_charged_amount, payment_method_summary, is_split, status, created_by, legacy_treatment_plan_payment_id, created_at, updated_at, treatment_plans(created_at, clinic_patient_file_id, title, total_amount, planned_visits, status, is_legacy, historical_amount_paid)").neq("status", "cancelled")
      .eq("clinic_id", activeClinic.id)
      .gte("created_at", startUtcIso)
      .lte("created_at", endUtcIso)
      .order("created_at", { ascending: true })
    ]);
    if (treatmentPlansCreatedError) {
      console.warn("Failed loading treatment plans created today", treatmentPlansCreatedError);
      alert("Required report data could not be loaded. EOD was not exported. Please retry.");
      return;
    } else {
      (treatmentPlansCreatedData || []).forEach((plan: any) => {
        treatmentPlansById.set(String(plan.id), plan);
        relevantTreatmentPlanIds.add(String(plan.id));
      });
    }


    if (treatmentPlanVisitsTodayError) {
      console.warn("Failed loading treatment plan visits today", treatmentPlanVisitsTodayError);
      alert("Required report data could not be loaded. EOD was not exported. Please retry.");
      return;
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

    if (treatmentPlanPaymentRecordsError) {
      console.warn("Failed loading treatment plan payment records for report", treatmentPlanPaymentRecordsError);
      alert("Required report data could not be loaded. EOD was not exported. Please retry.");
      return;
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
      alert("Required report data could not be loaded. EOD was not exported. Please retry.");
      return;
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
          .select("id, patient_id, clinic_patient_file_id, title, total_amount, planned_visits, status, notes, is_legacy, historical_amount_paid, created_at, completed_at, cancelled_at")
          .eq("clinic_id", activeClinic.id)
          .in("id", missingPlanIds)
          .order("created_at", { ascending: true });
        if (missingPlansError) {
          console.warn("Failed loading treatment plan details for report", missingPlansError);
      alert("Required report data could not be loaded. EOD was not exported. Please retry.");
      return;
        } else {
          (missingPlansData || []).forEach((plan: any) => {
            treatmentPlansById.set(String(plan.id), plan);
          });
        }
      }

      const [allPlanPaymentRecordsResult, allLegacyPlanPaymentsResult, allPlanVisitsResult] = await Promise.all([
        supabase
          .from("treatment_plan_payment_records")
          .select("id, treatment_plan_id, total_invoice_amount_settled, status, legacy_treatment_plan_payment_id, created_at")
          .in("treatment_plan_id", planIds)
          .lte("created_at", endUtcIso),
        supabase
          .from("treatment_plan_payments")
          .select("id, treatment_plan_id, amount, source_payment_record_id, notes, created_at").neq("status", "cancelled")
          .in("treatment_plan_id", planIds)
          .lte("created_at", endUtcIso),
        supabase
          .from("treatment_plan_visits")
          .select("treatment_plan_id")
          .in("treatment_plan_id", planIds),
      ]);

      if (allPlanPaymentRecordsResult.error) {
        console.warn("Failed loading structured treatment-plan payments for report", allPlanPaymentRecordsResult.error);
      alert("Required report data could not be loaded. EOD was not exported. Please retry.");
      return;
      }
      if (allLegacyPlanPaymentsResult.error) {
        console.warn("Failed loading legacy treatment-plan payments for report", allLegacyPlanPaymentsResult.error);
      alert("Required report data could not be loaded. EOD was not exported. Please retry.");
      return;
      }
      const structuredPayments = (allPlanPaymentRecordsResult.data || []) as TreatmentPlanPaymentRecord[];
      const legacyPayments = (allLegacyPlanPaymentsResult.data || []) as Array<{
        id: string;
        treatment_plan_id: string;
        amount: number | null;
        source_payment_record_id?: string | null;
        notes?: string | null;
        created_at?: string | null;
      }>;
      [...treatmentPlansById.values()].forEach((plan: any) => {
        const planId = String(plan.id || "");
        treatmentPlanRollups.set(planId, computeTreatmentPlanRollup(plan, {
          structuredPayments: structuredPayments.filter((payment) => payment.treatment_plan_id === planId),
          legacyPayments: legacyPayments.filter((payment) => payment.treatment_plan_id === planId),
          asOf: endUtcIso,
        }));
      });
      if (allPlanVisitsResult.error) { alert("Treatment visits could not be loaded. EOD was not exported. Please retry."); return; }
      if (!allPlanVisitsResult.error) {
        (allPlanVisitsResult.data || []).forEach((visit: any) => {
          const planId = String(visit.treatment_plan_id || "");
          treatmentPlanVisitCounts.set(planId, (treatmentPlanVisitCounts.get(planId) || 0) + 1);
        });
      }

      const reportPatientIds = [...new Set([
        ...[...treatmentPlansById.values()].map(plan => String(plan.patient_id)),
        ...treatmentPlanPaymentRecordsForDay.map(payment => String(payment.patient_id)),
      ])];
      try {
        planPatientDetails = new Map((await loadClinicHistoryPatients(activeClinic.id, reportPatientIds)).map(patient => [patient.id, patient]));
        for (const patient of planPatientDetails.values()) {
          if (patient.clinic_file_no) clinicFileNumbers.set(String(patient.id), String(patient.clinic_file_no));
        }
        if (reportPatientIds.some(id => !planPatientDetails.has(id))) throw new Error("Some treatment-plan patient details are missing. Please retry the export.");
      } catch (error) {
        alert(error instanceof Error ? error.message : "Treatment-plan patient details could not be loaded.");
        return;
      }

      [...treatmentPlansById.values()].forEach((plan: any) => {
        const patient = planPatientDetails.get(String(plan.patient_id));
        const planId = String(plan.id || "");
        const totalAmount = Number(plan.total_amount || 0);
        const rollup = treatmentPlanRollups.get(planId) || computeTreatmentPlanRollup(plan, { asOf: endUtcIso });
        const paidToDate = rollup.totalPaidToDate;
        const completedVisits = (treatmentPlanVisitCounts.get(planId) || 0);
        treatmentPlanRows.push([
          new Date(plan.created_at || now).toLocaleTimeString("en-US", {
            timeZone: "Asia/Dubai",
            hour: "2-digit",
            minute: "2-digit",
            hour12: true,
          }),
          patient?.name || "",
          reportClinicFileNumber(clinicFileNumbers, plan.patient_id),
          plan.title || "Treatment Plan",
          plan.status || "",
          totalAmount,
          paidToDate,
          rollup.remainingBalance,
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
      const patient = planPatientDetails.get(String(payment.patient_id));
      const planId = String(payment.treatment_plan_id || "");
      const totalAmount = Number(plan?.total_amount || 0);
      const invoiceSettled = Number(payment.total_invoice_amount_settled || 0);
      const rollup = treatmentPlanRollups.get(planId) || computeTreatmentPlanRollup(plan, {
        structuredPayments: [payment],
        asOf: endUtcIso,
      });
      const paidAfterToday = rollup.totalPaidToDate;
      const remainingAfterToday = rollup.remainingBalance;
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
        } else if (allocation.method_variant === "bank_transfer") {
          bankTransferTotal += customerChargedAmount;
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

      const completedVisits = (treatmentPlanVisitCounts.get(planId) || 0);
      treatmentPlanPaymentRows.push([
        new Date(payment.created_at || now).toLocaleTimeString("en-US", {
          timeZone: "Asia/Dubai",
          hour: "2-digit",
          minute: "2-digit",
          hour12: true,
        }),
        patient?.name || "",
        reportClinicFileNumber(clinicFileNumbers, plan?.patient_id || payment.patient_id),
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
      "File No.",
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
      "Status", "Correction / Refund Reason", "Approved By", "Correction / Refund Time", "Original Receipt", "Replacement Receipt",
    ];

    const detailRows: Array<(string | number)[]> = [];
    const netDetailRows: Array<(string | number)[]> = [];

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
        : Math.max(0, Math.min(regularInvoiceValue, Number(receipt.amount_paid ?? receipt.total ?? 0) - gatewayFee));
      const outstandingCreated = Math.max(0, roundCurrency(regularInvoiceValue - invoiceSettled - creditUsed));
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
            bankTransfer: structuredCollectionSummary?.bankTransfer || 0,
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

      if(receipt.status!=="VOIDED"){
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
      }

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
        patientInfo?.file_no || "Missing clinic file",
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
        receipt.status==="VOIDED"?"VOIDED":(eodCheck.statuses?.[receiptId]||"COMPLETED"),
        receipt.void_reason||correctionChanges.find(c=>c.receipt_id===receiptId)?.requested_reason||"",
        correctionChanges.find(c=>c.receipt_id===receiptId)?.approver||"",
        receipt.voided_at||correctionChanges.find(c=>c.receipt_id===receiptId)?.completed_at||"",
        eodCheck.receiptNumbers?.[receipt.original_receipt_id||""]||"",eodCheck.receiptNumbers?.[receipt.replacement_receipt_id||""]||"",
      ]);
      const netRow=[...detailRows[detailRows.length-1]];
      if(receipt.status==="VOIDED"){
        for(const index of [8,9,10,11,12,13,15,17,18,19,21,22,25,26,27])netRow[index]=0;
      }else{
        const paymentIds=new Set(structuredPaymentRecords.map(payment=>payment.id));
        const reversals=paymentAllocationRefundsForDay.filter(refund=>refund.status==='completed'&&paymentIds.has(refund.payment_id)&&new Date(refund.created_at).getTime()<=new Date(endUtcIso).getTime());
        const reversedTreatment=reversals.reduce((sum,refund)=>sum+Number(refund.refunded_treatment_amount||0),0);
        const reversedVat=reversals.reduce((sum,refund)=>sum+Number(refund.refunded_vat_amount||0),0);
        const returned=reversals.reduce((sum,refund)=>sum+Number(refund.total_returned_amount||0),0);
        netRow[8]=roundCurrency(Math.max(0,grossTotal-reversedTreatment));
        netRow[11]=roundCurrency(Math.max(0,vatAmount-reversedVat));
        netRow[10]=roundCurrency(Math.max(0,netTotal-returned));
        netRow[25]=roundCurrency(Math.max(0,receiptCollectionAmount-returned));
        if(netRow[28]==='REFUNDED'){netRow[8]=0;netRow[9]=0;netRow[11]=0;}
        for(const [variants,index] of [[['cash'],12],[['card'],13],[['tabby_standard'],15],[['tabby_card'],17],[['tamara'],19],[['bank_transfer'],25]] as const){
          if(index===25)continue;
          const methodReturned=reversals.filter(refund=>variants.some(variant=>structuredPaymentAllocations.some(allocation=>allocation.id===refund.payment_allocation_id&&allocation.method_variant===variant))).reduce((sum,refund)=>sum+Number(refund.total_returned_amount||0),0);
          netRow[index]=roundCurrency(Math.max(0,Number(netRow[index]||0)-methodReturned));
        }
      }
      netDetailRows.push(netRow);
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
    const uniquePatients = new Set(receipts.filter(r=>r.status!=="VOIDED").map((r) => String(r.patient_id || "")).filter(Boolean)).size;
    const birthdayDiscountTotal = receipts.filter(r=>r.status!=="VOIDED").reduce((sum, receipt) => sum + Number(receipt.birthday_discount_amount || 0), 0);
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

    workbookStarted = performance.now();
    const workbook = XLSX.utils.book_new();
    const normalizeReportCellValue = (value: string | number) => (
      typeof value === "number" && Number.isFinite(value) ? roundCurrency(value) : value
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
      ["Refunds from today's receipts", todaysSalesRefundTotal.amount, "", ""],
      ["Refunds from earlier receipts", previousSalesRefundTotal.amount, "", ""],
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
      ["Regular Receipts", receipts.filter(r=>r.status!=="VOIDED").length, "", ""],
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

    writeCell(`A${totalsRow}`, "NET TOTALS");

    // Store computed totals as values. Formula cells have caused Excel repairs
    // when the report has no normal receipt rows but other EOD collections exist.
    ["I", "J", "K", "L", "M", "N", "P", "R", "S", "U", "V", "W", "Y", "Z", "AA"].forEach((col) => {
      const colIndex = XLSX.utils.decode_col(col);
      const computed = roundCurrency(netDetailRows.reduce((sum,row)=>sum+Number(row[colIndex]||0),0));
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

        if(!isTotalsRow){const status=visibleDetailRows[row-2]?.[28];if(status==="VOIDED"){baseStyle.fill={fgColor:{rgb:"E5E7EB"}};baseStyle.font={name:"Calibri",sz:10,color:{rgb:"6B7280"},strike:true};}else if(status==="REFUNDED"){baseStyle.fill={fgColor:{rgb:"FECACA"}};}else if(status==="PARTIALLY_REFUNDED"){baseStyle.fill={fgColor:{rgb:"FEF3C7"}};}}
        styleDetailsCell(row, col, baseStyle);
      }
    }

    XLSX.utils.book_append_sheet(workbook, summarySheet, "Daily Summary");
    XLSX.utils.book_append_sheet(workbook, detailsSheet, "Transaction Details");

    const planHeaders = [
      "Created Time",
      "Patient Name",
      "File No.",
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
      "File No.",
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

    if (paymentRecordsForDay.length > 0 || paymentAllocationRefundsForDay.length > 0) {
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
        "File No.",
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
          reportClinicFileNumber(clinicFileNumbers, receipt?.patient_id),
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
        { key: "bank_transfer", label: "Bank Transfer" },
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
    const pendingSheet=XLSX.utils.aoa_to_sheet([["EOD Approval Status",pendingCorrections.length?"DRAFT — unresolved requests":"No unresolved requests"],["Request","Receipt","Type","Status","Reason","Requested At"],...pendingCorrections.map(q=>[q.id,q.receipt_id||`Plan payment ${q.plan_payment_id}`,q.kind,q.status,q.requested_reason,q.created_at])]);
    XLSX.utils.book_append_sheet(workbook,pendingSheet,"Pending Approvals");
    XLSX.writeFile(workbook, (pendingCorrections.length?"DRAFT - ":"")+fileName);
  }
await downloadDailyIncomeReport();
if(!output.result)throw new Error("EOD was not exported. Please retry.");
return {...output.result,timings:{dataAndCalculationMs:Math.round(workbookStarted-started),workbookMs:Math.round(performance.now()-workbookStarted)}};
}
