import { ensureClinicScopeAccess, readAppSession, createServerSupabaseClient } from "../../../lib/api-session";
import { getDubaiBusinessDate } from "../../../lib/cash-deductions";
import { roundCurrency, toMinorUnits } from "../../../lib/money";
import {
  buildCashDeductionSummary,
  computeRegisterSessionCashCollected,
  listCashDeductions,
  loadRegisterSessionContext,
} from "./_shared";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function normalizeAmount(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return roundCurrency(parsed);
}

export async function GET(request: Request) {
  const supabase = createServerSupabaseClient();
  const { session, errorResponse } = await readAppSession(supabase);
  if (errorResponse || !session) return errorResponse!;

  const { searchParams } = new URL(request.url);
  const registerSessionId = String(searchParams.get("registerSessionId") || "").trim();
  if (!registerSessionId) {
    return Response.json({ error: "registerSessionId is required." }, { status: 400 });
  }

  const context = await loadRegisterSessionContext(supabase, registerSessionId);
  if (!context) {
    return Response.json({ error: "Register session not found." }, { status: 404 });
  }

  const clinicScopeError = ensureClinicScopeAccess(session, context.clinicId);
  if (clinicScopeError) return clinicScopeError;

  const [entries, cashCollected] = await Promise.all([
    listCashDeductions(supabase, registerSessionId),
    computeRegisterSessionCashCollected(supabase, context),
  ]);

  return Response.json({
    clinicId: context.clinicId,
    registerSessionId: context.id,
    entries,
    summary: buildCashDeductionSummary(context, entries, cashCollected),
  });
}

export async function POST(request: Request) {
  const supabase = createServerSupabaseClient();
  const { session, errorResponse } = await readAppSession(supabase);
  if (errorResponse || !session) return errorResponse!;

  const body = await request.json().catch(() => null);
  const registerSessionId = String(body?.registerSessionId || "").trim();
  const type = String(body?.type || "").trim().toLowerCase();
  const referenceNumber = String(body?.referenceNumber || "").trim() || null;
  const description = String(body?.description || "").trim();
  const amount = normalizeAmount(body?.amount);
  const staffId = String(body?.staffId || "").trim() || null;
  const paidToNameInput = String(body?.paidToName || "").trim();

  if (!registerSessionId) {
    return Response.json({ error: "registerSessionId is required." }, { status: 400 });
  }
  if (type !== "expense" && type !== "commission") {
    return Response.json({ error: "Type must be expense or commission." }, { status: 400 });
  }
  if (!description) {
    return Response.json({ error: "Description / reason is required." }, { status: 400 });
  }
  if (amount == null || toMinorUnits(amount) <= 0) {
    return Response.json({ error: "Amount must be greater than zero." }, { status: 400 });
  }

  const context = await loadRegisterSessionContext(supabase, registerSessionId);
  if (!context) {
    return Response.json({ error: "Register session not found." }, { status: 404 });
  }
  const clinicScopeError = ensureClinicScopeAccess(session, context.clinicId);
  if (clinicScopeError) return clinicScopeError;
  if (context.closedAt) {
    return Response.json({ error: "Register is already closed. Cash deductions are locked." }, { status: 409 });
  }

  const { data: clinicData, error: clinicError } = await supabase
    .from("clinics")
    .select("enable_expenses, enable_commissions")
    .eq("id", context.clinicId)
    .maybeSingle();
  if (clinicError || !clinicData) {
    return Response.json({ error: "Clinic settings could not be loaded." }, { status: 404 });
  }

  const expensesEnabled = !!clinicData.enable_expenses;
  const commissionsEnabled = !!clinicData.enable_commissions;
  if (type === "expense" && !expensesEnabled) {
    return Response.json({ error: "Expenses are disabled for this clinic." }, { status: 403 });
  }
  if (type === "commission" && !commissionsEnabled) {
    return Response.json({ error: "Commissions are disabled for this clinic." }, { status: 403 });
  }

  let paidToName = paidToNameInput;
  if (type === "commission") {
    if (!staffId) {
      return Response.json({ error: "Select the staff member receiving this commission." }, { status: 400 });
    }
    const { data: staffData, error: staffError } = await supabase
      .from("doctors")
      .select("id, name, clinic_id")
      .eq("id", staffId)
      .maybeSingle();
    if (staffError || !staffData || String(staffData.clinic_id || "") !== context.clinicId) {
      return Response.json({ error: "Selected staff member is invalid for this clinic." }, { status: 400 });
    }
    paidToName = String(staffData.name || "").trim();
    if (!paidToName) {
      return Response.json({ error: "Selected staff member is missing a display name." }, { status: 400 });
    }
  } else if (!paidToName) {
    return Response.json({ error: "Paid To is required for expenses." }, { status: 400 });
  }

  const payload = {
    clinic_id: context.clinicId,
    register_session_id: context.id,
    business_date: getDubaiBusinessDate(new Date()),
    type,
    staff_id: type === "commission" ? staffId : null,
    paid_to_name: type === "expense" ? (paidToName || description) : paidToName,
    description,
    reference_number: referenceNumber,
    amount,
    status: "active",
    created_by: context.receptionistId,
    updated_by: context.receptionistId,
  };

  const { data: insertedRow, error: insertError } = await supabase
    .from("cash_deductions")
    .insert([payload])
    .select("*")
    .single();
  if (insertError || !insertedRow) {
    return Response.json({ error: insertError?.message || "Failed saving cash deduction." }, { status: 500 });
  }

  await supabase.from("cash_deduction_events").insert([{
    deduction_id: insertedRow.id,
    action: "created",
    changed_by: context.receptionistId,
    next_data: insertedRow,
  }]);

  const entries = await listCashDeductions(supabase, registerSessionId);
  const updatedCashCollected = await computeRegisterSessionCashCollected(supabase, context);
  return Response.json({
    entry: entries.find((row) => row.id === insertedRow.id) || insertedRow,
    entries,
    summary: buildCashDeductionSummary(context, entries, updatedCashCollected),
  });
}
