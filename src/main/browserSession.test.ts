import test from "node:test";
import assert from "node:assert/strict";
import {
  BrowserSession,
  isBrowserLifecycleEvent,
  type BrowserSessionConnection
} from "./browserSession.js";
import type { CdpEvent, CdpSendOptions } from "./cdpConnection.js";
import {
  ELEMENT_PICKER_SCRIPT,
  GET_PICKED_ELEMENT_SCRIPT,
  HIGHLIGHT_SCRIPT,
  SNAPSHOT_SCRIPT
} from "./browserScripts.js";
import { findElementSnapshot } from "../shared/domSnapshot.js";
import type { DomSnapshotResult, ElementSnapshot } from "../shared/ipc.js";

test("a delayed highlight request keeps the token of the snapshot that issued it", async () => {
  const session = new BrowserSession();
  const evaluated: string[] = [];
  const testSession = session as unknown as {
    evaluate: <T>(expression: string) => Promise<T>;
  };
  testSession.evaluate = async <T>(expression: string): Promise<T> => {
    evaluated.push(expression);
    if (expression === SNAPSHOT_SCRIPT) {
      return {
        root: null,
        capturedAt: "2026-07-24T00:00:01.000Z",
        snapshotToken: "snapshot-b",
        nodeCount: 0
      } as T;
    }
    return { targets: [] } as T;
  };

  await session.getDomSnapshot();
  await session.highlightElements({
    elementIds: ["n-1"],
    snapshotToken: "snapshot-a"
  });

  const highlightExpression = evaluated.at(-1) ?? "";
  assert.match(highlightExpression, /const expectedSnapshotToken = "snapshot-a";/);
  assert.doesNotMatch(highlightExpression, /const expectedSnapshotToken = "snapshot-b";/);
});

test("refreshConnection reconnects a replacement for the previously selected target", async () => {
  const connection = new RecordingConnection();
  await connection.connect("ws://browser");
  const session = new BrowserSession({ connection });
  const connectedTargetIds: string[] = [];
  const testSession = session as unknown as {
    endpoint: string;
    targets: Array<{ id: string; type: string; title: string; url: string; webSocketDebuggerUrl: string }>;
    selectedTargetId: string;
    selectedTarget: { id: string; type: string; title: string; url: string; webSocketDebuggerUrl: string };
    fetchTargets: () => Promise<Array<{ id: string; type: string; title: string; url: string; webSocketDebuggerUrl: string }>>;
    connectTarget: (targetId: string) => Promise<void>;
  };
  testSession.endpoint = "http://127.0.0.1:9222";
  testSession.targets = [];
  testSession.selectedTargetId = "old";
  testSession.selectedTarget = {
    id: "old",
    type: "page",
    title: "App",
    url: "https://app.test",
    webSocketDebuggerUrl: "ws://old"
  };
  testSession.fetchTargets = async () => [
    {
      id: "new",
      type: "page",
      title: "App",
      url: "https://app.test",
      webSocketDebuggerUrl: "ws://new"
    }
  ];
  testSession.connectTarget = async (targetId) => {
    connectedTargetIds.push(targetId);
    testSession.selectedTargetId = targetId;
  };

  const info = await session.refreshConnection();

  assert.deepEqual(connectedTargetIds, ["new"]);
  assert.equal(info.status, "reconnected");
  assert.equal(info.targetId, "new");
});

test("BrowserLifecycleEvent recognizes navigation refresh and detach events", () => {
  assert.equal(isBrowserLifecycleEvent("Page.frameNavigated"), true);
  assert.equal(isBrowserLifecycleEvent("Runtime.executionContextsCleared"), true);
  assert.equal(isBrowserLifecycleEvent("Inspector.detached"), true);
  assert.equal(isBrowserLifecycleEvent("Page.frameDetached"), true);
  assert.equal(isBrowserLifecycleEvent("Target.detachedFromTarget"), true);
  assert.equal(isBrowserLifecycleEvent("Runtime.consoleAPICalled"), false);
});

test("BrowserSession connects to the browser websocket and attaches the selected page in flat mode", async () => {
  const connection = new RecordingConnection();
  const session = new BrowserSession({
    connection,
    readBrowserVersion: async () => ({
      browser: "Chrome/140.0.0.0",
      webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/browser/browser-id"
    })
  });
  const testSession = session as unknown as {
    fetchTargets: () => Promise<Array<{
      id: string;
      type: string;
      title: string;
      url: string;
      webSocketDebuggerUrl: string;
    }>>;
  };
  testSession.fetchTargets = async () => [{
    id: "page-1",
    type: "page",
    title: "App",
    url: "https://app.test",
    webSocketDebuggerUrl: "ws://page-1"
  }];

  const info = await session.connect("http://127.0.0.1:9222");

  assert.equal(info.browser, "Chrome/140.0.0.0");
  assert.deepEqual(connection.connectedUrls, [
    "ws://127.0.0.1:9222/devtools/browser/browser-id"
  ]);
  assert.deepEqual(connection.sent[0], {
    method: "Target.attachToTarget",
    params: { targetId: "page-1", flatten: true },
    sessionId: undefined
  });
  assert.ok(connection.sent.some((command) =>
    command.method === "Target.setAutoAttach" &&
    command.sessionId === "root-session"
  ));
});

