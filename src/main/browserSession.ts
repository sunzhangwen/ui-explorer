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
import { CdpConnection, type CdpEvent } from "./cdpConnection.js";
import { readBrowserVersion } from "./browserDiscovery.js";
import {
  appendUnavailableContextDiagnostics,
  stitchSessionSnapshots,
  type SessionSnapshot
} from "./multiSessionSnapshot.js";
import {
  WebContextRegistry,
  type ActiveWebContext
} from "./webContextRegistry.js";

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

export type BrowserSessionConnection = {
  connect: (webSocketDebuggerUrl: string) => Promise<void>;
  disconnect: () => void;
  isConnected: () => boolean;
  onEvent: (listener: (event: CdpEvent) => void) => () => void;
  send: <T>(
    method: string,
    params?: Record<string, unknown>,
    sessionId?: string
  ) => Promise<T>;
};

export type BrowserVersionReader = (
  endpoint: string
) => Promise<{ browser: string; webSocketDebuggerUrl?: string }>;

export type BrowserSessionOptions = {
  connection?: BrowserSessionConnection;
  readBrowserVersion?: BrowserVersionReader;
};

export class BrowserSession {
  private endpoint: string | null = null;
  private targets: BrowserTarget[] = [];
  private diagnostics: BrowserConnectionDiagnostics | null = null;
  private selectedTargetId: string | null = null;
  private selectedTarget: BrowserTarget | null = null;
  private lifecycleRevision = 0;
  private observedLifecycleRevision = 0;
  private rootSessionId: string | null = null;
  private targetClient: BrowserSessionConnection;
  private browserVersionReader: BrowserVersionReader;
  private contextRegistry = new WebContextRegistry();
  private eventQueue = Promise.resolve();
  private pickerEnabled = false;
  private lastSnapshotRouting: {
    snapshotToken: string | null;
    sessions: Map<string, { snapshotToken: string | null; revision: number }>;
  } | null = null;

  constructor(options: BrowserSessionOptions = {}) {
    this.targetClient = options.connection ?? new CdpConnection();
    this.browserVersionReader = options.readBrowserVersion ?? readBrowserVersion;
    this.targetClient.onEvent((event) => {
      if (isBrowserLifecycleEvent(event.method)) {
        this.lifecycleRevision += 1;
        this.lastSnapshotRouting = null;
      }
      this.contextRegistry.accept(event);
      this.eventQueue = this.eventQueue
        .then(() => this.handleCdpEvent(event))
        .catch((error) => {
          console.error("[ui-explorer] CDP event handling failed", error);
        });
    });
  }

