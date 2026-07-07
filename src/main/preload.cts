import type { IpcApi } from "../shared/ipc.js";

const { contextBridge, ipcRenderer } = require("electron") as typeof import("electron");

const IPC_CHANNELS = {
  ping: "app:ping",
  getAppInfo: "app:get-info",
  listTestPages: "test-pages:list",
  connectBrowser: "browser:connect",
  disconnectBrowser: "browser:disconnect",
  listBrowserTargets: "browser:list-targets",
  selectBrowserTarget: "browser:select-target",
  getDomSnapshot: "browser:get-dom-snapshot",
  highlightElement: "browser:highlight-element",
  highlightElements: "browser:highlight-elements"
} as const;

const api: IpcApi = {
  ping: () => ipcRenderer.invoke(IPC_CHANNELS.ping),
  getAppInfo: () => ipcRenderer.invoke(IPC_CHANNELS.getAppInfo),
  listTestPages: () => ipcRenderer.invoke(IPC_CHANNELS.listTestPages),
  connectBrowser: (endpoint) => ipcRenderer.invoke(IPC_CHANNELS.connectBrowser, endpoint),
  disconnectBrowser: () => ipcRenderer.invoke(IPC_CHANNELS.disconnectBrowser),
  listBrowserTargets: () => ipcRenderer.invoke(IPC_CHANNELS.listBrowserTargets),
  selectBrowserTarget: (targetId) => ipcRenderer.invoke(IPC_CHANNELS.selectBrowserTarget, targetId),
  getDomSnapshot: () => ipcRenderer.invoke(IPC_CHANNELS.getDomSnapshot),
  highlightElement: (elementId) => ipcRenderer.invoke(IPC_CHANNELS.highlightElement, elementId),
  highlightElements: (elementIds) => ipcRenderer.invoke(IPC_CHANNELS.highlightElements, elementIds)
};

contextBridge.exposeInMainWorld("uiExplorer", api);
