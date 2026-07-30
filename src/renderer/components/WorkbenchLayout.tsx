import Editor from "@monaco-editor/react";
import {
  AlertTriangle,
  Box,
  Braces,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Code2,
  Columns3,
  Contrast,
  Copy,
  Database,
  Download,
  FileJson,
  Gauge,
  Globe2,
  Languages,
  Layers3,
  MousePointer2,
  Moon,
  PanelLeft,
  PanelRight,
  PlugZap,
  RefreshCw,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  Sun,
  Table2,
  Waypoints
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent, ReactNode } from "react";
import { analyzeElementAttributes, type AttributeLocatorMarker } from "../../shared/attributeInsights";
import { getCaptureCountdown } from "../../shared/captureTiming";
import { findElementSnapshot, flattenElementSnapshot, formatElementAttributes } from "../../shared/domSnapshot";
import type { ElementSnapshot, SnapshotDiagnostic, TableExportSaveResult } from "../../shared/ipc";
import {
  applySelectorEdit,
  diffSelectorCandidates,
  generateSelectorCandidates,
  suggestSelectorRepairs,
  type SelectorCandidate,
  type SelectorDiffEntry,
  type SelectorEdit,
  type SelectorExports,
  type SelectorLayer
} from "../../shared/selector";
import { buildAllTableExports, TABLE_EXPORT_FORMATS, type TableExportFormat } from "../../shared/tableExport";
import { extractTableForSelection, type ExtractedTable } from "../../shared/tableExtraction";
import { useI18n } from "../i18n/I18nProvider";
import type { MessageKey } from "../i18n/messages";
import { useAppStore } from "../store/useAppStore";
import {
  buildWorkbenchExports,
  findTreeSearchMatches,
  getContextPathLabels,
  getDiagnosticPresentation,
  getSelectorLayerMessageKey,
  getTableSummary,
  getTreeNodeBadgeMessageKey,
  getTreeNodePresentationKind,
  getVirtualTableWindow,
  getVisibilityMessageKey,
  isTreeNodeSelectable
} from "./workbenchPresentation";

type ResizeSide = "left" | "right";
type ExportFormat = keyof SelectorExports;
type LeftPanelSectionId = "targets" | "current" | "tests";
const TREE_ROW_HEIGHT = 30;
const TREE_OVERSCAN = 12;

function selectorLayerLabel(kind: SelectorLayer["kind"], t: (key: MessageKey) => string): string {
  return t(getSelectorLayerMessageKey(kind));
}

function TreeNodeIcon({ node }: { node: ElementSnapshot }): JSX.Element {
  const kind = getTreeNodePresentationKind(node);
  if (kind === "page") return <Globe2 size={13} />;
  if (kind === "frame") return <PanelRight size={13} />;
  if (kind === "shadow") return <Layers3 size={13} />;
  if (kind === "diagnostic") return <ShieldAlert size={13} />;
  if (node.tagName === "iframe") return <PanelRight size={13} />;
  if (node.tagName === "button") return <MousePointer2 size={13} />;
  if (["input", "textarea", "select"].includes(node.tagName ?? "")) return <SlidersHorizontal size={13} />;
  if (node.tagName === "a") return <Globe2 size={13} />;
  if (node.tagName === "table") return <Table2 size={13} />;
  return <Box size={13} />;
}

