#!/usr/bin/env node
import { resolve } from "node:path";
import { writeFileSync } from "node:fs";
import XLSX from "xlsx-js-style";

function usageAndExit(message) {
  if (message) console.error(message);
  console.error("Usage: node scripts/convert-satwa-master-list.mjs <path-to-SATWA OFFICIAL.xlsx> <clinic_code> [import_batch_id]");
  process.exit(1);
}

const workbookPath = process.argv[2];
const clinicCode = process.argv[3];
const importBatchId = process.argv[4] || `satwa-${new Date().toISOString().replace(/[:.]/g, "-")}`;

if (!workbookPath) usageAndExit("Missing workbook path.");
if (!clinicCode) usageAndExit("Missing clinic_code.");

const workbook = XLSX.readFile(resolve(process.cwd(), workbookPath), { raw: false, cellDates: true });
const sheetName = "MASTER LIST";
if (!workbook.SheetNames.includes(sheetName)) {
  usageAndExit('Worksheet "MASTER LIST" was not found. Stopping by design.');
}

const sheet = workbook.Sheets[sheetName];
const range = XLSX.utils.decode_range(sheet["!ref"] || "A1:A1");
const maxCol = range.e.c;
const maxRow = range.e.r;

function cellValue(row, col) {
  const address = XLSX.utils.encode_cell({ r: row, c: col });
  const cell = sheet[address];
  if (!cell) return "";
  const value = cell.v;
  if (value == null) return "";
  return String(value).trim();
}

