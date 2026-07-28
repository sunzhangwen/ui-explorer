import test from "node:test";
import assert from "node:assert/strict";
import { CdpMessageRouter, type CdpEvent } from "./cdpConnection.js";

test("CdpMessageRouter resolves a flat-session response by command id", async () => {
  const router = new CdpMessageRouter();
  const pending = router.createPending<{ ok: boolean }>(7);

  router.accept(JSON.stringify({
    id: 7,
    sessionId: "child-session",
    result: { ok: true }
  }));

  assert.deepEqual(await pending, { ok: true });
});

test("CdpMessageRouter rejects a command when CDP returns an error", async () => {
  const router = new CdpMessageRouter();
  const pending = router.createPending(8);

  router.accept(JSON.stringify({
    id: 8,
    error: { code: -32000, message: "No target with given id found" }
  }));

  await assert.rejects(pending, /No target with given id found/);
});

test("CdpMessageRouter emits flat-session events with their session id", () => {
  const router = new CdpMessageRouter();
  const events: CdpEvent[] = [];
  const unsubscribe = router.onEvent((event) => events.push(event));

  router.accept(JSON.stringify({
    method: "Page.frameNavigated",
    sessionId: "child-session",
    params: { frame: { id: "child-frame" } }
  }));
  unsubscribe();

  assert.deepEqual(events, [{
    method: "Page.frameNavigated",
    sessionId: "child-session",
    params: { frame: { id: "child-frame" } }
  }]);
});

test("CdpMessageRouter rejects every pending command when the connection closes", async () => {
  const router = new CdpMessageRouter();
  const first = router.createPending(9);
  const second = router.createPending(10);

  router.rejectPending(new Error("CDP websocket closed."));

  await assert.rejects(first, /CDP websocket closed/);
  await assert.rejects(second, /CDP websocket closed/);
});
