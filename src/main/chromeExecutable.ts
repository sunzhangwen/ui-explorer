import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, win32 } from "node:path";
import type { ChromeLaunchErrorCode } from "../shared/chromeLaunch.js";

export type ChromeLaunchSettings = {
  chromeExecutablePath?: string;
  lastDebugEndpoint?: string;
};

export type ChromeLaunchSettingsStoreLike = {
  read: () => Promise<ChromeLaunchSettings>;
  update: (patch: Partial<ChromeLaunchSettings>) => Promise<void>;
};

type ChromeExecutableLocatorOptions = {
  settings: ChromeLaunchSettingsStoreLike;
  environment?: NodeJS.ProcessEnv;
  fileExists?: (path: string) => Promise<boolean>;
  selectExecutable: () => Promise<string | null>;
};

export class ChromeExecutableError extends Error {
  constructor(public readonly code: ChromeLaunchErrorCode) {
    super(code);
  }
}

export class ChromeLaunchSettingsStore
  implements ChromeLaunchSettingsStoreLike
{
  constructor(private readonly settingsPath: string) {}

  async read(): Promise<ChromeLaunchSettings> {
    try {
      const parsed = JSON.parse(
        await readFile(this.settingsPath, "utf8")
      ) as unknown;
      return isSettings(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  async update(patch: Partial<ChromeLaunchSettings>): Promise<void> {
    const next = { ...(await this.read()), ...patch };
    await mkdir(dirname(this.settingsPath), { recursive: true });
    const temporaryPath = `${this.settingsPath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(next, null, 2), "utf8");
    await rename(temporaryPath, this.settingsPath);
  }
}

export class ChromeExecutableLocator {
  private readonly environment: NodeJS.ProcessEnv;
  private readonly fileExists: (path: string) => Promise<boolean>;

  constructor(private readonly options: ChromeExecutableLocatorOptions) {
    this.environment = options.environment ?? process.env;
    this.fileExists = options.fileExists ?? pathExists;
  }

  async resolve(): Promise<
    { status: "found"; path: string } | { status: "cancelled" }
  > {
    const settings = await this.options.settings.read();
    for (const candidate of getChromeExecutableCandidates(
      this.environment,
      settings.chromeExecutablePath
    )) {
      if (await this.isValid(candidate)) {
        return { status: "found", path: candidate };
      }
    }

    const selected = await this.options.selectExecutable();
    if (!selected) {
      return { status: "cancelled" };
    }
    if (!(await this.isValid(selected))) {
      throw new ChromeExecutableError("invalid-chrome-path");
    }
    await this.options.settings.update({ chromeExecutablePath: selected });
    return { status: "found", path: selected };
  }

  private async isValid(candidate: string): Promise<boolean> {
    return (
      win32.basename(candidate).toLowerCase() === "chrome.exe" &&
      win32.isAbsolute(candidate) &&
      (await this.fileExists(candidate))
    );
  }
}

export function getChromeExecutableCandidates(
  environment: NodeJS.ProcessEnv,
  savedPath?: string
): string[] {
  const candidates = [
    savedPath,
    environment.LOCALAPPDATA
      ? win32.join(
          environment.LOCALAPPDATA,
          "Google",
          "Chrome",
          "Application",
          "chrome.exe"
        )
      : undefined,
    environment.PROGRAMFILES
      ? win32.join(
          environment.PROGRAMFILES,
          "Google",
          "Chrome",
          "Application",
          "chrome.exe"
        )
      : undefined,
    environment["PROGRAMFILES(X86)"]
      ? win32.join(
          environment["PROGRAMFILES(X86)"],
          "Google",
          "Chrome",
          "Application",
          "chrome.exe"
        )
      : undefined
  ];
  return [...new Set(candidates.filter((value): value is string => Boolean(value)))];
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function isSettings(value: unknown): value is ChromeLaunchSettings {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    (typeof record.chromeExecutablePath === "undefined" ||
      typeof record.chromeExecutablePath === "string") &&
    (typeof record.lastDebugEndpoint === "undefined" ||
      typeof record.lastDebugEndpoint === "string")
  );
}