test("BrowserSession createAndSelectTarget attaches the exact newly created page", async () => {
  const connection = new RecordingConnection();
  const originalSend = connection.send.bind(connection);
  connection.send = async <T>(
    method: string,
    params?: Record<string, unknown>,
    sessionId?: string
  ): Promise<T> => {
    if (method === "Target.createTarget") {
      connection.sent.push({ method, params, sessionId });
      return { targetId: "new-page" } as T;
    }
    return originalSend<T>(method, params, sessionId);
  };
  const session = new BrowserSession({
    connection,
    readBrowserVersion: async () => ({
      browser: "Chrome/140.0.0.0",
      webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/browser/browser-id"
    })
  });
  let reads = 0;
  const testSession = session as unknown as {
    fetchTargets: () => Promise<Array<{
      id: string;
      type: string;
      title: string;
      url: string;
      webSocketDebuggerUrl: string;
    }>>;
    getDomSnapshot: () => Promise<DomSnapshotResult>;
  };
  testSession.fetchTargets = async () => {
    reads += 1;
    return reads === 1
      ? [{
          id: "bootstrap",
          type: "page",
          title: "",
          url: "about:blank",
          webSocketDebuggerUrl: "ws://bootstrap"
        }, {
          id: "bootstrap-2",
          type: "page",
          title: "",
          url: "about:blank",
          webSocketDebuggerUrl: "ws://bootstrap-2"
        }]
      : [{
          id: "new-page",
          type: "page",
          title: "Example",
          url: "https://example.com/",
          webSocketDebuggerUrl: "ws://new-page"
        }];
  };
  testSession.getDomSnapshot = async () => ({
    root: null,
    capturedAt: "2026-07-30T00:00:00.000Z",
    nodeCount: 0
  });

  const result = await session.createAndSelectTarget(
    "http://127.0.0.1:9222",
    "https://example.com/"
  );

  assert.equal(result.connection.targetId, "new-page");
  assert.deepEqual(result.bootstrapTargetIds, ["bootstrap", "bootstrap-2"]);
  assert.ok(connection.sent.some((command) =>
    command.method === "Target.createTarget" &&
    command.params?.url === "https://example.com/"
  ));
  assert.ok(connection.sent.some((command) =>
    command.method === "Target.attachToTarget" &&
    command.params?.targetId === "new-page"
  ));
});

test("BrowserSession recursively enables auto attach on a newly attached iframe session", async () => {
  const connection = new RecordingConnection();
  const session = new BrowserSession({
    connection,
    readBrowserVersion: async () => ({
      browser: "Chrome/140.0.0.0",
      webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/browser/browser-id"
    })
  });
  const testSession = session as unknown as {
    fetchTargets: () => Promise<Array<{
      id: string;
      type: string;
      title: string;
      url: string;
      webSocketDebuggerUrl: string;
    }>>;
  };
  testSession.fetchTargets = async () => [{
    id: "page-1",
    type: "page",
    title: "App",
    url: "https://app.test",
    webSocketDebuggerUrl: "ws://page-1"
  }];
  await session.connect("http://127.0.0.1:9222");

  connection.emit({
    method: "Target.attachedToTarget",
    sessionId: "root-session",
    params: {
      sessionId: "child-session",
      targetInfo: {
        targetId: "child-target",
        type: "iframe",
        title: "",
        url: "https://child.test",
        attached: true,
        canAccessOpener: false
      },
      waitingForDebugger: false
    }
  });
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.ok(connection.sent.some((command) =>
    command.method === "Target.setAutoAttach" &&
    command.sessionId === "child-session"
  ));
});

test("BrowserSession marks frame owners and stitches active OOPIF session snapshots", async () => {
  const connection = new RecordingConnection(new Map([
    ["root-session", oopifParentSnapshot()],
    ["child-session", oopifChildSnapshot()]
  ]));
  const session = new BrowserSession({
    connection,
    readBrowserVersion: async () => ({
      browser: "Chrome/140.0.0.0",
      webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/browser/browser-id"
    })
  });
  const testSession = session as unknown as {
    fetchTargets: () => Promise<Array<{
      id: string;
      type: string;
      title: string;
      url: string;
      webSocketDebuggerUrl: string;
    }>>;
  };
  testSession.fetchTargets = async () => [{
    id: "page-1",
    type: "page",
    title: "App",
    url: "https://app.test",
    webSocketDebuggerUrl: "ws://page-1"
  }];
  await session.connect("http://127.0.0.1:9222");

  connection.emit(frameNavigatedEvent("root-session", "root-frame", undefined, "root-loader"));
  connection.emit(executionContextEvent("root-session", "root-frame", 10));
  connection.emit(attachedIframeEvent());
  connection.emit(frameNavigatedEvent("child-session", "child-frame", "root-frame", "child-loader"));
  connection.emit(executionContextEvent("child-session", "child-frame", 20));
  await new Promise<void>((resolve) => setImmediate(resolve));

  const snapshot = await session.getDomSnapshot();

  assert.ok(findElementSnapshot(snapshot.root, "child-session::n-2"));
  assert.ok(connection.sent.some((command) =>
    command.method === "DOM.getFrameOwner" &&
    command.sessionId === "root-session" &&
    command.params?.frameId === "child-target"
  ));
  assert.deepEqual(
    connection.sent
      .filter((command) => command.method === "Runtime.evaluate")
      .map((command) => command.sessionId)
      .sort(),
    ["child-session", "root-session"]
  );
});

