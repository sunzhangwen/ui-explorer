import { findElementSnapshot, flattenElementSnapshot } from "./domSnapshot.js";
import type { ElementSnapshot } from "./ipc.js";

export type AttributeLocatorMarker = "unique" | "stable" | "dynamic";

export type ElementAttributeInsight = {
  name: string;
  value: string;
  matchCount: number;
  markers: AttributeLocatorMarker[];
};

const STABLE_ATTRIBUTE_NAMES = new Set([
  "data-testid",
  "data-test",
  "data-cy",
  "data-qa",
  "aria-label",
  "name"
]);

export function analyzeElementAttributes(
  root: ElementSnapshot | null,
  elementId: string | null,
  query: string
): ElementAttributeInsight[] {
  const element = elementId ? findElementSnapshot(root, elementId) : null;
  if (!element) {
    return [];
  }

  const normalizedQuery = query.trim().toLowerCase();
  const elements = flattenElementSnapshot(root).filter((node) => node.nodeType === 1);
  return Object.entries(element.attributes)
    .filter(
      ([name, value]) =>
        !normalizedQuery ||
        name.toLowerCase().includes(normalizedQuery) ||
        value.toLowerCase().includes(normalizedQuery)
    )
    .map(([name, value]) => {
      const matchCount = elements.filter((node) => node.attributes[name] === value).length;
      const markers: AttributeLocatorMarker[] = [];
      if (matchCount === 1) {
        markers.push("unique");
      }
      if (STABLE_ATTRIBUTE_NAMES.has(name)) {
        markers.push("stable");
      }
      if (isDynamicAttribute(name, value)) {
        markers.push("dynamic");
      }
      return { name, value, matchCount, markers };
    });
}

function isDynamicAttribute(name: string, value: string): boolean {
  if (name !== "id" && name !== "class") {
    return false;
  }
  return (
    /\d{8,}/.test(value) ||
    /(?:^|[-_])[a-f0-9]{10,}(?:$|[-_])/i.test(value) ||
    /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value)
  );
}
