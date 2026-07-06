import { findElementSnapshot, flattenElementSnapshot } from "./domSnapshot.js";
import type { ElementSnapshot } from "./ipc.js";

export type SelectorType = "css" | "xpath" | "playwright";
export type SelectorValidationStatus = "missing" | "unique" | "multiple";
export type SelectorRiskCode = "dynamic-id" | "index-path" | "not-unique" | "not-visible" | "low-signal";

export type SelectorRisk = {
  code: SelectorRiskCode;
  messageKey: string;
  detail: string;
};

export type SelectorAttribute = {
  name: string;
  value: string;
  enabled: boolean;
  stable: boolean;
  score: number;
};

export type SelectorLayer = {
  id: string;
  nodeId: string;
  kind: "ancestor" | "target";
  tagName: string;
  enabled: boolean;
  tagEnabled: boolean;
  attributes: SelectorAttribute[];
};

export type SelectorScore = {
  unique: number;
  stability: number;
  readability: number;
  total: number;
  risks: SelectorRisk[];
};

export type SelectorValidation = {
  status: SelectorValidationStatus;
  matchCount: number;
  unique: boolean;
  visible: boolean;
  targetConsistent: boolean;
  matchedElementIds: string[];
  diagnostics: SelectorRisk[];
};

export type SelectorCandidate = {
  id: string;
  type: SelectorType;
  label: string;
  selector: string;
  layers: SelectorLayer[];
  score: SelectorScore;
  validation: SelectorValidation;
};

export type SelectorExports = {
  json: string;
  playwright: string;
  selenium: string;
};

export type SelectorEdit =
  | {
      layerId: string;
      enabled: boolean;
    }
  | {
      layerId: string;
      tagEnabled: boolean;
    }
  | {
      layerId: string;
      attributeName: string;
      enabled: boolean;
    }
  | {
      layerId: string;
      attributeName: string;
      value: string;
    };

const HIGH_VALUE_ATTRIBUTES = ["data-testid", "data-test", "data-cy", "aria-label"] as const;
const MEDIUM_VALUE_ATTRIBUTES = ["name", "placeholder", "title", "type"] as const;

export function generateSelectorCandidates(root: ElementSnapshot | null, targetId: string | null): SelectorCandidate[] {
  if (!root || !targetId) {
    return [];
  }

  const target = findElementSnapshot(root, targetId);
  if (!target?.tagName) {
    return [];
  }

  const layers = buildTargetLayers(root, target);
  return (["playwright", "css", "xpath"] as const).map((type) => createCandidate(root, target.id, type, layers));
}

export function applySelectorEdit(
  root: ElementSnapshot | null,
  candidate: SelectorCandidate,
  edit: SelectorEdit
): SelectorCandidate {
  const layers = candidate.layers.map((layer) => {
    if (layer.id !== edit.layerId) {
      return layer;
    }

    if ("attributeName" in edit) {
      return {
        ...layer,
        attributes: layer.attributes.map((attribute) => {
          if (attribute.name !== edit.attributeName) {
            return attribute;
          }

          if ("value" in edit) {
            return { ...attribute, value: edit.value };
          }

          return { ...attribute, enabled: edit.enabled };
        })
      };
    }

    if ("tagEnabled" in edit) {
      return { ...layer, tagEnabled: edit.tagEnabled };
    }

    return { ...layer, enabled: edit.enabled };
  });

  const targetLayer = layers.find((layer) => layer.kind === "target");
  return createCandidate(root, targetLayer?.nodeId ?? "", candidate.type, layers);
}

