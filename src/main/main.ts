import { app, BrowserWindow, ipcMain, shell } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { IPC_CHANNELS, TEST_PAGES, type AppInfo } from "../shared/ipc.js";
import { BrowserSession } from "./browserSession.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
const browserSession = new BrowserSession();

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    title: "UI Explorer",
    backgroundColor: "#0f1412",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js")
    }
  });

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    void mainWindow.loadFile(path.join(__dirname, "../../dist/index.html"));
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
}

function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.ping, () => "pong");

  ipcMain.handle(IPC_CHANNELS.getAppInfo, (): AppInfo => {
    return {
      name: app.getName(),
      version: app.getVersion(),
      platform: process.platform,
      electron: process.versions.electron
    };
  });

  ipcMain.handle(IPC_CHANNELS.listTestPages, () => TEST_PAGES);
  ipcMain.handle(IPC_CHANNELS.connectBrowser, (_event, endpoint: string) => browserSession.connect(endpoint));
  ipcMain.handle(IPC_CHANNELS.disconnectBrowser, () => {
    browserSession.disconnect();
  });
  ipcMain.handle(IPC_CHANNELS.listBrowserTargets, () => browserSession.listTargets());
  ipcMain.handle(IPC_CHANNELS.selectBrowserTarget, (_event, targetId: string) => browserSession.selectTarget(targetId));
  ipcMain.handle(IPC_CHANNELS.getDomSnapshot, () => browserSession.getDomSnapshot());
  ipcMain.handle(IPC_CHANNELS.highlightElement, (_event, elementId: string) => browserSession.highlightElement(elementId));
  ipcMain.handle(IPC_CHANNELS.highlightElements, (_event, elementIds: string[]) => browserSession.highlightElements(elementIds));
}

app.whenReady().then(() => {
  registerIpcHandlers();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
