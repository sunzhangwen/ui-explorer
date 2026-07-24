import test from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { ELEMENT_PICKER_SCRIPT, HIGHLIGHT_SCRIPT, SNAPSHOT_SCRIPT } from "./browserScripts.js";

type FakeDocument = {
  nodeType: number;
  ownerDocument: null;
  appended: unknown[];
  querySelectorAll: () => unknown[];
  createElement: () => {
    setAttribute: () => void;
    style: { cssText: string };
    appendChild: (child: unknown) => void;
    textContent?: string;
  };
  documentElement: {
    appendChild: (node: unknown) => void;
  };
  getRootNode: () => FakeDocument;
};

type FakeElement = {
  nodeType: number;
  isConnected: boolean;
  ownerDocument: FakeDocument;
  root: FakeRoot;
  getRootNode: () => FakeRoot;
  getBoundingClientRect: () => { left: number; top: number; width: number; height: number };
  contentDocument?: FakeDocument | null;
  shadowRoot?: FakeShadowRoot | null;
};

type FakeShadowRoot = {
  nodeType: number;
  host: FakeElement;
  ownerDocument: FakeDocument;
  getRootNode: () => FakeShadowRoot;
};

type FakeRoot = FakeDocument | FakeShadowRoot;

type RuntimeContextIdentity =
  | { kind: "frame"; host: FakeElement; root: FakeDocument }
  | { kind: "shadow"; host: FakeElement; root: FakeShadowRoot };

function createFakeDocument(): FakeDocument {
  const appended: unknown[] = [];
  const document: FakeDocument = {
    nodeType: 9,
    ownerDocument: null,
    appended,
    querySelectorAll: () => [],
    createElement: () => ({
      setAttribute: () => undefined,
      style: { cssText: "" },
      appendChild: () => undefined
    }),
    documentElement: {
      appendChild: (node) => appended.push(node)
    },
    getRootNode: () => document
  };
  return document;
}

function createFakeElement(
  ownerDocument: FakeDocument,
  isConnected = true,
  root: FakeRoot = ownerDocument
): FakeElement {
  const element: FakeElement = {
    nodeType: 1,
    isConnected,
    ownerDocument,
    root,
    getRootNode: () => element.root,
    getBoundingClientRect: () => ({ left: 1, top: 2, width: 30, height: 40 })
  };
  return element;
}

function createFakeShadowRoot(host: FakeElement): FakeShadowRoot {
  const root: FakeShadowRoot = {
    nodeType: 11,
    host,
    ownerDocument: host.ownerDocument,
    getRootNode: () => root
  };
  host.shadowRoot = root;
  return root;
}

function runHighlight(
  elementIds: string[],
  registry: Map<string, FakeElement>,
  contextIdentities = new Map<string, RuntimeContextIdentity[]>(),
  documents = new Set<FakeDocument>([createFakeDocument()]),
  expectedSnapshotToken = "snapshot-current",
  currentSnapshotToken = expectedSnapshotToken
): {
  targets: Array<{
    elementId: string;
    status: "highlighted" | "detached";
    diagnostic?: { code: string; detail: string };
  }>;
} {
  const topDocument = documents.values().next().value ?? createFakeDocument();
  return runInNewContext(
    HIGHLIGHT_SCRIPT
      .replace("__ELEMENT_IDS__", JSON.stringify(elementIds))
      .replace("__SNAPSHOT_TOKEN__", JSON.stringify(expectedSnapshotToken)),
    {
    Node: { ELEMENT_NODE: 1, DOCUMENT_NODE: 9 },
    document: topDocument,
    window: {
      __uiExplorerElements: registry,
      __uiExplorerDocuments: documents,
      __uiExplorerElementContexts: contextIdentities,
      __uiExplorerSnapshotToken: currentSnapshotToken
    }
  }) as {
    targets: Array<{
      elementId: string;
      status: "highlighted" | "detached";
      diagnostic?: { code: string; detail: string };
    }>;
  };
}

function normalizeVmValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

test("snapshot script records frame and shadow context boundaries", () => {
  assert.match(SNAPSHOT_SCRIPT, /kind:\s*"frame"/);
  assert.match(SNAPSHOT_SCRIPT, /kind:\s*"shadow"/);
  assert.match(SNAPSHOT_SCRIPT, /__uiExplorerElementContexts/);
  assert.match(SNAPSHOT_SCRIPT, /contentDocument/);
  assert.match(SNAPSHOT_SCRIPT, /shadowRoot/);
  assert.match(SNAPSHOT_SCRIPT, /cross-origin-frame/);
  assert.match(SNAPSHOT_SCRIPT, /closed-shadow-root/);
  assert.match(SNAPSHOT_SCRIPT, /__uiExplorerSnapshotToken/);
});

