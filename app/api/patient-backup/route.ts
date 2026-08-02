import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DUBAI_TZ = "Asia/Dubai";
const PAGE_SIZE = 1000;
const IN_CHUNK = 200;

type SessionRow = {
  token: string;
  session_mode?: string | null;
  clinic_id?: string | null;
  user_role?: string | null;
  receptionist_id?: string | null;
  user_id?: string | null;
};

type ClinicRow = {
  id: string;
  name: string;
  code?: string | null;
  logo?: string | null;
};

type ClinicPatientFileRow = {
  id: string;
  clinic_id: string;
  patient_id: string;
  file_no: string;
  mrn?: string | null;
  clinical_notes?: string | null;
  legacy_source?: Record<string, unknown> | null;
  is_active?: boolean | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type PatientRow = {
  id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  date_of_birth?: string | null;
  sex?: string | null;
  nationality?: string | null;
  emirates_id?: string | null;
  passport_number?: string | null;
  notes?: string | null;
  created_at?: string | null;
};

type ImportedVisitRow = {
  id: string;
  patient_file_id: string;
  visit_sequence: number;
  visit_date: string | null;
  treatment_description: string | null;
  original_dentist_name: string | null;
  doctor_id: string | null;
  import_batch_id: string | null;
  source_row_number: number | null;
  source_visit_key: string | null;
  created_at: string;
};

type ReceiptRow = {
  id: string;
  receipt_number?: number | null;
  patient_file_id?: string | null;
  patient_id?: string | null;
  doctor_id?: string | null;
  receptionist_id?: string | null;
  treatment_plan_id?: string | null;
  notes?: string | null;
  created_at: string;
};

type ReceiptItemRow = {
  id: string;
  receipt_id: string;
  service_id: string | null;
  teeth?: string[] | null;
  quantity?: number | null;
};

type ServiceRow = {
  id: string;
  name: string | null;
  display_name?: string | null;
};

type DoctorRow = { id: string; name: string | null };
type ReceptionistRow = { id: string; name: string | null; clinic_id?: string | null };

type PlanRow = {
  id: string;
  patient_file_id?: string | null;
  planned_visits?: number | null;
  status?: string | null;
  service_id?: string | null;
  title?: string | null;
};

type PlanVisitRow = {
  id: string;
  treatment_plan_id: string;
  visit_number?: number | null;
  visit_date?: string | null;
  doctor_id?: string | null;
  receptionist_id?: string | null;
  notes?: string | null;
  receipt_id?: string | null;
  teeth?: string[] | null;
};

type PatientNoteRow = {
  id: string;
  patient_file_id?: string | null;
  note: string;
  created_at: string;
};

type ExportAction = "preview" | "download";

function chunk<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

function sanitizeFilenamePart(value: string): string {
  return value
    .trim()
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

function startsWithFormulaOperator(value: string): boolean {
  return /^[=+\-@]/.test(value);
}

function safeText(value: unknown): string {
  const text = String(value ?? "");
  if (!text) return "";
  return startsWithFormulaOperator(text) ? `'${text}` : text;
}

function formatDubaiDateTime(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: DUBAI_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function toDubaiFilenameTime(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: DUBAI_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const y = parts.find((x) => x.type === "year")?.value || "0000";
  const m = parts.find((x) => x.type === "month")?.value || "00";
  const d = parts.find((x) => x.type === "day")?.value || "00";
  const hh = parts.find((x) => x.type === "hour")?.value || "00";
  const mm = parts.find((x) => x.type === "minute")?.value || "00";
  return `${y}-${m}-${d}_${hh}${mm}`;
}

function toExcelDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function calculateAgeAt(dob: string | null | undefined, atDate: Date): number | null {
  const dobDate = toExcelDate(dob);
  if (!dobDate) return null;
  let age = atDate.getFullYear() - dobDate.getFullYear();
  const monthDiff = atDate.getMonth() - dobDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && atDate.getDate() < dobDate.getDate())) age -= 1;
  return age >= 0 ? age : null;
}

function formatTeeth(teeth: string[] | null | undefined): string {
  const clean = (teeth || []).map((t) => String(t || "").trim()).filter(Boolean);
  if (clean.length === 0) return "";
  return clean.map((t) => `#${t.replace(/^#+/, "")}`).join(", ");
}

async function fetchAllRows<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message?: string } | null }>
): Promise<T[]> {
  const out: T[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await fetchPage(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message || "Query failed.");
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return out;
}

async function countExact(
  queryFactory: () => PromiseLike<{ count: number | null; error: { message?: string } | null }>
): Promise<number> {
  const { count, error } = await queryFactory();
  if (error) throw new Error(error.message || "Count query failed.");
  return Number(count || 0);
}

function styleHeaderRow(ws: ExcelJS.Worksheet, rowNo: number, colCount: number) {
  for (let c = 1; c <= colCount; c++) {
    const cell = ws.getRow(rowNo).getCell(c);
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, name: "Calibri", size: 11 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F766E" } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = {
      top: { style: "thin", color: { argb: "FFE2E8F0" } },
      left: { style: "thin", color: { argb: "FFE2E8F0" } },
      bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
      right: { style: "thin", color: { argb: "FFE2E8F0" } },
    };
  }
}

