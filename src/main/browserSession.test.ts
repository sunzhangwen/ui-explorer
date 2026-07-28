import test from "node:test";
import assert from "node:assert/strict";
import {
  BrowserSession,
  isBrowserLifecycleEvent,
  type BrowserSessionConnection
} from "./browserSession.js";
import type { CdpEvent } from "./cdpConnection.js";
import { SNAPSHOT_SCRIPT } from "./browserScripts.js";

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

type RecordedCommand = {
  method: string;
  params?: Record<string, unknown>;
  sessionId?: string;
};

class RecordingConnection implements BrowserSessionConnection {
  readonly connectedUrls: string[] = [];
  readonly sent: RecordedCommand[] = [];
  private listeners = new Set<(event: CdpEvent) => void>();
  private connected = false;

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
    return {} as T;
  }

  emit(event: CdpEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}
