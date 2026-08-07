"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { buildThermalReceiptHtml } from "../../../lib/build-thermal-receipt-html";
import { getReceiptLogoPath, printHtmlWhenImagesReady, receiptLogoOptions } from "../../../lib/receipt-branding";
import { supabase } from "../../../lib/supabase";
import type { Clinic } from "../../../lib/types";
import {
  buildThermalLogoHtml,
  buildThermalReceiptCss,
  getThermalReceiptSettings,
  THERMAL_FONT_SIZE_RANGE_PX,
  THERMAL_LOGO_MAX_HEIGHT_RANGE_MM,
  THERMAL_LOGO_OFFSET_Y_RANGE_MM,
  THERMAL_LOGO_WIDTH_RANGE_MM,
  THERMAL_PAPER_WIDTH_MM,
  THERMAL_PRINTABLE_WIDTH_MM,
  THERMAL_RECEIPT_DEFAULTS,
  THERMAL_TEXT_WEIGHT_OPTIONS,
  validateThermalReceiptBrandingDraft,
  type ThermalLogoAlignment,
} from "../../../lib/thermal-receipt-branding";

const BACKEND_SELECTED_CLINIC_KEY = "backendSelectedClinicId";

export const dynamic = "force-dynamic";

type ReceiptBrandingForm = {
  address: string;
  room: string;
  phone: string;
  whatsapp: string;
  instagram: string;
  facebook: string;
  tiktok: string;
  receipt_print_name: string;
  receipt_title: string;
  receipt_vat_note: string;
  receipt_thank_you: string;
  receipt_final_message: string;
  receipt_qr_url: string;
  trn: string;
  logo: string;
  thermal_logo_width_mm: string;
  thermal_logo_max_height_mm: string;
  thermal_logo_alignment: ThermalLogoAlignment;
  thermal_logo_offset_x_mm: string;
  thermal_logo_offset_y_mm: string;
  thermal_logo_high_contrast: boolean;
  thermal_text_weight: string;
  thermal_font_size_px: string;
};

function sanitizeClinicPrintName(value: string) {
  return value.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s{2,}/g, " ").trim();
}

function createFormFromClinic(clinic: Clinic | null): ReceiptBrandingForm {
  const isSkinAndSmileReceipt = !clinic || clinic.logo !== "altamuze";
  const thermalSettings = getThermalReceiptSettings(clinic);

  return {
    address: clinic?.address || "",
    room: clinic?.room || "",
    phone: clinic?.phone || "",
    whatsapp: clinic?.whatsapp || "",
    instagram: clinic?.instagram || "",
    facebook: clinic?.facebook || "",
    tiktok: clinic?.tiktok || (isSkinAndSmileReceipt ? "@skinandsmile" : ""),
    receipt_print_name: clinic?.receipt_print_name || sanitizeClinicPrintName(clinic?.name || "Skin and Smile Dental Clinic"),
    receipt_title: clinic?.receipt_title || "TAX INVOICE",
    receipt_vat_note: clinic?.receipt_vat_note || "VAT Included in Above Amount / الضريبة مشمولة في المبلغ أعلاه",
    receipt_thank_you: clinic?.receipt_thank_you || "Thank you for visiting us / شكراً لزيارتك لنا",
    receipt_final_message: clinic?.receipt_final_message || "Thank you for Visiting US!",
    receipt_qr_url: clinic?.receipt_qr_url || "",
    trn: clinic?.trn || "",
    logo: clinic?.logo || "",
    thermal_logo_width_mm: String(thermalSettings.logoWidthMm),
    thermal_logo_max_height_mm: String(thermalSettings.logoMaxHeightMm),
    thermal_logo_alignment: thermalSettings.logoAlignment,
    thermal_logo_offset_x_mm: String(thermalSettings.logoOffsetXMm),
    thermal_logo_offset_y_mm: String(thermalSettings.logoOffsetYMm),
    thermal_logo_high_contrast: thermalSettings.logoHighContrast,
    thermal_text_weight: String(thermalSettings.textWeight),
    thermal_font_size_px: String(thermalSettings.fontSizePx),
  };
}

