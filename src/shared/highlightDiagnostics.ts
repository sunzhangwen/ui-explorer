import type {
  DomSnapshotResult,
  ElementSnapshot,
  HighlightResult,
  HighlightTargetStatus,
  SnapshotDiagnostic
} from "./ipc.js";

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
