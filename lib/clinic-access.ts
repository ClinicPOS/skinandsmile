"use client";

import { useEffect, useState } from "react";

export const CLINIC_ACCESS_SESSION_KEY = "appClinicAccess";

export type ClinicAccessSession = {
  mode: "clinic" | "manager";
  clinicId: string | null;
  clinicName: string | null;
};

export function readClinicAccessSession(): ClinicAccessSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(CLINIC_ACCESS_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const mode = parsed?.mode === "manager" ? "manager" : "clinic";
    const clinicId = mode === "clinic" ? String(parsed?.clinicId || "").trim() || null : null;
    return {
      mode,
      clinicId,
      clinicName: String(parsed?.clinicName || "").trim() || null,
    };
  } catch {
    return null;
  }
}

export function writeClinicAccessSession(session: ClinicAccessSession) {
  if (typeof window === "undefined") return;
  localStorage.setItem(CLINIC_ACCESS_SESSION_KEY, JSON.stringify(session));
}

export function clearClinicAccessSession() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(CLINIC_ACCESS_SESSION_KEY);
}

export function clinicAccessAllowsClinic(
  session: ClinicAccessSession | null,
  clinicId: string | null | undefined
): boolean {
  if (!session || session.mode === "manager") return true;
  return !!clinicId && session.clinicId === clinicId;
}

export function filterClinicsForAccess<T extends { id: string }>(
  clinics: T[],
  session: ClinicAccessSession | null
): T[] {
  if (!session || session.mode === "manager") return clinics;
  return clinics.filter((clinic) => clinic.id === session.clinicId);
}

export function getClinicAccessLabel(session: ClinicAccessSession | null): string {
  if (!session) return "Clinic Access";
  if (session.mode === "manager") return "Manager • All Clinics";
  return session.clinicName || "Clinic Access";
}

export function useClinicAccess() {
  const [accessSession, setAccessSession] = useState<ClinicAccessSession | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    setAccessSession(readClinicAccessSession());
    setIsLoaded(true);
  }, []);

  return {
    accessSession,
    isLoaded,
    isManager: accessSession?.mode === "manager",
    allowedClinicId: accessSession?.mode === "clinic" ? accessSession.clinicId : null,
  };
}
