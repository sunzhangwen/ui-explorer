import test from "node:test";
import assert from "node:assert/strict";
import type {
  ContextBoundary,
  ElementNodeKind,
  ElementSnapshot,
  JavaScriptDiagnosticValue,
  SnapshotDiagnostic
} from "../../shared/ipc.js";
import type { JavaScriptDiagnosticStrategy } from "../../shared/javascriptDiagnostics.js";
import type { SelectorCandidate, SelectorLayer } from "../../shared/selector.js";
import type { ExtractedTable } from "../../shared/tableExtraction.js";
import { messages } from "../i18n/messages.js";
import {
  buildWorkbenchExports,
  findTreeSearchMatches,
  getContextPathLabels,
  getDiagnosticPresentation,
  getJavaScriptDiagnosticTruncationMessageKey,
  getJavaScriptStrategyButtonPresentation,
  getSelectorLayerMessageKey,
  getTableConfidenceMessageKey,
  getTableSelectionSummary,
  getTableSummary,
  getTableWorkbookSummary,
  getVirtualTableWindow,
  getTreeNodeBadgeMessageKey,
  getTreeNodePresentationKind,
  getVisibilityMessageKey,
  isTreeNodeHighlightable,
  isTreeNodeSelectable
} from "./workbenchPresentation.js";

test("truncated serialized diagnostic values surface a localized warning", () => {
  const truncatedValues: JavaScriptDiagnosticValue[] = [
    { kind: "string", value: "partial", truncated: true },
    { kind: "object", value: { partial: true }, truncated: true },
    { kind: "array", value: ["partial"], truncated: true }
  ];

  for (const value of truncatedValues) {
    assert.equal(
      getJavaScriptDiagnosticTruncationMessageKey(value),
      "javascript.result.truncated"
    );
  }
  assert.equal(
    getJavaScriptDiagnosticTruncationMessageKey({
      kind: "string",
      value: "complete",
      truncated: false
    }),
    null
  );
  assert.equal(
    getJavaScriptDiagnosticTruncationMessageKey({ kind: "number", value: 1 }),
    null
  );
  assert.equal(messages["zh-CN"]["javascript.result.truncated"], "结果已截断");
  assert.equal(messages["en-US"]["javascript.result.truncated"], "Result truncated");
});

test("diagnostic strategy button presentation exposes pressed state", () => {
  const strategies: JavaScriptDiagnosticStrategy[] = [
    "dom-query",
    "tree-traversal",
    "context-traversal"
  ];

  for (const strategy of strategies) {
    assert.deepEqual(
      getJavaScriptStrategyButtonPresentation("tree-traversal", strategy),
      {
        className: strategy === "tree-traversal" ? "selected" : "",
        "aria-pressed": strategy === "tree-traversal"
      }
    );
  }
});

function createNode(kind: ElementNodeKind, id: string): ElementSnapshot {
  const nodeType = kind === "frame" ? 9 : kind === "shadow" ? 11 : kind === "diagnostic" ? 8 : 1;
  return {
    id,
    depth: 0,
    nodeType,
    nodeName: kind === "element" ? "BUTTON" : kind.toUpperCase(),
    tagName: kind === "element" ? "button" : kind,
    text: `${kind} searchable`,
    kind,
    attributes: { "data-testid": `${kind}-target` },
    childIds: [],
    children: []
  };
}

test("diagnostic nodes remain selectable and searchable for inspection", () => {
  const diagnostic = createNode("diagnostic", "diagnostic-node");

  assert.equal(isTreeNodeSelectable(diagnostic), true);
  assert.equal(isTreeNodeHighlightable(diagnostic), false);
  assert.deepEqual(findTreeSearchMatches([diagnostic], "diagnostic searchable"), [diagnostic]);
});

