import { NextRequest, NextResponse } from "next/server";
import { APP_AUTH_COOKIE_NAME } from "../../../../lib/session-auth";

const MAX_ATTEMPTS = 3;
const LOCKOUT_DURATIONS = [5 * 60, 10 * 60];
const REPORTS_LOGIN_STATE_COOKIE = "reports-login-state";

type AttemptState = {
  attempts: number;
  lockedUntil: number;
  lockCount: number;
};

type ReportsCredential = {
  username: string;
  password: string;
};

function parseState(cookie: string | undefined): AttemptState {
  if (!cookie) return { attempts: 0, lockedUntil: 0, lockCount: 0 };
  try {
    return JSON.parse(Buffer.from(cookie, "base64").toString()) as AttemptState;
  } catch {
    return { attempts: 0, lockedUntil: 0, lockCount: 0 };
  }
}

function encodeState(state: AttemptState): string {
  return Buffer.from(JSON.stringify(state)).toString("base64");
}

function getReportsCredentials(): ReportsCredential[] {
  const credentials: ReportsCredential[] = [];
  const primaryUsername = String(process.env.REPORTS_LOGIN_USERNAME || "").trim();
  const primaryPassword = String(process.env.REPORTS_LOGIN_PASSWORD || "");
  const secondaryUsername = String(process.env.REPORTS_LOGIN_USERNAME_2 || "").trim();
  const secondaryPassword = String(process.env.REPORTS_LOGIN_PASSWORD_2 || "");

  if (primaryUsername && primaryPassword) {
    credentials.push({ username: primaryUsername, password: primaryPassword });
  }
  if (secondaryUsername && secondaryPassword) {
    credentials.push({ username: secondaryUsername, password: secondaryPassword });
  }

  return credentials;
}

async function logAttempt(req: NextRequest, success: boolean) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    return;
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const userAgent = req.headers.get("user-agent") ?? "unknown";
  await fetch(`${supabaseUrl}/rest/v1/login_logs`, {
    method: "POST",
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${supabaseAnonKey}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ ip, user_agent: userAgent, success }),
  });
}

export async function POST(req: NextRequest) {
  const reportsCredentials = getReportsCredentials();
  if (reportsCredentials.length === 0) {
    return NextResponse.json({ error: "Reports login is not configured." }, { status: 500 });
  }

  const body = await req.json().catch(() => null);
  const username = String(body?.username || "").trim();
  const password = String(body?.password || "");
  const raw = req.cookies.get(REPORTS_LOGIN_STATE_COOKIE)?.value;
  const state = parseState(raw);
  const now = Date.now();

  if (state.lockedUntil > now) {
    const remaining = Math.ceil((state.lockedUntil - now) / 1000);
    return NextResponse.json({ error: "locked", remaining }, { status: 429 });
  }

  if (state.lockedUntil > 0 && state.lockedUntil <= now) {
    state.attempts = 0;
    state.lockedUntil = 0;
  }

  const credentialMatch = reportsCredentials.some((credential) => credential.username === username && credential.password === password);

  if (!credentialMatch) {
    await logAttempt(req, false);
    state.attempts += 1;

    if (state.attempts >= MAX_ATTEMPTS) {
      const durationIndex = Math.min(state.lockCount, LOCKOUT_DURATIONS.length - 1);
      state.lockedUntil = now + LOCKOUT_DURATIONS[durationIndex] * 1000;
      state.lockCount += 1;
      state.attempts = 0;
      const response = NextResponse.json({ error: "locked", remaining: LOCKOUT_DURATIONS[durationIndex] }, { status: 429 });
      response.cookies.set(REPORTS_LOGIN_STATE_COOKIE, encodeState(state), { httpOnly: true, sameSite: "lax", path: "/" });
      return response;
    }

    const response = NextResponse.json({ error: "invalid", attemptsLeft: MAX_ATTEMPTS - state.attempts }, { status: 401 });
    response.cookies.set(REPORTS_LOGIN_STATE_COOKIE, encodeState(state), { httpOnly: true, sameSite: "lax", path: "/" });
    return response;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json({ error: "Supabase configuration is missing." }, { status: 500 });
  }

  await logAttempt(req, true);

  const token = crypto.randomUUID();
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const userAgent = req.headers.get("user-agent") ?? "unknown";
  const sessionResponse = await fetch(`${supabaseUrl}/rest/v1/active_sessions`, {
    method: "POST",
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${supabaseAnonKey}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({
      token,
      ip,
      user_agent: userAgent,
      session_mode: "reports",
      clinic_id: null,
      user_role: "reports",
    }),
  });
  if (!sessionResponse.ok) {
    return NextResponse.json({ error: "Failed to start reports session." }, { status: 500 });
  }

  const response = NextResponse.json({ ok: true });
  const thirtyDaysMs = 60 * 60 * 24 * 30 * 1000;
  response.cookies.set(APP_AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30,
    expires: new Date(Date.now() + thirtyDaysMs),
    path: "/",
  });
  response.cookies.set(REPORTS_LOGIN_STATE_COOKIE, "", { maxAge: 0, path: "/" });
  return response;
}
