# Managed Chrome Launch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Windows-only workflow that reuses or launches an isolated Chrome debugging instance, opens custom or built-in test URLs in a new tab, and atomically connects UI Explorer to that target.

**Architecture:** Shared pure functions own URL normalization and typed IPC contracts. Focused main-process modules own Chrome discovery/settings, process lifecycle, the loopback fixture server, and workflow orchestration; BrowserSession owns CDP target creation/attachment. Zustand consumes one atomic result plus request-scoped progress events, while WorkbenchLayout provides the left-panel controls.

**Tech Stack:** Electron 33, Node.js child processes/filesystem/http/net, Chrome DevTools Protocol, React 18, Zustand 5, TypeScript 5.7, node:test.

## Global Constraints

- First release supports Google Chrome on Windows only.
- Reuse only loopback CDP endpoints; keep the existing manual remote connection path unchanged.
- Always create and select a new tab; never navigate or replace an existing tab.
- Use `<Electron userData>/chrome-profile`; never use the default Chrome profile.
- Close only a Chrome instance started by the current UI Explorer process.
- Keep custom URLs session-only and out of logs/persisted Zustand state.
- Use `spawn(executable, args, { shell: false })`; never build a shell command string.
- Production test fixtures must be served only over IPv4/IPv6 loopback.
- Use RED/GREEN for URL semantics, process ownership, CDP target creation, IPC contracts, and state transitions.

---

## File Structure

- Create `src/shared/chromeLaunch.ts`: URL normalization, error/status unions, request/result/progress types, runtime guards.
- Create `src/shared/chromeLaunch.test.ts`: pure URL and guard tests.
- Create `src/main/chromeExecutable.ts`: persisted Chrome settings and executable discovery/validation.
- Create `src/main/chromeExecutable.test.ts`: dependency-injected filesystem/settings tests.
- Create `src/main/chromeInstanceManager.ts`: endpoint choice, port selection, spawn/readiness, ownership, shutdown.
- Create `src/main/chromeInstanceManager.test.ts`: injected endpoint/spawn/timer tests.
- Create `src/main/testPageServer.ts`: development URL resolution and production loopback static server.
- Create `src/main/testPageServer.test.ts`: whitelist, MIME, path and lifecycle tests.
- Create `src/main/chromePageWorkflow.ts`: atomic source resolution, endpoint reuse/launch, BrowserSession handoff.
- Create `src/main/chromePageWorkflow.test.ts`: workflow fallback and result tests.
- Modify `src/main/browserSession.ts`: create, attach and snapshot a new CDP Target.
- Modify `src/main/browserSession.test.ts`: exact target selection and retry tests.
- Modify `src/shared/ipc.ts`: add Chrome workflow types, methods and channels.
- Modify `src/main/preload.cts`: expose open/progress APIs.
- Modify `src/main/main.ts`: instantiate services, register IPC, and close owned resources on quit.
- Modify `src/renderer/store/useAppStore.ts`: request-scoped ChromeOpenState and atomic result handling.
- Modify `src/renderer/components/WorkbenchLayout.tsx`: left card and per-test-page launch actions.
- Modify `src/renderer/i18n/messages.ts`: Chinese/English labels and stable error messages.
- Modify `src/renderer/styles/global.css`: card, field, progress, error, and row-action styles.
- Modify `src/renderer/components/workbenchPresentation.ts`: pure UI labels/status mapping where useful.
- Modify `src/renderer/components/workbenchPresentation.test.ts`: localized state/error mapping tests.
- Modify `tsconfig.test.json`: include every new pure/main test module.
- Modify `README.md`: replace manual-only startup instructions with one-click and fallback documentation.

---

### Task 1: Shared URL and IPC Domain Model

**Files:**
- Create: `src/shared/chromeLaunch.ts`
- Create: `src/shared/chromeLaunch.test.ts`
- Modify: `src/shared/ipc.ts`
- Modify: `tsconfig.test.json`

