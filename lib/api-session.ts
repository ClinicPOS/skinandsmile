import { cookies } from "next/headers";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type AppSessionRecord = {
  token: string;
  session_mode?: string | null;
  clinic_id?: string | null;
  user_role?: string | null;
  receptionist_id?: string | null;
};

export type AppSession = {
  token: string;
  sessionMode: "manager" | "clinic";
  clinicId: string | null;
  userRole: string;
  receptionistId: string | null;
};

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
  const sessionToken = cookieStore.get("app-auth")?.value || "";
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
      sessionMode: String(row.session_mode || "").toLowerCase() === "clinic" ? "clinic" : "manager",
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