function normalizeHeader(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function excelDateToIso(value) {
  if (value == null || value === "") return "";
  if (value instanceof Date && !isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const raw = String(value).trim();
  if (!raw) return "";
  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric > 59 && numeric < 60000) {
    const parsed = XLSX.SSF.parse_date_code(numeric);
    if (parsed) {
      const mm = String(parsed.m).padStart(2, "0");
      const dd = String(parsed.d).padStart(2, "0");
      return `${parsed.y}-${mm}-${dd}`;
    }
  }
  const d = new Date(raw);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  const m = raw.match(/^(\d{1,2})[-/ ]([A-Za-z]{3,})[-/ ](\d{2,4})$/);
  if (!m) return "";
  const months = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const day = Number(m[1]);
  const month = months[m[2].slice(0, 3).toLowerCase()];
  let year = Number(m[3]);
  if (!month || !day) return "";
  if (year < 100) year += 2000;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseFee(value) {
  const raw = String(value || "").trim();
  if (!raw) return { parsed: "", valid: true };
  const normalized = raw.replace(/[^\d.-]/g, "");
  if (!normalized) return { parsed: "", valid: false };
  const num = Number(normalized);
  if (!Number.isFinite(num) || num < 0) return { parsed: "", valid: false };
  return { parsed: num.toFixed(2), valid: true };
}

function csvEscape(v) {
  const s = String(v ?? "");
  return `"${s.replace(/"/g, '""')}"`;
}

function writeCsv(filePath, headers, rows) {
  const lines = [headers.map(csvEscape).join(",")];
  for (const row of rows) lines.push(row.map(csvEscape).join(","));
  writeFileSync(resolve(process.cwd(), filePath), lines.join("\n"), "utf8");
}

const headers = [];
for (let c = 0; c <= maxCol; c++) headers.push(cellValue(0, c));

const patientRows = [];
const visitRows = [];
const exceptionRows = [];

const baseCols = {
  patient_name: 0,
  file_no: 1,
  gender: 2,
  mrn: 3,
  contact_no: 4,
  nationality: 5,
  medical_history: 6,
  legacy_column_8: 7,
};

const treatmentStartCol = 8;
const treatmentColumns = [];
let c = treatmentStartCol;
while (c <= maxCol) {
  while (c <= maxCol) {
    const hasHeader = normalizeHeader(headers[c]) !== "";
    let hasData = false;
    for (let r = 1; r <= Math.min(maxRow, 40); r++) {
      if (cellValue(r, c) !== "") {
        hasData = true;
        break;
      }
    }
    if (hasHeader || hasData) break;
    c += 1;
  }
  if (c > maxCol) break;
  const dateCol = c++;
  while (c <= maxCol && normalizeHeader(headers[c]) === "" && cellValue(1, c) === "") c += 1;
  if (c > maxCol) break;
  const treatmentCol = c++;
  while (c <= maxCol && normalizeHeader(headers[c]) === "" && cellValue(1, c) === "") c += 1;
  if (c > maxCol) break;
  const feeCol = c++;
  while (c <= maxCol && normalizeHeader(headers[c]) === "" && cellValue(1, c) === "") c += 1;
  if (c > maxCol) break;
  const dentistCol = c++;
  treatmentColumns.push({ dateCol, treatmentCol, feeCol, dentistCol });
}

const col8Header = normalizeHeader(headers[7]);
if (col8Header && col8Header !== "column 8") {
  exceptionRows.push([
    importBatchId,
    "header",
    "",
    "unknown_column_8_header",
    `Unexpected header in column H: ${headers[7]}`,
    "",
  ]);
}
if (treatmentColumns.length > 0) {
  const firstDentistHeader = headers[treatmentColumns[0].dentistCol] || "";
  if (!normalizeHeader(firstDentistHeader).includes("dentist")) {
    exceptionRows.push([
      importBatchId,
      "header",
      "",
      "unknown_first_dentist_header",
      "First dentist header is not clearly labeled; value preserved as source text.",
      "",
    ]);
  }
}

let patientCount = 0;
let visitCount = 0;
let skippedRows = 0;
let invalidDateCount = 0;
let invalidFeeCount = 0;

for (let r = 1; r <= maxRow; r++) {
  const patientName = cellValue(r, baseCols.patient_name);
  const fileNo = cellValue(r, baseCols.file_no);
  const sourceRowNumber = r + 1;

  if (!patientName && !fileNo) {
    skippedRows += 1;
    continue;
  }
  if (!patientName) {
    exceptionRows.push([importBatchId, "patient", sourceRowNumber, "missing_patient_name", "Patient name is missing.", ""]);
    continue;
  }
  if (!fileNo) {
    exceptionRows.push([importBatchId, "patient", sourceRowNumber, "missing_file_no", "File number is missing.", ""]);
    continue;
  }

  patientRows.push([
    importBatchId,
    clinicCode,
    patientName,
    fileNo,
    cellValue(r, baseCols.gender),
    cellValue(r, baseCols.mrn),
    cellValue(r, baseCols.contact_no),
    cellValue(r, baseCols.nationality),
    cellValue(r, baseCols.medical_history),
    cellValue(r, baseCols.legacy_column_8),
    sourceRowNumber,
  ]);
  patientCount += 1;

  treatmentColumns.forEach((group, idx) => {
    const rawDate = cellValue(r, group.dateCol);
    const treatmentDone = cellValue(r, group.treatmentCol);
    const rawFee = cellValue(r, group.feeCol);
    const dentistName = cellValue(r, group.dentistCol);
    if (!rawDate && !treatmentDone && !rawFee && !dentistName) return;

    const dateIso = excelDateToIso(rawDate);
    const fee = parseFee(rawFee);
    if (rawDate && !dateIso) {
      invalidDateCount += 1;
      exceptionRows.push([importBatchId, "visit", sourceRowNumber, "invalid_date", `Visit ${idx + 1}: invalid date format.`, ""]);
    }
    if (rawFee && !fee.valid) {
      invalidFeeCount += 1;
      exceptionRows.push([importBatchId, "visit", sourceRowNumber, "invalid_fee", `Visit ${idx + 1}: invalid fee value.`, ""]);
    }

    visitRows.push([
      importBatchId,
      clinicCode,
      fileNo,
      idx + 1,
      dateIso,
      treatmentDone,
      fee.parsed,
      dentistName,
      sourceRowNumber,
    ]);
    visitCount += 1;
  });
}

writeCsv(
  "satwa_patients_import.csv",
  [
    "import_batch_id",
    "clinic_code",
    "patient_name",
    "file_no",
    "gender",
    "mrn",
    "contact_no",
    "nationality",
    "medical_history",
    "legacy_column_8",
    "source_row_number",
  ],
  patientRows
);

writeCsv(
  "satwa_treatment_visits_import.csv",
  [
    "import_batch_id",
    "clinic_code",
    "file_no",
    "visit_sequence",
    "visit_date",
    "treatment_done",
    "fee_aed",
    "dentist_name",
    "source_row_number",
  ],
  visitRows
);

writeCsv(
  "satwa_import_exceptions.csv",
  ["import_batch_id", "row_type", "source_row_number", "code", "message", "value"],
  exceptionRows
);

console.log(`Batch ID: ${importBatchId}`);
console.log(`Patients CSV rows: ${patientCount}`);
console.log(`Treatment visit CSV rows: ${visitCount}`);
console.log(`Exceptions rows: ${exceptionRows.length}`);
console.log(`Skipped blank rows: ${skippedRows}`);
console.log(`Invalid dates flagged: ${invalidDateCount}`);
console.log(`Invalid fees flagged: ${invalidFeeCount}`);

