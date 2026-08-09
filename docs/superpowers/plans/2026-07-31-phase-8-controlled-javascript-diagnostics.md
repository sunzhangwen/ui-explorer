# Phase 8 Controlled JavaScript Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add reviewable JavaScript generation, one-time confirmed execution in the selected element's exact CDP Session, deterministic diagnostics, and temporary attribute editing.

**Architecture:** Keep code generation and advice as shared pure functions, keep one-time execution plans and runtime wrapping in a focused main-process module, and let `BrowserSession` own snapshot/session validation and CDP routing. Add two narrow IPC methods and a standalone React panel; transient editor/confirmation/result state stays local to the workbench rather than persisted in Zustand.

**Tech Stack:** TypeScript 5.7, Electron 33 IPC/context bridge, Chrome DevTools Protocol `Runtime.evaluate`, React 18, Zustand 5, Monaco Editor, Node test runner.

## Global Constraints

- Phase 8 is diagnostic JavaScript only; do not add automation flows, scheduling, loops, script persistence, network interception, AI calls, or page-data uploads.
- Every execution requires a successful preflight and a 60-second, single-use token bound to code, element, snapshot, Session, and Session revision.
- Limit source to 50 KB, CDP execution to 5 seconds, and serialized output by depth, entry count, string length, and total character count.
- OOPIF execution starts in its owning child Session; generated code must not pretend that parent-page `contentDocument` can cross an origin boundary.
- Mutation side effects are not reversible. The UI must never describe this feature as sandboxed or side-effect-free.
- Use RED/GREEN for generation, serialization, token, routing, and IPC contract behavior.
- Preserve user changes and do not edit generated `dist/`, `dist-electron/`, `.vite/`, or `.tmp-tests/` files directly.

---

### Task 1: Shared Diagnostic Drafts, Risks, and Suggestions

**Files:**
- Create: `src/shared/javascriptDiagnostics.ts`
- Create: `src/shared/javascriptDiagnostics.test.ts`

**Interfaces:**
- Consumes: `ElementSnapshot`, `ContextBoundary`, and `BrowserTarget` from `src/shared/ipc.ts`; `SelectorCandidate` from `src/shared/selector.ts`.
- Produces:

```ts
export const JAVASCRIPT_DIAGNOSTIC_CODE_LIMIT = 50 * 1024;
export const JAVASCRIPT_DIAGNOSTIC_TIMEOUT_MS = 5_000;
export const JAVASCRIPT_DIAGNOSTIC_PLAN_TTL_MS = 60_000;

export type JavaScriptDiagnosticStrategy =
  | "dom-query"
  | "tree-traversal"
  | "context-traversal";

export type JavaScriptDiagnosticIntent = "inspect" | "mutate-dom";
export type JavaScriptDiagnosticRiskCode = "arbitrary-code" | "dom-mutation";

export type JavaScriptDiagnosticDraft = {
  strategy: JavaScriptDiagnosticStrategy;
  intent: JavaScriptDiagnosticIntent;
  code: string;
  risks: JavaScriptDiagnosticRiskCode[];
};

export type AttributeEditDraft = {
  attributeName: string;
  attributeValue: string;
};

export type JavaScriptDiagnosticSuggestionCode =
  | "refresh-snapshot"
  | "add-stable-constraint"
  | "avoid-dynamic-attribute"
  | "use-context-traversal"
  | "oopif-session-routing"
  | "reduce-traversal-scope";

export function generateJavaScriptDiagnosticDraft(input: {
  element: ElementSnapshot;
  candidate: SelectorCandidate | null;
  strategy: JavaScriptDiagnosticStrategy;
}): JavaScriptDiagnosticDraft;

export function generateAttributeEditDraft(
  edit: AttributeEditDraft
): JavaScriptDiagnosticDraft;

export function getJavaScriptDiagnosticSuggestions(input: {
  element: ElementSnapshot;
  candidate: SelectorCandidate | null;
  failure?: "timeout" | "stale-target";
}): JavaScriptDiagnosticSuggestionCode[];

export function validateJavaScriptDiagnosticCode(
  code: string
): { ok: true } | { ok: false; code: "empty-code" | "code-too-large" };
```

