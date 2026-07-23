import { formatElementAttributes } from "../../shared/domSnapshot.js";
import type {
  ContextBoundary,
  ElementNodeKind,
  ElementSnapshot,
  SnapshotDiagnostic
} from "../../shared/ipc.js";
import {
  buildSelectorExports,
  buildUnavailableContextExports,
  type SelectorCandidate,
  type SelectorExports,
  type SelectorLayer
} from "../../shared/selector.js";
import type { MessageKey } from "../i18n/messages.js";

const SELECTOR_LAYER_MESSAGE_KEYS = {
  page: "selector.layer.page",
  frame: "selector.layer.frame",
  shadow: "selector.layer.shadow",
  ancestor: "selector.layer.ancestor",
  target: "selector.layer.target"
} as const satisfies Record<SelectorLayer["kind"], MessageKey>;

const DIAGNOSTIC_MESSAGE_KEYS = {
  "cross-origin-frame": "diagnostic.crossOriginFrame",
  "closed-shadow-root": "diagnostic.closedShadowRoot",
  "detached-context": "diagnostic.detachedContext"
} as const satisfies Record<SnapshotDiagnostic["code"], MessageKey>;

export function getSelectorLayerMessageKey(kind: SelectorLayer["kind"]): MessageKey {
  return SELECTOR_LAYER_MESSAGE_KEYS[kind];
}

export function isTreeNodeSelectable(node: ElementSnapshot): boolean {
  return true;
}

export function isTreeNodeHighlightable(node: ElementSnapshot): boolean {
  return node.nodeType === 1 && node.kind !== "diagnostic";
}

export function findTreeSearchMatches(rows: ElementSnapshot[], query: string): ElementSnapshot[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return [];
  }

  return rows.filter((row) => getTreeNodeSearchText(row).includes(normalizedQuery));
}

export function getContextPathLabels(context: ContextBoundary[]): Record<ContextBoundary["kind"], string[]> {
  const labels: Record<ContextBoundary["kind"], string[]> = {
    frame: [],
    shadow: []
  };

  for (const boundary of context) {
    labels[boundary.kind].push(getContextHostLabel(boundary));
  }

  return labels;
}

export function getDiagnosticPresentation(
  diagnostic: SnapshotDiagnostic
): { messageKey: MessageKey; detail: string } {
  return {
    messageKey: DIAGNOSTIC_MESSAGE_KEYS[diagnostic.code],
    detail: diagnostic.detail
  };
}

export function getTreeNodePresentationKind(node: ElementSnapshot): ElementNodeKind {
  return node.diagnostic ? "diagnostic" : (node.kind ?? "element");
}

export function getTreeNodeBadgeMessageKey(node: ElementSnapshot): MessageKey | null {
  const kind = getTreeNodePresentationKind(node);
  switch (kind) {
    case "page":
      return "tree.badge.page";
    case "frame":
      return "tree.badge.frame";
    case "shadow":
      return "tree.badge.shadow";
    case "diagnostic":
      return "tree.badge.limit";
    case "element":
      return null;
    default: {
      const exhaustiveKind: never = kind;
      throw new Error(`Unhandled tree node kind: ${exhaustiveKind}`);
    }
  }
}

export function getVisibilityMessageKey(visible: boolean | undefined): MessageKey | null {
  return visible === undefined ? null : visible ? "properties.visible" : "properties.hidden";
}

export function buildWorkbenchExports(
  selectedElement: ElementSnapshot | null,
  selectedCandidate: SelectorCandidate | null
): SelectorExports | null {
  if (selectedElement?.diagnostic) {
    return buildUnavailableContextExports(selectedElement);
  }
  return selectedCandidate ? buildSelectorExports(selectedCandidate) : null;
}

function getTreeNodeSearchText(node: ElementSnapshot): string {
  return [
    node.nodeName,
    node.tagName ?? "",
    node.text ?? "",
    node.role ?? "",
    formatElementAttributes(node),
    node.diagnostic?.code ?? "",
    node.diagnostic?.detail ?? ""
  ]
    .join(" ")
    .toLowerCase();
}

function getContextHostLabel(boundary: ContextBoundary): string {
  const { hostAttributes, hostTagName } = boundary;
  const id = hostAttributes.id;
  if (id) {
    return `${hostTagName}#${id}`;
  }

  const identifyingAttribute = ["data-testid", "name", "title"].find((name) => hostAttributes[name]);
  return identifyingAttribute
    ? `${hostTagName}[${identifyingAttribute}="${hostAttributes[identifyingAttribute]}"]`
    : hostTagName;
}
