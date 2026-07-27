import type { ContextBoundary, ElementSnapshot } from "./ipc.js";

export type ElementSnapshotStats = {
  totalNodes: number;
  elementNodes: number;
  frameRoots: number;
  shadowRoots: number;
  inaccessibleContexts: number;
};

export type ElementSelectionRestoreResult =
  | {
      elementId: string;
      status: "restored";
      strategy: "stable-attribute" | "semantic";
    }
  | {
      elementId: null;
      status: "not-found" | "ambiguous";
    };

export function flattenElementSnapshot(root: ElementSnapshot | null): ElementSnapshot[] {
  if (!root) {
    return [];
  }

  const rows: ElementSnapshot[] = [];
  const visit = (node: ElementSnapshot) => {
    rows.push(node);
    for (const child of node.children) {
      visit(child);
    }
  };

  visit(root);
  return rows;
}

export function findElementSnapshot(root: ElementSnapshot | null, id: string): ElementSnapshot | null {
  if (!root) {
    return null;
  }

  if (root.id === id) {
    return root;
  }

  for (const child of root.children) {
    const match = findElementSnapshot(child, id);
    if (match) {
      return match;
    }
  }

  return null;
}

export function getElementPath(root: ElementSnapshot | null, id: string): ElementSnapshot[] {
  if (!root) return [];
  const path: ElementSnapshot[] = [];
  const visit = (node: ElementSnapshot): boolean => {
    path.push(node);
    if (node.id === id) return true;
    for (const child of node.children) if (visit(child)) return true;
    path.pop();
    return false;
  };
  return visit(root) ? path : [];
}

export function getContextPath(root: ElementSnapshot | null, id: string): ContextBoundary[] {
  const node = findElementSnapshot(root, id);
  return node?.context ? node.context.map((boundary) => ({ ...boundary, hostAttributes: { ...boundary.hostAttributes } })) : [];
}

export function formatElementAttributes(node: ElementSnapshot | null | undefined): string {
  if (!node) {
    return "";
  }

  return Object.entries(node.attributes)
    .map(([name, value]) => `${name}="${value}"`)
    .join(" ");
}

export function getElementSnapshotStats(root: ElementSnapshot | null): ElementSnapshotStats {
  return flattenElementSnapshot(root).reduce<ElementSnapshotStats>(
    (stats, node) => ({
      totalNodes: stats.totalNodes + 1,
      elementNodes: stats.elementNodes + (node.nodeType === 1 ? 1 : 0),
      frameRoots: stats.frameRoots + (node.kind === "frame" ? 1 : 0),
      shadowRoots: stats.shadowRoots + (node.nodeName === "#shadow-root" ? 1 : 0),
      inaccessibleContexts: stats.inaccessibleContexts + (node.kind === "diagnostic" ? 1 : 0)
    }),
    { totalNodes: 0, elementNodes: 0, frameRoots: 0, shadowRoots: 0, inaccessibleContexts: 0 }
  );
}

export function normalizeDebugEndpoint(endpoint: string): string {
  const trimmed = endpoint.trim().replace(/\/+$/, "");

  if (!trimmed) {
    throw new Error("debug endpoint is required");
  }

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  const url = new URL(withProtocol);
  return `${url.protocol}//${url.host}`;
}

const STABLE_ID_PATTERN = /^[a-z][a-z0-9_-]{0,79}$/i;
const STABLE_ATTRIBUTE_WEIGHTS: Record<string, number> = {
  "data-testid": 100,
  "data-test": 95,
  "data-qa": 95,
  id: 90,
  name: 60,
  "aria-label": 50,
  title: 20
};

export function restoreElementSelection(
  previousRoot: ElementSnapshot | null,
  nextRoot: ElementSnapshot | null,
  previousElementId: string | null
): ElementSelectionRestoreResult {
  const previous = previousElementId ? findElementSnapshot(previousRoot, previousElementId) : null;
  if (!previous || !nextRoot) {
    return { elementId: null, status: "not-found" };
  }

  const candidates = flattenElementSnapshot(nextRoot).filter(
    (candidate) => candidate.kind === previous.kind && candidate.tagName === previous.tagName
  );
  const stableAttributes = Object.entries(previous.attributes).filter(
    ([name, value]) =>
      Boolean(value) &&
      name in STABLE_ATTRIBUTE_WEIGHTS &&
      (name !== "id" || STABLE_ID_PATTERN.test(value))
  );
  const stableMatches = candidates
    .map((candidate) => ({
      candidate,
      score: stableAttributes.reduce(
        (score, [name, value]) =>
          score + (candidate.attributes[name] === value ? STABLE_ATTRIBUTE_WEIGHTS[name] : 0),
        0
      )
    }))
    .filter((match) => match.score > 0)
    .sort((left, right) => right.score - left.score);
  const strongestMatches = stableMatches.filter((match) => match.score === stableMatches[0]?.score);

  if (strongestMatches.length === 1) {
    return { elementId: strongestMatches[0].candidate.id, status: "restored", strategy: "stable-attribute" };
  }
  if (strongestMatches.length > 1) {
    return { elementId: null, status: "ambiguous" };
  }

  const semanticMatches = candidates.filter(
    (candidate) =>
      Boolean(previous.text || previous.role) &&
      candidate.text === previous.text &&
      candidate.role === previous.role &&
      contextSignature(candidate.context) === contextSignature(previous.context)
  );
  if (semanticMatches.length === 1) {
    return { elementId: semanticMatches[0].id, status: "restored", strategy: "semantic" };
  }
  return { elementId: null, status: semanticMatches.length > 1 ? "ambiguous" : "not-found" };
}

function contextSignature(context: ContextBoundary[] | undefined): string {
  return JSON.stringify(
    (context ?? []).map((boundary) => ({
      kind: boundary.kind,
      hostTagName: boundary.hostTagName,
      hostAttributes: boundary.hostAttributes
    }))
  );
}
