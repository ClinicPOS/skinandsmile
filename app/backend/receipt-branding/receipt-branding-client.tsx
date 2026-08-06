"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { getReceiptLogoPath, receiptLogoOptions } from "../../../lib/receipt-branding";
import { supabase } from "../../../lib/supabase";
import type { Clinic } from "../../../lib/types";

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
};

function sanitizeClinicPrintName(value: string) {
  return value.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s{2,}/g, " ").trim();
}

function createFormFromClinic(clinic: Clinic | null): ReceiptBrandingForm {
  const isSkinAndSmileReceipt = !clinic || clinic.logo !== "altamuze";

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
  const searchParams = useSearchParams();
  const requestedClinicId = searchParams.get("clinicId") || "";
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

  useEffect(() => {
    if (!requestedClinicId) return;
    if (!clinics.some((clinic) => clinic.id === requestedClinicId)) return;
    if (selectedClinicId === requestedClinicId) return;
    selectClinic(requestedClinicId);
  }, [clinics, requestedClinicId, selectedClinicId]);

  function updateForm<Key extends keyof ReceiptBrandingForm>(key: Key, value: ReceiptBrandingForm[Key]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function saveReceiptPrintSettings() {
    if (!selectedClinicId) {
      alert("Please select a clinic first.");
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
            </div>

            <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-1">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                <p className="mb-2 text-center text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                  Thermal + Reprint Preview
                </p>
                <div className="bg-white px-2 py-3 text-[9px] leading-tight text-slate-950 shadow-sm">
                  <div className="mb-2 flex justify-center">
                    <img src={getReceiptLogoPath({ logo: form.logo }, undefined, "thermal")} alt="Receipt logo preview" className="max-h-24 max-w-[210px] object-contain" />
                  </div>
                  <div className="mb-1 text-center text-[11px] font-bold">{form.receipt_title || "TAX INVOICE"}</div>
                  <div className="text-center text-[12px] font-bold leading-tight">{receiptPrintNameValue}</div>
                  <div className="mt-1 text-center text-[8px] leading-snug">
                    {(form.address || "Clinic address").split(/\n/).map((line, index) => <div key={`${line}-${index}`}>{line}</div>)}
                    {form.room ? <div>{form.room}</div> : null}
                    {form.trn ? <div className="font-bold">TRN: {form.trn}</div> : null}
                  </div>
                  <div className="my-2 border-t border-dashed border-black" />
                  <div className="space-y-1 text-[8px]">
                    <div className="flex justify-between gap-2"><span>Phone</span><span>{form.phone || "-"}</span></div>
                    <div className="flex justify-between gap-2"><span>WhatsApp</span><span>{form.whatsapp || "-"}</span></div>
                    <div className="flex justify-between gap-2"><span>QR</span><span className="truncate">{form.receipt_qr_url || "Auto"}</span></div>
                  </div>
                  <div className="my-2 border-t border-dashed border-black" />
                  <div className="text-center text-[8px]">{form.receipt_vat_note || "VAT note"}</div>
                  <div className="mt-1 text-center text-[8px]">{form.receipt_thank_you || "Thank-you line"}</div>
                  {form.instagram || form.facebook || form.tiktok ? (
                    <div className="mt-2 text-center text-[8px]">
                      <div className="font-semibold">Follow us</div>
                      {form.instagram ? <div>Instagram: {form.instagram}</div> : null}
                      {form.facebook ? <div>Facebook: {form.facebook}</div> : null}
                      {form.tiktok ? <div>TikTok: {form.tiktok}</div> : null}
                    </div>
                  ) : null}
                  <div className="my-2 border-t border-dashed border-black" />
                  <div className="text-center text-[9px] font-bold">{form.receipt_final_message || "Final message"}</div>
                  <div className="mt-2 text-center text-[7px] uppercase tracking-[0.18em] text-slate-500">
                    Reprint uses the same thermal branding with a reprint label.
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
