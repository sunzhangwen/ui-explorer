import { AlertTriangle, CheckCircle2, Code2, Play, ShieldAlert } from "lucide-react";
import { useEffect, useMemo, useReducer, useRef } from "react";
import type {
  BrowserTarget,
  ElementSnapshot,
  ExecuteJavaScriptDiagnosticResult,
  IpcApi,
  JavaScriptDiagnosticValue,
  PrepareJavaScriptDiagnosticResult,
  ThemeName
} from "../../shared/ipc";
import {
  generateAttributeEditDraft,
  generateJavaScriptDiagnosticDraft,
  getJavaScriptDiagnosticSuggestions,
  validateJavaScriptDiagnosticCode,
  type AttributeEditDraft,
  type JavaScriptDiagnosticStrategy,
  type JavaScriptDiagnosticSuggestionCode
} from "../../shared/javascriptDiagnostics";
import type { SelectorCandidate } from "../../shared/selector";
import { useI18n } from "../i18n/I18nProvider";
import type { MessageKey } from "../i18n/messages";
import {
  initialDiagnosticPanelState,
  reduceDiagnosticPanelState,
  type DiagnosticDraftBinding,
  type DiagnosticExecutionBinding
} from "./javascriptDiagnosticsState";
import { MonacoCodeEditor } from "./MonacoCodeEditor";

export type JavaScriptDiagnosticsPanelProps = {
  element: ElementSnapshot | null;
  root: ElementSnapshot | null;
  candidate: SelectorCandidate | null;
  browserTarget: BrowserTarget | null;
  snapshotToken: string | null;
  theme: ThemeName;
  requestedAttributeEdit: AttributeEditDraft | null;
  onAttributeEditConsumed: () => void;
  onPrepare: IpcApi["prepareJavaScriptDiagnostic"];
  onExecute: IpcApi["executeJavaScriptDiagnostic"];
  onMutationComplete: () => Promise<void>;
};

const STRATEGIES: JavaScriptDiagnosticStrategy[] = [
  "dom-query",
  "tree-traversal",
  "context-traversal"
];

