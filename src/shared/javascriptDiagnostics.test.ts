import test from "node:test";
import assert from "node:assert/strict";
import {
  generateAttributeEditDraft,
  generateJavaScriptDiagnosticDraft,
  getJavaScriptDiagnosticSuggestions,
  validateJavaScriptDiagnosticCode
} from "./javascriptDiagnostics.js";
import type { ElementSnapshot } from "./ipc.js";
import type { SelectorCandidate, SelectorValidationStatus } from "./selector.js";

const button = (overrides: Partial<ElementSnapshot> = {}): ElementSnapshot => ({
  id: "button",
  depth: 0,
  nodeType: 1,
  nodeName: "BUTTON",
  tagName: "button",
  attributes: {},
  childIds: [],
  children: [],
  ...overrides
});

const candidate = (
  selector: string,
  status: SelectorValidationStatus = "unique",
  matchCount = status === "unique" ? 1 : 0
): SelectorCandidate => ({
  id: "candidate",
  type: "css",
  label: "CSS",
  selector,
  layers: [],
  score: { unique: 100, stability: 100, readability: 100, total: 100, risks: [] },
  validation: {
    status,
    matchCount,
    unique: status === "unique",
    visible: true,
    targetConsistent: status === "unique",
    matchedElementIds: [],
    boundaryAmbiguities: [],
    diagnostics: []
  }
});

const oopifShadowButton = (): ElementSnapshot =>
  button({
    id: "child-session::save-button",
    context: [
      {
        kind: "frame",
        hostNodeId: "payment-frame",
        hostTagName: "iframe",
        hostAttributes: { title: "Payment" },
        sessionId: "child-session"
      },
      {
        kind: "frame",
        hostNodeId: "nested-frame",
        hostTagName: "iframe",
        hostAttributes: { title: "Nested" }
      },
      {
        kind: "shadow",
        hostNodeId: "save-host",
        hostTagName: "save-widget",
        hostAttributes: { "data-testid": "save-host" }
      }
    ]
  });

test("DOM query draft searches the target root with an encoded selector", () => {
  const draft = generateJavaScriptDiagnosticDraft({
    element: button({ id: "n-2", attributes: { "aria-label": 'Save "draft"' } }),
    candidate: candidate('[aria-label="Save \\"draft\\""]'),
    strategy: "dom-query"
  });

  assert.equal(draft.intent, "inspect");
  assert.deepEqual(draft.risks, ["arbitrary-code"]);
  assert.match(draft.code, /\$target\.getRootNode\(\)/);
  assert.match(draft.code, /querySelectorAll/);
  assert.doesNotThrow(() => new Function("$target", draft.code));
});

test("context draft skips the owning OOPIF boundary and enters later local boundaries", () => {
  const draft = generateJavaScriptDiagnosticDraft({
    element: oopifShadowButton(),
    candidate: candidate("button[data-testid=save]"),
    strategy: "context-traversal"
  });

  assert.doesNotMatch(draft.code, /payment-frame/);
  assert.match(draft.code, /nested-frame/);
  assert.match(draft.code, /shadowRoot/);
});

test("attribute edit is encoded and marked as a DOM mutation", () => {
  const draft = generateAttributeEditDraft({
    attributeName: 'data-note"',
    attributeValue: "line 1\nline 2"
  });

  assert.equal(draft.intent, "mutate-dom");
  assert.deepEqual(draft.risks, ["arbitrary-code", "dom-mutation"]);
  assert.doesNotThrow(() => new Function("$target", draft.code));
});

test("code validation rejects blank and over-limit input", () => {
  assert.deepEqual(validateJavaScriptDiagnosticCode("  \n"), {
    ok: false,
    code: "empty-code"
  });
  assert.deepEqual(validateJavaScriptDiagnosticCode("x".repeat(50 * 1024 + 1)), {
    ok: false,
    code: "code-too-large"
  });
  assert.deepEqual(validateJavaScriptDiagnosticCode("return 1;"), { ok: true });
});

test("diagnostic suggestions are empty for a unique local selector", () => {
  assert.deepEqual(
    getJavaScriptDiagnosticSuggestions({ element: button(), candidate: candidate("button") }),
    []
  );
});

test("diagnostic suggestions add a stable constraint for missing, multiple, and mismatched selectors", () => {
  for (const [status, matchCount] of [
    ["missing", 0],
    ["multiple", 2],
    ["mismatch", 1]
  ] as const) {
    assert.deepEqual(
      getJavaScriptDiagnosticSuggestions({
        element: button(),
        candidate: candidate("button", status, matchCount)
      }),
      ["add-stable-constraint"]
    );
  }
});

test("diagnostic suggestions identify dynamic attributes and context routing risks in stable order", () => {
  const element = oopifShadowButton();
  element.attributes = { id: "button-a1b2c3d4", class: "css-9f8a7b6c" };

  assert.deepEqual(
    getJavaScriptDiagnosticSuggestions({
      element,
      candidate: candidate("button", "multiple", 2),
      failure: "timeout"
    }),
    [
      "add-stable-constraint",
      "avoid-dynamic-attribute",
      "use-context-traversal",
      "oopif-session-routing",
      "reduce-traversal-scope"
    ]
  );
});

test("diagnostic suggestions refresh a stale target without duplicates", () => {
  assert.deepEqual(
    getJavaScriptDiagnosticSuggestions({
      element: oopifShadowButton(),
      candidate: candidate("button", "missing", 0),
      failure: "stale-target"
    }),
    [
      "refresh-snapshot",
      "add-stable-constraint",
      "use-context-traversal",
      "oopif-session-routing"
    ]
  );
});
