import test from "node:test";
import assert from "node:assert/strict";
import type { ElementLayoutSnapshot, ElementNodeKind, ElementSnapshot } from "./ipc.js";
import { extractTableForSelection } from "./tableExtraction.js";
import {
  extractPseudoTableForSelection,
  getConfidenceLevel
} from "./pseudoTableExtraction.js";

type NodeOptions = {
  role?: string;
  text?: string;
  kind?: ElementNodeKind;
  layout?: Partial<ElementLayoutSnapshot>;
  box?: { x: number; y: number; width: number; height: number };
};

function node(
  id: string,
  children: ElementSnapshot[] = [],
  options: NodeOptions = {}
): ElementSnapshot {
  const result: ElementSnapshot = {
    id,
    depth: 0,
    nodeType: 1,
    nodeName: "DIV",
    tagName: "div",
    text: options.text ?? "",
    role: options.role,
    kind: options.kind ?? "element",
    visible: true,
    boundingBox: options.box,
    layout: options.layout
      ? {
          display: options.layout.display ?? "block",
          flexDirection: options.layout.flexDirection ?? "row",
          gridTemplateColumns: options.layout.gridTemplateColumns ?? "none",
          rowGap: options.layout.rowGap ?? "0px",
          columnGap: options.layout.columnGap ?? "0px"
        }
      : undefined,
    attributes: {},
    childIds: children.map((child) => child.id),
    children
  };
  for (const child of children) {
    child.parentId = id;
  }
  return result;
}

function cells(
  row: number,
  values: string[],
  header = false
): ElementSnapshot[] {
  return values.map((value, column) =>
    node(`r${row}c${column}`, [], {
      role: header ? "columnheader" : "cell",
      text: value,
      box: { x: column * 120, y: row * 32, width: 112, height: 28 }
    })
  );
}

function directGrid(): ElementSnapshot {
  const allCells = [
    ...cells(0, ["Name", "Status"], true),
    ...cells(1, ["Alpha", "Ready"]),
    ...cells(2, ["Beta", "Blocked"])
  ];
  return node("direct-grid", allCells, {
    role: "table",
    layout: {
      display: "grid",
      gridTemplateColumns: "100px 100px"
    },
    box: { x: 0, y: 0, width: 240, height: 96 }
  });
}

function wrappedGrid(options: { semantic?: boolean; irregular?: boolean } = {}): ElementSnapshot {
  const semantic = options.semantic ?? true;
  const rows = [
    node("header-row", cells(0, ["Name", "Count"], semantic), {
      role: semantic ? "row" : undefined,
      layout: { display: "grid", gridTemplateColumns: "100px 100px" }
    }),
    node("alpha-row", cells(1, ["Alpha", "10"]), {
      role: semantic ? "row" : undefined,
      layout: { display: "grid", gridTemplateColumns: "100px 100px" }
    }),
    node(
      "beta-row",
      cells(2, options.irregular ? ["Beta"] : ["Beta", "20"]),
      {
        role: semantic ? "row" : undefined,
        layout: { display: "grid", gridTemplateColumns: "100px 100px" }
      }
    )
  ];
  return node("wrapped-grid", rows, {
    role: semantic ? "grid" : undefined,
    layout: { display: "grid", gridTemplateColumns: "1fr" }
  });
}

function flexTable(): ElementSnapshot {
  const rows = [
    node("flex-header", cells(0, ["Region", "Owner"], true), {
      role: "row",
      layout: { display: "flex", flexDirection: "row" }
    }),
    node("east-row", cells(1, ["East", "Ana"]), {
      role: "row",
      layout: { display: "flex", flexDirection: "row" }
    }),
    node("west-row", cells(2, ["West", "Bo"]), {
      role: "row",
      layout: { display: "flex", flexDirection: "row" }
    })
  ];
  return node("flex-table", rows, {
    role: "table",
    layout: { display: "flex", flexDirection: "column" }
  });
}

test("extracts a high-confidence pseudo table from direct Grid cells", () => {
  const table = directGrid();
  const result = extractTableForSelection(table, "r2c1");

  assert.equal(result?.sourceKind, "css-grid");
  assert.equal(result?.confidenceLevel, "high");
  assert.ok((result?.confidence ?? 0) >= 80);
  assert.deepEqual(result?.headers, ["Name", "Status"]);
  assert.deepEqual(result?.rows, [
    ["Alpha", "Ready"],
    ["Beta", "Blocked"]
  ]);
});

test("extracts repeated Grid row wrappers", () => {
  const result = extractPseudoTableForSelection(wrappedGrid(), "alpha-row");

  assert.equal(result?.sourceKind, "css-grid");
  assert.equal(result?.confidenceLevel, "high");
  assert.deepEqual(result?.records[1], { Name: "Beta", Count: "20" });
});

