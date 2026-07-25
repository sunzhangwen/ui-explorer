import test from "node:test";
import assert from "node:assert/strict";
import { extractTableForSelection } from "./tableExtraction.js";
import type { ElementSnapshot } from "./ipc.js";

function element(
  id: string,
  tagName: string,
  children: ElementSnapshot[] = [],
  options: {
    attributes?: Record<string, string>;
    text?: string;
  } = {}
): ElementSnapshot {
  const node: ElementSnapshot = {
    id,
    depth: 0,
    nodeType: 1,
    nodeName: tagName.toUpperCase(),
    tagName,
    text: options.text ?? "",
    attributes: options.attributes ?? {},
    childIds: children.map((child) => child.id),
    children
  };

  for (const child of children) {
    child.parentId = id;
  }
  return node;
}

function cell(
  id: string,
  tagName: "th" | "td",
  text: string,
  attributes: Record<string, string> = {},
  children: ElementSnapshot[] = []
): ElementSnapshot {
  return element(id, tagName, children, { text, attributes });
}

function tableFixture(): ElementSnapshot {
  const head = element("thead", "thead", [
    element("head-1", "tr", [
      cell("team", "th", "Team", { rowspan: "2" }),
      cell("q1", "th", "Q1", { colspan: "2" }),
      cell("q2", "th", "Q2", { colspan: "2" })
    ]),
    element("head-2", "tr", [
      cell("q1-selectors", "th", "Selectors"),
      cell("q1-rate", "th", "Pass rate"),
      cell("q2-selectors", "th", "Selectors"),
      cell("q2-rate", "th", "Pass rate")
    ])
  ]);
  const body = element("tbody", "tbody", [
    element("payments-row", "tr", [
      cell("payments", "th", "Payments"),
      cell("payments-q1-selectors", "td", "148"),
      cell("payments-q1-rate", "td", "97%"),
      cell("payments-q2-selectors", "td", "164"),
      cell("payments-q2-rate", "td", "98%")
    ]),
    element("identity-row", "tr", [
      cell("identity", "th", "Identity"),
      cell("migration", "td", "Migration", { colspan: "2" }),
      cell("identity-q2-selectors", "td", "91"),
      cell("identity-q2-rate", "td", "95%")
    ])
  ]);
  const table = element("table", "table", [head, body], {
    attributes: { "aria-label": "Quarterly automation metrics" }
  });
  return element("root", "main", [element("section", "section", [table])]);
}

test("expands grouped headers and merged body cells", () => {
  const result = extractTableForSelection(tableFixture(), "migration");

  assert.deepEqual(result?.headers, [
    "Team",
    "Q1 / Selectors",
    "Q1 / Pass rate",
    "Q2 / Selectors",
    "Q2 / Pass rate"
  ]);
  assert.deepEqual(result?.rows[1], ["Identity", "Migration", "Migration", "91", "95%"]);
  assert.deepEqual(result?.records[1], {
    Team: "Identity",
    "Q1 / Selectors": "Migration",
    "Q1 / Pass rate": "Migration",
    "Q2 / Selectors": "91",
    "Q2 / Pass rate": "95%"
  });
});

test("selecting a descendant resolves the nearest table", () => {
  const descendant = element("migration-label", "strong", [], { text: "Migration" });
  const root = tableFixture();
  const migration = findById(root, "migration");
  migration?.children.push(descendant);
  if (migration) {
    migration.childIds.push(descendant.id);
    descendant.parentId = migration.id;
  }

  assert.equal(extractTableForSelection(root, descendant.id)?.tableId, "table");
});

test("infers leading th-only rows when thead is absent", () => {
  const table = element("plain", "table", [
    element("header", "tr", [cell("h1", "th", "Name"), cell("h2", "th", "Value")]),
    element("data", "tr", [cell("d1", "td", "Alpha"), cell("d2", "td", "1")])
  ]);

  const result = extractTableForSelection(table, "plain");
  assert.deepEqual(result?.headers, ["Name", "Value"]);
  assert.deepEqual(result?.rows, [["Alpha", "1"]]);
});

test("creates unique synthetic headers and pads irregular rows", () => {
  const table = element("plain", "table", [
    element("row-1", "tr", [cell("a", "td", "A"), cell("b", "td", "B")]),
    element("row-2", "tr", [cell("c", "td", "C")])
  ]);

  const result = extractTableForSelection(table, "plain");
  assert.deepEqual(result?.headers, ["Column 1", "Column 2"]);
  assert.deepEqual(result?.rows, [["A", "B"], ["C", ""]]);
});

test("deduplicates empty and repeated flattened headers", () => {
  const table = element("plain", "table", [
    element("header", "tr", [cell("h1", "th", "Name"), cell("h2", "th", "Name"), cell("h3", "th", "")]),
    element("data", "tr", [cell("d1", "td", "A"), cell("d2", "td", "B"), cell("d3", "td", "C")])
  ]);

  assert.deepEqual(extractTableForSelection(table, "plain")?.headers, ["Name", "Name 2", "Column 3"]);
});

test("does not include nested table rows or text in the outer table", () => {
  const nested = element("nested", "table", [
    element("nested-row", "tr", [cell("nested-cell", "td", "Nested value")])
  ]);
  const wrapper = element("wrapper", "span", [nested], { text: "Outer value Nested value" });
  const table = element("outer", "table", [
    element("header", "tr", [cell("h1", "th", "Name")]),
    element("data", "tr", [cell("outer-cell", "td", "Outer value Nested value", {}, [wrapper])])
  ]);

  assert.deepEqual(extractTableForSelection(table, "outer")?.rows, [["Outer value"]]);
});

test("returns null when the selected element is outside a table", () => {
  assert.equal(extractTableForSelection(element("root", "main"), "root"), null);
});

function findById(root: ElementSnapshot, id: string): ElementSnapshot | null {
  if (root.id === id) return root;
  for (const child of root.children) {
    const match = findById(child, id);
    if (match) return match;
  }
  return null;
}
