"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AppFrame } from "../../components/app-frame";
import { supabase } from "../../lib/supabase";
import { calculateAge } from "../../lib/utils";

const paymentOptions = ["Cash", "Card", "Visa", "Mastercard", "Tabby", "Tamara", "Mixed"];
const POS_REGISTER_SESSION_KEY = "posRegisterSession";
const POS_RECENT_SERVICES_KEY = "posRecentServices";
const REGISTER_TABLE = "cash_register_sessions";

function matchesServiceCategory(serviceName: string, category: string) {
  if (category === "all") {
    return true;
  }

  const name = serviceName.toLowerCase();

  if (category === "cleaning") {
    return name.includes("cleaning") || name.includes("whitening") || name.includes("filling");
  }

  if (category === "surgery") {
    return name.includes("extraction") || name.includes("root canal") || name.includes("surgical");
  }

  if (category === "cosmetic") {
    return name.includes("veneer") || name.includes("crown") || name.includes("bridge");
  }

  if (category === "braces") {
    return name.includes("braces") || name.includes("retainer");
  }

  if (category === "denture") {
    return name.includes("denture");
  }

  if (category === "xray") {
    return name.includes("xray") || name.includes("x-ray") || name.includes("cbct") || name.includes("iopa") || name.includes("opg");
  }

  return true;
}

const serviceCategories = [
  { key: "all", label: "All" },
  { key: "cleaning", label: "Cleaning" },
  { key: "surgery", label: "Surgery" },
  { key: "cosmetic", label: "Cosmetic" },
  { key: "braces", label: "Braces" },
  { key: "denture", label: "Denture" },
  { key: "xray", label: "X-Ray" },
];

