import { cookies } from "next/headers";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  APP_AUTH_COOKIE_NAME,
  type ActiveSession,
  type ActiveSessionRecord,
  normalizeSessionMode,
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
  supabase: SupabaseClient
): Promise<{ session: AppSession | null; errorResponse?: Response }> {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(APP_AUTH_COOKIE_NAME)?.value || "";
  if (!sessionToken) {
    return {
      session: null,
      errorResponse: Response.json({ error: "Unauthorized." }, { status: 401 }),
    };
  }

  const { data, error } = await supabase
    .from("active_sessions")
    .select("token, session_mode, clinic_id, user_role, receptionist_id")
    .eq("token", sessionToken)
    .maybeSingle();

  if (error || !data) {
    return {
      session: null,
      errorResponse: Response.json({ error: "Unauthorized session." }, { status: 401 }),
    };
  }

  const row = data as AppSessionRecord;
  return {
    session: {
      token: row.token,
      sessionMode: normalizeSessionMode(row.session_mode),
      clinicId: row.clinic_id ? String(row.clinic_id) : null,
      userRole: String(row.user_role || "").toLowerCase(),
      receptionistId: row.receptionist_id ? String(row.receptionist_id) : null,
    },
  };
}

export function ensureClinicScopeAccess(session: AppSession, clinicId: string): Response | null {
  if (session.sessionMode === "clinic" && session.clinicId !== clinicId) {
    return Response.json({ error: "Forbidden for this clinic." }, { status: 403 });
  }
  return null;
}

export function ensureManagerSession(session: AppSession): Response | null {
  if (session.sessionMode !== "manager") {
    return Response.json({ error: "Forbidden." }, { status: 403 });
  }
  const allowedRoles = new Set(["it_admin", "ceo"]);
  if (!allowedRoles.has(session.userRole)) {
    return Response.json({ error: "Forbidden." }, { status: 403 });
  }
  return null;
}
