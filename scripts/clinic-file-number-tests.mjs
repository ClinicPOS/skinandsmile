import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import XLSX from "xlsx-js-style";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function load(relative, dependencies = {}) {
  const source = fs.readFileSync(path.join(root, relative), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const mod = { exports: {} };
  new Function("require", "module", "exports", compiled.outputText)(name => {
    if (!(name in dependencies)) throw new Error(`Unexpected dependency ${name}; network/database access is blocked`);
    return dependencies[name];
  }, mod, mod.exports);
  return mod.exports;
}
const helpers = load("lib/clinic-file-numbers.ts");
const validation = load("lib/patient-mutation-validation.ts");
const patientA = "11111111-1111-4111-8111-111111111111";
const patientB = "22222222-2222-4222-8222-222222222222";
const clinicA = "33333333-3333-4333-8333-333333333333";
const clinicB = "44444444-4444-4444-8444-444444444444";
let session, rows, race, lookupFailure, saved, queries;
function reset() {
  session = { sessionMode: "clinic", clinicId: clinicA, userRole: "receptionist" };
  rows = [
    { id: "file-a", patient_id: patientA, clinic_id: clinicA, file_no: "001", mrn: null, patients: { name: "First Patient" } },
    { id: "file-b", patient_id: patientB, clinic_id: clinicA, file_no: "002", mrn: null, patients: [{ name: "Second Patient" }] },
    { id: "file-other", patient_id: patientB, clinic_id: clinicB, file_no: "003", mrn: null, patients: { name: "Other Clinic" } },
  ];
  race = false; lookupFailure = false; saved = []; queries = [];
}
const db = { from(table) {
  assert.equal(table, "clinic_patient_files");
  const filters = [];
  let updates, single = false, selected = "";
  const builder = {
    select(value) { selected = value; return this; },
    eq(key, value) { filters.push(row => row[key] === value); return this; },
    neq(key, value) { filters.push(row => row[key] !== value); return this; },
    limit() { return this; },
    maybeSingle() { single = true; return this; },
    single() { single = true; return this; },
    update(value) { updates = value; return this; },
    then(resolve, reject) {
      return Promise.resolve().then(() => {
        const matches = rows.filter(row => filters.every(f => f(row)));
        queries.push(selected);
        if (lookupFailure && selected.includes("patients")) return { data: null, error: { code: "XX000" } };
        if (updates && race) {
          rows[1].file_no = updates.file_no;
          return { data: null, error: { code: "23505" } };
        }
        if (updates) { matches.forEach(row => Object.assign(row, updates)); saved.push(updates); }
        return { data: single ? matches[0] || null : matches, error: null };
      }).then(resolve, reject);
    },
  };
  return builder;
} };
const { PATCH } = load("app/api/patients/[patientId]/clinic-file/route.ts", {
  "../../../../../lib/protected-data-server": { createProtectedDataClient: () => db },
  "../../../../../lib/api-session": {
    createServerSupabaseClient: () => db,
    readAppSession: async () => session ? { session } : { session: null, errorResponse: Response.json({ error: "Unauthorized" }, { status: 401 }) },
    ensureManagerSession: s => s.sessionMode === "manager" && ["ceo", "it_admin"].includes(s.userRole) ? null : Response.json({}, { status: 403 }),
  },
  "../../../../../lib/patient-mutation-server": { operationResponse: (id, body, status = 200) => Response.json({ ...body, operationId: id }, { status }) },
  "../../../../../lib/patient-mutation-validation": validation,
  "../../../../../lib/clinic-file-numbers": helpers,
});
async function edit(body, id = patientA) {
  return PATCH(new Request("http://offline.test/clinic-file", { method: "PATCH", body: JSON.stringify(body) }), { params: Promise.resolve({ patientId: id }) });
}
reset(); session = null;
assert.equal((await edit({ clinicId: clinicA, fileNo: "003" })).status, 401);
assert.equal(queries.length, 0);
reset();
assert.equal((await edit({ clinicId: clinicB, fileNo: "003" })).status, 403);
assert.equal(queries.length, 0);
reset(); session = { sessionMode: "reports", clinicId: null, userRole: "ceo" };
assert.equal((await edit({ clinicId: clinicA, fileNo: "003" })).status, 403);
reset();
let response = await edit({ clinicId: clinicA, fileNo: "002" });
assert.equal(response.status, 409);
assert.equal((await response.json()).error, "File No. Already taken = Second Patient");
assert.equal(saved.length, 0);
reset();
assert.equal((await edit({ clinicId: clinicA, fileNo: " 003 ", mrn: " MRN-A " })).status, 200);
assert.deepEqual(saved[0], { file_no: "003", mrn: "MRN-A" });
assert.equal(rows[2].file_no, "003", "Another clinic's same number is untouched");
reset();
assert.equal((await edit({ clinicId: clinicA, fileNo: "001" })).status, 200, "Keeping own number is allowed");
reset(); race = true;
response = await edit({ clinicId: clinicA, fileNo: "004" });
assert.equal(response.status, 409);
assert.equal((await response.json()).error, "File No. Already taken = Second Patient");
assert.equal(saved.length, 0);
reset(); lookupFailure = true;
assert.equal((await edit({ clinicId: clinicA, fileNo: "004" })).status, 500);
assert.equal(saved.length, 0);
reset();
for (const body of [{ clinicId: clinicA, fileNo: " " }, { clinicId: clinicA, fileNo: "x".repeat(101) }, { clinicId: clinicA, fileNo: "004", patientId: patientB }]) {
  assert.equal((await edit(body)).status, 400);
}
assert.equal((await edit({ clinicId: clinicA, fileNo: "004" }, "not-an-id")).status, 400);
assert.equal(saved.length, 0);
reset(); rows = rows.filter(row => row.id !== "file-a");
assert.equal((await edit({ clinicId: clinicA, fileNo: "004" })).status, 404);
reset(); session = { sessionMode: "manager", clinicId: null, userRole: "it_admin" };
assert.equal((await edit({ clinicId: clinicA, fileNo: "004" })).status, 200);

const reportRows = Array.from({ length: 1001 }, (_, i) => ({ id: `id-${i}`, patient_id: `patient-${i}`, clinic_id: clinicA, file_no: `00${i}` }));
reportRows.push({ id: "other", patient_id: "patient-0", clinic_id: clinicB, file_no: "OTHER" });
let pages = 0;
const reportDb = { from(table) {
  assert.equal(table, "clinic_patient_files");
  let scope;
  return { select() { return this; }, eq(key, value) { assert.equal(key, "clinic_id"); scope = value; return this; },
    order(key) { assert.equal(key, "id"); return this; },
    async range(start, end) { pages++; return { data: reportRows.filter(row => row.clinic_id === scope).slice(start, end + 1), error: null }; } };
} };
const fileMap = await helpers.loadClinicFileNumbers(reportDb, clinicA);
assert.equal(fileMap.size, 1001);
assert.equal(pages, 3);
assert.equal(helpers.reportClinicFileNumber(fileMap, "patient-0"), "000");
assert.equal(helpers.reportClinicFileNumber(fileMap, "unlinked"), "Missing clinic file");
await assert.rejects(helpers.loadClinicFileNumbers({ from() {
  return { select() { return this; }, eq() { return this; }, order() { return this; },
    async range() { return { data: null, error: { code: "XX000" } }; } };
} }, clinicA), /Clinic file numbers could not be loaded/, "Report aborts instead of using another identifier on lookup failure");
const sheet = XLSX.utils.aoa_to_sheet([["File No."], [helpers.reportClinicFileNumber(fileMap, "patient-0")]]);
const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, sheet, "Transaction Details");
const roundTrip = XLSX.read(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }), { type: "buffer" });
assert.equal(roundTrip.Sheets["Transaction Details"].A2.v, "000");
assert.equal(roundTrip.Sheets["Transaction Details"].A2.t, "s");
console.log("PASS: authenticated clinic scope, duplicate names, race handling, validation, pagination, and Excel text preservation; no live access.");
