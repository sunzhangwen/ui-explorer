import type { CdpEvent } from "./cdpConnection.js";

export type WebContextDiagnosticCode =
  | "frame-attach-failed"
  | "frame-owner-unresolved"
  | "navigation-invalidated"
  | "session-detached";

export type WebContextDiagnostic = {
  code: WebContextDiagnosticCode;
  detail: string;
};

type WebContextIdentity = {
  targetId: string;
  targetType: string;
  sessionId: string;
  frameId?: string;
  parentFrameId?: string;
  revision: number;
};

export type ActiveWebContext = WebContextIdentity & {
  state: "active" | "navigating";
  loaderId?: string;
  executionContextId?: number;
  executionContextUniqueId?: string;
};

export type WebContextRecord =
  | (WebContextIdentity & {
      state: "attaching";
    })
  | ActiveWebContext
  | (WebContextIdentity & {
      state: "detached" | "unavailable";
      diagnostic: WebContextDiagnostic;
    });

export type RegisterRootInput = {
  targetId: string;
  sessionId: string;
  targetType?: string;
};

export class WebContextRegistry {
  private contextsBySession = new Map<string, WebContextRecord>();
  private sessionByFrame = new Map<string, string>();

  registerRoot(input: RegisterRootInput): WebContextRecord {
    const record: WebContextRecord = {
      state: "attaching",
      targetId: input.targetId,
      targetType: input.targetType ?? "page",
      sessionId: input.sessionId,
      revision: 0
    };
    this.contextsBySession.set(input.sessionId, record);
    return record;
  }

  accept(event: CdpEvent): void {
    switch (event.method) {
      case "Target.attachedToTarget":
        this.acceptAttachedTarget(event.params);
        return;
      case "Target.detachedFromTarget":
        this.acceptDetachedTarget(event.params);
        return;
      case "Page.frameNavigated":
        this.acceptFrameNavigated(event.sessionId, event.params);
        return;
      case "Page.frameDetached":
        this.acceptFrameDetached(event.params);
        return;
      case "Runtime.executionContextCreated":
        this.acceptExecutionContextCreated(event.sessionId, event.params);
        return;
      case "Runtime.executionContextDestroyed":
        this.acceptExecutionContextDestroyed(event.sessionId, event.params);
        return;
      case "Runtime.executionContextsCleared":
        this.clearExecutionContext(event.sessionId);
        return;
      default:
        return;
    }
  }

  getBySessionId(sessionId: string): WebContextRecord | undefined {
    return this.contextsBySession.get(sessionId);
  }

  getByFrameId(frameId: string): WebContextRecord | undefined {
    const sessionId = this.sessionByFrame.get(frameId);
    return sessionId ? this.contextsBySession.get(sessionId) : undefined;
  }

  getActiveContexts(): ActiveWebContext[] {
    return Array.from(this.contextsBySession.values()).filter(
      (context): context is ActiveWebContext => context.state === "active"
    );
  }

  invalidateSession(
    sessionId: string,
    code: WebContextDiagnosticCode,
    detail: string
  ): void {
    const context = this.contextsBySession.get(sessionId);
    if (!context) {
      return;
    }
    this.contextsBySession.set(sessionId, {
      ...identityOf(context),
      state: "unavailable",
      revision: context.revision + 1,
      diagnostic: { code, detail }
    });
  }

  clear(): void {
    this.contextsBySession.clear();
    this.sessionByFrame.clear();
  }

  private acceptAttachedTarget(params: Record<string, unknown>): void {
    const sessionId = readString(params, "sessionId");
    const targetInfo = readRecord(params, "targetInfo");
    const targetId = targetInfo ? readString(targetInfo, "targetId") : undefined;
    if (!sessionId || !targetInfo || !targetId) {
      return;
    }

    this.contextsBySession.set(sessionId, {
      state: "attaching",
      targetId,
      targetType: readString(targetInfo, "type") ?? "other",
      sessionId,
      revision: 0
    });
  }

  private acceptDetachedTarget(params: Record<string, unknown>): void {
    const sessionId = readString(params, "sessionId");
    if (!sessionId) {
      return;
    }
    const context = this.contextsBySession.get(sessionId);
    if (!context) {
      return;
    }
    this.contextsBySession.set(sessionId, {
      ...identityOf(context),
      state: "detached",
      revision: context.revision + 1,
      diagnostic: {
        code: "session-detached",
        detail: "CDP session detached."
      }
    });
  }