  async connect(rawEndpoint: string): Promise<BrowserConnectionInfo> {
    this.endpoint = normalizeDebugEndpoint(rawEndpoint);
    await this.connectBrowserWebSocket();
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
    this.rootSessionId = null;
    this.contextRegistry.clear();
    this.pickerEnabled = false;
    this.lastSnapshotRouting = null;
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
      if (!this.targetClient.isConnected()) {
        await this.connectBrowserWebSocket();
      }
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

  async createAndSelectTarget(
    rawEndpoint: string,
    url: string
  ): Promise<{
    connection: BrowserConnectionInfo;
    snapshot: DomSnapshotResult;
    bootstrapTargetIds: string[];
  }> {
    const endpoint = normalizeDebugEndpoint(rawEndpoint);
    if (this.endpoint !== endpoint) {
      this.disconnect();
      this.endpoint = endpoint;
    }
    if (!this.targetClient.isConnected()) {
      await this.connectBrowserWebSocket();
    }
    const before = await this.fetchTargets();
    const bootstrapTargetIds = before
      .filter((target) => target.url === "about:blank")
      .map((target) => target.id);
    const created = await this.targetClient.send<{ targetId: string }>(
      "Target.createTarget",
      { url }
    );
    this.targets = await this.fetchTargetsUntilPresent(created.targetId);
    await this.connectTarget(created.targetId);
    const snapshot = await this.getDomSnapshot();
    return {
      connection: this.getConnectionInfo("connected"),
      snapshot,
      bootstrapTargetIds
    };
  }

  async closeTarget(targetId: string): Promise<void> {
    if (!this.targetClient.isConnected()) return;
    await this.targetClient.send("Target.closeTarget", { targetId });
  }

  async getDomSnapshot(): Promise<DomSnapshotResult> {
    if (!this.rootSessionId) {
      return this.evaluate<DomSnapshotResult>(SNAPSHOT_SCRIPT);
    }
    await this.eventQueue;
    const contexts = this.contextRegistry.getActiveContexts();
    const rootContext = contexts.find((context) =>
      context.sessionId === this.rootSessionId
    );
    if (!rootContext) {
      throw new Error("The root page execution context is not ready.");
    }

    await this.markFrameOwners(contexts);
    const captureContexts = contexts.filter((context) => {
      const current = this.contextRegistry.getBySessionId(context.sessionId);
      return current?.state === "active" && current.revision === context.revision;
    });
    const revisions = new Map(
      captureContexts.map((context) => [context.sessionId, context.revision])
    );
    const snapshots = await Promise.all(
      captureContexts.map(async (context): Promise<SessionSnapshot> => ({
        sessionId: context.sessionId,
        targetId: context.targetId,
        frameId: context.frameId,
        parentFrameId: context.parentFrameId,
        revision: context.revision,
        result: await this.evaluateInSession<DomSnapshotResult>(
          SNAPSHOT_SCRIPT,
          context.sessionId
        )
      }))
    );
    await this.eventQueue;
    for (const [sessionId, revision] of revisions) {
      const current = this.contextRegistry.getBySessionId(sessionId);
      if (!current || current.revision !== revision || current.state !== "active") {
        throw new Error(`Snapshot invalidated by navigation or detach: ${sessionId}`);
      }
    }
    const stitched = stitchSessionSnapshots(rootContext.sessionId, snapshots);
    appendUnavailableContextDiagnostics(
      stitched,
      this.contextRegistry.getUnavailableContexts().map((context) => ({
        sessionId: context.sessionId,
        frameId: context.frameId,
        diagnostic: context.diagnostic
      }))
    );
    this.lastSnapshotRouting = {
      snapshotToken: stitched.snapshotToken ?? null,
      sessions: new Map(
        snapshots.map((snapshot) => [
          snapshot.sessionId,
          {
            snapshotToken: snapshot.result.snapshotToken ?? null,
            revision: snapshot.revision
          }
        ])
      )
    };
    return stitched;
  }

  async highlightElement(request: HighlightElementRequest): Promise<HighlightResult> {
    return this.highlightElements({
      elementIds: [request.elementId],
      snapshotToken: request.snapshotToken
    });
  }

  async highlightElements(request: HighlightElementsRequest): Promise<HighlightResult> {
    if (this.lastSnapshotRouting) {
      return this.highlightNamespacedElements(request);
    }
    const expression = HIGHLIGHT_SCRIPT
      .replace("__ELEMENT_IDS__", JSON.stringify(request.elementIds))
      .replace("__SNAPSHOT_TOKEN__", JSON.stringify(request.snapshotToken));
    return this.evaluate<HighlightResult>(expression);
  }

  async setElementPickerEnabled(enabled: boolean): Promise<void> {
    this.pickerEnabled = enabled;
    if (!this.rootSessionId) {
      await this.evaluate(ELEMENT_PICKER_SCRIPT.replace("__ENABLED__", JSON.stringify(enabled)));
      return;
    }
    await this.eventQueue;
    const expression = ELEMENT_PICKER_SCRIPT.replace(
      "__ENABLED__",
      JSON.stringify(enabled)
    );
    await Promise.all(
      this.contextRegistry.getActiveContexts().map((context) =>
        this.evaluateInSession<void>(expression, context.sessionId)
      )
    );
  }

  async getPickedElementId(): Promise<string | null> {
    if (!this.rootSessionId) {
      return this.evaluate<string | null>(GET_PICKED_ELEMENT_SCRIPT);
    }
    await this.eventQueue;
    const contexts = this.contextRegistry.getActiveContexts();
    const picked = await Promise.all(
      contexts.map(async (context) => ({
        sessionId: context.sessionId,
        localId: await this.evaluateInSession<string | null>(
          GET_PICKED_ELEMENT_SCRIPT,
          context.sessionId
        )
      }))
    );
    const match = picked.find((item) => item.localId);
    return match?.localId
      ? `${match.sessionId}::${match.localId}`
      : null;
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

  private async fetchTargetsUntilPresent(
    targetId: string
  ): Promise<BrowserTarget[]> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const targets = await this.fetchTargets();
      if (targets.some((target) => target.id === targetId)) {
        return targets;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error("Created Chrome target is not available.");
  }

  private async connectTarget(targetId: string): Promise<void> {
    const target = this.targets.find((item) => item.id === targetId);
    if (!target) {
      throw new Error("Selected target is not available.");
    }

    if (!this.targetClient.isConnected()) {
      await this.connectBrowserWebSocket();
    }
    if (this.rootSessionId) {
      try {
        await this.targetClient.send("Target.detachFromTarget", {
          sessionId: this.rootSessionId
        });
      } catch {
        // The previous target may already be detached or closed.
      }
    }
    this.contextRegistry.clear();

    const attached = await this.targetClient.send<{ sessionId: string }>(
      "Target.attachToTarget",
      { targetId, flatten: true }
    );
    this.rootSessionId = attached.sessionId;
    this.contextRegistry.registerRoot({
      targetId: target.id,
      targetType: target.type,
      sessionId: attached.sessionId
    });
    await this.initializeSession(attached.sessionId);
    this.selectedTargetId = target.id;
    this.selectedTarget = target;
    this.observedLifecycleRevision = this.lifecycleRevision;
  }

  private async evaluate<T>(expression: string): Promise<T> {
    if (!this.rootSessionId) {
      throw new Error("No CDP page session is attached.");
    }
    return this.evaluateInSession<T>(expression, this.rootSessionId);
  }

  private async evaluateInSession<T>(
    expression: string,
    sessionId: string
  ): Promise<T> {
    const response = await this.targetClient.send<RuntimeEvaluateResult<T>>("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true
    }, sessionId);

    if (response.exceptionDetails) {
      throw new Error(response.exceptionDetails.text ?? "Runtime evaluation failed.");
    }

    if (typeof response.result.value === "undefined") {
      throw new Error(response.result.description ?? "Runtime evaluation returned no value.");
    }

    return response.result.value;
  }

  private async markFrameOwners(contexts: ActiveWebContext[]): Promise<void> {
    await Promise.all(
      contexts
        .filter((context) =>
          context.sessionId !== this.rootSessionId &&
          Boolean(context.frameId && context.parentFrameId)
        )
        .map(async (context) => {
          const parent = context.parentFrameId
            ? this.contextRegistry.getByFrameId(context.parentFrameId)
            : undefined;
          if (!parent || parent.state !== "active" || !context.frameId) {
            this.contextRegistry.invalidateSession(
              context.sessionId,
              "frame-owner-unresolved",
              `Unable to resolve parent session for frame ${context.frameId ?? context.sessionId}.`
            );
            return;
          }
          try {
            const owner = await this.targetClient.send<{
              backendNodeId?: number;
              nodeId?: number;
            }>(
              "DOM.getFrameOwner",
              {
                frameId: context.targetType === "iframe"
                  ? context.targetId
                  : context.frameId
              },
              parent.sessionId
            );
            const resolved = await this.targetClient.send<{
              object?: { objectId?: string };
            }>(
              "DOM.resolveNode",
              {
                ...(owner.backendNodeId !== undefined
                  ? { backendNodeId: owner.backendNodeId }
                  : { nodeId: owner.nodeId })
              },
              parent.sessionId
            );
            const objectId = resolved.object?.objectId;
            if (!objectId) {
              throw new Error("CDP did not return the frame owner object.");
            }
            await this.targetClient.send(
              "Runtime.callFunctionOn",
              {
                objectId,
                functionDeclaration: `function(frameId, targetId, sessionId) {
                  Object.defineProperty(this, "__uiExplorerFrameContext", {
                    configurable: true,
                    enumerable: false,
                    value: { frameId, targetId, sessionId }
                  });
                }`,
                arguments: [
                  { value: context.frameId },
                  { value: context.targetId },
                  { value: context.sessionId }
                ],
                returnByValue: true
              },
              parent.sessionId
            );
          } catch (error) {
            this.contextRegistry.invalidateSession(
              context.sessionId,
              "frame-owner-unresolved",
              error instanceof Error ? error.message : String(error)
            );
          }
        })
    );
  }

  private async connectBrowserWebSocket(): Promise<void> {
    if (!this.endpoint) {
      throw new Error("No browser debug endpoint is configured.");
    }
    const version = await this.browserVersionReader(this.endpoint);
    if (!version.webSocketDebuggerUrl) {
      throw new Error("Browser endpoint did not provide a browser WebSocket URL.");
    }
    await this.targetClient.connect(version.webSocketDebuggerUrl);
  }

  private async initializeSession(sessionId: string): Promise<void> {
    await this.targetClient.send("Runtime.enable", undefined, sessionId);
    try {
      await this.targetClient.send("Page.enable", undefined, sessionId);
    } catch {
      // Some related targets do not expose the Page domain.
    }
    try {
      await this.targetClient.send("DOM.enable", undefined, sessionId);
    } catch {
      // Some related targets do not expose the DOM domain.
    }
    await this.targetClient.send(
      "Target.setAutoAttach",
      {
        autoAttach: true,
        waitForDebuggerOnStart: false,
        flatten: true,
        filter: [
          { type: "iframe", exclude: false },
          { exclude: true }
        ]
      },
      sessionId
    );
  }

  private async handleCdpEvent(event: CdpEvent): Promise<void> {
    if (event.method !== "Target.attachedToTarget") {
      return;
    }
    const childSessionId = readString(event.params, "sessionId");
    const targetInfo = readRecord(event.params, "targetInfo");
    const targetType = targetInfo ? readString(targetInfo, "type") : undefined;
    if (!childSessionId || targetType !== "iframe") {
      return;
    }
    try {
      await this.initializeSession(childSessionId);
      if (this.pickerEnabled) {
        await this.evaluateInSession<void>(
          ELEMENT_PICKER_SCRIPT.replace("__ENABLED__", "true"),
          childSessionId
        );
      }
    } catch (error) {
      this.contextRegistry.invalidateSession(
        childSessionId,
        "frame-attach-failed",
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  private async highlightNamespacedElements(
    request: HighlightElementsRequest
  ): Promise<HighlightResult> {
    const routing = this.lastSnapshotRouting;
    if (!routing || routing.snapshotToken !== request.snapshotToken) {
      return { targets: [] };
    }

    const groups = new Map<
      string,
      Array<{ globalId: string; localId: string }>
    >();
    for (const globalId of request.elementIds) {
      const parsed = parseRuntimeElementId(globalId);
      if (!parsed || !routing.sessions.has(parsed.sessionId)) {
        continue;
      }
      const group = groups.get(parsed.sessionId) ?? [];
      group.push({ globalId, localId: parsed.localId });
      groups.set(parsed.sessionId, group);
    }

    const mappedTargets = new Map<string, HighlightResult["targets"][number]>();
    await Promise.all(
      Array.from(groups, async ([sessionId, elements]) => {
        const sessionRouting = routing.sessions.get(sessionId);
        const current = this.contextRegistry.getBySessionId(sessionId);
        if (
          !sessionRouting ||
          !current ||
          current.state !== "active" ||
          current.revision !== sessionRouting.revision
        ) {
          return;
        }
        const expression = HIGHLIGHT_SCRIPT
          .replace(
            "__ELEMENT_IDS__",
            JSON.stringify(elements.map((element) => element.localId))
          )
          .replace(
            "__SNAPSHOT_TOKEN__",
            JSON.stringify(sessionRouting.snapshotToken)
          );
        const result = await this.evaluateInSession<HighlightResult>(
          expression,
          sessionId
        );
        const globalByLocal = new Map(
          elements.map((element) => [element.localId, element.globalId])
        );
        for (const target of result.targets) {
          const globalId = globalByLocal.get(target.elementId);
          if (!globalId) {
            continue;
          }
          mappedTargets.set(globalId, { ...target, elementId: globalId });
        }
      })
    );

    return {
      targets: request.elementIds.flatMap((elementId) => {
        const target = mappedTargets.get(elementId);
        return target ? [target] : [];
      })
    };
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

export function parseRuntimeElementId(
  id: string
): { sessionId: string; localId: string } | null {
  const boundary = id.indexOf("::");
  if (boundary <= 0 || boundary === id.length - 2) {
    return null;
  }
  return {
    sessionId: id.slice(0, boundary),
    localId: id.slice(boundary + 2)
  };
}

function readRecord(
  value: Record<string, unknown>,
  key: string
): Record<string, unknown> | undefined {
  const candidate = value[key];
  return typeof candidate === "object" && candidate !== null && !Array.isArray(candidate)
    ? candidate as Record<string, unknown>
    : undefined;
}

function readString(value: Record<string, unknown>, key: string): string | undefined {
  return typeof value[key] === "string" ? value[key] : undefined;
}

export function isBrowserLifecycleEvent(method: string): boolean {
  return (
    method === "Page.frameNavigated" ||
    method === "Page.frameDetached" ||
    method === "Runtime.executionContextsCleared" ||
    method === "Target.detachedFromTarget" ||
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
