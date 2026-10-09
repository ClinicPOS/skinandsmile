import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ts from "typescript";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmpDir = path.join(os.tmpdir(), "dental-pos-patient-mutation-security-tests");
fs.mkdirSync(tmpDir, { recursive: true });

const validationPath = path.join(repoRoot, "lib", "patient-mutation-validation.ts");
const outputPath = path.join(tmpDir, "patient-mutation-validation.cjs");
const transpiled = ts.transpileModule(fs.readFileSync(validationPath, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: validationPath,
});
fs.writeFileSync(outputPath, transpiled.outputText, "utf8");

const {
  isUuid,
  sessionCanAccessClinic,
  validateNoteText,
  validatePatientUpdates,
} = require(outputPath);

const patientId = "11111111-1111-4111-8111-111111111111";
const clinicA = "22222222-2222-4222-8222-222222222222";
const clinicB = "33333333-3333-4333-8333-333333333333";

assert.equal(isUuid(patientId), true, "valid patient UUID accepted");
assert.equal(isUuid("not-a-uuid"), false, "invalid patient/note UUID rejected");
assert.deepEqual(validateNoteText("  Follow-up required  "), { value: "Follow-up required" }, "valid add/edit note accepted");
assert.equal(validateNoteText("   ").error, "Note text is required.");

assert.equal(sessionCanAccessClinic(null, clinicA), false, "unauthenticated request rejected");
assert.equal(
  sessionCanAccessClinic({ sessionMode: "clinic", clinicId: clinicA }, clinicB),
  false,
  "another clinic's note/patient context rejected"
);
assert.equal(sessionCanAccessClinic({ sessionMode: "clinic", clinicId: clinicA }, clinicA), true);
assert.equal(sessionCanAccessClinic({ sessionMode: "manager", clinicId: null }, clinicB), true);

const validUpdate = validatePatientUpdates({
  name: "Jane Patient",
  phone: "0501234567",
  email: "jane@example.com",
  date_of_birth: "1990-01-02",
});
assert.deepEqual(validUpdate.value, {
  name: "Jane Patient",
  phone: "0501234567",
  email: "jane@example.com",
  date_of_birth: "1990-01-02",
}, "valid patient update accepted");
assert.ok(validatePatientUpdates({ clinic_id: clinicB }).error, "unexpected clinic field rejected");
assert.ok(validatePatientUpdates({ status: "deleted" }).error, "arbitrary column update rejected");
assert.ok(validatePatientUpdates({ date_of_birth: "02/01/1990" }).error, "invalid date rejected");

const noteCollectionRoute = fs.readFileSync(path.join(repoRoot, "app", "api", "patient-notes", "route.ts"), "utf8");
const noteItemRoute = fs.readFileSync(path.join(repoRoot, "app", "api", "patient-notes", "[noteId]", "route.ts"), "utf8");
const patientRoute = fs.readFileSync(path.join(repoRoot, "app", "api", "patients", "[patientId]", "route.ts"), "utf8");
for (const [name, source] of [
  ["note add", noteCollectionRoute],
  ["note edit/delete", noteItemRoute],
  ["patient edit", patientRoute],
]) {
  assert.match(source, /readAppSession\(supabase\)/, `${name} route requires the app session`);
}
assert.match(noteCollectionRoute, /export async function POST/, "valid add route exists");
assert.match(noteItemRoute, /export async function PATCH/, "valid edit route exists");
assert.match(noteItemRoute, /export async function DELETE/, "valid delete route exists");

const posModals = fs.readFileSync(path.join(repoRoot, "components", "pos-modals.tsx"), "utf8");
assert.doesNotMatch(posModals, /from\("patient_notes"\)\.insert/);
assert.doesNotMatch(posModals, /from\("patient_notes"\)\.delete/);

console.log("patient-mutation-security-tests: all checks passed");