test("extracts repeated horizontal rows from a column Flex container", () => {
  const result = extractPseudoTableForSelection(flexTable(), "east-row");

  assert.equal(result?.sourceKind, "flex");
  assert.equal(result?.confidenceLevel, "high");
  assert.deepEqual(result?.headers, ["Region", "Owner"]);
});

test("reports irregular pseudo-table rows instead of silently claiming high confidence", () => {
  const result = extractPseudoTableForSelection(
    wrappedGrid({ semantic: false, irregular: true }),
    "beta-row"
  );

  assert.ok(result);
  assert.notEqual(result.confidenceLevel, "high");
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "irregular-columns"));
});

test("rejects an ordinary direct card Grid without table semantics", () => {
  const cards = node(
    "cards",
    [
      node("card-a", [], { text: "Alpha", box: { x: 0, y: 0, width: 120, height: 80 } }),
      node("card-b", [], { text: "Beta", box: { x: 140, y: 0, width: 120, height: 80 } }),
      node("card-c", [], { text: "Gamma", box: { x: 0, y: 100, width: 120, height: 80 } }),
      node("card-d", [], { text: "Delta", box: { x: 140, y: 100, width: 120, height: 80 } })
    ],
    {
      layout: { display: "grid", gridTemplateColumns: "1fr 1fr" }
    }
  );

  assert.equal(extractPseudoTableForSelection(cards, "card-d"), null);
});

test("rejects structures smaller than two rows by two columns", () => {
  const oneColumn = node(
    "one-column",
    [node("one", [], { text: "One" }), node("two", [], { text: "Two" })],
    {
      role: "table",
      layout: { display: "grid", gridTemplateColumns: "100px" }
    }
  );

  assert.equal(extractPseudoTableForSelection(oneColumn, "two"), null);
});

test("uses synthetic headers and retains the first row when header evidence is ambiguous", () => {
  const result = extractPseudoTableForSelection(
    wrappedGrid({ semantic: false }),
    "alpha-row"
  );

  assert.deepEqual(result?.headers, ["Column 1", "Column 2"]);
  assert.deepEqual(result?.rows[0], ["Name", "Count"]);
  assert.ok(result?.diagnostics.some((diagnostic) => diagnostic.code === "ambiguous-header"));
});

test("does not climb from a frame context into an outer layout candidate", () => {
  const frameRoot = node(
    "frame-root",
    [node("inside-frame", [], { text: "Inside" })],
    { kind: "frame" }
  );
  const outer = node(
    "outer-grid",
    [
      node("outer-header", cells(0, ["Name", "Status"], true), {
        role: "row",
        layout: { display: "grid", gridTemplateColumns: "100px 100px" }
      }),
      node("outer-row", [...cells(1, ["Alpha"]), frameRoot], {
        role: "row",
        layout: { display: "grid", gridTemplateColumns: "100px 100px" }
      })
    ],
    {
      role: "table",
      layout: { display: "grid", gridTemplateColumns: "1fr" }
    }
  );
  const root = node("page", [outer], { kind: "page" });

  assert.equal(extractPseudoTableForSelection(root, "inside-frame"), null);
});

test("extracts the same pseudo table inside page, frame, and open Shadow contexts", () => {
  for (const kind of ["page", "frame", "shadow"] as const) {
    const table = directGrid();
    const boundary = node(`${kind}-root`, [table], { kind });
    const root =
      kind === "page"
        ? boundary
        : node("page-root", [boundary], { kind: "page" });

    const result = extractTableForSelection(root, "r2c1");

    assert.deepEqual(
      {
        headers: result?.headers,
        rows: result?.rows
      },
      {
        headers: ["Name", "Status"],
        rows: [
          ["Alpha", "Ready"],
          ["Beta", "Blocked"]
        ]
      },
      `expected equivalent extraction inside ${kind}`
    );
  }
});

test("does not extract from diagnostic or closed-context placeholders", () => {
  const diagnostic = node("closed-context", [], {
    kind: "diagnostic",
    text: "Shadow root is closed"
  });
  const root = node("page-root", [diagnostic], { kind: "page" });

  assert.equal(extractTableForSelection(root, "closed-context"), null);
});

test("maps confidence thresholds deterministically", () => {
  assert.equal(getConfidenceLevel(100), "high");
  assert.equal(getConfidenceLevel(80), "high");
  assert.equal(getConfidenceLevel(79), "medium");
  assert.equal(getConfidenceLevel(55), "medium");
  assert.equal(getConfidenceLevel(54), "low");
  assert.equal(getConfidenceLevel(35), "low");
});