test("BrowserSession routes namespaced highlights and picker results to their owning sessions", async () => {
  const connection = new RecordingConnection(new Map([
    ["root-session", oopifParentSnapshot()],
    ["child-session", oopifChildSnapshot()]
  ]));
  connection.pickedBySession.set("child-session", "n-2");
  const session = new BrowserSession({
    connection,
    readBrowserVersion: async () => ({
      browser: "Chrome/140.0.0.0",
      webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/browser/browser-id"
    })
  });
  const testSession = session as unknown as {
    fetchTargets: () => Promise<Array<{
      id: string;
      type: string;
      title: string;
      url: string;
      webSocketDebuggerUrl: string;
    }>>;
  };
  testSession.fetchTargets = async () => [{
    id: "page-1",
    type: "page",
    title: "App",
    url: "https://app.test",
    webSocketDebuggerUrl: "ws://page-1"
  }];
  await session.connect("http://127.0.0.1:9222");
  connection.emit(frameNavigatedEvent("root-session", "root-frame", undefined, "root-loader"));
  connection.emit(executionContextEvent("root-session", "root-frame", 10));
  connection.emit(attachedIframeEvent());
  connection.emit(frameNavigatedEvent("child-session", "child-frame", "root-frame", "child-loader"));
  connection.emit(executionContextEvent("child-session", "child-frame", 20));
  await new Promise<void>((resolve) => setImmediate(resolve));
  const snapshot = await session.getDomSnapshot();
  const commandStart = connection.sent.length;

  const highlighted = await session.highlightElements({
    elementIds: ["root-session::n-2", "child-session::n-2"],
    snapshotToken: snapshot.snapshotToken ?? null
  });
  await session.setElementPickerEnabled(true);
  const picked = await session.getPickedElementId();

  assert.deepEqual(highlighted.targets.map((target) => target.elementId), [
    "root-session::n-2",
    "child-session::n-2"
  ]);
  const actionCommands = connection.sent.slice(commandStart);
  const highlightCommands = actionCommands.filter((command) =>
    command.method === "Runtime.evaluate" &&
    typeof command.params?.expression === "string" &&
    command.params.expression.includes("const elementIds =")
  );
  assert.deepEqual(
    highlightCommands.map((command) => command.sessionId).sort(),
    ["child-session", "root-session"]
  );
  assert.ok(highlightCommands.every((command) =>
    !String(command.params?.expression).includes("child-session::n-2") &&
    !String(command.params?.expression).includes("root-session::n-2")
  ));
  assert.equal(picked, "child-session::n-2");
});

test("JavaScript diagnostic preparation routes its registry probe to the exact child session", async () => {
  const { connection, session, snapshot } = await createConnectedOopifSession();
  const commandStart = connection.sent.length;

  const prepared = await session.prepareJavaScriptDiagnostic({
    elementId: "child-session::n-2",
    snapshotToken: snapshot.snapshotToken ?? null,
    code: "return $target.textContent;",
    strategy: "dom-query",
    intent: "inspect"
  });

  assert.equal(prepared.status, "prepared");
  if (prepared.status !== "prepared") return;
  assert.equal(prepared.codeDigest.length, 64);
  assert.deepEqual(prepared.risks, ["arbitrary-code"]);
  assert.deepEqual(prepared.target, {
    browserTargetId: "page-1",
    title: "App",
    url: "https://app.test",
    elementId: "child-session::n-2",
    tagName: "button",
    context: assertContext(snapshot, "child-session::n-2").map(({ sessionId: _sessionId, ...boundary }) => boundary)
  });
  const commands = connection.sent.slice(commandStart);
  assert.ok(commands.some((command) =>
    command.method === "Runtime.evaluate" &&
    command.sessionId === "child-session" &&
    String(command.params?.expression).includes("window.__uiExplorerElements?.has")
  ));
  assert.equal(commands.some((command) =>
    command.method === "Runtime.evaluate" &&
    command.sessionId === "root-session" &&
    String(command.params?.expression).includes("n-2")
  ), false);
});

test("JavaScript diagnostic preparation rejects a mismatched snapshot token", async () => {
  const { session } = await createConnectedOopifSession();

  const result = await session.prepareJavaScriptDiagnostic({
    elementId: "child-session::n-2",
    snapshotToken: "old-token",
    code: "return $target.textContent;",
    strategy: "dom-query",
    intent: "inspect"
  });

  assert.equal(result.status, "rejected");
  if (result.status === "rejected") assert.equal(result.code, "stale-snapshot");
});

test("JavaScript diagnostic preparation rejects an invalid global element ID", async () => {
  const { session, snapshot } = await createConnectedOopifSession();

  const result = await session.prepareJavaScriptDiagnostic({
    elementId: "n-2",
    snapshotToken: snapshot.snapshotToken ?? null,
    code: "return $target.textContent;",
    strategy: "dom-query",
    intent: "inspect"
  });

  assert.equal(result.status, "rejected");
  if (result.status === "rejected") assert.equal(result.code, "invalid-element");
});

