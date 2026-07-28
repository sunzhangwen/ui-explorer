import test from "node:test";
import assert from "node:assert/strict";
import {
  BrowserSession,
  isBrowserLifecycleEvent,
  type BrowserSessionConnection
} from "./browserSession.js";
import type { CdpEvent } from "./cdpConnection.js";
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

  await session.connect("http://127.0.0.1:9222");

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
    command.params?.frameId === "child-frame"
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

type RecordedCommand = {
  method: string;
  params?: Record<string, unknown>;
  sessionId?: string;
};

class RecordingConnection implements BrowserSessionConnection {
  readonly connectedUrls: string[] = [];
  readonly sent: RecordedCommand[] = [];
  readonly pickedBySession = new Map<string, string | null>();
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
    sessionId?: string
  ): Promise<T> {
    this.sent.push({ method, params, sessionId });
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
