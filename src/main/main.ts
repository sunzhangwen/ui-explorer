import { app, BrowserWindow, dialog, globalShortcut, ipcMain, shell } from "electron";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  IPC_CHANNELS,
  TEST_PAGES,
  type AppInfo,
  type HighlightElementRequest,
  type HighlightElementsRequest,
  type TableExportSaveRequest,
  type TableExportSaveResult
} from "../shared/ipc.js";
import { isTableExportFormat } from "../shared/tableExport.js";
import {
  ensureTableFileExtension,
  getTableFileOptions,
  prepareTableFileContent,
  sanitizeTableExportBaseName
} from "../shared/tableFile.js";
import { BrowserSession } from "./browserSession.js";
import { discoverBrowserEndpoints } from "./browserDiscovery.js";

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
      preload: path.join(__dirname, "preload.cjs")
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
  ipcMain.handle(IPC_CHANNELS.discoverBrowserEndpoints, () => discoverBrowserEndpoints());
  ipcMain.handle(IPC_CHANNELS.connectBrowser, (_event, endpoint: string) => browserSession.connect(endpoint));
  ipcMain.handle(IPC_CHANNELS.refreshBrowserConnection, () => browserSession.refreshConnection());
  ipcMain.handle(IPC_CHANNELS.disconnectBrowser, () => {
    browserSession.disconnect();
  });
  ipcMain.handle(IPC_CHANNELS.listBrowserTargets, () => browserSession.listTargets());
  ipcMain.handle(IPC_CHANNELS.selectBrowserTarget, (_event, targetId: string) => browserSession.selectTarget(targetId));
  ipcMain.handle(IPC_CHANNELS.getDomSnapshot, () => browserSession.getDomSnapshot());
  ipcMain.handle(IPC_CHANNELS.highlightElement, (_event, request: HighlightElementRequest) =>
    browserSession.highlightElement(request)
  );
  ipcMain.handle(IPC_CHANNELS.highlightElements, (_event, request: HighlightElementsRequest) =>
    browserSession.highlightElements(request)
  );
  ipcMain.handle(IPC_CHANNELS.setElementPickerEnabled, (_event, enabled: boolean) => browserSession.setElementPickerEnabled(enabled));
  ipcMain.handle(IPC_CHANNELS.getPickedElementId, () => browserSession.getPickedElementId());
  ipcMain.handle(
    IPC_CHANNELS.saveTableExport,
    async (_event, request: TableExportSaveRequest): Promise<TableExportSaveResult> => {
      if (
        !request ||
        !isTableExportFormat(request.format) ||
        typeof request.content !== "string" ||
        typeof request.suggestedBaseName !== "string"
      ) {
        return { status: "error", message: "Invalid table export request." };
      }

      const options = getTableFileOptions(request.format);
      const result = await dialog.showSaveDialog({
        defaultPath: `${sanitizeTableExportBaseName(request.suggestedBaseName)}.${options.extension}`,
        filters: [{ name: options.label, extensions: [options.extension] }]
      });
      if (result.canceled || !result.filePath) {
        return { status: "cancelled" };
      }

      try {
        const filePath = ensureTableFileExtension(result.filePath, request.format);
        await writeFile(
          filePath,
          prepareTableFileContent(request.format, request.content),
          "utf8"
        );
        return { status: "saved", filePath };
      } catch (error) {
        return {
          status: "error",
          message: error instanceof Error ? error.message : String(error)
        };
      }
    }
  );
}

function registerCaptureShortcut(): void {
  const registered = globalShortcut.register("CommandOrControl+Shift+E", () => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(IPC_CHANNELS.captureRequested);
    }
  });
  if (!registered) {
    console.warn("[ui-explorer] unable to register capture shortcut");
  }
}

app.whenReady().then(() => {
  registerIpcHandlers();
  createWindow();
  registerCaptureShortcut();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
