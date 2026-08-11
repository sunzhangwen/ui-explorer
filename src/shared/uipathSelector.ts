import type { SelectorLayer } from "./selector.js";

export type UiPathWebSelectorContext = Readonly<{
  browser?: string;
  title?: string;
  url?: string;
}>;

const UIPATH_WEBCTRL_ATTRIBUTES = new Set([
  "aaname",
  "aria-label",
  "aria-labelledby",
  "class",
  "colName",
  "href",
  "id",
  "idx",
  "innertext",
  "isleaf",
  "name",
  "parentclass",
  "parentid",
  "parentname",
  "rowName",
  "src",
  "tableCol",
  "tableRow",
  "visibleinnertext"
]);

export function buildUiPathWebSelector(
  layers: SelectorLayer[],
  context: UiPathWebSelectorContext = {}
): string {
  return layers
    .filter((layer) => layer.enabled)
    .map((layer) => buildUiPathLayerXml(layer, context))
    .join("\n");
}

export function buildUiPathLayerXml(
  layer: SelectorLayer,
  context: UiPathWebSelectorContext = {}
): string {
  if (layer.kind === "page") {
    const attributes: Array<[string, string]> = [];
    const browserApp = getUiPathBrowserApp(context.browser);
    if (browserApp) {
      attributes.push(["app", browserApp]);
    }
    if (context.title) {
      attributes.push(["title", context.title]);
    }
    if (context.url) {
      attributes.push(["url", context.url]);
    }
    return serializeUiPathNode("html", attributes);
  }

  const attributes: Array<[string, string]> = [];
  if (layer.tagEnabled) {
    attributes.push(["tag", layer.tagName.toUpperCase()]);
  }

  const cssAttributes: Array<[string, string]> = [];
  for (const attribute of layer.attributes) {
    if (!attribute.enabled) {
      continue;
    }

    if (attribute.name === "text") {
      attributes.push(["innertext", attribute.value]);
    } else if (UIPATH_WEBCTRL_ATTRIBUTES.has(attribute.name)) {
      attributes.push([attribute.name, attribute.value]);
    } else {
      cssAttributes.push([attribute.name, attribute.value]);
    }
  }

  if (cssAttributes.length > 0) {
    attributes.push([
      "css-selector",
      cssAttributes
        .map(([name, value]) => `[${cssIdentifierEscape(name)}="${cssStringEscape(value)}"]`)
        .join("")
    ]);
  }

  return serializeUiPathNode("webctrl", attributes);
}

export function formatUnavailableUiPathExport(
  diagnostics: Array<{ code: string; detail: string }>
): string {
  const comments = [
    "Selector export unavailable because the target context is inaccessible.",
    ...diagnostics.map(
      (diagnostic) => `[${diagnostic.code}] ${singleLine(diagnostic.detail)}`
    )
  ];
  return `${comments.map((comment) => `<!-- ${escapeXmlComment(comment)} -->`).join("\n")}\n`;
}

function getUiPathBrowserApp(browser: string | undefined): string | null {
  const normalized = browser?.toLowerCase() ?? "";
  if (normalized.includes("edge") || normalized.includes("edg/")) {
    return "msedge.exe";
  }
  if (normalized.includes("chrome") || normalized.includes("chromium")) {
    return "chrome.exe";
  }
  if (normalized.includes("firefox")) {
    return "firefox.exe";
  }
  return null;
}

function serializeUiPathNode(
  nodeName: "html" | "webctrl",
  attributes: Array<[string, string]>
): string {
  const serializedAttributes = attributes
    .map(([name, value]) => `${name}='${escapeXmlAttribute(value)}'`)
    .join(" ");
  return `<${nodeName}${serializedAttributes ? ` ${serializedAttributes}` : ""} />`;
}

function escapeXmlAttribute(value: string): string {
  return [...value].map((character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "'":
        return "&apos;";
      case '"':
        return "&quot;";
      case "\t":
        return "&#x9;";
      case "\n":
        return "&#xA;";
      case "\r":
        return "&#xD;";
      default:
        return isValidXmlCharacter(character) ? character : "�";
    }
  }).join("");
}

function escapeXmlComment(value: string): string {
  const safeComment = value
    .replace(/--/g, "- -")
    .replace(/-$/, "- ");
  return [...safeComment].map((character) => {
    if (character === "&") return "&amp;";
    if (character === "<") return "&lt;";
    if (character === ">") return "&gt;";
    if (["\t", "\n", "\r"].includes(character) || isValidXmlCharacter(character)) {
      return character;
    }
    return "�";
  }).join("");
}

function cssIdentifierEscape(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, (character) => `\\${character}`);
}

function cssStringEscape(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/[\r\n\f]/g, " ");
}

function isValidXmlCharacter(character: string): boolean {
  const codePoint = character.codePointAt(0) ?? 0;
  return (
    (codePoint >= 0x20 && codePoint <= 0xd7ff) ||
    (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
    (codePoint >= 0x10000 && codePoint <= 0x10ffff)
  );
}

function singleLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}
