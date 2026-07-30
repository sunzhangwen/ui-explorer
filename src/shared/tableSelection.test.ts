import test from "node:test";
import assert from "node:assert/strict";
import type { ExtractedTable } from "./tableExtraction.js";
import {
  applyTableSelection,
  createFullTableSelection
} from "./tableSelection.js";

function table(): ExtractedTable {
  return {
    tableId: "metrics",
    caption: "Metrics",
    headerDepth: 1,
    headers: ["Name", "Status", "ID"],
    rows: [
      ["Alpha", "Ready", "001"],
      ["Beta", "Blocked", "002"],
      ["Gamma", "Ready", "003"]
    ],
    records: [
      { Name: "Alpha", Status: "Ready", ID: "001" },
      { Name: "Beta", Status: "Blocked", ID: "002" },
      { Name: "Gamma", Status: "Ready", ID: "003" }
    ],
    sourceKind: "css-grid",
    confidence: 72,
    confidenceLevel: "medium",
    diagnostics: [{
      code: "missing-semantics",
      kind: "warning",
      messageKey: "table.diagnostic.missingSemantics",
      detail: "No table roles",
      scoreDelta: -15
    }]
  };
}

test("table selection defaults to every source row and column", () => {
  assert.deepEqual(createFullTableSelection(table()), {
    rowIndexes: [0, 1, 2],
    columnIndexes: [0, 1, 2]
  });
});

test("table selection removes duplicates and invalid indexes while preserving source order", () => {
  const selected = applyTableSelection(table(), {
    rowIndexes: [2, 1, 1, 99],
    columnIndexes: [2, 0, 2, -1]
  });

  assert.deepEqual(selected.headers, ["Name", "ID"]);
  assert.deepEqual(selected.rows, [
    ["Beta", "002"],
    ["Gamma", "003"]
  ]);
  assert.deepEqual(selected.records, [
    { Name: "Beta", ID: "002" },
    { Name: "Gamma", ID: "003" }
  ]);
});

test("table selection preserves extraction identity and confidence metadata", () => {
  const source = table();
  const selected = applyTableSelection(source, {
    rowIndexes: [0],
    columnIndexes: [1]
  });

  assert.deepEqual(
    {
      tableId: selected.tableId,
      caption: selected.caption,
      headerDepth: selected.headerDepth,
      sourceKind: selected.sourceKind,
      confidence: selected.confidence,
      confidenceLevel: selected.confidenceLevel,
      diagnostics: selected.diagnostics
    },
    {
      tableId: "metrics",
      caption: "Metrics",
      headerDepth: 1,
      sourceKind: "css-grid",
      confidence: 72,
      confidenceLevel: "medium",
      diagnostics: source.diagnostics
    }
  );
});

test("table selection produces no data rows when either dimension is empty", () => {
  const withoutRows = applyTableSelection(table(), {
    rowIndexes: [],
    columnIndexes: [0, 1]
  });
  const withoutColumns = applyTableSelection(table(), {
    rowIndexes: [0, 1],
    columnIndexes: []
  });

  assert.deepEqual(withoutRows.headers, ["Name", "Status"]);
  assert.deepEqual(withoutRows.rows, []);
  assert.deepEqual(withoutRows.records, []);
  assert.deepEqual(withoutColumns.headers, []);
  assert.deepEqual(withoutColumns.rows, []);
  assert.deepEqual(withoutColumns.records, []);
});