test("JavaScript diagnostic preparation rejects an inactive owning session", async () => {
  const { session, snapshot } = await createConnectedOopifSession();
  const testSession = session as unknown as {
    contextRegistry: {
      invalidateSession: (sessionId: string, code: "session-detached", detail: string) => void;
    };
  };
  testSession.contextRegistry.invalidateSession(
    "child-session",
    "session-detached",
    "CDP session detached."
  );

  const result = await session.prepareJavaScriptDiagnostic({
    elementId: "child-session::n-2",
    snapshotToken: snapshot.snapshotToken ?? null,
    code: "return $target.textContent;",
    strategy: "dom-query",
    intent: "inspect"
  });

  assert.equal(result.status, "rejected");
  if (result.status === "rejected") assert.equal(result.code, "session-unavailable");
});

test("JavaScript diagnostic preparation rejects a navigation revision change", async () => {
  const { connection, session, snapshot } = await createConnectedOopifSession();
  connection.emit(frameNavigatedEvent("child-session", "child-frame", "root-frame", "next-loader"));
  connection.emit(executionContextEvent("child-session", "child-frame", 21));

  const result = await session.prepareJavaScriptDiagnostic({
    elementId: "child-session::n-2",
    snapshotToken: snapshot.snapshotToken ?? null,
    code: "return $target.textContent;",
    strategy: "dom-query",
    intent: "inspect"
  });

  assert.equal(result.status, "rejected");
  if (result.status === "rejected") assert.equal(result.code, "stale-snapshot");
});

test("JavaScript diagnostic preparation rejects navigation during its registry probe", async () => {
  const { connection, session, snapshot } = await createConnectedOopifSession();
  let release: ((value: unknown) => void) | undefined;
  connection.registryProbeHandler = () => new Promise((resolve) => {
    release = resolve;
  });

  const pending = prepareChildDiagnostic(session, snapshot);
  assert.ok(release);
  connection.emit(frameNavigatedEvent("child-session", "child-frame", "root-frame", "next-loader"));
  connection.emit(executionContextEvent("child-session", "child-frame", 21));
  release({ result: { type: "boolean", value: true } });

  const result = await pending;
  assert.equal(result.status, "rejected");
  if (result.status === "rejected") assert.equal(result.code, "stale-snapshot");
});

test("JavaScript diagnostic preparation rejects an element absent from the stitched snapshot", async () => {
  const { session, snapshot } = await createConnectedOopifSession();

  const result = await session.prepareJavaScriptDiagnostic({
    elementId: "child-session::missing",
    snapshotToken: snapshot.snapshotToken ?? null,
    code: "return $target.textContent;",
    strategy: "dom-query",
    intent: "inspect"
  });

  assert.equal(result.status, "rejected");
  if (result.status === "rejected") assert.equal(result.code, "invalid-element");
});

test("JavaScript diagnostic execution routes once to the child session with bounded Runtime.evaluate parameters", async () => {
  const { connection, session, snapshot } = await createConnectedOopifSession();
  connection.diagnosticRuntimeHandler = () => ({
    result: {
      type: "object",
      value: {
        status: "success",
        value: { kind: "string", value: "Pay", truncated: false }
      }
    }
  });
  const prepared = await prepareChildDiagnostic(session, snapshot);
  assert.equal(prepared.status, "prepared");
  if (prepared.status !== "prepared") return;
  const commandStart = connection.sent.length;

  const first = await session.executeJavaScriptDiagnostic({ executionId: prepared.executionId });
  const second = await session.executeJavaScriptDiagnostic({ executionId: prepared.executionId });

  assert.deepEqual(first, {
    status: "success",
    value: { kind: "string", value: "Pay", truncated: false },
    mutatedDom: false
  });
  assert.equal(second.status, "validation-error");
  const commands = connection.sent.slice(commandStart);
  assert.equal(commands.length, 1);
  assert.equal(commands[0]?.method, "Runtime.evaluate");
  assert.equal(commands[0]?.sessionId, "child-session");
  assert.equal(commands[0]?.params?.timeout, 5_000);
  assert.equal(commands[0]?.options?.timeoutMs, 5_000);
  assert.match(commands[0]?.options?.timeoutMessage ?? "", /Runtime\.evaluate timed out after 5000 ms/);
  assert.equal(commands[0]?.params?.awaitPromise, true);
  assert.equal(commands[0]?.params?.returnByValue, true);
  assert.match(String(commands[0]?.params?.expression), /const localElementId = "n-2";/);
});

test("JavaScript diagnostic execution rejects an unknown runtime status", async () => {
  const { connection, session, snapshot } = await createConnectedOopifSession();
  connection.diagnosticRuntimeHandler = () => ({
    result: {
      type: "object",
      value: { status: "unexpected-status", message: "untrusted detail" }
    }
  });
  const prepared = await prepareChildDiagnostic(session, snapshot);
  assert.equal(prepared.status, "prepared");
  if (prepared.status !== "prepared") return;

  assert.deepEqual(
    await session.executeJavaScriptDiagnostic({ executionId: prepared.executionId }),
    {
      status: "connection-error",
      message: "Runtime evaluation returned an invalid diagnostic result."
    }
  );
});

test("JavaScript diagnostic execution rejects an unknown serialized value kind", async () => {
  const { connection, session, snapshot } = await createConnectedOopifSession();
  connection.diagnosticRuntimeHandler = () => ({
    result: {
      type: "object",
      value: {
        status: "success",
        value: { kind: "unexpected-kind", value: "untrusted detail" }
      }
    }
  });
  const prepared = await prepareChildDiagnostic(session, snapshot);
  assert.equal(prepared.status, "prepared");
  if (prepared.status !== "prepared") return;

  assert.deepEqual(
    await session.executeJavaScriptDiagnostic({ executionId: prepared.executionId }),
    {
      status: "connection-error",
      message: "Runtime evaluation returned an invalid diagnostic result."
    }
  );
});

