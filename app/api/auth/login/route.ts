import { recordLoginAttempt } from "../../../../lib/login-log";
import {consumeLoginAttempt,clearLoginAttempts,loginAttemptKey} from '../../../../lib/login-attempt-limits';
import {isUuid} from '../../../../lib/patient-mutation-validation';
import { sessionStorageFetch } from "../../../../lib/session-storage";
import { NextRequest, NextResponse } from "next/server";

const MAX_ATTEMPTS = 3;
const LOCKOUT_DURATIONS = [5 * 60, 10 * 60];
const ACCEPTED_PASSWORDS = Array.from(
  new Set([process.env.APP_PASSWORD].filter(Boolean))
);

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
  await recordLoginAttempt(req, success);
}

export async function POST(req: NextRequest) {
  const body=await req.json().catch(()=>null),password=body?.password,selectedScope=body?.selectedScope;
  if(selectedScope==='manager')return NextResponse.json({error:'Use Owner & Manager Login with your individual account.'},{status:403});
  if(typeof password!=='string'||password.length>256||!isUuid(selectedScope))return NextResponse.json({error:'Choose your clinic and enter the password.'},{status:400});
  if(!ACCEPTED_PASSWORDS.length)return NextResponse.json({error:'Receptionist login is not configured. Contact the owner.'},{status:503});
  const attemptKey=loginAttemptKey('clinic-password',req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()||'local');
  try{const attempt=await consumeLoginAttempt(attemptKey,10);if(!attempt.allowed)return NextResponse.json({error:'locked',remaining:attempt.remaining},{status:429});}catch{return NextResponse.json({error:'Login verification is unavailable. Try again.'},{status:503});}
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

  if (!password || !ACCEPTED_PASSWORDS.includes(password)) {
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
  const sessionMode = selectedScope === "manager" ? "manager" : "clinic";
  const clinicId = sessionMode === "clinic" ? String(selectedScope || "").trim() : null;

  const sessionPayload = {
    token,
    ip,
    user_agent: userAgent,
    session_mode: sessionMode,
    clinic_id: clinicId,
    user_role: sessionMode === "manager" ? "it_admin" : "receptionist",
  };

  const sessionRes = await sessionStorageFetch("", { method: "POST", body: JSON.stringify(sessionPayload) });
  if (!sessionRes.ok) {
    return NextResponse.json({ error: "Could not start a secure session. Please sign in again." }, { status: 503 });
  }

  try{await clearLoginAttempts(attemptKey);}catch{await sessionStorageFetch(`?token=eq.${token}`,{method:'DELETE'});return NextResponse.json({error:'Login could not be confirmed. Try again.'},{status:503});}
  const response = NextResponse.json({ ok: true });
  const thirtyDaysMs = 60 * 60 * 24 * 30 * 1000;
  response.cookies.set("app-auth", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30,
    expires: new Date(Date.now() + thirtyDaysMs),
    path: "/",
  });
  response.cookies.set("login-state", "", { maxAge: 0, path: "/" });
  return response;
}
