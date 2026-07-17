import test from "node:test";
import assert from "node:assert/strict";
import {
  findElementSnapshot,
  flattenElementSnapshot,
  formatElementAttributes,
  getContextPath,
  getElementPath,
  getElementSnapshotStats,
  normalizeDebugEndpoint
} from "./domSnapshot.js";
import type { ElementSnapshot } from "./ipc.js";

const snapshot: ElementSnapshot = {
  id: "root",
  depth: 0,
  nodeType: 1,
  nodeName: "HTML",
  tagName: "html",
  attributes: { lang: "zh-CN" },
  childIds: ["body"],
  children: [
    {
      id: "body",
      parentId: "root",
      depth: 1,
      nodeType: 1,
      nodeName: "BODY",
      tagName: "body",
      attributes: {},
      childIds: ["button", "shadow-host"],
      children: [
        {
          id: "button",
          parentId: "body",
          depth: 2,
          nodeType: 1,
          nodeName: "BUTTON",
          tagName: "button",
          text: "Save account",
          role: "button",
          visible: true,
          boundingBox: { x: 16, y: 24, width: 120, height: 36 },
          attributes: { "data-testid": "save-account", type: "button" },
          childIds: [],
          children: []
        },
        {
          id: "shadow-host",
          parentId: "body",
          depth: 2,
          nodeType: 1,
          nodeName: "OPEN-WIDGET",
          tagName: "open-widget",
          attributes: { "data-testid": "open-widget" },
          childIds: ["shadow-root"],
          children: [
            {
              id: "shadow-root",
              parentId: "shadow-host",
              depth: 3,
              nodeType: 11,
              nodeName: "#shadow-root",
              attributes: {},
              childIds: [],
              children: []
            }
          ]
        }
      ]
    }
  ]
};

const contextSnapshot: ElementSnapshot = {
  id: "page",
  depth: 0,
  nodeType: 1,
  nodeName: "HTML",
  tagName: "html",
  kind: "page",
  attributes: {},
  childIds: ["body"],
  children: [
    {
      id: "body",
      parentId: "page",
      depth: 1,
      nodeType: 1,
      nodeName: "BODY",
      tagName: "body",
      kind: "element",
      attributes: {},
      childIds: ["payment-frame", "unavailable-frame"],
      children: [
        {
          id: "payment-frame",
          parentId: "body",
          depth: 2,
          nodeType: 1,
          nodeName: "IFRAME",
          tagName: "iframe",
          kind: "element",
          attributes: { title: "Payment" },
          childIds: ["payment-frame-root"],
          children: [
            {
              id: "payment-frame-root",
              parentId: "payment-frame",
              depth: 3,
              nodeType: 9,
              nodeName: "#document",
              kind: "frame",
              attributes: {},
              childIds: ["search-widget"],
              children: [
                {
                  id: "search-widget",
                  parentId: "payment-frame-root",
                  depth: 4,
                  nodeType: 1,
                  nodeName: "SEARCH-WIDGET",
                  tagName: "search-widget",
                  kind: "element",
                  attributes: {},
                  childIds: ["search-shadow-root"],
                  children: [
                    {
                      id: "search-shadow-root",
                      parentId: "search-widget",
                      depth: 5,
                      nodeType: 11,
                      nodeName: "#shadow-root",
                      kind: "shadow",
                      attributes: {},
                      childIds: ["shadow-input"],
                      children: [
                        {
                          id: "shadow-input",
                          parentId: "search-shadow-root",
                          depth: 6,
                          nodeType: 1,
                          nodeName: "INPUT",
                          tagName: "input",
                          kind: "element",
                          context: [
                            {
                              kind: "frame",
                              hostNodeId: "payment-frame",
                              hostTagName: "iframe",
                              hostAttributes: { title: "Payment" }
                            },
                            {
                              kind: "shadow",
                              hostNodeId: "search-widget",
                              hostTagName: "search-widget",
                              hostAttributes: {}
                            }
                          ],
                          attributes: { type: "search" },
                          childIds: [],
                          children: []
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        },
        {
          id: "unavailable-frame",
          parentId: "body",
          depth: 2,
          nodeType: 8,
          nodeName: "#context-unavailable",
          kind: "diagnostic",
          diagnostic: {
            code: "cross-origin-frame",
            messageKey: "snapshot.crossOriginFrame",
            detail: "Frame content is not accessible"
          },
          attributes: {},
          childIds: [],
          children: []
        }
      ]
    }
  ]
};

test("flattenElementSnapshot returns depth-first rows with inherited depth", () => {
  const rows = flattenElementSnapshot(snapshot);

  assert.deepEqual(
    rows.map((row) => [row.id, row.depth]),
    [
      ["root", 0],
      ["body", 1],
      ["button", 2],
      ["shadow-host", 2],
      ["shadow-root", 3]
    ]
  );
});

test("findElementSnapshot returns nested nodes by id", () => {
  assert.equal(findElementSnapshot(snapshot, "button")?.text, "Save account");
  assert.equal(findElementSnapshot(snapshot, "missing"), null);
});

test("getElementPath returns the root-to-node path", () => {
  assert.deepEqual(
    getElementPath(snapshot, "button").map((node) => node.id),
    ["root", "body", "button"]
  );
  assert.deepEqual(getElementPath(snapshot, "missing"), []);
});

test("getContextPath returns ordered frame and shadow boundaries", () => {
  assert.deepEqual(
    getContextPath(contextSnapshot, "shadow-input").map((boundary) => [boundary.kind, boundary.hostNodeId]),
    [["frame", "payment-frame"], ["shadow", "search-widget"]]
  );
});

test("formatElementAttributes preserves attribute order and values", () => {
  const button = findElementSnapshot(snapshot, "button");

  assert.equal(formatElementAttributes(button), 'data-testid="save-account" type="button"');
});

test("getElementSnapshotStats counts elements and shadow roots", () => {
  assert.deepEqual(getElementSnapshotStats(snapshot), {
    totalNodes: 5,
    elementNodes: 4,
    frameRoots: 0,
    shadowRoots: 1,
    inaccessibleContexts: 0
  });
});

test("snapshot stats count frame, shadow, and inaccessible boundaries", () => {
  assert.deepEqual(getElementSnapshotStats(contextSnapshot), {
    totalNodes: 8,
    elementNodes: 5,
    frameRoots: 1,
    shadowRoots: 1,
    inaccessibleContexts: 1
  });
});

test("normalizeDebugEndpoint accepts host:port and full URLs", () => {
  assert.equal(normalizeDebugEndpoint("localhost:9222"), "http://localhost:9222");
  assert.equal(normalizeDebugEndpoint("http://127.0.0.1:9222/"), "http://127.0.0.1:9222");
});
