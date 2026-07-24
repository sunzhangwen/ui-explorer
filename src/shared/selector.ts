import { findElementSnapshot, flattenElementSnapshot, getElementPath } from "./domSnapshot.js";
import type { ContextBoundary, ElementSnapshot, SnapshotDiagnostic } from "./ipc.js";

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
  kind: "page" | "frame" | "shadow" | "ancestor" | "target";
  tagName: string;
  enabled: boolean;
  tagEnabled: boolean;
  attributes: SelectorAttribute[];
  diagnostic?: SnapshotDiagnostic;
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
  boundaryAmbiguities: SelectorBoundaryAmbiguity[];
  diagnostics: SelectorRisk[];
};

export type SelectorBoundaryAmbiguity = {
  layerId: string;
  kind: "frame" | "shadow";
  parentContext: ContextBoundary[];
  parentContextCount: number;
  matchCount: number;
  blocking: boolean;
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

type BoundarySelectorMatch = {
  layerId: string;
  kind: "frame" | "shadow";
  parentContext: ContextBoundary[];
  parentContextCount: number;
  matchCount: number;
};

type BoundaryResolution = {
  contexts: ContextBoundary[][];
  seleniumContext: ContextBoundary[] | null;
  selectorMatches: BoundarySelectorMatch[];
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
const TEXT_ATTRIBUTE_NAME = "text";
const PLAYWRIGHT_DOM_ENGINE = "uiDom";
const PLAYWRIGHT_SHADOW_ENGINE = "uiShadow";
const PLAYWRIGHT_EXACT_SELECTOR_ENGINES = `// UI Explorer exact selector engines:start
type UiSelectorRoot = Document | ShadowRoot | Element;

function createUiDomSelectorEngine() {
  return {
    query(root: UiSelectorRoot, selector: string) {
      return root.querySelector(selector);
    },
    queryAll(root: UiSelectorRoot, selector: string) {
      return Array.from(root.querySelectorAll(selector));
    }
  };
}

function createUiShadowSelectorEngine() {
  const getShadowRoot = (root: UiSelectorRoot): ShadowRoot | null =>
    "shadowRoot" in root ? root.shadowRoot : null;
  return {
    query(root: UiSelectorRoot, selector: string) {
      return getShadowRoot(root)?.querySelector(selector) ?? null;
    },
    queryAll(root: UiSelectorRoot, selector: string) {
      const shadowRoot = getShadowRoot(root);
      return shadowRoot ? Array.from(shadowRoot.querySelectorAll(selector)) : [];
    }
  };
}
// UI Explorer exact selector engines:end`;

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
  const cssSelector = serializeContentCss(candidate.layers);
  const playwrightLocator = buildPlaywrightLocator(candidate.layers);
  const exactPlaywrightContext = hasContextLayers(candidate.layers);
  const seleniumStatements = buildSeleniumStatements(candidate.layers, cssSelector);
  const layerDiagnostics = candidate.layers.flatMap((layer) =>
    layer.diagnostic ? [{ layerId: layer.id, ...layer.diagnostic }] : []
  );
  const context = {
    page: candidate.layers.find((layer) => layer.kind === "page")?.enabled ?? true,
    frameChain: candidate.layers
      .filter((layer) => layer.enabled && layer.kind === "frame")
      .map(serializeBoundaryHost),
    shadowChain: candidate.layers
      .filter((layer) => layer.enabled && layer.kind === "shadow")
      .map(serializeBoundaryHost)
  };
  const json = JSON.stringify(
    {
      type: candidate.type,
      selector: candidate.selector,
      context,
      score: candidate.score,
      validation: candidate.validation,
      diagnostics: {
        validation: candidate.validation.diagnostics,
        layers: layerDiagnostics
      },
      layers: candidate.layers
    },
    null,
    2
  );
  const inaccessibleDiagnostics = layerDiagnostics.filter((diagnostic) =>
    isInaccessibleContextCode(diagnostic.code)
  );

  if (inaccessibleDiagnostics.length > 0) {
    return {
      json,
      playwright: formatUnavailableExport("//", inaccessibleDiagnostics),
      selenium: formatUnavailableExport("#", inaccessibleDiagnostics)
    };
  }

  return {
    json,
    playwright: exactPlaywrightContext
      ? `import { test as base, expect } from "@playwright/test";

${PLAYWRIGHT_EXACT_SELECTOR_ENGINES}

const test = base.extend<{}, { uiExplorerSelectors: void }>({
  uiExplorerSelectors: [
    async ({ playwright }, use) => {
      await playwright.selectors.register("${PLAYWRIGHT_DOM_ENGINE}", createUiDomSelectorEngine, { contentScript: true });
      await playwright.selectors.register("${PLAYWRIGHT_SHADOW_ENGINE}", createUiShadowSelectorEngine, { contentScript: true });
      await use();
    },
    { auto: true, scope: "worker" }
  ]
});

test("locates captured element", async ({ page }) => {
  await page.goto("https://example.com");
  const element = ${playwrightLocator};
  await expect(element).toBeVisible();
  await element.click();
});
`
      : `import { test, expect } from "@playwright/test";

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
${seleniumStatements.join("\n")}
`
  };
}

export function buildUnavailableContextExports(node: ElementSnapshot): SelectorExports {
  if (!node.diagnostic) {
    throw new Error("Unavailable context exports require a diagnostic snapshot node.");
  }

  const json = JSON.stringify(
    {
      type: "unavailable-context",
      nodeId: node.id,
      context: node.context ?? [],
      diagnostic: node.diagnostic
    },
    null,
    2
  );
  const diagnostics = [node.diagnostic];

  return {
    json,
    playwright: formatUnavailableExport("//", diagnostics),
    selenium: formatUnavailableExport("#", diagnostics)
  };
}

function buildPlaywrightLocator(layers: SelectorLayer[]): string {
  if (hasContextLayers(layers)) {
    return buildExactContextPlaywrightLocator(layers);
  }

  let locator = "page";
  let scopeKind: "page" | "frame" | "locator" = "page";

  for (const layer of layers) {
    if (!layer.enabled || (layer.kind !== "frame" && layer.kind !== "shadow")) {
      continue;
    }

    if (layer.kind === "shadow") {
      locator += `.locator(${quoteJsSingle(serializeBoundaryHost(layer))})`;
      scopeKind = "locator";
      continue;
    }

    if (scopeKind === "locator") {
      locator += `.locator(${quoteJsSingle(serializeBoundaryHost(layer))}).contentFrame()`;
    } else {
      locator += `.frameLocator(${quoteJsSingle(serializeBoundaryHost(layer))})`;
    }
    scopeKind = "frame";
  }

  const contentLayers = getEnabledContentLayers(layers);
  const targetLayer = contentLayers.filter((layer) => layer.kind === "target").at(-1) ?? contentLayers.at(-1);
  if (!targetLayer) {
    return locator;
  }

  const ancestors = contentLayers.filter((layer) => layer.kind === "ancestor");
  if (ancestors.length > 0) {
    locator += `.locator(${quoteJs(ancestors.map(serializeCssLayer).join(" > "))})`;
  }

  return locator + serializeSelector("playwright", [targetLayer]).slice("page".length);
}

function buildExactContextPlaywrightLocator(layers: SelectorLayer[]): string {
  let locator = "page";
  let scope: "dom" | "shadow" = "dom";

  for (const layer of layers) {
    if (!layer.enabled || (layer.kind !== "frame" && layer.kind !== "shadow")) {
      continue;
    }

    const engine = scope === "shadow" ? PLAYWRIGHT_SHADOW_ENGINE : PLAYWRIGHT_DOM_ENGINE;
    const selector = quoteJsSingle(`${engine}=${serializeBoundaryHost(layer)}`);
    if (layer.kind === "frame") {
      locator += `.frameLocator(${selector})`;
      scope = "dom";
    } else {
      locator += `.locator(${selector})`;
      scope = "shadow";
    }
  }

  const engine = scope === "shadow" ? PLAYWRIGHT_SHADOW_ENGINE : PLAYWRIGHT_DOM_ENGINE;
  return `${locator}.locator(${quoteJsSingle(`${engine}=${serializeContentCss(layers)}`)})`;
}

function hasContextLayers(layers: SelectorLayer[]): boolean {
  return layers.some(
    (layer) => layer.kind === "page" || layer.kind === "frame" || layer.kind === "shadow"
  );
}

function buildSeleniumStatements(layers: SelectorLayer[], cssSelector: string): string[] {
  const statements: string[] = [];
  let searchContext = "driver";
  let frameCount = 0;
  let shadowCount = 0;

  for (const layer of layers) {
    if (!layer.enabled || (layer.kind !== "frame" && layer.kind !== "shadow")) {
      continue;
    }

    const hostSelector = quotePython(serializeBoundaryHost(layer));
    if (layer.kind === "frame") {
      frameCount += 1;
      const frameVariable = numberedVariable("frame", frameCount);
      statements.push(`${frameVariable} = ${searchContext}.find_element(By.CSS_SELECTOR, ${hostSelector})`);
      statements.push(`driver.switch_to.frame(${frameVariable})`);
      searchContext = "driver";
      continue;
    }

    shadowCount += 1;
    const hostVariable = numberedVariable("shadow_host", shadowCount);
    const rootVariable = numberedVariable("shadow_root", shadowCount);
    statements.push(`${hostVariable} = ${searchContext}.find_element(By.CSS_SELECTOR, ${hostSelector})`);
    statements.push(`${rootVariable} = ${hostVariable}.shadow_root`);
    searchContext = rootVariable;
  }

  statements.push(`${searchContext}.find_element(By.CSS_SELECTOR, ${quotePython(cssSelector)}).click()`);
  return statements;
}

function serializeBoundaryHost(layer: SelectorLayer): string {
  const tag = layer.tagEnabled ? layer.tagName : "";
  const attributeSelector = layer.attributes
    .filter((attribute) => attribute.enabled && isExportableBoundaryAttribute(attribute))
    .map((attribute) => `[${attribute.name}="${cssAttributeEscape(attribute.value)}"]`)
    .join("");
  return `${tag}${attributeSelector}` || "*";
}

function serializeContentCss(layers: SelectorLayer[]): string {
  const contentLayers = getEnabledContentLayers(layers);
  const fallbackTarget = layers.find((layer) => layer.kind === "target");
  return contentLayers.map(serializeCssLayer).join(" > ") || (fallbackTarget ? serializeCssLayer(fallbackTarget) : "*");
}

function getEnabledContentLayers(layers: SelectorLayer[]): SelectorLayer[] {
  const boundaryNodeIds = new Set(
    layers
      .filter((layer) => layer.kind === "frame" || layer.kind === "shadow")
      .map((layer) => layer.nodeId)
  );
  return layers.filter(
    (layer) =>
      layer.enabled &&
      (layer.kind === "ancestor" || layer.kind === "target") &&
      !boundaryNodeIds.has(layer.nodeId)
  );
}

function numberedVariable(base: string, count: number): string {
  return count === 1 ? base : `${base}_${count}`;
}

function isInaccessibleContextCode(code: string): boolean {
  return code === "cross-origin-frame" || code === "closed-shadow-root" || code === "detached-context";
}

function formatUnavailableExport(
  commentPrefix: "//" | "#",
  diagnostics: Array<{ code: string; detail: string }>
): string {
  const detailLines = diagnostics.map(
    (diagnostic) => `${commentPrefix} [${diagnostic.code}] ${singleLine(diagnostic.detail)}`
  );
  return [
    `${commentPrefix} Selector export unavailable because the target context is inaccessible.`,
    ...detailLines,
    ""
  ].join("\n");
}

function singleLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function buildTargetLayers(root: ElementSnapshot, target: ElementSnapshot): SelectorLayer[] {
  const path = getElementPath(root, target.id);
  const hasContextMetadata =
    target.context !== undefined ||
    path.some((node) => node.kind === "page" || node.kind === "frame" || node.kind === "shadow");
  if (!hasContextMetadata) {
    return buildLegacyTargetLayers(path, target);
  }

  const page = path.find((node) => node.kind === "page");
  const boundaries = path.filter((node) => node.kind === "frame" || node.kind === "shadow");
  const boundaryHostNodeIds = new Set(
    boundaries
      .map((node) => node.context?.at(-1)?.hostNodeId)
      .filter((nodeId): nodeId is string => nodeId !== undefined)
  );
  const targetContext = target.context ?? [];
  const ordinaryAncestors = path
    .filter(
      (node) =>
        node.tagName &&
        (node.kind ?? "element") === "element" &&
        !["html", "body"].includes(node.tagName) &&
        !boundaryHostNodeIds.has(node.id) &&
        contextSignaturesMatch(node.context ?? [], targetContext)
    )
    .slice(-2);
  const ordinaryNodes = ordinaryAncestors.at(-1)?.id === target.id ? ordinaryAncestors : [...ordinaryAncestors, target];
  const layers: SelectorLayer[] = [];

  if (page) {
    layers.push(createSelectorLayer(page, "page", "page", true, true));
  }

  const boundaryCounts = { frame: 0, shadow: 0 };
  for (const boundaryNode of boundaries) {
    const kind = boundaryNode.kind;
    if (kind !== "frame" && kind !== "shadow") {
      continue;
    }

    boundaryCounts[kind] += 1;
    const boundary = boundaryNode.context?.at(-1);
    const host = boundary ? findElementSnapshot(root, boundary.hostNodeId) : null;
    if (!host?.tagName) {
      continue;
    }

    const layer = createSelectorLayer(host, kind, `${kind}-${boundaryCounts[kind]}`, true, true);
    const boundaryLayer = {
      ...layer,
      attributes: layer.attributes.filter(isExportableBoundaryAttribute)
    };
    layers.push(
      boundaryNode.diagnostic
        ? { ...boundaryLayer, diagnostic: boundaryNode.diagnostic }
        : boundaryLayer
    );
  }

  ordinaryNodes.forEach((node, index) => {
    const isTarget = node.id === target.id;
    layers.push(
      createSelectorLayer(
        node,
        isTarget ? "target" : "ancestor",
        isTarget ? "target" : `ancestor-${index + 1}`,
        isTarget,
        false
      )
    );
  });

  return layers;
}

function buildLegacyTargetLayers(path: ElementSnapshot[], target: ElementSnapshot): SelectorLayer[] {
  const ancestors = path
    .slice(0, -1)
    .filter((node) => node.tagName && node.tagName !== "html" && node.tagName !== "body")
    .slice(-2);
  const nodes = [...ancestors, target];

  return nodes.map((node, index) =>
    createSelectorLayer(
      node,
      index === nodes.length - 1 ? "target" : "ancestor",
      index === nodes.length - 1 ? "target" : `ancestor-${index + 1}`,
      index === nodes.length - 1,
      false
    )
  );
}

function createSelectorLayer(
  node: ElementSnapshot,
  kind: SelectorLayer["kind"],
  id: string,
  enabled: boolean,
  stableAttributesOnly: boolean
): SelectorLayer {
  const attributes = rankAttributes(node).filter(
    (attribute) => !stableAttributesOnly || (attribute.stable && attribute.name !== TEXT_ATTRIBUTE_NAME)
  );

  return {
    id,
    nodeId: node.id,
    kind,
    tagName: node.tagName ?? node.nodeName.toLowerCase(),
    enabled,
    tagEnabled: true,
    attributes: attributes.map((attribute, attributeIndex) => ({
      ...attribute,
      enabled: enabled && attributeIndex === 0
    })),
    diagnostic: node.diagnostic
  };
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
  const contextAware = layers.some(
    (layer) => layer.kind === "page" || layer.kind === "frame" || layer.kind === "shadow"
  );
  const boundaryResolution =
    root && contextAware ? resolveEnabledBoundaryContexts(root, layers) : null;
  const matchedElementIds = flattenElementSnapshot(root)
    .filter((node) =>
      matchesActiveTargetLayer(root, node, layers, boundaryResolution?.contexts ?? null)
    )
    .map((node) => node.id);
  const resolvedSeleniumContext = boundaryResolution?.seleniumContext;
  const seleniumMatchedElementIds =
    resolvedSeleniumContext === null
      ? []
      : flattenElementSnapshot(root)
          .filter((node) =>
            matchesActiveTargetLayer(
              root,
              node,
              layers,
              resolvedSeleniumContext ? [resolvedSeleniumContext] : null
            )
          )
          .map((node) => node.id);
  const seleniumSelectsTarget = seleniumMatchedElementIds[0] === targetId;
  const boundaryAmbiguities: SelectorBoundaryAmbiguity[] =
    boundaryResolution?.selectorMatches
      .filter((match) => match.matchCount > 1)
      .map((match) => ({
        ...match,
        blocking: match.kind === "frame" || !seleniumSelectsTarget
      })) ?? [];
  const hasBlockingBoundary = boundaryAmbiguities.some((ambiguity) => ambiguity.blocking);
  const matchCount = matchedElementIds.length;
  const status: SelectorValidationStatus = hasBlockingBoundary
    ? "multiple"
    : matchCount === 0
      ? "missing"
      : matchCount === 1
        ? "unique"
        : "multiple";
  const target = targetId ? findElementSnapshot(root, targetId) : null;
  const visible = matchedElementIds.length === 0 ? false : matchedElementIds.some((id) => findElementSnapshot(root, id)?.visible === true);
  const diagnostics: SelectorRisk[] = [];

  if (status === "missing") {
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

  const blockingBoundary = boundaryAmbiguities.find((ambiguity) => ambiguity.blocking);
  if (blockingBoundary) {
    diagnostics.push({
      code: "not-unique",
      messageKey: "selector.diagnostic.multiple",
      detail:
        blockingBoundary.kind === "frame"
          ? `Boundary layer ${blockingBoundary.layerId} matches ${blockingBoundary.matchCount} hosts ${
              blockingBoundary.parentContextCount === 1
                ? "in one parent context"
                : `across ${blockingBoundary.parentContextCount} parent contexts`
            }; Playwright frame selection is strict.`
          : `Boundary layer ${blockingBoundary.layerId} matches ${blockingBoundary.matchCount} hosts, but Selenium enters the first matching host and cannot reach the captured target.`
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
    status,
    matchCount,
    unique: status === "unique",
    visible,
    targetConsistent:
      status === "unique" &&
      matchedElementIds[0] === targetId &&
      seleniumSelectsTarget,
    matchedElementIds,
    boundaryAmbiguities,
    diagnostics
  };
}

function matchesActiveTargetLayer(
  root: ElementSnapshot | null,
  node: ElementSnapshot,
  layers: SelectorLayer[],
  resolvedContexts: ContextBoundary[][] | null
): boolean {
  if (layers.some((layer) => layer.kind === "page" || layer.kind === "frame" || layer.kind === "shadow")) {
    return matchesContextAwareTarget(root, node, layers, resolvedContexts ?? []);
  }

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

function matchesContextAwareTarget(
  root: ElementSnapshot | null,
  node: ElementSnapshot,
  layers: SelectorLayer[],
  resolvedContexts: ContextBoundary[][]
): boolean {
  if (!root || node.nodeType !== 1 || !node.tagName) {
    return false;
  }

  const pageLayer = layers.find((layer) => layer.kind === "page");
  if (pageLayer && (!pageLayer.enabled || !matchesLayer(root, pageLayer))) {
    return false;
  }

  const context = node.context ?? [];
  if (!resolvedContexts.some((resolvedContext) => contextSignaturesMatch(context, resolvedContext))) {
    return false;
  }

  const targetLayer = layers.find((layer) => layer.kind === "target");
  if (!targetLayer?.enabled || !matchesLayer(node, targetLayer)) {
    return false;
  }

  const activeAncestors = layers.filter((layer) => layer.kind === "ancestor" && layer.enabled);
  if (activeAncestors.length === 0) {
    return true;
  }

  const nodeAncestors = getElementPath(root, node.id)
    .slice(0, -1)
    .filter((ancestor) => ancestor.tagName && contextSignaturesMatch(ancestor.context ?? [], context));
  let cursor = 0;
  for (const ancestor of nodeAncestors) {
    if (cursor < activeAncestors.length && matchesLayer(ancestor, activeAncestors[cursor])) {
      cursor += 1;
    }
  }

  return cursor === activeAncestors.length;
}

function resolveEnabledBoundaryContexts(
  root: ElementSnapshot,
  layers: SelectorLayer[]
): BoundaryResolution {
  const nodes = flattenElementSnapshot(root);
  let contexts: ContextBoundary[][] = [[]];
  let seleniumContext: ContextBoundary[] | null = [];
  const selectorMatches: BoundarySelectorMatch[] = [];

  for (const layer of layers) {
    if (!layer.enabled || (layer.kind !== "frame" && layer.kind !== "shadow")) {
      continue;
    }

    const nextContexts: ContextBoundary[][] = [];
    for (const context of contexts) {
      const matchingHosts = nodes.filter(
        (node) =>
          node.nodeType === 1 &&
          node.tagName &&
          contextSignaturesMatch(node.context ?? [], context) &&
          matchesBoundaryHostLayer(node, layer)
      );
      selectorMatches.push({
        layerId: layer.id,
        kind: layer.kind,
        parentContext: context,
        parentContextCount: matchingHosts.length > 0 ? 1 : 0,
        matchCount: matchingHosts.length
      });

      for (const host of matchingHosts) {
        const boundaryContext = findBoundaryRootContext(host, layer, context);
        if (boundaryContext) {
          nextContexts.push(boundaryContext);
        }
      }
    }

    if (seleniumContext) {
      const firstSeleniumHost = nodes.find(
        (node) =>
          node.nodeType === 1 &&
          node.tagName &&
          contextSignaturesMatch(node.context ?? [], seleniumContext ?? []) &&
          matchesBoundaryHostLayer(node, layer)
      );
      seleniumContext = firstSeleniumHost
        ? findBoundaryRootContext(firstSeleniumHost, layer, seleniumContext)
        : null;
    }

    contexts = deduplicateContexts(nextContexts);
    if (contexts.length === 0) {
      break;
    }
  }

  return {
    contexts,
    seleniumContext,
    selectorMatches: aggregateBoundarySelectorMatches(selectorMatches)
  };
}

function aggregateBoundarySelectorMatches(
  matches: BoundarySelectorMatch[]
): BoundarySelectorMatch[] {
  const byLayer = new Map<string, BoundarySelectorMatch>();
  for (const match of matches) {
    const current = byLayer.get(match.layerId);
    if (!current) {
      byLayer.set(match.layerId, { ...match });
      continue;
    }

    current.parentContext = commonContextPrefix(current.parentContext, match.parentContext);
    current.parentContextCount += match.parentContextCount;
    current.matchCount += match.matchCount;
  }
  return [...byLayer.values()];
}

function commonContextPrefix(
  left: ContextBoundary[],
  right: ContextBoundary[]
): ContextBoundary[] {
  const length = Math.min(left.length, right.length);
  let index = 0;
  while (
    index < length &&
    left[index]?.kind === right[index]?.kind &&
    left[index]?.hostNodeId === right[index]?.hostNodeId
  ) {
    index += 1;
  }
  return left.slice(0, index);
}

function findBoundaryRootContext(
  host: ElementSnapshot,
  layer: SelectorLayer,
  parentContext: ContextBoundary[]
): ContextBoundary[] | null {
  const boundaryRoot = host.children.find((child) => {
    if (child.kind !== layer.kind || child.context?.length !== parentContext.length + 1) {
      return false;
    }

    const boundary = child.context.at(-1);
    return (
      contextSignaturesMatch(child.context.slice(0, -1), parentContext) &&
      boundary?.kind === layer.kind &&
      boundary.hostNodeId === host.id
    );
  });
  return boundaryRoot?.context ?? null;
}

function matchesBoundaryHostLayer(node: ElementSnapshot, layer: SelectorLayer): boolean {
  if (layer.tagEnabled && node.tagName !== layer.tagName) {
    return false;
  }

  return layer.attributes
    .filter((attribute) => attribute.enabled && isExportableBoundaryAttribute(attribute))
    .every((attribute) => node.attributes[attribute.name] === attribute.value);
}

function deduplicateContexts(contexts: ContextBoundary[][]): ContextBoundary[][] {
  const seen = new Set<string>();
  return contexts.filter((context) => {
    const signature = context
      .map((boundary) => `${boundary.kind}:${boundary.hostNodeId}`)
      .join("/");
    if (seen.has(signature)) {
      return false;
    }

    seen.add(signature);
    return true;
  });
}

function contextSignaturesMatch(left: ContextBoundary[], right: ContextBoundary[]): boolean {
  return (
    left.length === right.length &&
    left.every(
      (boundary, index) =>
        boundary.kind === right[index]?.kind && boundary.hostNodeId === right[index]?.hostNodeId
    )
  );
}

function isExportableBoundaryAttribute(attribute: SelectorAttribute): boolean {
  return attribute.name !== "role" && attribute.name !== TEXT_ATTRIBUTE_NAME;
}

function matchesLayer(node: ElementSnapshot, layer: SelectorLayer): boolean {
  if (layer.tagEnabled && node.tagName !== layer.tagName) {
    return false;
  }

  return layer.attributes
    .filter((attribute) => attribute.enabled)
    .every((attribute) => {
      if (attribute.name === TEXT_ATTRIBUTE_NAME) {
        return normalizeText(node.text) === normalizeText(attribute.value);
      }

      return node.attributes[attribute.name] === attribute.value;
    });
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

  if (node.text?.trim()) {
    attributes.push({
      name: TEXT_ATTRIBUTE_NAME,
      value: normalizeText(node.text),
      enabled: false,
      stable: true,
      score: 34
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
    const text = getEnabledAttribute(targetLayer, TEXT_ATTRIBUTE_NAME);
    const testId = getEnabledAttribute(targetLayer, "data-testid") ?? getEnabledAttribute(targetLayer, "data-test") ?? getEnabledAttribute(targetLayer, "data-cy");
    if (testId) {
      return withPlaywrightTextFilter(`page.getByTestId(${quoteJs(testId)})`, text);
    }

    const role = getEnabledAttribute(targetLayer, "role");
    if (role) {
      return `page.getByRole(${quoteJs(role)}${text && targetLayer.tagName !== "input" ? `, { name: ${quoteJs(text)} }` : ""})`;
    }

    return withPlaywrightTextFilter(`page.locator(${quoteJs(serializeSelector("css", layers))})`, text);
  }

  if (type === "xpath") {
    return `//${serializeXPathLayer(targetLayer)}`;
  }

  return activeLayers.map(serializeCssLayer).join(" > ") || serializeCssLayer(targetLayer);
}

function serializeCssLayer(layer: SelectorLayer): string {
  const tag = layer.tagEnabled ? layer.tagName : "";
  const attributes = layer.attributes
    .filter((attribute) => attribute.enabled && attribute.name !== "role" && attribute.name !== TEXT_ATTRIBUTE_NAME)
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
  const predicates = layer.attributes
    .filter((attribute) => attribute.enabled && attribute.name !== "role")
    .map((attribute) =>
      attribute.name === TEXT_ATTRIBUTE_NAME
        ? `normalize-space(.)=${quoteXPath(attribute.value)}`
        : `@${attribute.name}=${quoteXPath(attribute.value)}`
    );
  if (predicates.length === 0) {
    return tag;
  }

  return `${tag}[${predicates.join(" and ")}]`;
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

function withPlaywrightTextFilter(locator: string, text: string | null): string {
  return text ? `${locator}.filter({ hasText: ${quoteJs(text)} })` : locator;
}

function normalizeText(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
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

function quoteJsSingle(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

function quoteXPath(value: string): string {
  if (!value.includes("'")) {
    return `'${value}'`;
  }

  return `"${value.replace(/"/g, '\\"')}"`;
}

function quotePython(value: string): string {
  if (!value.includes("'")) {
    return `'${value.replace(/\\/g, "\\\\")}'`;
  }

  return JSON.stringify(value);
}

function cssEscape(value: string): string {
  const characters = Array.from(value);
  return characters
    .map((character, index) => {
      const codePoint = character.codePointAt(0) ?? 0;
      if (codePoint === 0) {
        return "\uFFFD";
      }
      if (
        isCssControl(codePoint) ||
        codePoint === 0x2028 ||
        codePoint === 0x2029 ||
        (index === 0 && isAsciiDigit(codePoint)) ||
        (index === 1 && isAsciiDigit(codePoint) && characters[0] === "-")
      ) {
        return cssHexEscape(codePoint);
      }
      if (index === 0 && character === "-" && characters.length === 1) {
        return "\\-";
      }
      if (
        codePoint >= 0x80 ||
        character === "-" ||
        character === "_" ||
        isAsciiDigit(codePoint) ||
        isAsciiLetter(codePoint)
      ) {
        return character;
      }
      return `\\${character}`;
    })
    .join("");
}

function cssAttributeEscape(value: string): string {
  return Array.from(value)
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      if (codePoint === 0) {
        return "\uFFFD";
      }
      if (isCssControl(codePoint) || codePoint === 0x2028 || codePoint === 0x2029) {
        return cssHexEscape(codePoint);
      }
      if (character === "\\" || character === '"') {
        return `\\${character}`;
      }
      return character;
    })
    .join("");
}

function cssHexEscape(codePoint: number): string {
  return `\\${codePoint.toString(16)} `;
}

function isCssControl(codePoint: number): boolean {
  return (codePoint >= 0x01 && codePoint <= 0x1f) || codePoint === 0x7f;
}

function isAsciiDigit(codePoint: number): boolean {
  return codePoint >= 0x30 && codePoint <= 0x39;
}

function isAsciiLetter(codePoint: number): boolean {
  return (codePoint >= 0x41 && codePoint <= 0x5a) || (codePoint >= 0x61 && codePoint <= 0x7a);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