- Context generation uses only boundaries inside the element's owning Session. For a namespaced element ID, skip the OOPIF boundary whose `sessionId` equals the namespace and preserve subsequent same-origin frame and Shadow boundaries.
- All embedded selectors, attribute names, values, and text are encoded with `JSON.stringify`.

- [ ] **Step 1: Write failing generation and validation tests**

Add tests with minimal `ElementSnapshot` and `SelectorCandidate` fixtures:

```ts
test("DOM query draft searches the target root with an encoded selector", () => {
  const draft = generateJavaScriptDiagnosticDraft({
    element: button({ id: 'n-2', attributes: { 'aria-label': 'Save "draft"' } }),
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
});
```

- [ ] **Step 2: Run the shared test and verify RED**

Run: `npm test -- --test-name-pattern="diagnostic|attribute edit|code validation"`

Expected: TypeScript compilation fails because `javascriptDiagnostics.ts` and its exports do not exist.

- [ ] **Step 3: Implement minimal pure generation helpers**

Implement deterministic helpers with these rules:

```ts
const literal = (value: string): string => JSON.stringify(value);

function getOwningSessionId(elementId: string): string | null {
  const boundary = elementId.indexOf("::");
  return boundary > 0 ? elementId.slice(0, boundary) : null;
}

function getInSessionContext(element: ElementSnapshot): ContextBoundary[] {
  const context = element.context ?? [];
  const sessionId = getOwningSessionId(element.id);
  if (!sessionId) return context;
  let owningBoundary = -1;
  for (let index = 0; index < context.length; index += 1) {
    if (context[index]?.sessionId === sessionId) owningBoundary = index;
  }
  return owningBoundary >= 0 ? context.slice(owningBoundary + 1) : context;
}
```

Use `$target.getRootNode()` for DOM queries, `TreeWalker` plus encoded text/attribute predicates for traversal, and an explicit `root` variable for context traversal. Frame steps use `root.querySelector(encodedHostSelector)?.contentDocument`; Shadow steps use `root.querySelector(encodedHostSelector)?.shadowRoot`. Every missing boundary throws an error naming the failed step. Return a compact array of matched element summaries rather than raw DOM objects.

`generateAttributeEditDraft` emits:

```ts
if (!$target?.isConnected) throw new Error("The selected element is detached.");
$target.setAttribute(<encoded-name>, <encoded-value>);
return {
  tagName: $target.tagName.toLowerCase(),
  attributeName: <encoded-name>,
  attributeValue: $target.getAttribute(<encoded-name>)
};
```

- [ ] **Step 4: Add suggestion-rule tests and implementation**

Test zero/multiple/mismatch validation, dynamic id/class risks, context presence, OOPIF session metadata, timeout, and stale-target. Implement suggestion accumulation with a `Set` so output order is stable and duplicates are removed.

- [ ] **Step 5: Run the shared tests and verify GREEN**

Run: `npm test -- --test-name-pattern="diagnostic|attribute edit|code validation"`

Expected: all Task 1 tests pass.

- [ ] **Step 6: Commit the shared behavior**

```powershell
git add src/shared/javascriptDiagnostics.ts src/shared/javascriptDiagnostics.test.ts
git commit -m "feat: generate controlled JavaScript diagnostics"
```

---

### Task 2: One-Time Plans and Runtime Result Serialization

**Files:**
- Create: `src/main/diagnosticExecution.ts`
- Create: `src/main/diagnosticExecution.test.ts`
- Modify: `tsconfig.test.json`

**Interfaces:**
- Consumes: constants and intent types from `src/shared/javascriptDiagnostics.ts`. Runtime wrapper types stay internal until Task 3 maps them to the public IPC union.
- Produces:

```ts
export type DiagnosticExecutionPlanInput = {
  code: string;
  codeDigest: string;
  elementId: string;
  localElementId: string;
  snapshotToken: string;
  sessionId: string;
  sessionRevision: number;
  intent: JavaScriptDiagnosticIntent;
};

export type StoredDiagnosticExecutionPlan = DiagnosticExecutionPlanInput & {
  executionId: string;
  expiresAt: string;
};

export class DiagnosticExecutionPlanStore {
  constructor(options?: {
    now?: () => number;
    createId?: () => string;
    ttlMs?: number;
  });
  create(input: DiagnosticExecutionPlanInput): StoredDiagnosticExecutionPlan;
  consume(executionId: string):
    | { status: "ready"; plan: StoredDiagnosticExecutionPlan }
    | { status: "missing" }
    | { status: "expired" };
  clear(): void;
}

export function digestDiagnosticCode(code: string): string;
export function buildDiagnosticRuntimeExpression(input: {
  code: string;
  localElementId: string;
  snapshotToken: string;
}): string;
export function isRuntimeTimeoutError(error: unknown): boolean;
```

