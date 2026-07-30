import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import {
  normalizeDebugEndpoint
} from "../shared/domSnapshot.js";
import type {
  ChromeLaunchProgressStage
} from "../shared/chromeLaunch.js";
import {
  discoverBrowserEndpoints,
  getLocalDebugEndpointCandidates,
  readBrowserVersion
} from "./browserDiscovery.js";
import {
  ChromeExecutableError,
  type ChromeExecutableLocator,
  type ChromeLaunchSettingsStoreLike
} from "./chromeExecutable.js";
import { CdpConnection } from "./cdpConnection.js";

export type ChromeEndpointResolution =
  | {
      status: "ready";
      ownership: "managed" | "external";
      launched: boolean;
      endpoint: string;
    }
  | { status: "cancelled" };

type ChromeInstanceManagerOptions = {
  locator: ChromeExecutableLocator;
  settings: ChromeLaunchSettingsStoreLike;
  profilePath: string;
};

export class ChromeInstanceManager {
  private managed: { child: ChildProcess; endpoint: string } | null = null;

  constructor(private readonly options: ChromeInstanceManagerOptions) {}

  async resolveEndpoint(
    preferredEndpoint: string | undefined,
    onProgress: (stage: ChromeLaunchProgressStage, endpoint?: string) => void
  ): Promise<ChromeEndpointResolution> {
    onProgress("detecting");
    const settings = await this.options.settings.read();
    const candidates = [
      preferredEndpoint,
      settings.lastDebugEndpoint,
      ...getLocalDebugEndpointCandidates()
    ].filter((value): value is string => Boolean(value && isLoopbackEndpoint(value)));
    const existing = await discoverBrowserEndpoints([...new Set(candidates)]);
    if (existing[0]) {
      const ownership =
        this.managed &&
        isSameLoopbackEndpoint(this.managed.endpoint, existing[0].endpoint)
          ? "managed"
          : "external";
      return {
        status: "ready",
        ownership,
        launched: false,
        endpoint: existing[0].endpoint
      };
    }

    onProgress("selecting-executable");
    const executable = await this.options.locator.resolve();
    if (executable.status === "cancelled") {
      return executable;
    }

    const port = await this.findAvailablePort(preferredEndpoint);
    if (port === null) {
      throw new ChromeExecutableError("no-debug-port");
    }
    onProgress("launching");
    const child = spawn(
      executable.path,
      getChromeLaunchArgs(port, this.options.profilePath),
      { shell: false, windowsHide: false, stdio: "ignore" }
    );
    const endpoint = `http://127.0.0.1:${port}`;
    await waitForChromeEndpoint(child, endpoint);
    this.managed = { child, endpoint };
    await this.options.settings.update({ lastDebugEndpoint: endpoint });
    onProgress("connecting", endpoint);
    return {
      status: "ready",
      ownership: "managed",
      launched: true,
      endpoint
    };
  }

  async closeManaged(): Promise<void> {
    const managed = this.managed;
    this.managed = null;
    if (!managed) return;
    try {
      const version = await readBrowserVersion(managed.endpoint);
      if (version.webSocketDebuggerUrl) {
        const connection = new CdpConnection();
        await connection.connect(version.webSocketDebuggerUrl);
        await connection.send("Browser.close");
        connection.disconnect();
      }
    } catch {
      // The owned browser may already be closed.
    }
    const exited = await waitForExit(managed.child, 3_000);
    if (!exited && managed.child.exitCode === null) {
      managed.child.kill();
    }
  }

  private async findAvailablePort(
    preferredEndpoint?: string
  ): Promise<number | null> {
    for (const port of getChromeLaunchPorts(preferredEndpoint)) {
      if (await isPortAvailable(port)) return port;
    }
    return null;
  }
}

export function getChromeLaunchPorts(preferredEndpoint?: string): number[] {
  let preferred: number | null = null;
  if (preferredEndpoint && isLoopbackEndpoint(preferredEndpoint)) {
    try {
      preferred = Number(new URL(normalizeDebugEndpoint(preferredEndpoint)).port);
    } catch {
      preferred = null;
    }
  }
  const bounded = Array.from({ length: 11 }, (_, index) => 9222 + index);
  return [
    ...(preferred && preferred > 0 && preferred <= 65_535 ? [preferred] : []),
    ...bounded.filter((port) => port !== preferred)
  ];
}

export function getChromeLaunchArgs(
  port: number,
  profilePath: string
): string[] {
  return [
    "--remote-debugging-address=127.0.0.1",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profilePath}`,
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank"
  ];
}

export function isLoopbackEndpoint(endpoint: string): boolean {
  try {
    const hostname = new URL(normalizeDebugEndpoint(endpoint)).hostname;
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  } catch {
    return false;
  }
}

export function isSameLoopbackEndpoint(
  left: string,
  right: string
): boolean {
  if (!isLoopbackEndpoint(left) || !isLoopbackEndpoint(right)) {
    return false;
  }
  try {
    const leftUrl = new URL(normalizeDebugEndpoint(left));
    const rightUrl = new URL(normalizeDebugEndpoint(right));
    return (
      leftUrl.protocol === rightUrl.protocol &&
      readEffectivePort(leftUrl) === readEffectivePort(rightUrl)
    );
  } catch {
    return false;
  }
}

async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
  });
}

async function waitForChromeEndpoint(
  child: ChildProcess,
  endpoint: string
): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new ChromeExecutableError("launch-exited");
    }
    try {
      await readBrowserVersion(endpoint);
      return;
    } catch {
      await delay(150);
    }
  }
  throw new ChromeExecutableError("cdp-timeout");
}

async function waitForExit(
  child: ChildProcess,
  timeout: number
): Promise<boolean> {
  if (child.exitCode !== null) return true;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.off("exit", onExit);
      resolve(false);
    }, timeout);
    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };
    child.once("exit", onExit);
  });
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function readEffectivePort(url: URL): string {
  return url.port || (url.protocol === "https:" ? "443" : "80");
}
