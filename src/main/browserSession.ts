import { getDefaultBrowserTargetId, recoverBrowserTarget, toBrowserTargets } from "../shared/browserTargets.js";
import { normalizeDebugEndpoint } from "../shared/domSnapshot.js";
import type {
  BrowserConnectionDiagnostics,
  BrowserConnectionInfo,
  BrowserTarget,
  DomSnapshotResult,
  HighlightElementRequest,
  HighlightElementsRequest,
  HighlightResult
} from "../shared/ipc.js";
import { ELEMENT_PICKER_SCRIPT, GET_PICKED_ELEMENT_SCRIPT, HIGHLIGHT_SCRIPT, SNAPSHOT_SCRIPT } from "./browserScripts.js";
import { CdpConnection } from "./cdpConnection.js";

type RuntimeEvaluateResult<T> = {
  result: {
    type: string;
    value?: T;
    description?: string;
  };
  exceptionDetails?: {
    text?: string;
  };
};

export class BrowserSession {
  private endpoint: string | null = null;
  private targets: BrowserTarget[] = [];
  private diagnostics: BrowserConnectionDiagnostics | null = null;
  private selectedTargetId: string | null = null;
  private selectedTarget: BrowserTarget | null = null;
  private lifecycleRevision = 0;
  private observedLifecycleRevision = 0;
  private targetClient = new CdpConnection();
  private lifecycleSubscription = this.targetClient.onEvent((event) => {
    if (isBrowserLifecycleEvent(event.method)) {
      this.lifecycleRevision += 1;
    }
  });

  async connect(rawEndpoint: string): Promise<BrowserConnectionInfo> {
    this.endpoint = normalizeDebugEndpoint(rawEndpoint);
    this.targets = await this.fetchTargets();
    this.selectedTargetId = getDefaultBrowserTargetId(this.targets);

    if (this.selectedTargetId) {
      await this.connectTarget(this.selectedTargetId);
    }

    return this.getConnectionInfo(this.selectedTargetId ? "connected" : "no-targets");
  }

  disconnect(): void {
    this.targetClient.disconnect();
    this.endpoint = null;
    this.targets = [];
    this.diagnostics = null;
    this.selectedTargetId = null;
    this.selectedTarget = null;
  }

  async listTargets(): Promise<BrowserTarget[]> {
    if (!this.endpoint) {
      return [];
    }

    this.targets = await this.fetchTargets();
    return this.targets;
  }

  async refreshConnection(): Promise<BrowserConnectionInfo> {
    if (!this.endpoint) {
      return this.getConnectionInfo("target-closed");
    }

    this.targets = await this.fetchTargets();
    if (!this.selectedTarget) {
      const targetId = getDefaultBrowserTargetId(this.targets);
      if (!targetId) {
        return this.getConnectionInfo("no-targets");
      }
      await this.connectTarget(targetId);
      return this.getConnectionInfo("reconnected");
    }

    const recovery = recoverBrowserTarget(this.selectedTarget, this.targets);
    if (!recovery.targetId) {
      this.targetClient.disconnect();
      this.selectedTargetId = null;
      return this.getConnectionInfo("target-closed");
    }

    const currentTarget = this.targets.find((target) => target.id === recovery.targetId);
    const targetNavigated = Boolean(currentTarget && currentTarget.url !== this.selectedTarget.url);
    const lifecycleChanged = this.lifecycleRevision !== this.observedLifecycleRevision;
    const needsReconnect = recovery.status === "recovered" || !this.targetClient.isConnected();
    if (needsReconnect) {
      await this.connectTarget(recovery.targetId);
      return this.getConnectionInfo("reconnected");
    }

    this.selectedTargetId = recovery.targetId;
    this.selectedTarget = currentTarget ?? this.selectedTarget;
    this.observedLifecycleRevision = this.lifecycleRevision;
    return this.getConnectionInfo(targetNavigated || lifecycleChanged ? "navigated" : "connected");
  }

  async selectTarget(targetId: string): Promise<DomSnapshotResult> {
    await this.connectTarget(targetId);
    return this.getDomSnapshot();
  }

  async getDomSnapshot(): Promise<DomSnapshotResult> {
    return this.evaluate<DomSnapshotResult>(SNAPSHOT_SCRIPT);
  }

