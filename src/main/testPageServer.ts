import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse
} from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { TEST_PAGES } from "../shared/ipc.js";

type TestPageServerOptions = {
  devBaseUrl?: string;
  fixtureRoot: string;
};

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

export class TestPageServer {
  private servers: Server[] = [];
  private port: number | null = null;

  constructor(private readonly options: TestPageServerOptions) {}

  async resolve(id: string): Promise<string> {
    const page = TEST_PAGES.find((item) => item.id === id);
    if (!page) {
      throw new Error("Unknown test page.");
    }
    if (this.options.devBaseUrl) {
      return new URL(page.path, this.options.devBaseUrl).href;
    }
    const port = await this.ensureListening();
    return `http://127.0.0.1:${port}${page.path}`;
  }

  async close(): Promise<void> {
    const servers = this.servers;
    this.servers = [];
    this.port = null;
    await Promise.all(servers.map(closeServer));
  }

  private async ensureListening(): Promise<number> {
    if (this.port !== null) return this.port;
    const handler = async (
      request: IncomingMessage,
      response: ServerResponse
    ) => {
      await this.handleRequest(request.url ?? "/", response);
    };
    const ipv4 = createServer((request, response) => {
      void handler(request, response);
    });
    await listen(ipv4, 0, "127.0.0.1");
    const address = ipv4.address();
    if (!address || typeof address === "string") {
      await closeServer(ipv4);
      throw new Error("Unable to start test page server.");
    }
    const ipv6 = createServer((request, response) => {
      void handler(request, response);
    });
    try {
      await listen(ipv6, address.port, "::1", true);
    } catch {
      await closeServer(ipv4);
      throw new Error("Unable to bind IPv6 loopback test page server.");
    }
    this.servers = [ipv4, ipv6];
    this.port = address.port;
    return address.port;
  }

  private async handleRequest(
    requestUrl: string,
    response: ServerResponse
  ): Promise<void> {
    try {
      const pathname = decodeURIComponent(new URL(requestUrl, "http://localhost").pathname);
      if (!pathname.startsWith("/test-pages/")) {
        respondNotFound(response);
        return;
      }
      const relativePath = pathname.slice("/test-pages/".length);
      const root = resolve(this.options.fixtureRoot);
      const filePath = resolve(root, relativePath);
      if (!filePath.startsWith(`${root}${sep}`)) {
        respondNotFound(response);
        return;
      }
      const contentType = CONTENT_TYPES[extname(filePath).toLowerCase()];
      if (!contentType) {
        respondNotFound(response);
        return;
      }
      const content = await readFile(filePath);
      response.writeHead(200, {
        "Content-Type": contentType,
        "Cache-Control": "no-store"
      });
      response.end(content);
    } catch {
      respondNotFound(response);
    }
  }
}

function listen(
  server: Server,
  port: number,
  host: string,
  ipv6Only = false
): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen({ port, host, ipv6Only }, () => {
      server.off("error", reject);
      resolvePromise();
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolvePromise) => {
    if (!server.listening) {
      resolvePromise();
      return;
    }
    server.close(() => resolvePromise());
  });
}

function respondNotFound(response: ServerResponse): void {
  response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  response.end("Not found");
}