export function WorkbenchLayout(): JSX.Element {
  const { t } = useI18n();
  const {
    appInfo,
    browserConnection,
    browserDebugEndpoints,
    browserTargets,
    chromeOpenState,
    connectBrowser,
    density,
    discoverBrowserEndpoints,
    disconnectBrowser,
    domSnapshot,
    ipcStatus,
    isDiscoveringBrowserEndpoints,
    locale,
    monitorBrowserConnection,
    openChromePage,
    panelSizes,
    refreshDomSnapshot,
    selectBrowserTarget,
    selectElement,
    highlightElements,
    getPickedElementId,
    rightPanelSections,
    saveTableExport,
    selectedBrowserTargetId,
    selectedElementId,
    selectionRecovery,
    subscribeCaptureRequested,
    selectedTestPageId,
    setDensity,
    setLocale,
    setPanelSize,
    setElementPickerEnabled,
    setTheme,
    testPages,
    toggleRightPanelSection,
    theme,
    selectTestPage
  } = useAppStore();

  const [dragging, setDragging] = useState<ResizeSide | null>(null);
  const [debugEndpoint, setDebugEndpoint] = useState("localhost:9222");
  const [pageUrl, setPageUrl] = useState("");
  const [treeScrollTop, setTreeScrollTop] = useState(0);
  const [collapsedNodeIds, setCollapsedNodeIds] = useState<Set<string>>(() => new Set());
  const [treeSearchQuery, setTreeSearchQuery] = useState("");
  const [currentSearchMatchIndex, setCurrentSearchMatchIndex] = useState(0);
  const [isElementPickerEnabled, setIsElementPickerEnabled] = useState(false);
  const [leftPanelSections, setLeftPanelSections] = useState<Record<LeftPanelSectionId, boolean>>({
    targets: true,
    current: true,
    tests: true
  });
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [selectorDrafts, setSelectorDrafts] = useState<Record<string, SelectorCandidate>>({});
  const [exportFormat, setExportFormat] = useState<ExportFormat>("json");
  const [captureDelaySeconds, setCaptureDelaySeconds] = useState(3);
  const [captureDueAt, setCaptureDueAt] = useState<number | null>(null);
  const [captureClock, setCaptureClock] = useState(() => Date.now());
  const captureCountdown = getCaptureCountdown(captureDueAt, captureClock);

  useEffect(() => {
    const discoveredEndpoint = browserDebugEndpoints[0]?.endpoint;
    if (discoveredEndpoint && debugEndpoint === "localhost:9222") {
      setDebugEndpoint(discoveredEndpoint);
    }
  }, [browserDebugEndpoints, debugEndpoint]);

  useEffect(() => {
    if (browserConnection.state !== "connected") {
      return;
    }
    const interval = window.setInterval(() => {
      void monitorBrowserConnection();
    }, 2000);
    return () => window.clearInterval(interval);
  }, [browserConnection.state, monitorBrowserConnection]);

  useEffect(
    () =>
      subscribeCaptureRequested(() => {
        if (browserConnection.state === "connected") {
          setCaptureDueAt(null);
          void refreshDomSnapshot();
        }
      }),
    [browserConnection.state, refreshDomSnapshot, subscribeCaptureRequested]
  );

  useEffect(() => {
    if (captureDueAt === null) {
      return;
    }
    setCaptureClock(Date.now());
    const interval = window.setInterval(() => setCaptureClock(Date.now()), 100);
    return () => window.clearInterval(interval);
  }, [captureDueAt]);

  useEffect(() => {
    if (captureDueAt !== null && captureCountdown.ready) {
      setCaptureDueAt(null);
      void refreshDomSnapshot();
    }
  }, [captureCountdown.ready, captureDueAt, refreshDomSnapshot]);

  const selectedPage = useMemo(
    () => testPages.find((page) => page.id === selectedTestPageId) ?? testPages[0],
    [selectedTestPageId, testPages]
  );
  const treeRows = useMemo(() => flattenElementSnapshot(domSnapshot?.root ?? null), [domSnapshot]);
  const treeSearchMatches = useMemo(
    () => findTreeSearchMatches(treeRows, treeSearchQuery),
    [treeRows, treeSearchQuery]
  );
  const activeSearchMatch = treeSearchMatches[currentSearchMatchIndex] ?? null;
  const visibleTreeRows = useMemo(
    () => flattenVisibleElementSnapshot(domSnapshot?.root ?? null, collapsedNodeIds),
    [domSnapshot?.root, collapsedNodeIds]
  );
  const selectedElement = useMemo(
    () => findElementSnapshot(domSnapshot?.root ?? null, selectedElementId ?? ""),
    [domSnapshot, selectedElementId]
  );
  const selectedTarget = useMemo(
    () => browserTargets.find((target) => target.id === selectedBrowserTargetId) ?? null,
    [browserTargets, selectedBrowserTargetId]
  );
  const selectorCandidates = useMemo(
    () => generateSelectorCandidates(domSnapshot?.root ?? null, selectedElementId),
    [domSnapshot?.root, selectedElementId]
  );
  const activeCandidateId = selectedCandidateId ?? selectorCandidates[0]?.id ?? null;
  const selectedCandidate = useMemo(
    () => {
      if (selectedElement?.diagnostic || !activeCandidateId) {
        return null;
      }
      const candidate = selectorCandidates.find((item) => item.id === activeCandidateId);
      if (!candidate) {
        return null;
      }
      const draft = selectorDrafts[activeCandidateId];
      return draft?.layers.some((layer) => layer.kind === "target" && layer.nodeId === selectedElement?.id)
        ? draft
        : candidate;
    },
    [activeCandidateId, selectedElement, selectorCandidates, selectorDrafts]
  );
  const selectorExports = useMemo(
    () => buildWorkbenchExports(selectedElement, selectedCandidate),
    [selectedCandidate, selectedElement]
  );
  const extractedTable = useMemo(
    () => extractTableForSelection(domSnapshot?.root ?? null, selectedElementId),
    [domSnapshot?.root, selectedElementId]
  );
  const tableSummary = getTableSummary(extractedTable);
  const previewSnippet = selectorExports?.[exportFormat] ?? "";

  const revealElement = (elementId: string) => {
    if (!domSnapshot?.root) {
      void selectElement(elementId);
      return;
    }

    setCollapsedNodeIds((current) => {
      const next = new Set(current);
      for (const ancestorId of getAncestorIds(treeRows, elementId)) {
        next.delete(ancestorId);
      }

      const nextRows = flattenVisibleElementSnapshot(domSnapshot.root, next);
      const rowIndex = nextRows.findIndex((row) => row.id === elementId);
      if (rowIndex >= 0) {
        setTreeScrollTop(Math.max(0, (rowIndex - 8) * TREE_ROW_HEIGHT));
      }

      return next;
    });

    void selectElement(elementId);
  };

  useEffect(() => {
    setSelectedCandidateId(selectorCandidates[0]?.id ?? null);
    setSelectorDrafts({});
    setExportFormat("json");
  }, [domSnapshot?.capturedAt, selectedElementId, selectorCandidates]);

  useEffect(() => {
    setCollapsedNodeIds(new Set());
    setTreeScrollTop(0);
  }, [domSnapshot?.capturedAt]);

  useEffect(() => {
    setCurrentSearchMatchIndex(0);
  }, [domSnapshot?.capturedAt, treeSearchQuery]);

  useEffect(() => {
    if (!activeSearchMatch) {
      return;
    }

    revealElement(activeSearchMatch.id);
  }, [activeSearchMatch?.id]);

  useEffect(() => {
    if (browserConnection.state !== "connected" && isElementPickerEnabled) {
      setIsElementPickerEnabled(false);
    }
  }, [browserConnection.state, isElementPickerEnabled]);

  useEffect(() => {
    if (browserConnection.state !== "connected") {
      return;
    }

    void setElementPickerEnabled(isElementPickerEnabled);
    return () => {
      void setElementPickerEnabled(false);
    };
  }, [browserConnection.state, domSnapshot?.capturedAt, isElementPickerEnabled, setElementPickerEnabled]);

  useEffect(() => {
    if (!isElementPickerEnabled || browserConnection.state !== "connected") {
      return;
    }

    const pollPickedElement = () => {
      void getPickedElementId()
        .then((elementId) => {
          if (elementId) {
            revealElement(elementId);
          }
        })
        .catch(() => undefined);
    };

    const intervalId = window.setInterval(pollPickedElement, 250);
    return () => window.clearInterval(intervalId);
  }, [browserConnection.state, domSnapshot?.capturedAt, getPickedElementId, isElementPickerEnabled]);

  useEffect(() => {
    if (!selectedCandidate || browserConnection.state !== "connected") {
      return;
    }

    void highlightElements(selectedCandidate.validation.matchedElementIds);
  }, [browserConnection.state, highlightElements, selectedCandidate]);

  const editSelector = (candidate: SelectorCandidate, edit: SelectorEdit) => {
    const edited = applySelectorEdit(domSnapshot?.root ?? null, candidate, edit);
    setSelectorDrafts((current) => ({ ...current, [candidate.id]: edited }));
  };

  const toggleTreeNode = (elementId: string) => {
    setCollapsedNodeIds((current) => {
      const next = new Set(current);
      if (next.has(elementId)) {
        next.delete(elementId);
      } else {
        next.add(elementId);
      }
      return next;
    });
  };

  const showPreviousSearchMatch = () => {
    if (treeSearchMatches.length === 0) {
      return;
    }

    setCurrentSearchMatchIndex((current) => (current - 1 + treeSearchMatches.length) % treeSearchMatches.length);
  };

  const showNextSearchMatch = () => {
    if (treeSearchMatches.length === 0) {
      return;
    }

    setCurrentSearchMatchIndex((current) => (current + 1) % treeSearchMatches.length);
  };

  const toggleLeftPanelSection = (section: LeftPanelSectionId) => {
    setLeftPanelSections((current) => ({
      ...current,
      [section]: !current[section]
    }));
  };

  const copyExport = () => {
    if (!previewSnippet) {
      return;
    }

    void navigator.clipboard?.writeText(previewSnippet);
  };

  const beginResize = (side: ResizeSide) => (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(side);
  };

  const updateResize = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging) {
      return;
    }

    const nextWidth = dragging === "left" ? event.clientX : window.innerWidth - event.clientX;
    setPanelSize(dragging, nextWidth);
  };

  const endResize = () => setDragging(null);
  const connectionLabel =
    browserConnection.state === "connected"
      ? browserConnection.message === "no-targets"
        ? t("connection.noTargets")
        : browserConnection.message === "target-closed"
          ? t("connection.targetClosed")
          : browserConnection.message === "reconnected"
            ? t("connection.reconnected")
            : browserConnection.message === "navigated"
              ? t("connection.navigated")
              : browserConnection.message === "reconnecting"
                ? t("connection.reconnecting")
        : t("connection.connected")
      : browserConnection.state === "connecting"
        ? t("connection.connecting")
        : browserConnection.state === "error"
          ? t("connection.error")
          : t("connection.notConnected");
  const connect = () => {
    void connectBrowser(debugEndpoint);
  };
  const disconnect = () => {
    void disconnectBrowser();
  };
  const scheduleCapture = () => {
    if (captureDelaySeconds === 0) {
      void refreshDomSnapshot();
      return;
    }
    const now = Date.now();
    setCaptureClock(now);
    setCaptureDueAt(now + captureDelaySeconds * 1000);
  };
  const connectionHint =
    browserConnection.state === "error"
      ? browserConnection.message
      : browserConnection.state === "connected" && browserConnection.diagnostics
        ? `raw=${browserConnection.diagnostics.rawTargetCount}, inspectable=${browserConnection.diagnostics.inspectableTargetCount}, types=${browserConnection.diagnostics.rawTargetTypes.join(",") || "-"}`
        : t("connection.guide");
  const isInspectingTarget = browserConnection.state === "connected" && Boolean(selectedTarget);
  const diagnosticsSummary = `${ipcStatus.state === "ready" ? ipcStatus.message : ipcStatus.state} / ${domSnapshot?.nodeCount ?? 0} ${t("tree.nodes")}`;
  const snapshotSummary = selectedElement ? `${selectedElement.tagName ?? selectedElement.nodeName} / ${selectedElement.text || "-"}` : "-";
  const selectedVisibilityKey = getVisibilityMessageKey(selectedElement?.visible);
  const elementSummary = selectedElement
    ? `${selectedElement.tagName ?? selectedElement.nodeName} / ${selectedVisibilityKey ? t(selectedVisibilityKey) : "-"}`
    : "-";
  const selectorSummary = selectedCandidate
    ? `${selectedCandidate.validation.matchCount} ${t("selector.matchCount")} / ${selectedCandidate.score.total}`
    : selectedElement?.diagnostic
      ? t(getDiagnosticPresentation(selectedElement.diagnostic).messageKey)
      : "-";
  const exportSummary = selectorExports ? t(`selector.export.${exportFormat}`) : "-";
  const tablePanelSummary = tableSummary
    ? `${tableSummary.rows} ${t("table.rows")} / ${tableSummary.columns} ${t("table.columns")}`
    : "-";
  const selectedTargetSummary = selectedTarget?.title || selectedTarget?.url || "-";
  const selectedTestSummary = selectedPage ? t(selectedPage.titleKey) : "-";
  const chromeOpenBusy = [
    "detecting",
    "selecting-executable",
    "launching",
    "connecting",
    "opening"
  ].includes(chromeOpenState.status);
  const hasChromeInstance =
    browserConnection.state === "connected" || browserDebugEndpoints.length > 0;
  const chromeButtonKey: MessageKey = chromeOpenBusy
    ? `chrome.progress.${chromeOpenState.status}` as MessageKey
    : hasChromeInstance
      ? "chrome.openNewTab"
      : "chrome.launchAndOpen";
  const chromeFeedback =
    chromeOpenState.status === "error"
      ? t(`chrome.error.${chromeOpenState.code}` as MessageKey)
      : chromeOpenState.status === "success"
        ? t("chrome.opened")
        : chromeOpenBusy
          ? t(chromeButtonKey)
          : t(hasChromeInstance ? "chrome.instance.external" : "chrome.instance.none");

  return (
    <div className="app-shell" data-density={density}>
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">
            <Waypoints size={18} />
          </div>
          <div>
            <h1>{t("app.title")}</h1>
            <p>{t("app.description")}</p>
          </div>
        </div>

        <div className="target-control" role="group" aria-label={t("connection.debugPort")}>
          <Globe2 size={16} />
          <input
            list="browser-debug-endpoints"
            aria-label={t("connection.debugPort")}
            value={debugEndpoint}
            placeholder={t("toolbar.targetPlaceholder")}
            onChange={(event) => setDebugEndpoint(event.target.value)}
          />
          <datalist id="browser-debug-endpoints">
            {browserDebugEndpoints.map((item) => (
              <option key={item.endpoint} value={item.endpoint}>{item.browser}</option>
            ))}
          </datalist>
          <button type="button" onClick={browserConnection.state === "connected" ? disconnect : connect}>
            <PlugZap size={15} />
            {browserConnection.state === "connected" ? t("toolbar.disconnect") : t("toolbar.connect")}
          </button>
        </div>

        <div className="toolbar-actions">
          <label>
            <Contrast size={15} />
            <span>{t("toolbar.density")}</span>
            <select value={density} onChange={(event) => setDensity(event.target.value as typeof density)}>
              <option value="comfortable">Comfortable</option>
              <option value="compact">Compact</option>
            </select>
          </label>
          <button type="button" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
            {theme === "dark" ? <Moon size={15} /> : <Sun size={15} />}
            {t("toolbar.theme")}
          </button>
          <button type="button" onClick={() => setLocale(locale === "zh-CN" ? "en-US" : "zh-CN")}>
            <Languages size={15} />
            {t("toolbar.language")}
          </button>
        </div>
      </header>

      <main
        className="workbench"
        onPointerMove={updateResize}
        onPointerUp={endResize}
        onPointerCancel={endResize}
      >
        <aside className="side-panel left-panel" style={{ width: panelSizes.left }}>
          <CollapsibleSection
            icon={<PanelLeft size={15} />}
            open={leftPanelSections.targets}
            summary={connectionLabel}
            title={t("panel.targets")}
            onToggle={() => toggleLeftPanelSection("targets")}
          >
            <section className="connection-card">
              <span>{t("connection.status")}</span>
              <strong>{connectionLabel}</strong>
              <p>{connectionHint}</p>
              <button type="button" onClick={() => void discoverBrowserEndpoints()} disabled={isDiscoveringBrowserEndpoints}>
                <Search size={13} />
                {isDiscoveringBrowserEndpoints ? t("connection.discovering") : t("connection.discover")}
              </button>
              {browserDebugEndpoints.length > 0 ? (
                <div className="target-list">
                  {browserDebugEndpoints.map((item) => (
                    <button type="button" key={item.endpoint} onClick={() => setDebugEndpoint(item.endpoint)}>
                      <span>{item.browser}</span>
                      <small>{item.endpoint}</small>
                    </button>
                  ))}
                </div>
              ) : null}
            </section>
            <form
              className="chrome-launch-card"
              onSubmit={(event) => {
                event.preventDefault();
                void openChromePage(
                  { kind: "custom", value: pageUrl },
                  debugEndpoint
                );
              }}
            >
              <strong>{t("chrome.cardTitle")}</strong>
              <label>
                <span>{t("chrome.url")}</span>
                <input
                  value={pageUrl}
                  placeholder={t("chrome.urlPlaceholder")}
                  disabled={chromeOpenBusy}
                  onChange={(event) => setPageUrl(event.currentTarget.value)}
                />
              </label>
              <button type="submit" disabled={chromeOpenBusy}>
                <PlugZap size={13} />
                {t(chromeButtonKey)}
              </button>
              <p data-status={chromeOpenState.status}>{chromeFeedback}</p>
            </form>
          </CollapsibleSection>

          <CollapsibleSection
            icon={<Globe2 size={15} />}
            open={leftPanelSections.current}
            summary={selectedTargetSummary}
            title={t("target.current")}
            onToggle={() => toggleLeftPanelSection("current")}
          >
            <div className="target-list">
              {browserTargets.length === 0 ? <p className="empty-copy">{t("target.empty")}</p> : null}
              {browserTargets.map((target) => (
                <button
                  type="button"
                  className={target.id === selectedBrowserTargetId ? "target-page selected" : "target-page"}
                  key={target.id}
                  onClick={() => void selectBrowserTarget(target.id)}
                >
                  <span>{target.title || target.url}</span>
                  <small>{target.url}</small>
                </button>
              ))}
            </div>
          </CollapsibleSection>

          <CollapsibleSection
            icon={<Database size={15} />}
            open={leftPanelSections.tests}
            summary={selectedTestSummary}
            title={t("panel.tests")}
            onToggle={() => toggleLeftPanelSection("tests")}
          >
            <div className="test-list">
              {testPages.map((page) => (
                <div className="test-page-row" key={page.id}>
                  <button
                    type="button"
                    className={page.id === selectedPage?.id ? "test-page selected" : "test-page"}
                    onClick={() => selectTestPage(page.id)}
                  >
                    <span>{t(page.titleKey)}</span>
                    <small>{t(page.descriptionKey)}</small>
                  </button>
                  <button
                    type="button"
                    className="test-page-open"
                    disabled={chromeOpenBusy}
                    onClick={() => void openChromePage(
                      { kind: "test-page", id: page.id },
                      debugEndpoint
                    )}
                  >
                    {t("chrome.openTestPage")}
                  </button>
                </div>
              ))}
            </div>
          </CollapsibleSection>
        </aside>

        <div className="resize-handle" role="separator" aria-orientation="vertical" onPointerDown={beginResize("left")} />

        <section className="center-panel">
          <div className="panel-strip">
            <PanelTitle icon={<Columns3 size={15} />} title={t("panel.explorer")} />
            <div className="strip-actions">
              <label className="capture-delay-control">
                <span>{t("capture.delay")}</span>
                <select
                  value={captureDelaySeconds}
                  onChange={(event) => setCaptureDelaySeconds(Number(event.currentTarget.value))}
                  disabled={browserConnection.state !== "connected" || captureDueAt !== null}
                >
                  <option value={0}>{t("capture.now")}</option>
                  <option value={3}>3s</option>
                  <option value={5}>5s</option>
                  <option value={10}>10s</option>
                </select>
              </label>
              {captureDueAt === null ? (
                <button
                  type="button"
                  title={t("capture.hotkey")}
                  onClick={scheduleCapture}
                  disabled={browserConnection.state !== "connected"}
                >
                  <RefreshCw size={13} />
                  {t("capture.start")}
                </button>
              ) : (
                <button type="button" className="selected" onClick={() => setCaptureDueAt(null)}>
                  <RefreshCw size={13} />
                  {captureCountdown.remainingSeconds}s · {t("capture.cancel")}
                </button>
              )}
              <button
                type="button"
                className={isElementPickerEnabled ? "selected" : ""}
                onClick={() => setIsElementPickerEnabled((current) => !current)}
                disabled={browserConnection.state !== "connected"}
              >
                <MousePointer2 size={13} />
                {t("toolbar.pickElement")}
              </button>
              <button type="button" onClick={() => void refreshDomSnapshot()} disabled={browserConnection.state !== "connected"}>
                <RefreshCw size={13} />
                {t("toolbar.refresh")}
              </button>
              <StatusPill status={ipcStatus.state === "ready" ? "success" : ipcStatus.state === "error" ? "danger" : "warning"}>
                {ipcStatus.state === "error" ? t("toolbar.ipcError") : t("toolbar.ipcReady")}
              </StatusPill>
            </div>
          </div>

          <div className={isInspectingTarget ? "split-center target-mode" : "split-center"}>
            <section className="tree-panel">
              <div className="tree-summary">
                <Braces size={16} />
                <span>
                  {treeRows.length} {t("tree.nodes")}
                </span>
                {selectionRecovery ? (
                  <small>
                    {selectionRecovery.status === "restored"
                      ? t("selection.restored")
                      : selectionRecovery.status === "ambiguous"
                        ? t("selection.ambiguous")
                        : t("selection.notFound")}
                  </small>
                ) : null}
              </div>
              <div className="tree-search">
                <Search size={14} />
                <input
                  value={treeSearchQuery}
                  placeholder={t("tree.searchPlaceholder")}
                  onChange={(event) => setTreeSearchQuery(event.target.value)}
                />
                <span>
                  {treeSearchQuery.trim()
                    ? treeSearchMatches.length > 0
                      ? `${currentSearchMatchIndex + 1}/${treeSearchMatches.length}`
                      : t("tree.searchNoResults")
                    : t("tree.searchResults")}
                </span>
                <button
                  type="button"
                  className="previous"
                  aria-label={t("tree.previousMatch")}
                  disabled={treeSearchMatches.length < 2}
                  onClick={showPreviousSearchMatch}
                >
                  <ChevronDown size={13} />
                </button>
                <button
                  type="button"
                  aria-label={t("tree.nextMatch")}
                  disabled={treeSearchMatches.length < 2}
                  onClick={showNextSearchMatch}
                >
                  <ChevronDown size={13} />
                </button>
              </div>
              {treeRows.length === 0 ? (
                <p className="empty-copy">{t("tree.empty")}</p>
              ) : (
                <VirtualTree
                  collapsedNodeIds={collapsedNodeIds}
                  searchMatchIds={new Set(treeSearchMatches.map((match) => match.id))}
                  rows={visibleTreeRows}
                  selectedElementId={selectedElementId}
                  scrollTop={treeScrollTop}
                  onScrollTopChange={setTreeScrollTop}
                  onSelect={(id) => void selectElement(id)}
                  onToggle={toggleTreeNode}
                />
              )}
            </section>

            {isInspectingTarget ? null : (
              <section className="preview-panel">
                <div className="preview-header">
                  <div>
                    <h2>{t("preview.title")}</h2>
                    <p>{selectedPage ? t(selectedPage.descriptionKey) : ""}</p>
                  </div>
                  {selectedPage ? (
                    <a href={selectedPage.path} target="_blank" rel="noreferrer">
                      {t("preview.openPage")}
                      <ChevronDown size={14} />
                    </a>
                  ) : null}
                </div>
                <iframe title={t("preview.title")} src={selectedPage?.path} />
              </section>
            )}
          </div>
        </section>

        <div className="resize-handle" role="separator" aria-orientation="vertical" onPointerDown={beginResize("right")} />

        <aside className="side-panel right-panel" style={{ width: panelSizes.right }}>
          <CollapsibleSection
            icon={<PanelRight size={15} />}
            open={rightPanelSections.diagnostics}
            summary={diagnosticsSummary}
            title={t("panel.properties")}
            onToggle={() => toggleRightPanelSection("diagnostics")}
          >
            <section className="diagnostic-grid">
              <DiagnosticItem label={t("diagnostics.ipc")} value={ipcStatus.state === "ready" ? ipcStatus.message : ipcStatus.state} />
              <DiagnosticItem
                label={t("diagnostics.app")}
                value={appInfo ? `${appInfo.platform} / Electron ${appInfo.electron}` : "-"}
              />
              <DiagnosticItem label={t("diagnostics.target")} value={selectedTarget?.title || selectedTarget?.url || "-"} />
              <DiagnosticItem label={t("diagnostics.nodes")} value={String(domSnapshot?.nodeCount ?? 0)} />
              <DiagnosticItem label={t("diagnostics.capturedAt")} value={domSnapshot?.capturedAt ?? "-"} />
            </section>
          </CollapsibleSection>

          <CollapsibleSection
            icon={<Braces size={15} />}
            open={rightPanelSections.snapshot}
            summary={snapshotSummary}
            title={t("preview.selectedSnapshot")}
            onToggle={() => toggleRightPanelSection("snapshot")}
          >
            <ElementSnapshotPanel element={selectedElement} />
          </CollapsibleSection>

          <CollapsibleSection
            icon={<Braces size={15} />}
            open={rightPanelSections.element}
            summary={elementSummary}
            title={t("properties.selected")}
            onToggle={() => toggleRightPanelSection("element")}
          >
            <ElementDetails element={selectedElement} root={domSnapshot?.root ?? null} />
          </CollapsibleSection>

          <CollapsibleSection
            icon={<FileJson size={15} />}
            open={rightPanelSections.selector}
            summary={selectorSummary}
            title={t("panel.selector")}
            onToggle={() => toggleRightPanelSection("selector")}
          >
            <SelectorPanel
              candidates={selectorCandidates}
              diagnostic={selectedElement?.diagnostic}
              element={selectedElement}
              root={domSnapshot?.root ?? null}
              selectedCandidate={selectedCandidate}
              selectedCandidateId={activeCandidateId}
              drafts={selectorDrafts}
              onSelectCandidate={setSelectedCandidateId}
              onEdit={editSelector}
            />
          </CollapsibleSection>

          {extractedTable ? (
            <CollapsibleSection
              icon={<Table2 size={15} />}
              open={rightPanelSections.table}
              summary={tablePanelSummary}
              title={t("panel.tableData")}
              onToggle={() => toggleRightPanelSection("table")}
            >
              <TableDataPanel
                key={`${domSnapshot?.capturedAt ?? "snapshot"}-${extractedTable.tableId}`}
                table={extractedTable}
                theme={theme}
                onSave={saveTableExport}
              />
            </CollapsibleSection>
          ) : null}

          <CollapsibleSection
            icon={<Code2 size={15} />}
            open={rightPanelSections.export}
            summary={exportSummary}
            title={t("selector.exportPreview")}
            onToggle={() => toggleRightPanelSection("export")}
          >
            <div className="editor-shell">
              <div className="editor-title">
                <Code2 size={14} />
                {t("selector.exportPreview")}
                <div className="editor-tabs" role="tablist" aria-label={t("selector.exportPreview")}>
                  {(["json", "playwright", "selenium"] as const).map((format) => (
                    <button
                      type="button"
                      key={format}
                      className={format === exportFormat ? "selected" : ""}
                      onClick={() => setExportFormat(format)}
                    >
                      {t(`selector.export.${format}`)}
                    </button>
                  ))}
                </div>
                <button type="button" className="icon-button" onClick={copyExport} aria-label={t("selector.copy")}>
                  <Copy size={13} />
                </button>
              </div>
              <Editor
                height="190px"
                language={exportFormat === "json" ? "json" : exportFormat === "playwright" ? "typescript" : "python"}
                value={previewSnippet}
                options={{
                  readOnly: true,
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  fontSize: 12,
                  lineNumbers: "off",
                  folding: false,
                  renderLineHighlight: "none"
                }}
                theme={theme === "dark" ? "vs-dark" : "light"}
              />
            </div>
          </CollapsibleSection>
        </aside>
      </main>
    </div>
  );
}

