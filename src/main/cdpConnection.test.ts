import test from "node:test";
import assert from "node:assert/strict";
import {
  CdpConnection,
  CdpMessageRouter,
  type CdpEvent,
  type CdpSendOptions
} from "./cdpConnection.js";

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

test("CdpMessageRouter rejects and forgets a command when its local watchdog expires", async () => {
  const router = new CdpMessageRouter();
  const createPendingWithTimeout = router.createPending.bind(router) as <T>(
    id: number,
    options: { timeoutMs: number; timeoutMessage: string }
  ) => Promise<T>;
  const pending = createPendingWithTimeout(11, {
    timeoutMs: 5,
    timeoutMessage: "Runtime.evaluate timed out after 5 ms"
  });

  const outcome = await Promise.race([
    pending.then(
      () => ({ status: "resolved" as const }),
      (error: unknown) => ({
        status: "rejected" as const,
        message: error instanceof Error ? error.message : String(error)
      })
    ),
    new Promise<{ status: "still-pending" }>((resolve) => {
      setTimeout(() => resolve({ status: "still-pending" }), 30);
    })
  ]);

  assert.deepEqual(outcome, {
    status: "rejected",
    message: "Runtime.evaluate timed out after 5 ms"
  });
  assert.doesNotThrow(() => {
    router.accept(JSON.stringify({ id: 11, result: { late: true } }));
  });
});

test("CdpConnection applies the local watchdog while its transport stays open", async () => {
  const connection = new CdpConnection();
  const testConnection = connection as unknown as {
    socket: { destroyed: boolean; write: (payload: unknown) => boolean };
    send: <T>(
      method: string,
      params?: Record<string, unknown>,
      sessionId?: string,
      options?: CdpSendOptions
    ) => Promise<T>;
  };
  testConnection.socket = {
    destroyed: false,
    write: () => true
  };

  const pending = testConnection.send(
    "Runtime.evaluate",
    { expression: "new Promise(() => {})" },
    "child-session",
    {
      timeoutMs: 5,
      timeoutMessage: "Runtime.evaluate timed out after 5 ms"
    }
  );
  const outcome = await Promise.race([
    pending.then(
      () => ({ status: "resolved" as const }),
      (error: unknown) => ({
        status: "rejected" as const,
        message: error instanceof Error ? error.message : String(error)
      })
    ),
    new Promise<{ status: "still-pending" }>((resolve) => {
      setTimeout(() => resolve({ status: "still-pending" }), 30);
    })
  ]);

  assert.deepEqual(outcome, {
    status: "rejected",
    message: "Runtime.evaluate timed out after 5 ms"
  });
});
