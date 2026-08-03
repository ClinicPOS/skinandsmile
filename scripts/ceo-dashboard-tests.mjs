import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ts from "typescript";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmpDir = path.join(os.tmpdir(), "dental-pos-ceo-dashboard-tests");
fs.mkdirSync(tmpDir, { recursive: true });

function transpileTsToCjs(inputPath, outputPath) {
  const source = fs.readFileSync(inputPath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: inputPath,
  });
  fs.writeFileSync(outputPath, transpiled.outputText, "utf8");
}

const sourceTs = path.join(repoRoot, "lib", "ceo-dashboard.ts");
const outputJs = path.join(tmpDir, "ceo-dashboard.js");
transpileTsToCjs(sourceTs, outputJs);

const {
  buildDashboardRange,
  buildComparisonRange,
  statusFromTarget,
  percentageChange,
} = require(outputJs);

// Default today range + previous day.
{
  const now = new Date("2026-08-03T08:00:00.000Z"); // 12:00 Dubai
  const current = buildDashboardRange({ period: "today", now });
  const compare = buildComparisonRange(current);
  assert.equal(current.period, "today");
  assert.equal(compare.label, "Yesterday");
}

// This week and previous week.
{
  const now = new Date("2026-08-05T10:00:00.000Z");
  const current = buildDashboardRange({ period: "this_week", now });
  const compare = buildComparisonRange(current);
  assert.equal(compare.label, "Previous week");
}

// This month and previous month.
{
  const now = new Date("2026-08-20T10:00:00.000Z");
  const current = buildDashboardRange({ period: "this_month", now });
  const compare = buildComparisonRange(current);
  assert.ok(compare.label.includes("Previous month"));
}

// Custom range and preceding equal-length range.
{
  const current = buildDashboardRange({
    period: "custom",
    customStart: "2026-08-01",
    customEnd: "2026-08-10",
  });
  const compare = buildComparisonRange(current);
  assert.equal(compare.label, "Previous equivalent range");
}

// Clinic status thresholds.
{
  assert.equal(statusFromTarget(105), "good");
  assert.equal(statusFromTarget(80), "average");
  assert.equal(statusFromTarget(79.99), "needs_attention");
  assert.equal(statusFromTarget(null), "no_target_set");
}

// Percentage change behavior.
{
  assert.equal(percentageChange(120, 100), 20);
  assert.equal(percentageChange(80, 100), -20);
  assert.equal(percentageChange(0, 0), 0);
  assert.equal(percentageChange(50, 0), null);
}

console.log("ceo-dashboard-tests: all checks passed");