export function JavaScriptDiagnosticsPanel({
  browserTarget,
  candidate,
  element,
  onAttributeEditConsumed,
  onExecute,
  onMutationComplete,
  onPrepare,
  requestedAttributeEdit,
  root,
  snapshotToken,
  theme
}: JavaScriptDiagnosticsPanelProps): JSX.Element {
  const { t } = useI18n();
  const [state, dispatch] = useReducer(
    reduceDiagnosticPanelState,
    initialDiagnosticPanelState
  );
  const refreshedExecutionId = useRef<string | null>(null);
  const elementId = element?.id ?? null;
  const browserTargetId = browserTarget?.id ?? null;
  const requestedAttributeName = requestedAttributeEdit?.attributeName ?? null;
  const requestedAttributeValue = requestedAttributeEdit?.attributeValue ?? null;

  useEffect(() => {
    if (!element || element.diagnostic || !browserTargetId) {
      dispatch({ type: "target-cleared" });
      return;
    }
    dispatch({
      type: "draft-replaced",
      elementId: element.id,
      snapshotToken,
      draft: generateJavaScriptDiagnosticDraft({
        element,
        candidate,
        strategy: "dom-query"
      })
    });
  }, [browserTargetId, elementId, snapshotToken]);

  useEffect(() => {
    if (requestedAttributeName === null || requestedAttributeValue === null) {
      return;
    }
    if (element && !element.diagnostic && browserTargetId) {
      dispatch({
        type: "draft-replaced",
        elementId: element.id,
        snapshotToken,
        draft: generateAttributeEditDraft({
          attributeName: requestedAttributeName,
          attributeValue: requestedAttributeValue
        })
      });
    }
    onAttributeEditConsumed();
  }, [
    browserTargetId,
    elementId,
    onAttributeEditConsumed,
    requestedAttributeName,
    requestedAttributeValue,
    snapshotToken
  ]);

  useEffect(() => {
    const executionId = state.mutationRefreshExecutionId;
    if (!executionId || refreshedExecutionId.current === executionId) {
      return;
    }
    refreshedExecutionId.current = executionId;
    dispatch({ type: "mutation-refresh-consumed", executionId });
    void onMutationComplete();
  }, [onMutationComplete, state.mutationRefreshExecutionId]);

  const failure =
    state.result?.value.status === "timeout" || state.result?.value.status === "stale-target"
      ? state.result.value.status
      : undefined;
  const suggestions = useMemo(
    () =>
      element && !element.diagnostic
        ? getJavaScriptDiagnosticSuggestions({ element, candidate, failure })
        : [],
    [candidate, element, failure]
  );
  const codeValidation = validateJavaScriptDiagnosticCode(state.code);
  const canPrepare =
    Boolean(element && root && browserTarget && !element.diagnostic) &&
    codeValidation.ok &&
    state.preparing === null &&
    state.executing === null;
  const contextSummary = formatContextPath(element);

  const selectStrategy = (strategy: JavaScriptDiagnosticStrategy) => {
    if (!element || element.diagnostic) {
      return;
    }
    dispatch({
      type: "draft-replaced",
      elementId: element.id,
      snapshotToken,
      draft: generateJavaScriptDiagnosticDraft({ element, candidate, strategy })
    });
  };

  const prepareExecution = async () => {
    if (!element || !canPrepare) {
      return;
    }
    const binding: DiagnosticDraftBinding = {
      elementId: element.id,
      snapshotToken,
      code: state.code
    };
    dispatch({ type: "prepare-started", binding });
    let result: PrepareJavaScriptDiagnosticResult;
    try {
      result = await onPrepare({
        ...binding,
        strategy: state.strategy,
        intent: state.intent
      });
    } catch (error) {
      result = {
        status: "rejected",
        code: "session-unavailable",
        message: error instanceof Error ? error.message : String(error)
      };
    }
    if (result.status === "prepared") {
      dispatch({
        type: "prepared",
        binding: { ...binding, executionId: result.executionId },
        details: result
      });
    } else {
      dispatch({ type: "preparation-rejected", binding, result });
    }
  };

  const executeOnce = async () => {
    const binding = state.prepared;
    if (!binding || !state.confirmed || state.executing) {
      return;
    }
    dispatch({ type: "execution-started", binding });
    let result: ExecuteJavaScriptDiagnosticResult;
    try {
      result = await onExecute({ executionId: binding.executionId });
    } catch (error) {
      result = {
        status: "connection-error",
        message: error instanceof Error ? error.message : String(error)
      };
    }
    dispatch({ type: "execution-finished", binding, result });
  };

  if (!element || !root || !browserTarget) {
    return <p className="empty-copy">{t("javascript.empty")}</p>;
  }
  if (element.diagnostic) {
    return <p className="empty-copy">{t("javascript.emptyUnavailable")}</p>;
  }

  return (
    <div className="javascript-diagnostics-panel">
      <section className="javascript-target-card">
        <h3>{t("javascript.target.title")}</h3>
        <dl>
          <div>
            <dt>{t("javascript.target.page")}</dt>
            <dd>{browserTarget.title || "-"}</dd>
          </div>
          <div>
            <dt>{t("javascript.target.url")}</dt>
            <dd title={browserTarget.url}>{browserTarget.url || "-"}</dd>
          </div>
          <div>
            <dt>{t("javascript.target.element")}</dt>
            <dd>{element.tagName ?? element.nodeName}</dd>
          </div>
          <div>
            <dt>{t("javascript.target.context")}</dt>
            <dd>{contextSummary}</dd>
          </div>
        </dl>
      </section>

      <div className="javascript-strategies" role="group" aria-label={t("javascript.strategy.title")}>
        {STRATEGIES.map((strategy) => (
          <button
            type="button"
            key={strategy}
            className={state.strategy === strategy ? "selected" : ""}
            onClick={() => selectStrategy(strategy)}
          >
            {t(getStrategyMessageKey(strategy))}
          </button>
        ))}
      </div>

      <section className="editor-shell javascript-editor-shell">
        <div className="editor-title">
          <Code2 size={14} />
          {t("javascript.editorTitle")}
        </div>
        <MonacoCodeEditor
          height="190px"
          language="javascript"
          value={state.code}
          onChange={(value) => dispatch({ type: "code-changed", code: value ?? "" })}
          options={{
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            fontSize: 12,
            lineNumbers: "on",
            folding: true,
            automaticLayout: true
          }}
          theme={theme === "dark" ? "vs-dark" : "light"}
        />
      </section>

      <section className="javascript-risk-card">
        <ShieldAlert size={15} />
        <div>
          <h3>{t("javascript.risk.title")}</h3>
          <p>{t("javascript.risk.arbitraryCode")}</p>
          {state.intent === "mutate-dom" ? (
            <p className="mutation-warning">{t("javascript.risk.domMutation")}</p>
          ) : null}
        </div>
      </section>

      <section className="property-card javascript-suggestions">
        <h3>{t("javascript.suggestions.title")}</h3>
        {suggestions.length === 0 ? (
          <p className="empty-copy">{t("javascript.suggestions.empty")}</p>
        ) : (
          <ul>
            {suggestions.map((suggestion) => (
              <li key={suggestion}>{t(getSuggestionMessageKey(suggestion))}</li>
            ))}
          </ul>
        )}
      </section>

      {!codeValidation.ok ? (
        <p className="javascript-validation" role="alert">
          {t(`javascript.validation.${codeValidation.code}`)}
        </p>
      ) : null}
      <button
        type="button"
        className="javascript-action primary"
        disabled={!canPrepare}
        onClick={() => void prepareExecution()}
      >
        <CheckCircle2 size={14} />
        {state.preparing ? t("javascript.preparing") : t("javascript.prepare")}
      </button>

      {state.preparationError ? (
        <section className="javascript-result" data-status="error" role="alert">
          <AlertTriangle size={15} />
          <div>
            <h3>{t("javascript.preparation.rejected")}</h3>
            <strong>{t(getPreparationErrorMessageKey(state.preparationError.code))}</strong>
            <p>{state.preparationError.message}</p>
          </div>
        </section>
      ) : null}

      {state.prepared && state.preparedDetails ? (
        <section className="javascript-confirmation">
          <h3>{t("javascript.prepared")}</h3>
          <dl>
            <div>
              <dt>{t("javascript.prepared.target")}</dt>
              <dd>{state.preparedDetails.target.title || state.preparedDetails.target.url}</dd>
            </div>
            <div>
              <dt>{t("javascript.prepared.expiresAt")}</dt>
              <dd>{state.preparedDetails.expiresAt}</dd>
            </div>
            <div>
              <dt>{t("javascript.prepared.codeDigest")}</dt>
              <dd><code>{state.preparedDetails.codeDigest}</code></dd>
            </div>
          </dl>
          <label>
            <input
              type="checkbox"
              checked={state.confirmed}
              disabled={Boolean(state.executing)}
              onChange={(event) =>
                dispatch({
                  type: "confirmation-changed",
                  confirmed: event.currentTarget.checked
                })
              }
            />
            <span>{t("javascript.confirm")}</span>
          </label>
          <button
            type="button"
            className="javascript-action danger"
            disabled={!state.confirmed || Boolean(state.executing)}
            onClick={() => void executeOnce()}
          >
            <Play size={14} />
            {state.executing ? t("javascript.executing") : t("javascript.executeOnce")}
          </button>
        </section>
      ) : null}

      {state.result ? <DiagnosticResult result={state.result.value} /> : null}
    </div>
  );
}

