import test from "node:test";
import assert from "node:assert/strict";
import { BrowserSession } from "./browserSession.js";
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