test("highlight and picker scripts visit accessible frame documents", () => {
  assert.match(HIGHLIGHT_SCRIPT, /ownerDocument/);
  assert.match(HIGHLIGHT_SCRIPT, /documents/);
  assert.match(ELEMENT_PICKER_SCRIPT, /contentDocument/);
  assert.match(ELEMENT_PICKER_SCRIPT, /composedPath/);
});

test("stale highlight requests do not clear or draw overlays for a newer snapshot", () => {
  const document = createFakeDocument();
  const target = createFakeElement(document);
  const result = runHighlight(
    ["n-1"],
    new Map([["n-1", target]]),
    new Map(),
    new Set([document]),
    "snapshot-old",
    "snapshot-new"
  );

  assert.deepEqual(normalizeVmValue(result.targets), []);
  assert.deepEqual(document.appended, []);
});

test("picker installs listeners in every captured document", () => {
  assert.match(ELEMENT_PICKER_SCRIPT, /__uiExplorerDocuments/);
  assert.match(ELEMENT_PICKER_SCRIPT, /for\s*\(const doc of documents\)/);
  assert.match(ELEMENT_PICKER_SCRIPT, /install\(doc\)/);
});

test("highlight reports missing and disconnected registry targets as detached", () => {
  const document = createFakeDocument();
  const disconnected = createFakeElement(document, false);

  const result = runHighlight(
    ["missing", "disconnected"],
    new Map([["disconnected", disconnected]]),
    new Map(),
    new Set([document])
  );

  assert.deepEqual(
    normalizeVmValue(result.targets.map(({ elementId, status, diagnostic }) => ({
      elementId,
      status,
      code: diagnostic?.code
    }))),
    [
      { elementId: "missing", status: "detached", code: "detached-context" },
      { elementId: "disconnected", status: "detached", code: "detached-context" }
    ]
  );
});

test("highlight detects a replaced frame document captured by the snapshot", () => {
  const topDocument = createFakeDocument();
  const capturedFrameDocument = createFakeDocument();
  const replacementFrameDocument = createFakeDocument();
  const frameHost = createFakeElement(topDocument);
  frameHost.contentDocument = replacementFrameDocument;
  const target = createFakeElement(capturedFrameDocument);
  const contexts = new Map<string, RuntimeContextIdentity[]>([
    ["target", [{ kind: "frame", host: frameHost, root: capturedFrameDocument }]]
  ]);

  const result = runHighlight(
    ["target"],
    new Map([["target", target]]),
    contexts,
    new Set([topDocument, capturedFrameDocument])
  );

  assert.equal(result.targets[0]?.status, "detached");
  assert.match(result.targets[0]?.diagnostic?.detail ?? "", /frame/i);
});

test("highlight reports a frame that becomes runtime-inaccessible as detached", () => {
  const topDocument = createFakeDocument();
  const capturedFrameDocument = createFakeDocument();
  const frameHost = createFakeElement(topDocument);
  Object.defineProperty(frameHost, "contentDocument", {
    get: () => {
      throw new Error("Blocked a frame with origin");
    }
  });
  const target = createFakeElement(capturedFrameDocument);
  const contexts = new Map<string, RuntimeContextIdentity[]>([
    ["target", [{ kind: "frame", host: frameHost, root: capturedFrameDocument }]]
  ]);

  const result = runHighlight(
    ["target"],
    new Map([["target", target]]),
    contexts,
    new Set([topDocument, capturedFrameDocument])
  );

  assert.equal(result.targets[0]?.status, "detached");
  assert.match(result.targets[0]?.diagnostic?.detail ?? "", /frame/i);
});