export function buildSelectorExports(candidate: SelectorCandidate): SelectorExports {
  const cssSelector = candidate.type === "css" ? candidate.selector : serializeSelector("css", candidate.layers);
  const playwrightLocator =
    candidate.type === "playwright" ? candidate.selector.replace(/^page\./, "page.") : `page.locator(${JSON.stringify(cssSelector)})`;

  return {
    json: JSON.stringify(
      {
        type: candidate.type,
        selector: candidate.selector,
        score: candidate.score,
        validation: candidate.validation,
        layers: candidate.layers
      },
      null,
      2
    ),
    playwright: `import { test, expect } from "@playwright/test";

test("locates captured element", async ({ page }) => {
  await page.goto("https://example.com");
  const element = ${playwrightLocator};
  await expect(element).toBeVisible();
  await element.click();
});
`,
    selenium: `from selenium import webdriver
from selenium.webdriver.common.by import By

driver = webdriver.Chrome()
driver.get("https://example.com")
driver.find_element(By.CSS_SELECTOR, ${quotePython(cssSelector)}).click()
`
  };
}

function buildTargetLayers(root: ElementSnapshot, target: ElementSnapshot): SelectorLayer[] {
  const ancestors = getAncestorChain(root, target.id)
    .filter((node) => node.tagName && node.tagName !== "html" && node.tagName !== "body")
    .slice(-2);
  const nodes = [...ancestors, target];

  return nodes.map((node, index) => ({
    id: index === nodes.length - 1 ? "target" : `ancestor-${index + 1}`,
    nodeId: node.id,
    kind: index === nodes.length - 1 ? "target" : "ancestor",
    tagName: node.tagName ?? node.nodeName.toLowerCase(),
    enabled: index === nodes.length - 1,
    tagEnabled: true,
    attributes: rankAttributes(node).map((attribute, attributeIndex) => ({
      ...attribute,
      enabled: index === nodes.length - 1 && attributeIndex === 0
    }))
  }));
}

function createCandidate(
  root: ElementSnapshot | null,
  targetId: string,
  type: SelectorType,
  layers: SelectorLayer[]
): SelectorCandidate {
  const selector = serializeSelector(type, layers);
  const validation = validateSelector(root, targetId, layers);
  const score = scoreSelector(layers, validation);

  return {
    id: type,
    type,
    label: selectorLabel(type),
    selector,
    layers,
    score,
    validation
  };
}

function validateSelector(
  root: ElementSnapshot | null,
  targetId: string,
  layers: SelectorLayer[]
): SelectorValidation {
  const matchedElementIds = flattenElementSnapshot(root)
    .filter((node) => matchesActiveTargetLayer(root, node, layers))
    .map((node) => node.id);
  const matchCount = matchedElementIds.length;
  const target = targetId ? findElementSnapshot(root, targetId) : null;
  const visible = matchedElementIds.length === 0 ? false : matchedElementIds.some((id) => findElementSnapshot(root, id)?.visible === true);
  const diagnostics: SelectorRisk[] = [];

  if (matchCount === 0) {
    diagnostics.push({
      code: "low-signal",
      messageKey: "selector.diagnostic.missing",
      detail: "Selector does not match any element in the current snapshot."
    });
  }

  if (matchCount > 1) {
    diagnostics.push({
      code: "not-unique",
      messageKey: "selector.diagnostic.multiple",
      detail: `Selector matches ${matchCount} elements.`
    });
  }

  if (target && target.visible === false) {
    diagnostics.push({
      code: "not-visible",
      messageKey: "selector.diagnostic.hidden",
      detail: "The captured element is currently hidden."
    });
  }

  return {
    status: matchCount === 0 ? "missing" : matchCount === 1 ? "unique" : "multiple",
    matchCount,
    unique: matchCount === 1,
    visible,
    targetConsistent: matchedElementIds.includes(targetId),
    matchedElementIds,
    diagnostics
  };
}

