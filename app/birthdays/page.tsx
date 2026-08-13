"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppFrame } from "../../components/app-frame";
import { useClinicAccess } from "../../lib/clinic-access";
import { supabase } from "../../lib/supabase";
import { getDubaiBusinessDate } from "../../lib/cash-deductions";
import { getActiveReceptionistIdFromRegisterSession } from "../../lib/clinic-patient-files";

type BirthdayPatientRow = {
  patient_id: string;
  clinic_patient_file_id: string;
  file_no: string;
  clinic_mrn: string | null;
  full_name: string;
  date_of_birth: string | null;
  sex: string | null;
  nationality: string | null;
  phone: string | null;
  email: string | null;
  greeted: boolean;
  greeted_at: string | null;
  greeted_by_receptionist_id: string | null;
  greeted_by_receptionist_name: string | null;
};

function formatDubaiDateLabel(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map((part) => Number(part));
  const safe = new Date(Date.UTC(year || 0, (month || 1) - 1, day || 1));
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dubai",
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(safe);
}

function calculateAgeOnDate(dob: string | null, dateKey: string): number | null {
  if (!dob) return null;
  const birth = new Date(dob);
  if (Number.isNaN(birth.getTime())) return null;
  const [year, month, day] = dateKey.split("-").map((part) => Number(part));
  if (!year || !month || !day) return null;
  let age = year - birth.getUTCFullYear();
  const birthMonth = birth.getUTCMonth() + 1;
  const birthDay = birth.getUTCDate();
  if (month < birthMonth || (month === birthMonth && day < birthDay)) {
    age -= 1;
  }
  return age >= 0 ? age : null;
}

function formatBirthDate(value: string | null): string {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dubai",
    year: "numeric",
    month: "short",
    day: "2-digit",
  }).format(date);
}

