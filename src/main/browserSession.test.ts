import test from "node:test";
import assert from "node:assert/strict";
import { BrowserSession, isBrowserLifecycleEvent } from "./browserSession.js";
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
  const session = new BrowserSession();
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
