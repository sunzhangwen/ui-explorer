import test from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import {
  DiagnosticExecutionPlanStore,
  buildDiagnosticRuntimeExpression,
  digestDiagnosticCode,
  isRuntimeTimeoutError,
  type DiagnosticExecutionPlanInput
} from "./diagnosticExecution.js";

function planInput(): DiagnosticExecutionPlanInput {
  return {
    code: "return $target.tagName;",
    codeDigest: "digest",
    elementId: "element-1",
    localElementId: "local-1",
    snapshotToken: "snapshot-1",
    sessionId: "session-1",
    sessionRevision: 1,
    intent: "inspect"
  };
}

async function evaluateExpression(expression: string, fakeWindow: Record<string, unknown>): Promise<unknown> {
  const value = runInNewContext(expression, { window: fakeWindow });
  return JSON.parse(JSON.stringify(await value));
}

function fakeWindow(target: Record<string, unknown> = connectedTarget()): Record<string, unknown> {
  return {
    __uiExplorerSnapshotToken: "snapshot-a",
    __uiExplorerElements: new Map([["n-2", target]])
  };
}

function connectedTarget(): Record<string, unknown> {
  return { nodeType: 1, tagName: "BUTTON", isConnected: true };
}

function runtimeExpression(code: string): string {
  return buildDiagnosticRuntimeExpression({
    code,
    localElementId: "n-2",
    snapshotToken: "snapshot-a"
  });
}

test("execution plans expire and are consumed once", () => {
  let now = Date.parse("2026-07-31T10:00:00.000Z");
  const store = new DiagnosticExecutionPlanStore({
    now: () => now,
    createId: () => "execution-1",
    ttlMs: 60_000
  });
  const plan = store.create(planInput());

  assert.equal(plan.executionId, "execution-1");
  assert.equal(store.consume("execution-1").status, "ready");
  assert.equal(store.consume("execution-1").status, "missing");

  store.create(planInput());
  now += 60_001;
  assert.equal(store.consume("execution-1").status, "expired");
});

test("execution plans are immutable copies bound to their original input", () => {
  const store = new DiagnosticExecutionPlanStore({ createId: () => "execution-immutable" });
  const created = store.create(planInput());

  assert.equal(Object.isFrozen(created), true);
  assert.throws(() => {
    Object.assign(created as Record<string, unknown>, {
      code: "return 'tampered';",
      localElementId: "other-target",
      snapshotToken: "other-snapshot",
      sessionId: "other-session",
      sessionRevision: 999,
      expiresAt: "2099-01-01T00:00:00.000Z"
    });
  }, TypeError);

  const consumed = store.consume("execution-immutable");
  assert.equal(consumed.status, "ready");
  if (consumed.status !== "ready") return;

  assert.notStrictEqual(consumed.plan, created);
  assert.equal(Object.isFrozen(consumed.plan), true);
  assert.deepEqual(consumed.plan, {
    ...planInput(),
    executionId: "execution-immutable",
    expiresAt: created.expiresAt
  });
});

test("code digest changes when source changes", () => {
  assert.equal(
    digestDiagnosticCode("return 1"),
    "486d9affb60dbb0063b03d8e23a6ccf6364ce203dc3a9f56f20e750eb41ecade"
  );
  assert.notEqual(digestDiagnosticCode("return 1"), digestDiagnosticCode("return 2"));
});

test("runtime wrapper distinguishes undefined and cyclic objects", async () => {
  const undefinedResult = await evaluateExpression(runtimeExpression("return undefined;"), fakeWindow());
  assert.deepEqual(undefinedResult, {
    status: "success",
    value: { kind: "undefined" }
  });

  const cyclicResult = await evaluateExpression(
    runtimeExpression("const value = {}; value.self = value; return value;"),
    fakeWindow()
  );
  assert.equal((cyclicResult as { status: string }).status, "success");
  assert.match(JSON.stringify(cyclicResult), /Circular/);
});

test("runtime wrapper preserves repeated non-cyclic objects", async () => {
  const result = await evaluateExpression(
    runtimeExpression("const shared = { label: 'shared' }; return { first: shared, second: shared };"),
    fakeWindow()
  );
  assert.doesNotMatch(JSON.stringify(result), /Circular/);
});

test("runtime wrapper summarizes DOM nodes and functions", async () => {
  const domResult = await evaluateExpression(
    runtimeExpression('return { nodeType: 1, tagName: "DIV", id: "card", className: "card primary", textContent: "Hello" };'),
    fakeWindow()
  );
  assert.deepEqual((domResult as { value: unknown }).value, {
    kind: "dom-node",
    tagName: "DIV",
    id: "card",
    className: "card primary",
    text: "Hello"
  });

  const functionResult = await evaluateExpression(runtimeExpression("return function inspectTarget() {};"), fakeWindow());
  assert.deepEqual((functionResult as { value: unknown }).value, {
    kind: "function",
    value: "inspectTarget"
  });
});

test("runtime wrapper survives throwing accessors", async () => {
  const result = await evaluateExpression(
    runtimeExpression('const value = {}; Object.defineProperty(value, "bad", { enumerable: true, get() { throw new Error("access denied"); } }); return value;'),
    fakeWindow()
  );
  assert.equal((result as { status: string }).status, "success");
  assert.match(JSON.stringify(result), /access denied/);
});

