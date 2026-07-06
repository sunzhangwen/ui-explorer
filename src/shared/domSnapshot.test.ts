import test from "node:test";
import assert from "node:assert/strict";
import {
  findElementSnapshot,
  flattenElementSnapshot,
  formatElementAttributes,
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

test("formatElementAttributes preserves attribute order and values", () => {
  const button = findElementSnapshot(snapshot, "button");

  assert.equal(formatElementAttributes(button), 'data-testid="save-account" type="button"');
});

test("getElementSnapshotStats counts elements and shadow roots", () => {
  assert.deepEqual(getElementSnapshotStats(snapshot), {
    totalNodes: 5,
    elementNodes: 4,
    shadowRoots: 1
  });
});

test("normalizeDebugEndpoint accepts host:port and full URLs", () => {
  assert.equal(normalizeDebugEndpoint("localhost:9222"), "http://localhost:9222");
  assert.equal(normalizeDebugEndpoint("http://127.0.0.1:9222/"), "http://127.0.0.1:9222");
});
