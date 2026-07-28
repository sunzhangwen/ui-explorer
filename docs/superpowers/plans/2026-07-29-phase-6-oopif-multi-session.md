# Phase 6 OOPIF Multi-Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-page CDP connection with a browser-level flat-session model that captures, picks, highlights, validates, and exports elements inside cross-origin iframe/OOPIF contexts.

**Architecture:** One browser WebSocket routes commands and events by optional `sessionId`. A pure context registry tracks target, frame, loader, execution-context, and detach state; `BrowserSession` orchestrates attachment and stitches per-session snapshots into the existing `ElementSnapshot` tree so the renderer keeps one unified model.

**Tech Stack:** Electron 33, Node.js 22, TypeScript 5.7, Chrome DevTools Protocol, React 18, Zustand 5, Node test runner.

## Global Constraints

- Use the browser WebSocket returned by `/json/version`; do not open one WebSocket per OOPIF.
- Use flat CDP sessions and recursively enable `Target.setAutoAttach`.
- Never reuse a session, loader, execution context, or snapshot token after navigation or detach.
- Keep Playwright and Selenium exports portable; temporary CDP `sessionId` values are not replay conditions.
- Preserve same-origin iframe and open Shadow DOM behavior.
- Keep closed Shadow Root unsupported.
- Use RED/GREEN for context, mapping, serialization, and IPC behavior.
- Do not modify generated files under `dist/`, `dist-electron/`, `.vite/`, or `.tmp-tests/`.

---

## Planned File Structure

- Create `src/main/cdpConnection.ts`: browser WebSocket transport, flat-session command routing, event subscriptions.
- Create `src/main/cdpConnection.test.ts`: response/event routing and disconnect behavior.
- Create `src/main/webContextRegistry.ts`: pure frame/target/session lifecycle state machine.
- Create `src/main/webContextRegistry.test.ts`: attach, navigation, execution-context, detach, and diagnostic tests.
- Create `src/main/multiSessionSnapshot.ts`: namespace and stitch per-session snapshots, translate boxes, preserve diagnostics.
- Create `src/main/multiSessionSnapshot.test.ts`: merge and invalid-context tests.
- Modify `src/main/browserSession.ts`: browser endpoint connection, selected target attachment, recursive auto-attach, snapshot/action orchestration.
- Modify `src/main/browserSession.test.ts`: orchestration and stale-token tests.
- Modify `src/main/browserScripts.ts`: exact frame-host markers and per-document runtime element references.
- Modify `src/main/browserScripts.test.ts`: marker and namespaced runtime behavior.
- Modify `src/shared/ipc.ts`: context routing metadata and Phase 6 diagnostics.
- Modify `src/shared/domSnapshot.ts`: context signatures include stable frame identity.
- Modify `src/shared/selector.ts`: portable export plus OOPIF JSON diagnostics.
- Modify `src/shared/selector.test.ts`: OOPIF export regression tests.
- Modify `src/renderer/i18n/messages.ts`: Chinese and English Phase 6 diagnostics.
- Modify `src/renderer/components/workbenchPresentation.ts`: diagnostic presentation mapping.
- Modify `src/renderer/components/workbenchPresentation.test.ts`: Phase 6 presentation tests.
- Modify `src/types/global.d.ts`: injected frame markers and per-document runtime registries.
- Modify `src/shared/ipc.ts`: register the OOPIF fixture.
- Create `public/test-pages/oopif.html`: cross-site parent fixture.
- Create `public/test-pages/oopif-child.html`: selectable child, nested frame, navigation, and multiple-match fixture.
- Modify `tsconfig.test.json`: include new main-process modules and tests.

---

### Task 1: Flat CDP Connection

**Files:**
- Create: `src/main/cdpConnection.ts`
- Create: `src/main/cdpConnection.test.ts`
- Modify: `tsconfig.test.json`
- Modify: `src/main/browserSession.ts`

