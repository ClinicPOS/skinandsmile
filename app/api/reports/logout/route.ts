import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { sessionStorageFetch } from "../../../../lib/session-storage";
import { APP_AUTH_COOKIE_NAME } from "../../../../lib/session-auth";

export async function POST() {
  const cookieStore = await cookies();
  const token = cookieStore.get(APP_AUTH_COOKIE_NAME)?.value || "";
  if (token) {
    const result = await sessionStorageFetch(`?token=eq.${encodeURIComponent(token)}`, { method: "DELETE" });
    if (!result.ok) return NextResponse.json({ error: "Could not revoke the session. Please try again." }, { status: 503 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(APP_AUTH_COOKIE_NAME, "", { maxAge: 0, path: "/" });
  response.cookies.set("reports-login-state", "", { maxAge: 0, path: "/" });
  return response;
}
