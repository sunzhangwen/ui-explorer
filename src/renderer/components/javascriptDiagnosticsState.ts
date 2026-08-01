import type {
  ExecuteJavaScriptDiagnosticResult,
  PrepareJavaScriptDiagnosticResult
} from "../../shared/ipc.js";
import type {
  JavaScriptDiagnosticDraft,
  JavaScriptDiagnosticIntent,
  JavaScriptDiagnosticRiskCode,
  JavaScriptDiagnosticStrategy
} from "../../shared/javascriptDiagnostics.js";

export type DiagnosticDraftBinding = {
  elementId: string;
  snapshotToken: string | null;
  code: string;
};

export type DiagnosticExecutionBinding = DiagnosticDraftBinding & {
  executionId: string;
};

type PreparedResult = Extract<PrepareJavaScriptDiagnosticResult, { status: "prepared" }>;
type RejectedResult = Extract<PrepareJavaScriptDiagnosticResult, { status: "rejected" }>;

export type DiagnosticPanelState = {
  browserTargetId: string | null;
  elementId: string | null;
  snapshotToken: string | null;
  code: string;
  strategy: JavaScriptDiagnosticStrategy;
  intent: JavaScriptDiagnosticIntent;
  risks: JavaScriptDiagnosticRiskCode[];
  preparing: DiagnosticDraftBinding | null;
  preparationError: RejectedResult | null;
  prepared: DiagnosticExecutionBinding | null;
  preparedDetails: PreparedResult | null;
  confirmed: boolean;
  executing: DiagnosticExecutionBinding | null;
  result: {
    binding: DiagnosticExecutionBinding;
    value: ExecuteJavaScriptDiagnosticResult;
  } | null;
  mutationRefreshExecutionId: string | null;
};

export type DiagnosticPanelAction =
  | {
      type: "draft-replaced";
      browserTargetId: string;
      elementId: string | null;
      snapshotToken: string | null;
      draft: JavaScriptDiagnosticDraft;
    }
  | { type: "target-cleared" }
  | { type: "code-changed"; code: string }
  | { type: "prepare-started"; binding: DiagnosticDraftBinding }
  | { type: "prepared"; binding: DiagnosticExecutionBinding; details?: PreparedResult }
  | { type: "preparation-rejected"; binding: DiagnosticDraftBinding; result: RejectedResult }
  | { type: "confirmation-changed"; confirmed: boolean }
  | { type: "execution-started"; binding: DiagnosticExecutionBinding }
  | {
      type: "execution-finished";
      binding: DiagnosticExecutionBinding;
      result: ExecuteJavaScriptDiagnosticResult;
    }
  | { type: "mutation-refresh-consumed"; executionId: string };

export const initialDiagnosticPanelState: DiagnosticPanelState = {
  browserTargetId: null,
  elementId: null,
  snapshotToken: null,
  code: "",
  strategy: "dom-query",
  intent: "inspect",
  risks: ["arbitrary-code"],
  preparing: null,
  preparationError: null,
  prepared: null,
  preparedDetails: null,
  confirmed: false,
  executing: null,
  result: null,
  mutationRefreshExecutionId: null
};

