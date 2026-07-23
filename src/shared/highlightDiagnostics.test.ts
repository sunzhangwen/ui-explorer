import test from "node:test";
import assert from "node:assert/strict";
import type { DomSnapshotResult, ElementSnapshot, HighlightResult, SnapshotDiagnostic } from "./ipc.js";
import {
  captureHighlightRequest,
  mergeCurrentHighlightResult,
  mergeHighlightResult
} from "./highlightDiagnostics.js";

const detachedDiagnostic: SnapshotDiagnostic & { code: "detached-context" } = {
  code: "detached-context",
  messageKey: "snapshot.diagnostic.detachedContext",
  detail: "Captured element is disconnected."
};

function createNode(id: string, diagnostic?: SnapshotDiagnostic): ElementSnapshot {
  return {
    id,
    depth: 1,
    nodeType: 1,
    nodeName: "BUTTON",
    tagName: "button",
    kind: "element",
    diagnostic,
    attributes: { "data-testid": id },
    childIds: [],
    children: []
  };
}

function createSnapshot(children: ElementSnapshot[]): DomSnapshotResult {
  return {
    capturedAt: "2026-07-23T00:00:00.000Z",
    nodeCount: children.length + 1,
    root: {
      id: "root",
      depth: 0,
      nodeType: 1,
      nodeName: "HTML",
      tagName: "html",
      kind: "page",
      attributes: {},
      childIds: children.map((child) => child.id),
      children
    }
  };
}

test("detached highlight status is merged immutably and repeated status preserves references", () => {
  const snapshot = createSnapshot([createNode("target")]);
  const result: HighlightResult = {
    targets: [{ elementId: "target", status: "detached", diagnostic: detachedDiagnostic }]
  };

  const merged = mergeHighlightResult(snapshot, result);
  const target = merged.root?.children[0];
  assert.notEqual(merged, snapshot);
  assert.notEqual(merged.root, snapshot.root);
  assert.deepEqual(target?.diagnostic, detachedDiagnostic);

  const repeated = mergeHighlightResult(merged, result);
  assert.equal(repeated, merged);
  assert.equal(repeated.root, merged.root);
});

test("attached highlight status clears only detached-context diagnostics", () => {
  const crossOrigin: SnapshotDiagnostic = {
    code: "cross-origin-frame",
    messageKey: "snapshot.crossOriginFrame",
    detail: "Frame content is not accessible"
  };
  const closedShadow: SnapshotDiagnostic = {
    code: "closed-shadow-root",
    messageKey: "snapshot.closedShadowRoot",
    detail: "Closed Shadow Root content is not accessible"
  };
  const snapshot = createSnapshot([
    createNode("detached", detachedDiagnostic),
    createNode("cross-origin", crossOrigin),
    createNode("closed-shadow", closedShadow)
  ]);
  const result: HighlightResult = {
    targets: [
      { elementId: "detached", status: "highlighted" },
      { elementId: "cross-origin", status: "highlighted" },
      { elementId: "closed-shadow", status: "highlighted" }
    ]
  };

  const merged = mergeHighlightResult(snapshot, result);
  assert.equal(merged.root?.children[0]?.diagnostic, undefined);
  assert.equal(merged.root?.children[1]?.diagnostic, crossOrigin);
  assert.equal(merged.root?.children[2]?.diagnostic, closedShadow);
});

test("statuses for nodes absent from the current snapshot preserve the snapshot reference", () => {
  const snapshot = createSnapshot([createNode("target")]);
  const result: HighlightResult = {
    targets: [{ elementId: "stale-id", status: "detached", diagnostic: detachedDiagnostic }]
  };

  assert.equal(mergeHighlightResult(snapshot, result), snapshot);
});

test("a highlight response is merged only into the snapshot generation that issued it", () => {
  const original = createSnapshot([createNode("n-1")]);
  const request = captureHighlightRequest(original, "target-a", 3);
  const detachedResult: HighlightResult = {
    targets: [{ elementId: "n-1", status: "detached", diagnostic: detachedDiagnostic }]
  };

  const current = createSnapshot([createNode("n-1")]);
  current.capturedAt = "2026-07-23T00:00:01.000Z";
  assert.equal(mergeCurrentHighlightResult(current, "target-a", 4, request, detachedResult), current);
  assert.equal(current.root?.children[0]?.diagnostic, undefined);

  const sameTimestampRefresh = createSnapshot([createNode("n-1")]);
  assert.equal(
    mergeCurrentHighlightResult(sameTimestampRefresh, "target-a", 4, request, detachedResult),
    sameTimestampRefresh
  );
  assert.equal(sameTimestampRefresh.root?.children[0]?.diagnostic, undefined);

  const switchedTarget = createSnapshot([createNode("n-1")]);
  assert.equal(mergeCurrentHighlightResult(switchedTarget, "target-b", 3, request, detachedResult), switchedTarget);
  assert.equal(switchedTarget.root?.children[0]?.diagnostic, undefined);

  const merged = mergeCurrentHighlightResult(original, "target-a", 3, request, detachedResult);
  assert.deepEqual(merged?.root?.children[0]?.diagnostic, detachedDiagnostic);
});
