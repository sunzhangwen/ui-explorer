import type {
  BrowserConnectionInfo,
  DomSnapshotResult
} from "./ipc.js";

export const CHROME_LAUNCH_ERROR_CODES = [
  "chrome-not-found",
  "invalid-chrome-path",
  "invalid-url",
  "no-debug-port",
  "profile-in-use",
  "launch-failed",
  "launch-exited",
  "cdp-timeout",
  "target-create-failed",
  "target-attach-failed",
  "test-server-failed"
] as const;

export type ChromeLaunchErrorCode =
  (typeof CHROME_LAUNCH_ERROR_CODES)[number];

export type ChromeLaunchProgressStage =
  | "detecting"
  | "selecting-executable"
  | "launching"
  | "connecting"
  | "opening";

export type ChromePageSource =
  | { kind: "custom"; value: string }
  | { kind: "test-page"; id: string };

export type OpenChromePageRequest = {
  requestId: string;
  preferredEndpoint?: string;
  source: ChromePageSource;
};

export type OpenChromePageProgress = {
  requestId: string;
  stage: ChromeLaunchProgressStage;
  endpoint?: string;
};

export type OpenChromePageResult =
  | {
      status: "opened";
      ownership: "managed" | "external";
      endpoint: string;
      targetId: string;
      connection: BrowserConnectionInfo;
      snapshot: DomSnapshotResult;
    }
  | { status: "cancelled" }
  | {
      status: "error";
      code: ChromeLaunchErrorCode;
      message: string;
      endpoint?: string;
      targetId?: string;
    };

export type ChromeOpenState =
  | { status: "idle" }
  | {
      status: ChromeLaunchProgressStage;
      requestId: string;
      endpoint?: string;
    }
  | {
      status: "success";
      requestId: string;
      endpoint: string;
      targetId: string;
      ownership: "managed" | "external";
    }
  | {
      status: "error";
      requestId: string;
      code: ChromeLaunchErrorCode;
      message: string;
    };

export type ChromePageUrlResult =
  | { ok: true; url: string }
  | { ok: false; code: "invalid-url" };

const ALLOWED_PROTOCOLS = new Set(["http:", "https:", "file:"]);
const EXPLICIT_SCHEME_PATTERN = /^[a-z][a-z\d+.-]*:/i;

export function normalizeChromePageUrl(
  input: string
): ChromePageUrlResult {
  const value = input.trim();
  if (!value) {
    return { ok: true, url: "about:blank" };
  }

  const localWithoutProtocol = isLocalAddressWithoutProtocol(value);
  if (!localWithoutProtocol && EXPLICIT_SCHEME_PATTERN.test(value)) {
    try {
      const parsed = new URL(value);
      return ALLOWED_PROTOCOLS.has(parsed.protocol)
        ? { ok: true, url: parsed.href }
        : { ok: false, code: "invalid-url" };
    } catch {
      return { ok: false, code: "invalid-url" };
    }
  }

  const candidate = `${localWithoutProtocol ? "http" : "https"}://${value}`;
  try {
    const parsed = new URL(candidate);
    return parsed.hostname
      ? { ok: true, url: parsed.href }
      : { ok: false, code: "invalid-url" };
  } catch {
    return { ok: false, code: "invalid-url" };
  }
}

export function isOpenChromePageRequest(
  value: unknown
): value is OpenChromePageRequest {
  if (!isRecord(value) || typeof value.requestId !== "string" || !value.requestId) {
    return false;
  }
  if (
    typeof value.preferredEndpoint !== "undefined" &&
    typeof value.preferredEndpoint !== "string"
  ) {
    return false;
  }
  const source = value.source;
  if (!isRecord(source) || typeof source.kind !== "string") {
    return false;
  }
  return source.kind === "custom"
    ? typeof source.value === "string"
    : source.kind === "test-page" && typeof source.id === "string" && Boolean(source.id);
}

function isLocalAddressWithoutProtocol(value: string): boolean {
  const authority = value.split(/[/?#]/, 1)[0].toLowerCase();
  const hostname = authority.replace(/:\d+$/, "");
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return true;
  }
  const parts = hostname.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }
  return (
    parts[0] === 10 ||
    parts[0] === 127 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    (parts[0] === 169 && parts[1] === 254)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
