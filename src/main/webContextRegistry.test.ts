import test from "node:test";
import assert from "node:assert/strict";
import { WebContextRegistry } from "./webContextRegistry.js";

test("WebContextRegistry maps an attached iframe target to its flat session", () => {
  const registry = new WebContextRegistry();

  registry.accept({
    method: "Target.attachedToTarget",
    params: {
      sessionId: "child-session",
      targetInfo: {
        targetId: "child-target",
        type: "iframe",
        title: "",
        url: "https://child.test",
        attached: true,
        canAccessOpener: false
      },
      waitingForDebugger: false
    }
  });

  assert.deepEqual(registry.getBySessionId("child-session"), {
    state: "attaching",
    targetId: "child-target",
    targetType: "iframe",
    sessionId: "child-session",
    revision: 0
  });
});

test("WebContextRegistry associates frame navigation and default execution context with a session", () => {
  const registry = attachedChildRegistry();

  registry.accept({
    method: "Page.frameNavigated",
    sessionId: "child-session",
    params: {
      frame: {
        id: "child-frame",
        parentId: "root-frame",
        loaderId: "loader-a",
        url: "https://child.test",
        securityOrigin: "https://child.test",
        mimeType: "text/html"
      },
      type: "Navigation"
    }
  });
  registry.accept({
    method: "Runtime.executionContextCreated",
    sessionId: "child-session",
    params: {
      context: {
        id: 41,
        uniqueId: "context-unique-a",
        origin: "https://child.test",
        name: "",
        auxData: {
          isDefault: true,
          type: "default",
          frameId: "child-frame"
        }
      }
    }
  });

  assert.deepEqual(registry.getByFrameId("child-frame"), {
    state: "active",
    targetId: "child-target",
    targetType: "iframe",
    sessionId: "child-session",
    frameId: "child-frame",
    parentFrameId: "root-frame",
    loaderId: "loader-a",
    executionContextId: 41,
    executionContextUniqueId: "context-unique-a",
    revision: 1
  });
});

test("WebContextRegistry invalidates the previous execution context on navigation", () => {
  const registry = activeChildRegistry();

  registry.accept({
    method: "Page.frameNavigated",
    sessionId: "child-session",
    params: {
      frame: {
        id: "child-frame",
        parentId: "root-frame",
        loaderId: "loader-b",
        url: "https://child.test/next",
        securityOrigin: "https://child.test",
        mimeType: "text/html"
      },
      type: "Navigation"
    }
  });

  assert.deepEqual(registry.getBySessionId("child-session"), {
    state: "navigating",
    targetId: "child-target",
    targetType: "iframe",
    sessionId: "child-session",
    frameId: "child-frame",
    parentFrameId: "root-frame",
    loaderId: "loader-b",
    revision: 2
  });
});

test("WebContextRegistry excludes detached sessions from active contexts", () => {
  const registry = activeChildRegistry();

  registry.accept({
    method: "Target.detachedFromTarget",
    params: {
      sessionId: "child-session",
      targetId: "child-target"
    }
  });

  assert.deepEqual(registry.getActiveContexts(), []);
  assert.deepEqual(registry.getBySessionId("child-session"), {
    state: "detached",
    targetId: "child-target",
    targetType: "iframe",
    sessionId: "child-session",
    frameId: "child-frame",
    parentFrameId: "root-frame",
    revision: 2,
    diagnostic: {
      code: "session-detached",
      detail: "CDP session detached."
    }
  });
});

test("WebContextRegistry records deterministic unavailable diagnostics", () => {
  const registry = attachedChildRegistry();

  registry.invalidateSession(
    "child-session",
    "frame-attach-failed",
    "Target initialization failed."
  );

  const unavailable = registry.getBySessionId("child-session");
  assert.equal(unavailable?.state, "unavailable");
  assert.deepEqual(registry.getActiveContexts(), []);
  assert.ok(unavailable?.state === "unavailable");
  assert.deepEqual(unavailable.diagnostic, {
    code: "frame-attach-failed",
    detail: "Target initialization failed."
  });
  assert.deepEqual(registry.getUnavailableContexts(), [unavailable]);
});

function attachedChildRegistry(): WebContextRegistry {
  const registry = new WebContextRegistry();
  registry.accept({
    method: "Target.attachedToTarget",
    params: {
      sessionId: "child-session",
      targetInfo: {
        targetId: "child-target",
        type: "iframe",
        title: "",
        url: "https://child.test",
        attached: true,
        canAccessOpener: false
      },
      waitingForDebugger: false
    }
  });
  return registry;
}

function activeChildRegistry(): WebContextRegistry {
  const registry = attachedChildRegistry();
  registry.accept({
    method: "Page.frameNavigated",
    sessionId: "child-session",
    params: {
      frame: {
        id: "child-frame",
        parentId: "root-frame",
        loaderId: "loader-a",
        url: "https://child.test",
        securityOrigin: "https://child.test",
        mimeType: "text/html"
      },
      type: "Navigation"
    }
  });
  registry.accept({
    method: "Runtime.executionContextCreated",
    sessionId: "child-session",
    params: {
      context: {
        id: 41,
        uniqueId: "context-unique-a",
        origin: "https://child.test",
        name: "",
        auxData: {
          isDefault: true,
          type: "default",
          frameId: "child-frame"
        }
      }
    }
  });
  return registry;
}
