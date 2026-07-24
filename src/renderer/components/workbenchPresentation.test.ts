import test from "node:test";
import assert from "node:assert/strict";
import type { ContextBoundary, ElementNodeKind, ElementSnapshot, SnapshotDiagnostic } from "../../shared/ipc.js";
import type { SelectorCandidate, SelectorLayer } from "../../shared/selector.js";
import {
  buildWorkbenchExports,
  findTreeSearchMatches,
  getContextPathLabels,
  getDiagnosticPresentation,
  getSelectorLayerMessageKey,
  getTreeNodeBadgeMessageKey,
  getTreeNodePresentationKind,
  getVisibilityMessageKey,
  isTreeNodeHighlightable,
  isTreeNodeSelectable
} from "./workbenchPresentation.js";

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
