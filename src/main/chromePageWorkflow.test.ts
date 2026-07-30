import test from "node:test";
import assert from "node:assert/strict";
import { ChromePageWorkflow } from "./chromePageWorkflow.js";

test("ChromePageWorkflow normalizes a custom URL and returns the exact created target", async () => {
  const opened: string[] = [];
  const workflow = new ChromePageWorkflow({
    instances: {
      resolveEndpoint: async () => ({
        status: "ready",
        ownership: "external",
        launched: false,
        endpoint: "http://127.0.0.1:9222"
      })
    },
    testPages: { resolve: async () => "http://127.0.0.1/test" },
    session: {
      createAndSelectTarget: async (_endpoint, url) => {
        opened.push(url);
        return {
          connection: {
            endpoint: "http://127.0.0.1:9222",
            connected: true,
            status: "connected",
            targetId: "new-target",
            targets: []
          },
          snapshot: {
            root: null,
            capturedAt: "2026-07-30T00:00:00.000Z",
            nodeCount: 0
          },
          bootstrapTargetIds: []
        };
      },
      closeTarget: async () => undefined
    }
  });

  const result = await workflow.open({
    requestId: "r1",
    source: { kind: "custom", value: "example.com" }
  }, () => undefined);

  assert.equal(result.status, "opened");
  assert.deepEqual(opened, ["https://example.com/"]);
  if (result.status === "opened") {
    assert.equal(result.targetId, "new-target");
  }
});

test("ChromePageWorkflow reports a test server failure before launching Chrome", async () => {
  let endpointResolved = false;
  const workflow = new ChromePageWorkflow({
    instances: {
      resolveEndpoint: async () => {
        endpointResolved = true;
        return {
          status: "ready",
          ownership: "external",
          launched: false,
          endpoint: "http://127.0.0.1:9222"
        };
      }
    },
    testPages: {
      resolve: async () => {
        throw new Error("fixture server unavailable");
      }
    },
    session: {
      createAndSelectTarget: async () => {
        throw new Error("should not create a target");
      },
      closeTarget: async () => undefined
    }
  });

  const result = await workflow.open({
    requestId: "r2",
    source: { kind: "test-page", id: "basic-dom" }
  }, () => undefined);

  assert.equal(result.status, "error");
  if (result.status === "error") {
    assert.equal(result.code, "test-server-failed");
  }
  assert.equal(endpointResolved, false);
});

test("ChromePageWorkflow closes bootstrap tabs only for a newly launched instance", async () => {
  const closed: string[] = [];
  let launched = false;
  const workflow = new ChromePageWorkflow({
    instances: {
      resolveEndpoint: async () => ({
        status: "ready",
        ownership: "managed",
        launched,
        endpoint: "http://127.0.0.1:9222"
      })
    },
    testPages: { resolve: async () => "http://127.0.0.1/test" },
    session: {
      createAndSelectTarget: async () => ({
        connection: {
          endpoint: "http://127.0.0.1:9222",
          connected: true,
          status: "connected",
          targetId: "new-target",
          targets: []
        },
        snapshot: {
          root: null,
          capturedAt: "2026-07-30T00:00:00.000Z",
          nodeCount: 0
        },
        bootstrapTargetIds: ["existing-blank"]
      }),
      closeTarget: async (targetId) => {
        closed.push(targetId);
      }
    }
  });

  await workflow.open({
    requestId: "r3",
    source: { kind: "custom", value: "" }
  }, () => undefined);
  assert.deepEqual(closed, []);

  launched = true;
  await workflow.open({
    requestId: "r4",
    source: { kind: "custom", value: "" }
  }, () => undefined);
  assert.deepEqual(closed, ["existing-blank"]);
});
