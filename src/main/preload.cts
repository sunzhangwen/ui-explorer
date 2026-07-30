import type { IpcApi } from "../shared/ipc.js";

const { contextBridge, ipcRenderer } = require("electron") as typeof import("electron");

const IPC_CHANNELS = {
  ping: "app:ping",
  getAppInfo: "app:get-info",
  listTestPages: "test-pages:list",
  openChromePage: "browser:open-page",
  openChromePageProgress: "browser:open-page-progress",
  discoverBrowserEndpoints: "browser:discover-endpoints",
  connectBrowser: "browser:connect",
  refreshBrowserConnection: "browser:refresh-connection",
  disconnectBrowser: "browser:disconnect",
  listBrowserTargets: "browser:list-targets",
  selectBrowserTarget: "browser:select-target",
  getDomSnapshot: "browser:get-dom-snapshot",
  highlightElement: "browser:highlight-element",
  highlightElements: "browser:highlight-elements",
  setElementPickerEnabled: "browser:set-element-picker-enabled",
  getPickedElementId: "browser:get-picked-element-id",
  captureRequested: "browser:capture-requested",
  saveTableExport: "table:save-export"
} as const;

const api: IpcApi = {
  ping: () => ipcRenderer.invoke(IPC_CHANNELS.ping),
  getAppInfo: () => ipcRenderer.invoke(IPC_CHANNELS.getAppInfo),
  listTestPages: () => ipcRenderer.invoke(IPC_CHANNELS.listTestPages),
  openChromePage: (request) => ipcRenderer.invoke(IPC_CHANNELS.openChromePage, request),
  onOpenChromePageProgress: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: Parameters<typeof listener>[0]) =>
      listener(progress);
    ipcRenderer.on(IPC_CHANNELS.openChromePageProgress, handler);
    return () => ipcRenderer.off(IPC_CHANNELS.openChromePageProgress, handler);
  },
  discoverBrowserEndpoints: () => ipcRenderer.invoke(IPC_CHANNELS.discoverBrowserEndpoints),
  connectBrowser: (endpoint) => ipcRenderer.invoke(IPC_CHANNELS.connectBrowser, endpoint),
  refreshBrowserConnection: () => ipcRenderer.invoke(IPC_CHANNELS.refreshBrowserConnection),
  disconnectBrowser: () => ipcRenderer.invoke(IPC_CHANNELS.disconnectBrowser),
  listBrowserTargets: () => ipcRenderer.invoke(IPC_CHANNELS.listBrowserTargets),
  selectBrowserTarget: (targetId) => ipcRenderer.invoke(IPC_CHANNELS.selectBrowserTarget, targetId),
  getDomSnapshot: () => ipcRenderer.invoke(IPC_CHANNELS.getDomSnapshot),
  highlightElement: (request) => ipcRenderer.invoke(IPC_CHANNELS.highlightElement, request),
  highlightElements: (request) => ipcRenderer.invoke(IPC_CHANNELS.highlightElements, request),
  setElementPickerEnabled: (enabled) => ipcRenderer.invoke(IPC_CHANNELS.setElementPickerEnabled, enabled),
  getPickedElementId: () => ipcRenderer.invoke(IPC_CHANNELS.getPickedElementId),
  onCaptureRequested: (listener) => {
    const handler = () => listener();
    ipcRenderer.on(IPC_CHANNELS.captureRequested, handler);
    return () => ipcRenderer.off(IPC_CHANNELS.captureRequested, handler);
  },
  saveTableExport: (request) => ipcRenderer.invoke(IPC_CHANNELS.saveTableExport, request)
};

contextBridge.exposeInMainWorld("uiExplorer", api);
