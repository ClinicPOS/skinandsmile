import { createServerSupabaseClient, readAppSession, ensureManagerSession } from "../../../../lib/api-session";
import { createProtectedDataClient } from "../../../../lib/protected-data-server";
import { fetchAllPages, type FetchPageResult } from "../../../../lib/paginated-fetch";
import { isUuid } from "../../../../lib/patient-mutation-validation";
import { rollupBalance } from "../../../../lib/outstanding-balances";
import type { BalancePayment, OutstandingBalance, PatientCredit } from "../../../../lib/types";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { session, errorResponse } = await readAppSession(createServerSupabaseClient());
  if (errorResponse || !session) return errorResponse!;
  const params = new URL(request.url).searchParams;
  const clinicId = params.get("clinicId") || (session.sessionMode === "clinic" ? session.clinicId : "");
  if (!isUuid(clinicId)) return Response.json({ error: "A valid clinic is required." }, { status: 400 });
  if (session.sessionMode === "clinic" ? session.clinicId !== clinicId : !!ensureManagerSession(session)) {
    return Response.json({ error: "Forbidden for this clinic." }, { status: 403 });
  }

  const patientId = params.get("patientId");
  const patientIdsParam = params.get("patientIds");
  if (patientId && patientIdsParam) return Response.json({ error: "Choose one patient lookup." }, { status: 400 });
  const patientIds = patientId ? [patientId] : patientIdsParam === null ? [] : [...new Set(patientIdsParam.split(",").filter(Boolean))];
  if (patientIds.length > 200 || patientIds.some(id => !isUuid(id))) {
    return Response.json({ error: "Invalid patient IDs." }, { status: 400 });
  }
  if (!patientIds.length) return Response.json({ error: "A patient is required." }, { status: 400 });

  try {
    const client = createProtectedDataClient();
    const loadPages = <T,>(fetchPage: (from: number, to: number) => PromiseLike<FetchPageResult<T>>) => fetchAllPages<T>(fetchPage, 500);
    let balancesQuery = client.from("outstanding_balances").select("*")
      .in("patient_id", patientIds).order("id", { ascending: true });
    if (session.sessionMode === "clinic") balancesQuery = balancesQuery.eq("clinic_id", clinicId);
    const balances = await loadPages<OutstandingBalance>((from, to) => balancesQuery.range(from, to));
    const balanceIds = balances.map(balance => balance.id);
    const paymentGroups = await Promise.all(Array.from({ length: Math.ceil(balanceIds.length / 200) }, async (_, index) => {
      const ids = balanceIds.slice(index * 200, index * 200 + 200);
      const query = client.from("balance_payments").select("*")
        .in("outstanding_balance_id", ids).neq("status", "cancelled").order("id", { ascending: true });
      return loadPages<BalancePayment>((from, to) => query.range(from, to));
    }));
    const balancePayments = paymentGroups.flat();

    if (patientId) {
      const patientCreditsQuery = client.from("patient_credits").select("*")
        .eq("clinic_id", clinicId).eq("patient_id", patientId).neq("status", "cancelled").order("id", { ascending: true });
      let patientCredits: PatientCredit[] = [];
      try {
        patientCredits = await loadPages<PatientCredit>((from, to) => patientCreditsQuery.range(from, to));
      } catch (error) {
        if (!(["42P01", "PGRST205"].includes((error as { code?: string })?.code || ""))) throw error;
      }
      return Response.json({ balances, balancePayments, patientCredits }, { headers: { "Cache-Control": "no-store" } });
    }

    const paymentsByBalanceId = new Map<string, BalancePayment[]>();
    for (const payment of balancePayments) {
      const payments = paymentsByBalanceId.get(payment.outstanding_balance_id) || [];
      payments.push(payment);
      paymentsByBalanceId.set(payment.outstanding_balance_id, payments);
    }
    const outstandingByPatient: Record<string, { remaining: number; count: number }> = {};
    for (const balance of balances) {
      const remaining = rollupBalance(balance, paymentsByBalanceId.get(balance.id) || []).remaining;
      if (remaining <= 0.0049) continue;
      const summary = outstandingByPatient[balance.patient_id] || { remaining: 0, count: 0 };
      summary.remaining += remaining;
      summary.count += 1;
      outstandingByPatient[balance.patient_id] = summary;
    }
    for (const summary of Object.values(outstandingByPatient)) summary.remaining = Math.round(summary.remaining * 100) / 100;
    return Response.json({ outstandingByPatient }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    // A failed later page must fail the request so a partial ledger is never presented as complete.
    return Response.json({ error: "Patient financial records could not be loaded completely. Please try again." }, { status: 503 });
  }
}
