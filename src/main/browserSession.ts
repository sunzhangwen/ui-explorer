import { createHash, randomBytes } from "node:crypto";
import net from "node:net";
import tls from "node:tls";
import { getDefaultBrowserTargetId, toBrowserTargets } from "../shared/browserTargets.js";
import { normalizeDebugEndpoint } from "../shared/domSnapshot.js";
import type { BrowserConnectionDiagnostics, BrowserConnectionInfo, BrowserTarget, DomSnapshotResult } from "../shared/ipc.js";
import { encodeClientCloseFrame, encodeClientTextFrame, extractServerTextFrames } from "./webSocketFrames.js";

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
  private socket: net.Socket | tls.TLSSocket | null = null;
  private sequence = 0;
  private pending = new Map<number, PendingRequest>();
  private frameBuffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);

  async connect(webSocketDebuggerUrl: string): Promise<void> {
    this.disconnect();
    this.frameBuffer = Buffer.alloc(0);
    this.socket = await connectWebSocket(webSocketDebuggerUrl);
    this.socket.on("data", (chunk) => this.handleData(chunk));
    this.socket.on("error", (error) => this.rejectPending(error instanceof Error ? error : new Error(String(error))));
    this.socket.on("close", () => this.rejectPending(new Error("CDP websocket closed.")));
  }

  disconnect(): void {
    if (this.socket && !this.socket.destroyed) {
      this.socket.write(encodeClientCloseFrame());
      this.socket.destroy();
    }
    this.socket = null;
    this.rejectPending(new Error("CDP target disconnected."));
  }

  async send<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    if (!this.socket || this.socket.destroyed) {
      throw new Error("No CDP target is connected.");
    }

    const id = ++this.sequence;
    const payload = JSON.stringify({ id, method, params });

    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject
      });
      this.socket?.write(encodeClientTextFrame(payload));
    });
  }

  private handleData(chunk: Buffer<ArrayBufferLike>): void {
    this.frameBuffer = Buffer.concat([this.frameBuffer, chunk]);
    const extracted = extractServerTextFrames(this.frameBuffer);
    this.frameBuffer = extracted.remaining;

    for (const raw of extracted.messages) {
      const message = JSON.parse(raw) as Partial<CdpResponse<unknown>>;
      if (typeof message.id !== "number") {
        continue;
      }

      const pending = this.pending.get(message.id);
      if (!pending) {
        continue;
      }

      this.pending.delete(message.id);

      if (message.error) {
        pending.reject(new Error(message.error.message));
        continue;
      }

      pending.resolve(message.result);
    }

    if (extracted.closed) {
      this.rejectPending(new Error("CDP websocket closed."));
    }
  }

  private rejectPending(error: Error): void {
    for (const request of this.pending.values()) {
      request.reject(error);
    }
    this.pending.clear();
  }
}

async function connectWebSocket(webSocketDebuggerUrl: string): Promise<net.Socket | tls.TLSSocket> {
  const url = new URL(webSocketDebuggerUrl);
  const isSecure = url.protocol === "wss:";
  const port = Number(url.port || (isSecure ? 443 : 80));
  const key = randomBytes(16).toString("base64");
  const expectedAccept = createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");

  const socket = await new Promise<net.Socket | tls.TLSSocket>((resolve, reject) => {
    const client = isSecure ? tls.connect({ host: url.hostname, port }) : net.connect({ host: url.hostname, port });
    client.once("connect", () => resolve(client));
    client.once("error", reject);
  });

  const path = `${url.pathname}${url.search}`;
  const host = url.port ? `${url.hostname}:${url.port}` : url.hostname;
  socket.write(
    [
      `GET ${path} HTTP/1.1`,
      `Host: ${host}`,
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Key: ${key}`,
      "Sec-WebSocket-Version: 13",
      "",
      ""
    ].join("\r\n")
  );

  const response = await readHandshakeResponse(socket);
  if (!/^HTTP\/1\.1 101\b/.test(response) || !response.toLowerCase().includes(`sec-websocket-accept: ${expectedAccept.toLowerCase()}`)) {
    socket.destroy();
    throw new Error("CDP websocket handshake failed.");
  }

  return socket;
}

async function readHandshakeResponse(socket: net.Socket | tls.TLSSocket): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    const onData = (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) {
        return;
      }

      socket.off("data", onData);
      socket.off("error", onError);
      resolve(buffer.subarray(0, headerEnd).toString("utf8"));
    };
    const onError = (error: Error) => {
      socket.off("data", onData);
      reject(error);
    };

    socket.on("data", onData);
    socket.once("error", onError);
  });
}

export class BrowserSession {
  private endpoint: string | null = null;
  private targets: BrowserTarget[] = [];
  private diagnostics: BrowserConnectionDiagnostics | null = null;
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
    this.diagnostics = null;
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
      targets: this.targets,
      diagnostics: this.diagnostics ?? undefined
    };
  }
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

const SNAPSHOT_SCRIPT = `(() => {
  const registry = new Map();
  const elementIds = new WeakMap();
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
    elementIds.set(node, id);
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
  window.__uiExplorerElementIds = elementIds;
  window.__uiExplorerPickedElementId = null;
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

const ELEMENT_PICKER_SCRIPT = `(() => {
  const enabled = __ENABLED__;
  const state = window.__uiExplorerPicker || { listeners: [] };
  for (const entry of state.listeners || []) {
    entry.document.removeEventListener("click", entry.listener, true);
  }
  state.listeners = [];
  window.__uiExplorerPicker = state;

  if (!enabled) {
    return true;
  }

  const findElementId = (event) => {
    const ids = window.__uiExplorerElementIds;
    if (!ids) {
      return null;
    }
    const path = typeof event.composedPath === "function" ? event.composedPath() : [event.target];
    for (const node of path) {
      if (!(node instanceof Element)) {
        continue;
      }
      if (node.closest?.("[data-ui-explorer-highlight]")) {
        continue;
      }
      const id = ids.get(node);
      if (id) {
        return id;
      }
    }
    return null;
  };

  const install = (doc) => {
    const listener = (event) => {
      const id = findElementId(event);
      if (!id) {
        return;
      }
      window.__uiExplorerPickedElementId = id;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
    };
    doc.addEventListener("click", listener, true);
    state.listeners.push({ document: doc, listener });

    for (const frame of Array.from(doc.querySelectorAll("iframe"))) {
      try {
        if (frame.contentDocument) {
          install(frame.contentDocument);
        }
      } catch {
        // Cross-origin frames cannot be instrumented from the target page.
      }
    }
  };

  install(document);
  return true;
})()`;

const GET_PICKED_ELEMENT_SCRIPT = `(() => {
  const id = window.__uiExplorerPickedElementId || null;
  window.__uiExplorerPickedElementId = null;
  return id;
})()`;
