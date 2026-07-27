# Phase 5 Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete Phase 5 reliability, dynamic-page diagnostics, Selector guidance, and non-freezing transient capture.

**Architecture:** Keep browser lifecycle and global shortcut ownership in Electron main, expose narrow typed IPC methods/events, and keep deterministic matching, attribute analysis, Selector diff/repair, and countdown calculations in shared pure modules. Renderer state coordinates polling and capture while derived presentation data stays local to the workbench.

**Tech Stack:** Electron 33, React 18, Zustand 5, TypeScript 5.7, Node test runner.

## Global Constraints

- Do not call `SuspendThread`, `ResumeThread`, or otherwise freeze the target process.
- Preserve existing user changes and do not modify generated output directories.
- Use RED/GREEN for browser target reconciliation, attribute analysis, Selector guidance, and countdown logic.
- Verify UI/IPC work with tests, type checking, and a production build.

---

### Task 1: Browser lifecycle monitoring and reconnection

**Files:**
- Modify: `src/shared/browserTargets.ts`
- Modify: `src/shared/browserTargets.test.ts`
- Modify: `src/shared/ipc.ts`
- Modify: `src/main/browserSession.ts`
- Modify: `src/main/browserSession.test.ts`
- Modify: `src/main/main.ts`
- Modify: `src/main/preload.cts`
- Modify: `src/renderer/store/useAppStore.ts`
- Modify: `src/renderer/components/WorkbenchLayout.tsx`
- Modify: `src/renderer/i18n/messages.ts`

**Interfaces:**
- Produces: `recoverBrowserTarget(previousTarget, targets)` and `BrowserConnectionInfo.status`.
- Produces: `refreshBrowserConnection()` IPC method used by renderer polling.

- [x] Write failing tests proving same-id targets stay selected, replacement targets recover by URL, and missing targets report closure.
- [x] Run `npm.cmd test -- --test-name-pattern=BrowserTargetRecovery` and verify failure.
- [x] Implement target recovery, CDP socket health inspection, and `BrowserSession.refreshConnection()`.
- [x] Wire the typed IPC method and a renderer polling loop with reconnect/closed status copy.
- [x] Run the focused tests and `npm.cmd run typecheck`.

### Task 2: Attribute filtering and locator-value markers

**Files:**
- Create: `src/shared/attributeInsights.ts`
- Create: `src/shared/attributeInsights.test.ts`
- Modify: `tsconfig.test.json`
- Modify: `src/renderer/components/WorkbenchLayout.tsx`
- Modify: `src/renderer/styles/global.css`
- Modify: `src/renderer/i18n/messages.ts`

**Interfaces:**
- Produces: `analyzeElementAttributes(root, elementId, query)` returning filtered attributes with `unique`, `stable`, `dynamic`, or `neutral` value.

- [x] Write failing tests for case-insensitive name/value filtering, uniqueness, stable test attributes, and dynamic identifiers.
- [x] Run the focused tests and verify the missing implementation failure.
- [x] Implement the pure analyzer using snapshot-wide exact value counts.
- [x] Add a local filter input and localized value badges to the property panel.
- [x] Run focused tests and type checking.

### Task 3: Selector diff, failure explanation, and deterministic repair

**Files:**
- Modify: `src/shared/selector.ts`
- Modify: `src/shared/selector.test.ts`
- Modify: `src/renderer/components/WorkbenchLayout.tsx`
- Modify: `src/renderer/styles/global.css`
- Modify: `src/renderer/i18n/messages.ts`

**Interfaces:**
- Produces: `diffSelectorCandidates(original, edited)` returning traceable layer/tag/attribute changes.
- Produces: `suggestSelectorRepairs(root, candidate)` returning validated `SelectorEdit` suggestions.

- [x] Write failing tests for attribute value/toggle diffs and a repair that enables a unique stable attribute.
- [x] Run the focused tests and verify failure.
- [x] Implement candidate diffing and repair search by reusing `applySelectorEdit` validation.
- [x] Render original/edited Selector changes, validation diagnostics, target tooltip data, and one-click repairs.
- [x] Run focused tests and type checking.

### Task 4: Delayed capture, countdown, and global hotkey

**Files:**
- Create: `src/shared/captureTiming.ts`
- Create: `src/shared/captureTiming.test.ts`
- Modify: `tsconfig.test.json`
- Modify: `src/shared/ipc.ts`
- Modify: `src/main/main.ts`
- Modify: `src/main/preload.cts`
- Modify: `src/renderer/components/WorkbenchLayout.tsx`
- Modify: `src/renderer/styles/global.css`
- Modify: `src/renderer/i18n/messages.ts`

**Interfaces:**
- Produces: `getCaptureCountdown(dueAt, now)` returning remaining whole seconds and readiness.
- Produces: `onCaptureRequested(listener)` preload event subscription for `CommandOrControl+Shift+E`.

- [x] Write failing tests for countdown rounding, readiness, and cancellation-safe deadline values.
- [x] Run the focused tests and verify failure.
- [x] Implement countdown calculation, register/unregister Electron global shortcut, and expose a cleanup-safe renderer subscription.
- [x] Add delay choices, countdown/cancel controls, and invoke snapshot refresh without freezing the target.
- [x] Run focused tests and type checking.

### Task 5: Phase verification and documentation status

**Files:**
- Modify: `REQUIREMENTS.md`

- [x] Run `npm.cmd test`, `npm.cmd run typecheck`, and `npm.cmd run build`.
- [x] Search the codebase for `SuspendThread|ResumeThread` and verify no matches in runtime code.
- [x] Inspect `git diff --check` and the final scoped diff.
- [x] Mark Phase 5 completed only if every acceptance criterion is represented by code and verification evidence.
