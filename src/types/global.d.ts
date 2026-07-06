import type { IpcApi } from "../shared/ipc";

declare global {
  interface Window {
    uiExplorer?: IpcApi;
  }
}

export {};
