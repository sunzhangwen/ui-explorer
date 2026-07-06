import { getDefaultBrowserTargetId, toBrowserTargets } from "../shared/browserTargets.js";
import { normalizeDebugEndpoint } from "../shared/domSnapshot.js";
import type { BrowserConnectionInfo, BrowserTarget, DomSnapshotResult } from "../shared/ipc.js";

type CdpResponse<T> = {
  id: number;
  result?: T;
  error?: {
    code: number;
    message: string;
  };
};

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

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

class CdpTargetClient {
  private socket: WebSocket | null = null;
  private sequence = 0;
  private pending = new Map<number, PendingRequest>();

  async connect(webSocketDebuggerUrl: string): Promise<void> {
    this.disconnect();

    if (typeof WebSocket === "undefined") {
      throw new Error("WebSocket is not available in this runtime.");
    }

    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(webSocketDebuggerUrl);
      this.socket = socket;

      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener("error", () => reject(new Error("Unable to open CDP websocket.")), { once: true });
      socket.addEventListener("message", (event) => this.handleMessage(event));
      socket.addEventListener("close", () => this.rejectPending(new Error("CDP websocket closed.")));
    });
  }

  disconnect(): void {
    if (this.socket && this.socket.readyState <= WebSocket.OPEN) {
      this.socket.close();
    }
    this.socket = null;
    this.rejectPending(new Error("CDP target disconnected."));
  }

  async send<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("No CDP target is connected.");
    }

    const id = ++this.sequence;
    const payload = JSON.stringify({ id, method, params });

    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject
      });
      this.socket?.send(payload);
    });
  }

  private handleMessage(event: MessageEvent): void {
    const raw = typeof event.data === "string" ? event.data : "";
    if (!raw) {
      return;
    }

    const message = JSON.parse(raw) as Partial<CdpResponse<unknown>>;
    if (typeof message.id !== "number") {
      return;
    }

    const pending = this.pending.get(message.id);
    if (!pending) {
      return;
    }

    this.pending.delete(message.id);

    if (message.error) {
      pending.reject(new Error(message.error.message));
      return;
    }

    pending.resolve(message.result);
  }

  private rejectPending(error: Error): void {
    for (const request of this.pending.values()) {
      request.reject(error);
    }
    this.pending.clear();
  }
}

export class BrowserSession {
  private endpoint: string | null = null;
  private targets: BrowserTarget[] = [];
  private selectedTargetId: string | null = null;
  private targetClient = new CdpTargetClient();

  async connect(rawEndpoint: string): Promise<BrowserConnectionInfo> {
    this.endpoint = normalizeDebugEndpoint(rawEndpoint);
    this.targets = await this.fetchTargets();
    this.selectedTargetId = getDefaultBrowserTargetId(this.targets);

    if (this.selectedTargetId) {
      await this.connectTarget(this.selectedTargetId);
    }

    return this.getConnectionInfo();
  }

  disconnect(): void {
    this.targetClient.disconnect();
    this.endpoint = null;
    this.targets = [];
    this.selectedTargetId = null;
  }

  async listTargets(): Promise<BrowserTarget[]> {
    if (!this.endpoint) {
      return [];
    }

    this.targets = await this.fetchTargets();
    return this.targets;
  }

  async selectTarget(targetId: string): Promise<DomSnapshotResult> {
    await this.connectTarget(targetId);
    return this.getDomSnapshot();
  }

  async getDomSnapshot(): Promise<DomSnapshotResult> {
    const result = await this.evaluate<DomSnapshotResult>(SNAPSHOT_SCRIPT);
    return result;
  }

  async highlightElement(elementId: string): Promise<void> {
    await this.highlightElements([elementId]);
  }

  async highlightElements(elementIds: string[]): Promise<void> {
    await this.evaluate(HIGHLIGHT_SCRIPT.replace("__ELEMENT_IDS__", JSON.stringify(elementIds)));
  }

  private async fetchTargets(): Promise<BrowserTarget[]> {
    if (!this.endpoint) {
      return [];
    }

    const response = await fetch(`${this.endpoint}/json/list`);
    if (!response.ok) {
      throw new Error(`Unable to read targets: HTTP ${response.status}`);
    }

    const rawTargets = (await response.json()) as Parameters<typeof toBrowserTargets>[0];
    return toBrowserTargets(rawTargets);
  }

