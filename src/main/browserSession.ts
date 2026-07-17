import { createHash, randomBytes } from "node:crypto";
import net from "node:net";
import tls from "node:tls";
import { getDefaultBrowserTargetId, toBrowserTargets } from "../shared/browserTargets.js";
import { normalizeDebugEndpoint } from "../shared/domSnapshot.js";
import type { BrowserConnectionDiagnostics, BrowserConnectionInfo, BrowserTarget, DomSnapshotResult } from "../shared/ipc.js";
import { ELEMENT_PICKER_SCRIPT, GET_PICKED_ELEMENT_SCRIPT, HIGHLIGHT_SCRIPT, SNAPSHOT_SCRIPT } from "./browserScripts.js";
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
