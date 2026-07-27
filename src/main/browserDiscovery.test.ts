import test from "node:test";
import assert from "node:assert/strict";
import {
  discoverBrowserEndpoints,
  getLocalDebugEndpointCandidates,
  type DebugEndpointProbe
} from "./browserDiscovery.js";

test("getLocalDebugEndpointCandidates covers Chrome and Edge loopback ports without duplicates", () => {
  const candidates = getLocalDebugEndpointCandidates();

  assert.deepEqual(candidates.slice(0, 2), ["http://127.0.0.1:9222", "http://localhost:9222"]);
  assert.equal(new Set(candidates).size, candidates.length);
  assert.ok(candidates.includes("http://127.0.0.1:9223"));
});

test("discoverBrowserEndpoints returns only responsive CDP endpoints in candidate order", async () => {
  const probe: DebugEndpointProbe = async (endpoint) => {
    if (endpoint.endsWith("9222")) {
      return { browser: "Chrome/140.0", webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/browser/a" };
    }
    throw new Error("unreachable");
  };

  const result = await discoverBrowserEndpoints(
    ["http://127.0.0.1:9222", "http://127.0.0.1:9223"],
    probe
  );

  assert.deepEqual(result, [
    {
      endpoint: "http://127.0.0.1:9222",
      browser: "Chrome/140.0",
      webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/browser/a"
    }
  ]);
});

test("discoverBrowserEndpoints de-duplicates aliases for the same browser websocket", async () => {
  const probe: DebugEndpointProbe = async () => ({
    browser: "Microsoft Edge/140.0",
    webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/browser/shared"
  });

  const result = await discoverBrowserEndpoints(
    ["http://127.0.0.1:9222", "http://localhost:9222"],
    probe
  );

  assert.equal(result.length, 1);
  assert.equal(result[0].endpoint, "http://127.0.0.1:9222");
});