**Interfaces:**
- Produces: `normalizeChromePageUrl(input: string): ChromePageUrlResult`
- Produces: `ChromeOpenState`, `ChromeLaunchProgressStage`, `ChromeLaunchErrorCode`, `OpenChromePageRequest`, `OpenChromePageProgress`, `OpenChromePageResult`
- Produces: `isOpenChromePageRequest(value: unknown): value is OpenChromePageRequest`
- Consumes: existing `BrowserConnectionInfo`, `DomSnapshotResult`

- [ ] **Step 1: Write failing URL and runtime-guard tests**

Cover empty input, explicit allowed protocols, localhost/private IPv4 HTTP defaults, domain/public-IP HTTPS defaults, and rejected schemes:

```ts
assert.deepEqual(normalizeChromePageUrl("  "), { ok: true, url: "about:blank" });
assert.deepEqual(normalizeChromePageUrl("localhost:5173/a"), {
  ok: true,
  url: "http://localhost:5173/a"
});
assert.deepEqual(normalizeChromePageUrl("example.com/a"), {
  ok: true,
  url: "https://example.com/a"
});
assert.deepEqual(normalizeChromePageUrl("javascript:alert(1)"), {
  ok: false,
  code: "invalid-url"
});
assert.equal(isOpenChromePageRequest({ requestId: "r1", source: { kind: "test-page", id: "table" } }), true);
```

- [ ] **Step 2: Run the focused tests and observe RED**

Run: `npm.cmd test -- --test-name-pattern="ChromeLaunch"`

Expected: compilation fails because `chromeLaunch.ts` and its exports do not exist.

- [ ] **Step 3: Implement exact shared unions and normalization**

Implement the discriminated types from the design and use `node:net.isIP` plus explicit RFC1918/link-local checks:

```ts
export type ChromePageUrlResult =
  | { ok: true; url: string }
  | { ok: false; code: "invalid-url" };

export function normalizeChromePageUrl(input: string): ChromePageUrlResult {
  const value = input.trim();
  if (!value) return { ok: true, url: "about:blank" };
  const candidate = hasAllowedScheme(value)
    ? value
    : `${usesHttpDefault(value) ? "http" : "https"}://${value}`;
  try {
    const parsed = new URL(candidate);
    return ALLOWED_PROTOCOLS.has(parsed.protocol)
      ? { ok: true, url: parsed.href }
      : { ok: false, code: "invalid-url" };
  } catch {
    return { ok: false, code: "invalid-url" };
  }
}
```

- [ ] **Step 4: Run focused tests and typecheck**

Run: `npm.cmd test -- --test-name-pattern="ChromeLaunch"`

Expected: URL and request guard tests pass.

Run: `npm.cmd run typecheck`

Expected: shared URL and domain types compile without changing the existing runtime IPC surface.

- [ ] **Step 5: Commit**

```powershell
git add src/shared/chromeLaunch.ts src/shared/chromeLaunch.test.ts src/shared/ipc.ts tsconfig.test.json
git commit -m "feat: define managed Chrome launch contracts"
```

### Task 2: Chrome Executable Discovery and Persisted Settings

**Files:**
- Create: `src/main/chromeExecutable.ts`
- Create: `src/main/chromeExecutable.test.ts`
- Modify: `tsconfig.test.json`

**Interfaces:**
- Consumes: absolute `settingsPath` and injected `fileExists`, `readFile`, `writeFile`, `selectExecutable`
- Produces: `ChromeExecutableLocator.resolve(): Promise<{ status: "found"; path: string } | { status: "cancelled" }>`
- Produces: `ChromeLaunchSettingsStore.read()` and `.update(patch)`

- [ ] **Step 1: Write failing discovery/settings tests**

```ts
test("ChromeExecutable prefers a valid saved path", async () => {
  const locator = createLocator({
    savedPath: "C:\\Tools\\Chrome\\chrome.exe",
    existing: new Set(["C:\\Tools\\Chrome\\chrome.exe"])
  });
  assert.deepEqual(await locator.resolve(), {
    status: "found",
    path: "C:\\Tools\\Chrome\\chrome.exe"
  });
});

