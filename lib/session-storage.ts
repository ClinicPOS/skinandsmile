import "server-only";
import { serverApiKeyHeaders } from './server-api-key-headers';

// Dedicated to session storage; never return this credential to a browser.
export function sessionStorageConfiguration() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SESSION_SECRET_KEY;
  if (!url || !key) throw new Error("Server session storage is not configured.");
  return { url, headers: serverApiKeyHeaders(key) };
}

export async function sessionStorageFetch(query: string, init: RequestInit = {}) {
  const { url, headers } = sessionStorageConfiguration();
  return fetch(`${url}/rest/v1/active_sessions${query}`, {
    ...init,
    headers: { ...headers, "Content-Type": "application/json", Prefer: "return=minimal" },
    cache: "no-store",
  });
}
