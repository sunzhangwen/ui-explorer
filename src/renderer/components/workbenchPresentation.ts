import { formatElementAttributes } from "../../shared/domSnapshot.js";
import type { ContextBoundary, ElementSnapshot, SnapshotDiagnostic } from "../../shared/ipc.js";
import type { SelectorLayer } from "../../shared/selector.js";
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
  return node.kind !== "diagnostic";
}

export function findTreeSearchMatches(rows: ElementSnapshot[], query: string): ElementSnapshot[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return [];
  }

  return rows.filter((row) => isTreeNodeSelectable(row) && getTreeNodeSearchText(row).includes(normalizedQuery));
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

export function getVisibilityMessageKey(visible: boolean | undefined): MessageKey | null {
  return visible === undefined ? null : visible ? "properties.visible" : "properties.hidden";
}

function getTreeNodeSearchText(node: ElementSnapshot): string {
  return [node.nodeName, node.tagName ?? "", node.text ?? "", node.role ?? "", formatElementAttributes(node)]
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
