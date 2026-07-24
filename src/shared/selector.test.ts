import test from "node:test";
import assert from "node:assert/strict";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import {
  applySelectorEdit,
  buildSelectorExports,
  buildUnavailableContextExports,
  generateSelectorCandidates
} from "./selector.js";
import type { ElementSnapshot } from "./ipc.js";

const makeNode = (overrides: Partial<ElementSnapshot>): ElementSnapshot => ({
  id: "node",
  depth: 0,
  nodeType: 1,
  nodeName: "DIV",
  tagName: "div",
  attributes: {},
  childIds: [],
  children: [],
  ...overrides
});

const snapshot: ElementSnapshot = makeNode({
  id: "html",
  nodeName: "HTML",
  tagName: "html",
  childIds: ["body"],
  children: [
    makeNode({
      id: "body",
      parentId: "html",
      depth: 1,
      nodeName: "BODY",
      tagName: "body",
      childIds: ["primary", "secondary", "unstable"],
      children: [
        makeNode({
          id: "primary",
          parentId: "body",
          depth: 2,
          nodeName: "BUTTON",
          tagName: "button",
          role: "button",
          text: "Save account",
          visible: true,
          attributes: { "data-testid": "save-account", type: "button", class: "btn primary" }
        }),
        makeNode({
          id: "secondary",
          parentId: "body",
          depth: 2,
          nodeName: "BUTTON",
          tagName: "button",
          role: "button",
          text: "Save draft",
          visible: true,
          attributes: { "data-testid": "save-account", type: "button", class: "btn secondary" }
        }),
        makeNode({
          id: "unstable",
          parentId: "body",
          depth: 2,
          nodeName: "INPUT",
          tagName: "input",
          visible: true,
          attributes: { id: "input-9f8a7b6c", name: "email", placeholder: "Email" }
        })
      ]
    })
  ]
});

const frameBoundary = {
  kind: "frame" as const,
  hostNodeId: "payment-frame",
  hostTagName: "iframe",
  hostAttributes: { title: "Payment" }
};

const shadowBoundary = {
  kind: "shadow" as const,
  hostNodeId: "search-widget",
  hostTagName: "search-widget",
  hostAttributes: { "data-testid": "search-widget" }
};

const alternateFrameBoundary = {
  ...frameBoundary,
  hostNodeId: "alternate-frame"
};

const alternateShadowBoundary = {
  ...shadowBoundary,
  hostNodeId: "alternate-search-widget"
};

const alternateContextBranch = makeNode({
  id: "alternate-frame",
  parentId: "body",
  depth: 2,
  nodeName: "IFRAME",
  tagName: "iframe",
  kind: "element",
  attributes: { title: "Payment" },
  childIds: ["alternate-frame-root"],
  children: [
    makeNode({
      id: "alternate-frame-root",
      parentId: "alternate-frame",
      depth: 3,
      nodeType: 9,
      nodeName: "#document",
      tagName: undefined,
      kind: "frame",
      context: [alternateFrameBoundary],
      childIds: ["alternate-search-widget"],
      children: [
        makeNode({
          id: "alternate-search-widget",
          parentId: "alternate-frame-root",
          depth: 4,
          nodeName: "SEARCH-WIDGET",
          tagName: "search-widget",
          kind: "element",
          context: [alternateFrameBoundary],
          attributes: { "data-testid": "search-widget" },
          childIds: ["alternate-shadow-root"],
          children: [
            makeNode({
              id: "alternate-shadow-root",
              parentId: "alternate-search-widget",
              depth: 5,
              nodeType: 11,
              nodeName: "#shadow-root",
              tagName: undefined,
              kind: "shadow",
              context: [alternateFrameBoundary, alternateShadowBoundary],
              childIds: ["alternate-input"],
              children: [
                makeNode({
                  id: "alternate-input",
                  parentId: "alternate-shadow-root",
                  depth: 6,
                  nodeName: "INPUT",
                  tagName: "input",
                  kind: "element",
                  context: [alternateFrameBoundary, alternateShadowBoundary],
                  visible: true,
                  attributes: { name: "query", type: "search" }
                })
              ]
            })
          ]
        })
      ]
    })
  ]
});

const contextSnapshot: ElementSnapshot = makeNode({
  id: "page",
  nodeName: "HTML",
  tagName: "html",
  kind: "page",
  attributes: { lang: "en" },
  childIds: ["body"],
  children: [
    makeNode({
      id: "body",
      parentId: "page",
      depth: 1,
      nodeName: "BODY",
      tagName: "body",
      kind: "element",
      childIds: ["payment-frame", "alternate-frame"],
      children: [
        makeNode({
          id: "payment-frame",
          parentId: "body",
          depth: 2,
          nodeName: "IFRAME",
          tagName: "iframe",
          kind: "element",
          attributes: { title: "Payment" },
          childIds: ["payment-frame-root"],
          children: [
            makeNode({
              id: "payment-frame-root",
              parentId: "payment-frame",
              depth: 3,
              nodeType: 9,
              nodeName: "#document",
              tagName: undefined,
              kind: "frame",
              context: [frameBoundary],
              childIds: ["search-widget"],
              children: [
                makeNode({
                  id: "search-widget",
                  parentId: "payment-frame-root",
                  depth: 4,
                  nodeName: "SEARCH-WIDGET",
                  tagName: "search-widget",
                  kind: "element",
                  context: [frameBoundary],
                  attributes: { "data-testid": "search-widget" },
                  childIds: ["search-shadow-root"],
                  children: [
                    makeNode({
                      id: "search-shadow-root",
                      parentId: "search-widget",
                      depth: 5,
                      nodeType: 11,
                      nodeName: "#shadow-root",
                      tagName: undefined,
                      kind: "shadow",
                      context: [frameBoundary, shadowBoundary],
                      childIds: ["search-form"],
                      children: [
                        makeNode({
                          id: "search-form",
                          parentId: "search-shadow-root",
                          depth: 6,
                          nodeName: "FORM",
                          tagName: "form",
                          kind: "element",
                          context: [frameBoundary, shadowBoundary],
                          attributes: { "data-testid": "search-form" },
                          childIds: ["shadow-input"],
                          children: [
                            makeNode({
                              id: "shadow-input",
                              parentId: "search-form",
                              depth: 7,
                              nodeName: "INPUT",
                              tagName: "input",
                              kind: "element",
                              context: [frameBoundary, shadowBoundary],
                              visible: true,
                              attributes: { name: "query", type: "search" }
                            })
                          ]
                        })
                      ]
                    })
                  ]
                })
              ]
            })
          ]
        }),
        alternateContextBranch
      ]
    })
  ]
});

const createDirectFrameSnapshot = (title = "Direct frame"): ElementSnapshot => {
  const boundary = {
    kind: "frame" as const,
    hostNodeId: "direct-frame",
    hostTagName: "iframe",
    hostAttributes: { title }
  };

  return makeNode({
    id: "direct-frame-page",
    nodeName: "HTML",
    tagName: "html",
    kind: "page",
    childIds: ["body"],
    children: [
      makeNode({
        id: "body",
        parentId: "direct-frame-page",
        depth: 1,
        nodeName: "BODY",
        tagName: "body",
        childIds: ["direct-frame"],
        children: [
          makeNode({
            id: "direct-frame",
            parentId: "body",
            depth: 2,
            nodeName: "IFRAME",
            tagName: "iframe",
            kind: "element",
            attributes: { title },
            childIds: ["direct-frame-root"],
            children: [
              makeNode({
                id: "direct-frame-root",
                parentId: "direct-frame",
                depth: 3,
                nodeType: 9,
                nodeName: "#document",
                tagName: undefined,
                kind: "frame",
                context: [boundary],
                childIds: ["direct-frame-target"],
                children: [
                  makeNode({
                    id: "direct-frame-target",
                    parentId: "direct-frame-root",
                    depth: 4,
                    nodeName: "INPUT",
                    tagName: "input",
                    kind: "element",
                    context: [boundary],
                    visible: true,
                    attributes: { name: "direct-frame-query" }
                  })
                ]
              })
            ]
          })
        ]
      })
    ]
  });
};

