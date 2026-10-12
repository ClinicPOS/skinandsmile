import { NextRequest, NextResponse } from "next/server";
import {
  APP_AUTH_COOKIE_NAME,
  canAccessReports,
  fetchActiveSession,
  isReportsOnlySession,
} from "./lib/session-auth";

const PUBLIC_PAGE_PATHS = new Set(["/login", "/login/staff"]);
const PUBLIC_API_PREFIXES = ["/api/auth/"];
// These routes authenticate the current session and authorize the clinic/role
// themselves before any data access. A second middleware verification adds two
// session-storage round trips for each receptionist request.
const SELF_AUTHENTICATED_API_PATHS = new Set([
  '/api/receipts/checkout', '/api/receipts/history', '/api/patients/search',
  '/api/patients/history', '/api/patients/clinic-records', '/api/workspace/refunds',
]);
const PUBLIC_REPORTS_API_PATHS = new Set([
  "/api/reports/login",
  "/api/reports/logout",
  "/api/reports/session",
]);
const REPORTS_ONLY_ALLOWED_API_PATHS = new Set([
  "/api/reports/ceo-dashboard",
  "/api/reports/logout",
  "/api/reports/session",
]);

function isPublicPath(pathname: string) {
  return PUBLIC_PAGE_PATHS.has(pathname)
    || SELF_AUTHENTICATED_API_PATHS.has(pathname)
    // This route permits only clinic names without login; all other reads verify sessions itself.
    || pathname === '/api/pos-read'
    // This endpoint verifies the current session and clinic itself, once per export.
    || pathname === '/api/workspace/eod-export'
    || pathname.startsWith("/images/")
    || pathname.startsWith("/fonts/")
    || PUBLIC_API_PREFIXES.some((prefix) => pathname.startsWith(prefix))
    || PUBLIC_REPORTS_API_PATHS.has(pathname);
}

function isApiPath(pathname: string) {
  return pathname.startsWith("/api/");
}

function isReportsPage(pathname: string) {
  return pathname === "/reports";
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const token = request.cookies.get(APP_AUTH_COOKIE_NAME)?.value;
  if (!token) {
    if (isReportsPage(pathname)) {
      return NextResponse.next();
    }
    if (isApiPath(pathname)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const session = await fetchActiveSession(token);
  if (!session) {
    if (isReportsPage(pathname)) {
      const response = NextResponse.next();
      response.cookies.delete(APP_AUTH_COOKIE_NAME);
      return response;
    }
    if (isApiPath(pathname)) {
      const response = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      response.cookies.delete(APP_AUTH_COOKIE_NAME);
      return response;
    }
    const response = NextResponse.redirect(new URL("/login", request.url));
    response.cookies.delete(APP_AUTH_COOKIE_NAME);
    return response;
  }

  if(session.userRole==='clinic_manager'){
    if(pathname==='/clinic-admin'||pathname.startsWith('/api/workspace/')||pathname==='/api/reports/ceo-dashboard')return NextResponse.next();
    if(isApiPath(pathname))return NextResponse.json({error:'Forbidden'},{status:403});
    return NextResponse.redirect(new URL('/clinic-admin',request.url));
  }
  if (isReportsOnlySession(session)) {
    if (isReportsPage(pathname)) {
      return NextResponse.next();
    }
    if (isApiPath(pathname)) {
      if (REPORTS_ONLY_ALLOWED_API_PATHS.has(pathname)) {
        return NextResponse.next();
      }
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.redirect(new URL("/reports", request.url));
  }

  if (isReportsPage(pathname) && !canAccessReports(session)) {
    return NextResponse.redirect(new URL("/receipts", request.url));
  }

  if (isApiPath(pathname) && pathname === "/api/reports/ceo-dashboard" && !canAccessReports(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
