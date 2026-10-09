import { cookies } from "next/headers";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  APP_AUTH_COOKIE_NAME,
  type ActiveSession,
  type ActiveSessionRecord,
  fetchActiveSession,
} from "./session-auth";

export type AppSessionRecord = ActiveSessionRecord;
export type AppSession = ActiveSession;

export function createServerSupabaseClient(): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Supabase configuration is missing.");
  }
  return createClient(supabaseUrl, supabaseAnonKey);
}

export async function readAppSession(
  _supabase: SupabaseClient
): Promise<{ session: AppSession | null; errorResponse?: Response }> {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(APP_AUTH_COOKIE_NAME)?.value || "";
  if (!sessionToken) {
    return {
      session: null,
      errorResponse: Response.json({ error: "Unauthorized." }, { status: 401 }),
    };
  }

  let validatedSession: AppSession | null;
  try {
    validatedSession = await fetchActiveSession(sessionToken);
  } catch {
    return {
      session: null,
      errorResponse: Response.json({ error: "Session verification is unavailable. Please try again." }, { status: 503 }),
    };
  }
  if (!validatedSession) {
    return { session: null, errorResponse: Response.json({ error: "Session expired or invalid. Please sign in again." }, { status: 401 }) };
  }
  return {
    session: validatedSession,
  };
}

export function ensureClinicScopeAccess(session: AppSession, clinicId: string): Response | null {
  if ((session.sessionMode === "clinic"||session.userRole==='clinic_manager') && session.clinicId !== clinicId) {
    return Response.json({ error: "Forbidden for this clinic." }, { status: 403 });
  }
  return null;
}

export function ensureManagerSession(session: AppSession): Response | null {
  if (session.sessionMode !== "manager") {
    return Response.json({ error: "Forbidden." }, { status: 403 });
  }
  const allowedRoles = new Set(["it_admin", "ceo", "owner"]);
  if (!allowedRoles.has(session.userRole)) {
    return Response.json({ error: "Forbidden." }, { status: 403 });
  }
  return null;
}
