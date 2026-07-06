import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  TEST_PAGES,
  type AppInfo,
  type BrowserConnectionInfo,
  type BrowserTarget,
  type DomSnapshotResult,
  type ElementSnapshot,
  type IpcApi,
  type Locale,
  type TestPage,
  type ThemeName
} from "../../shared/ipc";

type PanelSizes = {
  left: number;
  right: number;
};

type IpcStatus =
  | { state: "idle" }
  | { state: "ready"; message: string }
  | { state: "error"; message: string };

type BrowserConnectionStatus =
  | { state: "idle" }
  | { state: "connecting"; endpoint: string }
  | { state: "connected"; endpoint: string; message: string }
  | { state: "error"; endpoint: string; message: string };

type AppStore = {
  locale: Locale;
  theme: ThemeName;
  density: "comfortable" | "compact";
  panelSizes: PanelSizes;
  ipcStatus: IpcStatus;
  appInfo: AppInfo | null;
  testPages: TestPage[];
  selectedTestPageId: string | null;
  browserConnection: BrowserConnectionStatus;
  browserTargets: BrowserTarget[];
  selectedBrowserTargetId: string | null;
  domSnapshot: DomSnapshotResult | null;
  selectedElementId: string | null;
  setLocale: (locale: Locale) => void;
  setTheme: (theme: ThemeName) => void;
  setDensity: (density: "comfortable" | "compact") => void;
  setPanelSize: (panel: keyof PanelSizes, width: number) => void;
  selectTestPage: (id: string) => void;
  connectBrowser: (endpoint: string) => Promise<void>;
  disconnectBrowser: () => Promise<void>;
  refreshDomSnapshot: () => Promise<void>;
  selectBrowserTarget: (targetId: string) => Promise<void>;
  selectElement: (elementId: string) => Promise<void>;
  highlightElements: (elementIds: string[]) => Promise<void>;
  initialize: () => Promise<void>;
};

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);

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
      ipcStatus: { state: "idle" },
      appInfo: null,
      testPages: [],
      selectedTestPageId: null,
      browserConnection: { state: "idle" },
      browserTargets: [],
      selectedBrowserTargetId: null,
      domSnapshot: null,
      selectedElementId: null,
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
      selectTestPage: (id) => set({ selectedTestPageId: id }),
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
            selectedElementId: null
          });
        }
      },
      disconnectBrowser: async () => {
        const api = getApi();
        await api.disconnectBrowser();
        set({
          browserConnection: { state: "idle" },
          browserTargets: [],
          selectedBrowserTargetId: null,
          domSnapshot: null,
          selectedElementId: null
        });
      },
      refreshDomSnapshot: async () => {
        const api = getApi();
        try {
          const snapshot = await api.getDomSnapshot();
          set({ domSnapshot: snapshot, selectedElementId: snapshot.root?.id ?? null });
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
        set({
          selectedBrowserTargetId: targetId,
          domSnapshot: snapshot,
          selectedElementId: snapshot.root?.id ?? null
        });
      },
      selectElement: async (elementId) => {
        set({ selectedElementId: elementId });
        try {
          await getApi().highlightElement(elementId);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const currentConnection = get().browserConnection;
          const endpoint = currentConnection.state === "idle" ? "" : currentConnection.endpoint;
          set({ browserConnection: { state: "error", endpoint, message } });
        }
      },
      highlightElements: async (elementIds) => {
        try {
          await getApi().highlightElements(elementIds);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const currentConnection = get().browserConnection;
          const endpoint = currentConnection.state === "idle" ? "" : currentConnection.endpoint;
          set({ browserConnection: { state: "error", endpoint, message } });
        }
      },
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
        selectedTestPageId: state.selectedTestPageId
      })
    }
  )
);

function getApi(): IpcApi {
  const fallbackApi: IpcApi = {
    ping: async () => "browser-fallback",
    getAppInfo: async () => ({
      name: "UI Explorer",
      version: "0.0.1",
      platform: navigator.platform,
      electron: "not-loaded"
    }),
    listTestPages: async () => TEST_PAGES,
    connectBrowser: async (endpoint) => ({
      endpoint,
      connected: false,
      targetId: null,
      targets: []
    }),
    disconnectBrowser: async () => undefined,
    listBrowserTargets: async () => [],
    selectBrowserTarget: async () => emptySnapshot(),
    getDomSnapshot: async () => emptySnapshot(),
    highlightElement: async () => undefined,
    highlightElements: async () => undefined
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
  set: (state: Partial<AppStore>) => void,
  info: BrowserConnectionInfo,
  snapshot: DomSnapshotResult
): void {
  set({
    browserConnection: {
      state: "connected",
      endpoint: info.endpoint,
      message: info.targets.length > 0 ? "connected" : "no-targets"
    },
    browserTargets: info.targets,
    selectedBrowserTargetId: info.targetId,
    domSnapshot: snapshot,
    selectedElementId: snapshot.root?.id ?? null
  });
}

export type { ElementSnapshot };
