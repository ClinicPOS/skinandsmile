import "server-only";
import { sessionStorageFetch } from "./session-storage";

export type ManagedSession = { token: string; ip?: string; user_agent?: string; created_at?: string };

export async function sessionManagementId(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function loadManagedSessions(): Promise<ManagedSession[]> {
  const rows: ManagedSession[] = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const response = await sessionStorageFetch(`?select=token,ip,user_agent,created_at&order=created_at.desc,token.asc&limit=${pageSize}&offset=${offset}`);
    if (!response.ok) throw new Error("Session listing failed.");
    const page = await response.json();
    if (!Array.isArray(page)) throw new Error("Invalid session listing.");
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

export async function redactManagedSession(row: ManagedSession) {
  return { id: await sessionManagementId(row.token), ip: row.ip || null, user_agent: row.user_agent || null, created_at: row.created_at || null };
}
