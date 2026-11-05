import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import os from 'node:os';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import ts from 'typescript';
import XLSX from 'xlsx-js-style';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';

// Check raw ZIP headers before a parser has a chance to hide duplicate entries.
async function assertUniqueArchive(bytes) {
  const zip = Buffer.from(bytes);
  const end = zip.length - 22; // The exporter writes no ZIP comment.
  assert.equal(zip.readUInt32LE(end), 0x06054b50);
  const count = zip.readUInt16LE(end + 10);
  const centralOffset = zip.readUInt32LE(end + 16);
  const paths = [], offsets = [];
  let cursor = centralOffset;
  for (let i = 0; i < count; i++) {
    assert.equal(zip.readUInt32LE(cursor), 0x02014b50);
    const length = zip.readUInt16LE(cursor + 28);
    const name = zip.toString('utf8', cursor + 46, cursor + 46 + length);
    const local = zip.readUInt32LE(cursor + 42);
    assert.equal(zip.readUInt32LE(local), 0x04034b50);
    const localLength = zip.readUInt16LE(local + 26);
    assert.equal(zip.toString('utf8', local + 30, local + 30 + localLength), name);
    assert.equal(zip.readUInt32LE(local + 14), zip.readUInt32LE(cursor + 16), 'CRC headers agree');
    paths.push(name); offsets.push(local);
    cursor += 46 + length + zip.readUInt16LE(cursor + 30) + zip.readUInt16LE(cursor + 32);
  }
  assert.equal(cursor, end);
  assert.equal(new Set(paths).size, count, 'XLSX archive paths must be unique');
  assert.equal(new Set(offsets).size, count, 'Each entry must have its own local header');
  // Walk local headers too, catching orphan entries omitted from the directory.
  cursor = 0;
  for (const offset of [...offsets].sort((a, b) => a - b)) {
    assert.equal(offset, cursor);
    assert.equal(zip.readUInt16LE(cursor + 6) & 8, 0, 'No deferred ZIP sizes');
    cursor += 30 + zip.readUInt16LE(cursor + 26) + zip.readUInt16LE(cursor + 28) + zip.readUInt32LE(cursor + 18);
  }
  assert.equal(cursor, centralOffset);
  await JSZip.loadAsync(bytes, { checkCRC32: true });
}

const require = createRequire(import.meta.url);
function loadModule(filename, environment = {}, cache = new Map()) {
  const resolved = path.resolve(filename);
  if (cache.has(resolved)) return cache.get(resolved);
  const exports = {};
  cache.set(resolved, exports);
  const source = fs.readFileSync(resolved, 'utf8');
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports, performance, console, URLSearchParams, Response, TextEncoder, TextDecoder,
    Uint8Array, Blob, URL, document: {}, setTimeout, ...environment,
    require(name) {
      if (name === 'server-only') return {};
      if (name.startsWith('.')) return loadModule(path.resolve(path.dirname(resolved), name + '.ts'), environment, cache);
      return require(name);
    },
  }, { filename: resolved });
  return exports;
}

const clinic = 'clinic-a', day = '2026-11-02';
const now = new Date(`${day}T08:00:00Z`);
const name = 'Expenses & Commissions';
const receptionistRows = [{ id: 'receptionist-a', name: 'Test Receptionist', clinic_id: clinic }];
const deduction = (id, type, amount, fields = {}) => ({
  id, type, amount, clinic_id: clinic, business_date: day, status: 'active',
  created_at: '2026-11-01T20:15:00Z', created_by: 'receptionist-a',
  description: type === 'expense' ? 'Water' : 'Referral commission',
  paid_to_name: type === 'commission' ? 'Kim' : 'Water Supplier', reference_number: `REF-${id}`,
  ...fields,
});
const water = deduction('water', 'expense', 100);
const kim = deduction('kim', 'commission', 120);
const excluded = [
  deduction('voided', 'expense', 999, { status: 'voided' }),
  deduction('foreign', 'commission', 888, { clinic_id: 'clinic-b' }),
  deduction('yesterday', 'expense', 777, { business_date: '2026-11-01' }),
  deduction('tomorrow', 'commission', 666, { business_date: '2026-11-03' }),
];

