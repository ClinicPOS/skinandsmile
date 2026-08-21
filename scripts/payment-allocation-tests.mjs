import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import ts from "typescript";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmpDir = path.join(os.tmpdir(), "dental-pos-payment-tests");
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

const moneyTs = path.join(repoRoot, "lib", "money.ts");
const allocationTs = path.join(repoRoot, "lib", "payment-allocation.ts");
const cashDeductionsTs = path.join(repoRoot, "lib", "cash-deductions.ts");
const receiptsReportingTs = path.join(repoRoot, "lib", "receipts-reporting.ts");
const moneyJs = path.join(tmpDir, "money.js");
const allocationJs = path.join(tmpDir, "payment-allocation.js");
const cashDeductionsJs = path.join(tmpDir, "cash-deductions.js");
const receiptsReportingJs = path.join(tmpDir, "receipts-reporting.js");
transpileTsToCjs(moneyTs, moneyJs);
transpileTsToCjs(allocationTs, allocationJs);
transpileTsToCjs(cashDeductionsTs, cashDeductionsJs);
transpileTsToCjs(receiptsReportingTs, receiptsReportingJs);

const {
  buildPaymentAllocations,
  validatePaymentAllocations,
  paymentSummaryLabel,
} = require(allocationJs);
const {
  getPaymentBreakdownForReporting,
  summarizeStoredAllocationRowsForReporting,
  summarizeStoredAllocationCollectionsForReporting,
} = require(receiptsReportingJs);

function draft(id, methodVariant, amount, providerReferenceNumber = "") {
  return {
    id,
    methodVariant,
    invoiceAllocationAmountInput: amount,
    providerReferenceNumber,
    terminalAuthorizationCode: "",
    cardNetwork: "",
  };
}

// Cash-only payment
{
  const rows = buildPaymentAllocations([draft("r1", "cash", "300.00")], 300, 300, 0);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].feeAmount, 0);
  assert.equal(rows[0].customerChargedAmount, 300);
}

// Card-only payment
{
  const rows = buildPaymentAllocations([draft("r1", "card", "300.00")], 300, 300, 0);
  assert.equal(rows[0].feeAmount, 0);
  assert.equal(rows[0].customerChargedAmount, 300);
}

// Bank transfer is a normal paid method: no fee and no provider reference.
{
  const rows = buildPaymentAllocations([draft("r1", "bank_transfer", "300.00")], 300, 300, 0);
  assert.equal(rows[0].methodGroup, "bank_transfer");
  assert.equal(rows[0].feeAmount, 0);
  assert.equal(rows[0].customerChargedAmount, 300);
  assert.equal(paymentSummaryLabel(rows), "Bank Transfer");
  assert.ok(!validatePaymentAllocations([draft("r1", "bank_transfer", "300.00")], 300).some((e) => e.code === "missing_reference"));
}

// Structured reports keep bank transfers separate from Card and Legacy.
{
  const storedRow = {
    method_variant: "bank_transfer",
    invoice_allocation_amount: 300,
    customer_charged_amount: 300,
    fee_amount: 0,
    provider_reference_number: null,
  };
  const rowSummary = summarizeStoredAllocationRowsForReporting([storedRow]);
  const collectionSummary = summarizeStoredAllocationCollectionsForReporting([storedRow]);
  assert.equal(rowSummary.breakdown.bankTransfer, 300);
  assert.equal(rowSummary.breakdown.legacyUnallocated, 0);
  assert.equal(collectionSummary.bankTransfer, 300);
  assert.equal(collectionSummary.legacyUnallocated, 0);
  assert.equal(getPaymentBreakdownForReporting("bank_transfer", 300).bankTransfer, 300);
}

// Tabby-only payment
{
  const rows = buildPaymentAllocations([draft("r1", "tabby_standard", "300.00", "TB123")], 300, 300, 0);
  assert.equal(rows[0].feeAmount, 22.5);
  assert.equal(rows[0].customerChargedAmount, 322.5);
}

// Tabby card payment variant
{
  const rows = buildPaymentAllocations([draft("r1", "tabby_card", "300.00", "TB-CARD-1")], 300, 300, 0);
  assert.equal(rows[0].methodVariant, "tabby_card");
  assert.equal(rows[0].feeAmount, 22.5);
}

// Tamara-only payment
{
  const rows = buildPaymentAllocations([draft("r1", "tamara", "300.00", "TM1")], 300, 300, 0);
  assert.equal(rows[0].feeAmount, 22.5);
}

// Non-aesthetic: AED 100 cash + AED 200 tabby => AED 315 total customer charge
{
  const rows = buildPaymentAllocations(
    [draft("r1", "cash", "100.00"), draft("r2", "tabby_standard", "200.00", "TB2")],
    300,
    300,
    0
  );
  const invoice = rows.reduce((s, r) => s + r.invoiceAllocationAmount, 0);
  const fee = rows.reduce((s, r) => s + r.feeAmount, 0);
  const charged = rows.reduce((s, r) => s + r.customerChargedAmount, 0);
  assert.equal(invoice, 300);
  assert.equal(fee, 15);
  assert.equal(charged, 315);
}

// Aesthetic: 200 net + 10 VAT, Tabby fee = 15.75, charged = 225.75
{
  const rows = buildPaymentAllocations([draft("r1", "tabby_standard", "210.00", "TB3")], 210, 210, 10);
  assert.equal(rows[0].vatAmount, 10);
  assert.equal(rows[0].feeAmount, 15.75);
  assert.equal(rows[0].customerChargedAmount, 225.75);
}

// More than two allocations support
{
  const rows = buildPaymentAllocations(
    [
      draft("r1", "cash", "100.00"),
      draft("r2", "card", "100.00"),
      draft("r3", "tabby_standard", "100.00", "TB4"),
    ],
    300,
    300,
    0
  );
  assert.equal(rows.length, 3);
  assert.equal(paymentSummaryLabel(rows), "Cash + Card + Tabby");
}

// Underallocation validation
{
  const errors = validatePaymentAllocations([draft("r1", "cash", "90.00")], 100);
  assert.ok(errors.some((e) => e.code === "remaining_amount"));
}

// Overallocation validation
{
  const errors = validatePaymentAllocations([draft("r1", "cash", "110.00")], 100);
  assert.ok(errors.some((e) => e.code === "overallocation"));
}

// Missing provider reference validation
{
  const errors = validatePaymentAllocations([draft("r1", "tabby_standard", "100.00", "")], 100);
  assert.ok(errors.some((e) => e.code === "missing_reference"));
}

// Duplicate provider reference validation
{
  const errors = validatePaymentAllocations(
    [draft("r1", "tabby_standard", "50.00", "REF-1"), draft("r2", "tabby_card", "50.00", "REF 1")],
    100
  );
  assert.ok(errors.some((e) => e.code === "duplicate_reference"));
}

// Recursive-fee prevention check (fee on 200 allocation stays 15, never on 215)
{
  const rows = buildPaymentAllocations([draft("r1", "tabby_standard", "200.00", "TB5")], 200, 300, 0);
  assert.equal(rows[0].feeAmount, 15);
  assert.equal(rows[0].customerChargedAmount, 215);
}

console.log("payment-allocation-tests: all checks passed");
