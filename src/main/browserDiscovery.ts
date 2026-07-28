import { normalizeDebugEndpoint } from "../shared/domSnapshot.js";
import type { BrowserDebugEndpoint } from "../shared/ipc.js";

export type DebugEndpointProbe = (
  endpoint: string
) => Promise<{ browser: string; webSocketDebuggerUrl?: string }>;

const DEFAULT_DEBUG_PORTS = [9222, 9223, 9229];

export function getLocalDebugEndpointCandidates(): string[] {
  return DEFAULT_DEBUG_PORTS.flatMap((port) => [
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`
  ]);
}

export async function discoverBrowserEndpoints(
  candidates = getLocalDebugEndpointCandidates(),
  probe: DebugEndpointProbe = readBrowserVersion
): Promise<BrowserDebugEndpoint[]> {
  const results = await Promise.all(
    candidates.map(async (candidate) => {
      const endpoint = normalizeDebugEndpoint(candidate);
      try {
        return { endpoint, ...(await probe(endpoint)) };
      } catch {
        return null;
      }
    })
  );
  const seen = new Set<string>();
  return results.filter((result): result is BrowserDebugEndpoint => {
    if (!result) {
      return false;
    }
    const identity = result.webSocketDebuggerUrl || result.endpoint;
    if (seen.has(identity)) {
      return false;
    }
    seen.add(identity);
    return true;
  });
}

export async function readBrowserVersion(
  endpoint: string
): Promise<{ browser: string; webSocketDebuggerUrl?: string }> {
  const response = await fetch(`${endpoint}/json/version`, {
    signal: AbortSignal.timeout(700)
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const value = (await response.json()) as {
    Browser?: unknown;
    webSocketDebuggerUrl?: unknown;
  };
  if (typeof value.Browser !== "string") {
    throw new Error("Endpoint did not return CDP version metadata.");
  }
  return {
    browser: value.Browser,
    webSocketDebuggerUrl:
      typeof value.webSocketDebuggerUrl === "string" ? value.webSocketDebuggerUrl : undefined
  };
}