const createDirectShadowSnapshot = (): ElementSnapshot => {
  const boundary = {
    kind: "shadow" as const,
    hostNodeId: "direct-shadow-host",
    hostTagName: "search-widget",
    hostAttributes: { "data-testid": "direct-shadow-host" }
  };

  return makeNode({
    id: "direct-shadow-page",
    nodeName: "HTML",
    tagName: "html",
    kind: "page",
    childIds: ["body"],
    children: [
      makeNode({
        id: "body",
        parentId: "direct-shadow-page",
        depth: 1,
        nodeName: "BODY",
        tagName: "body",
        childIds: ["direct-shadow-host"],
        children: [
          makeNode({
            id: "direct-shadow-host",
            parentId: "body",
            depth: 2,
            nodeName: "SEARCH-WIDGET",
            tagName: "search-widget",
            kind: "element",
            attributes: { "data-testid": "direct-shadow-host" },
            childIds: ["direct-shadow-root"],
            children: [
              makeNode({
                id: "direct-shadow-root",
                parentId: "direct-shadow-host",
                depth: 3,
                nodeType: 11,
                nodeName: "#shadow-root",
                tagName: undefined,
                kind: "shadow",
                context: [boundary],
                childIds: ["direct-shadow-target"],
                children: [
                  makeNode({
                    id: "direct-shadow-target",
                    parentId: "direct-shadow-root",
                    depth: 4,
                    nodeName: "INPUT",
                    tagName: "input",
                    kind: "element",
                    context: [boundary],
                    visible: true,
                    attributes: { name: "direct-shadow-query" }
                  })
                ]
              })
            ]
          })
        ]
      })
    ]
  });
};

const cloneBranchWithSuffix = (source: ElementSnapshot, suffix: string): ElementSnapshot => {
  const branchIds = new Set<string>();
  const collectIds = (node: ElementSnapshot): void => {
    branchIds.add(node.id);
    node.children.forEach(collectIds);
  };
  collectIds(source);

  const remapId = (id: string): string => (branchIds.has(id) ? `${id}-${suffix}` : id);
  const cloneNode = (node: ElementSnapshot): ElementSnapshot => ({
    ...node,
    id: remapId(node.id),
    parentId: node.parentId ? remapId(node.parentId) : undefined,
    context: node.context?.map((boundary) => ({
      ...boundary,
      hostNodeId: remapId(boundary.hostNodeId)
    })),
    childIds: node.childIds.map(remapId),
    children: node.children.map(cloneNode)
  });

  return cloneNode(source);
};

const createDuplicateFrameHostSnapshot = (): ElementSnapshot => {
  const root = createDirectFrameSnapshot();
  const body = root.children[0];
  const frameHost = body?.children[0];
  assert.ok(body);
  assert.ok(frameHost);

  const duplicate = cloneBranchWithSuffix(frameHost, "duplicate");
  body.childIds.push(duplicate.id);
  body.children.push(duplicate);
  return root;
};

const createDuplicateShadowHostSnapshot = (): ElementSnapshot => {
  const root = createDirectShadowSnapshot();
  const body = root.children[0];
  const shadowHost = body?.children[0];
  assert.ok(body);
  assert.ok(shadowHost);

  const duplicate = cloneBranchWithSuffix(shadowHost, "duplicate");
  body.childIds.push(duplicate.id);
  body.children.push(duplicate);
  return root;
};

const appendParentContextTarget = (root: ElementSnapshot, id: string, name: string): void => {
  const body = root.children[0];
  assert.ok(body);
  const target = makeNode({
    id,
    parentId: body.id,
    depth: body.depth + 1,
    nodeName: "INPUT",
    tagName: "input",
    kind: "element",
    visible: true,
    attributes: { name }
  });
  body.childIds.push(id);
  body.children.push(target);
};

const findFixtureNode = (root: ElementSnapshot, id: string): ElementSnapshot | null => {
  if (root.id === id) {
    return root;
  }

  for (const child of root.children) {
    const match = findFixtureNode(child, id);
    if (match) {
      return match;
    }
  }

  return null;
};

const appendTargetToContext = (
  parent: ElementSnapshot,
  id: string,
  name: string
): ElementSnapshot => {
  const target = makeNode({
    id,
    parentId: parent.id,
    depth: parent.depth + 1,
    nodeName: "INPUT",
    tagName: "input",
    kind: "element",
    context: parent.context ? [...parent.context] : undefined,
    visible: true,
    attributes: { name }
  });
  parent.childIds.push(id);
  parent.children.push(target);
  return target;
};

const createTwoFrameSnapshot = (): ElementSnapshot => {
  const outerBoundary = {
    kind: "frame" as const,
    hostNodeId: "outer-frame",
    hostTagName: "iframe",
    hostAttributes: { title: "Outer frame" }
  };
  const innerBoundary = {
    kind: "frame" as const,
    hostNodeId: "inner-frame",
    hostTagName: "iframe",
    hostAttributes: { title: "Inner frame" }
  };

  return makeNode({
    id: "two-frame-page",
    nodeName: "HTML",
    tagName: "html",
    kind: "page",
    childIds: ["body"],
    children: [
      makeNode({
        id: "body",
        parentId: "two-frame-page",
        depth: 1,
        nodeName: "BODY",
        tagName: "body",
        childIds: ["outer-frame"],
        children: [
          makeNode({
            id: "outer-frame",
            parentId: "body",
            depth: 2,
            nodeName: "IFRAME",
            tagName: "iframe",
            kind: "element",
            attributes: { title: "Outer frame" },
            childIds: ["outer-frame-root"],
            children: [
              makeNode({
                id: "outer-frame-root",
                parentId: "outer-frame",
                depth: 3,
                nodeType: 9,
                nodeName: "#document",
                tagName: undefined,
                kind: "frame",
                context: [outerBoundary],
                childIds: ["inner-frame"],
                children: [
                  makeNode({
                    id: "inner-frame",
                    parentId: "outer-frame-root",
                    depth: 4,
                    nodeName: "IFRAME",
                    tagName: "iframe",
                    kind: "element",
                    context: [outerBoundary],
                    attributes: { title: "Inner frame" },
                    childIds: ["inner-frame-root"],
                    children: [
                      makeNode({
                        id: "inner-frame-root",
                        parentId: "inner-frame",
                        depth: 5,
                        nodeType: 9,
                        nodeName: "#document",
                        tagName: undefined,
                        kind: "frame",
                        context: [outerBoundary, innerBoundary],
                        childIds: ["nested-frame-target"],
                        children: [
                          makeNode({
                            id: "nested-frame-target",
                            parentId: "inner-frame-root",
                            depth: 6,
                            nodeName: "INPUT",
                            tagName: "input",
                            kind: "element",
                            context: [outerBoundary, innerBoundary],
                            visible: true,
                            attributes: { name: "nested-frame-query" }
                          })
                        ]
                      })
                    ]
                  })
                ]
              })
            ]
          })
        ]
      })
    ]
  });
};

