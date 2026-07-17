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

const frameBoundary = {
  kind: "frame" as const,
  hostNodeId: "payment-frame",
  hostTagName: "iframe",
  hostAttributes: { title: "Payment" }
};

const shadowBoundary = {
  kind: "shadow" as const,
  hostNodeId: "search-widget",
  hostTagName: "search-widget",
  hostAttributes: { "data-testid": "search-widget" }
};

const alternateFrameBoundary = {
  ...frameBoundary,
  hostNodeId: "alternate-frame"
};

const alternateShadowBoundary = {
  ...shadowBoundary,
  hostNodeId: "alternate-search-widget"
};

const alternateContextBranch = makeNode({
  id: "alternate-frame",
  parentId: "body",
  depth: 2,
  nodeName: "IFRAME",
  tagName: "iframe",
  kind: "element",
  attributes: { title: "Payment" },
  childIds: ["alternate-frame-root"],
  children: [
    makeNode({
      id: "alternate-frame-root",
      parentId: "alternate-frame",
      depth: 3,
      nodeType: 9,
      nodeName: "#document",
      tagName: undefined,
      kind: "frame",
      context: [alternateFrameBoundary],
      childIds: ["alternate-search-widget"],
      children: [
        makeNode({
          id: "alternate-search-widget",
          parentId: "alternate-frame-root",
          depth: 4,
          nodeName: "SEARCH-WIDGET",
          tagName: "search-widget",
          kind: "element",
          context: [alternateFrameBoundary],
          attributes: { "data-testid": "search-widget" },
          childIds: ["alternate-shadow-root"],
          children: [
            makeNode({
              id: "alternate-shadow-root",
              parentId: "alternate-search-widget",
              depth: 5,
              nodeType: 11,
              nodeName: "#shadow-root",
              tagName: undefined,
              kind: "shadow",
              context: [alternateFrameBoundary, alternateShadowBoundary],
              childIds: ["alternate-input"],
              children: [
                makeNode({
                  id: "alternate-input",
                  parentId: "alternate-shadow-root",
                  depth: 6,
                  nodeName: "INPUT",
                  tagName: "input",
                  kind: "element",
                  context: [alternateFrameBoundary, alternateShadowBoundary],
                  visible: true,
                  attributes: { name: "query", type: "search" }
                })
              ]
            })
          ]
        })
      ]
    })
  ]
});