function matchesActiveTargetLayer(root: ElementSnapshot | null, node: ElementSnapshot, layers: SelectorLayer[]): boolean {
  const activeLayers = layers.filter((layer) => layer.enabled);
  const targetLayer = activeLayers.at(-1);
  if (!targetLayer || node.nodeType !== 1 || !node.tagName) {
    return false;
  }

  if (!matchesLayer(node, targetLayer)) {
    return false;
  }

  const activeAncestors = activeLayers.slice(0, -1);
  if (activeAncestors.length === 0) {
    return true;
  }

  const nodeAncestors = root ? getAncestorChain(root, node.id) : [];
  let cursor = 0;
  for (const ancestor of nodeAncestors) {
    if (cursor < activeAncestors.length && matchesLayer(ancestor, activeAncestors[cursor])) {
      cursor += 1;
    }
  }

  return cursor === activeAncestors.length;
}

function matchesLayer(node: ElementSnapshot, layer: SelectorLayer): boolean {
  if (layer.tagEnabled && node.tagName !== layer.tagName) {
    return false;
  }

  return layer.attributes
    .filter((attribute) => attribute.enabled)
    .every((attribute) => node.attributes[attribute.name] === attribute.value);
}

function scoreSelector(layers: SelectorLayer[], validation: SelectorValidation): SelectorScore {
  const risks = [...validation.diagnostics, ...collectAttributeRisks(layers)];
  const activeLayers = layers.filter((layer) => layer.enabled);
  const enabledAttributes = activeLayers.flatMap((layer) => layer.attributes.filter((attribute) => attribute.enabled));
  const unique = validation.unique ? 100 : validation.matchCount === 0 ? 0 : 42;
  const stability = clamp(
    Math.round(45 + enabledAttributes.reduce((total, attribute) => total + attribute.score, 0) - risks.length * 8),
    0,
    100
  );
  const readability = clamp(96 - Math.max(0, activeLayers.length - 1) * 10 - Math.max(0, enabledAttributes.length - 1) * 4, 0, 100);

  return {
    unique,
    stability,
    readability,
    total: Math.round(unique * 0.42 + stability * 0.38 + readability * 0.2),
    risks
  };
}

function collectAttributeRisks(layers: SelectorLayer[]): SelectorRisk[] {
  return layers.flatMap((layer) =>
    layer.attributes
      .filter((attribute) => !attribute.stable)
      .map((attribute) => ({
        code: attribute.name === "id" ? "dynamic-id" : "low-signal",
        messageKey: attribute.name === "id" ? "selector.risk.dynamicId" : "selector.risk.lowSignal",
        detail: `${attribute.name}="${attribute.value}" may be unstable.`
      }))
  );
}

function rankAttributes(node: ElementSnapshot): SelectorAttribute[] {
  const attributes = Object.entries(node.attributes)
    .map(([name, value]) => ({
      name,
      value,
      enabled: false,
      stable: isStableAttribute(name, value),
      score: attributeScore(name, value)
    }))
    .filter((attribute) => attribute.score > 0)
    .sort((left, right) => right.score - left.score);

  if (node.role) {
    attributes.push({
      name: "role",
      value: node.role,
      enabled: false,
      stable: true,
      score: 28
    });
  }

  return attributes;
}

function serializeSelector(type: SelectorType, layers: SelectorLayer[]): string {
  const activeLayers = layers.filter((layer) => layer.enabled);
  const targetLayer = activeLayers.at(-1) ?? layers.find((layer) => layer.kind === "target");
  if (!targetLayer) {
    return "";
  }

  if (type === "playwright") {
    const testId = getEnabledAttribute(targetLayer, "data-testid") ?? getEnabledAttribute(targetLayer, "data-test") ?? getEnabledAttribute(targetLayer, "data-cy");
    if (testId) {
      return `page.getByTestId(${quoteJs(testId)})`;
    }

    const role = getEnabledAttribute(targetLayer, "role");
    if (role) {
      return `page.getByRole(${quoteJs(role)}${targetLayer.tagName === "input" ? "" : `, { name: ${quoteJs("")} }`})`;
    }

    return `page.locator(${quoteJs(serializeSelector("css", layers))})`;
  }

  if (type === "xpath") {
    return `//${serializeXPathLayer(targetLayer)}`;
  }

  return activeLayers.map(serializeCssLayer).join(" > ") || serializeCssLayer(targetLayer);
}

