import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  findElementSnapshot,
  restoreElementSelection,
  type ElementSelectionRestoreResult
} from "../../shared/domSnapshot";
import {
  captureHighlightRequest,
  isHighlightRequestCurrent,
  mergeCurrentHighlightResult
} from "../../shared/highlightDiagnostics";
import {
  TEST_PAGES,
  type AppInfo,
  type BrowserConnectionDiagnostics,
  type BrowserConnectionInfo,
  type BrowserDebugEndpoint,
  type BrowserTarget,
  type DomSnapshotResult,
  type ElementSnapshot,
  type IpcApi,
  type Locale,
  type TableExportSaveRequest,
  type TableExportSaveResult,
  type TestPage,
  type ThemeName
} from "../../shared/ipc";
import { isTreeNodeHighlightable } from "../components/workbenchPresentation";

type PanelSizes = {
  left: number;
  right: number;
};

export type RightPanelSectionId = "diagnostics" | "snapshot" | "element" | "selector" | "table" | "export";

type RightPanelSections = Record<RightPanelSectionId, boolean>;

type IpcStatus =
  | { state: "idle" }
  | { state: "ready"; message: string }
  | { state: "error"; message: string };

type BrowserConnectionStatus =
  | { state: "idle" }
  | { state: "connecting"; endpoint: string }
  | { state: "connected"; endpoint: string; message: string; diagnostics?: BrowserConnectionDiagnostics }
  | { state: "error"; endpoint: string; message: string };

type AppStore = {
  locale: Locale;
  theme: ThemeName;
  density: "comfortable" | "compact";
  panelSizes: PanelSizes;
  rightPanelSections: RightPanelSections;
  ipcStatus: IpcStatus;
  appInfo: AppInfo | null;
  testPages: TestPage[];
  browserDebugEndpoints: BrowserDebugEndpoint[];
  isDiscoveringBrowserEndpoints: boolean;
  selectedTestPageId: string | null;
  browserConnection: BrowserConnectionStatus;
  browserTargets: BrowserTarget[];
  selectedBrowserTargetId: string | null;
  domSnapshot: DomSnapshotResult | null;
  domSnapshotGeneration: number;
  selectedElementId: string | null;
  selectionRecovery: ElementSelectionRestoreResult | null;
  setLocale: (locale: Locale) => void;
  setTheme: (theme: ThemeName) => void;
  setDensity: (density: "comfortable" | "compact") => void;
  setPanelSize: (panel: keyof PanelSizes, width: number) => void;
  toggleRightPanelSection: (section: RightPanelSectionId) => void;
  selectTestPage: (id: string) => void;
  discoverBrowserEndpoints: () => Promise<void>;
  connectBrowser: (endpoint: string) => Promise<void>;
  monitorBrowserConnection: () => Promise<void>;
  disconnectBrowser: () => Promise<void>;
  refreshDomSnapshot: () => Promise<void>;
  selectBrowserTarget: (targetId: string) => Promise<void>;
  selectElement: (elementId: string) => Promise<void>;
  highlightElements: (elementIds: string[]) => Promise<void>;
  setElementPickerEnabled: (enabled: boolean) => Promise<void>;
  getPickedElementId: () => Promise<string | null>;
  subscribeCaptureRequested: (listener: () => void) => () => void;
  saveTableExport: (request: TableExportSaveRequest) => Promise<TableExportSaveResult>;
  initialize: () => Promise<void>;
};

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);

const defaultRightPanelSections: RightPanelSections = {
  diagnostics: false,
  snapshot: true,
  element: true,
  selector: true,
  table: true,
  export: false
};

let connectionMonitorInFlight = false;

