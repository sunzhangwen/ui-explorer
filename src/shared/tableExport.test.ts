import test from "node:test";
import assert from "node:assert/strict";
import { buildAllTableExports, buildTableExport, isTableExportFormat } from "./tableExport.js";
import type { ExtractedTable } from "./tableExtraction.js";

function table(headers: string[], rows: string[][]): ExtractedTable {
  return {
    tableId: "table",
    caption: null,
    headerDepth: 1,
    headers,
    rows,
    records: rows.map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""]))),
    sourceKind: "html",
    confidence: 100,
    confidenceLevel: "high",
    diagnostics: []
  };
}

test("escapes CSV fields with commas quotes and newlines", () => {
  assert.equal(
    buildTableExport(table(["Name"], [['A, "B"\nC']]), "csv"),
    'Name\r\n"A, ""B""\nC"'
  );
});

test("formats JSON records with two-space indentation", () => {
  assert.equal(
    buildTableExport(table(["Name"], [["Alice"]]), "json"),
    '[\n  {\n    "Name": "Alice"\n  }\n]'
  );
});

test("escapes Markdown pipes and line breaks", () => {
  assert.equal(
    buildTableExport(table(["Name"], [["A|B\nC"]]), "markdown"),
    "| Name |\n| --- |\n| A\\|B<br>C |"
  );
});

test("all formats preserve normalized header and row order", () => {
  const source = table(
    ["Team", "Q1 / Selectors", "Q1 / Pass rate"],
    [["Identity", "Migration", "Migration"]]
  );
  const exports = buildAllTableExports(source);

  assert.equal(exports.csv, "Team,Q1 / Selectors,Q1 / Pass rate\r\nIdentity,Migration,Migration");
  assert.deepEqual(JSON.parse(exports.json), [
    { Team: "Identity", "Q1 / Selectors": "Migration", "Q1 / Pass rate": "Migration" }
  ]);
  assert.match(exports.markdown, /\| Identity \| Migration \| Migration \|/);
});

test("recognizes only supported table export formats at runtime", () => {
  assert.equal(isTableExportFormat("csv"), true);
  assert.equal(isTableExportFormat("markdown"), true);
  assert.equal(isTableExportFormat("xlsx"), false);
  assert.equal(isTableExportFormat(null), false);
});