export default function BirthdaysPage() {
  const { accessSession, isLoaded, isManager, allowedClinicId } = useClinicAccess();
  const [rows, setRows] = useState<BirthdayPatientRow[]>([]);
  const [clinicName, setClinicName] = useState("");
  const [loading, setLoading] = useState(false);
  const [markingPatientId, setMarkingPatientId] = useState<string | null>(null);
  const [copiedPatientId, setCopiedPatientId] = useState<string | null>(null);
  const [copiedContact, setCopiedContact] = useState<{ patientId: string; type: "phone" | "email" } | null>(null);
  const dubaiDateKey = useMemo(() => getDubaiBusinessDate(), []);
  const dubaiDateLabel = useMemo(() => formatDubaiDateLabel(dubaiDateKey), [dubaiDateKey]);

  const activeClinicId = allowedClinicId || null;

  const loadBirthdays = useCallback(async () => {
    if (!activeClinicId) {
      setRows([]);
      return;
    }
    setLoading(true);
    try {
      const [{ data, error }, clinicRes] = await Promise.all([
        supabase.rpc("get_clinic_birthday_patients", {
          p_clinic_id: activeClinicId,
          p_target_date: dubaiDateKey,
        }),
        supabase.from("clinics").select("name").eq("id", activeClinicId).maybeSingle(),
      ]);
      if (error) {
        alert(`Could not load birthdays: ${error.message}`);
        return;
      }
      setRows((data || []) as BirthdayPatientRow[]);
      setClinicName(String(clinicRes.data?.name || accessSession?.clinicName || "Clinic"));
    } finally {
      setLoading(false);
    }
  }, [accessSession?.clinicName, activeClinicId, dubaiDateKey]);

  useEffect(() => {
    if (!isLoaded) return;
    void loadBirthdays();
  }, [isLoaded, loadBirthdays]);

  useEffect(() => {
    if (!activeClinicId) return;
    const intervalId = window.setInterval(() => {
      void loadBirthdays();
    }, 30000);
    return () => window.clearInterval(intervalId);
  }, [activeClinicId, loadBirthdays]);

  const totalBirthdays = rows.length;
  const remaining = rows.filter((row) => !row.greeted).length;

  async function markAsGreeted(row: BirthdayPatientRow) {
    if (!activeClinicId || row.greeted) return;
    setMarkingPatientId(row.patient_id);
    try {
      const receptionistId = getActiveReceptionistIdFromRegisterSession();
      const payload = {
        clinic_id: activeClinicId,
        patient_id: row.patient_id,
        birthday_date: dubaiDateKey,
        receptionist_id: receptionistId,
      };

      const { data, error } = await supabase
        .from("birthday_greetings")
        .insert([payload])
        .select("greeted_at, receptionist_id, receptionist(name)")
        .single();

      if (error && error.code !== "23505") {
        alert(`Could not mark greeted: ${error.message}`);
        return;
      }

      const insertedReceptionist = Array.isArray(data?.receptionist) ? data?.receptionist[0] : data?.receptionist;
      let greetedAt = data?.greeted_at || null;
      let greetedByName = insertedReceptionist?.name || null;
      let greetedById = data?.receptionist_id || null;

      if (error?.code === "23505") {
        const existing = await supabase
          .from("birthday_greetings")
          .select("greeted_at, receptionist_id, receptionist(name)")
          .eq("clinic_id", activeClinicId)
          .eq("patient_id", row.patient_id)
          .eq("birthday_date", dubaiDateKey)
          .maybeSingle();
        if (existing.error) {
          alert(`Greeting already exists, but reload failed: ${existing.error.message}`);
          return;
        }
        const existingReceptionist = Array.isArray(existing.data?.receptionist) ? existing.data?.receptionist[0] : existing.data?.receptionist;
        greetedAt = existing.data?.greeted_at || null;
        greetedByName = existingReceptionist?.name || null;
        greetedById = existing.data?.receptionist_id || null;
      }

      setRows((current) =>
        current.map((entry) =>
          entry.patient_id === row.patient_id
            ? {
                ...entry,
                greeted: true,
                greeted_at: greetedAt,
                greeted_by_receptionist_id: greetedById,
                greeted_by_receptionist_name: greetedByName,
              }
            : entry
        )
      );
      window.dispatchEvent(new Event("birthday-greetings-updated"));
    } finally {
      setMarkingPatientId(null);
    }
  }

  async function copyDetails(row: BirthdayPatientRow) {
    const details = [
      `Clinic: ${clinicName || "Clinic"}`,
      `Patient: ${row.full_name || "Unknown"}`,
      `Birthday: ${formatBirthDate(row.date_of_birth)}`,
      `Age: ${calculateAgeOnDate(row.date_of_birth, dubaiDateKey) ?? "Unknown"}`,
      `Sex: ${row.sex || "Unknown"}`,
      `Nationality: ${row.nationality || "Unknown"}`,
      `Phone / WhatsApp: ${row.phone || "No phone"}`,
      `Email: ${row.email || "No email"}`,
      "",
      "Task: Create two birthday greetings for this patient from the clinic: (1) a WhatsApp message and (2) an Email message with a subject line. Make both greetings warm, personal, inviting, and professional. Make the patient feel genuinely remembered and appreciated rather than receiving a generic automated birthday message. Address the patient naturally by their first name. Include sincere birthday wishes and gently invite them to visit the clinic again without sounding pushy or overly promotional. The clinic is giving the birthday celebrant a 5% Birthday Discount for the entire month of their birthday. For example, if the patient's birthday is in August, the 5% Birthday Discount is valid until the end of August. Mention the offer naturally as a special birthday gift from the clinic. Birthday Promo Rules: - The discount is 5% off the celebrant's final bill. - It is valid for the entire birthday month, not only on the birthday. - It applies regardless of how many services the celebrant receives. - It can still be applied even if the services already have discounted or promotional prices. - It is only for the birthday celebrant and cannot be transferred to another person. - Do not invent minimum spend, excluded services, non-stacking rules, or any other restrictions that were not provided. WhatsApp: Keep it short, friendly, conversational, and easy to read. Use a few appropriate emojis. Clearly mention that the 5% Birthday Discount is available throughout their birthday month without making the message too long. Email: Make it slightly more polished and detailed while still warm and personal. Include a suitable birthday email subject line and clearly mention that the 5% Birthday Discount is valid for the whole birthday month. Do not mention medical history or sensitive information. Do not mention the patient's age unless it naturally improves the greeting. Nationality may only be used as a language hint; do not assume language preference solely from nationality. If no language preference is known, use friendly English. Output the WhatsApp message first, followed by the Email subject and Email message.",
    ].join("\n");

    try {
      await navigator.clipboard.writeText(details);
      setCopiedPatientId(row.patient_id);
      window.setTimeout(() => {
        setCopiedPatientId((current) => (current === row.patient_id ? null : current));
      }, 1500);
    } catch {
      alert("Could not copy details. Please try again.");
    }
  }

  async function copyContact(row: BirthdayPatientRow, type: "phone" | "email") {
    const value = type === "phone" ? row.phone : row.email;
    if (!value) return;

    try {
      await navigator.clipboard.writeText(value);
      setCopiedContact({ patientId: row.patient_id, type });
      window.setTimeout(() => {
        setCopiedContact((current) => (current?.patientId === row.patient_id && current?.type === type ? null : current));
      }, 1500);
    } catch {
      alert(`Could not copy ${type === "phone" ? "WhatsApp number" : "email"}. Please try again.`);
    }
  }

  return (
    <AppFrame title="Birthdays" description="Track and greet today’s birthdays by clinic.">
      <div className="space-y-4">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <h1 className="text-xl font-semibold text-slate-900">Birthdays Today</h1>
          <p className="mt-1 text-sm text-slate-600">{dubaiDateLabel} (Dubai)</p>
          <p className="mt-2 text-sm font-medium text-slate-700">
            {totalBirthdays} birthdays · {remaining} remaining
          </p>
        </div>

        {isManager && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            Manager navigation is unchanged. Switch to clinic access mode to use birthday greeting tracking.
          </div>
        )}

        {!isManager && rows.length === 0 && !loading && (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
            No birthdays today for this clinic.
          </div>
        )}

        <div className="space-y-3">
          {rows.map((row) => {
            const age = calculateAgeOnDate(row.date_of_birth, dubaiDateKey);
            return (
              <div key={`${row.clinic_patient_file_id}-${row.patient_id}`} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <p className="text-base font-semibold text-slate-900">{row.full_name || "Unknown"}</p>
                    <p className="text-sm text-slate-600">
                      Birthday: {formatBirthDate(row.date_of_birth)} · Age today: {age ?? "Unknown"}
                    </p>
                    <p className="text-sm text-slate-600">
                      Sex: {row.sex || "Unknown"} · File No: {row.file_no || "—"} · MRN: {row.clinic_mrn || "—"}
                    </p>
                    <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
                      <span>Phone / WhatsApp: {row.phone || "No phone"}</span>
                      {row.phone && (
                        <button
                          type="button"
                          onClick={() => copyContact(row, "phone")}
                          className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
                        >
                          {copiedContact?.patientId === row.patient_id && copiedContact.type === "phone" ? "Copied ✓" : "Copy WhatsApp"}
                        </button>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
                      <span>Email: {row.email || "No email"}</span>
                      {row.email && (
                        <button
                          type="button"
                          onClick={() => copyContact(row, "email")}
                          className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
                        >
                          {copiedContact?.patientId === row.patient_id && copiedContact.type === "email" ? "Copied ✓" : "Copy Email"}
                        </button>
                      )}
                    </div>
                    {row.greeted ? (
                      <p className="text-sm font-semibold text-emerald-700">
                        ✓ Greeted
                        {row.greeted_at ? ` at ${new Date(row.greeted_at).toLocaleTimeString("en-GB", { timeZone: "Asia/Dubai", hour: "2-digit", minute: "2-digit" })}` : ""}
                        {row.greeted_by_receptionist_name ? ` by ${row.greeted_by_receptionist_name}` : ""}
                      </p>
                    ) : (
                      <p className="text-sm font-semibold text-amber-700">Not Greeted</p>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => copyDetails(row)}
                      className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      {copiedPatientId === row.patient_id ? "Copied" : "Copy Details"}
                    </button>
                    <button
                      type="button"
                      onClick={() => markAsGreeted(row)}
                      disabled={row.greeted || markingPatientId === row.patient_id}
                      className="rounded-xl bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {row.greeted ? "✓ Greeted" : markingPatientId === row.patient_id ? "Saving..." : "Mark as Greeted"}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </AppFrame>
  );
}
