# Phase 3 iframe and Shadow DOM Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add same-origin nested iframe and open Shadow DOM context traversal, editing, validation, highlighting, picking, diagnostics, and code export without claiming support for inaccessible contexts.

**Architecture:** Extend the existing `ElementSnapshot` tree with explicit page/frame/shadow/diagnostic boundary metadata, then derive all Selector context layers from the target path. Keep one snapshot registry across accessible documents so the existing IPC surface remains unchanged; serialize enabled context layers into Playwright and Selenium entry steps.

**Tech Stack:** Electron 33, Chrome DevTools Protocol Runtime evaluation, React 18, TypeScript 5.7, Zustand, Node.js test runner, Lucide React, Tailwind/global CSS.

## Global Constraints

- Phase 3 supports same-origin and nested iframe traversal only.
- Cross-origin iframe and OOPIF traversal is deferred to Phase 8 task 8.6 and must produce a limitation diagnostic in Phase 3.
- Only open Shadow Roots are traversable; closed Shadow Roots must never report successful internal capture.
- Preserve the current IPC API and element-ID based selection flow.
- Use failing tests before production code for every behavioral change.
- Browser Runtime traversal strings are a user-approved limited TDD exception: cover pure context logic with test-first unit tests, keep script contract tests, and verify actual traversal in Electron acceptance testing.
- Do not add runtime dependencies.

---

### Task 1: Snapshot context model and path helpers

**Files:**
- Modify: `src/shared/ipc.ts`
- Modify: `src/shared/domSnapshot.ts`
- Modify: `src/shared/domSnapshot.test.ts`

**Interfaces:**
- Produces: `ElementNodeKind`, `ContextBoundary`, `SnapshotDiagnostic`, optional `ElementSnapshot.kind`, `context`, and `diagnostic` fields.
- Produces: `getElementPath(root, id)`, `getContextPath(root, id)`, and expanded `ElementSnapshotStats`.

- [ ] **Step 1: Write failing tests for boundary paths and statistics**

Add a frame boundary and shadow boundary fixture, then assert:

```ts
test("getContextPath returns ordered frame and shadow boundaries", () => {
  assert.deepEqual(
    getContextPath(contextSnapshot, "shadow-input").map((boundary) => [boundary.kind, boundary.hostNodeId]),
    [["frame", "payment-frame"], ["shadow", "search-widget"]]
  );
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
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- --test-name-pattern="ContextPath|snapshot stats"`

Expected: TypeScript compilation fails because `getContextPath`, new node fields, and new stats do not exist.

- [ ] **Step 3: Add the snapshot context types and helpers**

Add these shared types in `src/shared/ipc.ts`:

```ts
export type ElementNodeKind = "element" | "page" | "frame" | "shadow" | "diagnostic";
export type ContextBoundaryKind = "frame" | "shadow";
export type SnapshotDiagnosticCode = "cross-origin-frame" | "closed-shadow-root" | "detached-context";

export type ContextBoundary = {
  kind: ContextBoundaryKind;
  hostNodeId: string;
  hostTagName: string;
  hostAttributes: Record<string, string>;
};

export type SnapshotDiagnostic = {
  code: SnapshotDiagnosticCode;
  messageKey: string;
  detail: string;
};
```

Extend `ElementSnapshot` with:

```ts
kind?: ElementNodeKind;
context?: ContextBoundary[];
diagnostic?: SnapshotDiagnostic;
```

Add in `src/shared/domSnapshot.ts`:

```ts
export function getElementPath(root: ElementSnapshot | null, id: string): ElementSnapshot[] {
  if (!root) return [];
  const path: ElementSnapshot[] = [];
  const visit = (node: ElementSnapshot): boolean => {
    path.push(node);
    if (node.id === id) return true;
    for (const child of node.children) if (visit(child)) return true;
    path.pop();
    return false;
  };
  return visit(root) ? path : [];
}

export function getContextPath(root: ElementSnapshot | null, id: string): ContextBoundary[] {
  const node = findElementSnapshot(root, id);
  return node?.context ? node.context.map((boundary) => ({ ...boundary, hostAttributes: { ...boundary.hostAttributes } })) : [];
}
```

