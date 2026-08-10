"use client";

import { useEffect, useMemo, useState } from "react";
import { paymentVariantLabel } from "../../lib/payment-allocation";
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
  summarizeRefundMethodVariants,
} from "../../lib/receipt-refunds";
import { supabase } from "../../lib/supabase";
import { printHtmlWhenImagesReady } from "../../lib/receipt-branding";
import { generateInvoiceHtml, type InvoiceStatus } from "../../lib/generate-invoice-html";
import { buildThermalReceiptHtml, type BuildThermalReceiptHtmlOptions } from "../../lib/build-thermal-receipt-html";
import { filterClinicsForAccess, useClinicAccess } from "../../lib/clinic-access";
import type { PaymentAllocation } from "../../lib/types";
import { mapRegularReceiptRenderLine, summarizeRegularReceiptForRender } from "../../lib/regular-receipt-rendering";

const PAGE_SIZE = 10;

export default function ReceiptLogClient() {
  const { accessSession, isLoaded, isManager, allowedClinicId } = useClinicAccess();
  const [receipts, setReceipts] = useState<any[]>([]);
  const [patients, setPatients] = useState<any[]>([]);
  const [receptionists, setReceptionists] = useState<any[]>([]);
  const [clinics, setClinics] = useState<any[]>([]);
  const [doctors, setDoctors] = useState<any[]>([]);
  const [services, setServices] = useState<any[]>([]);
  const [allRefunds, setAllRefunds] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedClinicId, setSelectedClinicId] = useState("");
  const [page, setPage] = useState(1);

  const [selectedReceipt, setSelectedReceipt] = useState<any | null>(null);
  const [receiptItems, setReceiptItems] = useState<any[]>([]);
  const [receiptRefunds, setReceiptRefunds] = useState<any[]>([]);
  const [receiptRefundItems, setReceiptRefundItems] = useState<any[]>([]);
  const [paymentAllocations, setPaymentAllocations] = useState<PaymentAllocation[]>([]);
  const [paymentRecordCount, setPaymentRecordCount] = useState(0);
  const [isLoadingItems, setIsLoadingItems] = useState(false);

  const [showRefundModal, setShowRefundModal] = useState(false);
  const [refundAll, setRefundAll] = useState(true);
  const [checkedItems, setCheckedItems] = useState<Record<string, boolean>>({});
  const [checkedAllocations, setCheckedAllocations] = useState<Record<string, boolean>>({});
  const [refundAllocationAmountInputs, setRefundAllocationAmountInputs] = useState<Record<string, string>>({});
  const [refundReason, setRefundReason] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastRefund, setLastRefund] = useState<any | null>(null);
  const [refundedItems, setRefundedItems] = useState<any[]>([]);
  const [lastRefundBreakdown, setLastRefundBreakdown] = useState<any[]>([]);
  const [isDeleting, setIsDeleting] = useState(false);
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
    loadData();
  }, [isLoaded]);

  async function loadData() {
    setIsLoading(true);
    const [receiptsRes, patientsRes, receptionistsRes, clinicsRes, doctorsRes, servicesRes, refundsRes] = await Promise.allSettled([
      supabase.from("receipts").select("*").order("created_at", { ascending: false }),
      fetchAllRows("patients", "id, name, phone, patient_number"),
      supabase.from("receptionist").select("*"),
      supabase.from("clinics").select("*"),
      supabase.from("doctors").select("*"),
      supabase.from("services").select("id, name, price, standard_price, pricing_type"),
      supabase.from("refunds").select("*"),
    ]);
    if (receiptsRes.status === "fulfilled") setReceipts(receiptsRes.value.data || []);
    if (patientsRes.status === "fulfilled") setPatients(patientsRes.value || []);
    if (receptionistsRes.status === "fulfilled") setReceptionists(receptionistsRes.value.data || []);
    if (clinicsRes.status === "fulfilled") {
      const clinicRows = filterClinicsForAccess((clinicsRes.value.data || []) as any[], accessSession);
      setClinics(clinicRows);
      setSelectedClinicId((prev) => {
        if (allowedClinicId && clinicRows.some((c: any) => c.id === allowedClinicId)) return allowedClinicId;
        if (prev && clinicRows.some((c: any) => c.id === prev)) return prev;
        return isManager ? clinicRows[0]?.id ?? "" : "";
      });
    }
    if (doctorsRes.status === "fulfilled") setDoctors(doctorsRes.value.data || []);
    if (servicesRes.status === "fulfilled") setServices(servicesRes.value.data || []);
    if (refundsRes.status === "fulfilled") setAllRefunds(refundsRes.value.data || []);
    setIsLoading(false);
  }

  const filteredReceipts = useMemo(() => {
    let result = receipts;
    if (selectedClinicId) {
      const clinicReceptionistIds = new Set(
        receptionists.filter((r) => r.clinic_id === selectedClinicId).map((r) => r.id)
      );
      result = result.filter((r) => clinicReceptionistIds.has(r.receptionist_id));
    } else {
      result = [];
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter((r) => {
        const patient = patients.find((p) => p.id === r.patient_id);
        return (patient?.name || "").toLowerCase().includes(q);
      });
    }
    return result.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [receipts, patients, search, selectedClinicId, receptionists]);

  const totalPages = Math.max(1, Math.ceil(filteredReceipts.length / PAGE_SIZE));
  const pagedReceipts = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredReceipts.slice(start, start + PAGE_SIZE);
  }, [filteredReceipts, page]);

  useEffect(() => { setPage(1); }, [search, selectedClinicId]);

  async function selectReceipt(receipt: any) {
    if (selectedReceipt?.id === receipt.id) {
      setSelectedReceipt(null);
      return;
    }
    setSelectedReceipt(receipt);
    setLastRefund(null);
    setRefundedItems([]);
    setLastRefundBreakdown([]);
    setReceiptRefunds([]);
    setReceiptRefundItems([]);
    setPaymentAllocations([]);
    setPaymentRecordCount(0);
    setCheckedAllocations({});
    setRefundAllocationAmountInputs({});
    setIsLoadingItems(true);
    setReceiptItems([]);
    const [itemsRes, refundsRes, paymentRecordsRes] = await Promise.all([
      supabase.from("receipt_items").select("*").eq("receipt_id", receipt.id),
      supabase.from("refunds").select("*").eq("receipt_id", receipt.id).order("created_at", { ascending: false }),
      supabase.from("payment_records").select("id").eq("receipt_id", receipt.id).order("created_at", { ascending: false }),
    ]);
    const items = itemsRes.data || [];
    const refunds = refundsRes.data || [];
    setReceiptItems(items);
    setReceiptRefunds(refunds);
    const paymentRecordIds = (paymentRecordsRes.data || []).map((row: { id: string }) => row.id).filter(Boolean);
    setPaymentRecordCount(paymentRecordIds.length);
    if (paymentRecordIds.length > 0) {
      const { data: allocationRows } = await supabase
        .from("payment_allocations")
        .select("*")
        .in("payment_id", paymentRecordIds)
        .order("created_at", { ascending: true });
      setPaymentAllocations((allocationRows || []) as PaymentAllocation[]);
    } else {
      setPaymentAllocations([]);
    }
    if (refunds.length > 0) {
      const refundIds = refunds.map((r: any) => r.id);
      const { data: refundItemsData } = await supabase
        .from("refund_items")
        .select("*")
        .in("refund_id", refundIds);
      setReceiptRefundItems(refundItemsData || []);
    }
    setIsLoadingItems(false);
  }

  function toggleItem(itemId: string) {
    if (!selectedReceipt) return;
    setCheckedItems((prev) => {
      const next = { ...prev, [itemId]: !prev[itemId] };
      if (refundMode === "modern" && !refundAll) {
        const nextItems = receiptItems.filter((item) => next[String(item.id)]);
        const nextTotal = calculateReceiptItemsRefundTotal(selectedReceipt, nextItems);
        const nextSelectedAllocationIds = Object.entries(checkedAllocations).filter(([, value]) => value).map(([key]) => key);
        setRefundAllocationAmountInputs(
          nextSelectedAllocationIds.length > 0
            ? autoAllocateRefundAmounts(nextTotal, paymentAllocations, nextSelectedAllocationIds)
            : {}
        );
      }
      return next;
    });
  }

  function toggleAllocation(allocationId: string) {
    if (refundMode !== "modern") return;
    setCheckedAllocations((current) => {
      const next = { ...current, [allocationId]: !current[allocationId] };
      const nextSelectedAllocationIds = Object.entries(next).filter(([, value]) => value).map(([key]) => key);
      setRefundAllocationAmountInputs(
        nextSelectedAllocationIds.length > 0
          ? autoAllocateRefundAmounts(refundTargetAmount, paymentAllocations, nextSelectedAllocationIds)
          : {}
      );
      return next;
    });
  }

  const selectedRefundItems = useMemo(
    () => (refundAll ? receiptItems : receiptItems.filter((item) => checkedItems[String(item.id)])),
    [checkedItems, receiptItems, refundAll]
  );

  const refundMode = useMemo(
    () => resolveRefundProcessingMode({ paymentRecordCount, allocationCount: paymentAllocations.length }),
    [paymentAllocations.length, paymentRecordCount]
  );
  const modernMaxRefundableAmount = useMemo(
    () => calculateAllocationMaxRefundableInvoiceAmount(paymentAllocations),
    [paymentAllocations]
  );
  const maxRefundableAmount = useMemo(() => {
    if (!selectedReceipt) return 0;
    if (refundMode === "modern") return modernMaxRefundableAmount;
    return calculateReceiptMaxRefundableAmount(selectedReceipt, receiptRefunds);
  }, [modernMaxRefundableAmount, receiptRefunds, refundMode, selectedReceipt]);
  const refundTargetAmount = useMemo(() => {
    if (!selectedReceipt) return 0;
    if (refundAll) return maxRefundableAmount;
    return calculateReceiptItemsRefundTotal(selectedReceipt, selectedRefundItems);
  }, [maxRefundableAmount, refundAll, selectedReceipt, selectedRefundItems]);

  const selectedAllocationIds = useMemo(
    () => Object.entries(checkedAllocations).filter(([, value]) => value).map(([key]) => key),
    [checkedAllocations]
  );

  const selectedAllocationRefundTotal = useMemo(
    () => selectedAllocationIds.reduce((sum, id) => sum + Number(refundAllocationAmountInputs[id] || 0), 0),
    [refundAllocationAmountInputs, selectedAllocationIds]
  );

  async function processRefund() {
    if (!selectedReceipt) return;
    if (!refundReason.trim()) { alert("Please enter a reason."); return; }
    if (!refundAll && Object.values(checkedItems).filter(Boolean).length === 0) { alert("Select at least one item."); return; }
    if (refundMode === "admin_review") {
      alert("This receipt has a payment record but no payment allocations. Refund is blocked for safety. Please ask admin to review this receipt.");
      return;
    }

    setIsProcessing(true);

    const maxRefundable = maxRefundableAmount;
    const totalRefund = refundTargetAmount;

    if (totalRefund <= 0) {
      if (refundMode === "modern") {
        alert("Nothing left to refund — all invoice allocations were already refunded.");
      } else {
        const paidAmount = Number(selectedReceipt.amount_paid ?? selectedReceipt.total ?? 0);
        const previouslyRefunded = receiptRefunds.reduce((sum, row) => sum + Number(row.total_amount || 0), 0);
        alert(`Nothing left to refund — AED ${previouslyRefunded.toFixed(2)} of the AED ${paidAmount.toFixed(2)} paid has already been refunded.`);
      }
      setIsProcessing(false);
      return;
    }
    if (totalRefund > maxRefundable + 0.0049) {
      if (refundMode === "modern") {
        alert(`Refund exceeds remaining refundable invoice allocations. Maximum refundable is AED ${maxRefundable.toFixed(2)}.`);
      } else {
        const paidAmount = Number(selectedReceipt.amount_paid ?? selectedReceipt.total ?? 0);
        const previouslyRefunded = receiptRefunds.reduce((sum, row) => sum + Number(row.total_amount || 0), 0);
        alert(`Refund exceeds what the patient actually paid. Maximum refundable is AED ${maxRefundable.toFixed(2)} (paid AED ${paidAmount.toFixed(2)}, already refunded AED ${previouslyRefunded.toFixed(2)}).`);
      }
      setIsProcessing(false);
      return;
    }

    const baseRefundItemRows = selectedRefundItems.map((item) => ({
      receipt_item_id: item.id,
      service_id: item.service_id,
      service_name: services.find((s) => s.id === item.service_id)?.name || "Unknown",
      amount: Number(item.total || item.price || 0),
    }));

    let result:
      | { kind: "modern"; refundData: any; warningMessage?: string; breakdown: any[] }
      | { kind: "legacy"; refundData: any; refundItems: any[] };
    if (refundMode === "legacy") {
      try {
        const legacyResult = await createLegacyBackedRefund({
          supabase,
          receiptId: selectedReceipt.id,
          receptionistId: selectedReceipt.receptionist_id,
          refundedBy: null,
          reason: refundReason.trim(),
          totalAmount: totalRefund,
          paymentMethod: selectedReceipt.payment_method || "Legacy receipt refund",
          refundItemRows: baseRefundItemRows,
        });
        result = { kind: "legacy", ...legacyResult };
      } catch (error) {
        alert(`Error creating legacy refund: ${error instanceof Error ? error.message : String(error)}`);
        setIsProcessing(false);
        return;
      }
    } else {
      const { requests, error } = buildAllocationRefundRequests({
        allocations: paymentAllocations,
        selectedAllocationIds,
        requestedAmountsByAllocationId: refundAllocationAmountInputs,
        expectedRefundAmount: totalRefund,
      });
      if (error) {
        alert(error);
        setIsProcessing(false);
        return;
      }
      try {
        const modernResult = await createAllocationBackedRefund({
          supabase,
          receiptId: selectedReceipt.id,
          receptionistId: selectedReceipt.receptionist_id,
          processedBy: selectedReceipt.receptionist_id,
          refundedBy: null,
          reason: refundReason.trim(),
          requests,
          refundItemRows: baseRefundItemRows,
        });
        result = { kind: "modern", ...modernResult };
      } catch (error) {
        alert(`Error creating refund: ${error instanceof Error ? error.message : String(error)}`);
        setIsProcessing(false);
        return;
      }
    }

    // A fully refunded partial-payment receipt shouldn't keep chasing the
    // patient for the remainder — remove its auto-created outstanding balance,
    // unless payments were already collected against it (needs manual review).
    if (refundAll && selectedReceipt.amount_paid != null) {
      const { data: linkedBalances } = await supabase
        .from("outstanding_balances")
        .select("id")
        .eq("receipt_id", selectedReceipt.id);
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

    // Refresh refund data for the current receipt
    const freshRefundItems = result.kind === "legacy"
      ? result.refundItems
      : (await supabase.from("refund_items").select("*").eq("refund_id", result.refundData.id)).data || [];
    setReceiptRefunds((prev) => [result.refundData, ...prev]);
    setReceiptRefundItems((prev) => [...prev, ...freshRefundItems]);
    setAllRefunds((prev) => [...prev, result.refundData]);

    setLastRefund(result.refundData);
    setRefundedItems(selectedRefundItems);
    setLastRefundBreakdown(result.kind === "modern" ? result.breakdown : []);
    setShowRefundModal(false);
    setIsProcessing(false);
    setRefundReason("");
    setCheckedItems({});
    setCheckedAllocations({});
    setRefundAllocationAmountInputs({});
    if (result.kind === "modern" && result.warningMessage) {
      alert(result.warningMessage);
      return;
    }
  }

  function buildRefundReceiptHtml(): string {
    if (!lastRefund || !selectedReceipt) return "";
    const patient = patients.find((p) => p.id === selectedReceipt.patient_id);
    const now = new Date();
    const dateStr = now.toLocaleDateString("en-GB");
    const timeStr = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
    const totalRefund = lastRefund.total_amount || 0;
    const invoiceNo = selectedReceipt.receipt_number
      ? `#${String(selectedReceipt.receipt_number).padStart(5, "0")}`
      : String(lastRefund.receipt_id).slice(0, 8) + "...";
    const itemsHtml = refundedItems
      .map((item) => `
        <div class="row item-row">
          <span class="item-name">${services.find((s) => s.id === item.service_id)?.name || "Unknown"}</span>
          <span class="amount">-AED ${Number(item.total || item.price).toFixed(2)}</span>
        </div>`)
      .join("");
    const paymentMethodHtml = lastRefundBreakdown
      .map((item) => `
        <div class="row item-row">
          <span class="item-name">${item.methodLabel}${item.providerReference ? ` (${item.providerReference})` : ""}</span>
          <span class="amount">AED ${Number(item.refundedInvoiceAmount || 0).toFixed(2)}</span>
        </div>`)
      .join("");
    const feeHtml = lastRefundBreakdown
      .filter((item) => Number(item.nonRefundableFeeAmount || 0) > 0)
      .map((item) => `
        <div class="row">
          <span>Non-refundable ${item.methodLabel} fee</span>
          <span>AED ${Number(item.nonRefundableFeeAmount || 0).toFixed(2)}</span>
        </div>`)
      .join("");

    return `<!doctype html>
<html><head><meta charset="utf-8"/><title>Refund Receipt</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; width: 72mm; margin: 0; padding: 2mm; font-size: 10px; line-height: 1.25; color: #000; background: #fff; -webkit-text-size-adjust: 100%; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }
  .hr { border-top: 1px dashed #000; margin: 5px 0; }
  .double { border-top: 2px solid #000; border-bottom: 2px solid #000; padding: 3px 0; margin: 5px 0; text-align: center; font-weight: 700; }
  .clinic-name { text-align: center; font-size: 14px; font-weight: 700; }
  .row { display: flex; justify-content: space-between; gap: 6px; margin: 1px 0; }
  .item-name { flex: 1; min-width: 0; }
  .amount { text-align: right; white-space: nowrap; font-weight: 700; }
  @media print { @page { size: 80mm auto; margin: 0; } body { width: 72mm; -webkit-print-color-adjust: exact; print-color-adjust: exact; } * { color: #000 !important; border-color: #000 !important; } img { -webkit-print-color-adjust: exact; print-color-adjust: exact; image-rendering: crisp-edges; } }
</style></head>
<body>
  <div class="double">REFUND RECEIPT</div>
  <div class="clinic-name">SKIN &amp; SMILE DENTAL CLINIC</div>
  <div class="hr"></div>
  <div class="row"><span>Date</span><span>: ${dateStr}</span></div>
  <div class="row"><span>Time</span><span>: ${timeStr}</span></div>
  <div class="row"><span>Original Receipt</span><span>: ${invoiceNo}</span></div>
  <div class="row"><span>Patient</span><span>: ${patient?.name || "-"}</span></div>
  <div class="hr"></div>
  <div style="text-align:center;font-weight:700;margin:3px 0;">Services Refunded</div>
  <div class="hr" style="margin-top:2px;"></div>
  ${itemsHtml || `<div class="row"><span>Full Receipt Refund</span><span>-AED ${totalRefund.toFixed(2)}</span></div>`}
  ${paymentMethodHtml ? `<div class="hr"></div><div style="text-align:center;font-weight:700;margin:3px 0;">Original Payment Method</div><div class="hr" style="margin-top:2px;"></div>${paymentMethodHtml}` : ""}
  <div class="hr"></div>
  <div class="row" style="font-weight:700;font-size:12px;"><span>REFUND TOTAL</span><span>-AED ${totalRefund.toFixed(2)}</span></div>
  <div class="hr"></div>
  <div class="row"><span>Reason</span><span style="text-align:right;font-size:9px;">: ${lastRefund.reason || "-"}</span></div>
  <div class="row"><span>Payment Method</span><span>: ${lastRefund.payment_method || summarizeRefundMethodVariants(lastRefundBreakdown.map((item) => item.methodVariant)) || "-"}</span></div>
  ${feeHtml ? `<div class="hr"></div>${feeHtml}` : ""}
  <div class="hr"></div>
  <div style="text-align:center;font-size:9px;margin-top:6px;">Thank you</div>
</body></html>`;
  }

  function printRefundReceipt() {
    const html = buildRefundReceiptHtml();
    if (!html) return;
    printHtmlWhenImagesReady(html, "Please allow popups.");
  }

  function buildReprintHtml(): string {
    if (!selectedReceipt) return "";
    const patient = patients.find((p) => p.id === selectedReceipt.patient_id);
    const receptionist = receptionists.find((r) => r.id === selectedReceipt.receptionist_id);
    const clinic = clinics.find((c) => c.id === receptionist?.clinic_id);
    const doctor = doctors.find((d) => d.id === selectedReceipt.doctor_id);
    const receiptDate = new Date(selectedReceipt.created_at || new Date());
    const dateValue = receiptDate.toLocaleDateString("en-GB");
    const timeValue = receiptDate.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
    const invoiceNo = selectedReceipt.receipt_number
      ? `#${String(selectedReceipt.receipt_number).padStart(5, "0")}`
      : "REPRINT";
    const total = Number(selectedReceipt.total || 0);
    const amountPaidRaw = selectedReceipt.amount_paid;
    const amountPaid = amountPaidRaw != null ? Number(amountPaidRaw) : total;
    const renderLines = receiptItems.map((item) => {
      const service = services.find((entry) => entry.id === item.service_id);
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
    const summary = summarizeRegularReceiptForRender(selectedReceipt as any, renderLines);
    const options: BuildThermalReceiptHtmlOptions = {
      title: "Receipt Reprint",
      clinic,
      invoiceNumber: invoiceNo,
      dateValue,
      timeValue,
      cashierName: receptionist?.name || "-",
      doctorName: doctor?.name || "-",
      patientName: patient?.name || "-",
      patientPhone: patient?.phone || "-",
      patientFileNumber: patient?.patient_number ? `#${String(patient.patient_number).padStart(5, "0")}` : "-",
      doctorField: clinic?.name === "Skin & Smile Aesthetic Clinic" ? "Aesthetician / المختصة" : "Doctor / الطبيب",
      items: renderLines.map((line) => ({
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
      })),
      subtotal: summary.subtotal,
      discountAmount: summary.discountAmount,
      vat: summary.vat,
      total: summary.invoiceTotalBeforeGatewayFee,
      paymentFeeAmount: summary.paymentFeeAmount,
      allocations: [],
      manualDiscountAmount: summary.useSnapshotSummary ? summary.manualDiscountAmount : undefined,
      globalDiscountAmount: summary.useSnapshotSummary ? summary.globalDiscountAmount : undefined,
      creditUsed: 0,
      outstandingBalance: Math.max(0, summary.finalTotal - amountPaid),
      notes: selectedReceipt.notes || "",
      paymentMethod: selectedReceipt.payment_method || "",
      receiptHeaderLabel: `${clinic?.receipt_title || "TAX INVOICE"} (REPRINT)`,
    };

    return buildThermalReceiptHtml(options);
  }

  function reprintReceipt() {
    const html = buildReprintHtml();
    if (!html) return;
    printHtmlWhenImagesReady(html, "Please allow popups.");
  }

  function buildInvoiceHtmlForLog(): string {
    if (!selectedReceipt) return "";
    const receptionist = receptionists.find((r: any) => r.id === selectedReceipt.receptionist_id);
    const clinic = clinics.find((c: any) => c.id === receptionist?.clinic_id) ?? clinics[0] ?? null;
    const patient = patients.find((p: any) => p.id === selectedReceipt.patient_id);
    const doctor = doctors.find((d: any) => d.id === selectedReceipt.doctor_id);
    const issuedAt = selectedReceipt.created_at ? new Date(selectedReceipt.created_at) : new Date();
    const invoiceNum = selectedReceipt.receipt_number
      ? `#${String(selectedReceipt.receipt_number).padStart(5, "0")}`
      : selectedReceipt.id.slice(0, 8).toUpperCase();
    const grandTotal = Number(selectedReceipt.total ?? 0);
    const gatewayFee = Number(selectedReceipt.gateway_fee ?? 0);
    const renderLines = receiptItems.map((item: any) => {
      const svc = services.find((s: any) => s.id === item.service_id);
      return mapRegularReceiptRenderLine(item, {
        serviceName: svc?.name || "Service",
        fallbackOriginalUnitPrice: item.original_price != null
          ? Number(item.original_price)
          : svc?.standard_price != null
            ? Number(svc.standard_price)
            : svc?.price != null
              ? Number(svc.price)
              : null,
      });
    });
    const summary = summarizeRegularReceiptForRender(selectedReceipt as any, renderLines);
    const amountPaidRaw = selectedReceipt.amount_paid;
    const amountPaid = amountPaidRaw != null ? Number(amountPaidRaw) : summary.finalTotal;
    const previouslyRefunded = receiptRefunds.reduce((s: number, r: any) => s + Number(r.total_amount || 0), 0);
    const hasRefund = previouslyRefunded > 0.005;
    const outstandingBalance = Math.max(0, summary.finalTotal - amountPaid);
    const invoiceStatus: InvoiceStatus =
      hasRefund ? "REFUNDED"
      : outstandingBalance > 0.005 ? "PARTIALLY PAID"
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
        patientNumber: patient?.patient_number ?? null,
      },
      doctorName: doctor?.name ?? null,
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
        teeth: line.teeth,
      })),
      totalDiscount: summary.discountAmount,
      vatAmount: summary.vat,
      paymentFeeAmount: summary.paymentFeeAmount > 0 ? summary.paymentFeeAmount : gatewayFee > 0 ? gatewayFee : 0,
      grandTotal: summary.finalTotal,
      amountPaid,
      outstandingBalance,
      notes: selectedReceipt.notes || null,
    });
  }

  async function downloadInvoicePdfFromLog() {
    if (!selectedReceipt) return;
    const html = buildInvoiceHtmlForLog();
    const receptionist = receptionists.find((r: any) => r.id === selectedReceipt.receptionist_id);
    const clinic = clinics.find((c: any) => c.id === receptionist?.clinic_id) ?? clinics[0];
    const clinicSlug = (clinic?.name || "Clinic").replace(/\s+/g, "_").replace(/[^\w-]/g, "");
    const invoiceNum = selectedReceipt.receipt_number
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


  async function deleteReceipt(receipt: any) {
    const receiptLabel = receipt.receipt_number
      ? `#${String(receipt.receipt_number).padStart(5, "0")}`
      : `#${String(receipt.id).slice(0, 8)}`;
    const patientName = patients.find((p) => p.id === receipt.patient_id)?.name || "Unknown Patient";
    const confirmed = confirm(
      `Permanently delete receipt ${receiptLabel} for ${patientName} (AED ${Number(receipt.total || 0).toFixed(2)})?\n\nThis also deletes its items, refunds, and any outstanding balance created by it — INCLUDING payments already collected against that balance. This cannot be undone.`
    );
    if (!confirmed) return;

    setIsDeleting(true);
    try {
      // Remove any outstanding balance auto-created by this receipt first
      // (its collected payments cascade). receipt_id may not exist on databases
      // that haven't run the partial-payments migration — ignore that error.
      const { error: balanceError } = await supabase
        .from("outstanding_balances")
        .delete()
        .eq("receipt_id", receipt.id);
      if (balanceError && balanceError.code !== "42703") {
        console.error("Delete linked outstanding balance failed:", balanceError);
        alert(`Error deleting the receipt's outstanding balance: ${balanceError.message}`);
        return;
      }

      // receipt_items and refunds cascade in the database.
      const { error } = await supabase.from("receipts").delete().eq("id", receipt.id);
      if (error) {
        console.error("Delete receipt failed:", error);
        alert(`Error deleting receipt: ${error.message}`);
        return;
      }

      setReceipts((prev) => prev.filter((r) => r.id !== receipt.id));
      setAllRefunds((prev) => prev.filter((r) => r.receipt_id !== receipt.id));
      setSelectedReceipt(null);
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <>
      <div className="space-y-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-teal-700">Receipt History</p>
          <h2 className="mt-1 text-xl font-semibold text-slate-900">All Receipts</h2>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          <select
            value={selectedClinicId}
            onChange={(e) => setSelectedClinicId(e.target.value)}
            disabled={!isManager}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-cyan-400 focus:ring-4 focus:ring-cyan-100"
          >
            {clinics.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
            </select>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by patient name..."
            className="flex-1 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-cyan-400 focus:ring-4 focus:ring-cyan-100"
          />
        </div>

        {isLoading ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-500">
            Loading receipts...
          </div>
        ) : (
          <>
            <div className="space-y-2">
              {pagedReceipts.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">
                  No receipts found.
                </div>
              ) : pagedReceipts.map((receipt) => {
                const isSelected = selectedReceipt?.id === receipt.id;
                const receiptRefundList = allRefunds.filter((r) => r.receipt_id === receipt.id);
                const totalRefunded = receiptRefundList.reduce((sum, r) => sum + Number(r.total_amount || 0), 0);
                const isFullyRefunded = receiptRefundList.length > 0 && totalRefunded >= Number(receipt.total || 0) - 0.01;
                const isPartiallyRefunded = receiptRefundList.length > 0 && !isFullyRefunded;
                return (
                  <div
                    key={receipt.id}
                    className={`rounded-2xl border-2 transition ${isSelected ? "border-cyan-400 bg-cyan-50" : isFullyRefunded ? "border-red-200 bg-red-50/30" : isPartiallyRefunded ? "border-orange-200 bg-orange-50/20" : "border-slate-200 bg-white"}`}
                  >
                    <button
                      onClick={() => selectReceipt(receipt)}
                      className="w-full p-4 text-left"
                    >
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <p className="font-semibold text-slate-900">{patients.find((p) => p.id === receipt.patient_id)?.name || "Unknown Patient"}</p>
                          <p className="mt-0.5 text-xs text-slate-500">
                            {new Date(receipt.created_at).toLocaleDateString("en-GB")}{" "}
                            {new Date(receipt.created_at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true })}
                            {receipt.receipt_number && (
                              <span className="ml-2">· #{String(receipt.receipt_number).padStart(5, "0")}</span>
                            )}
                          </p>
                          <p className="mt-0.5 text-xs text-slate-400">{receipt.payment_method || "-"}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="font-bold text-teal-700">AED {Number(receipt.total).toFixed(2)}</p>
                          <div className="flex flex-col items-end gap-0.5 mt-0.5">
                            {Number(receipt.discount_amount) > 0 && (
                              <span className="text-xs font-bold text-red-500">PROMO</span>
                            )}
                            {isFullyRefunded && (
                              <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-600">REFUNDED</span>
                            )}
                            {isPartiallyRefunded && (
                              <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-bold text-orange-600">PARTIAL REFUND</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </button>

                    {isSelected && (
                      <div className="border-t border-cyan-200 px-4 pb-4">
                        {isLoadingItems ? (
                          <p className="py-4 text-sm text-slate-500">Loading items...</p>
                        ) : (
                          <>
                            <div className="mt-3 space-y-1">
                              {receiptItems.map((item) => (
                                <div key={item.id} className="flex justify-between text-sm">
                                  <span className="text-slate-700">{services.find((s) => s.id === item.service_id)?.name || "Service"}</span>
                                  <span className="font-semibold text-slate-900">
                                    {(() => {
                                      const service = services.find((s) => s.id === item.service_id);
                                      const original = service?.standard_price != null
                                        ? Number(service.standard_price)
                                        : service?.price != null
                                          ? Number(service.price)
                                          : null;
                                      const current = Number(item.price || 0);
                                      return original != null && original > current + 0.0049 ? (
                                      <>
                                        <span className="block text-xs font-normal text-slate-400 line-through">AED {original.toFixed(2)}</span>
                                        <span className="block">AED {current.toFixed(2)}</span>
                                      </>
                                      ) : (
                                        <>AED {current.toFixed(2)}</>
                                      );
                                    })()}
                                  </span>
                                </div>
                              ))}
                            </div>

                            <div className="mt-3 border-t border-cyan-100 pt-3 space-y-1 text-sm">
                              <div className="flex justify-between text-slate-500">
                                <span>Subtotal</span>
                                <span>AED {Number(receipt.subtotal).toFixed(2)}</span>
                              </div>
                              {Number(receipt.discount_amount) > 0 && (
                                <div className="flex justify-between text-red-500">
                                  <span>Discount</span>
                                  <span>- AED {Number(receipt.discount_amount).toFixed(2)}</span>
                                </div>
                              )}
                              <div className="flex justify-between text-slate-500">
                                <span>VAT</span>
                                <span>AED {Number(receipt.vat || 0).toFixed(2)}</span>
                              </div>
                              <div className="flex justify-between font-bold text-slate-900 border-t border-cyan-100 pt-2">
                                <span>Total</span>
                                <span>AED {Number(receipt.total).toFixed(2)}</span>
                              </div>
                            </div>

                            {receipt.notes && (
                              <p className="mt-2 text-xs italic text-slate-500">Note: {receipt.notes}</p>
                            )}

                            {receiptRefunds.length > 0 && (
                              <div className="mt-4 rounded-2xl border border-red-200 bg-red-50/60 p-3 space-y-3">
                                <p className="text-xs font-bold uppercase tracking-widest text-red-600">Refund History</p>
                                {receiptRefunds.map((refund) => {
                                  const refundItemsForThis = receiptRefundItems.filter((ri) => ri.refund_id === refund.id);
                                  const refundDate = new Date(refund.created_at);
                                  return (
                                    <div key={refund.id} className="space-y-1.5">
                                      <div className="flex items-center justify-between">
                                        <span className="text-xs text-slate-500">
                                          {refundDate.toLocaleDateString("en-GB")}{" "}
                                          {refundDate.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true })}
                                        </span>
                                        <span className="font-bold text-red-600 text-sm">- AED {Number(refund.total_amount).toFixed(2)}</span>
                                      </div>
                                      {refundItemsForThis.length > 0 && (
                                        <div className="space-y-0.5 pl-2 border-l-2 border-red-200">
                                          {refundItemsForThis.map((ri) => (
                                            <div key={ri.id} className="flex justify-between text-xs text-slate-600">
                                              <span>{ri.service_name || services.find((s) => s.id === ri.service_id)?.name || "Service"}</span>
                                              <span>- AED {Number(ri.amount).toFixed(2)}</span>
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                      <p className="text-xs text-slate-500 italic">Reason: {refund.reason || "-"}</p>
                                      {receiptRefunds.indexOf(refund) < receiptRefunds.length - 1 && (
                                        <div className="border-t border-red-100 pt-1" />
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}

                            <div className="mt-4 flex flex-wrap gap-2">
                              <button
                                onClick={() => deleteReceipt(receipt)}
                                disabled={isDeleting}
                                className="flex-1 rounded-2xl bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-500 disabled:opacity-60"
                              >
                                {isDeleting ? "Deleting…" : "Delete"}
                              </button>
                              <button
                                onClick={() => {
                                   const mode = resolveRefundProcessingMode({
                                     paymentRecordCount,
                                     allocationCount: paymentAllocations.length,
                                   });
                                   const shouldUseAllocations = mode === "modern";
                                   const nextCheckedAllocations = shouldUseAllocations
                                     ? Object.fromEntries(paymentAllocations.map((allocation) => [allocation.id, true]))
                                     : {};
                                   setShowRefundModal(true);
                                   setRefundAll(true);
                                   setCheckedItems({});
                                   setCheckedAllocations(nextCheckedAllocations);
                                   setRefundAllocationAmountInputs(
                                     shouldUseAllocations
                                       ? autoAllocateRefundAmounts(
                                           calculateAllocationMaxRefundableInvoiceAmount(paymentAllocations),
                                           paymentAllocations,
                                           paymentAllocations.map((allocation) => allocation.id)
                                         )
                                       : {}
                                   );
                                   setRefundReason("");
                                   setLastRefund(null);
                                   setLastRefundBreakdown([]);
                                 }}
                                className="flex-1 rounded-2xl border border-red-300 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-100"
                              >
                                Refund
                              </button>
                              <button
                                onClick={downloadInvoicePdfFromLog}
                                disabled={isDownloadingInvoice}
                                className="flex-1 rounded-2xl bg-amber-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-500 disabled:opacity-60"
                              >
                                {isDownloadingInvoice ? "PDF…" : "⬇ Invoice"}
                              </button>
                              <button
                                onClick={() => printHtmlWhenImagesReady(buildInvoiceHtmlForLog(), "Please allow popups.")}
                                className="flex-1 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-700 transition hover:bg-amber-100"
                              >
                                🖨 A4
                              </button>
                            </div>

                            {lastRefund && (
                              <div className="mt-3 rounded-2xl border border-green-200 bg-green-50 p-3">
                                <p className="text-sm font-semibold text-green-800">
                                  ✓ Refund of AED {Number(lastRefund.total_amount).toFixed(2)} processed
                                </p>
                                {lastRefundBreakdown.length > 0 && (
                                  <p className="mt-1 text-xs text-green-700">
                                    Refunded via {summarizeRefundMethodVariants(lastRefundBreakdown.map((item) => item.methodVariant))}.
                                  </p>
                                )}
                                <button
                                  onClick={printRefundReceipt}
                                  className="mt-2 w-full rounded-xl bg-green-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-green-500"
                                >
                                  Print Refund Receipt
                                </button>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 disabled:opacity-40 hover:bg-slate-50"
                >
                  ← Prev
                </button>
                <span className="text-sm text-slate-500">
                  Page {page} of {totalPages} · {filteredReceipts.length} receipts
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 disabled:opacity-40 hover:bg-slate-50"
                >
                  Next →
                </button>
              </div>
            )}
          </>
        )}
      </div>
      {showRefundModal && selectedReceipt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl overflow-y-auto max-h-[90vh]">
            <h3 className="text-lg font-semibold text-slate-900">Process Refund</h3>
            <p className="mt-1 text-sm text-slate-500">
              {selectedReceipt.receipt_number
                ? `Receipt #${String(selectedReceipt.receipt_number).padStart(5, "0")}`
                : "Receipt"}{" "}
              · {patients.find((p) => p.id === selectedReceipt.patient_id)?.name}
            </p>

            <div className="mt-4 space-y-2">
              <label className="flex cursor-pointer items-center gap-3 rounded-2xl border-2 border-slate-200 p-3 transition hover:border-red-300">
                <input
                  type="radio"
                  name="refundType"
                  checked={refundAll}
                  onChange={() => {
                    setRefundAll(true);
                    setCheckedItems({});
                    if (refundMode === "modern") {
                      setRefundAllocationAmountInputs(
                        selectedAllocationIds.length > 0
                          ? autoAllocateRefundAmounts(
                            modernMaxRefundableAmount,
                              paymentAllocations,
                              selectedAllocationIds
                            )
                          : {}
                      );
                    }
                  }}
                  className="accent-red-500"
                />
                <div>
                  <p className="text-sm font-semibold text-slate-900">Refund entire receipt</p>
                  <p className="text-xs text-slate-500">AED {maxRefundableAmount.toFixed(2)}</p>
                </div>
              </label>
              <label className="flex cursor-pointer items-center gap-3 rounded-2xl border-2 border-slate-200 p-3 transition hover:border-red-300">
                <input
                  type="radio"
                  name="refundType"
                  checked={!refundAll}
                  onChange={() => {
                    setRefundAll(false);
                    if (refundMode === "modern") {
                      setRefundAllocationAmountInputs(
                        selectedAllocationIds.length > 0
                          ? autoAllocateRefundAmounts(0, paymentAllocations, selectedAllocationIds)
                          : {}
                      );
                    }
                  }}
                  className="accent-red-500"
                />
                <p className="text-sm font-semibold text-slate-900">Refund selected services only</p>
              </label>
            </div>

            {!refundAll && (
              <div className="mt-3 space-y-2">
                {receiptItems.map((item) => (
                  <label
                    key={item.id}
                    className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 hover:bg-slate-100"
                  >
                    <input
                      type="checkbox"
                      checked={!!checkedItems[String(item.id)]}
                      onChange={() => toggleItem(String(item.id))}
                      className="h-4 w-4 accent-red-500"
                    />
                    <div className="flex flex-1 items-center justify-between">
                      <span className="text-sm text-slate-800">{services.find((s) => s.id === item.service_id)?.name || "Service"}</span>
                      <span className="text-sm font-semibold text-slate-700">AED {Number(item.total || item.price || 0).toFixed(2)}</span>
                    </div>
                  </label>
                ))}
                {Object.values(checkedItems).some(Boolean) && (
                  <div className="text-right">
                    <p className="text-sm font-semibold text-red-600">
                      Refund total: AED {refundTargetAmount.toFixed(2)}
                    </p>
                    <p className="text-xs text-slate-400">(includes proportional VAT)</p>
                  </div>
                )}
              </div>
            )}

            {refundMode === "modern" && (
              <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">Original payment allocations</p>
                    <p className="text-xs text-slate-500">Choose which original payment method should fund this refund.</p>
                  </div>
                  <p className="text-sm font-semibold text-slate-700">Target: AED {refundTargetAmount.toFixed(2)}</p>
                </div>
                <div className="mt-3 space-y-2">
                  {paymentAllocations.map((allocation) => {
                    const remaining = getRemainingAllocationAmounts(allocation);
                    return (
                      <label
                        key={allocation.id}
                        className="block rounded-2xl border border-slate-200 bg-white p-3"
                      >
                        <div className="flex items-start gap-3">
                          <input
                            type="checkbox"
                            checked={!!checkedAllocations[allocation.id]}
                            onChange={() => toggleAllocation(allocation.id)}
                            className="mt-1 h-4 w-4 accent-red-500"
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
                              <div className="w-28">
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={refundAllocationAmountInputs[allocation.id] || ""}
                                  onChange={(e) => setRefundAllocationAmountInputs((current) => ({ ...current, [allocation.id]: e.target.value }))}
                                  placeholder={remaining.invoice.toFixed(2)}
                                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-red-300 focus:ring-2 focus:ring-red-100"
                                />
                              </div>
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
                    Selected allocation total: AED {selectedAllocationRefundTotal.toFixed(2)}
                    {" · "}
                    Remaining to assign: AED {Math.max(0, refundTargetAmount - selectedAllocationRefundTotal).toFixed(2)}
                  </div>
                </div>
              </div>
            )}
            {refundMode === "legacy" && (
              <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                Legacy receipt refund: this receipt predates structured payment allocations, so refund uses compatibility mode.
              </div>
            )}
            {refundMode === "admin_review" && (
              <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                This receipt has payment records but missing payment allocations. Refund is blocked for safety; ask admin to review.
              </div>
            )}

            <div className="mt-4">
              <label className="block text-sm font-semibold text-slate-700">Reason *</label>
              <input
                type="text"
                value={refundReason}
                onChange={(e) => setRefundReason(e.target.value)}
                placeholder="e.g., Patient request, incorrect charge"
                className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-2 text-sm outline-none focus:border-red-300 focus:ring-4 focus:ring-red-100"
              />
            </div>

            <div className="mt-4 flex gap-3">
              <button
                onClick={processRefund}
                disabled={
                  isProcessing
                  || refundMode === "admin_review"
                  || (refundMode === "modern" && selectedAllocationIds.length === 0)
                }
                className="flex-1 rounded-2xl bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-500 disabled:opacity-50"
              >
                {isProcessing ? "Processing..." : "Confirm Refund"}
              </button>
              <button
                onClick={() => setShowRefundModal(false)}
                className="flex-1 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
