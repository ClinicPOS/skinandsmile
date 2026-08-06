"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import {
  A4_INVOICE_LOGO_BUCKET,
  buildA4InvoiceLogoStoragePath,
  getA4InvoiceLogoSettings,
  getA4InvoiceTheme,
} from "../../../lib/a4-invoice-branding";
import { generateInvoiceHtml } from "../../../lib/generate-invoice-html";
import { supabase } from "../../../lib/supabase";
import type { Clinic } from "../../../lib/types";

const BACKEND_SELECTED_CLINIC_KEY = "backendSelectedClinicId";

export const dynamic = "force-dynamic";

type A4InvoiceBrandingForm = {
  a4_invoice_logo_url: string;
  a4_invoice_logo_width_mm: string;
  a4_invoice_logo_height_mm: string;
  a4_invoice_logo_alignment: "left" | "center" | "right";
  a4_invoice_logo_offset_x_mm: string;
  a4_invoice_logo_offset_y_mm: string;
  a4_invoice_primary_color: string;
  a4_invoice_secondary_color: string;
  a4_invoice_accent_color: string;
  a4_invoice_text_color: string;
  a4_invoice_divider_color: string;
  a4_invoice_slogan: string;
};

function createA4FormFromClinic(clinic: Clinic | null): A4InvoiceBrandingForm {
  return {
    a4_invoice_logo_url: clinic?.a4_invoice_logo_url || "",
    a4_invoice_logo_width_mm: clinic?.a4_invoice_logo_width_mm != null ? String(clinic.a4_invoice_logo_width_mm) : "",
    a4_invoice_logo_height_mm: clinic?.a4_invoice_logo_height_mm != null ? String(clinic.a4_invoice_logo_height_mm) : "",
    a4_invoice_logo_alignment: clinic?.a4_invoice_logo_alignment === "center" || clinic?.a4_invoice_logo_alignment === "right"
      ? clinic.a4_invoice_logo_alignment
      : "left",
    a4_invoice_logo_offset_x_mm: clinic?.a4_invoice_logo_offset_x_mm != null ? String(clinic.a4_invoice_logo_offset_x_mm) : "",
    a4_invoice_logo_offset_y_mm: clinic?.a4_invoice_logo_offset_y_mm != null ? String(clinic.a4_invoice_logo_offset_y_mm) : "",
    a4_invoice_primary_color: clinic?.a4_invoice_primary_color || "",
    a4_invoice_secondary_color: clinic?.a4_invoice_secondary_color || "",
    a4_invoice_accent_color: clinic?.a4_invoice_accent_color || "",
    a4_invoice_text_color: clinic?.a4_invoice_text_color || "",
    a4_invoice_divider_color: clinic?.a4_invoice_divider_color || "",
    a4_invoice_slogan: clinic?.a4_invoice_slogan || "",
  };
}

