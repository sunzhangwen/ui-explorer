import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import {
  buildTableWorkbookBuffer,
  sanitizeWorksheetName
} from "./tableWorkbook.js";

test("builds a usable workbook while preserving extracted strings", async () => {
  const buffer = await buildTableWorkbookBuffer({
    caption: "Metrics",
    headers: ["ID", "Name"],
    rows: [
      ["00123", "Alpha"],
      ["99999999999999999999", "Beta"]
    ]
  });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]
  );
  const worksheet = workbook.worksheets[0];

  assert.equal(worksheet?.name, "Metrics");
  assert.equal(worksheet?.getCell("A2").value, "00123");
  assert.equal(worksheet?.getCell("A3").value, "99999999999999999999");
  assert.equal(worksheet?.views[0]?.state, "frozen");
  assert.equal(worksheet?.views[0]?.ySplit, 1);
  assert.equal(worksheet?.autoFilter, "A1:B3");
  assert.equal(worksheet?.getRow(1).font.bold, true);
  assert.deepEqual(worksheet?.getRow(1).fill, {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF1F6FEB" }
  });
});

test("sanitizes worksheet names and applies a stable fallback", () => {
  assert.equal(sanitizeWorksheetName("  Sales:/\\?*[]  "), "Sales");
  assert.equal(sanitizeWorksheetName("[]:*?/\\"), "Table");
  assert.equal(sanitizeWorksheetName("A".repeat(40)), "A".repeat(31));
  assert.equal(sanitizeWorksheetName(null), "Table");
});

test("clamps workbook column widths to the usable range", async () => {
  const buffer = await buildTableWorkbookBuffer({
    caption: null,
    headers: ["A", "Description"],
    rows: [["x", "y".repeat(100)]]
  });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]
  );
  const worksheet = workbook.worksheets[0];

  assert.equal(worksheet?.getColumn(1).width, 12);
  assert.equal(worksheet?.getColumn(2).width, 48);
});