test("tree search indexes cross-origin and closed-shadow diagnostic codes and details", () => {
  const crossOrigin = createNode("diagnostic", "cross-origin");
  crossOrigin.text = "";
  crossOrigin.diagnostic = {
    code: "cross-origin-frame",
    messageKey: "snapshot.diagnostic.crossOriginFrame",
    detail: "Payment provider frame is blocked"
  };
  const closedShadow = createNode("element", "closed-shadow");
  closedShadow.text = "";
  closedShadow.diagnostic = {
    code: "closed-shadow-root",
    messageKey: "snapshot.diagnostic.closedShadowRoot",
    detail: "Account widget internals are unavailable"
  };

  assert.deepEqual(findTreeSearchMatches([crossOrigin, closedShadow], "cross-origin-frame"), [crossOrigin]);
  assert.deepEqual(findTreeSearchMatches([crossOrigin, closedShadow], "payment provider"), [crossOrigin]);
  assert.deepEqual(findTreeSearchMatches([crossOrigin, closedShadow], "closed-shadow-root"), [closedShadow]);
  assert.deepEqual(findTreeSearchMatches([crossOrigin, closedShadow], "widget internals"), [closedShadow]);
});

test("page, frame, shadow, and element nodes remain selectable and searchable", () => {
  const nodes = (["page", "frame", "shadow", "element"] as const).map((kind) => createNode(kind, `${kind}-node`));

  for (const node of nodes) {
    assert.equal(isTreeNodeSelectable(node), true, `${node.kind} should be selectable`);
    assert.deepEqual(findTreeSearchMatches(nodes, `${node.kind} searchable`), [node]);
  }

  assert.equal(isTreeNodeHighlightable(nodes[0]!), true, "page element should be highlightable");
  assert.equal(isTreeNodeHighlightable(nodes[1]!), false, "frame document should not be highlightable");
  assert.equal(isTreeNodeHighlightable(nodes[2]!), false, "shadow root should not be highlightable");
  assert.equal(isTreeNodeHighlightable(nodes[3]!), true, "element should be highlightable");
});

test("context labels preserve boundary order within frame and shadow paths", () => {
  const context: ContextBoundary[] = [
    {
      kind: "frame",
      hostNodeId: "frame-one",
      hostTagName: "iframe",
      hostAttributes: { id: "checkout" }
    },
    {
      kind: "shadow",
      hostNodeId: "shadow-one",
      hostTagName: "account-card",
      hostAttributes: { "data-testid": "account" }
    },
    {
      kind: "frame",
      hostNodeId: "frame-two",
      hostTagName: "iframe",
      hostAttributes: { name: "payment" }
    },
    {
      kind: "shadow",
      hostNodeId: "shadow-two",
      hostTagName: "confirm-dialog",
      hostAttributes: {}
    }
  ];

  assert.deepEqual(getContextPathLabels(context), {
    frame: ['iframe#checkout', 'iframe[name="payment"]'],
    shadow: ['account-card[data-testid="account"]', "confirm-dialog"]
  });
});

test("diagnostic presentation exposes each localized key and captured detail", () => {
  const diagnostics: SnapshotDiagnostic[] = [
    {
      code: "cross-origin-frame",
      messageKey: "diagnostic.crossOriginFrame",
      detail: "frame: payment"
    },
    {
      code: "closed-shadow-root",
      messageKey: "diagnostic.closedShadowRoot",
      detail: "host: account-card"
    },
    {
      code: "detached-context",
      messageKey: "diagnostic.detachedContext",
      detail: "host: confirm-dialog"
    },
    {
      code: "frame-attach-failed",
      messageKey: "diagnostic.frameAttachFailed",
      detail: "target: child-frame"
    },
    {
      code: "frame-owner-unresolved",
      messageKey: "diagnostic.frameOwnerUnresolved",
      detail: "frame: child-frame"
    },
    {
      code: "navigation-invalidated",
      messageKey: "diagnostic.navigationInvalidated",
      detail: "loader changed"
    },
    {
      code: "session-detached",
      messageKey: "diagnostic.sessionDetached",
      detail: "session: child"
    }
  ];

  for (const diagnostic of diagnostics) {
    assert.deepEqual(getDiagnosticPresentation(diagnostic), {
      messageKey: diagnostic.messageKey,
      detail: diagnostic.detail
    });
  }
});

