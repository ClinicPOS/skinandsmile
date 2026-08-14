import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { APP_AUTH_COOKIE_NAME, canAccessReports, fetchActiveSession } from "../../../../lib/session-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get(APP_AUTH_COOKIE_NAME)?.value || "";
  if (!token) {
    return NextResponse.json({ authenticated: false });
  }

  const session = await fetchActiveSession(token);
  if (!session) {
    const response = NextResponse.json({ authenticated: false });
    response.cookies.set(APP_AUTH_COOKIE_NAME, "", { maxAge: 0, path: "/" });
    return response;
  }

  if (!canAccessReports(session)) {
    return NextResponse.json({ authenticated: false });
  }

  return NextResponse.json({
    authenticated: true,
    sessionMode: session.sessionMode,
    accessLabel: session.sessionMode === "reports" ? "Reports Access • All Clinics" : "Manager • All Clinics",
  });
}