test("ChromeExecutable continues after manual selection", async () => {
  const locator = createLocator({
    selectedPath: "C:\\Chrome\\chrome.exe",
    existing: new Set(["C:\\Chrome\\chrome.exe"])
  });
  assert.equal((await locator.resolve()).status, "found");
});
```

Also test invalid basename, missing saved path, cancellation, malformed settings JSON and atomic settings replacement.

- [ ] **Step 2: Run focused tests and observe RED**

Run: `npm.cmd test -- --test-name-pattern="ChromeExecutable"`

Expected: compilation fails because the locator/store do not exist.

- [ ] **Step 3: Implement discovery without shell execution**

```ts
export class ChromeExecutableLocator {
  async resolve(): Promise<ChromeExecutableResult> {
    for (const candidate of await this.getCandidates()) {
      if (await this.isValid(candidate)) {
        await this.settings.update({ chromeExecutablePath: candidate });
        return { status: "found", path: candidate };
      }
    }
    const selected = await this.selectExecutable();
    if (!selected) return { status: "cancelled" };
    if (!(await this.isValid(selected))) {
      throw new ChromeLaunchError("invalid-chrome-path");
    }
    await this.settings.update({ chromeExecutablePath: selected });
    return { status: "found", path: selected };
  }
}
```

Common candidates must derive only from `LOCALAPPDATA`, `PROGRAMFILES` and `PROGRAMFILES(X86)`. Settings writes use a sibling temporary file followed by rename.

- [ ] **Step 4: Run tests**

Run: `npm.cmd test -- --test-name-pattern="ChromeExecutable"`

Expected: all locator/settings tests pass.

- [ ] **Step 5: Commit**

```powershell
git add src/main/chromeExecutable.ts src/main/chromeExecutable.test.ts tsconfig.test.json
git commit -m "feat: discover and remember Chrome executable"
```

### Task 3: Managed Chrome Instance Lifecycle

**Files:**
- Create: `src/main/chromeInstanceManager.ts`
- Create: `src/main/chromeInstanceManager.test.ts`
- Modify: `src/main/browserDiscovery.ts`
- Modify: `src/main/browserDiscovery.test.ts`
- Modify: `tsconfig.test.json`

**Interfaces:**
- Consumes: `ChromeExecutableLocator`, `ChromeLaunchSettingsStore`, `discoverBrowserEndpoints`
- Produces: `ChromeInstanceManager.resolveEndpoint(preferredEndpoint?, onProgress): Promise<ChromeEndpointResolution>`
- Produces: `ChromeInstanceManager.closeManaged(): Promise<void>`

- [ ] **Step 1: Write failing endpoint, spawn and ownership tests**

Use injected `probe`, `isPortAvailable`, `spawnChrome`, `waitForEndpoint`, and `closeBrowser`:

```ts
assert.deepEqual(await manager.resolveEndpoint("localhost:9222", progress), {
  ownership: "external",
  endpoint: "http://localhost:9222"
});
assert.deepEqual(spawnCall.args, [
  "--remote-debugging-address=127.0.0.1",
  "--remote-debugging-port=9223",
  `--user-data-dir=${profilePath}`,
  "--no-first-run",
  "--no-default-browser-check",
  "about:blank"
]);
await manager.closeManaged();
assert.equal(closeBrowserCalls, 1);
```

Test that external instances are never closed, preferred loopback endpoint wins, ports are attempted only from preferred then 9222–9232, early exit maps to `launch-exited`, timeout maps to `cdp-timeout`, and spawn uses `shell: false`.

- [ ] **Step 2: Run focused tests and observe RED**

Run: `npm.cmd test -- --test-name-pattern="ChromeInstance"`

Expected: compilation fails because the manager does not exist.

- [ ] **Step 3: Implement endpoint resolution and managed shutdown**

```ts
async resolveEndpoint(
  preferredEndpoint: string | undefined,
  onProgress: (progress: ChromeLaunchProgressStage) => void
): Promise<ChromeEndpointResolution> {
  onProgress("detecting");
  const existing = await this.findExistingLoopbackEndpoint(preferredEndpoint);
  if (existing) return { ownership: "external", endpoint: existing };
  const executable = await this.locator.resolve();
  if (executable.status === "cancelled") return { status: "cancelled" };
  const port = await this.selectPort(preferredEndpoint);
  onProgress("launching");
  const child = this.spawnChrome(executable.path, this.chromeArgs(port), {
    shell: false,
    windowsHide: false
  });
  const endpoint = await this.waitForEndpoint(child, port, 15_000);
  this.managed = { child, endpoint };
  await this.settings.update({ lastDebugEndpoint: endpoint });
  return { ownership: "managed", endpoint };
}
```

Shutdown sends `Browser.close`, waits up to 3 seconds, then calls `child.kill()` only on the stored child handle.

- [ ] **Step 4: Run focused and browser discovery tests**

Run: `npm.cmd test -- --test-name-pattern="ChromeInstance|discoverBrowserEndpoints"`

Expected: endpoint, port and ownership tests pass.

- [ ] **Step 5: Commit**

```powershell
git add src/main/chromeInstanceManager.ts src/main/chromeInstanceManager.test.ts src/main/browserDiscovery.ts src/main/browserDiscovery.test.ts tsconfig.test.json
git commit -m "feat: manage isolated Chrome debug instance"
```

### Task 4: Loopback Test Page Server

**Files:**
- Create: `src/main/testPageServer.ts`
- Create: `src/main/testPageServer.test.ts`
- Modify: `tsconfig.test.json`

**Interfaces:**
- Consumes: `TEST_PAGES`, `dist/test-pages` root, optional `VITE_DEV_SERVER_URL`
- Produces: `TestPageServer.resolve(testPageId): Promise<string>`
- Produces: `TestPageServer.close(): Promise<void>`

- [ ] **Step 1: Write failing whitelist and HTTP tests**

```ts
assert.equal(
  await devServer.resolve("table"),
  "http://127.0.0.1:5173/test-pages/table.html"
);
await assert.rejects(() => server.resolve("../secret"), /Unknown test page/);
const response = await fetch(`${baseUrl}/test-pages/basic-dom.html`);
assert.equal(response.status, 200);
assert.match(response.headers.get("content-type") ?? "", /^text\/html/);
```

Request traversal variants such as `%2e%2e`, unknown extensions and files outside the fixture root must return 404.

- [ ] **Step 2: Run focused tests and observe RED**

Run: `npm.cmd test -- --test-name-pattern="TestPageServer"`

Expected: compilation fails because the server does not exist.

- [ ] **Step 3: Implement lazy loopback listeners and static handler**

```ts
async resolve(id: string): Promise<string> {
  const page = TEST_PAGES.find((item) => item.id === id);
  if (!page) throw new ChromeLaunchError("test-server-failed");
  if (this.devBaseUrl) return new URL(page.path, this.devBaseUrl).href;
  const port = await this.ensureListening();
  return `http://127.0.0.1:${port}${page.path}`;
}
```

Create an IPv4 `127.0.0.1` listener on an ephemeral port and an IPv6 `::1` listener on the same port with `ipv6Only: true`. Resolve requested files under the fixed root and compare the resolved absolute path prefix before reading.

- [ ] **Step 4: Run tests**

Run: `npm.cmd test -- --test-name-pattern="TestPageServer"`

Expected: whitelist, content type, traversal and close tests pass.

- [ ] **Step 5: Commit**

```powershell
git add src/main/testPageServer.ts src/main/testPageServer.test.ts tsconfig.test.json
git commit -m "feat: serve test fixtures to external Chrome"
```

### Task 5: CDP Target Creation and Exact Attachment

**Files:**
- Modify: `src/main/browserSession.ts`
- Modify: `src/main/browserSession.test.ts`

**Interfaces:**
- Consumes: normalized endpoint and URL
- Produces: `BrowserSession.createAndSelectTarget(endpoint, url): Promise<{ connection: BrowserConnectionInfo; snapshot: DomSnapshotResult; bootstrapTargetId: string | null }>`

- [ ] **Step 1: Write failing BrowserSession tests**

Extend the injected fake connection:

```ts
connection.send = async (method, params) => {
  if (method === "Target.createTarget") {
    assert.deepEqual(params, { url: "https://example.com/" });
    return { targetId: "new-target" };
  }
  if (method === "Target.attachToTarget") {
    assert.equal(params?.targetId, "new-target");
    return { sessionId: "new-session" };
  }
  return {};
};
```

Assert exact target attachment, one refresh retry when the target is initially absent, preservation of the returned target ID, and bootstrap identification only for a newly launched `about:blank` target.

- [ ] **Step 2: Run focused tests and observe RED**

Run: `npm.cmd test -- --test-name-pattern="createAndSelectTarget"`

Expected: fails because the method does not exist.

- [ ] **Step 3: Implement atomic create/attach/snapshot**

```ts
async createAndSelectTarget(
  rawEndpoint: string,
  url: string
): Promise<CreatedBrowserTarget> {
  const endpoint = normalizeDebugEndpoint(rawEndpoint);
  await this.ensureBrowserConnection(endpoint);
  const before = await this.fetchTargets();
  const bootstrapTargetId = findBootstrapTargetId(before);
  const created = await this.targetClient.send<{ targetId: string }>(
    "Target.createTarget",
    { url }
  );
  this.targets = await this.fetchTargetsWithRetry(created.targetId);
  await this.connectTarget(created.targetId);
  return {
    connection: this.getConnectionInfo("connected"),
    snapshot: await this.getDomSnapshot(),
    bootstrapTargetId
  };
}
```

Expose a separate exact `closeTarget(targetId)` method used only for the recorded managed bootstrap target.

- [ ] **Step 4: Run BrowserSession tests**

Run: `npm.cmd test -- --test-name-pattern="createAndSelectTarget|BrowserLifecycleEvent"`

Expected: new tests and existing lifecycle tests pass.

- [ ] **Step 5: Commit**

```powershell
git add src/main/browserSession.ts src/main/browserSession.test.ts
git commit -m "feat: create and attach new Chrome targets"
```

### Task 6: Atomic Main-Process Workflow and IPC

**Files:**
- Create: `src/main/chromePageWorkflow.ts`
- Create: `src/main/chromePageWorkflow.test.ts`
- Modify: `src/main/main.ts`
- Modify: `src/main/preload.cts`
- Modify: `src/shared/ipc.ts`
- Modify: `src/renderer/store/useAppStore.ts`
- Modify: `tsconfig.test.json`

**Interfaces:**
- Consumes: `ChromeInstanceManager`, `TestPageServer`, `BrowserSession`, `OpenChromePageRequest`
- Produces: `ChromePageWorkflow.open(request, progress): Promise<OpenChromePageResult>`

- [ ] **Step 1: Write failing workflow tests**

```ts
const result = await workflow.open(
  { requestId: "r1", source: { kind: "custom", value: "example.com" } },
  (event) => progress.push(event)
);
assert.equal(result.status, "opened");
assert.equal(result.targetId, "new-target");
assert.deepEqual(progress.map((item) => item.stage), [
  "detecting",
  "connecting",
  "opening"
]);
```

Test custom/test-page source resolution, invalid input before launch, cancellation, external endpoint failure followed by managed fallback, target attach error metadata, and managed bootstrap closure.

- [ ] **Step 2: Run focused tests and observe RED**

Run: `npm.cmd test -- --test-name-pattern="ChromePageWorkflow"`

Expected: compilation fails because the workflow does not exist.

- [ ] **Step 3: Implement workflow and IPC registration**

```ts
async open(
  request: OpenChromePageRequest,
  emit: (progress: OpenChromePageProgress) => void
): Promise<OpenChromePageResult> {
  const url = await this.resolveSource(request.source);
  const endpoint = await this.instances.resolveEndpoint(
    request.preferredEndpoint,
    (stage) => emit({ requestId: request.requestId, stage })
  );
  if ("status" in endpoint) return endpoint;
  emit({ requestId: request.requestId, stage: "opening", endpoint: endpoint.endpoint });
  const created = await this.session.createAndSelectTarget(endpoint.endpoint, url);
  await this.closeManagedBootstrap(endpoint, created.bootstrapTargetId);
  return {
    status: "opened",
    ownership: endpoint.ownership,
    endpoint: endpoint.endpoint,
    targetId: created.connection.targetId!,
    connection: created.connection,
    snapshot: created.snapshot
  };
}
```

Register one invoke handler. Send progress only to `event.sender` and validate request shape before acting. Preload must return an unsubscribe function that removes the exact progress listener.

Add `openChromePage` and `onOpenChromePageProgress` to `IpcApi`, add the two IPC channel constants, and add matching fallback methods in `useAppStore.ts`:

```ts
openChromePage: async () => ({
  status: "error",
  code: "launch-failed",
  message: "Managed Chrome launch is available only in the Electron app."
}),
onOpenChromePageProgress: () => () => undefined
```

- [ ] **Step 4: Add graceful application cleanup**

Instantiate the locator/settings/manager/server/workflow once in `main.ts`. On `before-quit`, prevent the first quit, await `closeManaged()` and `testPageServer.close()`, set a guard, then call `app.quit()` again.

- [ ] **Step 5: Run workflow tests and typecheck**

Run: `npm.cmd test -- --test-name-pattern="ChromePageWorkflow"`

Expected: workflow tests pass.

Run: `npm.cmd run typecheck`

Expected: shared, preload and main IPC contracts compile.

- [ ] **Step 6: Commit**

```powershell
git add src/main/chromePageWorkflow.ts src/main/chromePageWorkflow.test.ts src/main/main.ts src/main/preload.cts src/shared/ipc.ts src/renderer/store/useAppStore.ts tsconfig.test.json
git commit -m "feat: orchestrate Chrome open and connect workflow"
```

### Task 7: Zustand State and Left-Panel UI

**Files:**
- Modify: `src/renderer/store/useAppStore.ts`
- Modify: `src/renderer/components/WorkbenchLayout.tsx`
- Modify: `src/renderer/components/workbenchPresentation.ts`
- Modify: `src/renderer/components/workbenchPresentation.test.ts`
- Modify: `src/renderer/i18n/messages.ts`
- Modify: `src/renderer/styles/global.css`

**Interfaces:**
- Consumes: `IpcApi.openChromePage`, `IpcApi.onOpenChromePageProgress`
- Produces: `openChromePage(source, preferredEndpoint)`, `chromeOpenState`, `resetChromeOpenState`

- [ ] **Step 1: Write failing pure presentation/state tests**

```ts
assert.equal(getChromeOpenButtonMessageKey("idle", false), "chrome.launchAndOpen");
assert.equal(getChromeOpenButtonMessageKey("idle", true), "chrome.openNewTab");
assert.equal(getChromeOpenButtonMessageKey("launching", false), "chrome.launching");
assert.equal(getChromeErrorMessageKey("invalid-url"), "chrome.error.invalidUrl");
```

Add a pure request-state reducer test proving a progress event with another `requestId` is ignored.

- [ ] **Step 2: Run focused tests and observe RED**

Run: `npm.cmd test -- --test-name-pattern="ChromeOpenPresentation"`

Expected: fails because mapping helpers do not exist.

- [ ] **Step 3: Implement Zustand atomic action**

```ts
openChromePage: async (source, preferredEndpoint) => {
  const requestId = crypto.randomUUID();
  set({ chromeOpenState: { status: "detecting", requestId } });
  const unsubscribe = getApi().onOpenChromePageProgress((progress) => {
    set((state) => reduceChromeOpenProgress(state, progress));
  });
  try {
    const result = await getApi().openChromePage({ requestId, preferredEndpoint, source });
    if (result.status === "opened") {
      setConnectionInfo(set, result.connection, result.snapshot);
      set({
        chromeOpenState: {
          status: "success",
          requestId,
          endpoint: result.endpoint,
          targetId: result.targetId,
          ownership: result.ownership
        }
      });
    } else if (result.status === "cancelled") {
      set({ chromeOpenState: { status: "idle" } });
    } else {
      set({ chromeOpenState: { status: "error", requestId, code: result.code, message: result.message } });
    }
  } finally {
    unsubscribe();
  }
}
```

Do not include URL input or ChromeOpenState in `partialize`.

- [ ] **Step 4: Add the Chrome card and test-page row actions**

In WorkbenchLayout keep `pageUrl` as local `useState("")`. Submit on form submit so Enter and click share one path. Disable the form while a request is active. Add a trailing button to each test page and stop propagation so it does not alter the existing preview click behavior.

```tsx
<form className="chrome-launch-card" onSubmit={openCustomPage}>
  <input value={pageUrl} onChange={(event) => setPageUrl(event.currentTarget.value)} />
  <button disabled={chromeOpenBusy}>{t(chromeOpenButtonKey)}</button>
  <ChromeOpenFeedback state={chromeOpenState} />