Expand `ElementSnapshotStats` and its reducer with `frameRoots` and `inaccessibleContexts`, using `node.kind === "frame"` and `node.kind === "diagnostic"` respectively.

- [ ] **Step 4: Run snapshot tests and verify GREEN**

Run: `npm test -- --test-name-pattern="ElementSnapshot|ContextPath|snapshot stats"`

Expected: all matching tests pass.

- [ ] **Step 5: Commit the model**

```bash
git add src/shared/ipc.ts src/shared/domSnapshot.ts src/shared/domSnapshot.test.ts
git commit -m "feat: add snapshot context boundaries"
```

---

### Task 2: Capture nested frame and shadow boundaries

**Files:**
- Create: `src/main/browserScripts.ts`
- Create: `src/main/browserScripts.test.ts`
- Modify: `src/main/browserSession.ts`
- Modify: `tsconfig.test.json`
- Modify: `public/test-pages/iframe.html`
- Modify: `public/test-pages/iframe-child.html`
- Create: `public/test-pages/iframe-nested.html`
- Modify: `public/test-pages/shadow-dom.html`

**Interfaces:**
- Consumes: `ElementSnapshot.context`, `ContextBoundary`, and `SnapshotDiagnostic` from Task 1.
- Produces: `SNAPSHOT_SCRIPT`, `HIGHLIGHT_SCRIPT`, `ELEMENT_PICKER_SCRIPT`, and `GET_PICKED_ELEMENT_SCRIPT` from a focused module.

- [ ] **Step 1: Write failing browser-script contract tests**

Create `src/main/browserScripts.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { ELEMENT_PICKER_SCRIPT, HIGHLIGHT_SCRIPT, SNAPSHOT_SCRIPT } from "./browserScripts.js";

test("snapshot script records frame and shadow context boundaries", () => {
  assert.match(SNAPSHOT_SCRIPT, /kind:\s*"frame"/);
  assert.match(SNAPSHOT_SCRIPT, /kind:\s*"shadow"/);
  assert.match(SNAPSHOT_SCRIPT, /cross-origin-frame/);
  assert.match(SNAPSHOT_SCRIPT, /closed-shadow-root/);
});

test("highlight and picker scripts visit accessible frame documents", () => {
  assert.match(HIGHLIGHT_SCRIPT, /ownerDocument/);
  assert.match(HIGHLIGHT_SCRIPT, /documents/);
  assert.match(ELEMENT_PICKER_SCRIPT, /contentDocument/);
  assert.match(ELEMENT_PICKER_SCRIPT, /composedPath/);
});
```