function styleBodyTable(ws: ExcelJS.Worksheet, fromRow: number, toRow: number, colCount: number) {
  for (let r = fromRow; r <= toRow; r++) {
    for (let c = 1; c <= colCount; c++) {
      const cell = ws.getRow(r).getCell(c);
      cell.font = { name: "Calibri", size: 10, color: { argb: "FF0F172A" } };
      cell.alignment = { vertical: "top", horizontal: "left", wrapText: false };
      cell.border = {
        top: { style: "thin", color: { argb: "FFE2E8F0" } },
        left: { style: "thin", color: { argb: "FFE2E8F0" } },
        bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
        right: { style: "thin", color: { argb: "FFE2E8F0" } },
      };
      if (r % 2 === 0) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
      }
    }
  }
}

export async function POST(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json({ error: "Supabase configuration is missing." }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey);

  const body = await req.json().catch(() => null);
  const action = String(body?.action || "preview") as ExportAction;
  const clinicId = String(body?.clinicId || "").trim();
  const receptionistId = String(body?.receptionistId || "").trim();
  if (!clinicId || (action !== "preview" && action !== "download")) {
    return NextResponse.json({ error: "Invalid export request." }, { status: 400 });
  }

  const cookieStore = await cookies();
  const sessionToken = cookieStore.get("app-auth")?.value || "";
  if (!sessionToken) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { data: sessionData, error: sessionError } = await supabase
    .from("active_sessions")
    .select("*")
    .eq("token", sessionToken)
    .maybeSingle();

  if (sessionError || !sessionData) {
    return NextResponse.json({ error: "Unauthorized session." }, { status: 401 });
  }

  const session = sessionData as SessionRow;
  const sessionMode = String(session.session_mode || "").toLowerCase() || "manager";
  const scopedClinicId = String(session.clinic_id || "");
  if (sessionMode === "clinic" && scopedClinicId && scopedClinicId !== clinicId) {
    return NextResponse.json({ error: "You are not allowed to export this clinic." }, { status: 403 });
  }

  const { data: clinicData, error: clinicError } = await supabase
    .from("clinics")
    .select("*")
    .eq("id", clinicId)
    .maybeSingle();
  if (clinicError || !clinicData) {
    return NextResponse.json({ error: "Clinic not found." }, { status: 404 });
  }
  const clinic = clinicData as ClinicRow;

  if (receptionistId) {
    const { data: receptionistData, error: receptionistError } = await supabase
      .from("receptionist")
      .select("id, clinic_id")
      .eq("id", receptionistId)
      .maybeSingle();
    if (receptionistError || !receptionistData || String(receptionistData.clinic_id || "") !== clinicId) {
      return NextResponse.json({ error: "Unauthorized clinic staff scope." }, { status: 403 });
    }
  } else if (sessionMode === "clinic") {
    return NextResponse.json({ error: "Receptionist context is required for clinic-scoped sessions." }, { status: 403 });
  }

  if (session.user_id) {
    const membershipRes = await supabase
      .from("clinic_memberships")
      .select("role")
      .eq("user_id", session.user_id)
      .eq("clinic_id", clinicId)
      .maybeSingle();
    if (!membershipRes.error && !membershipRes.data) {
      return NextResponse.json({ error: "You are not assigned to this clinic." }, { status: 403 });
    }
  }

  const exportAt = new Date();
  const filename = `${sanitizeFilenamePart(clinic.name || "Clinic")}_Patient_Backup_${toDubaiFilenameTime(exportAt)}.xlsx`;
  let exportId = "";
  let auditStarted = false;

  try {
    if (action === "download") {
      exportId = crypto.randomUUID();
      const { error: auditStartError } = await supabase.from("patient_backup_exports").insert([
        {
          export_id: exportId,
          clinic_id: clinicId,
          session_token: sessionToken,
          user_id: session.user_id || null,
          receptionist_id: receptionistId || null,
          exported_at: exportAt.toISOString(),
          filename,
          patient_count: 0,
          treatment_record_count: 0,
          export_status: "started",
        },
      ]);
      if (auditStartError) {
        return NextResponse.json({ error: "Could not initialize export audit record." }, { status: 500 });
      }
      auditStarted = true;
    }

    const expectedPatientCount = await countExact(() =>
      supabase
        .from("clinic_patient_files")
        .select("id", { count: "exact", head: true })
        .eq("clinic_id", clinicId)
    );

    const clinicFiles = await fetchAllRows<ClinicPatientFileRow>((from, to) =>
      supabase
        .from("clinic_patient_files")
        .select("id, clinic_id, patient_id, file_no, mrn, clinical_notes, legacy_source, is_active, created_at, updated_at")
        .eq("clinic_id", clinicId)
        .order("file_no", { ascending: true })
        .range(from, to)
    );

    if (clinicFiles.length !== expectedPatientCount) {
      throw new Error("Patient backup is incomplete. Please try again.");
    }

    const patientFileIds = clinicFiles.map((row) => row.id);
    const clinicFileById = new Map(clinicFiles.map((row) => [row.id, row]));
    const clinicFileIdSet = new Set(patientFileIds);
    const patientIds = [...new Set(clinicFiles.map((row) => row.patient_id))];

    const patientRows: PatientRow[] = [];
    for (const ids of chunk(patientIds, IN_CHUNK)) {
      const { data, error } = await supabase
        .from("patients")
        .select("id, name, phone, email, date_of_birth, sex, nationality, emirates_id, passport_number, notes, created_at")
        .in("id", ids);
      if (error) throw new Error(error.message || "Failed loading patients.");
      patientRows.push(...((data || []) as PatientRow[]));
    }
    const patientById = new Map(patientRows.map((row) => [row.id, row]));

    const noteRows = await fetchAllRows<PatientNoteRow>((from, to) =>
      supabase
        .from("patient_notes")
        .select("id, patient_file_id, note, created_at")
        .eq("clinic_id", clinicId)
        .order("created_at", { ascending: false })
        .range(from, to)
    );
    const latestNoteByFile = new Map<string, string>();
    for (const note of noteRows) {
      const key = String(note.patient_file_id || "");
      if (!key || latestNoteByFile.has(key)) continue;
      latestNoteByFile.set(key, note.note || "");
    }

    const importedVisits = await fetchAllRows<ImportedVisitRow>((from, to) =>
      supabase
        .from("patient_treatment_visits")
        .select("id, patient_file_id, visit_sequence, visit_date, treatment_description, original_dentist_name, doctor_id, import_batch_id, source_row_number, source_visit_key, created_at")
        .eq("clinic_id", clinicId)
        .order("created_at", { ascending: true })
        .range(from, to)
    );

    const receiptRows: ReceiptRow[] = [];
    for (const ids of chunk(patientFileIds, IN_CHUNK)) {
      const rows = await fetchAllRows<ReceiptRow>((from, to) =>
        supabase
          .from("receipts")
          .select("id, receipt_number, patient_file_id, patient_id, doctor_id, receptionist_id, treatment_plan_id, notes, created_at")
          .in("patient_file_id", ids)
          .order("created_at", { ascending: true })
          .range(from, to)
      );
      receiptRows.push(...rows);
    }
    const receiptIds = receiptRows.map((r) => r.id);
    const receiptById = new Map(receiptRows.map((r) => [r.id, r]));

    const receiptItems: ReceiptItemRow[] = [];
    for (const ids of chunk(receiptIds, IN_CHUNK)) {
      const rows = await fetchAllRows<ReceiptItemRow>((from, to) =>
        supabase
          .from("receipt_items")
          .select("id, receipt_id, service_id, teeth, quantity")
          .in("receipt_id", ids)
          .order("id", { ascending: true })
          .range(from, to)
      );
      receiptItems.push(...rows);
    }

    const planRows = await fetchAllRows<PlanRow>((from, to) =>
      supabase
        .from("treatment_plans")
        .select("id, patient_file_id, planned_visits, status, service_id, title")
        .eq("clinic_id", clinicId)
        .order("created_at", { ascending: true })
        .range(from, to)
    );
    const planById = new Map(planRows.map((p) => [p.id, p]));
    const planIds = planRows.map((p) => p.id);

    const planVisits: PlanVisitRow[] = [];
    for (const ids of chunk(planIds, IN_CHUNK)) {
      const rows = await fetchAllRows<PlanVisitRow>((from, to) =>
        supabase
          .from("treatment_plan_visits")
          .select("id, treatment_plan_id, visit_number, visit_date, doctor_id, receptionist_id, notes, receipt_id, teeth")
          .in("treatment_plan_id", ids)
          .is("receipt_id", null)
          .order("created_at", { ascending: true })
          .range(from, to)
      );
      planVisits.push(...rows);
    }

    const exportableImportedVisits = importedVisits.filter((row) => clinicFileIdSet.has(row.patient_file_id));
    const exportableReceiptItems = receiptItems.filter((item) => {
      const receipt = receiptById.get(item.receipt_id);
      if (!receipt) return false;
      return clinicFileIdSet.has(String(receipt.patient_file_id || ""));
    });
    const exportablePlanVisits = planVisits.filter((visit) => {
      const plan = planById.get(visit.treatment_plan_id);
      if (!plan) return false;
      return clinicFileIdSet.has(String(plan.patient_file_id || ""));
    });

    const expectedTreatmentRecords =
      exportableImportedVisits.length + exportableReceiptItems.length + exportablePlanVisits.length;

    if (action === "preview") {
      return NextResponse.json({
        clinicName: clinic.name,
        filename,
        patientCount: expectedPatientCount,
        treatmentRecordCount: expectedTreatmentRecords,
      });
    }

    const serviceIds = [...new Set(receiptItems.map((row) => String(row.service_id || "")).filter(Boolean))];
    const doctorIds = [...new Set([
      ...receiptRows.map((r) => String(r.doctor_id || "")).filter(Boolean),
      ...importedVisits.map((v) => String(v.doctor_id || "")).filter(Boolean),
      ...planVisits.map((v) => String(v.doctor_id || "")).filter(Boolean),
    ])];
    const receptionistIds = [...new Set([
      ...receiptRows.map((r) => String(r.receptionist_id || "")).filter(Boolean),
      ...planVisits.map((v) => String(v.receptionist_id || "")).filter(Boolean),
    ])];

    const services: ServiceRow[] = [];
    for (const ids of chunk(serviceIds, IN_CHUNK)) {
      const { data, error } = await supabase.from("services").select("id, name, display_name").in("id", ids);
      if (error) throw new Error(error.message || "Failed loading services.");
      services.push(...((data || []) as ServiceRow[]));
    }
    const serviceById = new Map(services.map((s) => [s.id, String(s.display_name || s.name || "Service")]));

    const doctors: DoctorRow[] = [];
    for (const ids of chunk(doctorIds, IN_CHUNK)) {
      const { data, error } = await supabase.from("doctors").select("id, name").in("id", ids);
      if (error) throw new Error(error.message || "Failed loading doctors.");
      doctors.push(...((data || []) as DoctorRow[]));
    }
    const doctorById = new Map(doctors.map((d) => [d.id, String(d.name || "")]));

    const receptionists: ReceptionistRow[] = [];
    for (const ids of chunk(receptionistIds, IN_CHUNK)) {
      const { data, error } = await supabase.from("receptionist").select("id, name, clinic_id").in("id", ids);
      if (error) throw new Error(error.message || "Failed loading receptionists.");
      receptionists.push(...((data || []) as ReceptionistRow[]));
    }
    const receptionistById = new Map(receptionists.map((r) => [r.id, String(r.name || "")]));

    if (auditStarted) {
      await supabase
        .from("patient_backup_exports")
        .update({
          patient_count: expectedPatientCount,
          treatment_record_count: expectedTreatmentRecords,
        })
        .eq("export_id", exportId);
    }

    const treatmentRows: Array<{
      treatmentRecordId: string;
      clinicPatientFileId: string;
      patientName: string;
      fileNo: string;
      mrn: string;
      treatmentDate: Date | null;
      treatmentDone: string;
      toothNumbers: string;
      practitioner: string;
      visitProgress: string;
      treatmentStatus: string;
      receiptNumber: string;
      source: string;
      notes: string;
    }> = [];

    const addRow = (row: (typeof treatmentRows)[number]) => treatmentRows.push(row);

    for (const row of exportableImportedVisits) {
      const file = clinicFileById.get(row.patient_file_id);
      if (!file) continue;
      const patient = patientById.get(file.patient_id);
      addRow({
        treatmentRecordId: `IMPORTED-${row.id}`,
        clinicPatientFileId: file.id,
        patientName: safeText(patient?.name || ""),
        fileNo: safeText(file.file_no || ""),
        mrn: safeText(file.mrn || ""),
        treatmentDate: toExcelDate(row.visit_date),
        treatmentDone: safeText(row.treatment_description || "Imported treatment"),
        toothNumbers: "",
        practitioner: safeText(doctorById.get(String(row.doctor_id || "")) || row.original_dentist_name || ""),
        visitProgress: row.visit_sequence ? safeText(`${row.visit_sequence}`) : "",
        treatmentStatus: "Imported",
        receiptNumber: "",
        source: "Imported Past Treatments",
        notes: "",
      });
    }

    for (const item of exportableReceiptItems) {
      const receipt = receiptById.get(item.receipt_id);
      if (!receipt) continue;
      const file = clinicFileById.get(String(receipt.patient_file_id || ""));
      if (!file) continue;
      const patient = patientById.get(file.patient_id);
      const serviceName = serviceById.get(String(item.service_id || "")) || "Service";
      addRow({
        treatmentRecordId: `RECEIPT-ITEM-${item.id}`,
        clinicPatientFileId: file.id,
        patientName: safeText(patient?.name || ""),
        fileNo: safeText(file.file_no || ""),
        mrn: safeText(file.mrn || ""),
        treatmentDate: toExcelDate(receipt.created_at),
        treatmentDone: safeText(serviceName),
        toothNumbers: safeText(formatTeeth(item.teeth)),
        practitioner: safeText(doctorById.get(String(receipt.doctor_id || "")) || ""),
        visitProgress: "",
        treatmentStatus: "Completed",
        receiptNumber: receipt.receipt_number
          ? safeText(String(receipt.receipt_number).padStart(5, "0"))
          : safeText(String(receipt.id).slice(0, 8).toUpperCase()),
        source: "POS Receipt Item",
        notes: safeText(receipt.notes || ""),
      });
    }

    for (const visit of exportablePlanVisits) {
      const plan = planById.get(visit.treatment_plan_id);
      if (!plan) continue;
      const file = clinicFileById.get(String(plan.patient_file_id || ""));
      if (!file) continue;
      const patient = patientById.get(file.patient_id);
      const fallbackService = serviceById.get(String(plan.service_id || "")) || plan.title || "Treatment Plan Visit";
      addRow({
        treatmentRecordId: `PLAN-VISIT-${visit.id}`,
        clinicPatientFileId: file.id,
        patientName: safeText(patient?.name || ""),
        fileNo: safeText(file.file_no || ""),
        mrn: safeText(file.mrn || ""),
        treatmentDate: toExcelDate(visit.visit_date),
        treatmentDone: safeText(fallbackService),
        toothNumbers: safeText(formatTeeth(visit.teeth)),
        practitioner: safeText(
          doctorById.get(String(visit.doctor_id || "")) ||
          receptionistById.get(String(visit.receptionist_id || "")) ||
          ""
        ),
        visitProgress: plan.planned_visits
          ? safeText(`${Number(visit.visit_number || 0)}/${Number(plan.planned_visits || 1)}`)
          : "",
        treatmentStatus: safeText(plan.status || "Active"),
        receiptNumber: "",
        source: "Treatment Plan Visit",
        notes: safeText(visit.notes || ""),
      });
    }

    if (treatmentRows.length !== expectedTreatmentRecords) {
      await supabase
        .from("patient_backup_exports")
        .update({
          export_status: "failed",
          error_message: "Row count mismatch while generating backup.",
        })
        .eq("export_id", exportId);
      return NextResponse.json(
        { error: "Export failed because treatment counts did not reconcile." },
        { status: 409 }
      );
    }

    const rowsByFile = new Map<string, typeof treatmentRows>();
    for (const row of treatmentRows) {
      const arr = rowsByFile.get(row.clinicPatientFileId) || [];
      arr.push(row);
      rowsByFile.set(row.clinicPatientFileId, arr);
    }

    const patientRegisterRows = clinicFiles.map((file) => {
      const patient = patientById.get(file.patient_id);
      const rows = rowsByFile.get(file.id) || [];
      const sortedRows = [...rows].sort((a, b) => {
        const aTime = a.treatmentDate ? a.treatmentDate.getTime() : 0;
        const bTime = b.treatmentDate ? b.treatmentDate.getTime() : 0;
        return bTime - aTime;
      });
      const latest = sortedRows[0];
      const hasImported =
        Boolean(file.legacy_source && (file.legacy_source.import_batch_id || file.legacy_source.source_row_number)) ||
        exportableImportedVisits.some((v) => v.patient_file_id === file.id);
      const hasPos =
        receiptRows.some((r) => String(r.patient_file_id || "") === file.id) ||
        planRows.some((p) => String(p.patient_file_id || "") === file.id) ||
        noteRows.some((n) => String(n.patient_file_id || "") === file.id);
      const dataSource = hasImported && hasPos ? "Imported + POS" : hasImported ? "Imported" : "POS";
      return {
        patientName: safeText(patient?.name || ""),
        mrn: safeText(file.mrn || ""),
        mobile: safeText(patient?.phone || ""),
        email: safeText(patient?.email || ""),
        birthday: toExcelDate(patient?.date_of_birth),
        ageAtExport: calculateAgeAt(patient?.date_of_birth, exportAt),
        sex: safeText(patient?.sex || ""),
        nationality: safeText(patient?.nationality || ""),
        fileNo: safeText(file.file_no || ""),
        emiratesId: safeText(patient?.emirates_id || ""),
        passport: safeText(patient?.passport_number || ""),
        clinicalNotes: safeText(file.clinical_notes || latestNoteByFile.get(file.id) || patient?.notes || ""),
        latestTreatment: safeText(latest?.treatmentDone || ""),
        latestTreatmentDate: latest?.treatmentDate || null,
        recordStatus: file.is_active === false ? "Inactive / Archived" : "Active",
        dataSource,
        systemPatientId: safeText(file.patient_id || ""),
        clinicPatientFileId: safeText(file.id || ""),
      };
    });

    const wb = new ExcelJS.Workbook();
    wb.creator = "Skin & Smile POS";
    wb.created = exportAt;
    wb.modified = exportAt;

    const summary = wb.addWorksheet("Backup Information", {
      views: [{ showGridLines: false }],
    });
    summary.columns = [{ width: 36 }, { width: 60 }];

    const backupTitle = `${clinic.name}\nDaily Patient Backup\n${clinic.code || clinic.name}`;
    summary.mergeCells("A5:B5");
    summary.getCell("A5").value = backupTitle;
    summary.getCell("A5").font = { bold: true, size: 16, color: { argb: "FF0F766E" }, name: "Calibri" };
    summary.getCell("A5").alignment = { vertical: "middle", horizontal: "left", wrapText: true };

    const summaryRows: Array<[string, string | number]> = [
      ["Export ID", exportId],
      ["Clinic Name", clinic.name],
      ["Clinic Code / Branch", clinic.code || ""],
      ["Export Date & Time", formatDubaiDateTime(exportAt)],
      ["Time Zone", DUBAI_TZ],
      ["Exported By", receptionistById.get(receptionistId) || "Manager / Administrator"],
      ["User Role", safeText(String(session.user_role || sessionMode || ""))],
      ["Total Patient Files", expectedPatientCount],
      ["Active Patient Files", clinicFiles.filter((f) => f.is_active !== false).length],
      ["Inactive / Archived Patient Files", clinicFiles.filter((f) => f.is_active === false).length],
      ["Total Treatment-History Records", treatmentRows.length],
      ["Oldest Treatment Date", (() => {
        const first = [...treatmentRows].sort((a, b) => {
          const aT = a.treatmentDate ? a.treatmentDate.getTime() : Number.MAX_SAFE_INTEGER;
          const bT = b.treatmentDate ? b.treatmentDate.getTime() : Number.MAX_SAFE_INTEGER;
          return aT - bT;
        })[0];
        return first?.treatmentDate ? formatDubaiDateTime(first.treatmentDate) : "";
      })()],
      ["Latest Treatment Date", (() => {
        const last = [...treatmentRows].sort((a, b) => {
          const aT = a.treatmentDate ? a.treatmentDate.getTime() : 0;
          const bT = b.treatmentDate ? b.treatmentDate.getTime() : 0;
          return bT - aT;
        })[0];
        return last?.treatmentDate ? formatDubaiDateTime(last.treatmentDate) : "";
      })()],
      ["Export Version", "patient-backup-v1"],
      ["Confidentiality Notice", "Confidential patient and clinical information. Share only with authorized management."],
    ];

    let infoRow = 7;
    for (const [label, value] of summaryRows) {
      summary.getCell(`A${infoRow}`).value = label;
      summary.getCell(`B${infoRow}`).value = typeof value === "string" ? safeText(value) : value;
      summary.getCell(`A${infoRow}`).font = { bold: true, color: { argb: "FF0F172A" }, name: "Calibri", size: 11 };
      summary.getCell(`A${infoRow}`).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2F7F5" } };
      summary.getCell(`B${infoRow}`).alignment = { vertical: "top", horizontal: "left", wrapText: true };
      summary.getCell(`A${infoRow}`).border = summary.getCell(`B${infoRow}`).border = {
        top: { style: "thin", color: { argb: "FFE2E8F0" } },
        left: { style: "thin", color: { argb: "FFE2E8F0" } },
        bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
        right: { style: "thin", color: { argb: "FFE2E8F0" } },
      };
      infoRow += 1;
    }

    const patientSheet = wb.addWorksheet("Patient Register", {
      views: [{ state: "frozen", ySplit: 1, xSplit: 2, showGridLines: false }],
    });
    const patientHeaders = [
      "File No.",
      "Patient Name",
      "MRN #",
      "Mobile #",
      "Email",
      "Birthday",
      "Age at Export",
      "Sex",
      "Nationality",
      "Emirates ID #",
      "Passport #",
      "Clinical Notes",
      "Latest Treatment",
      "Latest Treatment Date",
      "Record Status",
      "Data Source",
      "System Patient ID",
    ];
    patientSheet.addRow(patientHeaders);
    for (const row of patientRegisterRows) {
      patientSheet.addRow([
        row.fileNo,
        row.patientName,
        row.mrn,
        row.mobile,
        row.email,
        row.birthday || "",
        row.ageAtExport ?? "",
        row.sex,
        row.nationality,
        row.emiratesId,
        row.passport,
        row.clinicalNotes,
        row.latestTreatment,
        row.latestTreatmentDate || "",
        row.recordStatus,
        row.dataSource,
        row.systemPatientId,
      ]);
    }
    patientSheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: Math.max(1, patientRegisterRows.length + 1), column: patientHeaders.length },
    };
    patientSheet.columns = [
      { width: 14 }, { width: 26 }, { width: 16 }, { width: 16 }, { width: 24 }, { width: 13 },
      { width: 12 }, { width: 10 }, { width: 14 }, { width: 16 }, { width: 14 }, { width: 42 },
      { width: 32 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 26 },
    ];
    styleHeaderRow(patientSheet, 1, patientHeaders.length);
    styleBodyTable(patientSheet, 2, Math.max(2, patientRegisterRows.length + 1), patientHeaders.length);

    for (let r = 2; r <= patientRegisterRows.length + 1; r++) {
      patientSheet.getCell(r, 1).numFmt = "@";
      patientSheet.getCell(r, 3).numFmt = "@";
      patientSheet.getCell(r, 4).numFmt = "@";
      patientSheet.getCell(r, 10).numFmt = "@";
      patientSheet.getCell(r, 11).numFmt = "@";
      patientSheet.getCell(r, 17).numFmt = "@";
      patientSheet.getCell(r, 6).numFmt = "yyyy-mm-dd";
      patientSheet.getCell(r, 14).numFmt = "yyyy-mm-dd";
      patientSheet.getCell(r, 12).alignment = { vertical: "top", horizontal: "left", wrapText: true };
      patientSheet.getCell(r, 13).alignment = { vertical: "top", horizontal: "left", wrapText: true };
      patientSheet.getCell(r, 17).font = { name: "Calibri", size: 9, color: { argb: "FF64748B" } };
    }

    const treatmentSheet = wb.addWorksheet("Treatment History", {
      views: [{ state: "frozen", ySplit: 1, xSplit: 2, showGridLines: false }],
    });
    const treatmentHeaders = [
      "Patient Name",
      "File No.",
      "MRN #",
      "Treatment Date",
      "Treatment Done",
      "Tooth Number(s)",
      "Dentist/Therapist",
      "Visit Progress",
      "Treatment Status",
      "Receipt Number",
      "Source",
      "Clinical/Treatment Notes",
    ];
    treatmentSheet.addRow(treatmentHeaders);
    for (const row of treatmentRows) {
      treatmentSheet.addRow([
        row.patientName,
        row.fileNo,
        row.mrn,
        row.treatmentDate || "",
        row.treatmentDone,
        row.toothNumbers,
        row.practitioner,
        row.visitProgress,
        row.treatmentStatus,
        row.receiptNumber,
        row.source,
        row.notes,
      ]);
    }
    treatmentSheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: Math.max(1, treatmentRows.length + 1), column: treatmentHeaders.length },
    };
    treatmentSheet.columns = [
      { width: 24 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 36 }, { width: 18 },
      { width: 20 }, { width: 12 }, { width: 16 }, { width: 14 }, { width: 20 }, { width: 42 },
    ];
    styleHeaderRow(treatmentSheet, 1, treatmentHeaders.length);
    styleBodyTable(treatmentSheet, 2, Math.max(2, treatmentRows.length + 1), treatmentHeaders.length);
    for (let r = 2; r <= treatmentRows.length + 1; r++) {
      treatmentSheet.getCell(r, 2).numFmt = "@";
      treatmentSheet.getCell(r, 3).numFmt = "@";
      treatmentSheet.getCell(r, 10).numFmt = "@";
      treatmentSheet.getCell(r, 4).numFmt = "yyyy-mm-dd";
      treatmentSheet.getCell(r, 5).alignment = { vertical: "top", horizontal: "left", wrapText: true };
      treatmentSheet.getCell(r, 12).alignment = { vertical: "top", horizontal: "left", wrapText: true };
    }

    const buffer = await wb.xlsx.writeBuffer();
    const binaryBuffer = buffer instanceof ArrayBuffer
      ? Buffer.from(buffer)
      : Buffer.from(buffer as Uint8Array);

    if (auditStarted) {
      await supabase
        .from("patient_backup_exports")
        .update({
          export_status: "success",
          patient_count: patientRegisterRows.length,
          treatment_record_count: treatmentRows.length,
        })
        .eq("export_id", exportId);
    }

    return new NextResponse(binaryBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store, no-cache, max-age=0",
        Pragma: "no-cache",
        Expires: "0",
        "X-Export-Id": exportId,
      },
    });
  } catch (error) {
    if (auditStarted && exportId) {
      await supabase
        .from("patient_backup_exports")
        .update({
          export_status: "failed",
          error_message: error instanceof Error ? error.message : "Export generation failed.",
        })
        .eq("export_id", exportId);
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not generate backup export." },
      { status: 500 }
    );
  }
}