test("JavaScript diagnostic execution consumes the plan before awaiting CDP", async () => {
  const { connection, session, snapshot } = await createConnectedOopifSession();
  let release: ((value: unknown) => void) | undefined;
  connection.diagnosticRuntimeHandler = () => new Promise((resolve) => {
    release = resolve;
  });
  const prepared = await prepareChildDiagnostic(session, snapshot);
  assert.equal(prepared.status, "prepared");
  if (prepared.status !== "prepared") return;

  const pending = session.executeJavaScriptDiagnostic({ executionId: prepared.executionId });
  const replay = await session.executeJavaScriptDiagnostic({ executionId: prepared.executionId });
  assert.equal(replay.status, "validation-error");
  assert.ok(release);
  release({
    result: {
      type: "object",
      value: { status: "success", value: { kind: "undefined" } }
    }
  });
  assert.equal((await pending).status, "success");
});

test("JavaScript diagnostic execution reports mutation intent without trusting runtime output", async () => {
  const { connection, session, snapshot } = await createConnectedOopifSession();
  connection.diagnosticRuntimeHandler = () => ({
    result: {
      type: "object",
      value: { status: "success", value: { kind: "boolean", value: true } }
    }
  });
  const prepared = await prepareChildDiagnostic(session, snapshot, "mutate-dom");
  assert.equal(prepared.status, "prepared");
  if (prepared.status !== "prepared") return;

  const result = await session.executeJavaScriptDiagnostic({ executionId: prepared.executionId });

  assert.equal(result.status, "success");
  if (result.status === "success") assert.equal(result.mutatedDom, true);
});

test("JavaScript diagnostic execution maps runtime exceptions and stale targets", async () => {
  const first = await createConnectedOopifSession();
  first.connection.diagnosticRuntimeHandler = () => ({
    result: {
      type: "object",
      value: { status: "exception", message: "user boom", stack: "stack line" }
    }
  });
  const exceptionPlan = await prepareChildDiagnostic(first.session, first.snapshot);
  assert.equal(exceptionPlan.status, "prepared");
  if (exceptionPlan.status !== "prepared") return;
  assert.deepEqual(
    await first.session.executeJavaScriptDiagnostic({ executionId: exceptionPlan.executionId }),
    { status: "exception", message: "user boom", stack: "stack line" }
  );

  const second = await createConnectedOopifSession();
  second.connection.diagnosticRuntimeHandler = () => ({
    result: {
      type: "object",
      value: { status: "stale-target", message: "The selected target is no longer available." }
    }
  });
  const stalePlan = await prepareChildDiagnostic(second.session, second.snapshot);
  assert.equal(stalePlan.status, "prepared");
  if (stalePlan.status !== "prepared") return;
  assert.equal(
    (await second.session.executeJavaScriptDiagnostic({ executionId: stalePlan.executionId })).status,
    "stale-target"
  );
});

test("JavaScript diagnostic execution accepts an empty runtime exception message", async () => {
  const { connection, session, snapshot } = await createConnectedOopifSession();
  connection.diagnosticRuntimeHandler = () => ({
    result: {
      type: "object",
      value: { status: "exception", message: "" }
    }
  });
  const prepared = await prepareChildDiagnostic(session, snapshot);
  assert.equal(prepared.status, "prepared");
  if (prepared.status !== "prepared") return;

  assert.deepEqual(
    await session.executeJavaScriptDiagnostic({ executionId: prepared.executionId }),
    { status: "exception", message: "" }
  );
});

test("JavaScript diagnostic execution accepts an empty stale-target message", async () => {
  const { connection, session, snapshot } = await createConnectedOopifSession();
  connection.diagnosticRuntimeHandler = () => ({
    result: {
      type: "object",
      value: { status: "stale-target", message: "" }
    }
  });
  const prepared = await prepareChildDiagnostic(session, snapshot);
  assert.equal(prepared.status, "prepared");
  if (prepared.status !== "prepared") return;

  assert.deepEqual(
    await session.executeJavaScriptDiagnostic({ executionId: prepared.executionId }),
    { status: "stale-target", message: "" }
  );
});

test("JavaScript diagnostic execution rejects oversized runtime results", async () => {
  const { connection, session, snapshot } = await createConnectedOopifSession();
  connection.diagnosticRuntimeHandler = () => ({
    result: {
      type: "object",
      value: {
        status: "success",
        value: {
          kind: "array",
          value: Array.from({ length: 6 }, () => ({
            kind: "string",
            value: "x".repeat(20_000),
            truncated: false
          })),
          truncated: false
        }
      }
    }
  });
  const prepared = await prepareChildDiagnostic(session, snapshot);
  assert.equal(prepared.status, "prepared");
  if (prepared.status !== "prepared") return;

  assert.deepEqual(
    await session.executeJavaScriptDiagnostic({ executionId: prepared.executionId }),
    {
      status: "connection-error",
      message: "Runtime evaluation returned an invalid diagnostic result."
    }
  );
});

