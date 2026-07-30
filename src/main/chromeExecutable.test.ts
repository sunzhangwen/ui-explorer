import test from "node:test";
import assert from "node:assert/strict";
import {
  ChromeExecutableLocator,
  getChromeExecutableCandidates,
  type ChromeLaunchSettingsStoreLike
} from "./chromeExecutable.js";

test("ChromeExecutable candidates prefer a saved path before standard locations", () => {
  assert.deepEqual(
    getChromeExecutableCandidates(
      {
        LOCALAPPDATA: "C:\\Users\\dev\\AppData\\Local",
        PROGRAMFILES: "C:\\Program Files",
        "PROGRAMFILES(X86)": "C:\\Program Files (x86)"
      },
      "D:\\Chrome\\chrome.exe"
    ),
    [
      "D:\\Chrome\\chrome.exe",
      "C:\\Users\\dev\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
    ]
  );
});

test("ChromeExecutable uses a valid saved executable without prompting", async () => {
  const settings: ChromeLaunchSettingsStoreLike = {
    read: async () => ({ chromeExecutablePath: "D:\\Chrome\\chrome.exe" }),
    update: async () => undefined
  };
  let prompts = 0;
  const locator = new ChromeExecutableLocator({
    settings,
    environment: {},
    fileExists: async (path) => path === "D:\\Chrome\\chrome.exe",
    selectExecutable: async () => {
      prompts += 1;
      return null;
    }
  });

  assert.deepEqual(await locator.resolve(), {
    status: "found",
    path: "D:\\Chrome\\chrome.exe"
  });
  assert.equal(prompts, 0);
});

test("ChromeExecutable persists a manually selected executable", async () => {
  let savedPath: string | undefined;
  const settings: ChromeLaunchSettingsStoreLike = {
    read: async () => ({}),
    update: async (patch) => {
      savedPath = patch.chromeExecutablePath;
    }
  };
  const locator = new ChromeExecutableLocator({
    settings,
    environment: {},
    fileExists: async (path) => path === "C:\\Portable\\chrome.exe",
    selectExecutable: async () => "C:\\Portable\\chrome.exe"
  });

  assert.equal((await locator.resolve()).status, "found");
  assert.equal(savedPath, "C:\\Portable\\chrome.exe");
});

test("ChromeExecutable treats a cancelled selection as cancellation", async () => {
  const locator = new ChromeExecutableLocator({
    settings: {
      read: async () => ({}),
      update: async () => undefined
    },
    environment: {},
    fileExists: async () => false,
    selectExecutable: async () => null
  });

  assert.deepEqual(await locator.resolve(), { status: "cancelled" });
});
