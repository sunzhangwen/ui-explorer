import test from "node:test";
import assert from "node:assert/strict";
import { validateTableExportSaveRequest } from "./tableExportRequest.js";

test("accepts text table export requests with the matching payload", () => {
  const result = validateTableExportSaveRequest({
    format: "csv",
    content: "Name\r\nAlpha",
    suggestedBaseName: "metrics"
  });

  assert.equal(result.ok, true);
  assert.equal(result.ok ? result.request.format : null, "csv");
});

test("accepts rectangular non-empty Excel table requests", () => {
  const result = validateTableExportSaveRequest({
    format: "xlsx",
    table: {
      caption: "Metrics",
      headers: ["ID", "Name"],
      rows: [["00123", "Alpha"]]
    },
    suggestedBaseName: "metrics"
  });

  assert.equal(result.ok, true);
  assert.equal(result.ok ? result.request.format : null, "xlsx");
});

test("rejects mismatched text and Excel payload shapes", () => {
  assert.equal(
    validateTableExportSaveRequest({
      format: "xlsx",
      content: "not a workbook table",
      suggestedBaseName: "metrics"
    }).ok,
    false
  );
  assert.equal(
    validateTableExportSaveRequest({
      format: "json",
      table: {
        caption: null,
        headers: ["Name"],
        rows: [["Alpha"]]
      },
      suggestedBaseName: "metrics"
    }).ok,
    false
  );
});

test("rejects empty or non-rectangular Excel ranges", () => {
  const invalidTables = [
    { caption: null, headers: [], rows: [["Alpha"]] },
    { caption: null, headers: ["Name"], rows: [] },
    { caption: null, headers: ["Name", "Status"], rows: [["Alpha"]] },
    { caption: null, headers: ["Name"], rows: [["Alpha"], ["Beta", "Ready"]] }
  ];

  for (const table of invalidTables) {
    assert.equal(
      validateTableExportSaveRequest({
        format: "xlsx",
        table,
        suggestedBaseName: "metrics"
      }).ok,
      false
    );
  }
});

test("rejects non-string Excel cells and invalid base names", () => {
  assert.equal(
    validateTableExportSaveRequest({
      format: "xlsx",
      table: {
        caption: null,
        headers: ["ID"],
        rows: [[123]]
      },
      suggestedBaseName: "metrics"
    }).ok,
    false
  );
  assert.equal(
    validateTableExportSaveRequest({
      format: "markdown",
      content: "| Name |",
      suggestedBaseName: null
    }).ok,
    false
  );
});