test("JavaScript diagnostic execution includes main-process fields in the result budget", async () => {
  const { connection, session, snapshot } = await createConnectedOopifSession();
  connection.diagnosticRuntimeHandler = () => ({
    result: {
      type: "object",
      value: {
        status: "success",
        value: {
          kind: "array",
          value: Array.from({ length: 5 }, () => ({
            kind: "string",
            value: "x".repeat(19_935),
            truncated: false
          })),
          truncated: false
        }
      }
    }
  });
  const prepared = await prepareChildDiagnostic(session, snapshot);
  assert.equal(prepared.status, "prepared");
  if (prepared.status !== "prepared") return;

  const result = await session.executeJavaScriptDiagnostic({ executionId: prepared.executionId });

  assert.ok(JSON.stringify(result).length <= 100_000);
  assert.equal(result.status, "connection-error");
});

test("JavaScript diagnostic execution accepts the runtime wrapper's maximum-depth shape", async () => {
  const { connection, session, snapshot } = await createConnectedOopifSession();
  let value: unknown = { kind: "object", value: "[Max depth]", truncated: true };
  for (let depth = 0; depth < 5; depth += 1) {
    value = { kind: "object", value: { next: value }, truncated: false };
  }
  connection.diagnosticRuntimeHandler = () => ({
    result: {
      type: "object",
      value: { status: "success", value }
    }
  });
  const prepared = await prepareChildDiagnostic(session, snapshot);
  assert.equal(prepared.status, "prepared");
  if (prepared.status !== "prepared") return;

  const result = await session.executeJavaScriptDiagnostic({ executionId: prepared.executionId });

  assert.equal(result.status, "success");
});

test("JavaScript diagnostic execution maps CDP exception details", async () => {
  const { connection, session, snapshot } = await createConnectedOopifSession();
  connection.diagnosticRuntimeHandler = () => ({
    result: { type: "object", description: "Promise rejected" },
    exceptionDetails: {
      text: "Uncaught (in promise)",
      exception: { description: "Error: CDP boom\n    at diagnostic:1:1" }
    }
  });
  const prepared = await prepareChildDiagnostic(session, snapshot);
  assert.equal(prepared.status, "prepared");
  if (prepared.status !== "prepared") return;

  const result = await session.executeJavaScriptDiagnostic({ executionId: prepared.executionId });

  assert.deepEqual(result, {
    status: "exception",
    message: "Error: CDP boom",
    stack: "Error: CDP boom\n    at diagnostic:1:1"
  });
});

test("JavaScript diagnostic execution bounds CDP exception details", async () => {
  const { connection, session, snapshot } = await createConnectedOopifSession();
  const description = `Error: ${"m".repeat(30_000)}\n${"s".repeat(30_000)}`;
  connection.diagnosticRuntimeHandler = () => ({
    result: { type: "object", description: "Promise rejected" },
    exceptionDetails: {
      text: `Uncaught ${"t".repeat(30_000)}`,
      exception: { description }
    }
  });
  const prepared = await prepareChildDiagnostic(session, snapshot);
  assert.equal(prepared.status, "prepared");
  if (prepared.status !== "prepared") return;

  const result = await session.executeJavaScriptDiagnostic({ executionId: prepared.executionId });

  assert.equal(result.status, "exception");
  if (result.status !== "exception") return;
  assert.ok(result.message.length <= 20_000);
  assert.ok((result.stack?.length ?? 0) <= 20_000);
  assert.ok(JSON.stringify(result).length <= 100_000);
});

test("JavaScript diagnostic execution distinguishes timeout and connection errors", async () => {
  const timedOut = await createConnectedOopifSession();
  timedOut.connection.diagnosticRuntimeHandler = () => {
    throw new Error("Runtime.evaluate timed out after 5000 ms");
  };
  const timeoutPlan = await prepareChildDiagnostic(timedOut.session, timedOut.snapshot);
  assert.equal(timeoutPlan.status, "prepared");
  if (timeoutPlan.status !== "prepared") return;
  assert.equal(
    (await timedOut.session.executeJavaScriptDiagnostic({ executionId: timeoutPlan.executionId })).status,
    "timeout"
  );

  const disconnected = await createConnectedOopifSession();
  disconnected.connection.diagnosticRuntimeHandler = () => {
    throw new Error("WebSocket closed");
  };
  const connectionPlan = await prepareChildDiagnostic(disconnected.session, disconnected.snapshot);
  assert.equal(connectionPlan.status, "prepared");
  if (connectionPlan.status !== "prepared") return;
  assert.deepEqual(
    await disconnected.session.executeJavaScriptDiagnostic({ executionId: connectionPlan.executionId }),
    { status: "connection-error", message: "WebSocket closed" }
  );
});

test("JavaScript diagnostic execution bounds CDP command errors", async () => {
  const { connection, session, snapshot } = await createConnectedOopifSession();
  connection.diagnosticRuntimeHandler = () => {
    throw new Error("x".repeat(30_000));
  };
  const prepared = await prepareChildDiagnostic(session, snapshot);
  assert.equal(prepared.status, "prepared");
  if (prepared.status !== "prepared") return;

  const result = await session.executeJavaScriptDiagnostic({ executionId: prepared.executionId });

  assert.equal(result.status, "connection-error");
  if (result.status !== "connection-error") return;
  assert.equal(result.message.length, 20_000);
  assert.ok(JSON.stringify(result).length <= 100_000);
});