test("a runtime diagnostic on an element takes precedence in tree presentation", () => {
  const element = createNode("element", "detached-element");
  element.diagnostic = {
    code: "detached-context",
    messageKey: "snapshot.diagnostic.detachedContext",
    detail: "Captured element is disconnected."
  };

  assert.equal(getTreeNodePresentationKind(element), "diagnostic");
  assert.equal(getTreeNodeBadgeMessageKey(element), "tree.badge.limit");
});

test("all selector layer kinds map to their localized message keys", () => {
  const expected = {
    page: "selector.layer.page",
    frame: "selector.layer.frame",
    shadow: "selector.layer.shadow",
    ancestor: "selector.layer.ancestor",
    target: "selector.layer.target"
  } as const satisfies Record<SelectorLayer["kind"], string>;

  for (const kind of Object.keys(expected) as SelectorLayer["kind"][]) {
    assert.equal(getSelectorLayerMessageKey(kind), expected[kind]);
  }
});

test("visibility presentation keeps unknown boundary visibility distinct from hidden elements", () => {
  assert.equal(getVisibilityMessageKey(true), "properties.visible");
  assert.equal(getVisibilityMessageKey(false), "properties.hidden");
  assert.equal(getVisibilityMessageKey(undefined), null);
});

test("diagnostic export takes priority over a selector draft from the previously selected target", () => {
  const diagnostic = createNode("diagnostic", "closed-shadow");
  diagnostic.diagnostic = {
    code: "closed-shadow-root",
    messageKey: "snapshot.diagnostic.closedShadowRoot",
    detail: "Closed Shadow Root content is not accessible"
  };
  const staleCandidate: SelectorCandidate = {
    id: "css",
    type: "css",
    label: "CSS",
    selector: "button",
    layers: [
      {
        id: "old-target",
        nodeId: "old-target",
        kind: "target",
        tagName: "button",
        enabled: true,
        tagEnabled: true,
        attributes: []
      }
    ],
    score: {
      unique: 40,
      stability: 20,
      readability: 10,
      total: 70,
      risks: []
    },
    validation: {
      status: "unique",
      matchCount: 1,
      unique: true,
      visible: true,
      targetConsistent: true,
      matchedElementIds: ["old-target"],
      boundaryAmbiguities: [],
      diagnostics: []
    }
  };

  const exports = buildWorkbenchExports(diagnostic, staleCandidate);
  assert.match(exports?.selenium ?? "", /\[closed-shadow-root\]/);
  assert.doesNotMatch(exports?.selenium ?? "", /\.click\(\)/);
});

test("workbench export forwards browser target metadata to the UiPath full selector", () => {
  const candidate: SelectorCandidate = {
    id: "css",
    type: "css",
    label: "CSS",
    selector: "button#save",
    layers: [
      {
        id: "page",
        nodeId: "page",
        kind: "page",
        tagName: "html",
        enabled: true,
        tagEnabled: true,
        attributes: []
      },
      {
        id: "target",
        nodeId: "save",
        kind: "target",
        tagName: "button",
        enabled: true,
        tagEnabled: true,
        attributes: [
          { name: "id", value: "save", enabled: true, stable: true, score: 46 }
        ]
      }
    ],
    score: {
      unique: 100,
      stability: 100,
      readability: 90,
      total: 98,
      risks: []
    },
    validation: {
      status: "unique",
      matchCount: 1,
      unique: true,
      visible: true,
      targetConsistent: true,
      matchedElementIds: ["save"],
      boundaryAmbiguities: [],
      diagnostics: []
    }
  };
  const exports = buildWorkbenchExports(null, candidate, {
    browser: "Microsoft Edge/140.0",
    title: "Accounts",
    url: "https://example.com/accounts"
  });

  assert.equal(
    exports?.uipath,
    "<html app='msedge.exe' title='Accounts' url='https://example.com/accounts' />\n<webctrl tag='BUTTON' id='save' />"
  );
});

