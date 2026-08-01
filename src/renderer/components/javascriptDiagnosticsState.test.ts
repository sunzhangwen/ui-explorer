import assert from "node:assert/strict";
import test from "node:test";
import type { ExecuteJavaScriptDiagnosticResult } from "../../shared/ipc.js";
import {
  getCurrentPreparedDiagnostic,
  getCurrentDiagnosticResult,
  initialDiagnosticPanelState,
  isDiagnosticDraftCurrent,
  reduceDiagnosticPanelState,
  type DiagnosticExecutionBinding,
  type DiagnosticPanelState
} from "./javascriptDiagnosticsState.js";

const binding = (
  overrides: Partial<DiagnosticExecutionBinding> = {}
): DiagnosticExecutionBinding => ({
  elementId: "element-a",
  snapshotToken: "snapshot-a",
  code: "return 1",
  executionId: "execution-1",
  ...overrides
});

const successResult = (): ExecuteJavaScriptDiagnosticResult => ({
  status: "success",
  value: { kind: "number", value: 1 },
  mutatedDom: false
});

const stateFor = (elementId: string, snapshotToken: string): DiagnosticPanelState => ({
  ...initialDiagnosticPanelState,
  browserTargetId: "target-a",
  elementId,
  snapshotToken,
  code: "return 1",
  prepared: binding({ elementId, snapshotToken }),
  confirmed: true
});

const executingState = (
  elementId = "element-a",
  snapshotToken = "snapshot-a"
): DiagnosticPanelState =>
  reduceDiagnosticPanelState(stateFor(elementId, snapshotToken), {
    type: "execution-started",
    binding: binding({ elementId, snapshotToken })
  });

const preparedState = (): DiagnosticPanelState => {
  const request = {
    elementId: "element-a",
    snapshotToken: "snapshot-a",
    code: "return 1"
  };
  const preparing = reduceDiagnosticPanelState(
    { ...initialDiagnosticPanelState, browserTargetId: "target-a", ...request },
    { type: "prepare-started", binding: request }
  );
  return reduceDiagnosticPanelState(preparing, {
    type: "prepared",
    binding: binding()
  });
};

test("editing code invalidates a prepared diagnostic", () => {
  const prepared = preparedState();
  assert.deepEqual(prepared.prepared, binding());

  const edited = reduceDiagnosticPanelState(prepared, {
    type: "code-changed",
    code: "return 2"
  });

  assert.equal(edited.prepared, null);
  assert.equal(edited.confirmed, false);
  assert.equal(edited.result, null);
});

test("a result for an old element is ignored", () => {
  const state = executingState("element-a", "snapshot-a");
  const next = reduceDiagnosticPanelState(state, {
    type: "execution-finished",
    binding: binding({ elementId: "element-b" }),
    result: successResult()
  });

  assert.equal(next, state);
});

test("an accepted mutation result requests one snapshot refresh", () => {
  const state = executingState();
  const next = reduceDiagnosticPanelState(state, {
    type: "execution-finished",
    binding: binding(),
    result: {
      status: "success",
      value: { kind: "undefined" },
      mutatedDom: true
    }
  });

  assert.equal(next.mutationRefreshExecutionId, "execution-1");
  const consumed = reduceDiagnosticPanelState(next, {
    type: "mutation-refresh-consumed",
    executionId: "execution-1"
  });
  assert.equal(consumed.mutationRefreshExecutionId, null);
});

test("execution results are bound to snapshot, code, and execution ID", () => {
  const state = executingState();
  const staleBindings = [
    binding({ snapshotToken: "snapshot-b" }),
    binding({ code: "return 2" }),
    binding({ executionId: "execution-2" })
  ];

  for (const staleBinding of staleBindings) {
    assert.equal(
      reduceDiagnosticPanelState(state, {
        type: "execution-finished",
        binding: staleBinding,
        result: successResult()
      }),
      state
    );
  }
});

test("replacing the selected target draft clears prepared and confirmed state", () => {
  const state = stateFor("element-a", "snapshot-a");
  const next = reduceDiagnosticPanelState(state, {
    type: "draft-replaced",
    browserTargetId: "target-b",
    elementId: "element-b",
    snapshotToken: "snapshot-b",
    draft: {
      strategy: "tree-traversal",
      intent: "inspect",
      code: "return 2",
      risks: ["arbitrary-code"]
    }
  });

  assert.equal(next.prepared, null);
  assert.equal(next.confirmed, false);
  assert.equal(next.result, null);
  assert.equal(next.elementId, "element-b");
  assert.equal(next.snapshotToken, "snapshot-b");
});

