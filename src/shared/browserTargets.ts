import type { BrowserTarget } from "./ipc.js";

type RawBrowserTarget = {
  id?: unknown;
  title?: unknown;
  url?: unknown;
  type?: unknown;
  webSocketDebuggerUrl?: unknown;
};

const INSPECTABLE_TARGET_TYPES = new Set(["page", "iframe"]);

export function toBrowserTargets(rawTargets: unknown): BrowserTarget[] {
  return normalizeRawTargets(rawTargets).flatMap((target) => {
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

function normalizeRawTargets(rawTargets: unknown): RawBrowserTarget[] {
  if (Array.isArray(rawTargets)) {
    return rawTargets.filter((target): target is RawBrowserTarget => typeof target === "object" && target !== null);
  }

  if (
    typeof rawTargets === "object" &&
    rawTargets !== null &&
    "value" in rawTargets &&
    Array.isArray((rawTargets as { value?: unknown }).value)
  ) {
    return (rawTargets as { value: unknown[] }).value.filter(
      (target): target is RawBrowserTarget => typeof target === "object" && target !== null
    );
  }

  return [];
}

export function getDefaultBrowserTargetId(targets: BrowserTarget[]): string | null {
  return targets.find((target) => target.type === "page")?.id ?? targets[0]?.id ?? null;
}