test("JavaScript diagnostic execution rejects navigation between preparation and execution", async () => {
  const { connection, session, snapshot } = await createConnectedOopifSession();
  const prepared = await prepareChildDiagnostic(session, snapshot);
  assert.equal(prepared.status, "prepared");
  if (prepared.status !== "prepared") return;
  connection.emit(frameNavigatedEvent("child-session", "child-frame", "root-frame", "next-loader"));
  connection.emit(executionContextEvent("child-session", "child-frame", 21));

  const result = await session.executeJavaScriptDiagnostic({ executionId: prepared.executionId });

  assert.equal(result.status, "stale-target");
  assert.equal(connection.sent.some((command) =>
    command.method === "Runtime.evaluate" &&
    String(command.params?.expression).includes("const source =")
  ), false);
});

test("JavaScript diagnostic disconnect clears prepared plans", async () => {
  const { session, snapshot } = await createConnectedOopifSession();
  const prepared = await prepareChildDiagnostic(session, snapshot);
  assert.equal(prepared.status, "prepared");
  if (prepared.status !== "prepared") return;
  session.disconnect();

  const result = await session.executeJavaScriptDiagnostic({ executionId: prepared.executionId });

  assert.equal(result.status, "validation-error");
});

test("JavaScript diagnostic top-level target reconnect clears prepared plans", async () => {
  const { session, snapshot } = await createConnectedOopifSession();
  const prepared = await prepareChildDiagnostic(session, snapshot);
  assert.equal(prepared.status, "prepared");
  if (prepared.status !== "prepared") return;
  const testSession = session as unknown as {
    connectTarget: (targetId: string) => Promise<void>;
  };

  await testSession.connectTarget("page-1");
  const result = await session.executeJavaScriptDiagnostic({ executionId: prepared.executionId });

  assert.equal(result.status, "validation-error");
});

async function prepareChildDiagnostic(
  session: BrowserSession,
  snapshot: DomSnapshotResult,
  intent: "inspect" | "mutate-dom" = "inspect"
) {
  return session.prepareJavaScriptDiagnostic({
    elementId: "child-session::n-2",
    snapshotToken: snapshot.snapshotToken ?? null,
    code: "return $target.textContent;",
    strategy: "dom-query",
    intent
  });
}

async function createConnectedOopifSession(): Promise<{
  connection: RecordingConnection;
  session: BrowserSession;
  snapshot: DomSnapshotResult;
}> {
  const connection = new RecordingConnection(new Map([
    ["root-session", oopifParentSnapshot()],
    ["child-session", oopifChildSnapshot()]
  ]));
  const session = new BrowserSession({
    connection,
    readBrowserVersion: async () => ({
      browser: "Chrome/140.0.0.0",
      webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/browser/browser-id"
    })
  });
  const testSession = session as unknown as {
    fetchTargets: () => Promise<Array<{
      id: string;
      type: string;
      title: string;
      url: string;
      webSocketDebuggerUrl: string;
    }>>;
  };
  testSession.fetchTargets = async () => [{
    id: "page-1",
    type: "page",
    title: "App",
    url: "https://app.test",
    webSocketDebuggerUrl: "ws://page-1"
  }];
  await session.connect("http://127.0.0.1:9222");
  connection.emit(frameNavigatedEvent("root-session", "root-frame", undefined, "root-loader"));
  connection.emit(executionContextEvent("root-session", "root-frame", 10));
  connection.emit(attachedIframeEvent());
  connection.emit(frameNavigatedEvent("child-session", "child-frame", "root-frame", "child-loader"));
  connection.emit(executionContextEvent("child-session", "child-frame", 20));
  await new Promise<void>((resolve) => setImmediate(resolve));
  return { connection, session, snapshot: await session.getDomSnapshot() };
}

function assertContext(
  snapshot: DomSnapshotResult,
  elementId: string
): NonNullable<ElementSnapshot["context"]> {
  const element = findElementSnapshot(snapshot.root, elementId);
  assert.ok(element);
  return element.context ?? [];
}

type RecordedCommand = {
  method: string;
  params?: Record<string, unknown>;
  sessionId?: string;
  options?: CdpSendOptions;
};

class RecordingConnection implements BrowserSessionConnection {
  readonly connectedUrls: string[] = [];
  readonly sent: RecordedCommand[] = [];
  readonly pickedBySession = new Map<string, string | null>();
  diagnosticRuntimeHandler?: (
    sessionId: string | undefined,
    params: Record<string, unknown> | undefined
  ) => unknown | Promise<unknown>;
  registryProbeHandler?: (
    sessionId: string | undefined,
    params: Record<string, unknown> | undefined
  ) => unknown | Promise<unknown>;
  private listeners = new Set<(event: CdpEvent) => void>();
  private connected = false;

  constructor(
    private readonly snapshotsBySession = new Map<string, DomSnapshotResult>()
  ) {}

  async connect(url: string): Promise<void> {
    this.connectedUrls.push(url);
    this.connected = true;
  }