function DiagnosticResult({ result }: { result: ExecuteJavaScriptDiagnosticResult }): JSX.Element {
  const { t } = useI18n();
  switch (result.status) {
    case "success":
      return (
        <section className="javascript-result" data-status="success">
          <CheckCircle2 size={15} />
          <div>
            <h3>{t("javascript.result.success")}</h3>
            <pre>{formatDiagnosticValue(result.value)}</pre>
            <p>
              {t(result.mutatedDom ? "javascript.result.mutated" : "javascript.result.notMutated")}
            </p>
          </div>
        </section>
      );
    case "exception":
      return (
        <DiagnosticFailure
          title={t("javascript.result.exception")}
          message={result.message}
          detail={result.stack}
        />
      );
    case "timeout":
      return <DiagnosticFailure title={t("javascript.result.timeout")} message={result.message} />;
    case "stale-target":
      return <DiagnosticFailure title={t("javascript.result.staleTarget")} message={result.message} />;
    case "validation-error":
      return <DiagnosticFailure title={t("javascript.result.validationError")} message={result.message} />;
    case "connection-error":
      return <DiagnosticFailure title={t("javascript.result.connectionError")} message={result.message} />;
    default: {
      const exhaustiveResult: never = result;
      return exhaustiveResult;
    }
  }
}

function DiagnosticFailure({
  detail,
  message,
  title
}: {
  detail?: string;
  message: string;
  title: string;
}): JSX.Element {
  return (
    <section className="javascript-result" data-status="error" role="alert">
      <AlertTriangle size={15} />
      <div>
        <h3>{title}</h3>
        <p>{message}</p>
        {detail ? <pre>{detail}</pre> : null}
      </div>
    </section>
  );
}

function formatDiagnosticValue(value: JavaScriptDiagnosticValue): string {
  switch (value.kind) {
    case "undefined":
      return "undefined";
    case "null":
      return "null";
    case "boolean":
    case "number":
      return String(value.value);
    case "string":
    case "bigint":
    case "symbol":
    case "function":
      return value.value;
    case "dom-node":
      return JSON.stringify(value, null, 2);
    case "object":
    case "array":
      return JSON.stringify(value.value, null, 2) ?? String(value.value);
    default: {
      const exhaustiveValue: never = value;
      return exhaustiveValue;
    }
  }
}

function formatContextPath(element: ElementSnapshot | null): string {
  const context = element?.context ?? [];
  if (context.length === 0) {
    return "document";
  }
  return context
    .map((boundary) => `${boundary.kind}:${boundary.hostTagName || boundary.hostNodeId}`)
    .join(" → ");
}

function getStrategyMessageKey(strategy: JavaScriptDiagnosticStrategy): MessageKey {
  switch (strategy) {
    case "dom-query":
      return "javascript.strategy.domQuery";
    case "tree-traversal":
      return "javascript.strategy.treeTraversal";
    case "context-traversal":
      return "javascript.strategy.contextTraversal";
    default: {
      const exhaustiveStrategy: never = strategy;
      return exhaustiveStrategy;
    }
  }
}

function getSuggestionMessageKey(suggestion: JavaScriptDiagnosticSuggestionCode): MessageKey {
  return `javascript.suggestion.${suggestion}`;
}

function getPreparationErrorMessageKey(
  code: Extract<PrepareJavaScriptDiagnosticResult, { status: "rejected" }>["code"]
): MessageKey {
  return `javascript.preparation.${code}`;
}
