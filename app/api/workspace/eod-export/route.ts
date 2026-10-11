import { createServerSupabaseClient, readAppSession, ensureClinicScopeAccess } from "../../../../lib/api-session";
import { isUuid } from "../../../../lib/patient-mutation-validation";
import { createEodDataClient } from "../../../../lib/eod-data-client";
import { readEodStatus } from "../../../../lib/read-eod-status";
import { readReportPatientDetails } from "../../../../lib/read-report-patient-details";
import { readReportPatientHistory } from "../../../../lib/read-report-patient-history";
import { buildEodWorkbook } from "../../../../lib/eod-workbook";
import { gzipSync } from "node:zlib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const started = performance.now();
  const { session, errorResponse } = await readAppSession(createServerSupabaseClient());
  if (!session) return errorResponse!;
  const authorizationMs = Math.round(performance.now() - started);
  const body = await request.json().catch(() => null);
  if (!isUuid(body?.clinicId)) return Response.json({ error: "A valid clinic is required." }, { status: 400 });
  const scope = ensureClinicScopeAccess(session, body.clinicId);
  if (scope) return scope;
  if (!["owner", "receptionist"].includes(session.userRole) && !(session.userRole === "clinic_manager" && session.permissions?.includes("reports"))) {
    return Response.json({ error: "EOD access is not assigned." }, { status: 403 });
  }
  // The client can select a business date, but cannot supply account/role,
  // clinic names, query expressions, or an alternate database destination.
  const now = body.day === undefined ? new Date() : new Date(`${body.day}T08:00:00Z`);
  if (body.day !== undefined && (typeof body.day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.day) || !Number.isFinite(now.getTime()) || now.toISOString().slice(0, 10) !== body.day)) {
    return Response.json({ error: "A valid report date is required." }, { status: 400 });
  }
  try {
    const db = createEodDataClient();
    const clinic = await db.from("clinics").select("id,name").eq("id", body.clinicId).maybeSingle();
    if (clinic.error || !clinic.data) throw new Error("Clinic details could not be loaded. EOD was not exported.");
    const localRead = async (input: string, init?: RequestInit) => {
      const internal = new Request(new URL(input, "http://eod.internal"), init);
      switch (new URL(internal.url).pathname) {
        case "/api/workspace/eod": return readEodStatus(session, internal, db);
        case "/api/patients/report-details": return readReportPatientDetails(session, internal, db);
        case "/api/patients/history": return readReportPatientHistory(session, internal, db);
        default: throw new Error("Unsupported report dependency.");
      }
    };
    const history = async (clinicId: string, patientIds: string[]) => {
      const patients = [];
      const ids = [...new Set(patientIds)];
      for (let offset = 0; offset < ids.length; offset += 200) {
        const response = await localRead(`/api/patients/history?${new URLSearchParams({ clinicId, patientIds: ids.slice(offset, offset + 200).join(",") })}`);
        const data = await response.json();
        if (!response.ok) throw new Error("Patient history details could not be loaded. EOD was not exported.");
        patients.push(...data.patients);
      }
      return patients;
    };
    const report = await buildEodWorkbook({ supabase: db, activeClinic: clinic.data, fetch: localRead, loadClinicHistoryPatients: history, now });
    const timings = { authorizationMs, ...report.timings, totalServerMs: Math.round(performance.now() - started) };
    const encodingStarted = performance.now();
    const compressed = gzipSync(JSON.stringify({ ...report, timings }));
    const encodingMs = Math.round(performance.now() - encodingStarted);
    // Excel styles repeat heavily; compression reduces transfer size without
    // removing any cells. Browsers decompress this response automatically.
    return new Response(new Uint8Array(compressed), {
      headers: {
        "Content-Type": "application/json; charset=utf-8", "Content-Encoding": "gzip",
        "Cache-Control": "private, no-store",
        "Server-Timing": `auth;dur=${authorizationMs},data;dur=${report.timings.dataAndCalculationMs},workbook;dur=${report.timings.workbookMs},encoding;dur=${encodingMs}`,
      },
    });
  } catch {
    return Response.json({ error: "Required report data could not be loaded. EOD was not exported. Please retry." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
