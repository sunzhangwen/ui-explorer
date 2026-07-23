export const SNAPSHOT_SCRIPT = `(() => {
  const registry = new Map();
  const elementIds = new WeakMap();
  const elementContexts = new Map();
  const documents = new Set([document]);
  let sequence = 0;

  const isElement = (node) => node?.nodeType === Node.ELEMENT_NODE;
  const isShadowRoot = (node) => node?.nodeType === Node.DOCUMENT_FRAGMENT_NODE && Boolean(node.host);
  const isFrame = (node) => isElement(node) && node.tagName?.toLowerCase() === "iframe";
  const readAttributes = (element) => {
    const attributes = {};
    for (const attribute of Array.from(element.attributes || [])) {
      attributes[attribute.name] = attribute.value;
    }
    return attributes;
  };
  const copyContext = (context) => context.map((boundary) => ({
    ...boundary,
    hostAttributes: { ...boundary.hostAttributes }
  }));
  const roleFor = (element) => element.getAttribute?.("role") || element.getAttribute?.("aria-role") || "";
  const visibleFor = (element) => {
    if (!isElement(element)) {
      return undefined;
    }
    const rect = element.getBoundingClientRect();
    const view = element.ownerDocument?.defaultView || window;
    const style = view.getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  };
  const boxFor = (element) => {
    if (!isElement(element)) {
      return undefined;
    }
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  };
  const textFor = (node) => {
    if (!isElement(node)) {
      return node.nodeValue?.trim().slice(0, 160) || "";
    }
    return Array.from(node.childNodes)
      .filter((child) => child.nodeType === Node.TEXT_NODE)
      .map((child) => child.nodeValue?.trim() || "")
      .filter(Boolean)
      .join(" ")
      .slice(0, 160);
  };
  const frameBoundaryFor = (host, hostNodeId) => ({
    kind: "frame",
    hostNodeId,
    hostTagName: host.tagName.toLowerCase(),
    hostAttributes: readAttributes(host)
  });
  const shadowBoundaryFor = (host, hostNodeId) => ({
    kind: "shadow",
    hostNodeId,
    hostTagName: host.tagName.toLowerCase(),
    hostAttributes: readAttributes(host)
  });
  const diagnosticNode = (parentId, depth, context, code, messageKey, detail) => {
    const id = "n-" + (++sequence);
    return {
      id,
      parentId,
      depth,
      nodeType: 8,
      nodeName: "#context-unavailable",
      text: detail,
      kind: "diagnostic",
      context: copyContext(context),
      diagnostic: { code, messageKey, detail },
      attributes: {},
      childIds: [],
      children: []
    };
  };

  const walk = (node, depth, parentId, context, kind = "element", runtimeContexts = []) => {
    const id = "n-" + (++sequence);
    registry.set(id, node);
    elementIds.set(node, id);
    elementContexts.set(id, runtimeContexts.slice());
    if (node.nodeType === Node.DOCUMENT_NODE) {
      documents.add(node);
    } else if (node.ownerDocument) {
      documents.add(node.ownerDocument);
    }

    const children = [];
    const base = {
      id,
      parentId,
      depth,
      nodeType: node.nodeType,
      nodeName: isShadowRoot(node) ? "#shadow-root" : node.nodeName,
      tagName: isElement(node) ? node.tagName.toLowerCase() : undefined,
      nodeValue: node.nodeType === Node.TEXT_NODE ? node.nodeValue || "" : undefined,
      text: textFor(node),
      role: isElement(node) ? roleFor(node) : undefined,
      visible: isElement(node) ? visibleFor(node) : undefined,
      boundingBox: isElement(node) ? boxFor(node) : undefined,
      kind,
      context: copyContext(context),
      attributes: isElement(node) ? readAttributes(node) : {},
      childIds: [],
      children
    };

    const sourceChildren = Array.from(node.childNodes || []).filter((child) => child.nodeType === Node.ELEMENT_NODE);
    for (const child of sourceChildren) {
      children.push(walk(child, depth + 1, id, context, "element", runtimeContexts));
    }

    if (isFrame(node)) {
      const frameContext = [...context, frameBoundaryFor(node, id)];
      try {
        const frameDocument = node.contentDocument;
        if (frameDocument) {
          documents.add(frameDocument);
          children.push(walk(
            frameDocument,
            depth + 1,
            id,
            frameContext,
            "frame",
            [...runtimeContexts, { kind: "frame", host: node, root: frameDocument }]
          ));
        } else {
          children.push(diagnosticNode(
            id,
            depth + 1,
            frameContext,
            "cross-origin-frame",
            "snapshot.crossOriginFrame",
            "Frame content is not accessible"
          ));
        }
      } catch (error) {
        children.push(diagnosticNode(
          id,
          depth + 1,
          frameContext,
          "cross-origin-frame",
          "snapshot.crossOriginFrame",
          error instanceof Error ? error.message : "Frame content is not accessible"
        ));
      }
    }

    if (isElement(node) && node.shadowRoot) {
      const shadowContext = [...context, shadowBoundaryFor(node, id)];
      children.push(walk(
        node.shadowRoot,
        depth + 1,
        id,
        shadowContext,
        "shadow",
        [...runtimeContexts, { kind: "shadow", host: node, root: node.shadowRoot }]
      ));
    }

    if (isElement(node) && node.hasAttribute("data-ui-explorer-closed-shadow")) {
      const shadowContext = [...context, shadowBoundaryFor(node, id)];
      children.push(diagnosticNode(
        id,
        depth + 1,
        shadowContext,
        "closed-shadow-root",
        "snapshot.closedShadowRoot",
        "Closed Shadow Root content is not accessible"
      ));
    }

    base.childIds = children.map((child) => child.id);
    return base;
  };

  const root = document.documentElement ? walk(document.documentElement, 0, undefined, [], "page") : null;
  window.__uiExplorerElements = registry;
  window.__uiExplorerElementIds = elementIds;
  window.__uiExplorerElementContexts = elementContexts;
  window.__uiExplorerDocuments = documents;
  window.__uiExplorerPickedElementId = null;
  return { root, capturedAt: new Date().toISOString(), nodeCount: sequence };
})()`;