**Interfaces:**
- Produces: `CdpConnection.connect(url)`, `disconnect()`, `isConnected()`, `send<T>(method, params?, sessionId?)`, and `onEvent(listener)`.
- Produces: `CdpEvent = { method: string; params: Record<string, unknown>; sessionId?: string }`.
- Consumes: `encodeClientTextFrame`, `encodeClientCloseFrame`, and `extractServerTextFrames`.

- [ ] **Step 1: Add failing router tests**

```ts
test("routes flat-session responses by command id", async () => {
  const router = new CdpMessageRouter();
  const pending = router.createPending<{ ok: boolean }>(7);
  router.accept(JSON.stringify({ id: 7, sessionId: "child-1", result: { ok: true } }));
  assert.deepEqual(await pending, { ok: true });
});

test("emits flat-session events with their session id", () => {
  const router = new CdpMessageRouter();
  const events: CdpEvent[] = [];
  router.onEvent((event) => events.push(event));
  router.accept(JSON.stringify({
    method: "Page.frameNavigated",
    sessionId: "child-1",
    params: { frame: { id: "frame-1" } }
  }));
  assert.equal(events[0].sessionId, "child-1");
});
```

- [ ] **Step 2: Compile and run the new tests**

Run:

```powershell
npx tsc -p tsconfig.test.json
node --test .tmp-tests/main/cdpConnection.test.js
```

Expected: FAIL because `CdpMessageRouter` and `CdpConnection` do not exist.

- [ ] **Step 3: Extract the transport and implement routing**

```ts
export type CdpEvent = {
  method: string;
  params: Record<string, unknown>;
  sessionId?: string;
};

export class CdpConnection {
  async send<T>(
    method: string,
    params?: Record<string, unknown>,
    sessionId?: string
  ): Promise<T> {
    const id = ++this.sequence;
    const payload = JSON.stringify({ id, method, params, sessionId });
    return this.router.createPending<T>(id, () => {
      this.socket?.write(encodeClientTextFrame(payload));
    });
  }
}
```

Move the existing WebSocket handshake and socket cleanup from `browserSession.ts` without changing framing behavior. Parse `sessionId` only as routing metadata; response lookup remains by globally increasing command ID.

- [ ] **Step 4: Run transport regressions**

Run:

```powershell
npx tsc -p tsconfig.test.json
node --test .tmp-tests/main/cdpConnection.test.js .tmp-tests/main/webSocketFrames.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit the transport**

```powershell
git add src/main/cdpConnection.ts src/main/cdpConnection.test.ts src/main/browserSession.ts tsconfig.test.json
git commit -m "refactor: add flat CDP connection routing"
```

---

### Task 2: Web Context Lifecycle Registry

**Files:**
- Create: `src/main/webContextRegistry.ts`
- Create: `src/main/webContextRegistry.test.ts`
- Modify: `tsconfig.test.json`

**Interfaces:**
- Consumes: `CdpEvent`.
- Produces: `WebContextRecord`, `WebContextDiagnosticCode`, and `WebContextRegistry`.
- Produces: `accept(event)`, `registerRoot(input)`, `getBySessionId(sessionId)`, `getByFrameId(frameId)`, `getActiveContexts()`, and `invalidateSession(sessionId, code, detail)`.

- [ ] **Step 1: Add failing lifecycle tests**

```ts
test("maps an attached iframe target to its flat session", () => {
  const registry = new WebContextRegistry();
  registry.accept({
    method: "Target.attachedToTarget",
    params: {
      sessionId: "session-child",
      targetInfo: { targetId: "frame-child", type: "iframe", url: "https://child.test" }
    }
  });
  assert.equal(registry.getBySessionId("session-child")?.targetId, "frame-child");
});

test("navigation invalidates the previous loader and execution context", () => {
  const registry = seededRegistry();
  registry.accept(frameNavigated("session-child", "frame-child", "loader-b"));
  const child = registry.getBySessionId("session-child");
  assert.equal(child?.loaderId, "loader-b");
  assert.equal(child?.executionContextId, undefined);
  assert.equal(child?.revision, 2);
});