function serializeCssLayer(layer: SelectorLayer): string {
  const tag = layer.tagEnabled ? layer.tagName : "";
  const attributes = layer.attributes
    .filter((attribute) => attribute.enabled && attribute.name !== "role")
    .map((attribute) => {
      if (attribute.name === "id" && attribute.stable) {
        return `#${cssEscape(attribute.value)}`;
      }
      return `[${attribute.name}="${cssAttributeEscape(attribute.value)}"]`;
    });

  return `${tag}${attributes.join("")}` || "*";
}

function serializeXPathLayer(layer: SelectorLayer): string {
  const tag = layer.tagEnabled ? layer.tagName : "*";
  const attributes = layer.attributes.filter((attribute) => attribute.enabled && attribute.name !== "role");
  if (attributes.length === 0) {
    return tag;
  }

  return `${tag}[${attributes.map((attribute) => `@${attribute.name}=${quoteXPath(attribute.value)}`).join(" and ")}]`;
}

function getAncestorChain(root: ElementSnapshot, targetId: string): ElementSnapshot[] {
  const path: ElementSnapshot[] = [];
  const visit = (node: ElementSnapshot): boolean => {
    if (node.id === targetId) {
      return true;
    }

    for (const child of node.children) {
      if (visit(child)) {
        path.unshift(node);
        return true;
      }
    }

    return false;
  };

  visit(root);
  return path;
}

function getEnabledAttribute(layer: SelectorLayer, name: string): string | null {
  return layer.attributes.find((attribute) => attribute.enabled && attribute.name === name)?.value ?? null;
}

function isStableAttribute(name: string, value: string): boolean {
  if (HIGH_VALUE_ATTRIBUTES.includes(name as (typeof HIGH_VALUE_ATTRIBUTES)[number])) {
    return true;
  }

  if (MEDIUM_VALUE_ATTRIBUTES.includes(name as (typeof MEDIUM_VALUE_ATTRIBUTES)[number])) {
    return true;
  }

  if (name === "id") {
    return !looksDynamic(value);
  }

  if (name === "class") {
    return value.split(/\s+/).some((token) => token.length > 3 && !looksDynamic(token));
  }

  return false;
}

function attributeScore(name: string, value: string): number {
  if (HIGH_VALUE_ATTRIBUTES.includes(name as (typeof HIGH_VALUE_ATTRIBUTES)[number])) {
    return 52;
  }

  if (name === "id") {
    return looksDynamic(value) ? 6 : 46;
  }

  if (MEDIUM_VALUE_ATTRIBUTES.includes(name as (typeof MEDIUM_VALUE_ATTRIBUTES)[number])) {
    return 30;
  }

  if (name === "class" && isStableAttribute(name, value)) {
    return 18;
  }

  return 0;
}

function looksDynamic(value: string): boolean {
  return /[a-f0-9]{6,}/i.test(value) || /\d{5,}/.test(value) || /^[a-z]+[-_][a-f0-9]{4,}$/i.test(value);
}

function selectorLabel(type: SelectorType): string {
  if (type === "css") {
    return "CSS";
  }

  if (type === "xpath") {
    return "XPath";
  }

  return "Playwright";
}

function quoteJs(value: string): string {
  return JSON.stringify(value);
}

function quoteXPath(value: string): string {
  if (!value.includes("'")) {
    return `'${value}'`;
  }

  return `"${value.replace(/"/g, '\\"')}"`;
}

function quotePython(value: string): string {
  if (!value.includes("'")) {
    return `'${value}'`;
  }

  return JSON.stringify(value);
}

function cssEscape(value: string): string {
  return value.replace(/([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, "\\$1");
}

function cssAttributeEscape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