test("summarizes extracted table dimensions and header depth", () => {
  const table: ExtractedTable = {
    tableId: "metrics",
    caption: "Metrics",
    headerDepth: 2,
    headers: ["Team", "Q1", "Q2"],
    rows: [["Payments", "1", "2"], ["Identity", "3", "4"]],
    records: [
      { Team: "Payments", Q1: "1", Q2: "2" },
      { Team: "Identity", Q1: "3", Q2: "4" }
    ],
    sourceKind: "html",
    confidence: 100,
    confidenceLevel: "high",
    diagnostics: []
  };

  assert.deepEqual(getTableSummary(table), { columns: 3, rows: 2, headerDepth: 2 });
});

test("returns no table summary without a selected table", () => {
  assert.equal(getTableSummary(null), null);
});

test("summarizes selected rows and columns against the source table", () => {
  const source: ExtractedTable = {
    tableId: "metrics",
    caption: "Metrics",
    headerDepth: 1,
    headers: ["Team", "Q1", "Q2"],
    rows: [["Payments", "1", "2"], ["Identity", "3", "4"]],
    records: [
      { Team: "Payments", Q1: "1", Q2: "2" },
      { Team: "Identity", Q1: "3", Q2: "4" }
    ],
    sourceKind: "css-grid",
    confidence: 72,
    confidenceLevel: "medium",
    diagnostics: []
  };
  assert.deepEqual(getTableSelectionSummary(source, {
    rowIndexes: [1],
    columnIndexes: [0, 2]
  }), {
    selectedRows: 1,
    totalRows: 2,
    selectedColumns: 2,
    totalColumns: 3
  });
});

test("selection summary keeps selected row counts when every column is cleared", () => {
  const source: ExtractedTable = {
    tableId: "metrics",
    caption: null,
    headerDepth: 1,
    headers: ["Team", "Q1"],
    rows: [["Payments", "1"], ["Identity", "3"]],
    records: [{ Team: "Payments", Q1: "1" }, { Team: "Identity", Q1: "3" }],
    sourceKind: "html",
    confidence: 100,
    confidenceLevel: "high",
    diagnostics: []
  };

  assert.deepEqual(getTableSelectionSummary(source, {
    rowIndexes: [1],
    columnIndexes: []
  }), {
    selectedRows: 1,
    totalRows: 2,
    selectedColumns: 0,
    totalColumns: 2
  });
});

test("maps table confidence levels to localized message keys", () => {
  assert.equal(getTableConfidenceMessageKey("high"), "table.confidence.high");
  assert.equal(getTableConfidenceMessageKey("medium"), "table.confidence.medium");
  assert.equal(getTableConfidenceMessageKey("low"), "table.confidence.low");
});

test("builds the Excel preview summary from the selected table", () => {
  const selected: ExtractedTable = {
    tableId: "metrics",
    caption: "Metrics",
    headerDepth: 1,
    headers: ["Team", "Q2"],
    rows: [["Identity", "4"]],
    records: [{ Team: "Identity", Q2: "4" }],
    sourceKind: "html",
    confidence: 100,
    confidenceLevel: "high",
    diagnostics: []
  };

  assert.deepEqual(getTableWorkbookSummary(selected), {
    rows: 1,
    columns: 2,
    frozenHeader: true,
    autoFilter: true,
    minimumColumnWidth: 12,
    maximumColumnWidth: 48
  });
});

test("computes an overscanned virtual table row window", () => {
  assert.deepEqual(getVirtualTableWindow(100, 300, 30, 8, 3), {
    startIndex: 7,
    endIndex: 21
  });
  assert.deepEqual(getVirtualTableWindow(4, 0, 30, 8, 3), {
    startIndex: 0,
    endIndex: 4
  });
});
