import test from "node:test";
import assert from "node:assert/strict";
import { getDefaultBrowserTargetId, recoverBrowserTarget, toBrowserTargets } from "./browserTargets.js";

test("toBrowserTargets keeps inspectable page and iframe targets", () => {
  const targets = toBrowserTargets([
    { id: "page-1", type: "page", title: "App", url: "https://app.test", webSocketDebuggerUrl: "ws://page" },
    { id: "worker-1", type: "service_worker", title: "Worker", url: "https://app.test/sw.js" },
    { id: "iframe-1", type: "iframe", title: "Frame", url: "https://app.test/frame", webSocketDebuggerUrl: "ws://frame" }
  ]);

  assert.deepEqual(
    targets.map((target) => target.id),
    ["page-1", "iframe-1"]
  );
});

test("toBrowserTargets accepts wrapped target lists from diagnostic clients", () => {
  const targets = toBrowserTargets({
    value: [
      { id: "page-1", type: "page", title: "Bing", url: "https://www.bing.com/", webSocketDebuggerUrl: "ws://page" },
      { id: "browser-ui", type: "browser_ui", title: "Toolbar", url: "chrome://toolbar", webSocketDebuggerUrl: "ws://ui" }
    ]
  });

  assert.deepEqual(
    targets.map((target) => target.id),
    ["page-1"]
  );
});

test("getDefaultBrowserTargetId prefers page targets", () => {
  assert.equal(
    getDefaultBrowserTargetId([
      { id: "iframe-1", type: "iframe", title: "Frame", url: "https://app.test/frame" },
      { id: "page-1", type: "page", title: "App", url: "https://app.test" }
    ]),
    "page-1"
  );
});

test("BrowserTargetRecovery keeps a selected target that still exists", () => {
  const previous = { id: "page-1", type: "page", title: "App", url: "https://app.test" };
  const targets = [
    { id: "page-1", type: "page", title: "App refreshed", url: "https://app.test/dashboard" }
  ];

  assert.deepEqual(recoverBrowserTarget(previous, targets), {
    targetId: "page-1",
    status: "stable"
  });
});

test("BrowserTargetRecovery reconnects a replacement target with the same URL", () => {
  const previous = { id: "page-old", type: "page", title: "App", url: "https://app.test/dashboard" };
  const targets = [
    { id: "page-new", type: "page", title: "App", url: "https://app.test/dashboard" }
  ];

  assert.deepEqual(recoverBrowserTarget(previous, targets), {
    targetId: "page-new",
    status: "recovered"
  });
});

test("BrowserTargetRecovery reports a closed target without switching to another page", () => {
  const previous = { id: "page-old", type: "page", title: "App", url: "https://app.test/dashboard" };
  const targets = [
    { id: "other", type: "page", title: "Other", url: "https://other.test" }
  ];

  assert.deepEqual(recoverBrowserTarget(previous, targets), {
    targetId: null,
    status: "closed"
  });
});