- [ ] **Step 1: Write failing token lifecycle tests**

```ts
test("execution plans expire and are consumed once", () => {
  let now = Date.parse("2026-07-31T10:00:00.000Z");
  const store = new DiagnosticExecutionPlanStore({
    now: () => now,
    createId: () => "execution-1",
    ttlMs: 60_000
  });
  const plan = store.create(planInput());

  assert.equal(plan.executionId, "execution-1");
  assert.equal(store.consume("execution-1").status, "ready");
  assert.equal(store.consume("execution-1").status, "missing");

  store.create(planInput());
  now += 60_001;
  assert.equal(store.consume("execution-1").status, "expired");
});

test("code digest changes when source changes", () => {
  assert.notEqual(digestDiagnosticCode("return 1"), digestDiagnosticCode("return 2"));
});
```

- [ ] **Step 2: Run the main-process test and verify RED**

Run: `npm test -- --test-name-pattern="execution plans|code digest"`

Expected: TypeScript compilation fails because `diagnosticExecution.ts` does not exist.

- [ ] **Step 3: Implement the plan store and SHA-256 digest**

Use `node:crypto` `createHash("sha256")` and `randomUUID`. `consume` must delete before returning any status so no rejected or successful execution can be retried with the same ID.

- [ ] **Step 4: Write failing runtime-wrapper tests**

Evaluate the generated expression against a fake registry:

```ts
test("runtime wrapper distinguishes undefined and cyclic objects", async () => {
  const target = { nodeType: 1, tagName: "BUTTON", isConnected: true };
  const fakeWindow = {
    __uiExplorerSnapshotToken: "snapshot-a",
    __uiExplorerElements: new Map([["n-2", target]])
  };

  const undefinedResult = await evaluateExpression(
    buildDiagnosticRuntimeExpression({
      code: "return undefined;",
      localElementId: "n-2",
      snapshotToken: "snapshot-a"
    }),
    fakeWindow
  );
  assert.deepEqual(undefinedResult, {
    status: "success",
    value: { kind: "undefined" }
  });

  const cyclicResult = await evaluateExpression(
    buildDiagnosticRuntimeExpression({
      code: "const value = {}; value.self = value; return value;",
      localElementId: "n-2",
      snapshotToken: "snapshot-a"
    }),
    fakeWindow
  );
  assert.equal(cyclicResult.status, "success");
  assert.match(JSON.stringify(cyclicResult), /Circular/);
});
```

Also test DOM-node summaries, functions, throwing accessors, long strings, missing registry targets, user exceptions, and async return values.

- [ ] **Step 5: Implement the runtime wrapper and timeout classifier**

The generated expression must:

1. Compare `window.__uiExplorerSnapshotToken` to the bound token.
2. Read the exact local element from `window.__uiExplorerElements` and return `stale-target` if absent or detached.
3. Construct an async function from the encoded source and invoke it with `$target`.
4. Convert the return into a JSON-safe discriminated value.
5. Catch user exceptions and return `{ status: "exception", message, stack }`.

Serialization limits are fixed constants in this file: depth 5, 100 entries per container, 20,000 characters per string, 100,000 total emitted characters. DOM-node detection uses structural fields so Node tests do not require a browser global.

`isRuntimeTimeoutError` recognizes CDP errors containing `timed out`, `timeout`, or `Execution was terminated`, case-insensitively.

- [ ] **Step 6: Add the new test files to `tsconfig.test.json` and verify GREEN**

Add `src/main/diagnosticExecution.ts` and `src/main/diagnosticExecution.test.ts` to `include`.

Run: `npm test -- --test-name-pattern="execution plans|code digest|runtime wrapper"`

Expected: all Task 2 tests pass.

- [ ] **Step 7: Commit the execution primitives**

