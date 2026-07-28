import { createHash, randomBytes } from "node:crypto";
import net from "node:net";
import tls from "node:tls";
import {
  encodeClientCloseFrame,
  encodeClientTextFrame,
  extractServerTextFrames
} from "./webSocketFrames.js";

type CdpResponse<T> = {
  id: number;
  result?: T;
  error?: {
    code: number;
    message: string;
  };
  sessionId?: string;
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

export type CdpEvent = {
  method: string;
  params: Record<string, unknown>;
  sessionId?: string;
};

export type CdpEventListener = (event: CdpEvent) => void;

export class CdpMessageRouter {
  private pending = new Map<number, PendingRequest>();
  private listeners = new Set<CdpEventListener>();

  createPending<T>(id: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject
      });
    });
  }

  onEvent(listener: CdpEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  accept(raw: string): void {
    const message = JSON.parse(raw) as Partial<CdpResponse<unknown>> & {
      method?: unknown;
      params?: unknown;
    };

    if (typeof message.method === "string") {
      const event: CdpEvent = {
        method: message.method,
        params: isRecord(message.params) ? message.params : {}
      };
      if (typeof message.sessionId === "string") {
        event.sessionId = message.sessionId;
      }
      for (const listener of this.listeners) {
        listener(event);
      }
    }

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

  rejectPending(error: Error): void {
    for (const request of this.pending.values()) {
      request.reject(error);
    }
    this.pending.clear();
  }
}

export class CdpConnection {
  private socket: net.Socket | tls.TLSSocket | null = null;
  private sequence = 0;
  private frameBuffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  private router = new CdpMessageRouter();

  async connect(webSocketDebuggerUrl: string): Promise<void> {
    this.disconnect();
    this.frameBuffer = Buffer.alloc(0);
    const socket = await connectWebSocket(webSocketDebuggerUrl);
    this.socket = socket;
    socket.on("data", (chunk) => this.handleData(chunk));
    socket.on("error", (error) => {
      if (this.socket === socket) {
        this.router.rejectPending(error instanceof Error ? error : new Error(String(error)));
      }
    });
    socket.on("close", () => {
      if (this.socket === socket) {
        this.socket = null;
        this.router.rejectPending(new Error("CDP websocket closed."));
      }
    });
  }

  disconnect(): void {
    const socket = this.socket;
    this.socket = null;
    if (socket && !socket.destroyed) {
      socket.write(encodeClientCloseFrame());
      socket.destroy();
    }
    this.router.rejectPending(new Error("CDP target disconnected."));
  }

  isConnected(): boolean {
    return Boolean(this.socket && !this.socket.destroyed);
  }

  onEvent(listener: CdpEventListener): () => void {
    return this.router.onEvent(listener);
  }

  async send<T>(
    method: string,
    params?: Record<string, unknown>,
    sessionId?: string
  ): Promise<T> {
    if (!this.socket || this.socket.destroyed) {
      throw new Error("No CDP target is connected.");
    }

    const id = ++this.sequence;
    const pending = this.router.createPending<T>(id);
    const payload: {
      id: number;
      method: string;
      params?: Record<string, unknown>;
      sessionId?: string;
    } = { id, method };
    if (params) {
      payload.params = params;
    }
    if (sessionId) {
      payload.sessionId = sessionId;
    }
    this.socket.write(encodeClientTextFrame(JSON.stringify(payload)));
    return pending;
  }

  private handleData(chunk: Buffer<ArrayBufferLike>): void {
    this.frameBuffer = Buffer.concat([this.frameBuffer, chunk]);
    const extracted = extractServerTextFrames(this.frameBuffer);
    this.frameBuffer = extracted.remaining;

    for (const raw of extracted.messages) {
      this.router.accept(raw);
    }

    if (extracted.closed) {
      this.router.rejectPending(new Error("CDP websocket closed."));
    }
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
    const client = isSecure
      ? tls.connect({ host: url.hostname, port })
      : net.connect({ host: url.hostname, port });
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
  if (
    !/^HTTP\/1\.1 101\b/.test(response) ||
    !response.toLowerCase().includes(`sec-websocket-accept: ${expectedAccept.toLowerCase()}`)
  ) {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