  private async connectTarget(targetId: string): Promise<void> {
    const target = this.targets.find((item) => item.id === targetId);
    if (!target?.webSocketDebuggerUrl) {
      throw new Error("Selected target is not available.");
    }

    await this.targetClient.connect(target.webSocketDebuggerUrl);
    await this.targetClient.send("Runtime.enable");
    this.selectedTargetId = target.id;
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

  private getConnectionInfo(): BrowserConnectionInfo {
    return {
      endpoint: this.endpoint ?? "",
      connected: Boolean(this.endpoint),
      targetId: this.selectedTargetId,
      targets: this.targets
    };
  }
}

const SNAPSHOT_SCRIPT = `(() => {
  const registry = new Map();
  let sequence = 0;
  const readAttributes = (element) => {
    const attributes = {};
    for (const attribute of Array.from(element.attributes || [])) {
      attributes[attribute.name] = attribute.value;
    }
    return attributes;
  };
  const roleFor = (element) => element.getAttribute?.("role") || element.getAttribute?.("aria-role") || "";
  const visibleFor = (element) => {
    if (!(element instanceof Element)) {
      return undefined;
    }
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  };
  const boxFor = (element) => {
    if (!(element instanceof Element)) {
      return undefined;
    }
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  };
  const textFor = (node) => {
    if (!(node instanceof Element)) {
      return node.nodeValue?.trim().slice(0, 160) || "";
    }
    return Array.from(node.childNodes)
      .filter((child) => child.nodeType === Node.TEXT_NODE)
      .map((child) => child.nodeValue?.trim() || "")
      .filter(Boolean)
      .join(" ")
      .slice(0, 160);
  };
  const walk = (node, depth, parentId) => {
    const id = "n-" + (++sequence);
    registry.set(id, node);
    const children = [];
    const base = {
      id,
      parentId,
      depth,
      nodeType: node.nodeType,
      nodeName: node instanceof ShadowRoot ? "#shadow-root" : node.nodeName,
      tagName: node instanceof Element ? node.tagName.toLowerCase() : undefined,
      nodeValue: node.nodeType === Node.TEXT_NODE ? node.nodeValue || "" : undefined,
      text: textFor(node),
      role: node instanceof Element ? roleFor(node) : undefined,
      visible: node instanceof Element ? visibleFor(node) : undefined,
      boundingBox: node instanceof Element ? boxFor(node) : undefined,
      attributes: node instanceof Element ? readAttributes(node) : {},
      childIds: [],
      children
    };
    const sourceChildren = node instanceof HTMLIFrameElement && node.contentDocument
      ? [node.contentDocument.documentElement]
      : Array.from(node.childNodes).filter((child) => child.nodeType === Node.ELEMENT_NODE);
    for (const child of sourceChildren) {
      children.push(walk(child, depth + 1, id));
    }
    if (node instanceof Element && node.shadowRoot) {
      children.push(walk(node.shadowRoot, depth + 1, id));
    }
    base.childIds = children.map((child) => child.id);
    return base;
  };
  const root = document.documentElement ? walk(document.documentElement, 0, undefined) : null;
  window.__uiExplorerElements = registry;
  return { root, capturedAt: new Date().toISOString(), nodeCount: sequence };
})()`;

const HIGHLIGHT_SCRIPT = `(() => {
  const elementIds = __ELEMENT_IDS__;
  const registry = window.__uiExplorerElements;
  document.querySelectorAll("[data-ui-explorer-highlight]").forEach((node) => node.remove());
  elementIds.forEach((elementId, index) => {
    const target = registry?.get(elementId);
    if (!(target instanceof Element)) {
      return;
    }
    const doc = target.ownerDocument;
    const rect = target.getBoundingClientRect();
    const overlay = doc.createElement("div");
    overlay.setAttribute("data-ui-explorer-highlight", "true");
    overlay.style.cssText = [
      "position:fixed",
      "left:" + rect.left + "px",
      "top:" + rect.top + "px",
      "width:" + rect.width + "px",
      "height:" + rect.height + "px",
      "pointer-events:none",
      "z-index:2147483647",
      "border:2px solid #5ec7b8",
      "box-shadow:0 0 0 3px rgba(94,199,184,.28)",
      "background:rgba(94,199,184,.08)"
    ].join(";");
    const badge = doc.createElement("span");
    badge.textContent = String(index + 1);
    badge.style.cssText = [
      "position:absolute",
      "left:-2px",
      "top:-22px",
      "min-width:20px",
      "height:20px",
      "padding:0 6px",
      "display:grid",
      "place-items:center",
      "border-radius:4px",
      "background:#5ec7b8",
      "color:#101413",
      "font:700 12px/1 system-ui,sans-serif"
    ].join(";");
    overlay.appendChild(badge);
    doc.documentElement.appendChild(overlay);
  });
  return true;
})()`;