function context(deductions) {
  const calls = [];
  return {
    calls,
    activeClinic: { id: clinic, name: 'Fictional Test Clinic' }, now,
    loadClinicHistoryPatients: async () => [],
    fetch: async (url) => {
      if (url.startsWith('/api/workspace/eod?')) return Response.json({ pending: [], changes: [] });
      if (url === '/api/patients/report-details') return Response.json({ patients: [], fileNumbers: [] });
      throw Error(`Unexpected request: ${url}`);
    },
    supabase: { from(table) {
      const call = { table, filters: [] }; calls.push(call);
      const data = table === 'receptionist' ? receptionistRows
        : table === 'cash_deductions' ? deductions
        : table === 'balance_payments' ? [{ clinic_id: clinic, amount: 1000, payment_method: 'cash', created_at: `${day}T08:00:00Z`, status: 'active' }] : [];
      const query = {
        select() { return query; }, order() { return query; },
        eq(key, value) { call.filters.push([key, value]); return query; },
        neq(key, value) { call.filters.push([key, value, 'neq']); return query; },
        gte() { return query; }, lte() { return query; }, gt() { return query; },
        is() { return query; }, or() { return query; }, in() { return query; },
        then(resolve) {
          return Promise.resolve({ data: data.filter(row => call.filters.every(([key, value, op]) => op === 'neq' ? row[key] !== value : row[key] === value)), error: null }).then(resolve);
        },
      };
      return query;
    } },
  };
}

const { buildEodWorkbook } = loadModule('lib/eod-workbook.ts');
let downloadedBlob, downloadedName, revokedUrl;
const link = { click() { downloadedName = link.download; assert.equal(link.href, 'blob:test'); } };
const { encodeEodExcel, downloadEodExcel } = loadModule('lib/eod-excel-download.ts', {
  document: { createElement(tag) { assert.equal(tag, 'a'); return link; } },
  URL: { createObjectURL(blob) { downloadedBlob = blob; return 'blob:test'; }, revokeObjectURL(url) { revokedUrl = url; } },
  setTimeout(callback) { callback(); },
});
const emptyContext = context(excluded);
const emptyReport = await buildEodWorkbook(emptyContext);
const rows = (wb, sheet) => XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, defval: '' });
const value = (data, label, col = 1) => data.find(row => row[0] === label)?.[col];

