import test from "node:test";
import assert from "node:assert/strict";
import { analyzeElementAttributes } from "./attributeInsights.js";
import type { ElementSnapshot } from "./ipc.js";

const root: ElementSnapshot = {
  id: "root",
  depth: 0,
  nodeType: 1,
  nodeName: "HTML",
  tagName: "html",
  attributes: {},
  childIds: ["save", "cancel"],
  children: [
    {
      id: "save",
      parentId: "root",
      depth: 1,
      nodeType: 1,
      nodeName: "BUTTON",
      tagName: "button",
      attributes: {
        "data-testid": "save-account",
        class: "primary action",
        id: "button-1739928899123"
      },
      childIds: [],
      children: []
    },
    {
      id: "cancel",
      parentId: "root",
      depth: 1,
      nodeType: 1,
      nodeName: "BUTTON",
      tagName: "button",
      attributes: { class: "primary action" },
      childIds: [],
      children: []
    }
  ]
};

test("AttributeInsights filters names and values case-insensitively", () => {
  assert.deepEqual(
    analyzeElementAttributes(root, "save", "SAVE").map((attribute) => attribute.name),
    ["data-testid"]
  );
  assert.deepEqual(
    analyzeElementAttributes(root, "save", "CLASS").map((attribute) => attribute.name),
    ["class"]
  );
});

test("AttributeInsights marks unique stable and dynamic locator signals", () => {
  const insights = analyzeElementAttributes(root, "save", "");

  assert.deepEqual(insights.find((attribute) => attribute.name === "data-testid"), {
    name: "data-testid",
    value: "save-account",
    matchCount: 1,
    markers: ["unique", "stable"]
  });
  assert.deepEqual(insights.find((attribute) => attribute.name === "class"), {
    name: "class",
    value: "primary action",
    matchCount: 2,
    markers: []
  });
  assert.deepEqual(insights.find((attribute) => attribute.name === "id"), {
    name: "id",
    value: "button-1739928899123",
    matchCount: 1,
    markers: ["unique", "dynamic"]
  });
});