test("highlight detects detached shadow hosts and replaced shadow roots", () => {
  const document = createFakeDocument();
  const detachedHost = createFakeElement(document, false);
  const capturedRoot = createFakeShadowRoot(detachedHost);
  const replacedHost = createFakeElement(document);
  const replacedCapturedRoot = createFakeShadowRoot(replacedHost);
  createFakeShadowRoot(replacedHost);
  const detachedTarget = createFakeElement(document);
  const replacedTarget = createFakeElement(document);
  const contexts = new Map<string, RuntimeContextIdentity[]>([
    ["detached-target", [{ kind: "shadow", host: detachedHost, root: capturedRoot }]],
    ["replaced-target", [{ kind: "shadow", host: replacedHost, root: replacedCapturedRoot }]]
  ]);

  const result = runHighlight(
    ["detached-target", "replaced-target"],
    new Map([
      ["detached-target", detachedTarget],
      ["replaced-target", replacedTarget]
    ]),
    contexts,
    new Set([document])
  );

  assert.deepEqual(normalizeVmValue(result.targets.map((target) => target.status)), ["detached", "detached"]);
  assert.match(result.targets[0]?.diagnostic?.detail ?? "", /shadow/i);
  assert.match(result.targets[1]?.diagnostic?.detail ?? "", /shadow/i);
});

test("highlight accepts attached nested frame and shadow identities", () => {
  const topDocument = createFakeDocument();
  const frameDocument = createFakeDocument();
  const frameHost = createFakeElement(topDocument);
  frameHost.contentDocument = frameDocument;
  const shadowHost = createFakeElement(frameDocument);
  const shadowRoot = createFakeShadowRoot(shadowHost);
  const target = createFakeElement(frameDocument, true, shadowRoot);
  const contexts = new Map<string, RuntimeContextIdentity[]>([
    [
      "target",
      [
        { kind: "frame", host: frameHost, root: frameDocument },
        { kind: "shadow", host: shadowHost, root: shadowRoot }
      ]
    ]
  ]);

  const result = runHighlight(
    ["target"],
    new Map([["target", target]]),
    contexts,
    new Set([topDocument, frameDocument])
  );

  assert.deepEqual(normalizeVmValue(result.targets), [{ elementId: "target", status: "highlighted" }]);
  assert.equal(frameDocument.appended.length, 1);
});

test("highlight rejects a captured frame target adopted into the top document", () => {
  const topDocument = createFakeDocument();
  const frameDocument = createFakeDocument();
  const frameHost = createFakeElement(topDocument);
  frameHost.contentDocument = frameDocument;
  const adoptedTarget = createFakeElement(topDocument);
  const contexts = new Map<string, RuntimeContextIdentity[]>([
    ["target", [{ kind: "frame", host: frameHost, root: frameDocument }]]
  ]);

  const result = runHighlight(
    ["target"],
    new Map([["target", adoptedTarget]]),
    contexts,
    new Set([topDocument, frameDocument])
  );

  assert.equal(result.targets[0]?.status, "detached");
  assert.match(result.targets[0]?.diagnostic?.detail ?? "", /root|document|context/i);
});

test("highlight rejects a captured shadow target moved into light DOM", () => {
  const document = createFakeDocument();
  const shadowHost = createFakeElement(document);
  const shadowRoot = createFakeShadowRoot(shadowHost);
  const movedTarget = createFakeElement(document);
  const contexts = new Map<string, RuntimeContextIdentity[]>([
    ["target", [{ kind: "shadow", host: shadowHost, root: shadowRoot }]]
  ]);

  const result = runHighlight(
    ["target"],
    new Map([["target", movedTarget]]),
    contexts,
    new Set([document])
  );

  assert.equal(result.targets[0]?.status, "detached");
  assert.match(result.targets[0]?.diagnostic?.detail ?? "", /root|document|context/i);
});

test("highlight rejects a nested context host moved to another connected root", () => {
  const document = createFakeDocument();
  const outerHost = createFakeElement(document);
  const outerRoot = createFakeShadowRoot(outerHost);
  const otherHost = createFakeElement(document);
  const otherRoot = createFakeShadowRoot(otherHost);
  const innerHost = createFakeElement(document, true, otherRoot);
  const innerRoot = createFakeShadowRoot(innerHost);
  const target = createFakeElement(document, true, innerRoot);
  const contexts = new Map<string, RuntimeContextIdentity[]>([
    [
      "target",
      [
        { kind: "shadow", host: outerHost, root: outerRoot },
        { kind: "shadow", host: innerHost, root: innerRoot }
      ]
    ]
  ]);

  const result = runHighlight(
    ["target"],
    new Map([["target", target]]),
    contexts,
    new Set([document])
  );

  assert.equal(result.targets[0]?.status, "detached");
  assert.match(result.targets[0]?.diagnostic?.detail ?? "", /host|root|context/i);
});