test("runtime wrapper enforces string and total-character serialization caps", async () => {
  const stringResult = await evaluateExpression(runtimeExpression('return "x".repeat(20_001);'), fakeWindow());
  const stringValue = (stringResult as { value: { kind: string; value: string; truncated: boolean } }).value;
  assert.equal(stringValue.kind, "string");
  assert.equal(stringValue.value.length, 20_000);
  assert.equal(stringValue.truncated, true);

  const totalResult = await evaluateExpression(
    runtimeExpression('return Array.from({ length: 6 }, () => "x".repeat(20_000));'),
    fakeWindow()
  );
  const totalValue = (totalResult as { value: { kind: string; value: Array<{ value: string }>; truncated: boolean } }).value;
  assert.equal(totalValue.kind, "array");
  assert.equal(totalValue.truncated, true);
  assert.ok(totalValue.value.reduce((total, entry) => total + entry.value.length, 0) <= 100_000);
});

test("runtime wrapper caps complete string-heavy results", async () => {
  const result = await evaluateExpression(
    runtimeExpression('return Array.from({ length: 6 }, () => "x".repeat(20_000));'),
    fakeWindow()
  );

  assert.ok(JSON.stringify(result).length <= 100_000);
});

test("runtime wrapper caps complete numeric boolean and null-heavy results", async () => {
  const result = await evaluateExpression(
    runtimeExpression("return Array.from({ length: 100 }, () => Array.from({ length: 100 }, (_, index) => index % 3 === 0 ? index : index % 3 === 1 ? true : null));"),
    fakeWindow()
  );

  assert.ok(JSON.stringify(result).length <= 100_000);
});

test("runtime wrapper caps complete exception results", async () => {
  const result = await evaluateExpression(
    runtimeExpression('const error = new Error("m".repeat(30_000)); error.stack = "s".repeat(30_000); throw error;'),
    fakeWindow()
  );
  const exception = result as { status: string; message: string; stack?: string };

  assert.equal(exception.status, "exception");
  assert.ok(exception.message.length <= 20_000);
  assert.ok((exception.stack?.length ?? 0) <= 20_000);
  assert.ok(JSON.stringify(result).length <= 100_000);
});

test("runtime wrapper enforces depth and entry serialization caps", async () => {
  const depthResult = await evaluateExpression(
    runtimeExpression("let value = 0; for (let index = 0; index < 6; index += 1) value = { next: value }; return value;"),
    fakeWindow()
  );
  assert.match(JSON.stringify(depthResult), /Max depth/);

  const entriesResult = await evaluateExpression(runtimeExpression("return Array.from({ length: 101 }, (_, index) => index);"), fakeWindow());
  const entriesValue = (entriesResult as { value: { kind: string; value: unknown[]; truncated: boolean } }).value;
  assert.equal(entriesValue.kind, "array");
  assert.equal(entriesValue.value.length, 100);
  assert.equal(entriesValue.truncated, true);
});

test("runtime wrapper limits huge sparse arrays without materializing every index", async () => {
  const result = await evaluateExpression(
    runtimeExpression(
      'const value = []; value.length = 1_000_000_000; Array.from = () => { throw new Error("unexpected full array materialization"); }; return value;'
    ),
    fakeWindow()
  );
  const value = (result as { value: { kind: string; value: unknown[]; truncated: boolean } }).value;

  assert.equal(value.kind, "array");
  assert.equal(value.value.length, 100);
  assert.equal(value.truncated, true);
  assert.doesNotMatch(JSON.stringify(result), /unexpected full array materialization/);
});

test("runtime wrapper rejects stale targets", async () => {
  const snapshotResult = await evaluateExpression(runtimeExpression("return 1;"), {
    ...fakeWindow(),
    __uiExplorerSnapshotToken: "snapshot-new"
  });
  const missingResult = await evaluateExpression(runtimeExpression("return 1;"), {
    __uiExplorerSnapshotToken: "snapshot-a",
    __uiExplorerElements: new Map()
  });
  const detachedResult = await evaluateExpression(runtimeExpression("return 1;"), fakeWindow({ ...connectedTarget(), isConnected: false }));

  for (const result of [snapshotResult, missingResult, detachedResult]) {
    assert.equal((result as { status: string }).status, "stale-target");
  }
});

test("runtime wrapper returns user exceptions and awaited values", async () => {
  const exceptionResult = await evaluateExpression(runtimeExpression('throw new Error("boom");'), fakeWindow());
  assert.equal((exceptionResult as { status: string }).status, "exception");
  assert.match(JSON.stringify(exceptionResult), /boom/);

  const asyncResult = await evaluateExpression(runtimeExpression('return await Promise.resolve("done");'), fakeWindow());
  assert.deepEqual(asyncResult, {
    status: "success",
    value: { kind: "string", value: "done", truncated: false }
  });
});

test("runtime timeout classifier recognizes CDP timeout errors", () => {
  assert.equal(isRuntimeTimeoutError(new Error("Runtime.evaluate timed out")), true);
  assert.equal(isRuntimeTimeoutError({ message: "Execution was terminated" }), true);
  assert.equal(isRuntimeTimeoutError(new Error("connection reset")), false);
});