Include `src/main/browserScripts.ts` and its test in `tsconfig.test.json`.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- --test-name-pattern="snapshot script|highlight and picker"`

Expected: compilation fails because `browserScripts.ts` does not exist.

- [ ] **Step 3: Extract and enhance the Runtime scripts**

Move the four Runtime strings out of `browserSession.ts`. Implement the recursive walker with the following control flow; each comment names a required branch whose returned node shape is defined by Task 1:

```js
const walk = (node, depth, parentId, context, kind = "element") => {
  // Register the node and copy the current ordered context to base.context.
  // For an accessible iframe append a frame boundary and add a kind:"frame" document-root child.
  // For an inaccessible iframe add a kind:"diagnostic" child with code:"cross-origin-frame".
  // For an open shadow root append a shadow boundary and add a kind:"shadow" child.
  // For a host marked data-ui-explorer-closed-shadow add a diagnostic child.
};
```

Use `frame.contentDocument` inside `try/catch`; never infer successful access from the presence of the iframe element. Mark the top document root `kind: "page"`. Store every visited document in `window.__uiExplorerDocuments`.

Update highlight cleanup to iterate `window.__uiExplorerDocuments`, remove prior overlays in each document, and create the new overlay in `target.ownerDocument`. Keep local `getBoundingClientRect()` coordinates because the overlay is attached to that same document.

Keep picker installation recursive for accessible frames and use `event.composedPath()` so open Shadow DOM targets resolve through the shared WeakMap.

Import the four constants into `browserSession.ts`; do not change BrowserSession's public methods or IPC channels.

- [ ] **Step 4: Add nested acceptance fixtures**

In `iframe.html`, add an iframe in the existing child page path by adding this to `iframe-child.html` after its section:

```html
<iframe title="Payment verification frame" src="./iframe-nested.html"></iframe>
```

Create `iframe-nested.html` with a `button[data-testid="confirm-payment"]`. In `shadow-dom.html`, mark the closed host:

```html
<closed-widget data-ui-explorer-closed-shadow></closed-widget>
```

Preserve the nested open widget fixture already present.

- [ ] **Step 5: Run tests, typecheck, and build**

Run: `npm test`

Expected: all tests pass.

Run: `npm run typecheck`

Expected: both TypeScript projects exit 0.

Run: `npm run build`

Expected: Electron and Vite production builds exit 0.

- [ ] **Step 6: Commit capture behavior**

```bash
git add src/main/browserScripts.ts src/main/browserScripts.test.ts src/main/browserSession.ts tsconfig.test.json public/test-pages/iframe.html public/test-pages/iframe-child.html public/test-pages/iframe-nested.html public/test-pages/shadow-dom.html
git commit -m "feat: capture nested frame and shadow contexts"
```

---

### Task 3: Context-aware Selector layers and validation

**Files:**
- Modify: `src/shared/selector.ts`
- Modify: `src/shared/selector.test.ts`

**Interfaces:**
- Consumes: ordered target path and context boundaries from Tasks 1-2.
- Produces: `SelectorLayer.kind` values `page | frame | shadow | ancestor | target` and context-aware candidate validation.

- [ ] **Step 1: Write failing layer and edit tests**

Add a snapshot fixture containing page, frame, shadow, and target nodes, then add:

```ts
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
```

- [ ] **Step 2: Run Selector tests and verify RED**

Run: `npm test -- --test-name-pattern="candidate layers|frame layer"`

Expected: layer kind/type assertions fail because only ancestor/target exist.

- [ ] **Step 3: Build layers from the complete target path**

Change the union:

```ts
kind: "page" | "frame" | "shadow" | "ancestor" | "target";
```

Replace `buildTargetLayers` with path-derived construction:

```ts
const path = getElementPath(root, target.id);
const page = path.find((node) => node.kind === "page");
const boundaries = path.filter((node) => node.kind === "frame" || node.kind === "shadow");
const ordinaryAncestors = path
  .filter((node) => node.tagName && (node.kind ?? "element") === "element" && !["html", "body"].includes(node.tagName))
  .slice(-2);
```

Create page and boundary layers from their host nodes, using stable host attributes. Keep only the target layer enabled by default, plus all page/frame/shadow layers required to reach it. Keep optional ordinary ancestors disabled by default.

Update validation to partition nodes by their ordered context signature. An enabled frame/shadow layer must match the corresponding boundary and host constraints before the target layer is evaluated. If a required boundary is disabled, do not claim the original target is consistent.

- [ ] **Step 4: Verify Selector regression tests GREEN**

Run: `npm test -- --test-name-pattern="Selector|candidate|layer|export"`

Expected: Phase 2 tests and new context tests all pass.

- [ ] **Step 5: Commit Selector contexts**

```bash
git add src/shared/selector.ts src/shared/selector.test.ts
git commit -m "feat: add frame and shadow selector layers"
```

---

### Task 4: Playwright and Selenium context exports

**Files:**
- Modify: `src/shared/selector.ts`
- Modify: `src/shared/selector.test.ts`

**Interfaces:**
- Consumes: enabled page/frame/shadow/ancestor/target layers from Task 3.
- Produces: ordered Playwright `frameLocator` chains and Selenium `switch_to.frame`/`shadow_root` entry code.

- [ ] **Step 1: Write failing export tests**

```ts
test("Playwright export enters nested frames before locating shadow content", () => {
  const candidate = generateSelectorCandidates(contextSnapshot, "shadow-input").find((item) => item.type === "playwright");
  assert.ok(candidate);
  const output = buildSelectorExports(candidate).playwright;
  assert.match(output, /page\.frameLocator\('\[title="Payment frame"\]'\)/);
  assert.match(output, /Open Shadow DOM: open-widget/);
  assert.ok(output.indexOf("frameLocator") < output.indexOf("getByTestId(\"shadow-query\")"));
});