</form>
```

- [ ] **Step 5: Add complete bilingual copy and styles**

Add message keys for card title/status, URL placeholder, all progress stages, both idle button labels, success, and every stable error code. Style the form and row action using existing design tokens; include visible focus, disabled opacity, wrapped error text and compact-mode behavior.

- [ ] **Step 6: Run presentation tests, typecheck and build**

Run: `npm.cmd test -- --test-name-pattern="ChromeOpenPresentation"`

Expected: presentation/reducer tests pass.

Run: `npm.cmd run typecheck`

Expected: renderer, preload and shared types pass.

Run: `npm.cmd run build`

Expected: Vite production build succeeds.

- [ ] **Step 7: Commit**

```powershell
git add src/renderer/store/useAppStore.ts src/renderer/components/WorkbenchLayout.tsx src/renderer/components/workbenchPresentation.ts src/renderer/components/workbenchPresentation.test.ts src/renderer/i18n/messages.ts src/renderer/styles/global.css
git commit -m "feat: add one-click Chrome launch controls"
```

### Task 8: Documentation, Full Verification and Browser Acceptance

**Files:**
- Modify: `README.md`
- Modify if behavior evidence requires correction: files from Tasks 1–7

**Interfaces:**
- Consumes: completed end-to-end feature
- Produces: documented and verified Windows workflow

- [ ] **Step 1: Update README**

Document the one-click URL field, test-page action, isolated persistent Profile, auto-connect behavior, manual `chrome.exe` fallback, manual endpoint compatibility and managed-only shutdown. Keep CLI startup commands as troubleshooting fallback rather than the primary workflow.

- [ ] **Step 2: Run static scans**

Run:

```powershell
rg -n "TBD|TODO|Phase 1|Phase 2|placeholder" src README.md
git diff --check
```

Expected: no temporary product copy or whitespace errors; matches for DOM `placeholder` attributes are allowed.

- [ ] **Step 3: Run full automated verification**

Run:

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
```

Expected: all tests pass, both TypeScript projects compile, and Vite produces the production bundle.

- [ ] **Step 4: Perform representative Windows browser acceptance**

Verify in the running Electron app:

1. Empty input launches dedicated Chrome, opens one `about:blank` target and auto-connects.
2. `localhost`, a bare domain and a full HTTPS URL normalize correctly.
3. A second request reuses Chrome and opens a new tab without navigating the first.
4. Basic DOM and OOPIF fixtures load from the external browser and auto-connect.
5. Closing UI Explorer closes the managed Chrome.
6. Manually started Chrome on a discovered endpoint remains open when UI Explorer exits.
7. Restarting UI Explorer reuses the dedicated Profile state.

- [ ] **Step 5: Commit documentation and final corrections**

```powershell
git add README.md src
git commit -m "docs: document managed Chrome workflow"
```
