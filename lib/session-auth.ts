export const APP_AUTH_COOKIE_NAME = "app-auth";

export type AppSessionMode = "manager" | "clinic" | "reports";

export type ActiveSessionRecord = {
  token: string;
  session_mode?: string | null;
  clinic_id?: string | null;
  user_role?: string | null;
  receptionist_id?: string | null;
};

export type ActiveSession = {
  token: string;
  sessionMode: AppSessionMode;
  clinicId: string | null;
  userRole: string;
  receptionistId: string | null;
};

export function normalizeSessionMode(value: string | null | undefined): AppSessionMode {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "clinic") return "clinic";
  if (normalized === "reports") return "reports";
  return "manager";
}

export function toActiveSession(row: ActiveSessionRecord): ActiveSession {
  return {
    token: row.token,
    sessionMode: normalizeSessionMode(row.session_mode),
    clinicId: row.clinic_id ? String(row.clinic_id) : null,
    userRole: String(row.user_role || "").trim().toLowerCase(),
    receptionistId: row.receptionist_id ? String(row.receptionist_id) : null,
  };
}

export async function fetchActiveSession(token: string): Promise<ActiveSession | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey || !token) {
    return null;
  }

  const response = await fetch(
    `${supabaseUrl}/rest/v1/active_sessions?token=eq.${encodeURIComponent(token)}&select=token,session_mode,clinic_id,user_role,receptionist_id`,
    {
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${supabaseAnonKey}`,
      },
    }
  );
  if (!response.ok) {
    return null;
  }

  const sessions = (await response.json()) as ActiveSessionRecord[];
  if (!Array.isArray(sessions) || sessions.length === 0) {
    return null;
  }

  return toActiveSession(sessions[0]);
}

export function canAccessReports(session: Pick<ActiveSession, "sessionMode" | "userRole">): boolean {
  return session.sessionMode === "reports" || (
    session.sessionMode === "manager" && (session.userRole === "ceo" || session.userRole === "it_admin")
  );
}

export function isReportsOnlySession(session: Pick<ActiveSession, "sessionMode">): boolean {
  return session.sessionMode === "reports";
}