test("Selenium export enters frames and shadow roots in order", () => {
  const candidate = generateSelectorCandidates(contextSnapshot, "shadow-input").find((item) => item.type === "css");
  assert.ok(candidate);
  const output = buildSelectorExports(candidate).selenium;
  assert.match(output, /driver\.switch_to\.frame/);
  assert.match(output, /shadow_root = .*\.shadow_root/);
  assert.match(output, /shadow_root\.find_element/);
});
```

- [ ] **Step 2: Run export tests and verify RED**

Run: `npm test -- --test-name-pattern="enters nested frames|enters frames and shadow"`

Expected: current exports contain only `page.locator` and `driver.find_element`.

- [ ] **Step 3: Serialize enabled context entry steps**

Implement focused helpers:

```ts
function buildPlaywrightLocator(layers: SelectorLayer[]): string;
function buildSeleniumStatements(layers: SelectorLayer[], cssSelector: string): string[];
function serializeBoundaryHost(layer: SelectorLayer): string;
```

For Playwright, start with `page`, append `.frameLocator(<host selector>)` for each enabled frame, add `// Open Shadow DOM: <host selector>` comments for enabled shadow boundaries, then append the semantic target locator. Playwright locators pierce open Shadow DOM by default; XPath candidates inside shadow contexts must fall back to a CSS/semantic locator because XPath does not pierce shadow roots.

For Selenium, locate and switch each frame, then assign each enabled shadow host's `.shadow_root`, finally call `find_element` on the deepest active search context.

Include `context` and layer diagnostics in JSON. If a candidate contains an inaccessible-context diagnostic, emit explanatory comments instead of runnable success code.

- [ ] **Step 4: Run all Selector tests and verify GREEN**

Run: `npm test -- --test-name-pattern="export|Playwright|Selenium"`

Expected: all export tests pass.

- [ ] **Step 5: Commit exports**

```bash
git add src/shared/selector.ts src/shared/selector.test.ts
git commit -m "feat: export frame and shadow selector chains"
```

---

### Task 5: Context-aware tree, properties, and layer editor UI

**Files:**
- Modify: `src/renderer/components/WorkbenchLayout.tsx`
- Modify: `src/renderer/i18n/messages.ts`
- Modify: `src/renderer/styles/global.css`

**Interfaces:**
- Consumes: node `kind`, `context`, `diagnostic`, and expanded Selector layer kinds.
- Produces: visible tree boundary badges, localized diagnostics, context paths, and labels for all five layer types.

- [ ] **Step 1: Run typecheck to establish the pre-UI baseline**

Run: `npm run typecheck`

Expected: exit 0 before the UI change.

- [ ] **Step 2: Add exhaustive layer and node presentation helpers**

In `WorkbenchLayout.tsx`, import `Box`, `Layers3`, and `ShieldAlert` from Lucide and reuse the existing `Globe2` and `PanelRight` imports, then add:

```tsx
function selectorLayerLabel(kind: SelectorLayer["kind"], t: (key: MessageKey) => string): string {
  return t(`selector.layer.${kind}` as MessageKey);
}

function TreeNodeIcon({ node }: { node: ElementSnapshot }): JSX.Element {
  if (node.kind === "page") return <Globe2 size={13} />;
  if (node.kind === "frame") return <PanelRight size={13} />;
  if (node.kind === "shadow") return <Layers3 size={13} />;
  if (node.kind === "diagnostic") return <ShieldAlert size={13} />;
  return <Box size={13} />;
}
```

