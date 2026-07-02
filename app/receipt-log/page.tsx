"use client";

import { useEffect, useMemo, useState } from "react";
import { AppFrame } from "../../components/app-frame";
import { supabase } from "../../lib/supabase";

const PAGE_SIZE = 10;
const BOSS_PIN = "0404";

export default function ReceiptLogPage() {
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [loginReceptionistId, setLoginReceptionistId] = useState("");
  const [loggedInReceptionistId, setLoggedInReceptionistId] = useState<string | null>(null);
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState("");
  const [receipts, setReceipts] = useState<any[]>([]);
  const [patients, setPatients] = useState<any[]>([]);
  const [receptionists, setReceptionists] = useState<any[]>([]);
  const [clinics, setClinics] = useState<any[]>([]);
  const [doctors, setDoctors] = useState<any[]>([]);
  const [services, setServices] = useState<any[]>([]);
  const [allRefunds, setAllRefunds] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedClinicId, setSelectedClinicId] = useState("all");
  const [page, setPage] = useState(1);

  const [selectedReceipt, setSelectedReceipt] = useState<any | null>(null);
  const [receiptItems, setReceiptItems] = useState<any[]>([]);
  const [receiptRefunds, setReceiptRefunds] = useState<any[]>([]);
  const [receiptRefundItems, setReceiptRefundItems] = useState<any[]>([]);
  const [isLoadingItems, setIsLoadingItems] = useState(false);

  const [showRefundModal, setShowRefundModal] = useState(false);
  const [refundAll, setRefundAll] = useState(true);
  const [checkedItems, setCheckedItems] = useState<Record<string, boolean>>({});
  const [refundReason, setRefundReason] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastRefund, setLastRefund] = useState<any | null>(null);
  const [refundedItems, setRefundedItems] = useState<any[]>([]);

  useEffect(() => {
    loadData();
  }, []);

  function handleUnlock() {
    if (pinInput === BOSS_PIN) {
      setIsUnlocked(true);
      setLoggedInReceptionistId(null);
      setPinError("");
      return;
    }
    const match = receptionists.find((r) => String(r.pin) === pinInput && r.id === loginReceptionistId);
    if (match) {
      setIsUnlocked(true);
      setLoggedInReceptionistId(match.id);
      if (match.clinic_id) setSelectedClinicId(match.clinic_id);
      setPinError("");
      return;
    }
    setPinError("Invalid PIN. Try again.");
  }

  async function loadData() {
    setIsLoading(true);
    const [receiptsRes, patientsRes, receptionistsRes, clinicsRes, doctorsRes, servicesRes, refundsRes] = await Promise.allSettled([
      supabase.from("receipts").select("*").order("created_at", { ascending: false }),
      supabase.from("patients").select("id, name, phone, patient_number"),
      supabase.from("receptionist").select("*"),
      supabase.from("clinics").select("*"),
      supabase.from("doctors").select("*"),
      supabase.from("services").select("id, name"),
      supabase.from("refunds").select("*"),
    ]);
    if (receiptsRes.status === "fulfilled") setReceipts(receiptsRes.value.data || []);
    if (patientsRes.status === "fulfilled") setPatients(patientsRes.value.data || []);
    if (receptionistsRes.status === "fulfilled") setReceptionists(receptionistsRes.value.data || []);
    if (clinicsRes.status === "fulfilled") setClinics(clinicsRes.value.data || []);
    if (doctorsRes.status === "fulfilled") setDoctors(doctorsRes.value.data || []);
    if (servicesRes.status === "fulfilled") setServices(servicesRes.value.data || []);
    if (refundsRes.status === "fulfilled") setAllRefunds(refundsRes.value.data || []);
    setIsLoading(false);
  }

  const filteredReceipts = useMemo(() => {
    let result = receipts;
    if (selectedClinicId !== "all") {
      const clinicReceptionistIds = new Set(
        receptionists.filter((r) => r.clinic_id === selectedClinicId).map((r) => r.id)
      );
      result = result.filter((r) => clinicReceptionistIds.has(r.receptionist_id));
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
    setReceiptRefunds([]);
    setReceiptRefundItems([]);
    setIsLoadingItems(true);
    setReceiptItems([]);
    const [itemsRes, refundsRes] = await Promise.all([
      supabase.from("receipt_items").select("*").eq("receipt_id", receipt.id),
      supabase.from("refunds").select("*").eq("receipt_id", receipt.id).order("created_at", { ascending: false }),
    ]);
    const items = itemsRes.data || [];
    const refunds = refundsRes.data || [];
    setReceiptItems(items);
    setReceiptRefunds(refunds);
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
    setCheckedItems((prev) => ({ ...prev, [itemId]: !prev[itemId] }));
  }

  async function processRefund() {
    if (!selectedReceipt) return;
    if (!refundReason.trim()) { alert("Please enter a reason."); return; }
    if (!refundAll && Object.values(checkedItems).filter(Boolean).length === 0) { alert("Select at least one item."); return; }

    setIsProcessing(true);

    const itemsToRefund = refundAll ? receiptItems : receiptItems.filter((item) => checkedItems[String(item.id)]);
    const receiptVat = Number(selectedReceipt.vat || 0);
    const receiptSubtotal = Number(selectedReceipt.subtotal || 0);
    const totalRefund = refundAll
      ? Number(selectedReceipt.total || 0)
      : (() => {
          const itemsSubtotal = itemsToRefund.reduce((sum, item) => sum + Number(item.total || item.price || 0), 0);
          const proportionalVat = receiptSubtotal > 0 ? (itemsSubtotal / receiptSubtotal) * receiptVat : 0;
          return Math.round((itemsSubtotal + proportionalVat) * 100) / 100;
        })();

    const { data: refundData, error: refundError } = await supabase
      .from("refunds")
      .insert([{
        receipt_id: selectedReceipt.id,
        receptionist_id: selectedReceipt.receptionist_id,
        refunded_by: loggedInReceptionistId,
        reason: refundReason.trim(),
        total_amount: totalRefund,
        payment_method: selectedReceipt.payment_method,
      }])
      .select()
      .single();

    if (refundError || !refundData) {
      alert(`Error creating refund: ${refundError?.message || "unknown"}`);
      setIsProcessing(false);
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

    // Refresh refund data for the current receipt
    const { data: freshRefundItems } = await supabase.from("refund_items").select("*").eq("refund_id", refundData.id);
    setReceiptRefunds((prev) => [refundData, ...prev]);
    setReceiptRefundItems((prev) => [...prev, ...(freshRefundItems || [])]);
    setAllRefunds((prev) => [...prev, refundData]);

    setLastRefund(refundData);
    setRefundedItems(itemsToRefund);
    setShowRefundModal(false);
    setIsProcessing(false);
    setRefundReason("");
    setCheckedItems({});
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

    return `<!doctype html>
<html><head><meta charset="utf-8"/><title>Refund Receipt</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; width: 72mm; margin: 0; padding: 2mm; font-size: 10px; line-height: 1.25; color: #000; background: #fff; }
  .hr { border-top: 1px dashed #000; margin: 5px 0; }
  .double { border-top: 2px solid #000; border-bottom: 2px solid #000; padding: 3px 0; margin: 5px 0; text-align: center; font-weight: 700; color: #c41e3a; }
  .clinic-name { text-align: center; font-size: 14px; font-weight: 700; }
  .row { display: flex; justify-content: space-between; gap: 6px; margin: 1px 0; }
  .item-name { flex: 1; min-width: 0; }
  .amount { text-align: right; white-space: nowrap; color: #c41e3a; font-weight: 700; }
  @media print { @page { size: 80mm auto; margin: 0; } body { width: 72mm; } }
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
  <div style="text-align:center;font-weight:700;color:#c41e3a;margin:3px 0;">Services Refunded</div>
  <div class="hr" style="margin-top:2px;"></div>
  ${itemsHtml || `<div class="row"><span>Full Receipt Refund</span><span style="color:#c41e3a;">-AED ${totalRefund.toFixed(2)}</span></div>`}
  <div class="hr"></div>
  <div class="row" style="font-weight:700;color:#c41e3a;font-size:12px;"><span>REFUND TOTAL</span><span>-AED ${totalRefund.toFixed(2)}</span></div>
  <div class="hr"></div>
  <div class="row"><span>Reason</span><span style="text-align:right;font-size:9px;">: ${lastRefund.reason || "-"}</span></div>
  <div class="row"><span>Payment Method</span><span>: ${lastRefund.payment_method || "-"}</span></div>
  <div class="hr"></div>
  <div style="text-align:center;font-size:9px;margin-top:6px;">Thank you</div>
</body></html>`;
  }

  function printRefundReceipt() {
    const html = buildRefundReceiptHtml();
    if (!html) return;
    const w = window.open("", "_blank", "width=400,height=600");
    if (!w) { alert("Please allow popups."); return; }
    w.document.open(); w.document.write(html); w.document.close();
    w.focus(); setTimeout(() => w.print(), 500);
  }

  function buildReprintHtml(): string {
    if (!selectedReceipt) return "";
    const patient = patients.find((p) => p.id === selectedReceipt.patient_id);
    const receptionist = receptionists.find((r) => r.id === selectedReceipt.receptionist_id);
    const clinic = clinics.find((c) => c.id === receptionist?.clinic_id);
    const doctor = doctors.find((d) => d.id === selectedReceipt.doctor_id);
    const logoPath = clinic?.logo === "altamuze" ? "/images/logo4.png" : "/images/logo3.png";
    const clinicDisplayName = clinic?.name?.toUpperCase() || "SKIN & SMILE DENTAL CLINIC";
    const clinicAddress = clinic?.address || "Al Satwa, Dubai, UAE\nSame Building of Almaya Supermarket\nNear Satwa Bus Station";
    const clinicRoom = clinic?.room ? `2nd Floor, Room ${clinic.room.replace(/^Room\s+/i, "")}` : "";
    const clinicTrn = clinic?.trn || "";
    const clinicPhone = clinic?.phone || "";
    const clinicWhatsapp = clinic?.whatsapp || "";
    const isSkinAndSmile = !clinic || clinic.logo !== "altamuze";
    const receiptDate = new Date(selectedReceipt.created_at || new Date());
    const dateValue = receiptDate.toLocaleDateString("en-GB");
    const timeValue = receiptDate.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
    const invoiceNo = selectedReceipt.receipt_number
      ? `#${String(selectedReceipt.receipt_number).padStart(5, "0")}`
      : "REPRINT";
    const subtotal = Number(selectedReceipt.subtotal || 0);
    const discountAmount = Number(selectedReceipt.discount_amount || 0);
    const vat = Number(selectedReceipt.vat || 0);
    const total = Number(selectedReceipt.total || 0);
    const itemsHtml = receiptItems
      .map((item) => `
        <div class="row item-row">
          <span class="item-name">${services.find((s) => s.id === item.service_id)?.name || "Service"}</span>
          <span class="amount">AED ${Number(item.price).toFixed(2)}</span>
        </div>`)
      .join("");

    return `<!doctype html>
<html><head><meta charset="utf-8"/><title>Receipt Reprint</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; width: 72mm; margin: 0; padding: 2mm; font-size: 10px; line-height: 1.25; color: #000; background: #fff; overflow-x: hidden; }
  .hr { border-top: 1px dashed #000; margin: 5px 0; }
  .double { border-top: 2px solid #000; border-bottom: 2px solid #000; padding: 3px 0; margin: 5px 0; text-align: center; font-weight: 700; }
  .logo-wrap { display: flex; justify-content: center; margin-bottom: 4px; }
  .logo { max-width: 35mm; max-height: 20mm; object-fit: contain; }
  .clinic-name { text-align: center; font-size: 14px; font-weight: 700; }
  .address { text-align: center; font-size: 9px; line-height: 1.25; margin-top: 4px; }
  .row { display: flex; justify-content: space-between; gap: 6px; margin: 1px 0; }
  .row span:first-child { min-width: 30mm; }
  .row span:last-child { text-align: right; flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .head-row { display: flex; justify-content: space-between; font-weight: 700; }
  .item-name { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .amount { text-align: right; white-space: nowrap; }
  .footer-center { text-align: center; margin-top: 4px; }
  @media print { @page { size: 80mm auto; margin: 0; } body { width: 72mm; } }
</style></head>
<body>
  <div class="logo-wrap" id="lw">
    <img src="${logoPath}" alt="logo" class="logo" onerror="document.getElementById('lw').style.display='none'"/>
  </div>
  <div class="double">TAX INVOICE (REPRINT)</div>
  <div class="clinic-name">${clinicDisplayName}</div>
  <div class="address">
    ${clinicAddress.split(/\\n|\n/).map((line: string) => `<div>${line}</div>`).join("")}
    ${clinicRoom && !clinicAddress.includes("2nd Floor") ? `<div>${clinicRoom}</div>` : ""}
    ${clinicTrn ? `<div style="margin-top:2px;font-weight:700;">TRN: ${clinicTrn}</div>` : ""}
  </div>
  <div class="hr"></div>
  <div class="row"><span>Invoice No</span><span>: ${invoiceNo}</span></div>
  <div class="row"><span>Date</span><span>: ${dateValue}</span></div>
  <div class="row"><span>Time</span><span>: ${timeValue}</span></div>
  <div class="row"><span>Cashier</span><span>: ${receptionist?.name || "-"}</span></div>
  <div class="row"><span>Doctor</span><span>: ${doctor?.name || "-"}</span></div>
  <div class="row"><span>Patient Name</span><span>: ${patient?.name || "-"}</span></div>
  <div class="row"><span>Patient ID</span><span>: ${patient?.patient_number ? `#${String(patient.patient_number).padStart(5, "0")}` : "-"}</span></div>
  <div class="row"><span>Mobile</span><span>: ${patient?.phone || "-"}</span></div>
  <div class="hr"></div>
  <div class="head-row"><span>DESCRIPTION</span><span>AMOUNT</span></div>
  <div class="hr" style="margin-top:2px;"></div>
  ${itemsHtml || '<div style="text-align:center">No items</div>'}
  <div class="hr"></div>
  <div class="row"><span>Subtotal</span><span>AED ${subtotal.toFixed(2)}</span></div>
  ${discountAmount > 0 ? `<div class="row" style="color:#ef4444;"><span>Discount</span><span>- AED ${discountAmount.toFixed(2)}</span></div>` : ""}
  <div class="row"><span>VAT</span><span>AED ${vat.toFixed(2)}</span></div>
  <div class="hr" style="margin:4px 0;"></div>
  <div class="row" style="font-weight:700;"><span>TOTAL</span><span>AED ${total.toFixed(2)}</span></div>
  <div class="hr"></div>
  <div class="row"><span>Payment Method</span><span>: ${(selectedReceipt.payment_method || "-").toUpperCase()}</span></div>
  ${selectedReceipt.notes ? `<div style="margin-top:4px;">Note: ${selectedReceipt.notes}</div>` : ""}
  <div class="hr"></div>
  <div class="footer-center">VAT Included in Above Amount</div>
  <div class="footer-center">Thank you for visiting us!</div>
  ${isSkinAndSmile ? `
  <div class="footer-center" style="margin-top:6px;">Follow us:</div>
  <div class="footer-center">Instagram: @skinandsmiledentalclinic</div>
  <div class="footer-center">TikTok: @skinandsmile</div>` : ""}
  <div class="hr"></div>
  <div style="text-align:center;font-size:9px;line-height:1.4;">
    ${clinicPhone ? `<div>Phone: ${clinicPhone}</div>` : ""}
    ${clinicWhatsapp ? `<div>WhatsApp: ${clinicWhatsapp}</div>` : ""}
  </div>
  <div class="hr"></div>
  <div class="double">Thank you for Visiting US!</div>
</body></html>`;
  }

  function reprintReceipt() {
    const html = buildReprintHtml();
    if (!html) return;
    const w = window.open("", "_blank", "width=400,height=600");
    if (!w) { alert("Please allow popups."); return; }
    w.document.open(); w.document.write(html); w.document.close();
    w.focus(); setTimeout(() => w.print(), 500);
  }

  if (!isUnlocked) {
    return (
      <AppFrame title="Receipt History" description="View and manage past receipts.">
        <div className="mx-auto max-w-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-teal-700">Receipt History</p>
          <h2 className="mt-2 text-2xl font-semibold text-slate-900">Enter PIN</h2>
          <p className="mt-1 text-sm text-slate-500">Select your name and enter your PIN to continue.</p>
          <div className="mt-5 grid gap-4">
            <div className="space-y-2">
              <label className="block text-sm font-semibold text-slate-700">Receptionist</label>
              <select
                value={loginReceptionistId}
                onChange={(e) => setLoginReceptionistId(e.target.value)}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-teal-400 focus:ring-4 focus:ring-teal-100"
              >
                <option value="">Select Receptionist</option>
                {receptionists.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="block text-sm font-semibold text-slate-700">PIN</label>
              <input
                type="password"
                value={pinInput}
                onChange={(e) => { setPinInput(e.target.value); setPinError(""); }}
                onKeyDown={(e) => e.key === "Enter" && handleUnlock()}
                placeholder="Enter PIN"
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-teal-400 focus:ring-4 focus:ring-teal-100"
              />
            </div>
            {pinError && <p className="text-sm text-red-500">{pinError}</p>}
            <button
              onClick={handleUnlock}
              className="w-full rounded-2xl bg-teal-700 px-5 py-3 text-sm font-semibold text-white transition hover:bg-teal-600"
            >
              Continue
            </button>
          </div>
        </div>
      </AppFrame>
    );
  }

  return (
    <AppFrame title="Receipts" description="View and manage past receipts.">
      <div className="space-y-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-teal-700">Receipt History</p>
          <h2 className="mt-1 text-xl font-semibold text-slate-900">All Receipts</h2>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          {loggedInReceptionistId === null && (
            <select
              value={selectedClinicId}
              onChange={(e) => setSelectedClinicId(e.target.value)}
              className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-cyan-400 focus:ring-4 focus:ring-cyan-100"
            >
              <option value="all">All Clinics</option>
              {clinics.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          )}
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
                                  <span className="font-semibold text-slate-900">AED {Number(item.price).toFixed(2)}</span>
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

                            <div className="mt-4 flex gap-2">
                              <button
                                onClick={reprintReceipt}
                                className="flex-1 rounded-2xl border border-teal-300 bg-teal-50 px-4 py-2 text-sm font-semibold text-teal-700 transition hover:bg-teal-100"
                              >
                                Reprint
                              </button>
                              <button
                                onClick={() => {
                                  setShowRefundModal(true);
                                  setRefundAll(true);
                                  setCheckedItems({});
                                  setRefundReason("");
                                  setLastRefund(null);
                                }}
                                className="flex-1 rounded-2xl border border-red-300 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-100"
                              >
                                Refund
                              </button>
                            </div>

                            {lastRefund && (
                              <div className="mt-3 rounded-2xl border border-green-200 bg-green-50 p-3">
                                <p className="text-sm font-semibold text-green-800">
                                  ✓ Refund of AED {Number(lastRefund.total_amount).toFixed(2)} processed
                                </p>
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
                  onChange={() => { setRefundAll(true); setCheckedItems({}); }}
                  className="accent-red-500"
                />
                <div>
                  <p className="text-sm font-semibold text-slate-900">Refund entire receipt</p>
                  <p className="text-xs text-slate-500">AED {Number(selectedReceipt.total).toFixed(2)}</p>
                </div>
              </label>
              <label className="flex cursor-pointer items-center gap-3 rounded-2xl border-2 border-slate-200 p-3 transition hover:border-red-300">
                <input
                  type="radio"
                  name="refundType"
                  checked={!refundAll}
                  onChange={() => setRefundAll(false)}
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
                      <span className="text-sm font-semibold text-slate-700">AED {Number(item.price).toFixed(2)}</span>
                    </div>
                  </label>
                ))}
                {Object.values(checkedItems).some(Boolean) && (
                  <div className="text-right">
                    <p className="text-sm font-semibold text-red-600">
                      Refund total: AED{" "}
                      {(() => {
                        const itemsSubtotal = receiptItems
                          .filter((i) => checkedItems[String(i.id)])
                          .reduce((s, i) => s + Number(i.total || i.price || 0), 0);
                        const receiptSubtotal = Number(selectedReceipt.subtotal || 0);
                        const receiptVat = Number(selectedReceipt.vat || 0);
                        const proportionalVat = receiptSubtotal > 0 ? (itemsSubtotal / receiptSubtotal) * receiptVat : 0;
                        return (Math.round((itemsSubtotal + proportionalVat) * 100) / 100).toFixed(2);
                      })()}
                    </p>
                    <p className="text-xs text-slate-400">(includes proportional VAT)</p>
                  </div>
                )}
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
                disabled={isProcessing}
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
    </AppFrame>
  );
}
