import { ensureClinicScopeAccess, readAppSession, createServerSupabaseClient } from "../../../../lib/api-session";
import { roundCurrency, toMinorUnits } from "../../../../lib/money";
import {
  buildCashDeductionSummary,
  computeRegisterSessionCashCollected,
  listCashDeductions,
  loadRegisterSessionContext,
} from "../_shared";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function normalizeAmount(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return roundCurrency(parsed);
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ deductionId: string }> }
) {
  const supabase = createServerSupabaseClient();
  const { session, errorResponse } = await readAppSession(supabase);
  if (errorResponse || !session) return errorResponse!;

  const { deductionId } = await context.params;
  if (!deductionId) {
    return Response.json({ error: "deductionId is required." }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const operation = String(body?.operation || "update").trim().toLowerCase();

  const { data: existingRow, error: existingError } = await supabase
    .from("cash_deductions")
    .select("*")
    .eq("id", deductionId)
    .maybeSingle();
  if (existingError || !existingRow) {
    return Response.json({ error: "Cash deduction not found." }, { status: 404 });
  }

  const registerContext = await loadRegisterSessionContext(supabase, String(existingRow.register_session_id));
  if (!registerContext) {
    return Response.json({ error: "Register session not found." }, { status: 404 });
  }
  const clinicScopeError = ensureClinicScopeAccess(session, registerContext.clinicId);
  if (clinicScopeError) return clinicScopeError;
  if (registerContext.closedAt) {
    return Response.json({ error: "Register is already closed. Cash deductions are locked." }, { status: 409 });
  }

  if (operation === "void") {
    if (existingRow.status === "voided") {
      return Response.json({ error: "This cash deduction is already voided." }, { status: 409 });
    }
    const voidReason = String(body?.voidReason || "").trim();
    if (!voidReason) {
      return Response.json({ error: "A void reason is required." }, { status: 400 });
    }

    const updatePayload = {
      status: "voided",
      void_reason: voidReason,
      voided_at: new Date().toISOString(),
      voided_by: registerContext.receptionistId,
      updated_at: new Date().toISOString(),
      updated_by: registerContext.receptionistId,
    };

    const { error: updateError } = await supabase
      .from("cash_deductions")
      .update(updatePayload)
      .eq("id", deductionId);
    if (updateError) {
      return Response.json({ error: updateError.message || "Failed voiding cash deduction." }, { status: 500 });
    }

    await supabase.from("cash_deduction_events").insert([{
      deduction_id: deductionId,
      action: "voided",
      changed_by: registerContext.receptionistId,
      reason: voidReason,
      previous_data: existingRow,
      next_data: { ...existingRow, ...updatePayload },
    }]);

    const entries = await listCashDeductions(supabase, registerContext.id);
    const cashCollected = await computeRegisterSessionCashCollected(supabase, registerContext);
    return Response.json({
      entry: entries.find((row) => row.id === deductionId) || null,
      entries,
      summary: buildCashDeductionSummary(registerContext, entries, cashCollected),
    });
  }

  if (existingRow.status === "voided") {
    return Response.json({ error: "Voided entries cannot be edited." }, { status: 409 });
  }

  const nextType = String(body?.type || existingRow.type).trim().toLowerCase();
  const description = String(body?.description || "").trim();
  const referenceNumber = String(body?.referenceNumber || "").trim() || null;
  const amount = normalizeAmount(body?.amount);
  const staffId = String(body?.staffId || "").trim() || null;
  const paidToNameInput = String(body?.paidToName || "").trim();

  if (nextType !== "expense" && nextType !== "commission") {
    return Response.json({ error: "Type must be expense or commission." }, { status: 400 });
  }
  if (!description) {
    return Response.json({ error: "Description / reason is required." }, { status: 400 });
  }
  if (amount == null || toMinorUnits(amount) <= 0) {
    return Response.json({ error: "Amount must be greater than zero." }, { status: 400 });
  }

  const { data: clinicData, error: clinicError } = await supabase
    .from("clinics")
    .select("enable_expenses, enable_commissions")
    .eq("id", registerContext.clinicId)
    .maybeSingle();
  if (clinicError || !clinicData) {
    return Response.json({ error: "Clinic settings could not be loaded." }, { status: 404 });
  }
  if (nextType === "expense" && !clinicData.enable_expenses && existingRow.type !== "expense") {
    return Response.json({ error: "Expenses are disabled for this clinic." }, { status: 403 });
  }
  if (nextType === "commission" && !clinicData.enable_commissions && existingRow.type !== "commission") {
    return Response.json({ error: "Commissions are disabled for this clinic." }, { status: 403 });
  }

  let paidToName = paidToNameInput;
  if (nextType === "commission") {
    if (!staffId) {
      return Response.json({ error: "Select the staff member receiving this commission." }, { status: 400 });
    }
    const { data: staffData, error: staffError } = await supabase
      .from("doctors")
      .select("id, name, clinic_id")
      .eq("id", staffId)
      .maybeSingle();
    if (staffError || !staffData || String(staffData.clinic_id || "") !== registerContext.clinicId) {
      return Response.json({ error: "Selected staff member is invalid for this clinic." }, { status: 400 });
    }
    paidToName = String(staffData.name || "").trim();
  } else if (!paidToName) {
    return Response.json({ error: "Paid To is required for expenses." }, { status: 400 });
  }

  const entriesBefore = await listCashDeductions(supabase, registerContext.id);
  const cashCollected = await computeRegisterSessionCashCollected(supabase, registerContext);
  const activeOtherDeductions = roundCurrency(entriesBefore
    .filter((row) => row.status === "active" && row.id !== deductionId)
    .reduce((sum, row) => sum + Number(row.amount || 0), 0));
  const availableForThisUpdate = roundCurrency(Math.max(0, cashCollected - activeOtherDeductions));
  if (amount - availableForThisUpdate > 0.0049) {
    return Response.json({
      error: `Insufficient cash collected during this shift. Available cash for deductions: AED ${availableForThisUpdate.toFixed(2)}.`,
      availableCash: availableForThisUpdate,
    }, { status: 409 });
  }

  const updatePayload = {
    type: nextType,
    staff_id: nextType === "commission" ? staffId : null,
    paid_to_name: paidToName,
    description,
    reference_number: referenceNumber,
    amount,
    updated_at: new Date().toISOString(),
    updated_by: registerContext.receptionistId,
  };

  const { error: updateError } = await supabase
    .from("cash_deductions")
    .update(updatePayload)
    .eq("id", deductionId);
  if (updateError) {
    return Response.json({ error: updateError.message || "Failed updating cash deduction." }, { status: 500 });
  }

  await supabase.from("cash_deduction_events").insert([{
    deduction_id: deductionId,
    action: "updated",
    changed_by: registerContext.receptionistId,
    previous_data: existingRow,
    next_data: { ...existingRow, ...updatePayload },
  }]);

  const entries = await listCashDeductions(supabase, registerContext.id);
  const updatedCashCollected = await computeRegisterSessionCashCollected(supabase, registerContext);
  return Response.json({
    entry: entries.find((row) => row.id === deductionId) || null,
    entries,
    summary: buildCashDeductionSummary(registerContext, entries, updatedCashCollected),
  });
}