  async highlightElement(request: HighlightElementRequest): Promise<HighlightResult> {
    return this.highlightElements({
      elementIds: [request.elementId],
      snapshotToken: request.snapshotToken
    });
  }

  async highlightElements(request: HighlightElementsRequest): Promise<HighlightResult> {
    const expression = HIGHLIGHT_SCRIPT
      .replace("__ELEMENT_IDS__", JSON.stringify(request.elementIds))
      .replace("__SNAPSHOT_TOKEN__", JSON.stringify(request.snapshotToken));
    return this.evaluate<HighlightResult>(expression);
  }

  async setElementPickerEnabled(enabled: boolean): Promise<void> {
    await this.evaluate(ELEMENT_PICKER_SCRIPT.replace("__ENABLED__", JSON.stringify(enabled)));
  }

  async getPickedElementId(): Promise<string | null> {
    return this.evaluate<string | null>(GET_PICKED_ELEMENT_SCRIPT);
  }

  private async fetchTargets(): Promise<BrowserTarget[]> {
    if (!this.endpoint) {
      return [];
    }

    const listUrl = `${this.endpoint}/json/list`;
    const response = await fetch(listUrl);
    if (!response.ok) {
      throw new Error(`Unable to read targets: HTTP ${response.status}`);
    }

    const rawTargets = await response.json();
    const targets = toBrowserTargets(rawTargets);
    this.diagnostics = {
      listUrl,
      rawTargetCount: countRawTargets(rawTargets),
      inspectableTargetCount: targets.length,
      rawTargetTypes: collectRawTargetTypes(rawTargets)
    };

    console.info("[ui-explorer] browser targets", this.diagnostics);
    return targets;
  }

  private async connectTarget(targetId: string): Promise<void> {
    const target = this.targets.find((item) => item.id === targetId);
    if (!target?.webSocketDebuggerUrl) {
      throw new Error("Selected target is not available.");
    }

    await this.targetClient.connect(target.webSocketDebuggerUrl);
    await this.targetClient.send("Runtime.enable");
    try {
      await this.targetClient.send("Page.enable");
    } catch {
      // Some inspectable subtargets do not expose the Page domain.
    }
    this.selectedTargetId = target.id;
    this.selectedTarget = target;
    this.observedLifecycleRevision = this.lifecycleRevision;
  }

  private async evaluate<T>(expression: string): Promise<T> {
    const response = await this.targetClient.send<RuntimeEvaluateResult<T>>("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true
    });

    if (response.exceptionDetails) {
      throw new Error(response.exceptionDetails.text ?? "Runtime evaluation failed.");
    }

    if (typeof response.result.value === "undefined") {
      throw new Error(response.result.description ?? "Runtime evaluation returned no value.");
    }

    return response.result.value;
  }

  private getConnectionInfo(status: BrowserConnectionInfo["status"]): BrowserConnectionInfo {
    return {
      endpoint: this.endpoint ?? "",
      connected: Boolean(this.endpoint && status !== "no-targets" && status !== "target-closed"),
      status,
      targetId: this.selectedTargetId,
      targets: this.targets,
      diagnostics: this.diagnostics ?? undefined
    };
  }
}

export function isBrowserLifecycleEvent(method: string): boolean {
  return (
    method === "Page.frameNavigated" ||
    method === "Runtime.executionContextsCleared" ||
    method === "Inspector.detached"
  );
}

function getRawTargetArray(rawTargets: unknown): unknown[] {
  if (Array.isArray(rawTargets)) {
    return rawTargets;
  }

  if (
    typeof rawTargets === "object" &&
    rawTargets !== null &&
    "value" in rawTargets &&
    Array.isArray((rawTargets as { value?: unknown }).value)
  ) {
    return (rawTargets as { value: unknown[] }).value;
  }

  return [];
}

function countRawTargets(rawTargets: unknown): number {
  return getRawTargetArray(rawTargets).length;
}

function collectRawTargetTypes(rawTargets: unknown): string[] {
  return Array.from(
    new Set(
      getRawTargetArray(rawTargets)
        .map((target) =>
          typeof target === "object" && target !== null && "type" in target ? (target as { type?: unknown }).type : undefined
        )
        .filter((type): type is string => typeof type === "string")
    )
  );
}