```powershell
git add src/main/diagnosticExecution.ts src/main/diagnosticExecution.test.ts tsconfig.test.json
git commit -m "feat: secure diagnostic execution plans"
```

---

### Task 3: Snapshot-Bound BrowserSession Routing

**Files:**
- Modify: `src/shared/ipc.ts`
- Modify: `src/main/browserSession.ts`
- Modify: `src/main/browserSession.test.ts`

**Interfaces:**
- Add these public IPC models in `src/shared/ipc.ts`:

```ts
export type PrepareJavaScriptDiagnosticRequest = {
  elementId: string;
  snapshotToken: string | null;
  code: string;
  strategy: JavaScriptDiagnosticStrategy;
  intent: JavaScriptDiagnosticIntent;
};

export type PreparedJavaScriptDiagnosticTarget = {
  browserTargetId: string;
  title: string;
  url: string;
  elementId: string;
  tagName: string;
  context: ContextBoundary[];
};

export type PrepareJavaScriptDiagnosticResult =
  | {
      status: "prepared";
      executionId: string;
      expiresAt: string;
      codeDigest: string;
      risks: JavaScriptDiagnosticRiskCode[];
      target: PreparedJavaScriptDiagnosticTarget;
    }
  | {
      status: "rejected";
      code:
        | "empty-code"
        | "code-too-large"
        | "stale-snapshot"
        | "invalid-element"
        | "session-unavailable";
      message: string;
    };

export type JavaScriptDiagnosticValue =
  | { kind: "undefined" }
  | { kind: "null" }
  | { kind: "boolean"; value: boolean }
  | { kind: "number"; value: number | string }
  | { kind: "string"; value: string; truncated: boolean }
  | { kind: "bigint" | "symbol" | "function"; value: string }
  | { kind: "dom-node"; tagName: string; id: string; className: string; text: string }
  | { kind: "object" | "array"; value: unknown; truncated: boolean };

export type ExecuteJavaScriptDiagnosticRequest = { executionId: string };

export type ExecuteJavaScriptDiagnosticResult =
  | { status: "success"; value: JavaScriptDiagnosticValue; mutatedDom: boolean }
  | { status: "exception"; message: string; stack?: string }
  | { status: "timeout"; message: string }
  | { status: "stale-target"; message: string }
  | { status: "validation-error"; message: string }
  | { status: "connection-error"; message: string };
```

- Add to `BrowserSession`:

```ts
async prepareJavaScriptDiagnostic(
  request: PrepareJavaScriptDiagnosticRequest
): Promise<PrepareJavaScriptDiagnosticResult>;

async executeJavaScriptDiagnostic(
  request: ExecuteJavaScriptDiagnosticRequest
): Promise<ExecuteJavaScriptDiagnosticResult>;
```

- [ ] **Step 1: Write failing preparation-routing tests**

Extend `RecordingConnection` so each command records `sessionId`. Create a stitched snapshot containing `child-session::n-2`, then assert:

```ts
const prepared = await session.prepareJavaScriptDiagnostic({
  elementId: "child-session::n-2",
  snapshotToken: stitched.snapshotToken ?? null,
  code: "return $target.textContent;",
  strategy: "dom-query",
  intent: "inspect"
});

assert.equal(prepared.status, "prepared");
assert.ok(connection.sent.some((command) =>
  command.method === "Runtime.evaluate" &&
  command.sessionId === "child-session"
));
assert.equal(connection.sent.some((command) =>
  command.method === "Runtime.evaluate" &&
  command.sessionId === "root-session" &&
  String(command.params?.expression).includes("n-2")
), false);
```

Add rejection tests for mismatched snapshot token, invalid global element ID, inactive Session, navigation revision changes, and element absence from the stitched snapshot.

- [ ] **Step 2: Run routing tests and verify RED**

Run: `npm test -- --test-name-pattern="JavaScript diagnostic"`

Expected: compilation fails because the BrowserSession methods and IPC models do not exist.

- [ ] **Step 3: Extend snapshot routing and implement preflight**

Extend `lastSnapshotRouting` with the stitched root and a global element map built from `flattenElementSnapshot(stitched.root)`. Preflight performs shared code validation, parses the global ID, checks route revision, locates the target snapshot, and evaluates this read-only registry probe in the exact Session:

