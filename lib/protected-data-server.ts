import "server-only";
import { createClient } from "@supabase/supabase-js";

// Use only AFTER verifying session, role, clinic and entity membership.
export function createProtectedDataClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVER_SECRET_KEY;
  if (!url || !key) throw new Error("Protected server data access is not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}
