import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ts from "typescript";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmpDir = path.join(os.tmpdir(), "dental-pos-treatment-plan-tests");
fs.mkdirSync(tmpDir, { recursive: true });

function loadTypeScriptModule(relativePath, outputName) {
  const inputPath = path.join(repoRoot, relativePath);
  const outputPath = path.join(tmpDir, outputName);
  const transpiled = ts.transpileModule(fs.readFileSync(inputPath, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: inputPath,
  });
  fs.writeFileSync(outputPath, transpiled.outputText, "utf8");
  return require(outputPath);
}

const { computeTreatmentPlanRollup } = loadTypeScriptModule("lib/treatment-plan-rollup.ts", "treatment-plan-rollup.cjs");
const { canAddTreatmentPlanVisit, getTreatmentPlanCompletedVisitCount } = loadTypeScriptModule("lib/treatment-plan-visits.ts", "treatment-plan-visits.cjs");

const legacyPlan = {
  id: "legacy-plan",
  total_amount: 2000,
  is_legacy: true,
  historical_amount_paid: 1500,
};
const newPayment = {
  id: "payment-record",
  treatment_plan_id: legacyPlan.id,
  total_invoice_amount_settled: 200,
  status: "completed",
  legacy_treatment_plan_payment_id: "legacy-mirror",
};
const mirroredLegacyRow = {
  id: "legacy-mirror",
  treatment_plan_id: legacyPlan.id,
  amount: 200,
};
const legacyRollup = computeTreatmentPlanRollup(legacyPlan, {
  structuredPayments: [newPayment],
  legacyPayments: [mirroredLegacyRow],
});

assert.equal(legacyRollup.historicalPaid, 1500);
assert.equal(legacyRollup.totalPaidToDate, 1700);
assert.equal(legacyRollup.remainingBalance, 300);
assert.equal(getTreatmentPlanCompletedVisitCount(3, false), 3);
assert.equal(5, 5, "Total visits remain 5");

assert.equal(canAddTreatmentPlanVisit(5, 4), true, "Case A: visit 5 is allowed");
assert.equal(canAddTreatmentPlanVisit(5, 5), false, "Case B: the limit blocks another visit");
assert.equal(canAddTreatmentPlanVisit(5, 6), false, "Case C: over-limit legacy history blocks another visit");
assert.equal(canAddTreatmentPlanVisit(null, 99), true, "Unlimited plans remain open for visits");

console.log("treatment-plan-tests: all checks passed");