test("detached sessions cannot be returned as active", () => {
  const registry = seededRegistry();
  registry.accept({
    method: "Target.detachedFromTarget",
    params: { sessionId: "session-child", targetId: "frame-child" }
  });
  assert.equal(registry.getActiveContexts().some((item) => item.sessionId === "session-child"), false);
  assert.equal(registry.getBySessionId("session-child")?.state, "detached");
});
```

- [ ] **Step 2: Run the lifecycle test and observe RED**

Run:

```powershell
npx tsc -p tsconfig.test.json
node --test .tmp-tests/main/webContextRegistry.test.js
```

Expected: FAIL because the registry is missing.

- [ ] **Step 3: Implement a discriminated lifecycle model**

```ts
export type WebContextRecord =
  | ActiveWebContext
  | { state: "attaching"; targetId: string; sessionId: string; revision: number }
  | {
      state: "detached" | "unavailable";
      targetId: string;
      sessionId: string;
      revision: number;
      diagnostic: WebContextDiagnostic;
    };

export type ActiveWebContext = {
  state: "active" | "navigating";
  targetId: string;
  sessionId: string;
  frameId?: string;
  parentFrameId?: string;
  loaderId?: string;
  executionContextId?: number;
  executionContextUniqueId?: string;
  revision: number;
};
```

Apply events exhaustively. Only default page execution contexts with `auxData.isDefault === true` populate execution-context fields. `frameDetached`, `executionContextsCleared`, and target detach increment the revision and clear runtime identity before marking state.

- [ ] **Step 4: Run lifecycle tests**

Run:

```powershell
npx tsc -p tsconfig.test.json
node --test .tmp-tests/main/webContextRegistry.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit the registry**

```powershell
git add src/main/webContextRegistry.ts src/main/webContextRegistry.test.ts tsconfig.test.json
git commit -m "feat: track multi-session web contexts"
```

---

### Task 3: Browser-Level Attachment and Recursive Auto-Attach

**Files:**
- Modify: `src/main/browserSession.ts`
- Modify: `src/main/browserSession.test.ts`
- Modify: `src/main/browserDiscovery.ts`
- Modify: `src/main/browserDiscovery.test.ts`

**Interfaces:**
- Consumes: `CdpConnection` and `WebContextRegistry`.
- Produces: selected root target attachment through `Target.attachToTarget({ targetId, flatten: true })`.
- Produces: recursive `Target.setAutoAttach({ autoAttach: true, waitForDebuggerOnStart: false, flatten: true })`.

- [ ] **Step 1: Add failing attachment orchestration tests**

```ts
test("connects through the browser websocket and attaches the selected page in flat mode", async () => {
  const commands = createRecordingConnection({
    "Target.attachToTarget": { sessionId: "root-session" }
  });
  const session = createBrowserSessionHarness(commands);
  await session.selectTarget("page-1");
  assert.deepEqual(commands.sent[0], {
    method: "Target.attachToTarget",
    params: { targetId: "page-1", flatten: true },
    sessionId: undefined
  });
});

test("enables recursive auto attach on every newly attached iframe session", async () => {
  const harness = createAttachedBrowserSession();
  harness.emit(attachedIframe("child-session", "child-target"));
  await harness.flushEvents();
  assert.ok(harness.commands.sent.some((command) =>
    command.method === "Target.setAutoAttach" &&
    command.sessionId === "child-session"
  ));
});
```

- [ ] **Step 2: Run the BrowserSession test and observe RED**

Run:

```powershell
npx tsc -p tsconfig.test.json
node --test .tmp-tests/main/browserSession.test.js .tmp-tests/main/browserDiscovery.test.js
```

Expected: FAIL because `BrowserSession` still opens the selected page WebSocket directly.