const createTwoShadowSnapshot = (): ElementSnapshot => {
  const outerBoundary = {
    kind: "shadow" as const,
    hostNodeId: "outer-shadow-host",
    hostTagName: "outer-widget",
    hostAttributes: { "data-testid": "outer-shadow-host" }
  };
  const innerBoundary = {
    kind: "shadow" as const,
    hostNodeId: "inner-shadow-host",
    hostTagName: "inner-widget",
    hostAttributes: { "data-testid": "inner-shadow-host" }
  };

  return makeNode({
    id: "two-shadow-page",
    nodeName: "HTML",
    tagName: "html",
    kind: "page",
    childIds: ["body"],
    children: [
      makeNode({
        id: "body",
        parentId: "two-shadow-page",
        depth: 1,
        nodeName: "BODY",
        tagName: "body",
        childIds: ["outer-shadow-host"],
        children: [
          makeNode({
            id: "outer-shadow-host",
            parentId: "body",
            depth: 2,
            nodeName: "OUTER-WIDGET",
            tagName: "outer-widget",
            kind: "element",
            attributes: { "data-testid": "outer-shadow-host" },
            childIds: ["outer-shadow-root"],
            children: [
              makeNode({
                id: "outer-shadow-root",
                parentId: "outer-shadow-host",
                depth: 3,
                nodeType: 11,
                nodeName: "#shadow-root",
                tagName: undefined,
                kind: "shadow",
                context: [outerBoundary],
                childIds: ["inner-shadow-host"],
                children: [
                  makeNode({
                    id: "inner-shadow-host",
                    parentId: "outer-shadow-root",
                    depth: 4,
                    nodeName: "INNER-WIDGET",
                    tagName: "inner-widget",
                    kind: "element",
                    context: [outerBoundary],
                    attributes: { "data-testid": "inner-shadow-host" },
                    childIds: ["inner-shadow-root"],
                    children: [
                      makeNode({
                        id: "inner-shadow-root",
                        parentId: "inner-shadow-host",
                        depth: 5,
                        nodeType: 11,
                        nodeName: "#shadow-root",
                        tagName: undefined,
                        kind: "shadow",
                        context: [outerBoundary, innerBoundary],
                        childIds: ["nested-shadow-target"],
                        children: [
                          makeNode({
                            id: "nested-shadow-target",
                            parentId: "inner-shadow-root",
                            depth: 6,
                            nodeName: "INPUT",
                            tagName: "input",
                            kind: "element",
                            context: [outerBoundary, innerBoundary],
                            visible: true,
                            attributes: { name: "nested-shadow-query" }
                          })
                        ]
                      })
                    ]
                  })
                ]
              })
            ]
          })
        ]
      })
    ]
  });
};

const createAlternatingBoundarySnapshot = (): ElementSnapshot => {
  const outerBoundary = {
    kind: "frame" as const,
    hostNodeId: "alternating-outer-frame",
    hostTagName: "iframe",
    hostAttributes: { title: "Alternating outer frame" }
  };
  const shadowBoundary = {
    kind: "shadow" as const,
    hostNodeId: "alternating-shadow-host",
    hostTagName: "nested-widget",
    hostAttributes: { "data-testid": "alternating-shadow-host" }
  };
  const innerBoundary = {
    kind: "frame" as const,
    hostNodeId: "alternating-inner-frame",
    hostTagName: "iframe",
    hostAttributes: { title: "Alternating inner frame" }
  };

  return makeNode({
    id: "alternating-page",
    nodeName: "HTML",
    tagName: "html",
    kind: "page",
    childIds: ["body"],
    children: [
      makeNode({
        id: "body",
        parentId: "alternating-page",
        depth: 1,
        nodeName: "BODY",
        tagName: "body",
        childIds: ["alternating-outer-frame"],
        children: [
          makeNode({
            id: "alternating-outer-frame",
            parentId: "body",
            depth: 2,
            nodeName: "IFRAME",
            tagName: "iframe",
            kind: "element",
            attributes: { title: "Alternating outer frame" },
            childIds: ["alternating-outer-root"],
            children: [
              makeNode({
                id: "alternating-outer-root",
                parentId: "alternating-outer-frame",
                depth: 3,
                nodeType: 9,
                nodeName: "#document",
                tagName: undefined,
                kind: "frame",
                context: [outerBoundary],
                childIds: ["alternating-shadow-host"],
                children: [
                  makeNode({
                    id: "alternating-shadow-host",
                    parentId: "alternating-outer-root",
                    depth: 4,
                    nodeName: "NESTED-WIDGET",
                    tagName: "nested-widget",
                    kind: "element",
                    context: [outerBoundary],
                    attributes: { "data-testid": "alternating-shadow-host" },
                    childIds: ["alternating-shadow-root"],
                    children: [
                      makeNode({
                        id: "alternating-shadow-root",
                        parentId: "alternating-shadow-host",
                        depth: 5,
                        nodeType: 11,
                        nodeName: "#shadow-root",
                        tagName: undefined,
                        kind: "shadow",
                        context: [outerBoundary, shadowBoundary],
                        childIds: ["alternating-inner-frame"],
                        children: [
                          makeNode({
                            id: "alternating-inner-frame",
                            parentId: "alternating-shadow-root",
                            depth: 6,
                            nodeName: "IFRAME",
                            tagName: "iframe",
                            kind: "element",
                            context: [outerBoundary, shadowBoundary],
                            attributes: { title: "Alternating inner frame" },
                            childIds: ["alternating-inner-root"],
                            children: [
                              makeNode({
                                id: "alternating-inner-root",
                                parentId: "alternating-inner-frame",
                                depth: 7,
                                nodeType: 9,
                                nodeName: "#document",
                                tagName: undefined,
                                kind: "frame",
                                context: [outerBoundary, shadowBoundary, innerBoundary],
                                childIds: ["alternating-target"],
                                children: [
                                  makeNode({
                                    id: "alternating-target",
                                    parentId: "alternating-inner-root",
                                    depth: 8,
                                    nodeName: "INPUT",
                                    tagName: "input",
                                    kind: "element",
                                    context: [outerBoundary, shadowBoundary, innerBoundary],
                                    visible: true,
                                    attributes: { name: "alternating-query" }
                                  })
                                ]
                              })
                            ]
                          })
                        ]
                      })
                    ]
                  })
                ]
              })
            ]
          })
        ]
      })
    ]
  });
};

const createDuplicateShadowFrameSnapshot = (): ElementSnapshot => {
  const root = createAlternatingBoundarySnapshot();
  const outerFrameRoot = findFixtureNode(root, "alternating-outer-root");
  const shadowHost = findFixtureNode(root, "alternating-shadow-host");
  assert.ok(outerFrameRoot);
  assert.ok(shadowHost);

  const duplicate = cloneBranchWithSuffix(shadowHost, "duplicate");
  const duplicateTarget = findFixtureNode(duplicate, "alternating-target-duplicate");
  assert.ok(duplicateTarget);
  duplicateTarget.attributes = {
    ...duplicateTarget.attributes,
    name: "other-alternating-query"
  };
  outerFrameRoot.childIds.push(duplicate.id);
  outerFrameRoot.children.push(duplicate);
  return root;
};

const countOccurrences = (value: string, fragment: string): number => value.split(fragment).length - 1;

type TestSelectorEngine = {
  query: (root: unknown, selector: string) => unknown;
  queryAll: (root: unknown, selector: string) => unknown[];
};

const extractPlaywrightSelectorEngine = (output: string, factoryName: string): TestSelectorEngine => {
  const startMarker = "// UI Explorer exact selector engines:start";
  const endMarker = "// UI Explorer exact selector engines:end";
  const start = output.indexOf(startMarker);
  const end = output.indexOf(endMarker);
  assert.notEqual(start, -1, "generated Playwright code should include exact selector engine definitions");
  assert.ok(end > start, "generated Playwright code should close the exact selector engine definitions");
  const source = output.slice(start + startMarker.length, end);
  const javascript = transpileModule(source, {
    compilerOptions: {
      module: ModuleKind.None,
      target: ScriptTarget.ES2022
    }
  }).outputText;
  return Function(`${javascript}\nreturn ${factoryName}();`)() as TestSelectorEngine;
};

const evaluatePythonStringLiteral = (literal: string): string => {
  const quote = literal.at(0);
  assert.ok(quote === "'" || quote === '"');
  assert.equal(literal.at(-1), quote);
  let value = "";

  for (let index = 1; index < literal.length - 1; index += 1) {
    const character = literal[index];
    if (character !== "\\") {
      value += character;
      continue;
    }

    const escaped = literal[index + 1];
    if (escaped === "\\" || escaped === "'" || escaped === '"') {
      value += escaped;
      index += 1;
    } else {
      value += character;
    }
  }

  return value;
};

