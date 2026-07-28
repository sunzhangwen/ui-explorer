import {
  findElementSnapshot,
  flattenElementSnapshot
} from "../shared/domSnapshot.js";
import type {
  BoundingBox,
  ContextBoundary,
  DomSnapshotResult,
  ElementSnapshot,
  SnapshotDiagnosticCode
} from "../shared/ipc.js";

export type SessionSnapshot = {
  sessionId: string;
  targetId: string;
  frameId?: string;
  parentFrameId?: string;
  revision: number;
  result: DomSnapshotResult;
};

export type UnavailableContextDiagnostic = {
  sessionId: string;
  frameId?: string;
  diagnostic: {
    code: SnapshotDiagnosticCode;
    detail: string;
  };
};

export function stitchSessionSnapshots(
  rootSessionId: string,
  snapshots: SessionSnapshot[]
): DomSnapshotResult {
  const rootSnapshot = snapshots.find((snapshot) => snapshot.sessionId === rootSessionId);
  if (!rootSnapshot) {
    throw new Error(`Root session snapshot is missing: ${rootSessionId}`);
  }

  const roots = new Map(
    snapshots.map((snapshot) => [
      snapshot.sessionId,
      snapshot.result.root
        ? namespaceSnapshotNode(snapshot.result.root, snapshot.sessionId)
        : null
    ])
  );
  const pending = snapshots
    .filter((snapshot) => snapshot.sessionId !== rootSessionId)
    .sort((left, right) =>
      getSnapshotDepth(right, snapshots) - getSnapshotDepth(left, snapshots)
    );
  const attached = new Set<string>();

  for (const childSnapshot of pending) {
    const childRoot = roots.get(childSnapshot.sessionId);
    const parentSnapshot = findParentSnapshot(childSnapshot, snapshots, roots, rootSessionId);
    if (!childRoot || !parentSnapshot?.root || !childSnapshot.frameId) {
      continue;
    }
    const marker = findFrameMarker(parentSnapshot.root, childSnapshot.frameId);
    if (!marker) {
      continue;
    }
    const host = findElementSnapshot(parentSnapshot.root, marker.hostNodeId);
    if (!host) {
      continue;
    }

    const boundary: ContextBoundary = {
      ...marker,
      hostAttributes: { ...marker.hostAttributes },
      sessionId: childSnapshot.sessionId,
      targetId: childSnapshot.targetId,
      frameId: childSnapshot.frameId
    };
    const offsets = boundary.ownerContentOffset ? [boundary.ownerContentOffset] : [];
    const contextualChild = attachContextBoundary(
      translateSnapshotNode(childRoot, offsets),
      boundary,
      host.id,
      host.depth + 1,
      true
    );
    host.children = host.children.filter((node) =>
      !(
        node.diagnostic?.code === "cross-origin-frame" &&
        node.context?.at(-1)?.frameId === childSnapshot.frameId
      )
    );
    host.children.push(contextualChild);
    host.childIds = host.children.map((node) => node.id);
    attached.add(childSnapshot.sessionId);
  }

  const root = roots.get(rootSessionId);
  if (!root) {
    return {
      root: null,
      capturedAt: rootSnapshot.result.capturedAt,
      snapshotToken: rootSnapshot.result.snapshotToken,
      nodeCount: 0
    };
  }

  for (const childSnapshot of pending) {
    if (!attached.has(childSnapshot.sessionId)) {
      appendOwnerDiagnostic(root, childSnapshot);
    }
  }
  recalculateTree(root, undefined, 0);

  return {
    root,
    capturedAt: rootSnapshot.result.capturedAt,
    snapshotToken: rootSnapshot.result.snapshotToken,
    nodeCount: flattenElementSnapshot(root).length
  };
}

export function namespaceSnapshotNode(
  node: ElementSnapshot,
  sessionId: string,
  parentId?: string
): ElementSnapshot {
  const id = namespaceElementId(sessionId, node.id);
  const children = node.children.map((child) =>
    namespaceSnapshotNode(child, sessionId, id)
  );
  return {
    ...node,
    id,
    ...(parentId ? { parentId } : { parentId: undefined }),
    context: node.context?.map((boundary) => ({
      ...boundary,
      hostNodeId: namespaceElementId(sessionId, boundary.hostNodeId),
      hostAttributes: { ...boundary.hostAttributes },
      sessionId: boundary.sessionId ?? sessionId,
      ownerContentOffset: boundary.ownerContentOffset
        ? { ...boundary.ownerContentOffset }
        : undefined
    })),
    childIds: children.map((child) => child.id),
    children
  };
}

export function translateBoundingBox(
  box: BoundingBox,
  offsets: Array<{ x: number; y: number }>
): BoundingBox {
  return offsets.reduce<BoundingBox>(
    (translated, offset) => ({
      ...translated,
      x: translated.x + offset.x,
      y: translated.y + offset.y
    }),
    { ...box }
  );
}

