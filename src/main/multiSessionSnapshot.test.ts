import test from "node:test";
import assert from "node:assert/strict";
import { findElementSnapshot, flattenElementSnapshot } from "../shared/domSnapshot.js";
import type { DomSnapshotResult, ElementSnapshot } from "../shared/ipc.js";
import { generateSelectorCandidates } from "../shared/selector.js";
import {
  stitchSessionSnapshots,
  translateBoundingBox,
  type SessionSnapshot
} from "./multiSessionSnapshot.js";

test("stitchSessionSnapshots replaces an OOPIF placeholder with a namespaced child document", () => {
  const result = stitchSessionSnapshots("root-session", [
    parentSessionSnapshot(true),
    childSessionSnapshot()
  ]);

  const childRoot = findElementSnapshot(result.root, "child-session::n-1");
  const childButton = findElementSnapshot(result.root, "child-session::n-2");

  assert.equal(childRoot?.parentId, "root-session::n-2");
  assert.equal(childRoot?.kind, "frame");
  assert.equal(childButton?.context?.[0].frameId, "child-frame");
  assert.deepEqual(childButton?.boundingBox, {
    x: 107,
    y: 49,
    width: 20,
    height: 10
  });
  assert.equal(
    flattenElementSnapshot(result.root).some((node) =>
      node.diagnostic?.code === "cross-origin-frame"
    ),
    false
  );
});

test("stitchSessionSnapshots reports a child frame whose owner cannot be resolved", () => {
  const result = stitchSessionSnapshots("root-session", [
    parentSessionSnapshot(false),
    childSessionSnapshot()
  ]);

  const diagnostic = flattenElementSnapshot(result.root).find((node) =>
    (node.diagnostic?.code as string | undefined) === "frame-owner-unresolved"
  );

  assert.equal(diagnostic?.kind, "diagnostic");
  assert.match(diagnostic?.diagnostic?.detail ?? "", /child-frame/);
});

test("translateBoundingBox adds every owner content offset", () => {
  assert.deepEqual(
    translateBoundingBox(
      { x: 5, y: 7, width: 20, height: 10 },
      [{ x: 100, y: 40 }, { x: 2, y: 2 }]
    ),
    { x: 107, y: 49, width: 20, height: 10 }
  );
});

test("selectors validate against elements inside the stitched OOPIF tree", () => {
  const result = stitchSessionSnapshots("root-session", [
    parentSessionSnapshot(true),
    childSessionSnapshot()
  ]);

  const candidates = generateSelectorCandidates(result.root, "child-session::n-2");

  assert.ok(candidates.length > 0);
  assert.deepEqual(candidates[0].validation.matchedElementIds, ["child-session::n-2"]);
  assert.equal(candidates[0].validation.status, "unique");
});

function parentSessionSnapshot(withFrameMarker: boolean): SessionSnapshot {
  const frameContext = {
    kind: "frame" as const,
    hostNodeId: "n-2",
    hostTagName: "iframe",
    hostAttributes: { title: "Payment" },
    ...(withFrameMarker
      ? {
          frameId: "child-frame",
          targetId: "child-target",
          sessionId: "child-session",
          ownerContentOffset: { x: 102, y: 42 }
        }
      : {})
  };
  const diagnostic: ElementSnapshot = {
    id: "n-3",
    parentId: "n-2",
    depth: 2,
    nodeType: 8,
    nodeName: "#context-unavailable",
    text: "Frame content is not accessible",
    kind: "diagnostic",
    context: [frameContext],
    diagnostic: {
      code: "cross-origin-frame",
      messageKey: "snapshot.crossOriginFrame",
      detail: "Frame content is not accessible"
    },
    attributes: {},
    childIds: [],
    children: []
  };
  const frame: ElementSnapshot = {
    id: "n-2",
    parentId: "n-1",
    depth: 1,
    nodeType: 1,
    nodeName: "IFRAME",
    tagName: "iframe",
    text: "",
    kind: "element",
    context: [],
    boundingBox: { x: 100, y: 40, width: 300, height: 200 },
    attributes: { title: "Payment" },
    childIds: ["n-3"],
    children: [diagnostic]
  };
  const root: ElementSnapshot = {
    id: "n-1",
    depth: 0,
    nodeType: 1,
    nodeName: "HTML",
    tagName: "html",
    text: "",
    kind: "page",
    context: [],
    attributes: {},
    childIds: ["n-2"],
    children: [frame]
  };
  return {
    sessionId: "root-session",
    targetId: "root-target",
    frameId: "root-frame",
    revision: 1,
    result: snapshotResult(root, "root-token", 3)
  };
}

function childSessionSnapshot(): SessionSnapshot {
  const button: ElementSnapshot = {
    id: "n-2",
    parentId: "n-1",
    depth: 1,
    nodeType: 1,
    nodeName: "BUTTON",
    tagName: "button",
    text: "Pay",
    kind: "element",
    context: [],
    visible: true,
    boundingBox: { x: 5, y: 7, width: 20, height: 10 },
    attributes: { "data-testid": "oopif-action" },
    childIds: [],
    children: []
  };
  const root: ElementSnapshot = {
    id: "n-1",
    depth: 0,
    nodeType: 1,
    nodeName: "HTML",
    tagName: "html",
    text: "",
    kind: "page",
    context: [],
    attributes: {},
    childIds: ["n-2"],
    children: [button]
  };
  return {
    sessionId: "child-session",
    targetId: "child-target",
    frameId: "child-frame",
    parentFrameId: "root-frame",
    revision: 1,
    result: snapshotResult(root, "child-token", 2)
  };
}

function snapshotResult(
  root: ElementSnapshot,
  snapshotToken: string,
  nodeCount: number
): DomSnapshotResult {
  return {
    root,
    capturedAt: "2026-07-29T00:00:00.000Z",
    snapshotToken,
    nodeCount
  };
}