- [ ] **Step 3: Fetch browser metadata and attach the root**

```ts
type BrowserVersionMetadata = {
  browser: string;
  webSocketDebuggerUrl: string;
};

private async connectSelectedTarget(targetId: string): Promise<void> {
  const { sessionId } = await this.connection.send<{ sessionId: string }>(
    "Target.attachToTarget",
    { targetId, flatten: true }
  );
  this.registry.registerRoot({ targetId, sessionId });
  await this.initializeSession(sessionId);
}
```

`initializeSession` sends `Runtime.enable`, attempts `Page.enable` and `DOM.enable`, then sends recursive `Target.setAutoAttach`. Event processing must be serialized so a detach cannot overtake initialization.

- [ ] **Step 4: Preserve target refresh and reconnection semantics**

Keep the public `BrowserConnectionInfo` statuses. A replacement root target closes the old attachment graph, clears the registry, attaches the replacement target, and returns `reconnected`.

- [ ] **Step 5: Run attachment regressions**

Run:

```powershell
npx tsc -p tsconfig.test.json
node --test .tmp-tests/main/browserSession.test.js .tmp-tests/main/browserDiscovery.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit browser-level attachment**

```powershell
git add src/main/browserSession.ts src/main/browserSession.test.ts src/main/browserDiscovery.ts src/main/browserDiscovery.test.ts
git commit -m "feat: attach browser targets with flat CDP sessions"
```

---

### Task 4: Multi-Session Snapshot Stitching

**Files:**
- Create: `src/main/multiSessionSnapshot.ts`
- Create: `src/main/multiSessionSnapshot.test.ts`
- Modify: `src/main/browserScripts.ts`
- Modify: `src/main/browserScripts.test.ts`
- Modify: `src/main/browserSession.ts`
- Modify: `src/shared/ipc.ts`
- Modify: `src/shared/domSnapshot.ts`
- Modify: `src/types/global.d.ts`
- Modify: `tsconfig.test.json`

**Interfaces:**
- Produces: `SessionSnapshot = { sessionId; frameId; revision; result }`.
- Produces: `stitchSessionSnapshots(root, children, owners): DomSnapshotResult`.
- Adds to `ContextBoundary`: optional stable `frameId`, `targetId`, and runtime-only `sessionId`.
- Adds to boundary `SelectorLayer`: optional `boundary?: ContextBoundary`, copied from the corresponding frame or Shadow boundary node.
- Adds diagnostics: `frame-attach-failed`, `frame-owner-unresolved`, `navigation-invalidated`, `session-detached`.

- [ ] **Step 1: Add failing stitching tests**

```ts
test("replaces a cross-origin placeholder with a namespaced child document", () => {
  const result = stitchSessionSnapshots(rootSnapshot(), [childSnapshot()], [
    { parentSessionId: "root", childSessionId: "child", hostLocalId: "n-4", frameId: "frame-child" }
  ]);
  const child = findElementSnapshot(result.root, "child::n-1");
  assert.equal(child?.context?.[0].frameId, "frame-child");
  assert.equal(child?.parentId, "root::n-4");
});

test("keeps a diagnostic when the child frame owner cannot be resolved", () => {
  const result = stitchSessionSnapshots(rootSnapshot(), [childSnapshot()], []);
  assert.equal(findDiagnostic(result.root, "frame-owner-unresolved")?.kind, "diagnostic");
});

test("translates a child box through its frame owner chain", () => {
  assert.deepEqual(
    translateBoundingBox({ x: 5, y: 7, width: 20, height: 10 }, [{ x: 100, y: 40 }]),
    { x: 105, y: 47, width: 20, height: 10 }
  );
});