export function appendUnavailableContextDiagnostics(
  result: DomSnapshotResult,
  contexts: UnavailableContextDiagnostic[]
): void {
  if (!result.root) {
    return;
  }
  for (const context of contexts) {
    const messageKey = diagnosticMessageKey(context.diagnostic.code);
    const id = `${result.root.id}::${context.diagnostic.code}::${context.frameId ?? context.sessionId}`;
    result.root.children.push({
      id,
      parentId: result.root.id,
      depth: result.root.depth + 1,
      nodeType: 8,
      nodeName: "#context-unavailable",
      text: context.diagnostic.detail,
      kind: "diagnostic",
      context: [],
      diagnostic: {
        code: context.diagnostic.code,
        messageKey,
        detail: context.diagnostic.detail
      },
      attributes: {},
      childIds: [],
      children: []
    });
  }
  recalculateTree(result.root, undefined, 0);
  result.nodeCount = flattenElementSnapshot(result.root).length;
}

function findParentSnapshot(
  child: SessionSnapshot,
  snapshots: SessionSnapshot[],
  roots: Map<string, ElementSnapshot | null>,
  rootSessionId: string
): { snapshot: SessionSnapshot; root: ElementSnapshot } | null {
  const exact = snapshots.find((candidate) =>
    candidate.frameId === child.parentFrameId && candidate.sessionId !== child.sessionId
  );
  const parent = exact ?? snapshots.find((candidate) => candidate.sessionId === rootSessionId);
  const root = parent ? roots.get(parent.sessionId) : null;
  return parent && root ? { snapshot: parent, root } : null;
}

function getSnapshotDepth(
  snapshot: SessionSnapshot,
  snapshots: SessionSnapshot[],
  visited = new Set<string>()
): number {
  if (!snapshot.parentFrameId || visited.has(snapshot.sessionId)) {
    return 0;
  }
  visited.add(snapshot.sessionId);
  const parent = snapshots.find((candidate) =>
    candidate.frameId === snapshot.parentFrameId &&
    candidate.sessionId !== snapshot.sessionId
  );
  return parent ? getSnapshotDepth(parent, snapshots, visited) + 1 : 1;
}

function findFrameMarker(
  root: ElementSnapshot,
  frameId: string
): ContextBoundary | null {
  for (const node of flattenElementSnapshot(root)) {
    const boundary = node.context?.find((item) =>
      item.kind === "frame" && item.frameId === frameId
    );
    if (boundary) {
      return boundary;
    }
  }
  return null;
}

function translateSnapshotNode(
  node: ElementSnapshot,
  offsets: Array<{ x: number; y: number }>
): ElementSnapshot {
  const children = node.children.map((child) => translateSnapshotNode(child, offsets));
  return {
    ...node,
    boundingBox: node.boundingBox
      ? translateBoundingBox(node.boundingBox, offsets)
      : undefined,
    children,
    childIds: children.map((child) => child.id)
  };
}

function attachContextBoundary(
  node: ElementSnapshot,
  boundary: ContextBoundary,
  parentId: string,
  depth: number,
  isRoot: boolean
): ElementSnapshot {
  const children = node.children.map((child) =>
    attachContextBoundary(child, boundary, node.id, depth + 1, false)
  );
  return {
    ...node,
    parentId,
    depth,
    kind: isRoot ? "frame" : node.kind,
    context: [
      {
        ...boundary,
        hostAttributes: { ...boundary.hostAttributes },
        ownerContentOffset: boundary.ownerContentOffset
          ? { ...boundary.ownerContentOffset }
          : undefined
      },
      ...(node.context ?? [])
    ],
    children,
    childIds: children.map((child) => child.id)
  };
}

function appendOwnerDiagnostic(
  root: ElementSnapshot,
  child: SessionSnapshot
): void {
  const id = `${root.id}::frame-owner-unresolved::${child.frameId ?? child.sessionId}`;
  const diagnostic: ElementSnapshot = {
    id,
    parentId: root.id,
    depth: root.depth + 1,
    nodeType: 8,
    nodeName: "#context-unavailable",
    text: `Unable to resolve owner for frame ${child.frameId ?? child.sessionId}.`,
    kind: "diagnostic",
    context: [],
    diagnostic: {
      code: "frame-owner-unresolved",
      messageKey: "snapshot.diagnostic.frameOwnerUnresolved",
      detail: `Unable to resolve owner for frame ${child.frameId ?? child.sessionId}.`
    },
    attributes: {},
    childIds: [],
    children: []
  };
  root.children.push(diagnostic);
  root.childIds.push(id);
}

function recalculateTree(
  node: ElementSnapshot,
  parentId: string | undefined,
  depth: number
): void {
  node.parentId = parentId;
  node.depth = depth;
  for (const child of node.children) {
    recalculateTree(child, node.id, depth + 1);
  }
  node.childIds = node.children.map((child) => child.id);
}

function namespaceElementId(sessionId: string, localId: string): string {
  return localId.startsWith(`${sessionId}::`) ? localId : `${sessionId}::${localId}`;
}

function diagnosticMessageKey(code: SnapshotDiagnosticCode): string {
  switch (code) {
    case "cross-origin-frame":
      return "diagnostic.crossOriginFrame";
    case "closed-shadow-root":
      return "diagnostic.closedShadowRoot";
    case "detached-context":
      return "diagnostic.detachedContext";
    case "frame-attach-failed":
      return "diagnostic.frameAttachFailed";
    case "frame-owner-unresolved":
      return "diagnostic.frameOwnerUnresolved";
    case "navigation-invalidated":
      return "diagnostic.navigationInvalidated";
    case "session-detached":
      return "diagnostic.sessionDetached";
    default: {
      const exhaustive: never = code;
      throw new Error(`Unhandled snapshot diagnostic: ${exhaustive}`);
    }
  }
}