export const useAppStore = create<AppStore>()(
  persist(
    (set, get) => ({
      locale: "zh-CN",
      theme: "dark",
      density: "comfortable",
      panelSizes: {
        left: 312,
        right: 360
      },
      rightPanelSections: defaultRightPanelSections,
      ipcStatus: { state: "idle" },
      appInfo: null,
      testPages: [],
      browserDebugEndpoints: [],
      isDiscoveringBrowserEndpoints: false,
      selectedTestPageId: null,
      browserConnection: { state: "idle" },
      browserTargets: [],
      selectedBrowserTargetId: null,
      domSnapshot: null,
      domSnapshotGeneration: 0,
      selectedElementId: null,
      selectionRecovery: null,
      setLocale: (locale) => set({ locale }),
      setTheme: (theme) => set({ theme }),
      setDensity: (density) => set({ density }),
      setPanelSize: (panel, width) =>
        set((state) => ({
          panelSizes: {
            ...state.panelSizes,
            [panel]: clamp(width, panel === "left" ? 240 : 300, panel === "left" ? 520 : 560)
          }
        })),
      toggleRightPanelSection: (section) =>
        set((state) => ({
          rightPanelSections: {
            ...defaultRightPanelSections,
            ...state.rightPanelSections,
            [section]: !(state.rightPanelSections[section] ?? defaultRightPanelSections[section])
          }
        })),
      selectTestPage: (id) => set({ selectedTestPageId: id }),
      discoverBrowserEndpoints: async () => {
        set({ isDiscoveringBrowserEndpoints: true });
        try {
          const browserDebugEndpoints = await getApi().discoverBrowserEndpoints();
          set({ browserDebugEndpoints, isDiscoveringBrowserEndpoints: false });
        } catch {
          set({ browserDebugEndpoints: [], isDiscoveringBrowserEndpoints: false });
        }
      },
      connectBrowser: async (endpoint) => {
        const api = getApi();
        set({ browserConnection: { state: "connecting", endpoint } });
        try {
          const info = await api.connectBrowser(endpoint);
          const snapshot = info.targetId ? await api.getDomSnapshot() : emptySnapshot();
          setConnectionInfo(set, info, snapshot);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          set({
            browserConnection: { state: "error", endpoint, message },
            domSnapshot: null,
            domSnapshotGeneration: get().domSnapshotGeneration + 1,
            selectedElementId: null,
            selectionRecovery: null
          });
        }
      },
      monitorBrowserConnection: async () => {
        const current = get();
        if (current.browserConnection.state !== "connected" || connectionMonitorInFlight) {
          return;
        }
        connectionMonitorInFlight = true;
        const requestEndpoint = current.browserConnection.endpoint;
        const requestTargetId = current.selectedBrowserTargetId;
        const isCurrentRequest = () => {
          const latest = get();
          return (
            latest.browserConnection.state === "connected" &&
            latest.browserConnection.endpoint === requestEndpoint &&
            latest.selectedBrowserTargetId === requestTargetId
          );
        };
        try {
          const info = await getApi().refreshBrowserConnection();
          if (!isCurrentRequest()) {
            return;
          }
          if (!info.targetId) {
            set((state) => ({
              browserConnection: {
                state: "connected",
                endpoint: info.endpoint,
                message: info.status,
                diagnostics: info.diagnostics
              },
              browserTargets: info.targets,
              selectedBrowserTargetId: null,
              domSnapshot: null,
              domSnapshotGeneration: state.domSnapshotGeneration + 1,
              selectedElementId: null,
              selectionRecovery: null
            }));
            return;
          }

          const targetChanged =
            info.targetId !== current.selectedBrowserTargetId ||
            info.status === "reconnected" ||
            info.status === "navigated";
          if (!targetChanged) {
            set({
              browserConnection: {
                state: "connected",
                endpoint: info.endpoint,
                message: info.status,
                diagnostics: info.diagnostics
              },
              browserTargets: info.targets
            });
            return;
          }

          const snapshot = await getApi().getDomSnapshot();
          if (!isCurrentRequest()) {
            return;
          }
          set((state) => {
            const recovery = state.selectedElementId
              ? restoreElementSelection(state.domSnapshot?.root ?? null, snapshot.root, state.selectedElementId)
              : null;
            return {
              browserConnection: {
                state: "connected",
                endpoint: info.endpoint,
                message: info.status,
                diagnostics: info.diagnostics
              },
              browserTargets: info.targets,
              selectedBrowserTargetId: info.targetId,
              domSnapshot: snapshot,
              domSnapshotGeneration: state.domSnapshotGeneration + 1,
              selectedElementId: recovery?.elementId ?? snapshot.root?.id ?? null,
              selectionRecovery: recovery
            };
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (isCurrentRequest()) {
            set({
              browserConnection: {
                state: "connected",
                endpoint: requestEndpoint,
                message: "reconnecting"
              }
            });
            console.warn("[ui-explorer] connection monitor retrying", message);
          }
        } finally {
          connectionMonitorInFlight = false;
        }
      },
      disconnectBrowser: async () => {
        const api = getApi();
        await api.disconnectBrowser();
        set((state) => ({
          browserConnection: { state: "idle" },
          browserTargets: [],
          selectedBrowserTargetId: null,
          domSnapshot: null,
          domSnapshotGeneration: state.domSnapshotGeneration + 1,
          selectedElementId: null,
          selectionRecovery: null
        }));
      },
      refreshDomSnapshot: async () => {
        const api = getApi();
        try {
          const snapshot = await api.getDomSnapshot();
          set((state) => {
            const recovery = state.selectedElementId
              ? restoreElementSelection(state.domSnapshot?.root ?? null, snapshot.root, state.selectedElementId)
              : null;
            return {
              domSnapshot: snapshot,
              domSnapshotGeneration: state.domSnapshotGeneration + 1,
              selectedElementId: recovery?.elementId ?? snapshot.root?.id ?? null,
              selectionRecovery: recovery
            };
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const currentConnection = get().browserConnection;
          const endpoint = currentConnection.state === "idle" ? "" : currentConnection.endpoint;
          set({ browserConnection: { state: "error", endpoint, message } });
        }
      },
      selectBrowserTarget: async (targetId) => {
        const api = getApi();
        const snapshot = await api.selectBrowserTarget(targetId);
        set((state) => ({
          selectedBrowserTargetId: targetId,
          domSnapshot: snapshot,
          domSnapshotGeneration: state.domSnapshotGeneration + 1,
          selectedElementId: snapshot.root?.id ?? null,
          selectionRecovery: null
        }));
      },
      selectElement: async (elementId) => {
        set({ selectedElementId: elementId });
        const requestState = get();
        const selectedElement = findElementSnapshot(requestState.domSnapshot?.root ?? null, elementId);
        if (!selectedElement || !isTreeNodeHighlightable(selectedElement)) {
          return;
        }
        const request = captureHighlightRequest(
          requestState.domSnapshot,
          requestState.selectedBrowserTargetId,
          requestState.domSnapshotGeneration
        );
        try {
          const result = await getApi().highlightElement({
            elementId,
            snapshotToken: request?.snapshotToken ?? null
          });
          set((state) => {
            const domSnapshot = mergeCurrentHighlightResult(
              state.domSnapshot,
              state.selectedBrowserTargetId,
              state.domSnapshotGeneration,
              request,
              result
            );
            return domSnapshot === state.domSnapshot ? state : { domSnapshot };
          });
        } catch (error) {
          const currentState = get();
          if (
            !isHighlightRequestCurrent(
              currentState.domSnapshot,
              currentState.selectedBrowserTargetId,
              currentState.domSnapshotGeneration,
              request
            )
          ) {
            return;
          }
          const message = error instanceof Error ? error.message : String(error);
          const currentConnection = get().browserConnection;
          const endpoint = currentConnection.state === "idle" ? "" : currentConnection.endpoint;
          set({ browserConnection: { state: "error", endpoint, message } });
        }
      },
      highlightElements: async (elementIds) => {
        const requestState = get();
        const request = captureHighlightRequest(
          requestState.domSnapshot,
          requestState.selectedBrowserTargetId,
          requestState.domSnapshotGeneration
        );
        try {
          const result = await getApi().highlightElements({
            elementIds,
            snapshotToken: request?.snapshotToken ?? null
          });
          set((state) => {
            const domSnapshot = mergeCurrentHighlightResult(
              state.domSnapshot,
              state.selectedBrowserTargetId,
              state.domSnapshotGeneration,
              request,
              result
            );
            return domSnapshot === state.domSnapshot ? state : { domSnapshot };
          });
        } catch (error) {
          const currentState = get();
          if (
            !isHighlightRequestCurrent(
              currentState.domSnapshot,
              currentState.selectedBrowserTargetId,
              currentState.domSnapshotGeneration,
              request
            )
          ) {
            return;
          }
          const message = error instanceof Error ? error.message : String(error);
          const currentConnection = get().browserConnection;
          const endpoint = currentConnection.state === "idle" ? "" : currentConnection.endpoint;
          set({ browserConnection: { state: "error", endpoint, message } });
        }
      },
      setElementPickerEnabled: async (enabled) => {
        try {
          await getApi().setElementPickerEnabled(enabled);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const currentConnection = get().browserConnection;
          const endpoint = currentConnection.state === "idle" ? "" : currentConnection.endpoint;
          set({ browserConnection: { state: "error", endpoint, message } });
        }
      },
      getPickedElementId: async () => getApi().getPickedElementId(),
      subscribeCaptureRequested: (listener) => getApi().onCaptureRequested(listener),
      saveTableExport: async (request) => getApi().saveTableExport(request),
      initialize: async () => {
        try {
          const api = getApi();
          const [message, appInfo, testPages] = await Promise.all([
            api.ping(),
            api.getAppInfo(),
            api.listTestPages()
          ]);

          set({
            ipcStatus: { state: "ready", message },
            appInfo,
            testPages,
            selectedTestPageId: get().selectedTestPageId ?? testPages[0]?.id ?? null
          });
          await get().discoverBrowserEndpoints();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          set({ ipcStatus: { state: "error", message } });
        }
      }
    }),
    {
      name: "ui-explorer-workbench",
      partialize: (state) => ({
        locale: state.locale,
        theme: state.theme,
        density: state.density,
        panelSizes: state.panelSizes,
        rightPanelSections: state.rightPanelSections,
        selectedTestPageId: state.selectedTestPageId
      }),
      merge: (persisted, current) => {
        const persistedState = persisted as Partial<AppStore>;
        return {
          ...current,
          ...persistedState,
          panelSizes: {
            ...current.panelSizes,
            ...persistedState.panelSizes
          },
          rightPanelSections: {
            ...defaultRightPanelSections,
            ...persistedState.rightPanelSections
          }
        };
      }
    }
  )
);

function getApi(): IpcApi {
  const fallbackApi: IpcApi = {
    ping: async () => {
      throw new Error("Electron preload is not available.");
    },
    getAppInfo: async () => ({
      name: "UI Explorer",
      version: "0.0.1",
      platform: navigator.platform,
      electron: "not-loaded"
    }),
    listTestPages: async () => TEST_PAGES,
    discoverBrowserEndpoints: async () => [],
    connectBrowser: async () => {
      throw new Error("Electron IPC is not available. Please run UI Explorer with npm.cmd run dev.");
    },
    refreshBrowserConnection: async () => ({
      endpoint: "",
      connected: false,
      status: "target-closed",
      targetId: null,
      targets: []
    }),
    disconnectBrowser: async () => undefined,
    listBrowserTargets: async () => [],
    selectBrowserTarget: async () => emptySnapshot(),
    getDomSnapshot: async () => emptySnapshot(),
    highlightElement: async () => ({ targets: [] }),
    highlightElements: async () => ({ targets: [] }),
    setElementPickerEnabled: async () => undefined,
    getPickedElementId: async () => null,
    onCaptureRequested: () => () => undefined,
    saveTableExport: async () => ({
      status: "error",
      message: "Electron IPC is not available."
    })
  };

  return window.uiExplorer ?? fallbackApi;
}

function emptySnapshot(): DomSnapshotResult {
  return {
    root: null,
    capturedAt: new Date().toISOString(),
    nodeCount: 0
  };
}

function setConnectionInfo(
  set: (
    state:
      | Partial<AppStore>
      | ((current: AppStore) => Partial<AppStore>)
  ) => void,
  info: BrowserConnectionInfo,
  snapshot: DomSnapshotResult
): void {
  set((state) => ({
    browserConnection: {
      state: "connected",
      endpoint: info.endpoint,
      message: info.status,
      diagnostics: info.diagnostics
    },
    browserTargets: info.targets,
    selectedBrowserTargetId: info.targetId,
    domSnapshot: snapshot,
    domSnapshotGeneration: state.domSnapshotGeneration + 1,
    selectedElementId: snapshot.root?.id ?? null,
    selectionRecovery: null
  }));
}

export type { ElementSnapshot };
