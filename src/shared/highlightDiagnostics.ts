import type {
  DomSnapshotResult,
  ElementSnapshot,
  HighlightResult,
  HighlightTargetStatus,
  SnapshotDiagnostic
} from "./ipc.js";

export type HighlightRequestIdentity = {
  capturedAt: string;
  rootId: string | null;
  targetId: string | null;
  generation: number;
  snapshotToken: string | null;
};

export function captureHighlightRequest(
  snapshot: DomSnapshotResult | null,
  targetId: string | null,
  generation: number
): HighlightRequestIdentity | null {
  if (!snapshot) {
    return null;
  }

  return {
    capturedAt: snapshot.capturedAt,
    rootId: snapshot.root?.id ?? null,
    targetId,
    generation,
    snapshotToken: snapshot.snapshotToken ?? null
  };
}

export function isHighlightRequestCurrent(
  snapshot: DomSnapshotResult | null,
  targetId: string | null,
  generation: number,
  request: HighlightRequestIdentity | null
): boolean {
  return (
    snapshot !== null &&
    request !== null &&
    snapshot.capturedAt === request.capturedAt &&
    (snapshot.snapshotToken ?? null) === request.snapshotToken &&
    (snapshot.root?.id ?? null) === request.rootId &&
    targetId === request.targetId &&
    generation === request.generation
  );
}

export function mergeCurrentHighlightResult(
  snapshot: DomSnapshotResult | null,
  targetId: string | null,
  generation: number,
  request: HighlightRequestIdentity | null,
  result: HighlightResult
): DomSnapshotResult | null {
  if (!snapshot || !isHighlightRequestCurrent(snapshot, targetId, generation, request)) {
    return snapshot;
  }
  return mergeHighlightResult(snapshot, result);
}

export function mergeHighlightResult(snapshot: DomSnapshotResult, result: HighlightResult): DomSnapshotResult {
  if (!snapshot.root || result.targets.length === 0) {
    return snapshot;
  }

  const statuses = new Map(result.targets.map((status) => [status.elementId, status]));
  const root = mergeNodeStatuses(snapshot.root, statuses);
  return root === snapshot.root ? snapshot : { ...snapshot, root };
}

function mergeNodeStatuses(
  node: ElementSnapshot,
  statuses: ReadonlyMap<string, HighlightTargetStatus>
): ElementSnapshot {
  const status = statuses.get(node.id);
  const diagnostic = mergeDiagnostic(node.diagnostic, status);
  let children = node.children;

  for (let index = 0; index < node.children.length; index += 1) {
    const child = node.children[index];
    if (!child) {
      continue;
    }

    const mergedChild = mergeNodeStatuses(child, statuses);
    if (mergedChild === child) {
      continue;
    }

    if (children === node.children) {
      children = node.children.slice();
    }
    children[index] = mergedChild;
  }

  if (diagnostic === node.diagnostic && children === node.children) {
    return node;
  }

  if (diagnostic === undefined) {
    const { diagnostic: _removed, ...withoutDiagnostic } = node;
    return { ...withoutDiagnostic, children };
  }

  return { ...node, diagnostic, children };
}

function mergeDiagnostic(
  current: SnapshotDiagnostic | undefined,
  status: HighlightTargetStatus | undefined
): SnapshotDiagnostic | undefined {
  if (!status) {
    return current;
  }

  if (status.status === "highlighted") {
    return current?.code === "detached-context" ? undefined : current;
  }

  return diagnosticsEqual(current, status.diagnostic) ? current : status.diagnostic;
}

function diagnosticsEqual(left: SnapshotDiagnostic | undefined, right: SnapshotDiagnostic): boolean {
  return (
    left?.code === right.code &&
    left.messageKey === right.messageKey &&
    left.detail === right.detail
  );
}
