import type { ElementSnapshot } from "./ipc.js";

export type ElementSnapshotStats = {
  totalNodes: number;
  elementNodes: number;
  shadowRoots: number;
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
      shadowRoots: stats.shadowRoots + (node.nodeName === "#shadow-root" ? 1 : 0)
    }),
    { totalNodes: 0, elementNodes: 0, shadowRoots: 0 }
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