function parseNullableNumber(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeColor(value: string) {
  const trimmed = value.trim();
  return /^#[0-9a-f]{6}$/i.test(trimmed) ? trimmed : null;
}

export default function A4InvoiceDesignPage() {
  return (
    <Suspense fallback={<div className="min-h-[240px]" />}>
      <A4InvoiceDesignPageContent />
    </Suspense>
  );
}

function A4InvoiceDesignPageContent() {
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [clinics, setClinics] = useState<Clinic[]>([]);
  const [selectedClinicId, setSelectedClinicId] = useState("");
  const [form, setForm] = useState<A4InvoiceBrandingForm>(() => createA4FormFromClinic(null));

  const selectedClinic = useMemo(
    () => clinics.find((clinic) => clinic.id === selectedClinicId) || null,
    [clinics, selectedClinicId]
  );

  const previewClinic = useMemo(() => {
    if (!selectedClinic) return null;
    return {
      ...selectedClinic,
      a4_invoice_logo_url: form.a4_invoice_logo_url.trim() || null,
      a4_invoice_logo_width_mm: parseNullableNumber(form.a4_invoice_logo_width_mm),
      a4_invoice_logo_height_mm: parseNullableNumber(form.a4_invoice_logo_height_mm),
      a4_invoice_logo_alignment: form.a4_invoice_logo_alignment,
      a4_invoice_logo_offset_x_mm: parseNullableNumber(form.a4_invoice_logo_offset_x_mm),
      a4_invoice_logo_offset_y_mm: parseNullableNumber(form.a4_invoice_logo_offset_y_mm),
      a4_invoice_primary_color: normalizeColor(form.a4_invoice_primary_color),
      a4_invoice_secondary_color: normalizeColor(form.a4_invoice_secondary_color),
      a4_invoice_accent_color: normalizeColor(form.a4_invoice_accent_color),
      a4_invoice_text_color: normalizeColor(form.a4_invoice_text_color),
      a4_invoice_divider_color: normalizeColor(form.a4_invoice_divider_color),
      a4_invoice_slogan: form.a4_invoice_slogan.trim() || null,
    } satisfies Clinic;
  }, [form, selectedClinic]);

  const previewTheme = useMemo(() => getA4InvoiceTheme(previewClinic), [previewClinic]);
  const previewLogo = useMemo(() => getA4InvoiceLogoSettings(previewClinic), [previewClinic]);
  const previewHtml = useMemo(() => {
    if (!previewClinic) return "";
    return generateInvoiceHtml({
      clinic: previewClinic,
      receiptNumber: "#00001",
      invoiceStatus: "PAID",
      issuedAt: new Date("2026-08-06T08:00:00.000Z"),
      posReceiptNumber: "#00001",
      cashierName: "Reception",
      patient: {
        name: "Sample Patient",
        phone: "050 000 0000",
        fileNumber: "12345",
        email: "sample@clinic.test",
      },
      doctorName: "Dr. Sample",
      items: [
        {
          description: "Consultation",
          quantity: 1,
          unitPrice: 350,
        },
        {
          description: "Scaling and Polishing",
          quantity: 1,
          unitPrice: 450,
        },
      ],
      totalDiscount: 50,
      vatAmount: 0,
      grandTotal: 750,
      amountPaid: 750,
      outstandingBalance: 0,
      notes: "Preview only. Thermal receipt branding is unaffected by this page.",
      previewPaperMode: true,
    });
  }, [previewClinic]);

  function selectClinic(nextClinicId: string, availableClinics: Clinic[] = clinics) {
    const nextClinic = availableClinics.find((clinic) => clinic.id === nextClinicId) || null;
    setSelectedClinicId(nextClinicId);
    setForm(createA4FormFromClinic(nextClinic));
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
      setForm(createA4FormFromClinic(initialClinic));
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

  function updateForm<Key extends keyof A4InvoiceBrandingForm>(key: Key, value: A4InvoiceBrandingForm[Key]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function uploadA4Logo(file: File) {
    if (!selectedClinicId) {
      alert("Please select a clinic first.");
      return;
    }

    setIsUploadingLogo(true);
    const uploadPath = buildA4InvoiceLogoStoragePath(selectedClinicId, file.name);
    const { error: uploadError } = await supabase.storage.from(A4_INVOICE_LOGO_BUCKET).upload(uploadPath, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type || undefined,
    });
    setIsUploadingLogo(false);

    if (uploadError) {
      alert(`Error uploading A4 logo: ${uploadError.message}`);
      return;
    }

    const { data } = supabase.storage.from(A4_INVOICE_LOGO_BUCKET).getPublicUrl(uploadPath);
    updateForm("a4_invoice_logo_url", data.publicUrl || "");
  }

  async function saveA4InvoiceSettings() {
    if (!selectedClinicId) {
      alert("Please select a clinic first.");
      return;
    }

    const payload = {
      a4_invoice_logo_url: form.a4_invoice_logo_url.trim() || null,
      a4_invoice_logo_width_mm: parseNullableNumber(form.a4_invoice_logo_width_mm),
      a4_invoice_logo_height_mm: parseNullableNumber(form.a4_invoice_logo_height_mm),
      a4_invoice_logo_alignment: form.a4_invoice_logo_alignment || null,
      a4_invoice_logo_offset_x_mm: parseNullableNumber(form.a4_invoice_logo_offset_x_mm),
      a4_invoice_logo_offset_y_mm: parseNullableNumber(form.a4_invoice_logo_offset_y_mm),
      a4_invoice_primary_color: normalizeColor(form.a4_invoice_primary_color),
      a4_invoice_secondary_color: normalizeColor(form.a4_invoice_secondary_color),
      a4_invoice_accent_color: normalizeColor(form.a4_invoice_accent_color),
      a4_invoice_text_color: normalizeColor(form.a4_invoice_text_color),
      a4_invoice_divider_color: normalizeColor(form.a4_invoice_divider_color),
      a4_invoice_slogan: form.a4_invoice_slogan.trim() || null,
    };

    setIsSaving(true);
    const { error } = await supabase.from("clinics").update(payload).eq("id", selectedClinicId);
    setIsSaving(false);

    if (error) {
      alert(`Error updating A4 invoice settings: ${error.message || error.code || "Unknown error"}`);
      return;
    }

    setClinics((current) =>
      current.map((clinic) => (clinic.id === selectedClinicId ? { ...clinic, ...payload } : clinic))
    );
    alert("A4 invoice design settings updated.");
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
        <button
          onClick={saveA4InvoiceSettings}
          disabled={isSaving || !selectedClinicId}
          className="ml-auto inline-flex items-center justify-center rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSaving ? "Saving..." : "Save A4 Invoice Design"}
        </button>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-5">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">A4-only branding controls</h2>
            <p className="mt-1 text-sm text-slate-500">
              This page saves only <code>a4_invoice_*</code> fields. Thermal receipt and reprint branding stay on the shared receipt settings.
            </p>
          </div>
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800">
            <div className="font-semibold">Isolation check</div>
            <div className="mt-1">Saving here never updates <code>logo</code>, <code>receipt_print_name</code>, or any thermal/shared receipt field.</div>
          </div>
        </div>

        {isLoading ? (
          <p className="text-sm text-slate-500">Loading clinics…</p>
        ) : !selectedClinic ? (
          <p className="text-sm text-slate-500">No clinic found.</p>
        ) : (
          <div className="grid gap-6 xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
            <div className="space-y-5">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <h3 className="text-sm font-semibold text-slate-900">A4 logo</h3>
                <p className="mt-1 text-xs text-slate-500">
                  Uploads go to a dedicated A4 storage path and save only <code>a4_invoice_logo_url</code>.
                </p>
                <div className="mt-3 space-y-3">
                  <input
                    value={form.a4_invoice_logo_url}
                    onChange={(e) => updateForm("a4_invoice_logo_url", e.target.value)}
                    placeholder="A4 invoice logo URL"
                    className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
                  />
                  <label className="flex cursor-pointer items-center justify-center rounded-2xl border border-dashed border-cyan-300 bg-cyan-50 px-4 py-3 text-sm font-semibold text-cyan-700 transition hover:bg-cyan-100">
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          void uploadA4Logo(file);
                        }
                        e.currentTarget.value = "";
                      }}
                    />
                    {isUploadingLogo ? "Uploading A4 logo..." : "Upload A4 Logo"}
                  </label>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <input
                      value={form.a4_invoice_logo_width_mm}
                      onChange={(e) => updateForm("a4_invoice_logo_width_mm", e.target.value)}
                      placeholder={`Width mm (default ${previewLogo.widthMm})`}
                      className="rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
                    />
                    <input
                      value={form.a4_invoice_logo_height_mm}
                      onChange={(e) => updateForm("a4_invoice_logo_height_mm", e.target.value)}
                      placeholder={`Height mm (default ${previewLogo.heightMm})`}
                      className="rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
                    />
                    <select
                      value={form.a4_invoice_logo_alignment}
                      onChange={(e) => updateForm("a4_invoice_logo_alignment", e.target.value as A4InvoiceBrandingForm["a4_invoice_logo_alignment"])}
                      className="rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
                    >
                      <option value="left">Left</option>
                      <option value="center">Center</option>
                      <option value="right">Right</option>
                    </select>
                    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-500">
                      Alignment controls how the logo sits relative to the clinic header block.
                    </div>
                    <input
                      value={form.a4_invoice_logo_offset_x_mm}
                      onChange={(e) => updateForm("a4_invoice_logo_offset_x_mm", e.target.value)}
                      placeholder="Horizontal offset mm"
                      className="rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
                    />
                    <input
                      value={form.a4_invoice_logo_offset_y_mm}
                      onChange={(e) => updateForm("a4_invoice_logo_offset_y_mm", e.target.value)}
                      placeholder="Vertical offset mm"
                      className="rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
                    />
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <h3 className="text-sm font-semibold text-slate-900">A4 colors + slogan</h3>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {[
                    ["a4_invoice_primary_color", "Primary color", previewTheme.primaryColor],
                    ["a4_invoice_secondary_color", "Secondary color", previewTheme.secondaryColor],
                    ["a4_invoice_accent_color", "Accent color", previewTheme.accentColor],
                    ["a4_invoice_text_color", "Text color", previewTheme.textColor],
                    ["a4_invoice_divider_color", "Divider color", previewTheme.dividerColor],
                  ].map(([key, label, fallback]) => {
                    const typedKey = key as keyof A4InvoiceBrandingForm;
                    const value = form[typedKey] || fallback;
                    return (
                      <label key={key} className="rounded-2xl border border-slate-200 bg-white p-3 text-sm text-slate-700">
                        <span className="mb-2 block font-medium">{label}</span>
                        <input
                          type="color"
                          value={value}
                          onChange={(e) => updateForm(typedKey, e.target.value)}
                          className="h-10 w-full rounded-lg border border-slate-200 bg-white"
                        />
                      </label>
                    );
                  })}
                </div>
                <textarea
                  value={form.a4_invoice_slogan}
                  onChange={(e) => updateForm("a4_invoice_slogan", e.target.value)}
                  placeholder="A4 invoice slogan"
                  rows={2}
                  className="mt-3 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
                />
              </div>

              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-800">
                <div className="font-semibold">Shared clinic text used as fallback</div>
                <div className="mt-2 space-y-1">
                  <div>Printed clinic name: <span className="font-medium">{selectedClinic.receipt_print_name || selectedClinic.name}</span></div>
                  <div>Receipt title: <span className="font-medium">{selectedClinic.receipt_title || "TAX INVOICE"}</span></div>
                  <div>Address/TRN/phones continue coming from the shared clinic fields until you request separate A4 text fields.</div>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <p className="mb-2 text-center text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                Live A4 Invoice Preview
              </p>
              <p className="mb-3 text-center text-xs text-slate-500">
                Previewed inside an A4 paper frame so it matches the printed page layout more closely.
              </p>
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-200">
                <iframe
                  title="A4 invoice preview"
                  srcDoc={previewHtml}
                  className="h-[1180px] w-full bg-white"
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
