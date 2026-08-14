import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "../../../../lib/api-session";
import { APP_AUTH_COOKIE_NAME } from "../../../../lib/session-auth";

export async function POST() {
  const cookieStore = await cookies();
  const token = cookieStore.get(APP_AUTH_COOKIE_NAME)?.value || "";
  if (token) {
    const supabase = createServerSupabaseClient();
    await supabase.from("active_sessions").delete().eq("token", token);
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(APP_AUTH_COOKIE_NAME, "", { maxAge: 0, path: "/" });
  response.cookies.set("reports-login-state", "", { maxAge: 0, path: "/" });
  return response;
}
