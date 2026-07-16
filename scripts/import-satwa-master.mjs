#!/usr/bin/env node
/**
 * Import the Satwa master patient list CSV into Supabase.
 *
 * Usage (from repo root):
 *   node scripts/import-satwa-master.mjs "path/to/SATWA OFFICIAL - MASTER LIST.csv"
 *
 * Env vars (from .env.local, read automatically):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY
 *
 * Additional required env vars:
 *   SATWA_CLINIC_NAME   e.g. "Dental" or "Satwa Dental" — used to look up clinic_id
 *     (or) SATWA_CLINIC_ID   explicit UUID, wins if set
 *
 * Prereqs:
 *   1. Run supabase-mrn-migration.sql in the Supabase SQL editor first.
 *   2. Row Level Security must be off (default) or a service role key must be used.
 *
 * Behavior:
 *   - Upserts patients on `patient_number` (idempotent — safe to rerun).
 *   - Inserts a patient_notes row per non-empty visit block, stamped with the
 *     visit date (created_at) and clinic_id = Satwa dental clinic.
 *   - Skips visit-note inserts for a patient if that patient already has any
 *     notes in the target clinic (prevents duplicate re-imports).
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

// --- load .env.local manually (no dotenv dep) --------------------------------
try {
  const envText = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  for (const line of envText.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const CLINIC_ID_ENV = process.env.SATWA_CLINIC_ID;
const CLINIC_NAME_ENV = process.env.SATWA_CLINIC_NAME;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local");
  process.exit(1);
}

const csvPath = process.argv[2];
if (!csvPath) {
  console.error("Usage: node scripts/import-satwa-master.mjs <path-to-csv>");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// --- minimal RFC-4180 CSV parser (handles quotes, embedded commas, newlines)-
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\r") { /* skip */ }
      else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else field += c;
    }
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// --- date parser: "3-May-26" / "17-Jun-26" -> "2026-05-03" -------------------
const MONTHS = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12 };
function parseDate(str) {
  if (!str) return null;
  const s = String(str).trim();
  if (!s) return null;
  const m = s.match(/^(\d{1,2})[-\/\s]([A-Za-z]{3,})[-\/\s](\d{2,4})$/);
  if (!m) return null;
  const day = parseInt(m[1], 10);
  const mon = MONTHS[m[2].slice(0, 3).toLowerCase()];
  let year = parseInt(m[3], 10);
  if (!mon || !day) return null;
  if (year < 100) year += 2000;
  const pad = (n) => String(n).padStart(2, "0");
  return `${year}-${pad(mon)}-${pad(day)}`;
}

function clean(v) {
  if (v == null) return null;
  const t = String(v).trim();
  return t === "" ? null : t;
}