export function reduceDiagnosticPanelState(
  state: DiagnosticPanelState,
  action: DiagnosticPanelAction
): DiagnosticPanelState {
  switch (action.type) {
    case "draft-replaced":
      if (
        state.browserTargetId === action.browserTargetId &&
        state.elementId === action.elementId &&
        state.snapshotToken === action.snapshotToken &&
        state.code === action.draft.code &&
        state.strategy === action.draft.strategy &&
        state.intent === action.draft.intent
      ) {
        return state;
      }
      return invalidateDiagnostic(state, {
        browserTargetId: action.browserTargetId,
        elementId: action.elementId,
        snapshotToken: action.snapshotToken,
        code: action.draft.code,
        strategy: action.draft.strategy,
        intent: action.draft.intent,
        risks: action.draft.risks
      });
    case "target-cleared":
      if (
        state.browserTargetId === null &&
        state.elementId === null &&
        state.snapshotToken === null &&
        state.code === ""
      ) {
        return state;
      }
      return invalidateDiagnostic(state, {
        browserTargetId: null,
        elementId: null,
        snapshotToken: null,
        code: "",
        intent: "inspect",
        risks: ["arbitrary-code"]
      });
    case "code-changed":
      if (state.code === action.code) {
        return state;
      }
      return invalidateDiagnostic(state, { code: action.code });
    case "prepare-started":
      if (state.executing || !isDraftBindingCurrent(state, action.binding)) {
        return state;
      }
      return {
        ...state,
        preparing: action.binding,
        preparationError: null,
        prepared: null,
        preparedDetails: null,
        confirmed: false,
        result: null
      };
    case "prepared": {
      if (
        !isDraftBindingCurrent(state, action.binding) ||
        !sameDraftBinding(state.preparing, action.binding)
      ) {
        return state;
      }
      return {
        ...state,
        elementId: action.binding.elementId,
        snapshotToken: action.binding.snapshotToken,
        code: action.binding.code,
        preparing: null,
        preparationError: null,
        prepared: action.binding,
        preparedDetails: action.details ?? null,
        confirmed: false,
        result: null
      };
    }
    case "preparation-rejected":
      if (
        !isDraftBindingCurrent(state, action.binding) ||
        !sameDraftBinding(state.preparing, action.binding)
      ) {
        return state;
      }
      return {
        ...state,
        preparing: null,
        preparationError: action.result,
        prepared: null,
        preparedDetails: null,
        confirmed: false,
        result: null
      };
    case "confirmation-changed":
      if (!state.prepared || state.executing) {
        return state;
      }
      return { ...state, confirmed: action.confirmed };
    case "execution-started":
      if (
        state.executing ||
        !state.confirmed ||
        !sameExecutionBinding(state.prepared, action.binding)
      ) {
        return state;
      }
      return { ...state, executing: action.binding, result: null };
    case "execution-finished": {
      if (!sameExecutionBinding(state.executing, action.binding)) {
        return state;
      }
      const resultIsCurrent =
        isDraftBindingCurrent(state, action.binding) &&
        sameExecutionBinding(state.prepared, action.binding);
      return {
        ...state,
        preparing: null,
        prepared: null,
        preparedDetails: null,
        confirmed: false,
        executing: null,
        result: resultIsCurrent ? { binding: action.binding, value: action.result } : null,
        mutationRefreshExecutionId:
          action.result.status === "success" && action.result.mutatedDom
            ? action.binding.executionId
            : state.mutationRefreshExecutionId
      };
    }
    case "mutation-refresh-consumed":
      return state.mutationRefreshExecutionId === action.executionId
        ? { ...state, mutationRefreshExecutionId: null }
        : state;
    default: {
      const exhaustiveAction: never = action;
      return exhaustiveAction;
    }
  }
}

export function isDiagnosticDraftCurrent(
  state: DiagnosticPanelState,
  elementId: string | null,
  snapshotToken: string | null,
  browserTargetId: string | null
): boolean {
  return (
    elementId !== null &&
    browserTargetId !== null &&
    state.browserTargetId === browserTargetId &&
    state.elementId === elementId &&
    state.snapshotToken === snapshotToken
  );
}

export function getCurrentPreparedDiagnostic(
  state: DiagnosticPanelState,
  elementId: string | null,
  snapshotToken: string | null,
  browserTargetId: string | null
): DiagnosticExecutionBinding | null {
  if (
    !isDiagnosticDraftCurrent(state, elementId, snapshotToken, browserTargetId) ||
    !state.prepared
  ) {
    return null;
  }
  return isDraftBindingCurrent(state, state.prepared) ? state.prepared : null;
}

export function getCurrentDiagnosticResult(
  state: DiagnosticPanelState,
  elementId: string | null,
  snapshotToken: string | null,
  browserTargetId: string | null
): DiagnosticPanelState["result"] {
  if (
    !isDiagnosticDraftCurrent(state, elementId, snapshotToken, browserTargetId) ||
    !state.result
  ) {
    return null;
  }
  return isDraftBindingCurrent(state, state.result.binding) ? state.result : null;
}

function invalidateDiagnostic(
  state: DiagnosticPanelState,
  replacement: Partial<
    Pick<
      DiagnosticPanelState,
      | "browserTargetId"
      | "elementId"
      | "snapshotToken"
      | "code"
      | "strategy"
      | "intent"
      | "risks"
    >
  >
): DiagnosticPanelState {
  return {
    ...state,
    ...replacement,
    preparing: null,
    preparationError: null,
    prepared: null,
    preparedDetails: null,
    confirmed: false,
    result: null
  };
}

function isDraftBindingCurrent(
  state: DiagnosticPanelState,
  binding: DiagnosticDraftBinding
): boolean {
  return (
    state.elementId === binding.elementId &&
    state.snapshotToken === binding.snapshotToken &&
    state.code === binding.code
  );
}

function sameExecutionBinding(
  left: DiagnosticExecutionBinding | null,
  right: DiagnosticExecutionBinding
): boolean {
  return (
    left?.elementId === right.elementId &&
    left.snapshotToken === right.snapshotToken &&
    left.code === right.code &&
    left.executionId === right.executionId
  );
}

function sameDraftBinding(
  left: DiagnosticDraftBinding | null,
  right: DiagnosticDraftBinding
): boolean {
  return (
    left?.elementId === right.elementId &&
    left.snapshotToken === right.snapshotToken &&
    left.code === right.code
  );
}
