import type {
  ContextBoundary,
  ElementSnapshot,
  ExecuteJavaScriptDiagnosticRequest,
  PrepareJavaScriptDiagnosticRequest
} from "./ipc.js";
import type { SelectorCandidate } from "./selector.js";

export const JAVASCRIPT_DIAGNOSTIC_CODE_LIMIT = 50 * 1024;
export const JAVASCRIPT_DIAGNOSTIC_TIMEOUT_MS = 5_000;
export const JAVASCRIPT_DIAGNOSTIC_PLAN_TTL_MS = 60_000;

export type JavaScriptDiagnosticStrategy =
  | "dom-query"
  | "tree-traversal"
  | "context-traversal";

export type JavaScriptDiagnosticIntent = "inspect" | "mutate-dom";
export type JavaScriptDiagnosticRiskCode = "arbitrary-code" | "dom-mutation";

export type JavaScriptDiagnosticDraft = {
  strategy: JavaScriptDiagnosticStrategy;
  intent: JavaScriptDiagnosticIntent;
  code: string;
  risks: JavaScriptDiagnosticRiskCode[];
};

export type AttributeEditDraft = {
  attributeName: string;
  attributeValue: string;
};

export type JavaScriptDiagnosticSuggestionCode =
  | "refresh-snapshot"
  | "add-stable-constraint"
  | "avoid-dynamic-attribute"
  | "use-context-traversal"
  | "oopif-session-routing"
  | "reduce-traversal-scope";

export function isPrepareJavaScriptDiagnosticRequest(
  value: unknown
): value is PrepareJavaScriptDiagnosticRequest {
  return (
    isRecord(value) &&
    typeof value.elementId === "string" &&
    (typeof value.snapshotToken === "string" || value.snapshotToken === null) &&
    typeof value.code === "string" &&
    isJavaScriptDiagnosticStrategy(value.strategy) &&
    isJavaScriptDiagnosticIntent(value.intent)
  );
}

export function isExecuteJavaScriptDiagnosticRequest(
  value: unknown
): value is ExecuteJavaScriptDiagnosticRequest {
  return isRecord(value) && typeof value.executionId === "string" && value.executionId.trim().length > 0;
}

export function generateJavaScriptDiagnosticDraft(input: {
  element: ElementSnapshot;
  candidate: SelectorCandidate | null;
  strategy: JavaScriptDiagnosticStrategy;
}): JavaScriptDiagnosticDraft {
  const code =
    input.strategy === "dom-query"
      ? generateDomQueryCode(input.element, input.candidate)
      : input.strategy === "tree-traversal"
        ? generateTreeTraversalCode(input.element)
        : generateContextTraversalCode(input.element, input.candidate);

  return {
    strategy: input.strategy,
    intent: "inspect",
    code,
    risks: ["arbitrary-code"]
  };
}

export function generateAttributeEditDraft(edit: AttributeEditDraft): JavaScriptDiagnosticDraft {
  const attributeName = literal(edit.attributeName);
  const attributeValue = literal(edit.attributeValue);
  return {
    strategy: "dom-query",
    intent: "mutate-dom",
    code: `if (!$target?.isConnected) throw new Error("The selected element is detached.");
$target.setAttribute(${attributeName}, ${attributeValue});
return {
  tagName: $target.tagName.toLowerCase(),
  attributeName: ${attributeName},
  attributeValue: $target.getAttribute(${attributeName})
};`,
    risks: ["arbitrary-code", "dom-mutation"]
  };
}

export function getJavaScriptDiagnosticSuggestions(input: {
  element: ElementSnapshot;
  candidate: SelectorCandidate | null;
  failure?: "timeout" | "stale-target";
}): JavaScriptDiagnosticSuggestionCode[] {
  const suggestions = new Set<JavaScriptDiagnosticSuggestionCode>();
  if (input.failure === "stale-target") {
    suggestions.add("refresh-snapshot");
  }
  if (!input.candidate || !input.candidate.validation.unique) {
    suggestions.add("add-stable-constraint");
  }
  if (hasDynamicAttribute(input.element)) {
    suggestions.add("avoid-dynamic-attribute");
  }
  if ((input.element.context?.length ?? 0) > 0) {
    suggestions.add("use-context-traversal");
  }
  if (input.element.context?.some((boundary) => boundary.sessionId)) {
    suggestions.add("oopif-session-routing");
  }
  if (input.failure === "timeout") {
    suggestions.add("reduce-traversal-scope");
  }
  return [...suggestions];
}

export function validateJavaScriptDiagnosticCode(
  code: string
): { ok: true } | { ok: false; code: "empty-code" | "code-too-large" } {
  if (!code.trim()) {
    return { ok: false, code: "empty-code" };
  }
  if (code.length > JAVASCRIPT_DIAGNOSTIC_CODE_LIMIT) {
    return { ok: false, code: "code-too-large" };
  }
  return { ok: true };
}

const literal = (value: string): string => JSON.stringify(value);

function generateDomQueryCode(element: ElementSnapshot, candidate: SelectorCandidate | null): string {
  const selector = literal(getSelector(element, candidate));
  return `if (!$target?.isConnected) throw new Error("The selected element is detached.");
${SUMMARY_HELPER}
const root = $target.getRootNode();
const matches = Array.from(root.querySelectorAll(${selector}));
return matches.map(summarizeElement);`;
}