  private acceptFrameNavigated(
    sessionId: string | undefined,
    params: Record<string, unknown>
  ): void {
    if (!sessionId) {
      return;
    }
    const context = this.contextsBySession.get(sessionId);
    const frame = readRecord(params, "frame");
    const frameId = frame ? readString(frame, "id") : undefined;
    if (!context || !frame || !frameId) {
      return;
    }

    if (context.frameId && context.frameId !== frameId) {
      this.sessionByFrame.delete(context.frameId);
    }
    this.sessionByFrame.set(frameId, sessionId);
    this.contextsBySession.set(sessionId, compactActiveContext({
      ...identityOf(context),
      state: "navigating",
      frameId,
      parentFrameId: readString(frame, "parentId"),
      loaderId: readString(frame, "loaderId"),
      revision: context.revision + 1
    }));
  }

  private acceptFrameDetached(params: Record<string, unknown>): void {
    const frameId = readString(params, "frameId");
    if (!frameId) {
      return;
    }
    const sessionId = this.sessionByFrame.get(frameId);
    const context = sessionId ? this.contextsBySession.get(sessionId) : undefined;
    if (!sessionId || !context) {
      return;
    }

    this.contextsBySession.set(sessionId, {
      ...identityOf(context),
      state: "detached",
      revision: context.revision + 1,
      diagnostic: {
        code: "session-detached",
        detail: "Frame detached from its parent."
      }
    });
  }

  private acceptExecutionContextCreated(
    sessionId: string | undefined,
    params: Record<string, unknown>
  ): void {
    if (!sessionId) {
      return;
    }
    const current = this.contextsBySession.get(sessionId);
    const executionContext = readRecord(params, "context");
    const auxData = executionContext ? readRecord(executionContext, "auxData") : undefined;
    if (
      !current ||
      !executionContext ||
      !auxData ||
      readBoolean(auxData, "isDefault") !== true
    ) {
      return;
    }

    const frameId = readString(auxData, "frameId") ?? current.frameId;
    if (current.frameId && frameId !== current.frameId) {
      return;
    }
    const executionContextId = readNumber(executionContext, "id");
    if (executionContextId === undefined) {
      return;
    }

    if (frameId) {
      this.sessionByFrame.set(frameId, sessionId);
    }
    this.contextsBySession.set(sessionId, compactActiveContext({
      ...identityOf(current),
      state: "active",
      frameId,
      loaderId: current.state === "active" || current.state === "navigating"
        ? current.loaderId
        : undefined,
      executionContextId,
      executionContextUniqueId: readString(executionContext, "uniqueId"),
      revision: current.revision
    }));
  }

  private acceptExecutionContextDestroyed(
    sessionId: string | undefined,
    params: Record<string, unknown>
  ): void {
    if (!sessionId) {
      return;
    }
    const current = this.contextsBySession.get(sessionId);
    const destroyedId = readNumber(params, "executionContextId");
    if (
      !current ||
      current.state !== "active" ||
      destroyedId === undefined ||
      current.executionContextId !== destroyedId
    ) {
      return;
    }
    this.setNavigating(current);
  }

  private clearExecutionContext(sessionId: string | undefined): void {
    if (!sessionId) {
      return;
    }
    const current = this.contextsBySession.get(sessionId);
    if (!current || (current.state !== "active" && current.state !== "navigating")) {
      return;
    }
    this.setNavigating(current);
  }

  private setNavigating(current: ActiveWebContext): void {
    this.contextsBySession.set(current.sessionId, compactActiveContext({
      ...identityOf(current),
      state: "navigating",
      loaderId: current.loaderId,
      revision: current.revision + 1
    }));
  }
}

function identityOf(context: WebContextRecord): WebContextIdentity {
  return compactIdentity({
    targetId: context.targetId,
    targetType: context.targetType,
    sessionId: context.sessionId,
    frameId: context.frameId,
    parentFrameId: context.parentFrameId,
    revision: context.revision
  });
}

function compactIdentity(identity: WebContextIdentity): WebContextIdentity {
  return Object.fromEntries(
    Object.entries(identity).filter(([, value]) => value !== undefined)
  ) as WebContextIdentity;
}

function compactActiveContext(context: ActiveWebContext): ActiveWebContext {
  return Object.fromEntries(
    Object.entries(context).filter(([, value]) => value !== undefined)
  ) as ActiveWebContext;
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

function readNumber(value: Record<string, unknown>, key: string): number | undefined {
  return typeof value[key] === "number" ? value[key] : undefined;
}

function readBoolean(value: Record<string, unknown>, key: string): boolean | undefined {
  return typeof value[key] === "boolean" ? value[key] : undefined;
}
