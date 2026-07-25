import test from "node:test";
import assert from "node:assert/strict";
import {
  getTableFileOptions,
  prepareTableFileContent,
  sanitizeTableExportBaseName
} from "./tableFile.js";

test("maps table formats to fixed extensions and filters", () => {
  assert.deepEqual(getTableFileOptions("csv"), {
    extension: "csv",
    label: "CSV"
  });
  assert.equal(getTableFileOptions("json").extension, "json");
  assert.equal(getTableFileOptions("markdown").extension, "md");
});

test("adds a UTF-8 BOM only to saved CSV payloads", () => {
  assert.equal(prepareTableFileContent("csv", "A\r\n中文"), "\uFEFFA\r\n中文");
  assert.equal(prepareTableFileContent("json", "[]"), "[]");
  assert.equal(prepareTableFileContent("markdown", "| A |"), "| A |");
});

test("sanitizes suggested file names without allowing path components", () => {
  assert.equal(sanitizeTableExportBaseName(' Quarterly: "Metrics" '), "Quarterly- -Metrics-");
  assert.equal(sanitizeTableExportBaseName("../"), "table-export");
});