for (const [scenario, active, expenses, commissions] of [
  ['Water 100 / Kim 120', [water, kim], 100, 120],
  ['multiple entries', [water, kim, deduction('extra-water', 'expense', 3.45, { created_by: 'foreign-receptionist', created_by_name: 'Must not trust this name' }), deduction('extra-kim', 'commission', 6.55, { created_by: null })], 103.45, 126.55],
  ['zero entries', [], 0, 0],
  ['voided entries only', [excluded[0]], 0, 0],
]) {
  const source = [...active, ...excluded];
  const before = JSON.stringify(source);
  const ctx = context(source);
  const result = await buildEodWorkbook(ctx);
  assert.equal(JSON.stringify(source), before, 'Source records must not be changed');
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.calls)), JSON.parse(JSON.stringify(emptyContext.calls)), 'Deduction detail must require no extra queries');
  const deductionCalls = ctx.calls.filter(call => call.table === 'cash_deductions');
  assert.equal(deductionCalls.length, 1);
  assert.deepEqual(deductionCalls[0].filters, [['clinic_id', clinic], ['business_date', day], ['status', 'active']]);
  assert.equal(ctx.calls.filter(call => call.table === 'receptionist').length, 1);
  assert.equal(result.fileName, emptyReport.fileName);
  assert.deepEqual(result.workbook.SheetNames.filter(sheet => sheet !== name), ['Daily Summary', 'Transaction Details', 'Treatment Plans', 'Treatment Plan Payments', 'Pending Approvals']);
  for (const sheet of emptyReport.workbook.SheetNames.filter(sheet => ![name, 'Daily Summary'].includes(sheet))) {
    assert.equal(JSON.stringify(result.workbook.Sheets[sheet]), JSON.stringify(emptyReport.workbook.Sheets[sheet]), `Unrelated sheet preserved: ${sheet}`);
  }

  const data = rows(result.workbook, name);
  const summary = rows(result.workbook, 'Daily Summary');
  const total = expenses + commissions;
  assert.equal(value(data, 'Total Expenses', 5), expenses);
  assert.equal(value(data, 'Total Commissions', 5), commissions);
  assert.equal(value(data, 'Combined Deductions', 5), total);
  assert.equal(value(summary, 'Expenses'), expenses);
  assert.equal(value(summary, 'Commissions'), commissions);
  assert.equal(value(summary, 'NET MONEY COLLECTED'), 1000);
  assert.equal(value(summary, 'FINAL COLLECTION AFTER DEDUCTIONS'), 1000 - total, 'Deduct exactly once');
  assert.equal(value(summary, 'EXPECTED CASH AFTER DEDUCTIONS'), 1000 - total);
  const expectedActive = active.filter(row => row.status === 'active');
  assert.equal(data.filter(row => row[7] === 'active').length, expectedActive.length);
  for (const entry of expectedActive) {
    const row = data.find(row => row[4] === entry.reference_number);
    assert.ok(row);
    assert.equal(row[0], '02/11/2026, 00:15:00', 'Dubai date rolls over from preceding UTC date');
    assert.equal(row[1], entry.type === 'expense' ? 'Expense' : 'Commission');
    assert.equal(row[2], entry.description);
    assert.equal(row[3], entry.paid_to_name);
    assert.equal(row[5], entry.amount);
    assert.equal(row[6], entry.created_by === 'receptionist-a' ? 'Test Receptionist' : 'Unknown / unavailable');
  }
  for (const entry of excluded) assert.ok(!data.some(row => row[4] === entry.reference_number));
  if (!expectedActive.length) assert.match(data[1][0], /No active expenses or commissions/);
  const sheet = result.workbook.Sheets[name];
  assert.equal(sheet['!autofilter'].ref, `A1:H${Math.max(2, expectedActive.length + 1)}`);
  const details = result.workbook.Sheets['Transaction Details'];
  assert.deepEqual(sheet.A1.s, details.A1.s, 'Header matches Transaction Details');
  const totalCell = sheet[`F${data.length}`];
  assert.deepEqual(totalCell.s.fill, details.A3.s.fill, 'Totals use the existing yellow');
  assert.deepEqual(totalCell.s.font, details.A3.s.font);
  assert.deepEqual(sheet.F2.s.border, details.I2.s.border);
  assert.deepEqual(sheet.F2.s.font, details.I2.s.font);
  assert.equal(sheet.F2.s.fill.fgColor.rgb, 'F8FAFC');
  assert.equal(sheet.F2.s.alignment.horizontal, 'right');

  // Exercise the JSON transport used by the server, then the real browser encoder.
  const transported = JSON.parse(JSON.stringify(result.workbook));
  const standardBytes = XLSX.write(JSON.parse(JSON.stringify(transported)), { type: 'buffer', bookType: 'xlsx' });
  const standardExport = XLSX.read(standardBytes);
  const bytes = encodeEodExcel(transported);
  await assertUniqueArchive(bytes);
  const standardZip = XLSX.CFB.read(standardBytes, { type: 'buffer' });
  const frozenZip = XLSX.CFB.read(bytes, { type: 'buffer' });
  const newSheetPath = `/xl/worksheets/sheet${transported.SheetNames.indexOf(name) + 1}.xml`;
  const stripViews = content => Buffer.from(content).toString('utf8').replace(/<sheetViews>[\s\S]*?<\/sheetViews>/, '');
  assert.equal(stripViews(XLSX.CFB.find(frozenZip, newSheetPath).content), stripViews(XLSX.CFB.find(standardZip, newSheetPath).content), 'Only sheetViews changes in the patched worksheet');
  for (const filePath of standardZip.FullPaths.filter(p => p.endsWith('.xml') || p.endsWith('.rels'))) {
    if (filePath.endsWith(newSheetPath)) continue;
    assert.ok(Buffer.from(XLSX.CFB.find(frozenZip, filePath).content).equals(Buffer.from(XLSX.CFB.find(standardZip, filePath).content)), `Frozen header must preserve existing Excel content: ${filePath}`);
  }
  downloadEodExcel(transported, result.fileName);
  assert.equal(downloadedName, result.fileName);
  assert.equal(revokedUrl, 'blob:test');
  assert.equal(downloadedBlob.type, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.deepEqual(rows(XLSX.read(await downloadedBlob.arrayBuffer()), name), data);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'eod-deductions-'));
  try {
    const filename = path.join(temp, 'EOD.xlsx');
    fs.writeFileSync(filename, bytes);
    const restored = XLSX.readFile(filename, { cellStyles: true, cellNF: true });
    assert.deepEqual(restored.SheetNames, result.workbook.SheetNames);
    for (const sheetName of restored.SheetNames) assert.deepEqual(rows(restored, sheetName), rows(standardExport, sheetName));
    assert.deepEqual(rows(restored, name), data, 'New detail and numeric totals survive XLSX round-trip');
    const excel = new ExcelJS.Workbook();
    await excel.xlsx.readFile(filename);
    const savedSheet = excel.getWorksheet(name);
    assert.equal(savedSheet.views[0].state, 'frozen');
    assert.equal(savedSheet.views[0].ySplit, 1);
    assert.equal(savedSheet.views[0].topLeftCell, 'A2');
    assert.equal(savedSheet.getCell('A1').fill.fgColor.argb.slice(-6), '1F4E78');
    assert.equal(savedSheet.getCell(`F${data.length}`).fill.fgColor.argb.slice(-6), 'FFF2CC');
    assert.equal(savedSheet.getCell('F2').font.size, 10);
    assert.ok(savedSheet.getColumn(3).width >= 46);
    assert.equal(savedSheet.autoFilter, sheet['!autofilter'].ref);
    assert.match(savedSheet.getCell(`F${data.length}`).numFmt, /AED/);
    if (expectedActive.length) assert.match(savedSheet.getCell('F2').numFmt, /AED/);
    if (process.env.EOD_TEST_OUTPUT && scenario === 'Water 100 / Kim 120') {
      fs.mkdirSync(process.env.EOD_TEST_OUTPUT, { recursive: true });
      fs.writeFileSync(path.join(process.env.EOD_TEST_OUTPUT, 'EOD-test.xlsx'), bytes);
    }
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
  console.log(`PASS: ${scenario}; clinic/date/active scope, totals, no double deduction, existing sheets, no new reads, XLSX round-trip and frozen header.`);
}

// Locate by sheet name rather than assuming sheet3, and preserve formulas verbatim.
for (const sheetNames of [[name], ['Other', name], ['Other']]) {
  const workbook = XLSX.utils.book_new();
  for (const sheetName of sheetNames) {
    const sheet = XLSX.utils.aoa_to_sheet([['Amount'], [12.34], [0]]);
    sheet.A3 = { t: 'n', f: 'SUM(A2:A2)', v: 12.34 };
    XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
  }
  const bytes = encodeEodExcel(workbook);
  await assertUniqueArchive(bytes);
  const restored = XLSX.read(bytes);
  assert.deepEqual(restored.SheetNames, sheetNames);
  for (const sheetName of sheetNames) assert.equal(restored.Sheets[sheetName].A3.f, 'SUM(A2:A2)');
  await assertUniqueArchive(encodeEodExcel(JSON.parse(JSON.stringify(workbook))));
}

// Verify the browser download uses the encoded file and retains the server filename.
const source = fs.readFileSync('app/receipts/page.tsx', 'utf8');
assert.match(source, /downloadEodExcel\(report\.workbook, report\.fileName\)/);
assert.equal(typeof downloadEodExcel, 'function');