test("validates selector matches across the stitched OOPIF tree", () => {
  const result = stitchedRootWithDuplicateChildButtons();
  const candidates = generateSelectorCandidates(result.root, "child::n-3");
  assert.deepEqual(candidates[0].validation.matchedElementIds, ["child::n-3"]);
});
```

- [ ] **Step 2: Run snapshot tests and observe RED**

Run:

```powershell
npx tsc -p tsconfig.test.json
node --test .tmp-tests/main/multiSessionSnapshot.test.js .tmp-tests/main/browserScripts.test.js
```

Expected: FAIL because the stitcher and frame markers are missing.

- [ ] **Step 3: Add exact frame-host marking**

Resolve each child frame with `DOM.getFrameOwner`, then `DOM.resolveNode`. Call a function on the returned iframe object:

```ts
await connection.send("Runtime.callFunctionOn", {
  objectId,
  functionDeclaration: `function(frameId, targetId) {
    Object.defineProperty(this, "__uiExplorerFrameContext", {
      configurable: true,
      enumerable: false,
      value: { frameId, targetId }
    });
  }`,
  arguments: [{ value: frameId }, { value: targetId }]
}, parentSessionId);
```

The snapshot script copies that marker into the frame boundary and returns only the current Session document as a root when the document is an OOPIF target.

- [ ] **Step 4: Implement immutable namespacing and stitching**

```ts
export function namespaceSnapshotNode(
  node: ElementSnapshot,
  sessionId: string,
  parentId?: string
): ElementSnapshot {
  const id = `${sessionId}::${node.id}`;
  return {
    ...node,
    id,
    parentId,
    childIds: node.children.map((child) => `${sessionId}::${child.id}`),
    children: node.children.map((child) => namespaceSnapshotNode(child, sessionId, id))
  };
}
```

Replace only the diagnostic child belonging to the resolved frame boundary. Preserve closed-shadow diagnostics. Recompute `depth`, `childIds`, `nodeCount`, and top-level boxes after stitching.

- [ ] **Step 5: Reject snapshots that changed during capture**

Read each context revision before evaluation and compare it after all evaluations. If any revision changed, return or throw a deterministic `navigation-invalidated` result instead of combining stale and current documents.

- [ ] **Step 6: Run snapshot and shared model regressions**

Run:

```powershell
npx tsc -p tsconfig.test.json
node --test .tmp-tests/main/multiSessionSnapshot.test.js .tmp-tests/main/browserScripts.test.js .tmp-tests/shared/domSnapshot.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit unified snapshots**

```powershell
git add src/main/multiSessionSnapshot.ts src/main/multiSessionSnapshot.test.ts src/main/browserScripts.ts src/main/browserScripts.test.ts src/main/browserSession.ts src/shared/ipc.ts src/shared/domSnapshot.ts src/types/global.d.ts tsconfig.test.json
git commit -m "feat: stitch OOPIF sessions into DOM snapshots"
```

---

### Task 5: Cross-Session Picker and Highlight Routing

**Files:**
- Modify: `src/main/browserSession.ts`
- Modify: `src/main/browserSession.test.ts`
- Modify: `src/main/browserScripts.ts`
- Modify: `src/main/browserScripts.test.ts`
- Modify: `src/shared/highlightDiagnostics.ts`
- Modify: `src/shared/highlightDiagnostics.test.ts`

**Interfaces:**
- Consumes: global IDs in the form `<sessionId>::<localId>`.
- Produces: per-session picker installation and polling.
- Produces: grouped per-session highlighting with original global IDs restored in `HighlightResult`.

- [ ] **Step 1: Add failing routing tests**

```ts
test("groups highlight requests by owning session", async () => {
  const harness = createMultiSessionHarness();
  const result = await harness.session.highlightElements({
    elementIds: ["root::n-2", "child::n-3"],
    snapshotToken: harness.snapshotToken
  });
  assert.deepEqual(harness.evaluations.map((item) => item.sessionId), ["root", "child"]);
  assert.deepEqual(result.targets.map((item) => item.elementId), ["root::n-2", "child::n-3"]);
});

test("ignores picker results from a detached snapshot revision", async () => {
  const harness = createMultiSessionHarness();
  harness.registry.invalidateSession("child", "session-detached", "detached");
  assert.equal(await harness.session.getPickedElementId(), null);
});
```

