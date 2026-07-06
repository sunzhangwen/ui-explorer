import type { BrowserTarget } from "./ipc.js";

type RawBrowserTarget = {
  id?: unknown;
  title?: unknown;
  url?: unknown;
  type?: unknown;
  webSocketDebuggerUrl?: unknown;
};

const INSPECTABLE_TARGET_TYPES = new Set(["page", "iframe"]);

export function toBrowserTargets(rawTargets: RawBrowserTarget[]): BrowserTarget[] {
  return rawTargets.flatMap((target) => {
    if (
      typeof target.id !== "string" ||
      typeof target.type !== "string" ||
      !INSPECTABLE_TARGET_TYPES.has(target.type) ||
      typeof target.webSocketDebuggerUrl !== "string"
    ) {
      return [];
    }

    return [
      {
        id: target.id,
        type: target.type,
        title: typeof target.title === "string" ? target.title : "",
        url: typeof target.url === "string" ? target.url : "",
        webSocketDebuggerUrl: target.webSocketDebuggerUrl
      }
    ];
  });
}

export function getDefaultBrowserTargetId(targets: BrowserTarget[]): string | null {
  return targets.find((target) => target.type === "page")?.id ?? targets[0]?.id ?? null;
}
