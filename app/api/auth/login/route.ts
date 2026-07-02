import { NextRequest, NextResponse } from "next/server";

const MAX_ATTEMPTS = 3;
const LOCKOUT_DURATIONS = [5 * 60, 10 * 60];

interface AttemptState {
  attempts: number;
  lockedUntil: number;
  lockCount: number;
}

function parseState(cookie: string | undefined): AttemptState {
  if (!cookie) return { attempts: 0, lockedUntil: 0, lockCount: 0 };
  try {
    return JSON.parse(Buffer.from(cookie, "base64").toString());
  } catch {
    return { attempts: 0, lockedUntil: 0, lockCount: 0 };
  }
}

function encodeState(state: AttemptState): string {
  return Buffer.from(JSON.stringify(state)).toString("base64");
}

async function logAttempt(req: NextRequest, success: boolean) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const userAgent = req.headers.get("user-agent") ?? "unknown";
  await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/login_logs`,
    {
      method: "POST",
      headers: {
        apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ ip, user_agent: userAgent, success }),
    }
  );
}

export async function POST(req: NextRequest) {
  const { password } = await req.json();
  const raw = req.cookies.get("login-state")?.value;
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

  if (!password || password !== process.env.APP_PASSWORD) {
    await logAttempt(req, false);
    state.attempts += 1;

    if (state.attempts >= MAX_ATTEMPTS) {
      const durationIndex = Math.min(state.lockCount, LOCKOUT_DURATIONS.length - 1);
      state.lockedUntil = now + LOCKOUT_DURATIONS[durationIndex] * 1000;
      state.lockCount += 1;
      state.attempts = 0;
      const res = NextResponse.json({ error: "locked", remaining: LOCKOUT_DURATIONS[durationIndex] }, { status: 429 });
      res.cookies.set("login-state", encodeState(state), { httpOnly: true, sameSite: "lax", path: "/" });
      return res;
    }

    const res = NextResponse.json({ error: "invalid", attemptsLeft: MAX_ATTEMPTS - state.attempts }, { status: 401 });
    res.cookies.set("login-state", encodeState(state), { httpOnly: true, sameSite: "lax", path: "/" });
    return res;
  }

  await logAttempt(req, true);

  const token = crypto.randomUUID();
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const userAgent = req.headers.get("user-agent") ?? "unknown";

  await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/active_sessions`, {
    method: "POST",
    headers: {
      apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ token, ip, user_agent: userAgent }),
  });

  const response = NextResponse.json({ ok: true });
  response.cookies.set("app-auth", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  });
  response.cookies.set("login-state", "", { maxAge: 0, path: "/" });
  return response;
}
