import test from "node:test";
import assert from "node:assert/strict";
import { applySelectorEdit, buildSelectorExports, generateSelectorCandidates } from "./selector.js";
import type { ElementSnapshot } from "./ipc.js";

const makeNode = (overrides: Partial<ElementSnapshot>): ElementSnapshot => ({
  id: "node",
  depth: 0,
  nodeType: 1,
  nodeName: "DIV",
  tagName: "div",
  attributes: {},
  childIds: [],
  children: [],
  ...overrides
});

const snapshot: ElementSnapshot = makeNode({
  id: "html",
  nodeName: "HTML",
  tagName: "html",
  childIds: ["body"],
  children: [
    makeNode({
      id: "body",
      parentId: "html",
      depth: 1,
      nodeName: "BODY",
      tagName: "body",
      childIds: ["primary", "secondary", "unstable"],
      children: [
        makeNode({
          id: "primary",
          parentId: "body",
          depth: 2,
          nodeName: "BUTTON",
          tagName: "button",
          role: "button",
          text: "Save account",
          visible: true,
          attributes: { "data-testid": "save-account", type: "button", class: "btn primary" }
        }),
        makeNode({
          id: "secondary",
          parentId: "body",
          depth: 2,
          nodeName: "BUTTON",
          tagName: "button",
          role: "button",
          text: "Save draft",
          visible: true,
          attributes: { "data-testid": "save-account", type: "button", class: "btn secondary" }
        }),
        makeNode({
          id: "unstable",
          parentId: "body",
          depth: 2,
          nodeName: "INPUT",
          tagName: "input",
          visible: true,
          attributes: { id: "input-9f8a7b6c", name: "email", placeholder: "Email" }
        })
      ]
    })
  ]
});

test("generateSelectorCandidates creates CSS, XPath, and Playwright candidates with validation", () => {
  const candidates = generateSelectorCandidates(snapshot, "primary");

  assert.deepEqual(
    candidates.map((candidate) => candidate.type),
    ["playwright", "css", "xpath"]
  );
  assert.equal(candidates[0]?.validation.matchCount, 2);
  assert.equal(candidates[0]?.validation.status, "multiple");
  assert.match(candidates[0]?.selector ?? "", /getByTestId/);
  assert.ok((candidates[0]?.score.stability ?? 0) > 80);
});

test("generateSelectorCandidates penalizes random-looking ids and prefers stable attributes", () => {
  const candidates = generateSelectorCandidates(snapshot, "unstable");
  const css = candidates.find((candidate) => candidate.type === "css");

  assert.equal(css?.validation.status, "unique");
  assert.ok(css?.selector.includes('[name="email"]'));
  assert.ok(css?.score.risks.some((risk) => risk.code === "dynamic-id"));
});

test("applySelectorEdit recalculates selector and validation when an attribute is disabled", () => {
  const candidate = generateSelectorCandidates(snapshot, "primary").find((item) => item.type === "css");
  assert.ok(candidate);

  const edited = applySelectorEdit(snapshot, candidate, {
    layerId: "target",
    attributeName: "data-testid",
    enabled: false
  });

  assert.equal(edited.validation.status, "multiple");
  assert.equal(edited.validation.matchCount, 2);
  assert.equal(edited.selector, "button");
  assert.ok(edited.score.risks.some((risk) => risk.code === "not-unique"));
});

test("buildSelectorExports creates JSON, Playwright, and Selenium snippets", () => {
  const candidate = generateSelectorCandidates(snapshot, "unstable").find((item) => item.type === "css");
  assert.ok(candidate);

  const exports = buildSelectorExports(candidate);

  assert.match(exports.json, /"selector": "input\[name=\\"email\\"\]"/);
  assert.match(exports.playwright, /const element = page\.locator\("input\[name=\\\"email\\\"\]"\);/);
  assert.match(exports.playwright, /await element\.click\(\);/);
  assert.match(exports.selenium, /driver\.find_element\(By\.CSS_SELECTOR, 'input\[name="email"\]'\)\.click\(\)/);
});