- [ ] **Step 2: Run routing tests and observe RED**

Run:

```powershell
npx tsc -p tsconfig.test.json
node --test .tmp-tests/main/browserSession.test.js .tmp-tests/main/browserScripts.test.js
```

Expected: FAIL because actions still evaluate only in the root Session.

- [ ] **Step 3: Implement opaque global ID parsing and grouped evaluation**

```ts
export function parseRuntimeElementId(id: string): { sessionId: string; localId: string } | null {
  const boundary = id.indexOf("::");
  return boundary > 0
    ? { sessionId: id.slice(0, boundary), localId: id.slice(boundary + 2) }
    : null;
}
```

Validate the request snapshot token and recorded context revision before evaluation. Group local IDs by Session, execute `HIGHLIGHT_SCRIPT` once per Session, and map every returned local ID back to the requested global ID.

- [ ] **Step 4: Install and poll pickers across active sessions**

On enable, evaluate `ELEMENT_PICKER_SCRIPT` in all active page/iframe Sessions. On `Target.attachedToTarget`, install it in the new Session if picker mode remains enabled. Poll all active Sessions concurrently; return the first valid global element ID and clear other pending results.

- [ ] **Step 5: Run picker/highlight regressions**

Run:

```powershell
npx tsc -p tsconfig.test.json
node --test .tmp-tests/main/browserSession.test.js .tmp-tests/main/browserScripts.test.js .tmp-tests/shared/highlightDiagnostics.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit cross-session actions**

```powershell
git add src/main/browserSession.ts src/main/browserSession.test.ts src/main/browserScripts.ts src/main/browserScripts.test.ts src/shared/highlightDiagnostics.ts src/shared/highlightDiagnostics.test.ts
git commit -m "feat: route picker and highlights across CDP sessions"
```

---

### Task 6: OOPIF Diagnostics and Portable Exports

**Files:**
- Modify: `src/shared/selector.ts`
- Modify: `src/shared/selector.test.ts`
- Modify: `src/renderer/i18n/messages.ts`
- Modify: `src/renderer/components/workbenchPresentation.ts`
- Modify: `src/renderer/components/workbenchPresentation.test.ts`

**Interfaces:**
- Consumes: extended `ContextBoundary` and `SnapshotDiagnosticCode`.
- Produces: unchanged `SelectorExports = { json; playwright; selenium }`.
- Produces: bilingual presentation for every Phase 6 diagnostic.

- [ ] **Step 1: Add failing export and presentation tests**

```ts
test("OOPIF exports use stable frame selectors rather than CDP session ids", () => {
  const candidate = oopifSelectorCandidate({
    frameId: "frame-child",
    targetId: "target-child",
    sessionId: "temporary-session"
  });
  const output = buildSelectorExports(candidate);
  assert.match(output.playwright, /frameLocator\\('iframe\\[title="Payment"\\]'\\)/);
  assert.match(output.selenium, /switch_to\\.frame/);
  assert.doesNotMatch(output.playwright + output.selenium, /temporary-session/);
  assert.equal(JSON.parse(output.json).context.frameChain[0].frameId, "frame-child");
});