export const HIGHLIGHT_SCRIPT = `(() => {
  const elementIds = __ELEMENT_IDS__;
  const registry = window.__uiExplorerElements;
  const elementContexts = window.__uiExplorerElementContexts || new Map();
  const documents = window.__uiExplorerDocuments || new Set([document]);
  const targets = [];
  const detached = (elementId, detail) => ({
    elementId,
    status: "detached",
    diagnostic: {
      code: "detached-context",
      messageKey: "snapshot.diagnostic.detachedContext",
      detail
    }
  });
  const belongsToRoot = (node, root) => {
    if (!node || !root || typeof node.getRootNode !== "function") {
      return false;
    }
    const rootDocument = root.nodeType === Node.DOCUMENT_NODE ? root : root.ownerDocument;
    return node.getRootNode() === root && node.ownerDocument === rootDocument;
  };
  const detachedDetail = (target, contexts) => {
    if (!target || target.nodeType !== Node.ELEMENT_NODE) {
      return "Captured element is no longer available.";
    }
    if (!target.isConnected) {
      return "Captured element is disconnected.";
    }
    let previousRoot = document;
    for (const context of contexts) {
      try {
        if (!context.host?.isConnected) {
          return "Captured " + context.kind + " host is detached.";
        }
        if (!belongsToRoot(context.host, previousRoot)) {
          return "Captured " + context.kind + " host no longer belongs to its captured root.";
        }
        if (context.kind === "frame" && context.host.contentDocument !== context.root) {
          return "Captured frame document was replaced or is unavailable.";
        }
        if (
          context.kind === "shadow" &&
          (context.host.shadowRoot !== context.root || (context.root.host && context.root.host !== context.host))
        ) {
          return "Captured shadow root was replaced or is unavailable.";
        }
        previousRoot = context.root;
      } catch {
        return "Captured " + context.kind + " context is no longer accessible.";
      }
    }
    if (!belongsToRoot(target, previousRoot)) {
      return "Captured element no longer belongs to its captured root.";
    }
    return null;
  };
  for (const doc of documents) {
    doc.querySelectorAll("[data-ui-explorer-highlight]").forEach((node) => node.remove());
  }
  elementIds.forEach((elementId, index) => {
    const target = registry?.get(elementId);
    const detail = detachedDetail(target, elementContexts.get(elementId) || []);
    if (detail) {
      targets.push(detached(elementId, detail));
      return;
    }
    const doc = target.ownerDocument;
    const rect = target.getBoundingClientRect();
    const overlay = doc.createElement("div");
    overlay.setAttribute("data-ui-explorer-highlight", "true");
    overlay.style.cssText = [
      "position:fixed",
      "left:" + rect.left + "px",
      "top:" + rect.top + "px",
      "width:" + rect.width + "px",
      "height:" + rect.height + "px",
      "pointer-events:none",
      "z-index:2147483647",
      "border:2px solid #5ec7b8",
      "box-shadow:0 0 0 3px rgba(94,199,184,.28)",
      "background:rgba(94,199,184,.08)"
    ].join(";");
    const badge = doc.createElement("span");
    badge.textContent = String(index + 1);
    badge.style.cssText = [
      "position:absolute",
      "left:-2px",
      "top:-22px",
      "min-width:20px",
      "height:20px",
      "padding:0 6px",
      "display:grid",
      "place-items:center",
      "border-radius:4px",
      "background:#5ec7b8",
      "color:#101413",
      "font:700 12px/1 system-ui,sans-serif"
    ].join(";");
    overlay.appendChild(badge);
    doc.documentElement.appendChild(overlay);
    targets.push({ elementId, status: "highlighted" });
  });
  return { targets };
})()`;