const TABLE_ROW_HEIGHT = 30;
const TABLE_VISIBLE_ROWS = 8;
const TABLE_OVERSCAN = 3;

function TableDataPanel({
  onSave,
  table,
  theme
}: {
  onSave: (request: {
    format: TableExportFormat;
    content: string;
    suggestedBaseName: string;
  }) => Promise<TableExportSaveResult>;
  table: ExtractedTable;
  theme: "light" | "dark";
}): JSX.Element {
  const { t } = useI18n();
  const [format, setFormat] = useState<TableExportFormat>("csv");
  const [scrollTop, setScrollTop] = useState(0);
  const [feedback, setFeedback] = useState<{
    kind: "copied" | "copy-error" | "saved" | "cancelled" | "save-error";
    detail?: string;
  } | null>(null);
  const exports = useMemo(() => buildAllTableExports(table), [table]);
  const summary = getTableSummary(table);
  const virtualWindow = getVirtualTableWindow(
    table.rows.length,
    Math.max(0, scrollTop - TABLE_ROW_HEIGHT),
    TABLE_ROW_HEIGHT,
    TABLE_VISIBLE_ROWS,
    TABLE_OVERSCAN
  );
  const visibleRows = table.rows.slice(virtualWindow.startIndex, virtualWindow.endIndex);
  const gridWidth = Math.max(320, table.headers.length * 140);
  const gridTemplateColumns = `repeat(${Math.max(1, table.headers.length)}, minmax(120px, 1fr))`;
  const preview = exports[format];

  useEffect(() => {
    setFormat("csv");
    setScrollTop(0);
    setFeedback(null);
  }, [table.tableId]);

  useEffect(() => {
    setFeedback(null);
  }, [format]);

  const copyTableExport = async () => {
    try {
      if (!navigator.clipboard) {
        throw new Error("Clipboard API is unavailable.");
      }
      await navigator.clipboard.writeText(preview);
      setFeedback({ kind: "copied" });
    } catch (error) {
      setFeedback({
        kind: "copy-error",
        detail: error instanceof Error ? error.message : String(error)
      });
    }
  };

  const saveTable = async () => {
    let result: TableExportSaveResult;
    try {
      result = await onSave({
        format,
        content: preview,
        suggestedBaseName: table.caption || `table-${table.tableId}`
      });
    } catch (error) {
      setFeedback({
        kind: "save-error",
        detail: error instanceof Error ? error.message : String(error)
      });
      return;
    }
    switch (result.status) {
      case "saved":
        setFeedback({ kind: "saved", detail: result.filePath });
        break;
      case "cancelled":
        setFeedback({ kind: "cancelled" });
        break;
      case "error":
        setFeedback({ kind: "save-error", detail: result.message });
        break;
      default: {
        const exhaustiveResult: never = result;
        throw new Error(`Unhandled table save result: ${String(exhaustiveResult)}`);
      }
    }
  };

  if (!summary || table.headers.length === 0) {
    return <p className="empty-copy">{t("table.empty")}</p>;
  }

  return (
    <div className="table-data-panel">
      <div className="table-metrics">
        <Metric label={t("table.rows")} value={String(summary.rows)} />
        <Metric label={t("table.columns")} value={String(summary.columns)} />
        <Metric label={t("table.headerLevels")} value={String(summary.headerDepth)} />
      </div>

      <section className="table-preview-card">
        <h3>{t("table.dataPreview")}</h3>
        <div className="table-data-grid" onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}>
          <div className="table-grid-content" style={{ width: gridWidth }}>
            <div className="table-data-header" style={{ gridTemplateColumns }}>
              {table.headers.map((header) => (
                <strong key={header} title={header}>{header}</strong>
              ))}
            </div>
            <div className="table-data-body" style={{ height: table.rows.length * TABLE_ROW_HEIGHT }}>
              {visibleRows.map((row, visibleIndex) => {
                const rowIndex = virtualWindow.startIndex + visibleIndex;
                return (
                  <div
                    className="table-data-row"
                    key={rowIndex}
                    style={{
                      gridTemplateColumns,
                      transform: `translateY(${rowIndex * TABLE_ROW_HEIGHT}px)`
                    }}
                  >
                    {table.headers.map((header, column) => (
                      <span key={`${header}-${column}`} title={row[column] ?? ""}>{row[column] ?? ""}</span>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      <section className="editor-shell table-export-shell">
        <div className="editor-title">
          <Code2 size={14} />
          {t("table.exportPreview")}
          <div className="editor-tabs" role="tablist" aria-label={t("table.exportPreview")}>
            {TABLE_EXPORT_FORMATS.map((candidate) => (
              <button
                type="button"
                key={candidate}
                className={candidate === format ? "selected" : ""}
                onClick={() => setFormat(candidate)}
              >
                {t(`table.format.${candidate}`)}
              </button>
            ))}
          </div>
        </div>
        <Editor
          height="170px"
          language={format === "json" ? "json" : format === "markdown" ? "markdown" : "plaintext"}
          value={preview}
          options={{
            readOnly: true,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            fontSize: 12,
            lineNumbers: "off",
            folding: false,
            renderLineHighlight: "none"
          }}
          theme={theme === "dark" ? "vs-dark" : "light"}
        />
      </section>

      <div className="table-export-actions">
        <button type="button" onClick={() => void copyTableExport()}>
          <Copy size={13} />
          {t("table.copy")}
        </button>
        <button type="button" className="primary" onClick={() => void saveTable()}>
          <Download size={13} />
          {t("table.save")}
        </button>
      </div>
      {feedback ? (
        <p
          className="table-export-feedback"
          data-status={feedback.kind === "copy-error" || feedback.kind === "save-error" ? "error" : feedback.kind}
          title={feedback.detail}
        >
          {feedback.kind === "copied"
            ? t("table.copied")
            : feedback.kind === "saved"
              ? t("table.saved")
              : feedback.kind === "cancelled"
                ? t("table.cancelled")
                : feedback.kind === "copy-error"
                  ? t("table.copyFailed")
                  : t("table.saveFailed")}
          {feedback.detail ? ` · ${feedback.detail}` : ""}
        </p>
      ) : null}
    </div>
  );
}

function ElementSnapshotPanel({ element }: { element: ElementSnapshot | null }): JSX.Element {
  const { t } = useI18n();

  if (!element) {
    return <p className="empty-copy">{t("empty.properties")}</p>;
  }

  return (
    <div className="property-stack snapshot-panel">
      <PropertyRow label={t("properties.nodeName")} value={element.nodeName} />
      <PropertyRow label={t("properties.text")} value={element.text || "-"} />
      <PropertyRow label={t("properties.attributes")} value={formatElementAttributes(element) || "-"} />
    </div>
  );
}

function CollapsibleSection({
  children,
  icon,
  onToggle,
  open,
  summary,
  title
}: {
  children: ReactNode;
  icon: ReactNode;
  onToggle: () => void;
  open: boolean;
  summary: string;
  title: string;
}): JSX.Element {
  return (
    <section className="collapsible-section" data-open={open}>
      <button type="button" className="collapsible-header" onClick={onToggle} aria-expanded={open}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        {icon}
        <span>{title}</span>
        <small>{summary}</small>
      </button>
      {open ? <div className="collapsible-body">{children}</div> : null}
    </section>
  );
}

function SelectorPanel({
  candidates,
  diagnostic,
  drafts,
  element,
  onEdit,
  onSelectCandidate,
  root,
  selectedCandidate,
  selectedCandidateId
}: {
  candidates: SelectorCandidate[];
  diagnostic?: SnapshotDiagnostic;
  drafts: Record<string, SelectorCandidate>;
  element: ElementSnapshot | null;
  onEdit: (candidate: SelectorCandidate, edit: SelectorEdit) => void;
  onSelectCandidate: (id: string) => void;
  root: ElementSnapshot | null;
  selectedCandidate: SelectorCandidate | null;
  selectedCandidateId: string | null;
}): JSX.Element {
  const { t } = useI18n();

  if (candidates.length === 0 || !selectedCandidate) {
    if (diagnostic) {
      const presentation = getDiagnosticPresentation(diagnostic);
      return (
        <section className="property-card context-diagnostic">
          <ShieldAlert size={15} />
          <div>
            <h3>{t(presentation.messageKey)}</h3>
            <p>{presentation.detail}</p>
          </div>
        </section>
      );
    }

    return <p className="empty-copy">{t("empty.selector")}</p>;
  }

  const originalCandidate = candidates.find((candidate) => candidate.id === selectedCandidate.id) ?? selectedCandidate;
  const changes = diffSelectorCandidates(originalCandidate, selectedCandidate);
  const repairs = suggestSelectorRepairs(root, selectedCandidate);
  const targetTooltip = [
    element?.tagName ?? element?.nodeName ?? "-",
    `role=${element?.role || "-"}`,
    `name=${element?.accessibleName || "-"}`,
    `score=${selectedCandidate.score.total}`,
    `matches=${selectedCandidate.validation.matchCount}`
  ].join(" · ");

  return (
    <div className="selector-stack">
      <div className="selector-candidates" role="tablist" aria-label={t("selector.candidates")}>
        {candidates.map((candidate) => {
          const current = drafts[candidate.id] ?? candidate;
          return (
            <button
              type="button"
              key={candidate.id}
              className={candidate.id === selectedCandidateId ? "selector-candidate selected" : "selector-candidate"}
              onClick={() => onSelectCandidate(candidate.id)}
            >
              <span>{candidate.label}</span>
              <strong>{current.score.total}</strong>
            </button>
          );
        })}
      </div>

      <section className="property-card selector-card">
        <div className="selector-headline" title={targetTooltip}>
          <StatusIcon status={selectedCandidate.validation.status} />
          <code>{selectedCandidate.selector}</code>
        </div>
        <div className="score-grid">
          <Metric label={t("selector.matchCount")} value={String(selectedCandidate.validation.matchCount)} />
          <Metric label={t("selector.totalScore")} value={String(selectedCandidate.score.total)} />
          <Metric label={t("selector.stability")} value={String(selectedCandidate.score.stability)} />
          <Metric label={t("selector.readability")} value={String(selectedCandidate.score.readability)} />
        </div>
      </section>

      <section className="property-card selector-card">
        <h3>{t("selector.diff")}</h3>
        {changes.length === 0 ? (
          <p className="empty-copy">{t("selector.diffEmpty")}</p>
        ) : (
          changes.map((change, index) => (
            <div className="selector-diff" key={`${change.layerId}-${change.field}-${change.attributeName ?? ""}-${index}`}>
              <span>{formatSelectorDiffLabel(change)}</span>
              <code>{String(change.before)} → {String(change.after)}</code>
            </div>
          ))
        )}
      </section>

      <section className="property-card selector-card">
        <h3>{t("selector.layers")}</h3>
        {selectedCandidate.layers.map((layer) => (
          <div className="selector-layer" key={layer.id}>
            <label>
              <input
                type="checkbox"
                checked={layer.enabled}
                onChange={(event) => onEdit(selectedCandidate, { layerId: layer.id, enabled: event.currentTarget.checked })}
              />
              <SlidersHorizontal size={13} />
              <span>{selectorLayerLabel(layer.kind, t)}</span>
            </label>
            <label>
              <input
                type="checkbox"
                checked={layer.tagEnabled}
                onChange={(event) => onEdit(selectedCandidate, { layerId: layer.id, tagEnabled: event.currentTarget.checked })}
              />
              <code>{layer.tagName}</code>
            </label>
            <div className="selector-attributes">
              {layer.attributes.map((attribute) => (
                <label key={attribute.name}>
                  <input
                    type="checkbox"
                    checked={attribute.enabled}
                    onChange={(event) =>
                      onEdit(selectedCandidate, {
                        layerId: layer.id,
                        attributeName: attribute.name,
                        enabled: event.currentTarget.checked
                      })
                    }
                  />
                  <span>{attribute.name}</span>
                  <input
                    value={attribute.value}
                    onChange={(event) =>
                      onEdit(selectedCandidate, {
                        layerId: layer.id,
                        attributeName: attribute.name,
                        value: event.currentTarget.value
                      })
                    }
                  />
                </label>
              ))}
            </div>
          </div>
        ))}
      </section>

      <section className="property-card selector-card">
        <h3>{t("selector.diagnostics")}</h3>
        <div className="selector-validation-summary" data-status={selectedCandidate.validation.status}>
          <StatusIcon status={selectedCandidate.validation.status} />
          <span>{t(getSelectorValidationMessageKey(selectedCandidate.validation.status))}</span>
        </div>
        {selectedCandidate.score.risks.length === 0 ? (
          <p className="empty-copy">{t("selector.noRisks")}</p>
        ) : (
          selectedCandidate.score.risks.map((risk, index) => (
            <div className="selector-risk" key={`${risk.code}-${index}`}>
              <AlertTriangle size={13} />
              <span>{t(risk.messageKey)}</span>
            </div>
          ))
        )}
        {repairs.length > 0 ? (
          <div className="selector-repairs">
            <h3>{t("selector.repairs")}</h3>
            {repairs.map((repair, index) => (
              <button
                type="button"
                key={`${repair.code}-${repair.selector}-${index}`}
                onClick={() => onEdit(selectedCandidate, repair.edit)}
              >
                <CheckCircle2 size={13} />
                <span>{t("selector.repair.enableAttribute")}</span>
                <code>{repair.selector}</code>
              </button>
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}

function formatSelectorDiffLabel(change: SelectorDiffEntry): string {
  return change.attributeName
    ? `${change.layerId}.${change.attributeName}`
    : `${change.layerId}.${change.field}`;
}

function getSelectorValidationMessageKey(status: SelectorCandidate["validation"]["status"]): MessageKey {
  return `selector.validation.${status}`;
}

function StatusIcon({ status }: { status: SelectorCandidate["validation"]["status"] }): JSX.Element {
  if (status === "unique") {
    return <CheckCircle2 className="status-icon success" size={15} />;
  }

  return <AlertTriangle className={status === "multiple" ? "status-icon warning" : "status-icon danger"} size={15} />;
}

function Metric({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function getAncestorIds(rows: ElementSnapshot[], elementId: string): string[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const ancestorIds: string[] = [];
  let current = byId.get(elementId);

  while (current?.parentId) {
    ancestorIds.push(current.parentId);
    current = byId.get(current.parentId);
  }

  return ancestorIds;
}

function getTreeContentWidth(rows: ElementSnapshot[]): number {
  const minimumWidth = 900;
  const characterWidth = 7.4;
  return rows.reduce((width, row) => {
    const label = row.tagName ?? row.nodeName;
    const attributes = formatElementAttributes(row);
    const rowWidth = 72 + row.depth * 16 + (label.length + attributes.length) * characterWidth;
    return Math.max(width, Math.ceil(rowWidth));
  }, minimumWidth);
}

function flattenVisibleElementSnapshot(root: ElementSnapshot | null, collapsedNodeIds: Set<string>): ElementSnapshot[] {
  if (!root) {
    return [];
  }

  const rows: ElementSnapshot[] = [];
  const visit = (node: ElementSnapshot) => {
    rows.push(node);
    if (collapsedNodeIds.has(node.id)) {
      return;
    }
    node.children.forEach(visit);
  };

  visit(root);
  return rows;
}

function VirtualTree({
  collapsedNodeIds,
  onScrollTopChange,
  onSelect,
  onToggle,
  rows,
  searchMatchIds,
  scrollTop,
  selectedElementId
}: {
  collapsedNodeIds: Set<string>;
  onScrollTopChange: (value: number) => void;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  rows: ElementSnapshot[];
  searchMatchIds: Set<string>;
  scrollTop: number;
  selectedElementId: string | null;
}): JSX.Element {
  const { t } = useI18n();
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const startIndex = Math.max(0, Math.floor(scrollTop / TREE_ROW_HEIGHT) - TREE_OVERSCAN);
  const visibleCount = 90;
  const visibleRows = rows.slice(startIndex, startIndex + visibleCount);
  const treeContentWidth = useMemo(() => getTreeContentWidth(rows), [rows]);

  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) {
      return;
    }

    if (Math.abs(scrollContainer.scrollTop - scrollTop) > 1) {
      scrollContainer.scrollTop = scrollTop;
    }
  }, [scrollTop]);

  return (
    <div className="tree-list" ref={scrollContainerRef} onScroll={(event) => onScrollTopChange(event.currentTarget.scrollTop)}>
      <div className="tree-spacer" style={{ height: rows.length * TREE_ROW_HEIGHT, width: treeContentWidth }}>
        {visibleRows.map((row, index) => {
          const hasChildren = row.children.length > 0;
          const isCollapsed = collapsedNodeIds.has(row.id);
          const isSelectable = isTreeNodeSelectable(row);
          const isSelected = isSelectable && row.id === selectedElementId;
          const isSearchMatch = searchMatchIds.has(row.id);
          const badgeKey = getTreeNodeBadgeMessageKey(row);
          const badgeKind = badgeKey?.replace("tree.badge.", "");
          const diagnosticPresentation = row.diagnostic ? getDiagnosticPresentation(row.diagnostic) : null;
          const detail = diagnosticPresentation
            ? `${t(diagnosticPresentation.messageKey)} — ${diagnosticPresentation.detail}`
            : formatElementAttributes(row);
          const nodeContent = (
            <>
              <span className="tree-node-kind">
                <TreeNodeIcon node={row} />
                <span>{row.tagName ?? row.nodeName}</span>
                {badgeKey ? (
                  <span className="tree-kind-badge" data-kind={badgeKind}>
                    {t(badgeKey)}
                  </span>
                ) : null}
              </span>
              <small>{detail}</small>
            </>
          );
          return (
            <div
              className={["tree-row", isSelected ? "selected" : "", isSearchMatch ? "search-match" : ""].filter(Boolean).join(" ")}
              key={row.id}
              style={{
                paddingLeft: 6 + row.depth * 16,
                transform: `translateY(${(startIndex + index) * TREE_ROW_HEIGHT}px)`
              }}
            >
              <button
                type="button"
                className="tree-toggle"
                aria-label={isCollapsed ? "Expand node" : "Collapse node"}
                disabled={!hasChildren}
                onClick={() => onToggle(row.id)}
              >
                {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
              </button>
              {!isSelectable ? (
                <div className="tree-node-main diagnostic" role="note">
                  {nodeContent}
                </div>
              ) : (
                <button
                  type="button"
                  className={row.diagnostic ? "tree-node-main diagnostic" : "tree-node-main"}
                  onClick={() => onSelect(row.id)}
                >
                  {nodeContent}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ElementDetails({
  element,
  root
}: {
  element: ElementSnapshot | null;
  root: ElementSnapshot | null;
}): JSX.Element {
  const { t } = useI18n();
  const [attributeQuery, setAttributeQuery] = useState("");
  const attributeInsights = useMemo(
    () => analyzeElementAttributes(root, element?.id ?? null, attributeQuery),
    [attributeQuery, element?.id, root]
  );

  if (!element) {
    return <p className="empty-copy">{t("empty.properties")}</p>;
  }

  const bounds = element.boundingBox
    ? `${Math.round(element.boundingBox.x)}, ${Math.round(element.boundingBox.y)}, ${Math.round(element.boundingBox.width)} x ${Math.round(element.boundingBox.height)}`
    : "-";
  const context = element.context ?? [];
  const contextPaths = getContextPathLabels(context);
  const diagnosticPresentation = element.diagnostic ? getDiagnosticPresentation(element.diagnostic) : null;
  const visibilityMessageKey = getVisibilityMessageKey(element.visible);

  return (
    <div className="property-stack">
      <section className="property-card">
        <h3>{t("properties.selected")}</h3>
        <PropertyRow label={t("properties.tag")} value={element.tagName ?? "-"} />
        <PropertyRow label={t("properties.nodeName")} value={element.nodeName} />
        <PropertyRow label={t("properties.nodeType")} value={String(element.nodeType)} />
        <PropertyRow label={t("properties.text")} value={element.text || "-"} />
      </section>
      <section className="property-card">
        <h3>{t("properties.accessibility")}</h3>
        <PropertyRow label={t("properties.role")} value={element.role || "-"} />
        <PropertyRow label={t("properties.accessibleName")} value={element.accessibleName || "-"} />
        <PropertyRow label={t("properties.description")} value={element.description || "-"} />
        <PropertyRow label={t("properties.disabled")} value={formatBoolean(element.disabled, t)} />
        <PropertyRow label={t("properties.clickable")} value={formatBoolean(element.clickable, t)} />
        <PropertyRow
          label={t("properties.visible")}
          value={visibilityMessageKey ? t(visibilityMessageKey) : "-"}
        />
      </section>
      <section className="property-card">
        <h3>{t("properties.layout")}</h3>
        <PropertyRow label={t("properties.boundingBox")} value={bounds} />
        <PropertyRow label={t("properties.occluded")} value={formatBoolean(element.occluded, t)} />
        <PropertyRow
          label={t("properties.visibilityReasons")}
          value={element.visibilityReasons?.join(", ") || "-"}
        />
      </section>
      <section className="property-card">
        <h3>{t("properties.context")}</h3>
        <div className="context-path">
          <span>{t("properties.framePath")}</span>
          <code>{contextPaths.frame.join(" → ") || "-"}</code>
        </div>
        <div className="context-path">
          <span>{t("properties.shadowPath")}</span>
          <code>{contextPaths.shadow.join(" → ") || "-"}</code>
        </div>
      </section>
      {diagnosticPresentation ? (
        <section className="property-card context-diagnostic">
          <ShieldAlert size={15} />
          <div>
            <h3>{t(diagnosticPresentation.messageKey)}</h3>
            <p>{diagnosticPresentation.detail}</p>
          </div>
        </section>
      ) : null}
      <section className="property-card">
        <h3>{t("properties.attributes")}</h3>
        <label className="attribute-filter">
          <Search size={13} />
          <input
            value={attributeQuery}
            placeholder={t("properties.filterAttributes")}
            onChange={(event) => setAttributeQuery(event.currentTarget.value)}
          />
        </label>
        {attributeInsights.length === 0 ? (
          <PropertyRow label="-" value="-" />
        ) : (
          attributeInsights.map((attribute) => (
            <div className="attribute-insight" key={attribute.name}>
              <div className="property-row">
                <span>{attribute.name}</span>
                <strong>{attribute.value}</strong>
              </div>
              <div className="attribute-markers">
                {(attribute.markers.length > 0 ? attribute.markers : ["neutral" as const]).map((marker) => (
                  <span data-marker={marker} key={marker}>
                    {t(getAttributeMarkerMessageKey(marker))}
                  </span>
                ))}
              </div>
            </div>
          ))
        )}
      </section>
    </div>
  );
}

function PropertyRow({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="property-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function getAttributeMarkerMessageKey(marker: AttributeLocatorMarker | "neutral"): MessageKey {
  return `properties.attribute.${marker}`;
}

function formatBoolean(value: boolean | undefined, t: (key: MessageKey) => string): string {
  return typeof value === "boolean" ? t(value ? "properties.yes" : "properties.no") : "-";
}

function PanelTitle({ icon, title }: { icon: ReactNode; title: string }): JSX.Element {
  return (
    <div className="panel-title">
      {icon}
      <span>{title}</span>
    </div>
  );
}

function StatusPill({ children, status }: { children: ReactNode; status: "success" | "warning" | "danger" }): JSX.Element {
  return (
    <span className="status-pill" data-status={status}>
      <Gauge size={13} />
      {children}
    </span>
  );
}

function DiagnosticItem({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="diagnostic-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