test("presents a detached OOPIF session as a limitation", () => {
  assert.deepEqual(getDiagnosticPresentation(diagnostic("session-detached")), {
    messageKey: "diagnostic.sessionDetached",
    tone: "danger"
  });
});
```

- [ ] **Step 2: Run export tests and observe RED**

Run:

```powershell
npx tsc -p tsconfig.test.json
node --test .tmp-tests/shared/selector.test.js .tmp-tests/renderer/components/workbenchPresentation.test.js
```

Expected: FAIL because Phase 6 diagnostic codes and JSON context metadata are missing.

- [ ] **Step 3: Extend JSON without changing portable code**

```ts
context: {
  frameChain: frameLayers.map((layer) => ({
    selector: serializeBoundaryHost(layer),
    frameId: layer.boundary?.frameId,
    targetId: layer.boundary?.targetId
  })),
  shadowChain: shadowLayers.map((layer) => serializeBoundaryHost(layer))
}
```

Playwright and Selenium continue deriving navigation only from enabled stable frame layers. Do not serialize `sessionId` into executable code.

- [ ] **Step 4: Add exhaustive diagnostic presentation and i18n**

Add Chinese and English keys for attach failure, unresolved owner, invalidated navigation, and detached Session. Use an exhaustive switch so a new `SnapshotDiagnosticCode` fails TypeScript compilation until mapped.

- [ ] **Step 5: Run selector and presentation regressions**

Run:

```powershell
npx tsc -p tsconfig.test.json
node --test .tmp-tests/shared/selector.test.js .tmp-tests/renderer/components/workbenchPresentation.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit diagnostics and exports**

```powershell
git add src/shared/selector.ts src/shared/selector.test.ts src/renderer/i18n/messages.ts src/renderer/components/workbenchPresentation.ts src/renderer/components/workbenchPresentation.test.ts
git commit -m "feat: export and diagnose OOPIF contexts"
```

---

### Task 7: OOPIF Fixture and Phase Verification

**Files:**
- Create: `public/test-pages/oopif.html`
- Create: `public/test-pages/oopif-child.html`
- Modify: `src/shared/ipc.ts`
- Modify: `src/renderer/i18n/messages.ts`
- Modify: `REQUIREMENTS.md`

**Interfaces:**
- Produces: test page ID `oopif`.
- Produces: hostname-switched child URL using the current port.
- Updates: Phase 6 milestone status only after automated and browser verification passes.

- [ ] **Step 1: Add the deterministic cross-site fixture**

```html
<script>
  const childHost = location.hostname === "127.0.0.1" ? "localhost" : "127.0.0.1";
  const childUrl = `${location.protocol}//${childHost}:${location.port}/test-pages/oopif-child.html`;
  document.querySelector("#oopif-frame").src = childUrl;
</script>
```

The child page contains `button[data-testid="oopif-action"]`, two `.duplicate-action` buttons, a nested iframe, and a button that changes the child URL query string to force navigation.

- [ ] **Step 2: Register bilingual fixture metadata**

```ts
{
  id: "oopif",
  titleKey: "testPages.oopif.title",
  descriptionKey: "testPages.oopif.description",
  path: "/test-pages/oopif.html"
}
```

- [ ] **Step 3: Run the complete automated suite**

Run:

```powershell
npm test
npm run typecheck
npm run build
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 4: Perform browser acceptance**

Launch Chrome or Edge with a remote debugging port and default Site Isolation, open the OOPIF fixture, then verify:

1. The child document appears below the correct iframe with a complete frame path.
2. `data-testid="oopif-action"` can be picked from the child.
3. Single and multiple child matches highlight in the child document.
4. Playwright and Selenium exports enter the correct frame.
5. Navigating the child invalidates the old selection and permits a new snapshot.
6. Removing the iframe or detaching the Session yields a limitation diagnostic.

- [ ] **Step 5: Mark Phase 6 complete only after acceptance**

Change the Phase 6 roadmap row and section status from `计划中` to `已完成`, preserving its acceptance criteria.

- [ ] **Step 6: Re-run documentation checks**

Run:

```powershell
git diff --check
git status --short
```

Expected: no whitespace errors; only intended Phase 6 files are modified.

- [ ] **Step 7: Commit the completed phase**

```powershell
git add public/test-pages/oopif.html public/test-pages/oopif-child.html src/shared/ipc.ts src/renderer/i18n/messages.ts REQUIREMENTS.md
git commit -m "feat: complete Phase 6 OOPIF support"
```