```ts
(() =>
  window.__uiExplorerSnapshotToken === <encoded-token> &&
  window.__uiExplorerElements?.has(<encoded-local-id>) === true
)()
```

Only a true probe creates a stored execution plan. Prepared target metadata comes from `selectedTarget` plus the element snapshot; do not expose the raw Session ID to Renderer.

- [ ] **Step 4: Write failing execution tests**

Cover exact child Session routing, `Runtime.evaluate` parameters, single-use tokens, mutation flags, CDP exception details, timeout errors, stale runtime targets, navigation between preflight and execute, and disconnect clearing plans. Assert `timeout: 5_000`, `awaitPromise: true`, and `returnByValue: true` are sent.

- [ ] **Step 5: Implement execution and invalidation**

Consume the token before any asynchronous call. Re-check active Session and revision, call `buildDiagnosticRuntimeExpression`, and map the runtime result to the IPC union. Map CDP timeout errors with `isRuntimeTimeoutError`; map other transport errors to `connection-error`. Call `planStore.clear()` from `disconnect` and when selecting or reconnecting a top-level target.

- [ ] **Step 6: Run focused BrowserSession tests and verify GREEN**

Run: `npm test -- --test-name-pattern="JavaScript diagnostic"`

Expected: all prepare, execute, stale, timeout, and routing tests pass.

- [ ] **Step 7: Run the complete main-process regression subset**

Run: `npm test -- --test-name-pattern="BrowserSession|WebContextRegistry|JavaScript diagnostic"`

Expected: existing browser lifecycle and multi-Session tests remain green.

- [ ] **Step 8: Commit BrowserSession routing**

```powershell
git add src/shared/ipc.ts src/main/browserSession.ts src/main/browserSession.test.ts
git commit -m "feat: route diagnostics to exact CDP sessions"
```

---

### Task 4: IPC, Preload, and Store Wiring

**Files:**
- Modify: `src/shared/ipc.ts`
- Modify: `src/main/main.ts`
- Modify: `src/main/preload.cts`
- Modify: `src/renderer/store/useAppStore.ts`

**Interfaces:**
- Add channels `prepareJavaScriptDiagnostic: "browser:prepare-javascript-diagnostic"` and `executeJavaScriptDiagnostic: "browser:execute-javascript-diagnostic"`.
- Extend `IpcApi` and `AppStore` with identically typed `prepareJavaScriptDiagnostic` and `executeJavaScriptDiagnostic` functions.

- [ ] **Step 1: Add the typed channel and API contract**

Update `IpcApi`:

```ts
prepareJavaScriptDiagnostic: (
  request: PrepareJavaScriptDiagnosticRequest
) => Promise<PrepareJavaScriptDiagnosticResult>;
executeJavaScriptDiagnostic: (
  request: ExecuteJavaScriptDiagnosticRequest
) => Promise<ExecuteJavaScriptDiagnosticResult>;
```

Use the shared `IPC_CHANNELS` keys in `main.ts`. Keep the duplicated preload channel literals synchronized because `preload.cts` cannot import the ESM runtime object under the current build setup.

- [ ] **Step 2: Register main-process handlers and preload bridge methods**

Both handlers forward the untrusted value to `BrowserSession`; the BrowserSession method validates it before reading fields. Add runtime request guards in `src/shared/javascriptDiagnostics.ts`:

```ts
export function isPrepareJavaScriptDiagnosticRequest(
  value: unknown
): value is PrepareJavaScriptDiagnosticRequest;

export function isExecuteJavaScriptDiagnosticRequest(
  value: unknown
): value is ExecuteJavaScriptDiagnosticRequest;
```

Invalid input returns `rejected/invalid-element` for preflight or `validation-error` for execution rather than throwing across IPC.

- [ ] **Step 3: Add request-guard tests and run RED/GREEN**

Test non-object input, missing fields, unsupported strategy/intent, blank execution ID, and a valid request.

Run: `npm test -- --test-name-pattern="diagnostic request"`

Expected after implementation: all guard tests pass.

- [ ] **Step 4: Wire Store actions and non-Electron fallbacks**

Store actions call `getApi()` without persisting result state. The fallback API returns stable typed failures:

```ts
prepareJavaScriptDiagnostic: async () => ({
  status: "rejected",
  code: "session-unavailable",
  message: "Electron IPC is not available."
}),
executeJavaScriptDiagnostic: async () => ({
  status: "connection-error",
  message: "Electron IPC is not available."
})
```

- [ ] **Step 5: Run typecheck and shared tests**

Run: `npm run typecheck`

Expected: main, preload, shared API, fallback API, and Store signatures agree with no TypeScript errors.

Run: `npm test -- --test-name-pattern="diagnostic request|JavaScript diagnostic"`

Expected: request guards and BrowserSession integration pass.

- [ ] **Step 6: Commit the IPC surface**

```powershell
git add src/shared/ipc.ts src/main/main.ts src/main/preload.cts src/renderer/store/useAppStore.ts src/shared/javascriptDiagnostics.ts src/shared/javascriptDiagnostics.test.ts
git commit -m "feat: expose controlled diagnostic IPC"
```

---

### Task 5: JavaScript Diagnostics Panel and Attribute Edit Handoff

**Files:**
- Create: `src/renderer/components/JavaScriptDiagnosticsPanel.tsx`
- Create: `src/renderer/components/MonacoCodeEditor.tsx`
- Create: `src/renderer/components/javascriptDiagnosticsState.ts`
- Create: `src/renderer/components/javascriptDiagnosticsState.test.ts`
- Modify: `src/renderer/components/WorkbenchLayout.tsx`
- Modify: `src/renderer/store/useAppStore.ts`
- Modify: `src/renderer/i18n/messages.ts`
- Modify: `src/renderer/styles/global.css`
- Modify: `tsconfig.test.json`

**Interfaces:**
- `JavaScriptDiagnosticsPanel` receives:

```ts
export type JavaScriptDiagnosticsPanelProps = {
  element: ElementSnapshot | null;
  root: ElementSnapshot | null;
  candidate: SelectorCandidate | null;
  browserTarget: BrowserTarget | null;
  snapshotToken: string | null;
  theme: ThemeName;
  requestedAttributeEdit: AttributeEditDraft | null;
  onAttributeEditConsumed: () => void;
  onPrepare: IpcApi["prepareJavaScriptDiagnostic"];
  onExecute: IpcApi["executeJavaScriptDiagnostic"];
  onMutationComplete: () => Promise<void>;
};
```

- `javascriptDiagnosticsState.ts` produces a pure reducer that binds prepared/result state to `elementId`, `snapshotToken`, `code`, and `executionId`. Any editor or target change clears confirmation and prepared state.

- [ ] **Step 1: Write failing state reducer tests**

```ts
test("editing code invalidates a prepared diagnostic", () => {
  const prepared = reduceDiagnosticPanelState(initialDiagnosticPanelState, {
    type: "prepared",
    binding: binding({ code: "return 1", executionId: "execution-1" })
  });

  const edited = reduceDiagnosticPanelState(prepared, {
    type: "code-changed",
    code: "return 2"
  });

  assert.equal(edited.prepared, null);
  assert.equal(edited.confirmed, false);
  assert.equal(edited.result, null);
});

test("a result for an old element is ignored", () => {
  const state = stateFor("element-a", "snapshot-a");
  const next = reduceDiagnosticPanelState(state, {
    type: "execution-finished",
    binding: binding({ elementId: "element-b" }),
    result: successResult()
  });
  assert.equal(next, state);
});
```

- [ ] **Step 2: Run reducer tests and verify RED**

Run: `npm test -- --test-name-pattern="prepared diagnostic|old element"`

Expected: compilation fails because the state module does not exist.

- [ ] **Step 3: Implement the pure reducer and add it to test compilation**

Use a discriminated action union and exhaustive `never` branch. Store request binding explicitly; do not infer freshness from the current UI after an async result returns.

- [ ] **Step 4: Implement the standalone panel**

The panel includes:

- Three strategy buttons and a Monaco JavaScript editor.
- Page title/URL, tag, and context path summary.
- Fixed arbitrary-code warning plus mutation warning when applicable.
- Deterministic suggestions rendered from message keys.
- “Prepare execution” action.
- Prepared card with target, expiry, code digest, confirmation checkbox, and disabled-by-default “Execute once” action.
- Result card with exhaustive rendering for every execution result status.