export default function ReceiptBrandingPage() {
  return (
    <Suspense fallback={<div className="min-h-[240px]" />}>
      <ReceiptBrandingPageContent />
    </Suspense>
  );
}

function ReceiptBrandingPageContent() {
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [clinics, setClinics] = useState<Clinic[]>([]);
  const [selectedClinicId, setSelectedClinicId] = useState("");
  const [form, setForm] = useState<ReceiptBrandingForm>(() => createFormFromClinic(null));

  const selectedClinic = useMemo(
    () => clinics.find((clinic) => clinic.id === selectedClinicId) || null,
    [clinics, selectedClinicId]
  );

  const defaultReceiptPrintName = sanitizeClinicPrintName(selectedClinic?.name || "Skin and Smile Dental Clinic");
  const receiptPrintNameValue = form.receipt_print_name || defaultReceiptPrintName;
  const thermalDraftValidation = useMemo(
    () => validateThermalReceiptBrandingDraft(form),
    [form]
  );
  const thermalSettings = thermalDraftValidation.settings;
  const previewClinic = useMemo(() => {
    if (!selectedClinic) return null;
    return {
      ...selectedClinic,
      address: form.address,
      room: form.room,
      phone: form.phone,
      whatsapp: form.whatsapp,
      instagram: form.instagram,
      facebook: form.facebook,
      tiktok: form.tiktok,
      receipt_print_name: receiptPrintNameValue,
      receipt_title: form.receipt_title,
      receipt_vat_note: form.receipt_vat_note,
      receipt_thank_you: form.receipt_thank_you,
      receipt_final_message: form.receipt_final_message,
      receipt_qr_url: form.receipt_qr_url,
      trn: form.trn,
      logo: form.logo,
      ...thermalDraftValidation.payload,
    } satisfies Clinic;
  }, [form, receiptPrintNameValue, selectedClinic, thermalDraftValidation.payload]);
  const thermalPreviewHtml = useMemo(() => {
    if (!previewClinic) return "";
    return buildThermalReceiptHtml({
      title: "Thermal Receipt Preview",
      clinic: previewClinic,
      invoiceNumber: "#00001",
      dateValue: "07/08/2026",
      timeValue: "10:30 AM",
      cashierName: "Reception",
      doctorName: "Dr. Sample",
      patientName: "Preview Patient",
      patientPhone: "050 123 4567",
      patientFileNumber: "159450",
      doctorField: previewClinic.name.toLowerCase().includes("aesthetic") ? "Aesthetician / المختصة" : "Doctor / الطبيب",
      items: [
        { name: "Consultation and treatment planning", quantity: 1, price: 0 },
        { name: "Long service description to preview wrapping inside the 72mm printable area", quantity: 1, price: 245 },
      ],
      subtotal: 245,
      discountAmount: 20,
      vat: 10.71,
      total: 225,
      allocations: [
        {
          methodVariant: "card",
          customerChargedAmount: 225,
          invoiceAllocationAmount: 225,
          feeAmount: 0,
          feeRate: 0,
        },
      ],
      creditUsed: 0,
      outstandingBalance: 0,
      notes: "Sample preview only. Physical darkness/heat must be adjusted in the printer or driver.",
      paymentMethod: "Card",
    });
  }, [previewClinic]);

  function resetThermalLayoutToDefaults() {
    setForm((current) => ({
      ...current,
      thermal_logo_width_mm: String(THERMAL_RECEIPT_DEFAULTS.logoWidthMm),
      thermal_logo_max_height_mm: String(THERMAL_RECEIPT_DEFAULTS.logoMaxHeightMm),
      thermal_logo_alignment: THERMAL_RECEIPT_DEFAULTS.logoAlignment,
      thermal_logo_offset_x_mm: String(THERMAL_RECEIPT_DEFAULTS.logoOffsetXMm),
      thermal_logo_offset_y_mm: String(THERMAL_RECEIPT_DEFAULTS.logoOffsetYMm),
      thermal_logo_high_contrast: THERMAL_RECEIPT_DEFAULTS.logoHighContrast,
      thermal_text_weight: String(THERMAL_RECEIPT_DEFAULTS.textWeight),
      thermal_font_size_px: String(THERMAL_RECEIPT_DEFAULTS.fontSizePx),
    }));
  }

  function buildThermalCalibrationReceiptHtml(clinic: Clinic) {
    const logoPath = getReceiptLogoPath(clinic, undefined, "thermal");
    const settings = getThermalReceiptSettings(clinic);
    return `<!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Thermal Calibration Receipt</title>
          <style>
            ${buildThermalReceiptCss(settings)}
            .boundary-box {
              border: 1px solid #000;
              padding: 3px;
              text-align: center;
              font-weight: 700;
            }
          </style>
        </head>
        <body>
          ${buildThermalLogoHtml(logoPath, "Clinic logo")}
          <div class="double">THERMAL CALIBRATION / معايرة الطباعة</div>
          <div class="clinic-name">${receiptPrintNameValue}</div>
          <div class="address">80mm roll / 72mm printable area preview only</div>
          <div class="hr"></div>
          <div class="boundary-box">72mm PRINTABLE AREA BOUNDARY</div>
          <div class="hr"></div>
          <div>Normal sample text at the current base size and weight.</div>
          <div style="font-weight:700;">Bold sample text for headings and totals.</div>
          <div style="font-weight:800;">Extra-bold sample text for maximum emphasis.</div>
          <div class="hr"></div>
          <div style="border-top:1px solid #000;margin:5px 0;"></div>
          <div style="border-top:2px solid #000;margin:5px 0;"></div>
          <div class="hr"></div>
          <div class="row"><span>Logo width</span><span>${settings.logoWidthMm.toFixed(1)}mm</span></div>
          <div class="row"><span>Logo max height</span><span>${settings.logoMaxHeightMm.toFixed(1)}mm</span></div>
          <div class="row"><span>Alignment</span><span>${settings.logoAlignment.toUpperCase()}</span></div>
          <div class="row"><span>Horizontal offset</span><span>${settings.logoOffsetXMm.toFixed(1)}mm</span></div>
          <div class="row"><span>Vertical offset</span><span>${settings.logoOffsetYMm.toFixed(1)}mm</span></div>
          <div class="row"><span>High contrast</span><span>${settings.logoHighContrast ? "ON" : "OFF"}</span></div>
          <div class="row"><span>Base text size</span><span>${settings.fontSizePx.toFixed(1)}px</span></div>
          <div class="row"><span>Base text weight</span><span>${String(settings.textWeight)}</span></div>
        </body>
      </html>`;
  }

  function printCalibrationReceipt() {
    if (!previewClinic) return;
    printHtmlWhenImagesReady(
      buildThermalCalibrationReceiptHtml(previewClinic),
      "Please allow popups to print the calibration receipt."
    );
  }

  function selectClinic(nextClinicId: string, availableClinics: Clinic[] = clinics) {
    const nextClinic = availableClinics.find((clinic) => clinic.id === nextClinicId) || null;
    setSelectedClinicId(nextClinicId);
    setForm(createFormFromClinic(nextClinic));
  }

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setIsLoading(true);
      const { data, error } = await supabase.from("clinics").select("*").order("name");
      setIsLoading(false);

      if (cancelled) return;
      if (error) {
        alert(`Error loading clinics: ${error.message || error.code || "Unknown error"}`);
        return;
      }

      const clinicRows = (data || []) as Clinic[];
      setClinics(clinicRows);

      const urlClinicId = typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("clinicId")
        : "";
      const savedClinicId = typeof window !== "undefined"
        ? window.localStorage.getItem(BACKEND_SELECTED_CLINIC_KEY)
        : "";
      const initialClinicId = [urlClinicId, savedClinicId, clinicRows[0]?.id || ""]
        .find((clinicId) => clinicId && clinicRows.some((clinic) => clinic.id === clinicId)) || clinicRows[0]?.id || "";

      const initialClinic = clinicRows.find((clinic) => clinic.id === initialClinicId) || null;
      setSelectedClinicId(initialClinicId);
      setForm(createFormFromClinic(initialClinic));
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedClinicId) return;
    if (typeof window === "undefined") return;
    window.localStorage.setItem(BACKEND_SELECTED_CLINIC_KEY, selectedClinicId);
  }, [selectedClinicId]);

  function updateForm<Key extends keyof ReceiptBrandingForm>(key: Key, value: ReceiptBrandingForm[Key]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function saveReceiptPrintSettings() {
    if (!selectedClinicId) {
      alert("Please select a clinic first.");
      return;
    }
    if (thermalDraftValidation.errors.length > 0) {
      alert(thermalDraftValidation.errors[0]);
      return;
    }

    const payload = {
      address: form.address.trim() || null,
      room: form.room.trim() || null,
      phone: form.phone.trim() || null,
      whatsapp: form.whatsapp.trim() || null,
      instagram: form.instagram.trim() || null,
      facebook: form.facebook.trim() || null,
      tiktok: form.tiktok.trim() || null,
      receipt_print_name: receiptPrintNameValue.trim() || null,
      receipt_title: form.receipt_title.trim() || null,
      receipt_vat_note: form.receipt_vat_note.trim() || null,
      receipt_thank_you: form.receipt_thank_you.trim() || null,
      receipt_final_message: form.receipt_final_message.trim() || null,
      receipt_qr_url: form.receipt_qr_url.trim() || null,
      trn: form.trn.trim() || null,
      logo: form.logo.trim() || null,
      ...thermalDraftValidation.payload,
    };

    setIsSaving(true);
    const { error } = await supabase.from("clinics").update(payload).eq("id", selectedClinicId);
    setIsSaving(false);

    if (error) {
      alert(`Error updating clinic receipt settings: ${error.message || error.code || "Unknown error"}`);
      return;
    }

    setClinics((current) =>
      current.map((clinic) => (clinic.id === selectedClinicId ? { ...clinic, ...payload } : clinic))
    );
    alert("Clinic receipt print settings updated.");
  }

  return (
    <div className="space-y-5">
    <div className="mb-5 flex flex-wrap items-center gap-3">
      <Link
        href="/backend"
        className="inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
      >
        ← Back to Backend
      </Link>
        <span className="text-sm font-semibold text-slate-700">Editing clinic:</span>
        <select
          value={selectedClinicId}
          onChange={(e) => selectClinic(e.target.value)}
          className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
        >
          {clinics.map((clinic) => (
            <option key={clinic.id} value={clinic.id}>{clinic.name}</option>
          ))}
        </select>
        {selectedClinic?.room ? (
          <span className="rounded-full bg-cyan-100 px-3 py-1 text-xs font-semibold text-cyan-700">
            {selectedClinic.room}
          </span>
        ) : null}
        <button
          onClick={saveReceiptPrintSettings}
          disabled={isSaving || !selectedClinicId}
          className="ml-auto inline-flex items-center justify-center rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSaving ? "Saving..." : "Save Receipt Settings"}
        </button>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-5">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Dedicated thermal branding editor</h2>
            <p className="mt-1 text-sm text-slate-500">
              Thermal receipt and reprint share one black-and-white setup. A4 invoice design is managed on a separate page.
            </p>
          </div>
          <div className="rounded-2xl border border-cyan-200 bg-cyan-50 px-4 py-3 text-xs text-cyan-800">
            <div className="font-semibold">A4 invoice is isolated</div>
            <div className="mt-1">
              Use the separate A4 invoice design page to change invoice-only logo, colors, and slogan without affecting thermal receipts.
            </div>
            <a
              href={`/backend/a4-invoice-design${selectedClinicId ? `?clinicId=${selectedClinicId}` : ""}`}
              className="mt-2 inline-flex items-center justify-center rounded-xl border border-cyan-300 bg-white px-3 py-2 text-xs font-semibold text-cyan-700 transition hover:bg-cyan-100"
            >
              Open A4 Invoice Design
            </a>
          </div>
        </div>

        {isLoading ? (
          <p className="text-sm text-slate-500">Loading clinics…</p>
        ) : !selectedClinic ? (
          <p className="text-sm text-slate-500">No clinic found.</p>
        ) : (
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_520px]">
            <div>
              <div className="grid gap-3 sm:grid-cols-2">
                <input
                  value={receiptPrintNameValue}
                  onChange={(e) => updateForm("receipt_print_name", e.target.value)}
                  placeholder="Printed clinic name"
                  className="rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
                />
                <input
                  value={form.receipt_title}
                  onChange={(e) => updateForm("receipt_title", e.target.value)}
                  placeholder="Receipt title"
                  className="rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
                />
                <input
                  value={form.phone}
                  onChange={(e) => updateForm("phone", e.target.value)}
                  placeholder="Phone"
                  className="rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
                />
                <input
                  value={form.whatsapp}
                  onChange={(e) => updateForm("whatsapp", e.target.value)}
                  placeholder="WhatsApp"
                  className="rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
                />
                <input
                  value={form.trn}
                  onChange={(e) => updateForm("trn", e.target.value)}
                  placeholder="TRN"
                  className="rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
                />
                <input
                  value={form.room}
                  onChange={(e) => updateForm("room", e.target.value)}
                  placeholder="Room (e.g. 408)"
                  className="rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
                />
                <input
                  value={form.receipt_qr_url}
                  onChange={(e) => updateForm("receipt_qr_url", e.target.value)}
                  placeholder="QR link"
                  className="rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
                />
                <input
                  value={form.instagram}
                  onChange={(e) => updateForm("instagram", e.target.value)}
                  placeholder="Instagram"
                  className="rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
                />
                <input
                  value={form.facebook}
                  onChange={(e) => updateForm("facebook", e.target.value)}
                  placeholder="Facebook"
                  className="rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
                />
                <input
                  value={form.tiktok}
                  onChange={(e) => updateForm("tiktok", e.target.value)}
                  placeholder="TikTok"
                  className="rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
                />
                <select
                  value={form.logo}
                  onChange={(e) => updateForm("logo", e.target.value)}
                  className="rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
                >
                  <option value="">Skin and Smile default</option>
                  {receiptLogoOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                <input
                  value={selectedClinic.name}
                  disabled
                  className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500 outline-none"
                />
              </div>

              <textarea
                value={form.address}
                onChange={(e) => updateForm("address", e.target.value)}
                placeholder="Clinic address (supports multiple lines)"
                rows={3}
                className="mt-3 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
              />
              <div className="mt-3 grid gap-3">
                <textarea
                  value={form.receipt_vat_note}
                  onChange={(e) => updateForm("receipt_vat_note", e.target.value)}
                  placeholder="VAT note"
                  rows={2}
                  className="rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
                />
                <textarea
                  value={form.receipt_thank_you}
                  onChange={(e) => updateForm("receipt_thank_you", e.target.value)}
                  placeholder="Thank-you line"
                  rows={2}
                  className="rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
                />
                <textarea
                  value={form.receipt_final_message}
                  onChange={(e) => updateForm("receipt_final_message", e.target.value)}
                  placeholder="Final receipt message"
                  rows={2}
                  className="rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
                />
              </div>

              <div className="mt-6 rounded-3xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-base font-semibold text-slate-900">Thermal Layout &amp; Print Clarity</h3>
                    <p className="mt-1 text-sm text-slate-500">
                      Control the thermal logo size and placement, plus the shared base text size and weight used by thermal receipts and reprints.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={resetThermalLayoutToDefaults}
                      className="rounded-2xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
                    >
                      Reset thermal layout to defaults
                    </button>
                    <button
                      type="button"
                      onClick={printCalibrationReceipt}
                      disabled={!previewClinic}
                      className="rounded-2xl border border-cyan-300 bg-cyan-50 px-3 py-2 text-xs font-semibold text-cyan-700 transition hover:bg-cyan-100 disabled:opacity-50"
                    >
                      Print calibration receipt
                    </button>
                  </div>
                </div>

                <div className="mt-4 space-y-4">
                  <div className="grid gap-4 lg:grid-cols-2">
                    <div className="rounded-2xl border border-slate-200 bg-white p-4">
                      <div className="flex items-center justify-between gap-3">
                        <label className="text-sm font-semibold text-slate-800">Logo width</label>
                        <span className="text-xs font-semibold text-slate-500">{thermalSettings.logoWidthMm.toFixed(1)}mm</span>
                      </div>
                      <input
                        type="range"
                        min={THERMAL_LOGO_WIDTH_RANGE_MM.min}
                        max={THERMAL_LOGO_WIDTH_RANGE_MM.max}
                        step="0.5"
                        value={parseFloat(form.thermal_logo_width_mm) || THERMAL_RECEIPT_DEFAULTS.logoWidthMm}
                        onChange={(e) => updateForm("thermal_logo_width_mm", e.target.value)}
                        className="mt-3 w-full accent-cyan-600"
                      />
                      <input
                        type="number"
                        min={THERMAL_LOGO_WIDTH_RANGE_MM.min}
                        max={THERMAL_LOGO_WIDTH_RANGE_MM.max}
                        step="0.5"
                        value={form.thermal_logo_width_mm}
                        onChange={(e) => updateForm("thermal_logo_width_mm", e.target.value)}
                        className="mt-3 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
                      />
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-white p-4">
                      <div className="flex items-center justify-between gap-3">
                        <label className="text-sm font-semibold text-slate-800">Logo maximum height</label>
                        <span className="text-xs font-semibold text-slate-500">{thermalSettings.logoMaxHeightMm.toFixed(1)}mm</span>
                      </div>
                      <input
                        type="range"
                        min={THERMAL_LOGO_MAX_HEIGHT_RANGE_MM.min}
                        max={THERMAL_LOGO_MAX_HEIGHT_RANGE_MM.max}
                        step="0.5"
                        value={parseFloat(form.thermal_logo_max_height_mm) || THERMAL_RECEIPT_DEFAULTS.logoMaxHeightMm}
                        onChange={(e) => updateForm("thermal_logo_max_height_mm", e.target.value)}
                        className="mt-3 w-full accent-cyan-600"
                      />
                      <input
                        type="number"
                        min={THERMAL_LOGO_MAX_HEIGHT_RANGE_MM.min}
                        max={THERMAL_LOGO_MAX_HEIGHT_RANGE_MM.max}
                        step="0.5"
                        value={form.thermal_logo_max_height_mm}
                        onChange={(e) => updateForm("thermal_logo_max_height_mm", e.target.value)}
                        className="mt-3 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
                      />
                    </div>
                  </div>

                  <div className="grid gap-4 lg:grid-cols-2">
                    <div className="rounded-2xl border border-slate-200 bg-white p-4">
                      <p className="text-sm font-semibold text-slate-800">Logo alignment</p>
                      <div className="mt-3 grid grid-cols-3 gap-2">
                        {([
                          ["left", "Left"],
                          ["center", "Center"],
                          ["right", "Right"],
                        ] as const).map(([value, label]) => (
                          <button
                            key={value}
                            type="button"
                            onClick={() => updateForm("thermal_logo_alignment", value)}
                            className={`rounded-2xl border px-3 py-2 text-sm font-semibold transition ${
                              form.thermal_logo_alignment === value
                                ? "border-cyan-400 bg-cyan-50 text-cyan-700"
                                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <label className="rounded-2xl border border-slate-200 bg-white p-4">
                      <span className="block text-sm font-semibold text-slate-800">High-contrast logo</span>
                      <span className="mt-1 block text-xs text-slate-500">
                        Applies grayscale and contrast filtering to the thermal logo in preview and print.
                      </span>
                      <input
                        type="checkbox"
                        checked={form.thermal_logo_high_contrast}
                        onChange={(e) => updateForm("thermal_logo_high_contrast", e.target.checked)}
                        className="mt-4 h-4 w-4 rounded accent-cyan-600"
                      />
                    </label>
                  </div>

                  <div className="grid gap-4 lg:grid-cols-2">
                    <div className="rounded-2xl border border-slate-200 bg-white p-4">
                      <div className="flex items-center justify-between gap-3">
                        <label className="text-sm font-semibold text-slate-800">Horizontal offset</label>
                        <span className="text-xs font-semibold text-slate-500">{thermalSettings.logoOffsetXMm.toFixed(1)}mm</span>
                      </div>
                      <input
                        type="range"
                        min={-62}
                        max={62}
                        step="0.5"
                        value={parseFloat(form.thermal_logo_offset_x_mm) || 0}
                        onChange={(e) => updateForm("thermal_logo_offset_x_mm", e.target.value)}
                        className="mt-3 w-full accent-cyan-600"
                      />
                      <input
                        type="number"
                        min={-62}
                        max={62}
                        step="0.5"
                        value={form.thermal_logo_offset_x_mm}
                        onChange={(e) => updateForm("thermal_logo_offset_x_mm", e.target.value)}
                        className="mt-3 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
                      />
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-white p-4">
                      <div className="flex items-center justify-between gap-3">
                        <label className="text-sm font-semibold text-slate-800">Vertical offset</label>
                        <span className="text-xs font-semibold text-slate-500">{thermalSettings.logoOffsetYMm.toFixed(1)}mm</span>
                      </div>
                      <input
                        type="range"
                        min={THERMAL_LOGO_OFFSET_Y_RANGE_MM.min}
                        max={THERMAL_LOGO_OFFSET_Y_RANGE_MM.max}
                        step="0.5"
                        value={parseFloat(form.thermal_logo_offset_y_mm) || 0}
                        onChange={(e) => updateForm("thermal_logo_offset_y_mm", e.target.value)}
                        className="mt-3 w-full accent-cyan-600"
                      />
                      <input
                        type="number"
                        min={THERMAL_LOGO_OFFSET_Y_RANGE_MM.min}
                        max={THERMAL_LOGO_OFFSET_Y_RANGE_MM.max}
                        step="0.5"
                        value={form.thermal_logo_offset_y_mm}
                        onChange={(e) => updateForm("thermal_logo_offset_y_mm", e.target.value)}
                        className="mt-3 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
                      />
                    </div>
                  </div>

                  <div className="grid gap-4 lg:grid-cols-2">
                    <div className="rounded-2xl border border-slate-200 bg-white p-4">
                      <p className="text-sm font-semibold text-slate-800">Text weight</p>
                      <div className="mt-3 grid grid-cols-3 gap-2">
                        {THERMAL_TEXT_WEIGHT_OPTIONS.map((value) => (
                          <button
                            key={value}
                            type="button"
                            onClick={() => updateForm("thermal_text_weight", String(value))}
                            className={`rounded-2xl border px-3 py-2 text-sm font-semibold transition ${
                              Number(form.thermal_text_weight) === value
                                ? "border-cyan-400 bg-cyan-50 text-cyan-700"
                                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                            }`}
                          >
                            {value === 500 ? "Normal" : value === 700 ? "Bold" : "Extra bold"}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-white p-4">
                      <div className="flex items-center justify-between gap-3">
                        <label className="text-sm font-semibold text-slate-800">Base text size</label>
                        <span className="text-xs font-semibold text-slate-500">{thermalSettings.fontSizePx.toFixed(1)}px</span>
                      </div>
                      <input
                        type="range"
                        min={THERMAL_FONT_SIZE_RANGE_PX.min}
                        max={THERMAL_FONT_SIZE_RANGE_PX.max}
                        step="0.5"
                        value={parseFloat(form.thermal_font_size_px) || THERMAL_RECEIPT_DEFAULTS.fontSizePx}
                        onChange={(e) => updateForm("thermal_font_size_px", e.target.value)}
                        className="mt-3 w-full accent-cyan-600"
                      />
                      <input
                        type="number"
                        min={THERMAL_FONT_SIZE_RANGE_PX.min}
                        max={THERMAL_FONT_SIZE_RANGE_PX.max}
                        step="0.5"
                        value={form.thermal_font_size_px}
                        onChange={(e) => updateForm("thermal_font_size_px", e.target.value)}
                        className="mt-3 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-6 rounded-3xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                <h3 className="text-base font-semibold">Printer setup guidance</h3>
                <ul className="mt-3 space-y-2 text-sm leading-6">
                  <li>Configure the printer and driver for 80mm paper, actual size / 100% scale, no browser headers or footers, and no extra margins.</li>
                  <li>A common 203dpi 80mm printer has a 72mm / 576-dot printable area, but the printer manual or self-test remains the authoritative reference.</li>
                  <li>Best logo source: monochrome PNG with strong strokes, no gradients or shadows, around 544px wide at 68mm or 576px at 72mm for a 203dpi printer. Avoid JPEG.</li>
                  <li>Printer heat or density must be changed in the printer utility or driver. Start from the paper manufacturer&apos;s recommended level instead of forcing maximum darkness.</li>
                  <li>Use approved thermal paper and clean the cooled thermal head and platen according to the printer manufacturer when output looks faint or uneven.</li>
                </ul>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-1">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                    Thermal + Reprint Preview
                  </p>
                  <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-700">
                    {THERMAL_PAPER_WIDTH_MM}mm roll / {THERMAL_PRINTABLE_WIDTH_MM}mm printable area
                  </span>
                </div>
                <div className="overflow-x-auto pb-2">
                  <div className="mx-auto" style={{ width: `${THERMAL_PAPER_WIDTH_MM}mm`, minWidth: `${THERMAL_PAPER_WIDTH_MM}mm` }}>
                    <div className="rounded-[28px] border border-slate-300 bg-white p-3 shadow-sm">
                      <div className="grid grid-cols-[4mm_minmax(0,72mm)_4mm] overflow-hidden rounded-[20px] border border-slate-200 bg-white">
                        <div className="border-r border-dashed border-slate-200 bg-slate-50/80" />
                        <div className="bg-white">
                          <iframe
                            title="Thermal receipt preview"
                            srcDoc={thermalPreviewHtml}
                            className="block h-[760px] w-full border-0 bg-white"
                          />
                        </div>
                        <div className="border-l border-dashed border-slate-200 bg-slate-50/80" />
                      </div>
                    </div>
                  </div>
                </div>
                <div className="mt-3 grid gap-2 rounded-2xl border border-slate-200 bg-white p-3 text-xs text-slate-600">
                  <div className="flex items-center justify-between gap-2">
                    <span>Logo preview path</span>
                    <span className="max-w-[240px] truncate text-right font-medium text-slate-800">
                      {getReceiptLogoPath(previewClinic || { logo: form.logo }, undefined, "thermal")}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span>Resolved text weight</span>
                    <span className="font-medium text-slate-800">{thermalSettings.textWeight}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span>Resolved text size</span>
                    <span className="font-medium text-slate-800">{thermalSettings.fontSizePx.toFixed(1)}px</span>
                  </div>
                  <div className="text-[11px] text-slate-500">
                    This is a proportional 80mm preview. Physical print darkness still depends on the printer, driver, paper, and heat/density settings.
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