test("generateSelectorCandidates creates CSS, XPath, and Playwright candidates with validation", () => {
  const candidates = generateSelectorCandidates(snapshot, "primary");

  assert.deepEqual(
    candidates.map((candidate) => candidate.type),
    ["playwright", "css", "xpath"]
  );
  assert.equal(candidates[0]?.validation.matchCount, 2);
  assert.equal(candidates[0]?.validation.status, "multiple");
  assert.match(candidates[0]?.selector ?? "", /getByTestId/);
  assert.ok((candidates[0]?.score.stability ?? 0) > 80);
});

test("generateSelectorCandidates penalizes random-looking ids and prefers stable attributes", () => {
  const candidates = generateSelectorCandidates(snapshot, "unstable");
  const css = candidates.find((candidate) => candidate.type === "css");

  assert.equal(css?.validation.status, "unique");
  assert.ok(css?.selector.includes('[name="email"]'));
  assert.ok(css?.score.risks.some((risk) => risk.code === "dynamic-id"));
});

test("applySelectorEdit recalculates selector and validation when an attribute is disabled", () => {
  const candidate = generateSelectorCandidates(snapshot, "primary").find((item) => item.type === "css");
  assert.ok(candidate);

  const edited = applySelectorEdit(snapshot, candidate, {
    layerId: "target",
    attributeName: "data-testid",
    enabled: false
  });

  assert.equal(edited.validation.status, "multiple");
  assert.equal(edited.validation.matchCount, 2);
  assert.equal(edited.selector, "button");
  assert.ok(edited.score.risks.some((risk) => risk.code === "not-unique"));
});

test("text layer attribute can make duplicate elements unique", () => {
  const candidate = generateSelectorCandidates(snapshot, "primary").find((item) => item.type === "playwright");
  assert.ok(candidate);

  const edited = applySelectorEdit(snapshot, candidate, {
    layerId: "target",
    attributeName: "text",
    enabled: true
  });

  assert.equal(edited.validation.status, "unique");
  assert.equal(edited.validation.matchCount, 1);
  assert.match(edited.selector, /hasText: "Save account"/);
});

test("xpath selector serializes enabled text attribute", () => {
  const candidate = generateSelectorCandidates(snapshot, "primary").find((item) => item.type === "xpath");
  assert.ok(candidate);

  const edited = applySelectorEdit(snapshot, candidate, {
    layerId: "target",
    attributeName: "text",
    enabled: true
  });

  assert.equal(edited.validation.status, "unique");
  assert.match(edited.selector, /normalize-space\(\.\)='Save account'/);
});

test("buildSelectorExports creates JSON, Playwright, and Selenium snippets", () => {
  const candidate = generateSelectorCandidates(snapshot, "unstable").find((item) => item.type === "css");
  assert.ok(candidate);

  const exports = buildSelectorExports(candidate);

  assert.match(exports.json, /"selector": "input\[name=\\"email\\"\]"/);
  assert.match(exports.playwright, /const element = page\.locator\("input\[name=\\\"email\\\"\]"\);/);
  assert.match(exports.playwright, /await element\.click\(\);/);
  assert.match(exports.selenium, /driver\.find_element\(By\.CSS_SELECTOR, 'input\[name="email"\]'\)\.click\(\)/);
});

test("Playwright export enters nested frames before locating shadow content", () => {
  const candidate = generateSelectorCandidates(contextSnapshot, "shadow-input").find(
    (item) => item.type === "playwright"
  );
  assert.ok(candidate);

  const output = buildSelectorExports(candidate).playwright;

  assert.match(
    output,
    /page\.frameLocator\('uiDom=iframe\[title="Payment"\]'\)\.locator\('uiDom=search-widget\[data-testid="search-widget"\]'\)\.locator\('uiShadow=input\[name="query"\]'\)/
  );
});