// --- main --------------------------------------------------------------------
async function main() {
  const clinicId = await resolveClinicId();
  console.log(`Using clinic_id: ${clinicId}`);

  const raw = readFileSync(resolve(process.cwd(), csvPath), "utf8");
  const rows = parseCsv(raw);
  const header = rows[0];
  console.log(`CSV rows (incl. header): ${rows.length}`);
  console.log(`Header columns: ${header.length}`);

  // Column indices (0-based) based on the master list layout.
  // 0: name, 1: file_no, 2: gender, 3: mrn, 4: contact, 5: nationality,
  // 6: medical_history_1, 7: medical_history_2 (Column 8),
  // Visit 1: 8=date, 9=treatment, 10=fee, 11=dentist
  // Visit 2: 13=date, 14=treatment, 15=fee, 16=dentist   (col 12 is separator)
  // Visit 3: 18=date, 19=treatment, 20=fee, 21=dentist
  // Visit 4: 23..26, Visit 5: 28..31, Visit 6: 33..36, Visit 7: 38..41,
  // Visit 8: 42..45, Visit 9: 46..49, Visit 10: 50..53
  // (Visits 7-10 have no leading separator column, per the header.)
  const visitCols = [
    [8, 9, 10, 11],
    [13, 14, 15, 16],
    [18, 19, 20, 21],
    [23, 24, 25, 26],
    [28, 29, 30, 31],
    [33, 34, 35, 36],
    [38, 39, 40, 41],
    [42, 43, 44, 45],
    [46, 47, 48, 49],
    [50, 51, 52, 53],
  ];

  const patients = [];
  const notesByFileNo = new Map();

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const name = clean(r[0]);
    const fileNoRaw = clean(r[1]);
    if (!name || !fileNoRaw) continue;
    const fileNo = parseInt(fileNoRaw, 10);
    if (!Number.isFinite(fileNo)) continue;

    const gender = clean(r[2]);
    const mrn = clean(r[3]);
    const phone = clean(r[4]);
    const nationality = clean(r[5]);
    const mh1 = clean(r[6]);
    const mh2 = clean(r[7]);
    const notes = [mh1, mh2].filter(Boolean).join("\n\n") || null;

    patients.push({
      patient_number: fileNo,
      name,
      sex: gender ? gender.toUpperCase().startsWith("M") ? "Male" : gender.toUpperCase().startsWith("F") ? "Female" : gender : null,
      mrn,
      phone,
      nationality,
      notes,
    });

    const visitNotes = [];
    for (const [dCol, tCol, fCol, denCol] of visitCols) {
      const date = parseDate(clean(r[dCol]));
      const treatment = clean(r[tCol]);
      const fee = clean(r[fCol]);
      const dentist = clean(r[denCol]);
      if (!date && !treatment && !fee && !dentist) continue;
      const parts = [];
      if (treatment) parts.push(`Treatment: ${treatment}`);
      if (fee) parts.push(`Fee: AED ${fee}`);
      if (dentist) parts.push(`Dentist: ${dentist}`);
      if (parts.length === 0) continue;
      visitNotes.push({
        note: parts.join("\n"),
        created_at: date ? `${date}T00:00:00+04:00` : new Date().toISOString(),
        clinic_id: clinicId,
      });
    }
    if (visitNotes.length) notesByFileNo.set(fileNo, visitNotes);
  }

  console.log(`Parsed patients: ${patients.length}`);
  console.log(`Patients with visit notes: ${notesByFileNo.size}`);

  // ---- upsert patients in batches ------------------------------------------
  const BATCH = 200;
  let upserted = 0;
  for (let i = 0; i < patients.length; i += BATCH) {
    const chunk = patients.slice(i, i + BATCH);
    const { error } = await supabase
      .from("patients")
      .upsert(chunk, { onConflict: "patient_number" });
    if (error) { console.error("Patient upsert error:", error); process.exit(1); }
    upserted += chunk.length;
    console.log(`  patients upserted: ${upserted}/${patients.length}`);
  }

  // ---- map file_no -> patient id ------------------------------------------
  const fileNos = Array.from(notesByFileNo.keys());
  const idByFileNo = new Map();
  for (let i = 0; i < fileNos.length; i += 500) {
    const chunk = fileNos.slice(i, i + 500);
    const { data, error } = await supabase
      .from("patients")
      .select("id, patient_number")
      .in("patient_number", chunk);
    if (error) { console.error("Lookup error:", error); process.exit(1); }
    for (const p of data || []) idByFileNo.set(p.patient_number, p.id);
  }

  // ---- for each patient, insert notes only if none exist in this clinic ---
  let insertedNotes = 0;
  let skippedPatients = 0;
  for (const [fileNo, notes] of notesByFileNo) {
    const patientId = idByFileNo.get(fileNo);
    if (!patientId) continue;

    const { count } = await supabase
      .from("patient_notes")
      .select("id", { count: "exact", head: true })
      .eq("patient_id", patientId)
      .eq("clinic_id", clinicId);
    if ((count ?? 0) > 0) { skippedPatients++; continue; }

    const payload = notes.map((n) => ({ ...n, patient_id: patientId }));
    const { error } = await supabase.from("patient_notes").insert(payload);
    if (error) { console.error(`Notes insert error for patient ${fileNo}:`, error); continue; }
    insertedNotes += payload.length;
  }

  console.log(`\nDone.`);
  console.log(`  Patients upserted: ${upserted}`);
  console.log(`  Patients skipped for notes (already had notes in clinic): ${skippedPatients}`);
  console.log(`  Notes inserted: ${insertedNotes}`);
}

async function resolveClinicId() {
  if (CLINIC_ID_ENV) return CLINIC_ID_ENV;
  const name = CLINIC_NAME_ENV || "Dental";
  const { data, error } = await supabase.from("clinics").select("id, name");
  if (error) { console.error("Failed to load clinics:", error); process.exit(1); }
  const match = (data || []).find((c) => c.name.toLowerCase().includes(name.toLowerCase()));
  if (!match) {
    console.error(`No clinic name contains "${name}". Existing:`, (data || []).map((c) => c.name));
    console.error(`Set SATWA_CLINIC_ID=<uuid> or SATWA_CLINIC_NAME=<substring>.`);
    process.exit(1);
  }
  return match.id;
}

main().catch((e) => { console.error(e); process.exit(1); });
