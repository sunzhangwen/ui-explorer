import assert from "node:assert/strict";
import test from "node:test";
import type { ExecuteJavaScriptDiagnosticResult } from "../../shared/ipc.js";
import {
  initialDiagnosticPanelState,
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
  elementId,
  snapshotToken,
  code: "return 1",
  prepared: binding({ elementId, snapshotToken }),
  confirmed: true
});

test("editing code invalidates a prepared diagnostic", () => {
  const prepared = reduceDiagnosticPanelState(initialDiagnosticPanelState, {
    type: "prepared",
    binding: binding({ code: "return 1", executionId: "execution-1" })
  });

  const edited = reduceDiagnosticPanelState(prepared, {
    type: "code-changed",
    code: "return 2"
  });

  assert.equal(edited.prepared, null);
  assert.equal(edited.confirmed, false);
  assert.equal(edited.result, null);
});

test("a result for an old element is ignored", () => {
  const state = stateFor("element-a", "snapshot-a");
  const next = reduceDiagnosticPanelState(state, {
    type: "execution-finished",
    binding: binding({ elementId: "element-b" }),
    result: successResult()
  });

  assert.equal(next, state);
});

test("an accepted mutation result requests one snapshot refresh", () => {
  const state = stateFor("element-a", "snapshot-a");
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
  const state = stateFor("element-a", "snapshot-a");
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