test("Playwright export falls back from XPath inside open shadow roots", () => {
  const candidate = generateSelectorCandidates(contextSnapshot, "shadow-input").find(
    (item) => item.type === "xpath"
  );
  assert.ok(candidate);

  const output = buildSelectorExports(candidate).playwright;

  assert.match(output, /page\.frameLocator/);
  assert.match(output, /locator\('uiShadow=input\[name="query"\]'\)/);
  assert.doesNotMatch(output, /locator\("\/\//);
});

test("Selenium export enters frames and shadow roots in order", () => {
  const candidate = generateSelectorCandidates(contextSnapshot, "shadow-input").find(
    (item) => item.type === "css"
  );
  assert.ok(candidate);

  const output = buildSelectorExports(candidate).selenium;

  assert.match(output, /driver\.switch_to\.frame/);
  assert.match(output, /shadow_root = .*\.shadow_root/);
  assert.match(output, /shadow_root\.find_element/);
  assert.ok(output.indexOf("switch_to.frame") < output.indexOf("shadow_root ="));
});

test("direct iframe child exports include the enabled frame tag without repeating the host", () => {
  const candidate = generateSelectorCandidates(createDirectFrameSnapshot(), "direct-frame-target").find(
    (item) => item.type === "css"
  );
  assert.ok(candidate);

  const output = buildSelectorExports({
    ...candidate,
    layers: candidate.layers.map((layer) => (layer.kind === "ancestor" ? { ...layer, enabled: true } : layer))
  });

  assert.equal(countOccurrences(output.playwright, 'iframe[title="Direct frame"]'), 1);
  assert.doesNotMatch(output.playwright, /\.locator\("iframe\[title=/);
  assert.equal(countOccurrences(output.selenium, 'iframe[title="Direct frame"]'), 1);
  assert.match(
    output.selenium,
    /frame = driver\.find_element\(By\.CSS_SELECTOR, 'iframe\[title="Direct frame"\]'\)\s+driver\.switch_to\.frame\(frame\)/
  );
  assert.equal(candidate.layers.some((layer) => layer.kind === "ancestor" && layer.nodeId === "direct-frame"), false);
});

test("disabling a boundary tag exports only its enabled attributes", () => {
  const root = createDirectFrameSnapshot();
  const candidate = generateSelectorCandidates(root, "direct-frame-target").find((item) => item.type === "css");
  assert.ok(candidate);
  const frame = candidate.layers.find((layer) => layer.kind === "frame");
  assert.ok(frame);

  const edited = applySelectorEdit(root, candidate, { layerId: frame.id, tagEnabled: false });
  const output = buildSelectorExports(edited);

  assert.match(output.playwright, /\.frameLocator\('uiDom=\[title="Direct frame"\]'\)/);
  assert.match(output.selenium, /By\.CSS_SELECTOR, '\[title="Direct frame"\]'/);
  assert.doesNotMatch(output.selenium, /iframe\[title="Direct frame"\]/);
});

test("boundary tag keeps an attribute collision with a non-host element out of the exported selector", () => {
  const root = createDirectFrameSnapshot();
  const body = root.children[0];
  assert.ok(body);
  body.childIds.unshift("frame-title-collision");
  body.children.unshift(
    makeNode({
      id: "frame-title-collision",
      parentId: body.id,
      depth: body.depth + 1,
      nodeName: "DIV",
      tagName: "div",
      kind: "element",
      attributes: { title: "Direct frame" }
    })
  );

  const candidate = generateSelectorCandidates(root, "direct-frame-target").find((item) => item.type === "css");
  assert.ok(candidate);

  assert.equal(candidate.validation.status, "unique");
  assert.match(buildSelectorExports(candidate).selenium, /By\.CSS_SELECTOR, 'iframe\[title="Direct frame"\]'/);
});

test("tag-disabled frame boundary reports a preceding non-host selector collision as ambiguous", () => {
  const root = createDirectFrameSnapshot();
  const body = root.children[0];
  assert.ok(body);
  body.childIds.unshift("frame-title-collision");
  body.children.unshift(
    makeNode({
      id: "frame-title-collision",
      parentId: body.id,
      depth: body.depth + 1,
      nodeName: "DIV",
      tagName: "div",
      kind: "element",
      attributes: { title: "Direct frame" }
    })
  );

  const candidate = generateSelectorCandidates(root, "direct-frame-target")[0];
  assert.ok(candidate);
  const frame = candidate.layers.find((layer) => layer.kind === "frame");
  assert.ok(frame);

  const edited = applySelectorEdit(root, candidate, { layerId: frame.id, tagEnabled: false });

  assert.equal(edited.validation.status, "multiple");
  assert.equal(edited.validation.matchCount, 1);
  assert.equal(edited.validation.unique, false);
  assert.equal(edited.validation.targetConsistent, false);
  assert.deepEqual(edited.validation.matchedElementIds, ["direct-frame-target"]);
  const validation = JSON.parse(JSON.stringify(edited.validation)) as {
    boundaryAmbiguities: Array<{ kind: string; matchCount: number; blocking: boolean }>;
  };
  assert.deepEqual(validation.boundaryAmbiguities.map(({ kind, matchCount, blocking }) => ({ kind, matchCount, blocking })), [
    {
      kind: "frame",
      matchCount: 2,
      blocking: true
    }
  ]);
});

test("tag-disabled shadow boundary reports a preceding non-host selector collision as ambiguous", () => {
  const root = createDirectShadowSnapshot();
  const body = root.children[0];
  assert.ok(body);
  body.childIds.unshift("shadow-testid-collision");
  body.children.unshift(
    makeNode({
      id: "shadow-testid-collision",
      parentId: body.id,
      depth: body.depth + 1,
      nodeName: "DIV",
      tagName: "div",
      kind: "element",
      attributes: { "data-testid": "direct-shadow-host" }
    })
  );

  const candidate = generateSelectorCandidates(root, "direct-shadow-target")[0];
  assert.ok(candidate);
  const shadow = candidate.layers.find((layer) => layer.kind === "shadow");
  assert.ok(shadow);

  const edited = applySelectorEdit(root, candidate, { layerId: shadow.id, tagEnabled: false });

  assert.equal(edited.validation.status, "multiple");
  assert.equal(edited.validation.matchCount, 1);
  assert.equal(edited.validation.unique, false);
  assert.equal(edited.validation.targetConsistent, false);
  assert.deepEqual(edited.validation.matchedElementIds, ["direct-shadow-target"]);
  const validation = JSON.parse(JSON.stringify(edited.validation)) as {
    boundaryAmbiguities: Array<{ kind: string; matchCount: number; blocking: boolean }>;
  };
  assert.deepEqual(validation.boundaryAmbiguities.map(({ kind, matchCount, blocking }) => ({ kind, matchCount, blocking })), [
    {
      kind: "shadow",
      matchCount: 2,
      blocking: true
    }
  ]);
});

test("boundary layers omit semantic role constraints that CSS exports cannot represent", () => {
  const root = createDirectShadowSnapshot();
  const host = root.children[0]?.children[0];
  const shadowRoot = host?.children[0];
  assert.ok(host);
  assert.ok(shadowRoot?.context?.[0]);
  host.role = "group";
  host.attributes = {};
  shadowRoot.context[0].hostAttributes = {};
  const target = shadowRoot.children[0];
  assert.ok(target?.context?.[0]);
  target.context[0].hostAttributes = {};

  const candidate = generateSelectorCandidates(root, "direct-shadow-target").find((item) => item.type === "css");
  assert.ok(candidate);
  const shadow = candidate.layers.find((layer) => layer.kind === "shadow");
  assert.ok(shadow);

  assert.equal(shadow.attributes.some((attribute) => attribute.name === "role"), false);
  assert.match(buildSelectorExports(candidate).selenium, /By\.CSS_SELECTOR, 'search-widget'/);
});

test("direct shadow child exports do not repeat the shadow host inside its root", () => {
  const candidate = generateSelectorCandidates(createDirectShadowSnapshot(), "direct-shadow-target").find(
    (item) => item.type === "css"
  );
  assert.ok(candidate);

  const output = buildSelectorExports({
    ...candidate,
    layers: candidate.layers.map((layer) => (layer.kind === "ancestor" ? { ...layer, enabled: true } : layer))
  });

  assert.equal(countOccurrences(output.playwright, '[data-testid="direct-shadow-host"]'), 1);
  assert.doesNotMatch(output.playwright, /\.locator\("search-widget\[data-testid=/);
  assert.equal(countOccurrences(output.selenium, '[data-testid="direct-shadow-host"]'), 1);
  assert.match(
    output.selenium,
    /shadow_root = shadow_host\.shadow_root\s+shadow_root\.find_element\(By\.CSS_SELECTOR, 'input\[name="direct-shadow-query"\]'\)/
  );
  assert.equal(
    candidate.layers.some((layer) => layer.kind === "ancestor" && layer.nodeId === "direct-shadow-host"),
    false
  );
});

test("Playwright and Selenium exports enter two nested frames in order", () => {
  const candidate = generateSelectorCandidates(createTwoFrameSnapshot(), "nested-frame-target").find(
    (item) => item.type === "css"
  );
  assert.ok(candidate);

  const output = buildSelectorExports({
    ...candidate,
    layers: candidate.layers.map((layer) => (layer.kind === "ancestor" ? { ...layer, enabled: true } : layer))
  });

  assert.match(
    output.playwright,
    /page\.frameLocator\('uiDom=iframe\[title="Outer frame"\]'\)\.frameLocator\('uiDom=iframe\[title="Inner frame"\]'\)\.locator\('uiDom=input\[name="nested-frame-query"\]'\)/
  );
  assert.equal(countOccurrences(output.playwright, 'iframe[title="Inner frame"]'), 1);
  assert.match(
    output.selenium,
    /driver\.switch_to\.frame\(frame\)\s+frame_2 = driver\.find_element\(By\.CSS_SELECTOR, 'iframe\[title="Inner frame"\]'\)\s+driver\.switch_to\.frame\(frame_2\)\s+driver\.find_element\(By\.CSS_SELECTOR, 'input\[name="nested-frame-query"\]'\)/
  );
  assert.equal(countOccurrences(output.selenium, 'iframe[title="Inner frame"]'), 1);
  assert.equal(candidate.layers.some((layer) => layer.kind === "ancestor" && layer.nodeId === "inner-frame"), false);
});

test("Playwright export uses each nested shadow boundary as executable scope", () => {
  const root = createTwoShadowSnapshot();
  const candidate = generateSelectorCandidates(root, "nested-shadow-target").find(
    (item) => item.type === "css"
  );
  assert.ok(candidate);

  const output = buildSelectorExports(candidate).playwright;

  assert.match(
    output,
    /page\.locator\('uiDom=outer-widget\[data-testid="outer-shadow-host"\]'\)\.locator\('uiShadow=inner-widget\[data-testid="inner-shadow-host"\]'\)\.locator\('uiShadow=input\[name="nested-shadow-query"\]'\)/
  );

  const innerShadow = candidate.layers.find(
    (layer) => layer.kind === "shadow" && layer.nodeId === "inner-shadow-host"
  );
  assert.ok(innerShadow);
  const edited = applySelectorEdit(root, candidate, { layerId: innerShadow.id, enabled: false });
  const editedOutput = buildSelectorExports(edited).playwright;

  assert.doesNotMatch(editedOutput, /inner-widget\[data-testid="inner-shadow-host"\]/);
  assert.match(editedOutput, /\.locator\('uiShadow=input\[name="nested-shadow-query"\]'\)/);
  assert.notEqual(editedOutput, output);
});

test("Playwright exact selector engines keep light DOM and ShadowRoot queries separate", () => {
  const candidate = generateSelectorCandidates(createDirectShadowSnapshot(), "direct-shadow-target").find(
    (item) => item.type === "css"
  );
  assert.ok(candidate);
  const output = buildSelectorExports(candidate).playwright;
  assert.ok(output.indexOf('selectors.register("uiDom"') < output.indexOf('test("locates captured element"'));
  assert.ok(output.indexOf('selectors.register("uiShadow"') < output.indexOf('test("locates captured element"'));
  assert.equal(countOccurrences(output, "{ contentScript: true }"), 2);
  assert.match(output, /\{ auto: true, scope: "worker" \}/);
  const domEngine = extractPlaywrightSelectorEngine(output, "createUiDomSelectorEngine");
  const shadowEngine = extractPlaywrightSelectorEngine(output, "createUiShadowSelectorEngine");
  const lightTarget = { id: "light-target" };
  const shadowTarget = { id: "shadow-target" };
  const nestedShadowTarget = { id: "nested-shadow-target" };
  const createRoot = (matches: Record<string, unknown[]>) => ({
    querySelector: (selector: string) => matches[selector]?.[0] ?? null,
    querySelectorAll: (selector: string) => matches[selector] ?? []
  });
  const nestedHost = {
    ...createRoot({}),
    shadowRoot: createRoot({ input: [nestedShadowTarget] })
  };
  const shadowRoot = createRoot({ input: [shadowTarget], "nested-widget": [nestedHost] });
  const host = {
    ...createRoot({ input: [lightTarget] }),
    shadowRoot
  };

  assert.deepEqual(domEngine.queryAll(host, "input"), [lightTarget]);
  assert.equal(domEngine.query(host, "input"), lightTarget);
  assert.deepEqual(shadowEngine.queryAll(host, "input"), [shadowTarget]);
  assert.equal(shadowEngine.query(host, "input"), shadowTarget);
  assert.deepEqual(shadowEngine.queryAll(nestedHost, "input"), [nestedShadowTarget]);
  assert.deepEqual(shadowEngine.queryAll(createRoot({ input: [lightTarget] }), "input"), []);
});

test("Playwright page scope does not pierce a sibling open ShadowRoot", () => {
  const root = createDirectShadowSnapshot();
  appendParentContextTarget(root, "light-dom-query", "direct-shadow-query");
  const candidate = generateSelectorCandidates(root, "light-dom-query").find((item) => item.type === "css");
  assert.ok(candidate);
  assert.equal(candidate.validation.status, "unique");

  const output = buildSelectorExports(candidate).playwright;

  assert.match(output, /createUiDomSelectorEngine/);
  assert.match(output, /const element = page\.locator\('uiDom=input\[name="direct-shadow-query"\]'\)/);
});

test("frame shadow nested frame exports keep each traversal step in its current context", () => {
  const candidate = generateSelectorCandidates(createAlternatingBoundarySnapshot(), "alternating-target").find(
    (item) => item.type === "css"
  );
  assert.ok(candidate);

  const output = buildSelectorExports({
    ...candidate,
    layers: candidate.layers.map((layer) => (layer.kind === "ancestor" ? { ...layer, enabled: true } : layer))
  });

  assert.match(
    output.playwright,
    /page\.frameLocator\('uiDom=iframe\[title="Alternating outer frame"\]'\)\.locator\('uiDom=nested-widget\[data-testid="alternating-shadow-host"\]'\)\.frameLocator\('uiShadow=iframe\[title="Alternating inner frame"\]'\)\.locator\('uiDom=input\[name="alternating-query"\]'\)/
  );
  assert.doesNotMatch(output.playwright, /\.contentFrame\(\)/);
  assert.equal(countOccurrences(output.playwright, 'iframe[title="Alternating inner frame"]'), 1);
  assert.match(
    output.selenium,
    /driver\.switch_to\.frame\(frame\)\s+shadow_host = driver\.find_element\(By\.CSS_SELECTOR, 'nested-widget\[data-testid="alternating-shadow-host"\]'\)\s+shadow_root = shadow_host\.shadow_root\s+frame_2 = shadow_root\.find_element\(By\.CSS_SELECTOR, 'iframe\[title="Alternating inner frame"\]'\)\s+driver\.switch_to\.frame\(frame_2\)\s+driver\.find_element\(By\.CSS_SELECTOR, 'input\[name="alternating-query"\]'\)/
  );
  assert.equal(countOccurrences(output.selenium, 'iframe[title="Alternating inner frame"]'), 1);
  assert.equal(
    candidate.layers.some((layer) => layer.kind === "ancestor" && layer.nodeId === "alternating-inner-frame"),
    false
  );
});

test("frame boundaries aggregate matches across duplicate shadow parent contexts", () => {
  const root = createDuplicateShadowFrameSnapshot();
  const candidate = generateSelectorCandidates(root, "alternating-target").find(
    (item) => item.type === "css"
  );
  assert.ok(candidate);

  assert.equal(candidate.validation.status, "multiple");
  assert.equal(candidate.validation.matchCount, 1);
  assert.equal(candidate.validation.unique, false);
  assert.equal(candidate.validation.targetConsistent, false);
  assert.deepEqual(candidate.validation.matchedElementIds, ["alternating-target"]);
  assert.deepEqual(
    candidate.validation.boundaryAmbiguities.map(({ kind, matchCount, blocking }) => ({
      kind,
      matchCount,
      blocking
    })),
    [
      { kind: "shadow", matchCount: 2, blocking: false },
      { kind: "frame", matchCount: 2, blocking: true }
    ]
  );
  assert.match(candidate.validation.diagnostics[0]?.detail ?? "", /frame-2.*2 hosts/i);
});

test("Selenium boundary selector Python literal preserves quotes and backslashes", () => {
  const title = String.raw`Report "Q3" \ archive`;
  const candidate = generateSelectorCandidates(createDirectFrameSnapshot(title), "direct-frame-target").find(
    (item) => item.type === "css"
  );
  assert.ok(candidate);

  const output = buildSelectorExports(candidate).selenium;
  const literal = output.match(/frame = driver\.find_element\(By\.CSS_SELECTOR, (.+)\)/)?.[1];
  assert.ok(literal);

  assert.equal(evaluatePythonStringLiteral(literal), String.raw`iframe[title="Report \"Q3\" \\ archive"]`);
});

test("boundary selector literals escape CSS controls and JavaScript line separators", () => {
  const title = "Line 1\nLine 2\r\f\u2028\u2029\u0001end";
  const candidate = generateSelectorCandidates(createDirectFrameSnapshot(title), "direct-frame-target").find(
    (item) => item.type === "css"
  );
  assert.ok(candidate);

  const output = buildSelectorExports(candidate);
  const expectedSelector = String.raw`iframe[title="Line 1\a Line 2\d \c \2028 \2029 \1 end"]`;
  assert.doesNotMatch(output.playwright, /Line 1\r?\nLine 2/);
  assert.doesNotMatch(output.selenium, /Line 1\r?\nLine 2/);
  assert.doesNotMatch(output.playwright, /[\u2028\u2029]/);
  assert.doesNotMatch(output.selenium, /[\u2028\u2029]/);

  const playwrightLiteral = output.playwright.match(/frameLocator\(([\s\S]+?)\)/)?.[1];
  const seleniumLiteral = output.selenium.match(
    /frame = driver\.find_element\(By\.CSS_SELECTOR, ([\s\S]+?)\)/
  )?.[1];
  assert.ok(playwrightLiteral);
  assert.ok(seleniumLiteral);

  assert.equal(Function(`return ${playwrightLiteral}`)(), `uiDom=${expectedSelector}`);
  assert.equal(evaluatePythonStringLiteral(seleniumLiteral), expectedSelector);
});

test("JSON export includes ordered context chains and layer diagnostics", () => {
  const candidate = generateSelectorCandidates(contextSnapshot, "shadow-input").find(
    (item) => item.type === "css"
  );
  assert.ok(candidate);

  const output = JSON.parse(buildSelectorExports(candidate).json) as {
    context: { frameChain: string[]; shadowChain: string[] };
    diagnostics: { validation: unknown[]; layers: unknown[] };
  };

  assert.deepEqual(output.context.frameChain, ['iframe[title="Payment"]']);
  assert.deepEqual(output.context.shadowChain, ['search-widget[data-testid="search-widget"]']);
  assert.deepEqual(output.diagnostics.validation, [
    {
      code: "not-unique",
      messageKey: "selector.diagnostic.multiple",
      detail: "Selector matches 2 elements."
    },
    {
      code: "not-unique",
      messageKey: "selector.diagnostic.multiple",
      detail: "Boundary layer frame-1 matches 2 hosts in one parent context; Playwright frame selection is strict."
    }
  ]);
  assert.deepEqual(output.diagnostics.layers, []);
});

test("inaccessible context diagnostics emit comments instead of runnable exports", () => {
  const candidate = generateSelectorCandidates(contextSnapshot, "shadow-input").find(
    (item) => item.type === "css"
  );
  assert.ok(candidate);
  const blockedCandidate = {
    ...candidate,
    layers: candidate.layers.map((layer) =>
      layer.kind === "frame"
        ? {
            ...layer,
            diagnostic: {
              code: "cross-origin-frame" as const,
              messageKey: "snapshot.diagnostic.crossOriginFrame",
              detail: "Cross-origin frame traversal is unavailable in this phase."
            }
          }
        : layer
    )
  };

  const output = buildSelectorExports(blockedCandidate);

  assert.match(output.playwright, /cross-origin-frame/);
  assert.doesNotMatch(output.playwright, /const element =/);
  assert.match(output.selenium, /cross-origin-frame/);
  assert.doesNotMatch(output.selenium, /find_element/);
});

test("diagnostic leaves have no selector candidates but provide non-runnable context exports", () => {
  const diagnostic = makeNode({
    id: "cross-origin-diagnostic",
    nodeType: 8,
    nodeName: "#context-unavailable",
    tagName: undefined,
    kind: "diagnostic",
    context: [frameBoundary],
    diagnostic: {
      code: "cross-origin-frame",
      messageKey: "snapshot.crossOriginFrame",
      detail: "Frame content is not accessible"
    }
  });

  assert.deepEqual(generateSelectorCandidates(diagnostic, diagnostic.id), []);

  const output = buildUnavailableContextExports(diagnostic);
  const json = JSON.parse(output.json) as {
    context: unknown;
    diagnostic: unknown;
  };

  assert.deepEqual(json.context, diagnostic.context);
  assert.deepEqual(json.diagnostic, diagnostic.diagnostic);
  assert.match(output.playwright, /cross-origin-frame/);
  assert.doesNotMatch(output.playwright, /locator|click/);
  assert.match(output.selenium, /cross-origin-frame/);
  assert.doesNotMatch(output.selenium, /find_element|click/);
});

test("an accessible host keeps runnable exports when its child is diagnostic", () => {
  const diagnostic = makeNode({
    id: "closed-shadow-diagnostic",
    parentId: "shadow-host",
    depth: 2,
    nodeType: 8,
    nodeName: "#context-unavailable",
    tagName: undefined,
    kind: "diagnostic",
    context: [shadowBoundary],
    diagnostic: {
      code: "closed-shadow-root",
      messageKey: "snapshot.closedShadowRoot",
      detail: "Closed Shadow Root content is not accessible"
    }
  });
  const host = makeNode({
    id: "shadow-host",
    parentId: "page",
    depth: 1,
    nodeName: "SEARCH-WIDGET",
    tagName: "search-widget",
    attributes: { "data-testid": "search-widget" },
    childIds: [diagnostic.id],
    children: [diagnostic]
  });
  const root = makeNode({
    id: "page",
    nodeName: "HTML",
    tagName: "html",
    kind: "page",
    childIds: [host.id],
    children: [host]
  });
  const candidate = generateSelectorCandidates(root, host.id).find((item) => item.type === "css");
  assert.ok(candidate);

  const output = buildSelectorExports(candidate);
  assert.match(output.playwright, /const element =/);
  assert.match(output.selenium, /find_element/);
});

test("snapshot boundary diagnostics propagate into blocked context exports", () => {
  const inaccessibleSnapshot = JSON.parse(JSON.stringify(contextSnapshot)) as ElementSnapshot;
  const frameRoot = inaccessibleSnapshot.children[0]?.children[0]?.children[0];
  assert.equal(frameRoot?.kind, "frame");
  frameRoot.diagnostic = {
    code: "detached-context",
    messageKey: "snapshot.diagnostic.detachedContext",
    detail: "The captured frame has been detached."
  };

  const candidate = generateSelectorCandidates(inaccessibleSnapshot, "shadow-input").find(
    (item) => item.type === "css"
  );
  assert.ok(candidate);

  const output = buildSelectorExports(candidate);

  assert.match(output.json, /detached-context/);
  assert.match(output.playwright, /detached-context/);
  assert.doesNotMatch(output.playwright, /const element =/);
});

test("candidate layers preserve page frame shadow ancestor target order", () => {
  const candidate = generateSelectorCandidates(contextSnapshot, "shadow-input")[0];

  assert.deepEqual(candidate?.layers.map((layer) => layer.kind), ["page", "frame", "shadow", "ancestor", "target"]);
});

test("disabling a frame layer recalculates context validation", () => {
  const candidate = generateSelectorCandidates(contextSnapshot, "shadow-input")[0];
  assert.ok(candidate);
  const frame = candidate.layers.find((layer) => layer.kind === "frame");
  assert.ok(frame);

  const edited = applySelectorEdit(contextSnapshot, candidate, { layerId: frame.id, enabled: false });

  assert.equal(edited.layers.find((layer) => layer.id === frame.id)?.enabled, false);
  assert.equal(edited.validation.targetConsistent, false);
});

test("duplicate frame hosts are counted by runtime-exportable boundary constraints", () => {
  const root = createDuplicateFrameHostSnapshot();
  const candidate = generateSelectorCandidates(root, "direct-frame-target")[0];
  assert.ok(candidate);

  assert.equal(candidate.validation.status, "multiple");
  assert.equal(candidate.validation.matchCount, 2);
  assert.equal(candidate.validation.targetConsistent, false);
  assert.deepEqual(candidate.validation.matchedElementIds, [
    "direct-frame-target",
    "direct-frame-target-duplicate"
  ]);
});

test("duplicate frame hosts stay ambiguous when only the second context contains the target", () => {
  const root = createDuplicateFrameHostSnapshot();
  const firstTarget = findFixtureNode(root, "direct-frame-target");
  assert.ok(firstTarget);
  firstTarget.attributes = {
    ...firstTarget.attributes,
    name: "other-frame-query"
  };

  const candidate = generateSelectorCandidates(root, "direct-frame-target-duplicate")[0];
  assert.ok(candidate);

  assert.equal(candidate.validation.status, "multiple");
  assert.equal(candidate.validation.matchCount, 1);
  assert.equal(candidate.validation.unique, false);
  assert.equal(candidate.validation.targetConsistent, false);
  assert.deepEqual(candidate.validation.matchedElementIds, ["direct-frame-target-duplicate"]);
  assert.match(candidate.validation.diagnostics[0]?.detail ?? "", /frame-1.*2 hosts/i);
});

test("duplicate shadow hosts are counted by runtime-exportable boundary constraints", () => {
  const root = createDuplicateShadowHostSnapshot();
  const candidate = generateSelectorCandidates(root, "direct-shadow-target")[0];
  assert.ok(candidate);

  assert.equal(candidate.validation.status, "multiple");
  assert.equal(candidate.validation.matchCount, 2);
  assert.equal(candidate.validation.targetConsistent, false);
  assert.deepEqual(candidate.validation.matchedElementIds, [
    "direct-shadow-target",
    "direct-shadow-target-duplicate"
  ]);
});

test("duplicate shadow hosts stay ambiguous when only the second context contains the target", () => {
  const root = createDuplicateShadowHostSnapshot();
  const firstTarget = findFixtureNode(root, "direct-shadow-target");
  assert.ok(firstTarget);
  firstTarget.attributes = {
    ...firstTarget.attributes,
    name: "other-shadow-query"
  };

  const candidate = generateSelectorCandidates(root, "direct-shadow-target-duplicate")[0];
  assert.ok(candidate);

  assert.equal(candidate.validation.status, "multiple");
  assert.equal(candidate.validation.matchCount, 1);
  assert.equal(candidate.validation.unique, false);
  assert.equal(candidate.validation.targetConsistent, false);
  assert.deepEqual(candidate.validation.matchedElementIds, ["direct-shadow-target-duplicate"]);
  assert.match(candidate.validation.diagnostics[0]?.detail ?? "", /shadow-1.*first matching host/i);
});

test("duplicate shadow hosts remain executable when only the first host contains the target", () => {
  const root = createDuplicateShadowHostSnapshot();
  const secondTarget = findFixtureNode(root, "direct-shadow-target-duplicate");
  assert.ok(secondTarget);
  secondTarget.attributes = {
    ...secondTarget.attributes,
    name: "other-shadow-query"
  };

  const candidate = generateSelectorCandidates(root, "direct-shadow-target")[0];
  assert.ok(candidate);

  assert.equal(candidate.validation.status, "unique");
  assert.equal(candidate.validation.matchCount, 1);
  assert.equal(candidate.validation.unique, true);
  assert.equal(candidate.validation.targetConsistent, true);
  assert.deepEqual(candidate.validation.matchedElementIds, ["direct-shadow-target"]);
  const validation = JSON.parse(JSON.stringify(candidate.validation)) as {
    boundaryAmbiguities: Array<{ kind: string; matchCount: number; blocking: boolean }>;
  };
  assert.deepEqual(
    validation.boundaryAmbiguities.map(({ kind, matchCount, blocking }) => ({ kind, matchCount, blocking })),
    [{ kind: "shadow", matchCount: 2, blocking: false }]
  );
});

test("disabling a shadow layer recalculates context validation", () => {
  const candidate = generateSelectorCandidates(contextSnapshot, "shadow-input")[0];
  assert.ok(candidate);
  const shadow = candidate.layers.find((layer) => layer.kind === "shadow");
  assert.ok(shadow);

  const edited = applySelectorEdit(contextSnapshot, candidate, { layerId: shadow.id, enabled: false });

  assert.equal(edited.layers.find((layer) => layer.id === shadow.id)?.enabled, false);
  assert.equal(edited.validation.targetConsistent, false);
});

test("disabling a frame boundary reports matching targets in the remaining page context", () => {
  const root = createDirectFrameSnapshot();
  appendParentContextTarget(root, "page-query", "direct-frame-query");
  const candidate = generateSelectorCandidates(root, "direct-frame-target")[0];
  assert.ok(candidate);
  const frame = candidate.layers.find((layer) => layer.kind === "frame");
  assert.ok(frame);

  const edited = applySelectorEdit(root, candidate, { layerId: frame.id, enabled: false });

  assert.equal(edited.validation.status, "unique");
  assert.deepEqual(edited.validation.matchedElementIds, ["page-query"]);
  assert.equal(edited.validation.targetConsistent, false);
});

test("disabling a shadow boundary reports matching targets in the remaining light DOM context", () => {
  const root = createDirectShadowSnapshot();
  appendParentContextTarget(root, "light-dom-query", "direct-shadow-query");
  const candidate = generateSelectorCandidates(root, "direct-shadow-target")[0];
  assert.ok(candidate);
  const shadow = candidate.layers.find((layer) => layer.kind === "shadow");
  assert.ok(shadow);

  const edited = applySelectorEdit(root, candidate, { layerId: shadow.id, enabled: false });

  assert.equal(edited.validation.status, "unique");
  assert.deepEqual(edited.validation.matchedElementIds, ["light-dom-query"]);
  assert.equal(edited.validation.targetConsistent, false);
});

test("disabling either nested frame boundary makes the original target context unreachable", () => {
  for (const disabledLayerId of ["frame-1", "frame-2"]) {
    const root = createTwoFrameSnapshot();
    const candidate = generateSelectorCandidates(root, "nested-frame-target")[0];
    assert.ok(candidate);

    const edited = applySelectorEdit(root, candidate, {
      layerId: disabledLayerId,
      enabled: false
    });

    assert.equal(edited.validation.status, "missing", disabledLayerId);
    assert.equal(edited.validation.matchCount, 0, disabledLayerId);
    assert.equal(edited.validation.targetConsistent, false, disabledLayerId);
    assert.deepEqual(edited.validation.matchedElementIds, [], disabledLayerId);
  }
});

test("disabling an inner frame resolves target matching from the nearest enabled frame context", () => {
  const root = createTwoFrameSnapshot();
  const outerFrameRoot = findFixtureNode(root, "outer-frame-root");
  assert.ok(outerFrameRoot);
  appendTargetToContext(
    outerFrameRoot,
    "outer-frame-fallback-target",
    "nested-frame-query"
  );
  const candidate = generateSelectorCandidates(root, "nested-frame-target")[0];
  assert.ok(candidate);

  const edited = applySelectorEdit(root, candidate, {
    layerId: "frame-2",
    enabled: false
  });

  assert.equal(edited.validation.status, "unique");
  assert.deepEqual(edited.validation.matchedElementIds, ["outer-frame-fallback-target"]);
  assert.equal(edited.validation.targetConsistent, false);
});

test("disabling either nested shadow boundary makes the original target context unreachable", () => {
  for (const disabledLayerId of ["shadow-1", "shadow-2"]) {
    const root = createTwoShadowSnapshot();
    const candidate = generateSelectorCandidates(root, "nested-shadow-target")[0];
    assert.ok(candidate);

    const edited = applySelectorEdit(root, candidate, {
      layerId: disabledLayerId,
      enabled: false
    });

    assert.equal(edited.validation.status, "missing", disabledLayerId);
    assert.equal(edited.validation.matchCount, 0, disabledLayerId);
    assert.equal(edited.validation.targetConsistent, false, disabledLayerId);
    assert.deepEqual(edited.validation.matchedElementIds, [], disabledLayerId);
  }
});

test("disabling an inner shadow resolves target matching from the nearest enabled shadow context", () => {
  const root = createTwoShadowSnapshot();
  const outerShadowRoot = findFixtureNode(root, "outer-shadow-root");
  assert.ok(outerShadowRoot);
  appendTargetToContext(
    outerShadowRoot,
    "outer-shadow-fallback-target",
    "nested-shadow-query"
  );
  const candidate = generateSelectorCandidates(root, "nested-shadow-target")[0];
  assert.ok(candidate);

  const edited = applySelectorEdit(root, candidate, {
    layerId: "shadow-2",
    enabled: false
  });

  assert.equal(edited.validation.status, "unique");
  assert.deepEqual(edited.validation.matchedElementIds, ["outer-shadow-fallback-target"]);
  assert.equal(edited.validation.targetConsistent, false);
});

test("disabling any frame-shadow-frame boundary makes later traversal resolve from the last enabled context", () => {
  for (const disabledLayerId of ["frame-1", "shadow-1", "frame-2"]) {
    const root = createAlternatingBoundarySnapshot();
    const candidate = generateSelectorCandidates(root, "alternating-target")[0];
    assert.ok(candidate);

    const edited = applySelectorEdit(root, candidate, {
      layerId: disabledLayerId,
      enabled: false
    });

    assert.equal(edited.validation.status, "missing", disabledLayerId);
    assert.equal(edited.validation.matchCount, 0, disabledLayerId);
    assert.equal(edited.validation.targetConsistent, false, disabledLayerId);
    assert.deepEqual(edited.validation.matchedElementIds, [], disabledLayerId);
  }
});