const contextSnapshot: ElementSnapshot = makeNode({
  id: "page",
  nodeName: "HTML",
  tagName: "html",
  kind: "page",
  attributes: { lang: "en" },
  childIds: ["body"],
  children: [
    makeNode({
      id: "body",
      parentId: "page",
      depth: 1,
      nodeName: "BODY",
      tagName: "body",
      kind: "element",
      childIds: ["payment-frame", "alternate-frame"],
      children: [
        makeNode({
          id: "payment-frame",
          parentId: "body",
          depth: 2,
          nodeName: "IFRAME",
          tagName: "iframe",
          kind: "element",
          attributes: { title: "Payment" },
          childIds: ["payment-frame-root"],
          children: [
            makeNode({
              id: "payment-frame-root",
              parentId: "payment-frame",
              depth: 3,
              nodeType: 9,
              nodeName: "#document",
              tagName: undefined,
              kind: "frame",
              context: [frameBoundary],
              childIds: ["search-widget"],
              children: [
                makeNode({
                  id: "search-widget",
                  parentId: "payment-frame-root",
                  depth: 4,
                  nodeName: "SEARCH-WIDGET",
                  tagName: "search-widget",
                  kind: "element",
                  context: [frameBoundary],
                  attributes: { "data-testid": "search-widget" },
                  childIds: ["search-shadow-root"],
                  children: [
                    makeNode({
                      id: "search-shadow-root",
                      parentId: "search-widget",
                      depth: 5,
                      nodeType: 11,
                      nodeName: "#shadow-root",
                      tagName: undefined,
                      kind: "shadow",
                      context: [frameBoundary, shadowBoundary],
                      childIds: ["search-form"],
                      children: [
                        makeNode({
                          id: "search-form",
                          parentId: "search-shadow-root",
                          depth: 6,
                          nodeName: "FORM",
                          tagName: "form",
                          kind: "element",
                          context: [frameBoundary, shadowBoundary],
                          attributes: { "data-testid": "search-form" },
                          childIds: ["shadow-input"],
                          children: [
                            makeNode({
                              id: "shadow-input",
                              parentId: "search-form",
                              depth: 7,
                              nodeName: "INPUT",
                              tagName: "input",
                              kind: "element",
                              context: [frameBoundary, shadowBoundary],
                              visible: true,
                              attributes: { name: "query", type: "search" }
                            })
                          ]
                        })
                      ]
                    })
                  ]
                })
              ]
            })
          ]
        }),
        alternateContextBranch
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

test("text layer attribute can make duplicate elements unique", () => {
  const candidate = generateSelectorCandidates(snapshot, "primary").find((item) => item.type === "playwright");
  assert.ok(candidate);

  const edited = applySelectorEdit(snapshot, candidate, {
    layerId: "target",
    attributeName: "text",
    enabled: true
  });

  assert.equal(edited.validation.status, "unique");
  assert.equal(edited.validation.matchCount, 1);
  assert.match(edited.selector, /hasText: "Save account"/);
});

test("xpath selector serializes enabled text attribute", () => {
  const candidate = generateSelectorCandidates(snapshot, "primary").find((item) => item.type === "xpath");
  assert.ok(candidate);

  const edited = applySelectorEdit(snapshot, candidate, {
    layerId: "target",
    attributeName: "text",
    enabled: true
  });

  assert.equal(edited.validation.status, "unique");
  assert.match(edited.selector, /normalize-space\(\.\)='Save account'/);
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

test("candidate layers preserve page frame shadow ancestor target order", () => {
  const candidate = generateSelectorCandidates(contextSnapshot, "shadow-input")[0];

  assert.deepEqual(candidate?.layers.map((layer) => layer.kind), ["page", "frame", "shadow", "ancestor", "target"]);
});

test("disabling a frame layer recalculates context validation", () => {
  const candidate = generateSelectorCandidates(contextSnapshot, "shadow-input")[0];
  assert.ok(candidate);
  const frame = candidate.layers.find((layer) => layer.kind === "frame");
  assert.ok(frame);

  const edited = applySelectorEdit(contextSnapshot, candidate, { layerId: frame.id, enabled: false });

  assert.equal(edited.layers.find((layer) => layer.id === frame.id)?.enabled, false);
  assert.equal(edited.validation.targetConsistent, false);
});

test("context candidate initially validates as one consistent target", () => {
  const candidate = generateSelectorCandidates(contextSnapshot, "shadow-input")[0];
  assert.ok(candidate);

  assert.equal(candidate.validation.status, "unique");
  assert.equal(candidate.validation.matchCount, 1);
  assert.equal(candidate.validation.targetConsistent, true);
});

test("context validation excludes a similar target under different boundary hosts", () => {
  const candidate = generateSelectorCandidates(contextSnapshot, "shadow-input")[0];
  assert.ok(candidate);

  assert.deepEqual(candidate.validation.matchedElementIds, ["shadow-input"]);
});

test("disabling a shadow layer recalculates context validation", () => {
  const candidate = generateSelectorCandidates(contextSnapshot, "shadow-input")[0];
  assert.ok(candidate);
  const shadow = candidate.layers.find((layer) => layer.kind === "shadow");
  assert.ok(shadow);

  const edited = applySelectorEdit(contextSnapshot, candidate, { layerId: shadow.id, enabled: false });

  assert.equal(edited.layers.find((layer) => layer.id === shadow.id)?.enabled, false);
  assert.equal(edited.validation.targetConsistent, false);
});