Create a shared lazy wrapper so the new editor and the existing Selector/table previews do not eagerly load Monaco:

```ts
import { lazy, Suspense } from "react";
import type { EditorProps } from "@monaco-editor/react";

const Editor = lazy(() => import("@monaco-editor/react"));

export function MonacoCodeEditor(props: EditorProps): JSX.Element {
  return (
    <Suspense fallback={<div className="editor-loading" aria-hidden="true" />}>
      <Editor {...props} />
    </Suspense>
  );
}
```

Replace the direct `@monaco-editor/react` import and all existing `Editor` uses in `WorkbenchLayout.tsx` with this wrapper. Give `.editor-loading` the same fixed height as its containing editor shell to prevent layout shift. Do not read Store state inside the panel; pass only the required props and callbacks.

- [ ] **Step 5: Add attribute-edit handoff in `ElementDetails`**

Extend `ElementDetails` with `onEditAttribute: (edit: AttributeEditDraft) => void`. Add controlled name/value inputs and a “Review JavaScript” submit button. Submission validates non-empty attribute name, lifts the draft to `WorkbenchLayout`, opens the JavaScript panel, and does not call IPC.

`WorkbenchLayout` owns only the sibling handoff state:

```ts
const [requestedAttributeEdit, setRequestedAttributeEdit] =
  useState<AttributeEditDraft | null>(null);
```

The diagnostic panel consumes it, generates a mutation draft, then invokes `onAttributeEditConsumed`. After a successful result with `mutatedDom: true`, call `refreshDomSnapshot()` exactly once.

- [ ] **Step 6: Add the right-panel section and localized copy**

Extend `RightPanelSectionId` with `"javascript"`, default it to open, and add a `CollapsibleSection` between Selector and Table. Add complete Chinese and English keys for strategy labels, target/risk text, prepare/confirm/execute actions, all result states, suggestions, attribute edit, empty states, and expiry.

- [ ] **Step 7: Add focused styles**

Add `.javascript-diagnostics-panel`, `.javascript-target-card`, `.javascript-risk-card`, `.javascript-confirmation`, `.javascript-result`, and `.attribute-edit-form`. Reuse existing CSS variables, status colors, button sizing, Monaco shell, and responsive right-panel behavior.

- [ ] **Step 8: Verify reducer tests and renderer compilation**

Run: `npm test -- --test-name-pattern="prepared diagnostic|old element"`

Expected: reducer tests pass.

Run: `npm run typecheck`

Expected: React props, i18n keys, Store actions, and IPC unions are exhaustive and type-safe.

- [ ] **Step 9: Commit the diagnostic UI**

```powershell
git add src/renderer/components/JavaScriptDiagnosticsPanel.tsx src/renderer/components/MonacoCodeEditor.tsx src/renderer/components/javascriptDiagnosticsState.ts src/renderer/components/javascriptDiagnosticsState.test.ts src/renderer/components/WorkbenchLayout.tsx src/renderer/store/useAppStore.ts src/renderer/i18n/messages.ts src/renderer/styles/global.css tsconfig.test.json
git commit -m "feat: add JavaScript diagnostics workbench"
```

---

### Task 6: Fixtures, Documentation, and Phase Verification

**Files:**
- Modify: `public/test-pages/basic-dom.html`
- Modify: `public/test-pages/iframe-child.html`
- Modify: `public/test-pages/shadow-dom.html`
- Modify: `public/test-pages/oopif-child.html`
- Modify: `README.md`
- Modify: `REQUIREMENTS.md`
- Modify: `docs/superpowers/specs/2026-07-31-phase-8-controlled-javascript-diagnostics-design.md` only if implementation reveals a necessary factual correction

**Interfaces:**
- Test elements use stable `data-testid="phase-8-diagnostic-target"` identifiers and distinct text per context.
- One fixture exposes page functions that return `undefined`, a cyclic object, a DOM node, a rejected promise, and a never-settling promise for manual result verification.

- [ ] **Step 1: Add representative fixture targets**

Add a stable target to each context without changing existing selectors. In `basic-dom.html`, expose:

```html
<button data-testid="phase-8-diagnostic-target" data-phase="before">
  Phase 8 diagnostic target
</button>
<script>
  window.phase8Diagnostics = {
    undefinedValue: () => undefined,
    cyclicValue: () => {
      const value = { label: "cycle" };
      value.self = value;
      return value;
    },
    domNode: () => document.querySelector('[data-testid="phase-8-diagnostic-target"]'),
    rejection: async () => { throw new Error("Phase 8 expected failure"); },
    never: () => new Promise(() => {})
  };
</script>
```

Use equivalent stable target markup inside the existing iframe, Shadow, and OOPIF fixtures.

- [x] **Step 2: Run all automated tests**

Run: `npm test`

Expected: every shared, main-process, routing, reducer, selector, table, and existing regression test passes with no warnings from application code.

- [x] **Step 3: Run typecheck and production build**

Run: `npm run typecheck`

Expected: both Electron and Renderer TypeScript projects pass.

Run: `npm run build`

Expected: Electron compilation and Vite production build complete successfully; Monaco is emitted as a separate lazy-loaded chunk.

- [x] **Step 4: Perform browser acceptance**

Run `npm run dev`, use UI Explorer's managed Chrome flow, and check:

1. Ordinary DOM, iframe, open Shadow, and OOPIF targets generate valid drafts.
2. Prepared target metadata identifies the intended page and context.
3. Execute is disabled before confirmation and each token works once.
4. OOPIF evaluation appears only in the child Session command log/test evidence.
5. `undefined`, cyclic objects, DOM nodes, rejection, and 5-second timeout render distinct results.
6. Attribute editing shows code first, changes only after confirmation, and refreshes the snapshot.
7. Editing source or switching target invalidates preflight and confirmation.

- [x] **Step 5: Update capability documentation and roadmap status**

Update README current capabilities, directory map, test-page coverage, and development status to include controlled JavaScript diagnostics and completed OOPIF/advanced table functionality. In `REQUIREMENTS.md`, mark Phase 8 as completed only after Steps 2–4 pass, preserving the diagnostic-only boundary and Phase 9+ ordering.

- [x] **Step 6: Run final diff and whitespace checks**

Run: `git diff --check`

Expected: no whitespace errors.

Run: `git status --short`

Expected: only Phase 8 implementation, tests, fixtures, and documentation are modified.

- [x] **Step 7: Commit verified Phase 8 completion**

```powershell
git add README.md REQUIREMENTS.md public/test-pages/basic-dom.html public/test-pages/iframe-child.html public/test-pages/shadow-dom.html public/test-pages/oopif-child.html
git commit -m "docs: record Phase 8 verification"
```

## Verification Record

- Automated verification: 290 tests passed; Electron and Renderer typechecks passed; the production build passed; `git diff --check` reported no errors.
- Browser contexts: ordinary DOM, same-origin iframe, open Shadow DOM, and OOPIF targets produced valid drafts and executed in their intended contexts. OOPIF routing was additionally covered by exact child-Session command tests.
- Safety gate: execution remained disabled until the bound confirmation was checked; editing source invalidated the prepared execution and confirmation; one-time and expired plan behavior is covered by automated and browser evidence.
- Results: `undefined`, cyclic objects, DOM nodes, Promise rejection, and the 5-second timeout rendered distinct bounded results. Runtime intrinsic pollution, malformed return shapes, transport stalls, and oversized exception details have regression coverage.
- Mutation: attribute editing displayed generated code before execution, changed the DOM only after confirmation, and refreshed the snapshot to show `data-phase="after"`.
- Editor: Monaco loaded from the bundled local dependency and workers; runtime resource inspection showed no jsDelivr request.

## Plan Self-Review Result

- Tasks 1–6 cover requirements 8.1–8.6, temporary attribute editing, ordinary DOM/iframe/Shadow/OOPIF acceptance, and the no-AI/no-upload boundary.
- Shared IPC type names, BrowserSession method names, Store actions, and panel props are consistent across tasks.
- Production behavior is always introduced after an observed failing test for pure logic, execution, routing, request guards, or stale UI state.
- UI-only wiring, styles, localized copy, fixture markup, and documentation use proportional verification rather than artificial unit tests.
- No step introduces execution history, persistence, scheduling, automation orchestration, isolated worlds, or cross-origin `contentDocument` access.
