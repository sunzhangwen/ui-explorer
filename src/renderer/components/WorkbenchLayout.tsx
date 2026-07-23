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
  Waypoints
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent, ReactNode } from "react";
import { findElementSnapshot, flattenElementSnapshot, formatElementAttributes } from "../../shared/domSnapshot";
import type { ElementSnapshot, SnapshotDiagnostic } from "../../shared/ipc";
import {
  applySelectorEdit,
  buildSelectorExports,
  buildUnavailableContextExports,
  generateSelectorCandidates,
  type SelectorCandidate,
  type SelectorEdit,
  type SelectorExports,
  type SelectorLayer
} from "../../shared/selector";
import { useI18n } from "../i18n/I18nProvider";
import type { MessageKey } from "../i18n/messages";
import { useAppStore } from "../store/useAppStore";
import {
  findTreeSearchMatches,
  getContextPathLabels,
  getDiagnosticPresentation,
  getSelectorLayerMessageKey,
  getTreeNodeBadgeMessageKey,
  getTreeNodePresentationKind,
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
  return <Box size={13} />;
}

export function WorkbenchLayout(): JSX.Element {
  const { t } = useI18n();
  const {
    appInfo,
    browserConnection,
    browserTargets,
    connectBrowser,
    density,
    disconnectBrowser,
    domSnapshot,
    ipcStatus,
    locale,
    panelSizes,
    refreshDomSnapshot,
    selectBrowserTarget,
    selectElement,
    highlightElements,
    getPickedElementId,
    rightPanelSections,
    selectedBrowserTargetId,
    selectedElementId,
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
    () => (activeCandidateId ? selectorDrafts[activeCandidateId] ?? selectorCandidates.find((candidate) => candidate.id === activeCandidateId) ?? null : null),
    [activeCandidateId, selectorCandidates, selectorDrafts]
  );
  const selectorExports = useMemo(
    () =>
      selectedCandidate
        ? buildSelectorExports(selectedCandidate)
        : selectedElement?.diagnostic
          ? buildUnavailableContextExports(selectedElement)
          : null,
    [selectedCandidate, selectedElement]
  );
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
  const selectedTargetSummary = selectedTarget?.title || selectedTarget?.url || "-";
  const selectedTestSummary = selectedPage ? t(selectedPage.titleKey) : "-";

  return (
    <div className="app-shell" data-density={density}>
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">
            <Waypoints size={18} />
          </div>
          <div>
            <h1>{t("app.title")}</h1>
            <p>{t("diagnostics.phase")}</p>
          </div>
        </div>

        <div className="target-control" role="group" aria-label={t("connection.debugPort")}>
          <Globe2 size={16} />
          <input
            aria-label={t("connection.debugPort")}
            value={debugEndpoint}
            placeholder={t("toolbar.targetPlaceholder")}
            onChange={(event) => setDebugEndpoint(event.target.value)}
          />
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
            </section>
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
                <button
                  type="button"
                  className={page.id === selectedPage?.id ? "test-page selected" : "test-page"}
                  key={page.id}
                  onClick={() => selectTestPage(page.id)}
                >
                  <span>{t(page.titleKey)}</span>
                  <small>{t(page.descriptionKey)}</small>
                </button>
              ))}
            </div>
          </CollapsibleSection>
        </aside>

        <div className="resize-handle" role="separator" aria-orientation="vertical" onPointerDown={beginResize("left")} />

        <section className="center-panel">
          <div className="panel-strip">
            <PanelTitle icon={<Columns3 size={15} />} title={t("panel.explorer")} />
            <div className="strip-actions">
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
            <ElementDetails element={selectedElement} />
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
              selectedCandidate={selectedCandidate}
              selectedCandidateId={activeCandidateId}
              drafts={selectorDrafts}
              onSelectCandidate={setSelectedCandidateId}
              onEdit={editSelector}
            />
          </CollapsibleSection>

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
  onEdit,
  onSelectCandidate,
  selectedCandidate,
  selectedCandidateId
}: {
  candidates: SelectorCandidate[];
  diagnostic?: SnapshotDiagnostic;
  drafts: Record<string, SelectorCandidate>;
  onEdit: (candidate: SelectorCandidate, edit: SelectorEdit) => void;
  onSelectCandidate: (id: string) => void;
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
        <div className="selector-headline">
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
      </section>
    </div>
  );
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

function ElementDetails({ element }: { element: ElementSnapshot | null }): JSX.Element {
  const { t } = useI18n();

  if (!element) {
    return <p className="empty-copy">{t("empty.properties")}</p>;
  }

  const bounds = element.boundingBox
    ? `${Math.round(element.boundingBox.x)}, ${Math.round(element.boundingBox.y)}, ${Math.round(element.boundingBox.width)} x ${Math.round(element.boundingBox.height)}`
    : "-";
  const attributeEntries = Object.entries(element.attributes);
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
        <PropertyRow
          label={t("properties.visible")}
          value={visibilityMessageKey ? t(visibilityMessageKey) : "-"}
        />
      </section>
      <section className="property-card">
        <h3>{t("properties.layout")}</h3>
        <PropertyRow label={t("properties.boundingBox")} value={bounds} />
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
        {attributeEntries.length === 0 ? (
          <PropertyRow label="-" value="-" />
        ) : (
          attributeEntries.map(([name, value]) => <PropertyRow key={name} label={name} value={value} />)
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