test("a prepare response invalidated by an intervening edit stays stale", () => {
  const request = {
    elementId: "element-a",
    snapshotToken: "snapshot-a",
    code: "return 1"
  };
  const preparing = reduceDiagnosticPanelState(
    {
      ...initialDiagnosticPanelState,
      browserTargetId: "target-a",
      ...request
    },
    { type: "prepare-started", binding: request }
  );
  const edited = reduceDiagnosticPanelState(preparing, {
    type: "code-changed",
    code: "return 2"
  });
  const restored = reduceDiagnosticPanelState(edited, {
    type: "code-changed",
    code: "return 1"
  });

  const next = reduceDiagnosticPanelState(restored, {
    type: "prepared",
    binding: binding()
  });

  assert.equal(next, restored);
});

test("editing during execution keeps the in-flight lock and blocks another preparation", () => {
  const requestBinding = binding();
  const executing = reduceDiagnosticPanelState(stateFor("element-a", "snapshot-a"), {
    type: "execution-started",
    binding: requestBinding
  });
  const edited = reduceDiagnosticPanelState(executing, {
    type: "code-changed",
    code: "return 2"
  });

  assert.deepEqual(edited.executing, requestBinding);
  const prepareAttempt = reduceDiagnosticPanelState(edited, {
    type: "prepare-started",
    binding: {
      elementId: "element-a",
      snapshotToken: "snapshot-a",
      code: "return 2"
    }
  });
  assert.equal(prepareAttempt, edited);
});

test("a stale mutation completion stays hidden and still requests one refresh", () => {
  const requestBinding = binding();
  const executing = reduceDiagnosticPanelState(stateFor("element-a", "snapshot-a"), {
    type: "execution-started",
    binding: requestBinding
  });
  const edited = reduceDiagnosticPanelState(executing, {
    type: "code-changed",
    code: "return 2"
  });
  const settled = reduceDiagnosticPanelState(edited, {
    type: "execution-finished",
    binding: requestBinding,
    result: {
      status: "success",
      value: { kind: "undefined" },
      mutatedDom: true
    }
  });

  assert.equal(settled.executing, null);
  assert.equal(settled.result, null);
  assert.equal(settled.mutationRefreshExecutionId, "execution-1");
});

test("target clearing invalidates a pending preparation response", () => {
  const request = {
    elementId: "element-a",
    snapshotToken: "snapshot-a",
    code: "return 1"
  };
  const preparing = reduceDiagnosticPanelState(
    { ...initialDiagnosticPanelState, browserTargetId: "target-a", ...request },
    { type: "prepare-started", binding: request }
  );
  const cleared = reduceDiagnosticPanelState(preparing, { type: "target-cleared" });
  const next = reduceDiagnosticPanelState(cleared, {
    type: "prepared",
    binding: binding()
  });

  assert.equal(next, cleared);
});

test("prepared execution is synchronously hidden when element or snapshot props change", () => {
  const state = stateFor("element-a", "snapshot-a");

  assert.equal(isDiagnosticDraftCurrent(state, "element-a", "snapshot-a", "target-a"), true);
  assert.equal(isDiagnosticDraftCurrent(state, "element-b", "snapshot-a", "target-a"), false);
  assert.equal(isDiagnosticDraftCurrent(state, "element-a", "snapshot-b", "target-a"), false);
  assert.equal(isDiagnosticDraftCurrent(state, "element-a", "snapshot-a", "target-b"), false);
  assert.equal(
    getCurrentPreparedDiagnostic(state, "element-a", "snapshot-a", "target-a"),
    state.prepared
  );
  assert.equal(getCurrentPreparedDiagnostic(state, "element-b", "snapshot-a", "target-a"), null);
  assert.equal(getCurrentPreparedDiagnostic(state, "element-a", "snapshot-b", "target-a"), null);
  assert.equal(getCurrentPreparedDiagnostic(state, "element-a", "snapshot-a", "target-b"), null);
});

test("execution result is synchronously hidden when element props change", () => {
  const settled = reduceDiagnosticPanelState(executingState(), {
    type: "execution-finished",
    binding: binding(),
    result: successResult()
  });

  assert.equal(
    getCurrentDiagnosticResult(settled, "element-a", "snapshot-a", "target-a"),
    settled.result
  );
  assert.equal(getCurrentDiagnosticResult(settled, "element-b", "snapshot-a", "target-a"), null);
});
