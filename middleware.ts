import { NextRequest, NextResponse } from "next/server";

async function validateSessionToken(token: string | undefined) {
  if (!token) {
    return false;
  }

  const res = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/active_sessions?token=eq.${token}&select=token`,
    {
      headers: {
        apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
      },
    }
  );

  const sessions = await res.json();
  return Array.isArray(sessions) && sessions.length > 0;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    pathname === "/login" ||
    pathname.startsWith("/api/auth/") ||
    pathname.startsWith("/images/") ||
    pathname.startsWith("/fonts/")
  ) {
    return NextResponse.next();
  }

  const token = request.cookies.get("app-auth")?.value;

  if (pathname.startsWith("/api/")) {
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const isValidSession = await validateSessionToken(token);
    if (!isValidSession) {
      const response = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      response.cookies.delete("app-auth");
      return response;
    }

    return NextResponse.next();
  }

  if (!token) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const isValidSession = await validateSessionToken(token);
  if (!isValidSession) {
    const response = NextResponse.redirect(new URL("/login", request.url));
    response.cookies.delete("app-auth");
    return response;
  }

  return NextResponse.next();

  const res = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/active_sessions?token=eq.${token}&select=token`,
    {
      headers: {
        apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!}`,
      },
    }
  );

  const sessions = await res.json();
  if (!Array.isArray(sessions) || sessions.length === 0) {
    const response = NextResponse.redirect(new URL("/login", request.url));
    response.cookies.delete("app-auth");
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