Use the helpers in `VirtualTree`, add a compact `FRAME`, `SHADOW`, or `LIMIT` badge, and render `node.diagnostic` text without making a diagnostic row selectable as a normal target.

In `ElementDetails`, add context cards that display ordered frame and shadow host paths plus a localized limitation card when `element.diagnostic` exists.

In `SelectorPanel`, replace the target/ancestor conditional with the exhaustive five-kind label. Retain the existing per-layer enabled, tag-enabled, attribute-enabled, and value-edit controls.

- [ ] **Step 3: Add localized messages and styles**

Add `MessageKey` entries and Chinese/English values for:

```text
selector.layer.page, selector.layer.frame, selector.layer.shadow,
selector.layer.ancestor, selector.layer.target,
properties.context, properties.framePath, properties.shadowPath,
diagnostic.crossOriginFrame, diagnostic.closedShadowRoot, diagnostic.detachedContext,
tree.badge.page, tree.badge.frame, tree.badge.shadow, tree.badge.limit
```

Add `.tree-node-kind`, `.tree-kind-badge`, `.context-path`, and `.context-diagnostic` styles using existing color tokens and density variables. Do not introduce hard-coded colors outside the current token system.

- [ ] **Step 4: Run typecheck and build**

Run: `npm run typecheck`

Expected: no missing message keys, icon imports, or non-exhaustive layer handling.

Run: `npm run build`

Expected: Vite production build exits 0.

- [ ] **Step 5: Commit UI support**

```bash
git add src/renderer/components/WorkbenchLayout.tsx src/renderer/i18n/messages.ts src/renderer/styles/global.css
git commit -m "feat: show frame and shadow context in explorer"
```

---

### Task 6: End-to-end verification and documentation

**Files:**
- Modify: `README.md`
- Modify locally: `REQUIREMENTS.md` (ignored by Git; Phase 8 task 8.6 is already present)

**Interfaces:**
- Consumes: all Phase 3 behavior.
- Produces: verified release-facing documentation and acceptance evidence.

- [ ] **Step 1: Run the full automated verification suite**

Run: `npm test`

Expected: every Node test passes.

Run: `npm run typecheck`

Expected: Electron and renderer TypeScript checks pass.

Run: `npm run build`

Expected: production artifacts build successfully.

- [ ] **Step 2: Perform manual Electron acceptance checks**

Start the app with `npm run dev`, connect to a Chrome/Edge target launched with `--remote-debugging-port=9222`, then verify:

1. `iframe.html`: select `card-number` and nested `confirm-payment`; tree and properties show the full ordered frame path.
2. Picking and highlighting work in both same-origin frame depths.
3. `shadow-dom.html`: select `shadow-query` and the nested open widget; tree and properties show the full shadow path.
4. Closed host shows a limitation row and cannot report an internal picked element.
5. Frame and shadow layers can be disabled/re-enabled and validation changes immediately.
6. Playwright export enters frame contexts in order and locates open-shadow targets.

- [ ] **Step 3: Update README capability and limitation text**

Document same-origin nested frame support, open Shadow DOM context paths, context-aware exports, and the explicit Phase 8 deferral for cross-origin/OOPIF traversal. Keep the existing setup and command instructions unchanged.

- [ ] **Step 4: Re-run documentation-adjacent checks**

Run: `git diff --check`

Expected: no whitespace errors.

Run: `npm test && npm run typecheck && npm run build`

Expected: all commands exit 0.

- [ ] **Step 5: Commit documentation**

```bash
git add README.md
git commit -m "docs: document phase 3 context support"
```

---

## Plan self-review result

- Every Phase 3 requirement maps to Tasks 1-6.
- Cross-origin/OOPIF scope is explicitly deferred and locally recorded as Phase 8 task 8.6.
- Public type names, layer kinds, script exports, and verification commands are consistent across tasks.
- No runtime dependency or IPC expansion is required.
