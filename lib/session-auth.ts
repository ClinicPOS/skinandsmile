import { sessionStorageFetch } from "./session-storage";
import { readNamedAccountAccess, type ManagerPermission } from './account-access';

export const APP_AUTH_COOKIE_NAME = "app-auth";

export type AppSessionMode = "manager" | "clinic" | "reports";

export type ActiveSessionRecord = {
  token: string;
  session_mode?: string | null;
  clinic_id?: string | null;
  user_role?: string | null;
  receptionist_id?: string | null;
  created_at?: string | null;
  account_id?: string | null;
};

export type ActiveSession = {
  token: string;
  sessionMode: AppSessionMode;
  clinicId: string | null;
  userRole: string;
  receptionistId: string | null;
  accountId?: string | null;
  accountName?: string;
  permissions?: ManagerPermission[];
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
    accountId:row.account_id||null,
  };
}

export function validateActiveSession(row: ActiveSessionRecord, now = Date.now()): ActiveSession | null {
  const mode = String(row.session_mode || "").trim().toLowerCase();
  const role = String(row.user_role || "").trim().toLowerCase();
  const createdAt = Date.parse(row.created_at || "");
  const maxAge = 30 * 24 * 60 * 60 * 1000;
  if (!row.token || !Number.isFinite(createdAt) || createdAt > now || now - createdAt >= maxAge) return null;
  if (mode === "clinic") {
    if (!row.clinic_id || role !== "receptionist") return null;
  } else if (mode === "manager") {
    if(role==='owner'||role==='clinic_manager'){
      if(!row.account_id||(role==='owner'?!!row.clinic_id:!row.clinic_id)||now-createdAt>=8*60*60*1000)return null;
    }else if (row.clinic_id || !["ceo", "it_admin"].includes(role)) return null;
  } else if (mode === "reports") {
    if (row.clinic_id || role !== "reports") return null;
  } else return null;
  return toActiveSession(row);
}

export async function fetchActiveSession(token: string): Promise<ActiveSession | null> {
  if (!token) {
    return null;
  }

  const response = await sessionStorageFetch(
    `?token=eq.${encodeURIComponent(token)}&select=token,session_mode,clinic_id,user_role,receptionist_id,created_at,account_id`
  );
  if (!response.ok) {
    return null;
  }

  const sessions = (await response.json()) as ActiveSessionRecord[];
  if (!Array.isArray(sessions) || sessions.length === 0) {
    return null;
  }

  const session=validateActiveSession(sessions[0]);
  if(!session)return null;
  if(process.env.POS_NAMED_ADMIN_ONLY==='true'&&session.sessionMode==='manager'&&!session.accountId)return null;
  if(session.accountId){const account=await readNamedAccountAccess(session.accountId,session.clinicId);if(!account||account.role!==session.userRole)return null;return {...session,accountName:account.name,permissions:account.permissions};}
  return session;
}

export function canAccessReports(session: Pick<ActiveSession, "sessionMode" | "userRole">): boolean {
  return session.sessionMode === "reports" || (
    session.sessionMode === "manager" && ["ceo","it_admin","owner"].includes(session.userRole)
  );
}

export function isReportsOnlySession(session: Pick<ActiveSession, "sessionMode">): boolean {
  return session.sessionMode === "reports";
}