function generateTreeTraversalCode(element: ElementSnapshot): string {
  const predicates = getTraversalPredicates(element);
  return `if (!$target?.isConnected) throw new Error("The selected element is detached.");
${SUMMARY_HELPER}
const root = $target.getRootNode();
const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
const matches = [];
let node = walker.nextNode();
while (node) {
  if (${predicates}) matches.push(summarizeElement(node));
  node = walker.nextNode();
}
return matches;`;
}

function generateContextTraversalCode(element: ElementSnapshot, candidate: SelectorCandidate | null): string {
  const steps = getInSessionContext(element).map((boundary, index) => generateBoundaryStep(boundary, index));
  const selector = literal(getSelector(element, candidate));
  return `if (!$target?.isConnected) throw new Error("The selected element is detached.");
${SUMMARY_HELPER}
let root = document;
${steps.join("\n")}
const matches = Array.from(root.querySelectorAll(${selector}));
return matches.map(summarizeElement);`;
}

function generateBoundaryStep(boundary: ContextBoundary, index: number): string {
  const hostSelector = literal(serializeBoundaryHost(boundary));
  const nextRoot =
    boundary.kind === "frame"
      ? `root.querySelector(${hostSelector})?.contentDocument`
      : `root.querySelector(${hostSelector})?.shadowRoot`;
  const stepName = literal(`${boundary.kind} boundary ${index + 1}: ${boundary.hostNodeId}`);
  return `root = ${nextRoot};
if (!root) throw new Error("Unable to enter " + ${stepName});`;
}

function getSelector(element: ElementSnapshot, candidate: SelectorCandidate | null): string {
  if (candidate?.type === "css" && candidate.selector) {
    return candidate.selector;
  }

  const tagName = element.tagName?.toLowerCase() || "*";
  const attributes = Object.entries(element.attributes)
    .map(([name, value]) => `[${name}="${escapeCssAttribute(value)}"]`)
    .join("");
  return `${tagName}${attributes}`;
}

function getTraversalPredicates(element: ElementSnapshot): string {
  const predicates = [
    `node.tagName.toLowerCase() === ${literal(element.tagName?.toLowerCase() ?? element.nodeName.toLowerCase())}`,
    ...Object.entries(element.attributes).map(
      ([name, value]) => `node.getAttribute(${literal(name)}) === ${literal(value)}`
    )
  ];
  if (element.text?.trim()) {
    predicates.push(`node.textContent?.trim() === ${literal(element.text.trim())}`);
  }
  return predicates.join(" && ");
}

function getOwningSessionId(elementId: string): string | null {
  const boundary = elementId.indexOf("::");
  return boundary > 0 ? elementId.slice(0, boundary) : null;
}

function getInSessionContext(element: ElementSnapshot): ContextBoundary[] {
  const context = element.context ?? [];
  const sessionId = getOwningSessionId(element.id);
  if (!sessionId) return context;
  let owningBoundary = -1;
  for (let index = 0; index < context.length; index += 1) {
    if (context[index]?.sessionId === sessionId) owningBoundary = index;
  }
  return owningBoundary >= 0 ? context.slice(owningBoundary + 1) : context;
}

function serializeBoundaryHost(boundary: ContextBoundary): string {
  const tagName = boundary.hostTagName || "*";
  const attributes = Object.entries(boundary.hostAttributes)
    .map(([name, value]) => `[${name}="${escapeCssAttribute(value)}"]`)
    .join("");
  return `${tagName}${attributes}`;
}

function escapeCssAttribute(value: string): string {
  return Array.from(value)
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      if (codePoint === 0) return "\\uFFFD";
      if (codePoint <= 0x1f || codePoint === 0x7f) return `\\${codePoint.toString(16)} `;
      return character === "\\" || character === '"' ? `\\${character}` : character;
    })
    .join("");
}

function hasDynamicAttribute(element: ElementSnapshot): boolean {
  const id = element.attributes.id;
  if (id && looksDynamic(id)) {
    return true;
  }
  return element.attributes.class?.split(/\s+/).some(looksDynamic) ?? false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJavaScriptDiagnosticStrategy(value: unknown): value is JavaScriptDiagnosticStrategy {
  return value === "dom-query" || value === "tree-traversal" || value === "context-traversal";
}

function isJavaScriptDiagnosticIntent(value: unknown): value is JavaScriptDiagnosticIntent {
  return value === "inspect" || value === "mutate-dom";
}

function looksDynamic(value: string): boolean {
  return /[a-f0-9]{6,}/i.test(value) || /\d{5,}/.test(value) || /^[a-z]+[-_][a-f0-9]{4,}$/i.test(value);
}

const SUMMARY_HELPER = `const summarizeElement = (element) => ({
  tagName: element.tagName.toLowerCase(),
  id: element.id || null,
  text: (element.textContent || "").trim().slice(0, 200),
  attributes: Array.from(element.attributes || []).slice(0, 12).reduce((result, attribute) => {
    result[attribute.name] = attribute.value;
    return result;
  }, {})
});`;