export default function ReceiptsPage() {
  const [patients, setPatients] = useState<any[]>([]);
  const [doctors, setDoctors] = useState<any[]>([]);
  const [receptionists, setReceptionists] = useState<any[]>([]);
  const [services, setServices] = useState<any[]>([]);

  const [patientId, setPatientId] = useState("");
  const [patientName, setPatientName] = useState("");
  const [patientPhoneInput, setPatientPhoneInput] = useState("");
  const [patientEmailInput, setPatientEmailInput] = useState("");
  const [patientDobInput, setPatientDobInput] = useState("");
  const [patientSexInput, setPatientSexInput] = useState("");
  const [filteredPatients, setFilteredPatients] = useState<any[]>([]);
  const [showPatientSuggestions, setShowPatientSuggestions] = useState(false);
  const [transactionPatientId, setTransactionPatientId] = useState(""); // Track patient ID for current transaction
  const [selectedPatientInfo, setSelectedPatientInfo] = useState<{
    date_of_birth?: string | null;
    sex?: string | null;
    nationality?: string | null;
    emirates_id?: string | null;
  } | null>(null);
  const [doctorId, setDoctorId] = useState("");
  const [receptionistId, setReceptionistId] = useState("");
  const [notes, setNotes] = useState("");
  const [selectedServices, setSelectedServices] = useState<any[]>([]);
  const [serviceSearch, setServiceSearch] = useState("");
  const [serviceCategory, setServiceCategory] = useState("all");
  const [recentServiceIds, setRecentServiceIds] = useState<string[]>(() => {
    if (typeof window === "undefined") {
      return [];
    }

    try {
      const raw = localStorage.getItem(POS_RECENT_SERVICES_KEY);
      if (!raw) {
        return [];
      }
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map((id) => String(id)) : [];
    } catch {
      return [];
    }
  });
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState("");
  const [cashReceivedInput, setCashReceivedInput] = useState("");
  const [mixedCashInput, setMixedCashInput] = useState("");
  const [mixedOtherMethod, setMixedOtherMethod] = useState("Card");
  const [mixedOtherAmountInput, setMixedOtherAmountInput] = useState("");
  const [showPrintModal, setShowPrintModal] = useState(false);
  const [isSavingReceipt, setIsSavingReceipt] = useState(false);
  const [isPosUnlocked, setIsPosUnlocked] = useState(false);
  const [loginReceptionistId, setLoginReceptionistId] = useState("");
  const [pinInput, setPinInput] = useState("");
  const [openingCashInput, setOpeningCashInput] = useState("");
  const [openingCash, setOpeningCash] = useState<number | null>(null);
  const [registerOpenedAt, setRegisterOpenedAt] = useState("");
  const [showCloseRegisterModal, setShowCloseRegisterModal] = useState(false);
  const [closingCashInput, setClosingCashInput] = useState("");
  const [registerSessionId, setRegisterSessionId] = useState("");
  const [cashSalesTotal, setCashSalesTotal] = useState(0);
  const [expectedCashAmount, setExpectedCashAmount] = useState(0);
  const [isLoadingCashSummary, setIsLoadingCashSummary] = useState(false);
  const [showReceiptPreview, setShowReceiptPreview] = useState(false);
  const [receiptPreviewHtml, setReceiptPreviewHtml] = useState("");
  const receiptPreviewFrameRef = useRef<HTMLIFrameElement | null>(null);
  const router = useRouter();

  useEffect(() => {
    loadData();

    const savedSession = localStorage.getItem(POS_REGISTER_SESSION_KEY);
    if (!savedSession) {
      return;
    }

    try {
      const parsed = JSON.parse(savedSession);
      if (!parsed?.receptionistId) {
        return;
      }

      setIsPosUnlocked(true);
      setReceptionistId(parsed.receptionistId);
      setLoginReceptionistId(parsed.receptionistId);
      setOpeningCash(Number(parsed.openingCash || 0));
      setRegisterOpenedAt(parsed.openedAt || "");
      setRegisterSessionId(parsed.registerSessionId || "");
    } catch {
      localStorage.removeItem(POS_REGISTER_SESSION_KEY);
    }
  }, []);

  async function loadData() {
    const [patientResult, doctorResult, receptionistResult, serviceResult] = await Promise.allSettled([
      supabase.from("patients").select("*"),
      supabase.from("doctors").select("*"),
      supabase.from("receptionist").select("*"),
      supabase.from("services").select("*"),
    ]);

    if (patientResult.status === "fulfilled") {
      setPatients((patientResult.value.data || []) as any[]);
    }

    if (doctorResult.status === "fulfilled") {
      setDoctors((doctorResult.value.data || []) as any[]);
    }

    if (receptionistResult.status === "fulfilled") {
      setReceptionists((receptionistResult.value.data || []) as any[]);
    }

    if (serviceResult.status === "fulfilled") {
      setServices((serviceResult.value.data || []) as any[]);
    }
  }

  function addService(service: any) {
    setSelectedServices((current) => [...current, service]);

    const serviceId = String(service.id);
    setRecentServiceIds((current) => {
      const updated = [serviceId, ...current.filter((id) => id !== serviceId)].slice(0, 8);
      if (typeof window !== "undefined") {
        localStorage.setItem(POS_RECENT_SERVICES_KEY, JSON.stringify(updated));
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
  }

  const subtotal = selectedServices.reduce((sum, service) => sum + Number(service.price), 0);
  const vat = 0;
  const total = subtotal;

  const filteredServices = useMemo(() => {
    const query = serviceSearch.trim().toLowerCase();
    const filtered = services.filter((service) => {
      const name = String(service.name || "");
      const inCategory = matchesServiceCategory(name, serviceCategory);
      const inSearch = !query || name.toLowerCase().includes(query);
      return inCategory && inSearch;
    });

    if (!query) {
      return filtered.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
    }

    return filtered.sort((a, b) => {
      const aName = String(a.name || "").toLowerCase();
      const bName = String(b.name || "").toLowerCase();
      const aStarts = aName.startsWith(query) ? 0 : 1;
      const bStarts = bName.startsWith(query) ? 0 : 1;
      if (aStarts !== bStarts) {
        return aStarts - bStarts;
      }
      return aName.localeCompare(bName);
    });
  }, [services, serviceCategory, serviceSearch]);

  const recentServices = useMemo(() => {
    return recentServiceIds
      .map((serviceId) => services.find((service) => String(service.id) === serviceId))
      .filter(Boolean);
  }, [recentServiceIds, services]);

  function handlePatientNameChange(e: string) {
    setPatientName(e);
    if (patientId) {
      setPatientPhoneInput("");
      setPatientEmailInput("");
      setPatientDobInput("");
      setPatientSexInput("");
      setSelectedPatientInfo(null);
    }
    if (e.trim()) {
      const filtered = patients.filter((patient) => patient.name.toLowerCase().includes(e.toLowerCase()));
      setFilteredPatients(filtered);
      setShowPatientSuggestions(true);
    } else {
      setFilteredPatients([]);
      setShowPatientSuggestions(false);
    }
    setPatientId("");
  }

  function selectPatient(patient: any) {
    setPatientId(patient.id);
    setPatientName(patient.name);
    setPatientPhoneInput(patient.phone || "");
    setPatientEmailInput(patient.email || "");
    setPatientDobInput(patient.date_of_birth || "");
    setPatientSexInput(patient.sex || "");
    setSelectedPatientInfo({
      date_of_birth: patient.date_of_birth,
      sex: patient.sex,
      nationality: patient.nationality,
      emirates_id: patient.emirates_id,
    });
    setShowPatientSuggestions(false);
    setFilteredPatients([]);
  }

  function parseMoneyInput(value: string) {
    const normalized = value.replace(/,/g, ".").trim();
    return Number(normalized);
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

    if (registerError || !registerData) {
      console.warn("Register session insert warning", registerError);
      alert(
        "Register opened locally, but shift log was not saved to database. Please create table 'cash_register_sessions' if not configured."
      );
    } else {
      createdRegisterSessionId = String(registerData.id);
    }

    const session = {
      receptionistId: loginReceptionistId,
      openingCash: parsedOpeningCash,
      openedAt,
      registerSessionId: createdRegisterSessionId,
    };

    localStorage.setItem(POS_REGISTER_SESSION_KEY, JSON.stringify(session));

    setReceptionistId(loginReceptionistId);
    setOpeningCash(parsedOpeningCash);
    setRegisterOpenedAt(openedAt);
    setRegisterSessionId(createdRegisterSessionId);
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
      `Register closed. Opening cash: AED ${Number(openingCash || 0).toFixed(2)} | Cash sales: AED ${latestCashSales.toFixed(2)} | Expected cash: AED ${latestExpectedCash.toFixed(2)} | Actual closing cash: AED ${parsedClosingCash.toFixed(2)} | Difference: AED ${variance.toFixed(2)}`
    );

    localStorage.removeItem(POS_REGISTER_SESSION_KEY);
    setIsPosUnlocked(false);
    setShowCloseRegisterModal(false);
    setClosingCashInput("");
    setOpeningCash(null);
    setRegisterOpenedAt("");
    setRegisterSessionId("");
    setReceptionistId("");
    setLoginReceptionistId("");
    setCashSalesTotal(0);
    setExpectedCashAmount(0);

    // Reset in-progress receipt on register close.
    setPatientId("");
    setPatientName("");
    setPatientPhoneInput("");
    setPatientEmailInput("");
    setPatientDobInput("");
    setPatientSexInput("");
    setSelectedPatientInfo(null);
    setTransactionPatientId("");
    setDoctorId("");
    setSelectedPaymentMethod("");
    setNotes("");
    setSelectedServices([]);
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

    const { data, error } = await supabase
      .from("receipts")
      .select("total")
      .eq("receptionist_id", activeReceptionistId)
      .eq("payment_method", "Cash")
      .gte("created_at", registerOpenedAt);

    if (error) {
      console.warn("Failed loading cash sales summary", error);
      return 0;
    }

    return (data || []).reduce((sum, row) => sum + Number(row.total || 0), 0);
  }

  async function openCloseRegisterModal() {
    setShowCloseRegisterModal(true);
    setClosingCashInput("");
    setIsLoadingCashSummary(true);
    const shiftCashSales = await getShiftCashSalesTotal();
    const expected = Number(openingCash || 0) + shiftCashSales;
    setCashSalesTotal(shiftCashSales);
    setExpectedCashAmount(expected);
    setIsLoadingCashSummary(false);
  }

  async function proceedToPayment() {
    if (!isPosUnlocked) {
      alert("Open the register first to use POS.");
      return;
    }

    if (!patientName.trim() || !doctorId || !receptionistId || selectedServices.length === 0) {
      alert("Please complete all required fields and add at least one service.");
      return;
    }

    let finalPatientId = patientId;

    // If patientId is empty but patientName exists, create new patient
    if (!patientId && patientName.trim()) {
      const { data: newPatient, error: createError } = await supabase
        .from("patients")
        .insert([
          {
            name: patientName.trim(),
            phone: patientPhoneInput.trim(),
            email: patientEmailInput.trim(),
            date_of_birth: patientDobInput || null,
            sex: patientSexInput || null,
          },
        ])
        .select()
        .single();

      if (createError || !newPatient) {
        console.error("Create patient error", createError);
        alert(`Error creating new patient: ${createError?.message || "unknown error"}`);
        return;
      }

      finalPatientId = newPatient.id;
    }

    // Set the transaction patient ID to use throughout the payment/print flow
    setTransactionPatientId(finalPatientId);
    setShowPaymentModal(true);
  }

  function selectPaymentMethod(method: string) {
    setSelectedPaymentMethod(method);
  }

  function getNumericInput(value: string) {
    const num = parseMoneyInput(value);
    return Number.isFinite(num) ? num : 0;
  }

  function getCashReceivedAmount() {
    if (!cashReceivedInput.trim()) {
      return total;
    }
    return getNumericInput(cashReceivedInput);
  }

  function getCashChangeAmount() {
    const received = getCashReceivedAmount();
    return Math.max(received - total, 0);
  }

  function getMixedCashAmount() {
    return getNumericInput(mixedCashInput);
  }

  function getMixedOtherAmount() {
    return getNumericInput(mixedOtherAmountInput);
  }

  function getPaymentSummaryForSave() {
    if (selectedPaymentMethod === "Cash") {
      const cash = getCashReceivedAmount();
      const change = getCashChangeAmount();
      return `Cash (Received AED ${cash.toFixed(2)}, Change AED ${change.toFixed(2)})`;
    }

    if (selectedPaymentMethod === "Mixed") {
      const cash = getMixedCashAmount();
      const other = getMixedOtherAmount();
      return `Mixed (Cash AED ${cash.toFixed(2)} + ${mixedOtherMethod} AED ${other.toFixed(2)})`;
    }

    return selectedPaymentMethod;
  }

  function buildPaymentDetailsHtml() {
    if (selectedPaymentMethod === "Cash") {
      return `
        <div class="meta-row"><span class="label">Payment / الدفع</span><span>Cash</span></div>
        <div class="meta-row"><span class="label">Cash / نقداً</span><span>AED ${getCashReceivedAmount().toFixed(2)}</span></div>
        <div class="meta-row"><span class="label">Change / الباقي</span><span>AED ${getCashChangeAmount().toFixed(2)}</span></div>
      `;
    }

    if (selectedPaymentMethod === "Mixed") {
      return `
        <div class="meta-row"><span class="label">Payment / الدفع</span><span>Mixed</span></div>
        <div class="meta-row"><span class="label">Cash / نقداً</span><span>AED ${getMixedCashAmount().toFixed(2)}</span></div>
        <div class="meta-row"><span class="label">${mixedOtherMethod} / ${mixedOtherMethod}</span><span>AED ${getMixedOtherAmount().toFixed(2)}</span></div>
      `;
    }

    return `<div class="meta-row"><span class="label">Payment / الدفع</span><span>${selectedPaymentMethod || "-"}</span></div>`;
  }

  function continueFromPaymentModal() {
    if (!selectedPaymentMethod) {
      alert("Please select a payment method.");
      return;
    }

    if (selectedPaymentMethod === "Cash") {
      const cash = getCashReceivedAmount();
      if (cash < total) {
        alert("Cash received cannot be less than total amount.");
        return;
      }
    }

    if (selectedPaymentMethod === "Mixed") {
      const cash = getMixedCashAmount();
      const other = getMixedOtherAmount();
      const mixedTotal = cash + other;
      if (cash <= 0 || other <= 0) {
        alert("Please enter both cash and second payment amounts for mixed payment.");
        return;
      }
      if (Math.abs(mixedTotal - total) > 0.01) {
        alert(`Mixed amounts must equal total AED ${total.toFixed(2)}.`);
        return;
      }
    }

    setShowPaymentModal(false);
    setShowPrintModal(true);
  }

  async function confirmPaymentAndSave() {
    if (!selectedPaymentMethod) {
      alert("Please select a payment method first.");
      return false;
    }

    const activeReceptionistId = receptionistId || loginReceptionistId;

    if (!transactionPatientId || !doctorId || !activeReceptionistId || selectedServices.length === 0) {
      alert("Please complete the receipt before finishing the transaction.");
      return false;
    }

    setIsSavingReceipt(true);

    const { data: receiptData, error: receiptError } = await supabase
      .from("receipts")
      .insert([
        {
          patient_id: transactionPatientId,
          doctor_id: doctorId,
          receptionist_id: activeReceptionistId,
          subtotal: subtotal,
          vat: vat,
          total: total,
          notes: notes,
          payment_method: getPaymentSummaryForSave(),
        },
      ])
      .select()
      .single();

    if (receiptError || !receiptData) {
      console.error("Receipt insert error", receiptError);
      setIsSavingReceipt(false);
      alert(`Error saving receipt: ${receiptError?.message || "unknown error"}`);
      return false;
    }

    const items = selectedServices.map((service) => ({
      receipt_id: receiptData.id,
      service_id: service.id,
      quantity: 1,
      price: service.price,
      total: service.price,
    }));

    const { data: itemsData, error: itemsError } = await supabase.from("receipt_items").insert(items).select();

    setIsSavingReceipt(false);

    if (itemsError || !itemsData) {
      console.error("Receipt items insert error", itemsError);
      alert(`Error saving receipt items: ${itemsError?.message || "unknown error"}`);
      return false;
    }

    return true;
  }

  function generateInvoiceHtml() {
    const now = new Date();
    const invoiceNumber = `INV-${String(now.getTime()).slice(-6)}`;
    const dateStr = now.toLocaleDateString("en-GB");

    const selectedPatient = patients.find((p) => p.id === transactionPatientId);
    const patientNameForInvoice = selectedPatient?.name || patientName || "Patient Name";
    const patientPhoneForInvoice = selectedPatient?.phone || patientPhoneInput || "-";
    const patientEmailForInvoice = selectedPatient?.email || patientEmailInput || "-";
    const patientAddressForInvoice = "Address Line 1";
    const doctorNameForInvoice = doctors.find((d) => d.id === doctorId)?.name || "Doctor";

    const itemsRows = selectedServices
      .map(
        (service, index) => `<tr>
            <td style="text-align:center; padding: 10px 8px; font-weight: 600; color: #333;">${index + 1}</td>
            <td style="padding: 10px 8px; color: #333;">${service.name}</td>
            <td style="text-align:center; padding: 10px 8px; color: #333;">1</td>
            <td style="text-align:right; padding: 10px 8px; color: #333;">AED ${Number(service.price).toFixed(2)}</td>
            <td style="text-align:right; padding: 10px 8px; font-weight: 600; color: #d4af37;">AED ${Number(service.price).toFixed(2)}</td>
          </tr>`
      )
      .join("");

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Invoice</title>
  <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&family=Cairo:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    @page {
      size: A4;
      margin: 0;
    }

    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
    }

    body {
      font-family: 'Poppins', 'Cairo', sans-serif;
      background: #fff;
      color: #333;
    }

    .invoice-container {
      width: 210mm;
      height: 297mm;
      background: white;
      display: flex;
      flex-direction: column;
      margin: 0;
      padding: 0;
      page-break-after: always;
      overflow: hidden;
    }

    @media print {
      @page {
        size: A4;
        margin: 0;
      }
      html, body {
        margin: 0;
        padding: 0;
        width: 100%;
      }
      .invoice-container {
        width: 210mm;
        height: 297mm;
        margin: 0;
        padding: 0;
        box-shadow: none;
        page-break-after: always;
        overflow: hidden;
      }
    }

    /* HEADER */
    .header {
      background: #000;
      padding: 20mm 15mm 0 15mm;
      position: relative;
    }

    .header-top {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 15mm;
    }

    .logo-section {
      display: flex;
      flex-direction: column;
      align-items: center;
      width: 50mm;
    }

    .logo-section img {
      width: 45mm;
      height: 45mm;
      object-fit: contain;
      margin-bottom: 3mm;
    }

    .clinic-name {
      font-family: 'Poppins', sans-serif;
      font-size: 20px;
      font-weight: 700;
      color: #fff;
      text-align: center;
      line-height: 1.2;
    }

    .clinic-sub {
      font-family: 'Cairo', sans-serif;
      font-size: 11px;
      color: #d4af37;
      margin-top: 2px;
      text-align: center;
      line-height: 1.3;
    }

    .header-right {
      text-align: right;
    }

    .invoice-title {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 3mm;
    }

    .invoice-main-title {
      font-family: 'Poppins', sans-serif;
      font-size: 48px;
      font-weight: 700;
      color: #d4af37;
      letter-spacing: 2px;
    }

    .invoice-main-title-ar {
      font-family: 'Cairo', sans-serif;
      font-size: 28px;
      font-weight: 700;
      color: #d4af37;
      margin-top: -5px;
    }

    .invoice-meta {
      font-size: 10px;
      color: #fff;
      line-height: 1.6;
    }

    .invoice-meta p {
      margin: 2px 0;
      display: flex;
      justify-content: flex-end;
      gap: 8mm;
    }

    .invoice-meta-label {
      font-weight: 600;
      color: #d4af37;
      min-width: 30mm;
      text-align: right;
    }

    .invoice-meta-value {
      color: #fff;
      min-width: 40mm;
      text-align: left;
    }

    /* CURVED DIVIDER */
    .curved-divider {
      height: 15mm;
      background: white;
      overflow: hidden;
    }

    .curved-divider svg {
      width: 100%;
      height: 100%;
    }

    /* CONTENT */
    .content {
      flex: 1;
      padding: 12mm 15mm;
      display: flex;
      flex-direction: column;
      gap: 8mm;
    }

    .section-title {
      font-family: 'Poppins', sans-serif;
      font-size: 10px;
      font-weight: 600;
      color: #d4af37;
      text-transform: uppercase;
      letter-spacing: 1px;
      border-bottom: 2px solid #d4af37;
      padding-bottom: 2mm;
      margin-bottom: 4mm;
    }

    /* BILL TO / FROM */
    .bill-from-section {
      display: grid;
      grid-template-columns: 1fr 1.2fr;
      gap: 15mm;
      margin-bottom: 4mm;
    }

    .bill-box {
      display: flex;
      flex-direction: column;
    }

    .bill-box h3 {
      font-family: 'Poppins', sans-serif;
      font-size: 9px;
      font-weight: 700;
      color: #d4af37;
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-bottom: 4mm;
    }

    .bill-item {
      font-size: 9px;
      line-height: 1.5;
      margin: 2px 0;
    }

    .bill-item-label {
      color: #d4af37;
      font-weight: 600;
      display: inline-block;
      width: 35mm;
    }

    .bill-item-value {
      color: #333;
    }

    /* ITEMS TABLE */
    .items-table {
      width: 100%;
      border-collapse: collapse;
      margin: 6mm 0;
      font-size: 9px;
    }

    .items-table thead {
      background: #000;
      color: #d4af37;
    }

    .items-table thead th {
      padding: 8px;
      text-align: left;
      font-family: 'Poppins', sans-serif;
      font-size: 9px;
      font-weight: 700;
      border: 1px solid #000;
      text-transform: uppercase;
    }

    .items-table tbody td {
      padding: 8px;
      border-bottom: 1px solid #e0e0e0;
      font-size: 9px;
    }

    .items-table tbody tr:nth-child(even) {
      background: #fafafa;
    }

    .items-table tbody tr:hover {
      background: #f5f5f5;
    }

    /* PAYMENT & SUMMARY */
    .bottom-section {
      display: grid;
      grid-template-columns: 1fr 1.2fr;
      gap: 15mm;
      margin-top: 6mm;
    }

    .payment-info {
      font-size: 9px;
      line-height: 1.6;
    }

    .payment-info-item {
      display: flex;
      justify-content: space-between;
      margin: 3mm 0;
      padding-bottom: 2mm;
    }

    .payment-info-label {
      color: #d4af37;
      font-weight: 600;
      min-width: 35mm;
    }

    .payment-info-value {
      color: #333;
      text-align: right;
    }

    .summary-box {
      display: flex;
      flex-direction: column;
    }

    .summary-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 9px;
    }

    .summary-table tr {
      border-bottom: 1px solid #e0e0e0;
    }

    .summary-table tr td {
      padding: 6mm 6mm;
    }

    .summary-label {
      text-align: left;
      color: #333;
      font-weight: 500;
    }

    .summary-value {
      text-align: right;
      color: #333;
      font-weight: 500;
    }

    .summary-table tr:last-child {
      background: #d4af37;
      border: none;
    }

    .summary-table tr:last-child .summary-label,
    .summary-table tr:last-child .summary-value {
      color: #000;
      font-weight: 700;
      font-size: 10px;
    }

    /* NOTES & THANK YOU */
    .notes-thank-section {
      display: grid;
      grid-template-columns: 1fr 1.2fr;
      gap: 15mm;
      margin-top: 6mm;
    }

    .notes-section h3 {
      font-family: 'Poppins', sans-serif;
      font-size: 9px;
      font-weight: 700;
      color: #d4af37;
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-bottom: 3mm;
    }

    .notes-section p {
      font-size: 8px;
      line-height: 1.5;
      color: #333;
    }

    .thank-you-section {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
    }

    .thank-you-text {
      font-family: 'Poppins', sans-serif;
      font-size: 32px;
      font-weight: 700;
      color: #d4af37;
      font-style: italic;
      line-height: 1;
    }

    .thank-you-sub {
      font-family: 'Cairo', sans-serif;
      font-size: 14px;
      color: #d4af37;
      margin-top: 2mm;
    }

    .thank-you-tooth {
      font-size: 28px;
      margin-top: 2mm;
    }

    /* FOOTER */
    .footer {
      background: #000;
      color: #fff;
      padding: 10mm 15mm;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 8px;
      border-top: 3mm solid #d4af37;
    }

    .footer-contact {
      flex: 1;
      line-height: 1.6;
    }

    .footer-contact p {
      margin: 1mm 0;
    }

    .footer-social {
      flex: 1;
      text-align: center;
      padding: 0 15mm;
      border-left: 1px solid #d4af37;
      border-right: 1px solid #d4af37;
      line-height: 1.6;
    }

    .footer-social p {
      margin: 1mm 0;
    }

    .footer-address {
      flex: 1;
      text-align: right;
      line-height: 1.6;
    }

    .footer-address p {
      margin: 1mm 0;
    }

    .footer-icon {
      color: #d4af37;
      margin-right: 2mm;
    }

    @media print {
      body, html {
        margin: 0;
        padding: 0;
      }
      .invoice-container {
        box-shadow: none;
        margin: 0;
        width: 210mm;
        height: 297mm;
      }
    }
  </style>
</head>
<body>
  <div class="invoice-container">
    <!-- HEADER -->
    <div class="header">
      <div class="header-top">
        <div class="logo-section">
          <img src="/images/logo2.png" alt="Skin and Smile Logo" onerror="this.style.display='none'">
          <div class="clinic-name">Skin and Smile</div>
          <div class="clinic-sub">Dental Clinic</div>
        </div>
        <div class="header-right">
          <div class="invoice-title">
            <div class="invoice-main-title">INVOICE</div>
            <div class="invoice-main-title-ar">فاتورة</div>
          </div>
          <div class="invoice-meta">
            <p>
              <span class="invoice-meta-label">Invoice No.</span>
              <span class="invoice-meta-value">${invoiceNumber}</span>
            </p>
            <p>
              <span class="invoice-meta-label">Invoice Date</span>
              <span class="invoice-meta-value">${dateStr}</span>
            </p>
            <p>
              <span class="invoice-meta-label">Due Date</span>
              <span class="invoice-meta-value">${dateStr}</span>
            </p>
          </div>
        </div>
      </div>
    </div>

    <!-- CURVED DIVIDER -->
    <div class="curved-divider">
      <svg viewBox="0 0 1000 100" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="goldGrad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" style="stop-color:#d4af37;stop-opacity:1" />
            <stop offset="100%" style="stop-color:#b8941f;stop-opacity:1" />
          </linearGradient>
        </defs>
        <path d="M 0,30 Q 250,5 500,30 T 1000,30 L 1000,100 L 0,100 Z" fill="url(#goldGrad)" />
      </svg>
    </div>

    <!-- CONTENT -->
    <div class="content">
      <!-- BILL TO / FROM -->
      <div class="bill-from-section">
        <div class="bill-box">
          <h3>BILL TO</h3>
          <div class="bill-item">
            <span class="bill-item-label">Patient Name</span>
            <span class="bill-item-value">${patientNameForInvoice}</span>
          </div>
          <div class="bill-item">
            <span class="bill-item-label">Address Line 1</span>
            <span class="bill-item-value">${patientAddressForInvoice}</span>
          </div>
          <div class="bill-item">
            <span class="bill-item-label">Phone Number</span>
            <span class="bill-item-value">${patientPhoneForInvoice}</span>
          </div>
          <div class="bill-item">
            <span class="bill-item-label">Email Address</span>
            <span class="bill-item-value">${patientEmailForInvoice}</span>
          </div>
        </div>

        <div class="bill-box">
          <h3>FROM</h3>
          <div class="bill-item">
            <strong>Skin and Smile Dental Clinic</strong>
          </div>
          <div class="bill-item" style="margin-top: 2mm;">
            Al Satwa, Dubai, UAE
          </div>
          <div class="bill-item">
            Same Building of Almaya Supermarket,<br>
            Near Satwa Bus Station, 2nd Floor, Room 207
          </div>
          <div class="bill-item" style="margin-top: 3mm;">
            <span class="bill-item-label" style="color: #d4af37;">📞</span>
            <span class="bill-item-value">+971 56 423 443</span>
          </div>
          <div class="bill-item">
            <span class="bill-item-label" style="color: #d4af37;">📧</span>
            <span class="bill-item-value">info@skinandsmile.com</span>
          </div>
          <div class="bill-item">
            <span class="bill-item-label" style="color: #d4af37;">🌐</span>
            <span class="bill-item-value">www.skinandsmile.com</span>
          </div>
        </div>
      </div>

      <!-- ITEMS TABLE -->
      <table class="items-table">
        <thead>
          <tr>
            <th style="width: 25px;">NO.</th>
            <th>DESCRIPTION</th>
            <th style="width: 55px;">QUANTITY</th>
            <th style="width: 70px;">UNIT PRICE</th>
            <th style="width: 70px;">AMOUNT</th>
          </tr>
        </thead>
        <tbody>
          ${itemsRows}
        </tbody>
      </table>

      <!-- PAYMENT INFO & SUMMARY -->
      <div class="bottom-section">
        <div class="payment-info">
          <div class="section-title">PAYMENT INFORMATION</div>
          <div class="payment-info-item">
            <span class="payment-info-label">Bank Name</span>
            <span class="payment-info-value">-</span>
          </div>
          <div class="payment-info-item">
            <span class="payment-info-label">Account Name</span>
            <span class="payment-info-value">Skin and Smile Dental Clinic</span>
          </div>
          <div class="payment-info-item">
            <span class="payment-info-label">Account No.</span>
            <span class="payment-info-value">-</span>
          </div>
          <div class="payment-info-item">
            <span class="payment-info-label">IBAN</span>
            <span class="payment-info-value">-</span>
          </div>
          <div class="payment-info-item">
            <span class="payment-info-label">Payment Method</span>
            <span class="payment-info-value">Cash / Card / Bank Transfer</span>
          </div>
        </div>

        <div class="summary-box">
          <table class="summary-table">
            <tr>
              <td class="summary-label">SUBTOTAL</td>
              <td class="summary-value">AED ${subtotal.toFixed(2)}</td>
            </tr>
            <tr>
              <td class="summary-label">DISCOUNT</td>
              <td class="summary-value">AED 0.00</td>
            </tr>
            <tr>
              <td class="summary-label">TAX (0%)</td>
              <td class="summary-value">AED ${vat.toFixed(2)}</td>
            </tr>
            <tr>
              <td class="summary-label">TOTAL DUE</td>
              <td class="summary-value">AED ${total.toFixed(2)}</td>
            </tr>
          </table>
        </div>
      </div>

      <!-- NOTES & THANK YOU -->
      <div class="notes-thank-section">
        <div class="notes-section">
          <h3>NOTES</h3>
          <p>${notes || "Thank you for choosing Skin and Smile Dental Clinic. We appreciate your trust in us!"}</p>
        </div>
        <div class="thank-you-section">
          <div class="thank-you-text">Thank You!</div>
          <div class="thank-you-sub">شكراً لك!</div>
          <div class="thank-you-tooth">🦷</div>
        </div>
      </div>
    </div>

    <!-- FOOTER -->
    <div class="footer">
      <div class="footer-contact">
        <p><span class="footer-icon">📞</span>+971 56 423 443</p>
        <p><span class="footer-icon">📧</span>info@skinandsmile.com</p>
      </div>
      <div class="footer-social">
        <p><span class="footer-icon">📱</span>@skinandsmile</p>
        <p><span class="footer-icon">📸</span>@skinandsmiledentalclinic</p>
        <p><span class="footer-icon">👍</span>Skin and Smile Dental Clinic Official</p>
      </div>
      <div class="footer-address">
        <p>Al Satwa, Dubai, UAE</p>
        <p>Same Building of Almaya Supermarket</p>
        <p>2nd Floor, Room 207</p>
      </div>
    </div>
  </div>
</body>
</html>`;
  }

  function buildThermalReceiptHtml(logoPath: string, title: string) {
    const now = new Date();
    const serial = String(now.getTime()).slice(-5);
    const invoiceNo = `INV-${now.getFullYear()}${serial}`;
    const dateValue = now.toLocaleDateString("en-GB");
    const timeValue = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });

    const selectedPatient = patients.find((p) => p.id === transactionPatientId);
    const patientNameForReceipt = selectedPatient?.name || patientName || "-";
    const patientMobileForReceipt = selectedPatient?.phone || patientPhoneInput || "-";
    const patientIdForReceipt = selectedPatient?.patient_id || selectedPatient?.patient_code || selectedPatient?.id || "-";
    const doctorNameForReceipt = doctors.find((d) => d.id === doctorId)?.name || "-";
    const cashierName =
      receptionists.find((person) => person.id === (receptionistId || loginReceptionistId))?.name || "Reception";

    const itemsHtml = selectedServices
      .map(
        (service) => `
          <div class="row item-row">
            <span class="item-name">${service.name}</span>
            <span class="amount">AED ${Number(service.price).toFixed(2)}</span>
          </div>`
      )
      .join("");

    let paymentSection = `
      <div class="row"><span>Payment Method / طريقة الدفع</span><span>: ${(selectedPaymentMethod || "-").toUpperCase()}</span></div>
      <div class="row"><span>Amount Paid / المبلغ المدفوع</span><span>: AED ${total.toFixed(2)}</span></div>
    `;

    if (selectedPaymentMethod === "Cash") {
      paymentSection = `
        <div class="row"><span>Payment Method / طريقة الدفع</span><span>: CASH</span></div>
        <div class="row"><span>Amount Paid / المبلغ المدفوع</span><span>: AED ${getCashReceivedAmount().toFixed(2)}</span></div>
        <div class="row"><span>Change / الباقي</span><span>: AED ${getCashChangeAmount().toFixed(2)}</span></div>
      `;
    }

    if (selectedPaymentMethod === "Mixed") {
      paymentSection = `
        <div class="row"><span>Payment Method / طريقة الدفع</span><span>: MIX</span></div>
        <div class="row"><span>Cash / نقداً</span><span>: AED ${getMixedCashAmount().toFixed(2)}</span></div>
        <div class="row"><span>${mixedOtherMethod}</span><span>: AED ${getMixedOtherAmount().toFixed(2)}</span></div>
      `;
    }

    return `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>${title}</title>
        <style>
          * { box-sizing: border-box; }
          body {
            font-family: Arial, Helvetica, sans-serif;
            width: 72mm;
            margin: 0;
            padding: 2mm;
            font-size: 10px;
            line-height: 1.25;
            color: #000;
            background: #fff;
            overflow-x: hidden;
          }
          .center { text-align: center; }
          .hr { border-top: 1px dashed #000; margin: 5px 0; }
          .double {
            border-top: 2px solid #000;
            border-bottom: 2px solid #000;
            padding: 3px 0;
            margin: 5px 0;
            text-align: center;
            font-weight: 700;
          }
          .logo-wrap { display: flex; justify-content: center; margin-bottom: 4px; }
          .logo { max-width: 35mm; max-height: 20mm; object-fit: contain; }
          .clinic-name { text-align: center; font-size: 14px; font-weight: 700; line-height: 1.1; }
          .address { text-align: center; font-size: 9px; line-height: 1.25; margin-top: 4px; }
          .row {
            display: flex;
            justify-content: space-between;
            gap: 6px;
            margin: 1px 0;
          }
          .row span:first-child { min-width: 30mm; }
          .row span:last-child {
            text-align: right;
            flex: 1;
            min-width: 0;
            overflow-wrap: anywhere;
            word-break: break-word;
          }
          .head-row { display: flex; justify-content: space-between; font-weight: 700; }
          .item-row { margin: 2px 0; }
          .item-name { flex: 1; min-width: 0; overflow-wrap: anywhere; }
          .amount { text-align: right; white-space: nowrap; }
          .footer-center { text-align: center; margin-top: 4px; }
          @media print {
            @page { size: 80mm auto; margin: 0; }
            body { width: 72mm; }
          }
        </style>
      </head>
      <body>
        <div class="logo-wrap" id="logo-wrap">
          <img src="${logoPath}" alt="Clinic logo" class="logo" onerror="document.getElementById('logo-wrap').style.display='none'" />
        </div>

        <div class="double">TAX INVOICE</div>

        <div class="clinic-name">SKIN &amp; SMILE<br/>DENTAL CLINIC</div>

        <div class="address">
          <div>Al Satwa, Dubai, UAE</div>
          <div>Same Building of Almaya Supermarket</div>
          <div>Near Satwa Bus Station</div>
          <div>2nd Floor, Room 207</div>
          <div style="margin-top:2px;font-weight:700;">TRN: 100495728600001</div>
        </div>

        <div class="hr"></div>

        <div class="row"><span>Invoice No / رقم الفاتورة</span><span>: ${invoiceNo}</span></div>
        <div class="row"><span>Date / التاريخ</span><span>: ${dateValue}</span></div>
        <div class="row"><span>Time / الوقت</span><span>: ${timeValue}</span></div>
        <div class="row"><span>Cashier / أمين الصندوق</span><span>: ${cashierName}</span></div>
        <div class="row"><span>Doctor / الطبيب</span><span>: ${doctorNameForReceipt}</span></div>
        <div class="row"><span>Patient Name / اسم المريض</span><span>: ${patientNameForReceipt}</span></div>
        <div class="row"><span>Patient ID / معرف المريض</span><span>: ${String(patientIdForReceipt)}</span></div>
        <div class="row"><span>Mobile / الهاتف</span><span>: ${patientMobileForReceipt}</span></div>

        <div class="hr"></div>

        <div class="head-row"><span>DESCRIPTION / الوصف</span><span>AMOUNT / المبلغ</span></div>
        <div class="hr" style="margin-top:2px;"></div>
        ${itemsHtml || '<div class="center">No services selected</div>'}

        <div class="hr"></div>

        <div class="row"><span>Subtotal / الإجمالي الجزئي</span><span>AED ${subtotal.toFixed(2)}</span></div>
        <div class="row"><span>VAT / الضريبة</span><span>AED ${vat.toFixed(2)}</span></div>
        <div class="hr" style="margin:4px 0;"></div>
        <div class="row" style="font-weight:700;"><span>TOTAL / الإجمالي</span><span>AED ${total.toFixed(2)}</span></div>

        <div class="hr"></div>

        ${paymentSection}

        ${notes ? `<div style="margin-top:4px;">Note / ملاحظة: ${notes}</div>` : ""}

        <div class="hr"></div>

        <div class="footer-center">VAT Included in Above Amount / الضريبة مشمولة في المبلغ أعلاه</div>
        <div class="footer-center">Thank you for visiting us / شكراً لزيارتك لنا</div>
        <div class="footer-center" style="margin-top:6px;">Follow us:</div>
        <div class="footer-center">Instagram: @skinandsmiledentalclinic</div>
        <div class="footer-center">TikTok: @skinandsmile</div>

        <div class="hr"></div>

        <div class="row"><span>For appointments - Number</span><span>: 04 272 5458</span></div>
        <div class="row"><span>WhatsApp</span><span>: 056 423 3443</span></div>

        <div class="hr"></div>

        <div class="double">Thank you for Visiting US!</div>
      </body>
    </html>`;
  }

  function printReceipt() {
    const receiptHtml = buildThermalReceiptHtml("/images/logo3.png", "Receipt");

    function openReceiptWindow(autoPrint: boolean) {
      const w = window.open("", "_blank", "width=400,height=600");
      if (!w) {
        alert("Please allow popups to print the receipt.");
        return;
      }
      w.document.open();
      w.document.write(receiptHtml);
      w.document.close();
      w.focus();

      if (autoPrint) {
        setTimeout(() => {
          w.print();
        }, 500);
      }
    }

    try {
      openReceiptWindow(true);
    } catch (error) {
      alert("Error opening print dialog. Please check browser settings.");
    }
  }

  function previewReceipt() {
    const receiptHtml = buildThermalReceiptHtml("/images/logo3.png", "Receipt Preview");

    setReceiptPreviewHtml(receiptHtml);
    setShowReceiptPreview(true);
    setShowPrintModal(false);
  }

  return (
    <AppFrame
      title="POS System"
      description="Process transactions with patient, doctor, and service details in one flow."
    >
      {!isPosUnlocked ? (
        <div className="mx-auto max-w-xl rounded-3xl border border-teal-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-teal-700/80">
            POS Access
          </p>
          <h2 className="mt-2 text-2xl font-semibold text-slate-900">Open Register</h2>
          <p className="mt-2 text-sm text-slate-600">
            Select receptionist, enter PIN, and add opening cash before starting the shift.
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
                {receptionists.map((person) => (
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
      <div className="grid gap-8 xl:grid-cols-[1.45fr_0.95fr]">
        <div className="space-y-6">
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="mb-4 rounded-2xl border border-teal-200 bg-teal-50/70 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-700">Register Open</p>
                  <p className="mt-1 text-sm text-slate-700">
                    Receptionist: {receptionists.find((person) => person.id === receptionistId)?.name || "-"}
                  </p>
                  <p className="mt-1 text-sm text-slate-700">Opening Cash: AED {Number(openingCash || 0).toFixed(2)}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    Opened at: {registerOpenedAt ? new Date(registerOpenedAt).toLocaleString() : "-"}
                  </p>
                </div>
                <button
                  onClick={openCloseRegisterModal}
                  className="inline-flex items-center justify-center rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
                >
                  Close Register
                </button>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-2">
              <div className="space-y-2">
                <label className="block text-sm font-semibold text-slate-700">Patient Name</label>
                <div className="relative">
                  <input
                    type="text"
                    value={patientName}
                    onChange={(e) => handlePatientNameChange(e.target.value)}
                    onFocus={() => patientName && setShowPatientSuggestions(true)}
                    placeholder="Type patient name or add new"
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-cyan-400 focus:ring-4 focus:ring-cyan-100"
                  />
                  {showPatientSuggestions && filteredPatients.length > 0 && (
                    <div className="absolute top-full mt-1 w-full rounded-2xl border border-slate-200 bg-white shadow-lg z-10">
                      {filteredPatients.map((patient) => (
                        <button
                          key={patient.id}
                          onClick={() => selectPatient(patient)}
                          className="w-full px-4 py-2 text-left text-sm text-slate-900 hover:bg-cyan-50 border-b border-slate-100 last:border-b-0 transition"
                        >
                          <span className="font-medium">{patient.name}</span>
                          {patient.phone && (
                            <span className="ml-2 text-xs text-slate-400">{patient.phone}</span>
                          )}
                          {calculateAge(patient.date_of_birth) !== null && (
                            <span className="ml-2 text-xs text-slate-400">{calculateAge(patient.date_of_birth)} yrs</span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {patientId && selectedPatientInfo && (
                <div className="rounded-xl border border-cyan-100 bg-cyan-50 px-3 py-2">
                  <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-600">
                    {selectedPatientInfo.sex && (
                      <span><span className="font-medium">Sex:</span> {selectedPatientInfo.sex}</span>
                    )}
                    {calculateAge(selectedPatientInfo.date_of_birth) !== null && (
                      <span><span className="font-medium">Age:</span> {calculateAge(selectedPatientInfo.date_of_birth)} yrs</span>
                    )}
                    {selectedPatientInfo.nationality && (
                      <span><span className="font-medium">Nationality:</span> {selectedPatientInfo.nationality}</span>
                    )}
                    {selectedPatientInfo.emirates_id && (
                      <span><span className="font-medium">Emirates ID:</span> {selectedPatientInfo.emirates_id}</span>
                    )}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <label className="block text-sm font-semibold text-slate-700">Patient Phone (Optional)</label>
                <input
                  type="text"
                  value={patientPhoneInput}
                  onChange={(e) => setPatientPhoneInput(e.target.value)}
                  placeholder="e.g. +971..."
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-cyan-400 focus:ring-4 focus:ring-cyan-100"
                />
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-semibold text-slate-700">
                  Date of Birth
                  {patientDobInput && (
                    <span className="ml-2 font-normal text-cyan-600">
                      ({calculateAge(patientDobInput)} yrs)
                    </span>
                  )}
                </label>
                <input
                  type="date"
                  value={patientDobInput}
                  onChange={(e) => setPatientDobInput(e.target.value)}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-cyan-400 focus:ring-4 focus:ring-cyan-100"
                />
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-semibold text-slate-700">Sex</label>
                <select
                  value={patientSexInput}
                  onChange={(e) => setPatientSexInput(e.target.value)}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-cyan-400 focus:ring-4 focus:ring-cyan-100"
                >
                  <option value="">Select</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                </select>
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-semibold text-slate-700">Doctor</label>
                <select
                  value={doctorId}
                  onChange={(e) => setDoctorId(e.target.value)}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-cyan-400 focus:ring-4 focus:ring-cyan-100"
                >
                  <option value="">Select Doctor</option>
                  {doctors.map((doctor) => (
                    <option key={doctor.id} value={doctor.id}>
                      {doctor.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-semibold text-slate-700">Patient Email (Optional)</label>
                <input
                  type="email"
                  value={patientEmailInput}
                  onChange={(e) => setPatientEmailInput(e.target.value)}
                  placeholder="patient@example.com"
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-cyan-400 focus:ring-4 focus:ring-cyan-100"
                />
              </div>
            </div>

            <div className="mt-5">
              <label className="block text-sm font-semibold text-slate-700">Notes</label>
              <textarea
                placeholder="Optional note for the receipt"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="mt-2 min-h-[120px] w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-cyan-400 focus:ring-4 focus:ring-cyan-100"
              />
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

            <div className="space-y-3">
              <input
                type="text"
                value={serviceSearch}
                onChange={(e) => setServiceSearch(e.target.value)}
                placeholder="Search service name..."
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-cyan-400 focus:ring-4 focus:ring-cyan-100"
              />

              <div className="flex gap-2 overflow-x-auto pb-1">
                {serviceCategories.map((category) => {
                  const isActive = serviceCategory === category.key;
                  return (
                    <button
                      key={category.key}
                      type="button"
                      onClick={() => setServiceCategory(category.key)}
                      className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                        isActive
                          ? "bg-cyan-600 text-white"
                          : "border border-slate-200 bg-white text-slate-600 hover:border-cyan-300"
                      }`}
                    >
                      {category.label}
                    </button>
                  );
                })}
              </div>

              {recentServices.length > 0 && !serviceSearch.trim() && serviceCategory === "all" ? (
                <div className="rounded-2xl border border-slate-200 bg-white p-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-500">
                    Recently used
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {recentServices.map((service) => (
                      <button
                        key={`recent-${service.id}`}
                        type="button"
                        onClick={() => addService(service)}
                        className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-cyan-300 hover:bg-cyan-50"
                      >
                        {service.name}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            {filteredServices.length === 0 ? (
              <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
                No services found. Try a different search or category.
              </div>
            ) : (
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-2">
                {filteredServices.map((service) => (
                  <button
                    key={service.id}
                    onClick={() => addService(service)}
                    className="rounded-2xl border border-slate-200 bg-white p-3 text-left shadow-sm transition hover:border-cyan-300 hover:bg-cyan-50 focus:outline-none focus:ring-4 focus:ring-cyan-100"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm font-semibold text-slate-900">{service.name}</p>
                      <span className="rounded-xl bg-cyan-100 px-2.5 py-1 text-xs font-semibold text-cyan-700">
                        AED {Number(service.price || 0).toFixed(0)}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <aside className="space-y-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-cyan-600">Cart</p>
                <h2 className="mt-2 text-xl font-semibold text-slate-900">Selected services</h2>
              </div>
              <span className="rounded-full bg-cyan-100 px-3 py-1 text-sm font-semibold text-cyan-700">
                {selectedServices.length} items
              </span>
            </div>

            <div className="mt-5 space-y-3">
              {selectedServices.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-sm text-slate-500">
                  Add services to build the receipt.
                </div>
              ) : (
                selectedServices.map((service, index) => (
                  <div
                    key={`${service.id}-${index}`}
                    className="flex items-center justify-between rounded-3xl border border-slate-200 bg-white p-4"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">{service.name}</p>
                      <p className="mt-1 text-xs text-slate-500">AED {service.price}</p>
                    </div>
                    <button
                      onClick={() => removeService(index)}
                      className="rounded-full bg-teal-50 px-3 py-1.5 text-xs font-semibold text-teal-600 transition hover:bg-teal-100"
                    >
                      Remove
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-3xl bg-slate-950 p-5 text-white shadow-lg">
            <div className="space-y-3 text-sm text-slate-300">
              <div className="flex items-center justify-between">
                <span>Subtotal</span>
                <span>AED {subtotal.toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>VAT (5%)</span>
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
                className="inline-flex items-center justify-center rounded-3xl bg-cyan-500 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-cyan-500/20 transition hover:bg-cyan-400"
              >
                Proceed to Payment
              </button>
            </div>

            {showPaymentModal && (
              <div className="fixed inset-0 flex items-center justify-center bg-black/50 z-50">
                <div className="rounded-3xl bg-white p-6 shadow-2xl max-w-md w-full mx-4">
                  <h3 className="text-lg font-semibold text-slate-900 mb-4">Select Payment Method</h3>
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

                  {selectedPaymentMethod === "Cash" && (
                    <div className="mt-4 space-y-2 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                      <label className="block text-xs font-semibold text-slate-600">Cash Received (AED)</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={cashReceivedInput}
                        onChange={(e) => setCashReceivedInput(e.target.value)}
                        placeholder={total.toFixed(2)}
                        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                      />
                      <p className="text-xs text-slate-600">Change: AED {getCashChangeAmount().toFixed(2)}</p>
                    </div>
                  )}

                  {selectedPaymentMethod === "Mixed" && (
                    <div className="mt-4 space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                      <div>
                        <label className="block text-xs font-semibold text-slate-600">Cash Amount (AED)</label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={mixedCashInput}
                          onChange={(e) => setMixedCashInput(e.target.value)}
                          className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-600">Second Method</label>
                        <select
                          value={mixedOtherMethod}
                          onChange={(e) => setMixedOtherMethod(e.target.value)}
                          className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                        >
                          {paymentOptions
                            .filter((method) => method !== "Cash" && method !== "Mixed")
                            .map((method) => (
                              <option key={method} value={method}>
                                {method}
                              </option>
                            ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-600">Second Method Amount (AED)</label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={mixedOtherAmountInput}
                          onChange={(e) => setMixedOtherAmountInput(e.target.value)}
                          className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                        />
                      </div>
                      <p className="text-xs text-slate-600">Entered total: AED {(getMixedCashAmount() + getMixedOtherAmount()).toFixed(2)} / AED {total.toFixed(2)}</p>
                    </div>
                  )}

                  <button
                    onClick={continueFromPaymentModal}
                    className="mt-4 w-full rounded-2xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-cyan-400"
                  >
                    Continue
                  </button>
                  <button
                    onClick={() => setShowPaymentModal(false)}
                    className="mt-4 w-full rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {showPrintModal && (
              <div className="fixed inset-0 flex items-center justify-center bg-black/50 z-50">
                <div className="rounded-3xl bg-white p-6 shadow-2xl max-w-md w-full mx-4">
                  <h3 className="text-lg font-semibold text-slate-900 mb-4">Ready to finish</h3>
                  <p className="mb-6 text-sm text-slate-600">
                    Print the receipt or finish to save the transaction.
                  </p>
                  <div className="grid gap-3">
                    <button
                      onClick={() => {
                        printReceipt();
                      }}
                      className="inline-flex items-center justify-center rounded-2xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-cyan-400"
                    >
                      Print Receipt
                    </button>
                    <button
                      onClick={previewReceipt}
                      className="inline-flex items-center justify-center rounded-2xl border border-cyan-200 bg-white px-4 py-2 text-sm font-semibold text-cyan-700 transition hover:bg-cyan-50"
                    >
                      Preview Receipt
                    </button>
                    <button
                      onClick={async () => {
                        const saved = await confirmPaymentAndSave();
                        if (!saved) {
                          return;
                        }
                        setShowPrintModal(false);
                        setPatientId("");
                        setPatientName("");
                        setPatientPhoneInput("");
                        setPatientEmailInput("");
                        setTransactionPatientId("");
                        setDoctorId("");
                        setSelectedPaymentMethod("");
                        setNotes("");
                        setSelectedServices([]);
                        setFilteredPatients([]);
                        setShowPatientSuggestions(false);
                        router.refresh();
                      }}
                      className="inline-flex items-center justify-center rounded-2xl bg-teal-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-teal-400"
                      disabled={isSavingReceipt}
                    >
                      {isSavingReceipt ? "Saving..." : "Finish"}
                    </button>
                    <button
                      onClick={() => {
                        setShowPrintModal(false);
                        setShowPaymentModal(false);
                      }}
                      className="inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}

            {showReceiptPreview && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 py-6">
                <div className="flex h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
                  <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
                    <div>
                      <h3 className="text-lg font-semibold text-slate-900">Receipt Preview</h3>
                      <p className="text-sm text-slate-500">Check the generated receipt before printing.</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => receiptPreviewFrameRef.current?.contentWindow?.print()}
                        className="rounded-2xl bg-cyan-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-cyan-500"
                      >
                        Print
                      </button>
                      <button
                        onClick={() => setShowReceiptPreview(false)}
                        className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                      >
                        Close
                      </button>
                    </div>
                  </div>
                  <iframe
                    ref={receiptPreviewFrameRef}
                    title="Receipt preview"
                    srcDoc={receiptPreviewHtml}
                    className="h-full w-full bg-slate-100"
                  />
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
                        <p>Cash Payments Collected: AED {cashSalesTotal.toFixed(2)}</p>
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
          </div>
        </aside>
      </div>
      )}
    </AppFrame>
  );
}