export const ELEMENT_PICKER_SCRIPT = `(() => {
  const enabled = __ENABLED__;
  const state = window.__uiExplorerPicker || { listeners: [] };
  for (const entry of state.listeners || []) {
    entry.document.removeEventListener("click", entry.listener, true);
  }
  state.listeners = [];
  window.__uiExplorerPicker = state;

  if (!enabled) {
    return true;
  }

  const findElementId = (event) => {
    const ids = window.__uiExplorerElementIds;
    if (!ids) {
      return null;
    }
    const path = typeof event.composedPath === "function" ? event.composedPath() : [event.target];
    for (const node of path) {
      if (node?.nodeType !== Node.ELEMENT_NODE) {
        continue;
      }
      if (node.closest?.("[data-ui-explorer-highlight]")) {
        continue;
      }
      const id = ids.get(node);
      if (id) {
        return id;
      }
    }
    return null;
  };

  const installedDocuments = new Set();
  const install = (doc) => {
    if (installedDocuments.has(doc)) {
      return;
    }
    installedDocuments.add(doc);
    const listener = (event) => {
      const id = findElementId(event);
      if (!id) {
        return;
      }
      window.__uiExplorerPickedElementId = id;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
    };
    doc.addEventListener("click", listener, true);
    state.listeners.push({ document: doc, listener });

    for (const frame of Array.from(doc.querySelectorAll("iframe"))) {
      try {
        const frameDocument = frame.contentDocument;
        if (frameDocument) {
          install(frameDocument);
        }
      } catch {
        // Cross-origin frames cannot be instrumented from the target page.
      }
    }
  };

  const documents = window.__uiExplorerDocuments || new Set([document]);
  for (const doc of documents) {
    install(doc);
  }
  return true;
})()`;

export const GET_PICKED_ELEMENT_SCRIPT = `(() => {
  const id = window.__uiExplorerPickedElementId || null;
  window.__uiExplorerPickedElementId = null;
  return id;
})()`;