  disconnect(): void {
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  onEvent(listener: (event: CdpEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async send<T>(
    method: string,
    params?: Record<string, unknown>,
    sessionId?: string,
    options?: CdpSendOptions
  ): Promise<T> {
    this.sent.push({ method, params, sessionId, ...(options ? { options } : {}) });
    if (method === "Target.attachToTarget") {
      return { sessionId: "root-session" } as T;
    }
    if (method === "DOM.getFrameOwner") {
      return { backendNodeId: 99 } as T;
    }
    if (method === "DOM.resolveNode") {
      return { object: { objectId: "frame-owner-object" } } as T;
    }
    if (method === "Runtime.evaluate") {
      const expression = String(params?.expression ?? "");
      if (expression.includes("window.__uiExplorerElements?.has")) {
        if (this.registryProbeHandler) {
          return await this.registryProbeHandler(sessionId, params) as T;
        }
        return { result: { type: "boolean", value: true } } as T;
      }
      if (expression.includes("const source =")) {
        return await this.diagnosticRuntimeHandler?.(sessionId, params) as T;
      }
      if (/const elementIds = \[/.test(expression)) {
        const match = /const elementIds = (\[[^;]*\]);/.exec(expression);
        const ids = match ? JSON.parse(match[1]) as string[] : [];
        return {
          result: {
            type: "object",
            value: {
              targets: ids.map((elementId) => ({
                elementId,
                status: "highlighted"
              }))
            }
          }
        } as T;
      }
      if (expression === ELEMENT_PICKER_SCRIPT.replace("__ENABLED__", "true") ||
          expression === ELEMENT_PICKER_SCRIPT.replace("__ENABLED__", "false")) {
        return { result: { type: "boolean", value: true } } as T;
      }
      if (expression === GET_PICKED_ELEMENT_SCRIPT) {
        const picked = sessionId ? this.pickedBySession.get(sessionId) ?? null : null;
        if (sessionId) {
          this.pickedBySession.set(sessionId, null);
        }
        return { result: { type: "string", value: picked } } as T;
      }
      const snapshot = sessionId ? this.snapshotsBySession.get(sessionId) : undefined;
      return {
        result: {
          type: "object",
          value: snapshot
        }
      } as T;
    }
    return {} as T;
  }

  emit(event: CdpEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

function attachedIframeEvent(): CdpEvent {
  return {
    method: "Target.attachedToTarget",
    sessionId: "root-session",
    params: {
      sessionId: "child-session",
      targetInfo: {
        targetId: "child-target",
        type: "iframe",
        title: "",
        url: "https://child.test",
        attached: true,
        canAccessOpener: false
      },
      waitingForDebugger: false
    }
  };
}

function frameNavigatedEvent(
  sessionId: string,
  frameId: string,
  parentFrameId: string | undefined,
  loaderId: string
): CdpEvent {
  return {
    method: "Page.frameNavigated",
    sessionId,
    params: {
      frame: {
        id: frameId,
        ...(parentFrameId ? { parentId: parentFrameId } : {}),
        loaderId,
        url: "https://app.test",
        securityOrigin: "https://app.test",
        mimeType: "text/html"
      },
      type: "Navigation"
    }
  };
}

function executionContextEvent(
  sessionId: string,
  frameId: string,
  executionContextId: number
): CdpEvent {
  return {
    method: "Runtime.executionContextCreated",
    sessionId,
    params: {
      context: {
        id: executionContextId,
        uniqueId: `${sessionId}-context`,
        origin: "https://app.test",
        name: "",
        auxData: {
          isDefault: true,
          type: "default",
          frameId
        }
      }
    }
  };
}

function oopifParentSnapshot(): DomSnapshotResult {
  const context = [{
    kind: "frame" as const,
    hostNodeId: "n-2",
    hostTagName: "iframe",
    hostAttributes: { title: "Payment" },
    frameId: "child-frame",
    targetId: "child-target",
    sessionId: "child-session",
    ownerContentOffset: { x: 100, y: 40 }
  }];
  const unavailable: ElementSnapshot = {
    id: "n-3",
    parentId: "n-2",
    depth: 2,
    nodeType: 8,
    nodeName: "#context-unavailable",
    kind: "diagnostic",
    context,
    diagnostic: {
      code: "cross-origin-frame",
      messageKey: "snapshot.crossOriginFrame",
      detail: "Frame content is not accessible"
    },
    attributes: {},
    childIds: [],
    children: []
  };
  const frame: ElementSnapshot = {
    id: "n-2",
    parentId: "n-1",
    depth: 1,
    nodeType: 1,
    nodeName: "IFRAME",
    tagName: "iframe",
    kind: "element",
    context: [],
    attributes: { title: "Payment" },
    childIds: ["n-3"],
    children: [unavailable]
  };
  return {
    root: {
      id: "n-1",
      depth: 0,
      nodeType: 1,
      nodeName: "HTML",
      tagName: "html",
      kind: "page",
      context: [],
      attributes: {},
      childIds: ["n-2"],
      children: [frame]
    },
    capturedAt: "2026-07-29T00:00:00.000Z",
    snapshotToken: "root-token",
    nodeCount: 3
  };
}

function oopifChildSnapshot(): DomSnapshotResult {
  const button: ElementSnapshot = {
    id: "n-2",
    parentId: "n-1",
    depth: 1,
    nodeType: 1,
    nodeName: "BUTTON",
    tagName: "button",
    text: "Pay",
    kind: "element",
    context: [],
    visible: true,
    attributes: { "data-testid": "oopif-action" },
    childIds: [],
    children: []
  };
  return {
    root: {
      id: "n-1",
      depth: 0,
      nodeType: 1,
      nodeName: "HTML",
      tagName: "html",
      kind: "page",
      context: [],
      attributes: {},
      childIds: ["n-2"],
      children: [button]
    },
    capturedAt: "2026-07-29T00:00:00.000Z",
    snapshotToken: "child-token",
    nodeCount: 2
  };
}
