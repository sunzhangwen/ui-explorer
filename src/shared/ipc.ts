export type ThemeName = "light" | "dark";
export type Locale = "zh-CN" | "en-US";

export type AppInfo = {
  name: string;
  version: string;
  platform: string;
  electron: string;
};

export type TestPage = {
  id: string;
  titleKey: string;
  descriptionKey: string;
  path: string;
};

export type BrowserTarget = {
  id: string;
  title: string;
  url: string;
  type: string;
  webSocketDebuggerUrl?: string;
};

export type BoundingBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ElementSnapshot = {
  id: string;
  parentId?: string;
  depth: number;
  nodeType: number;
  nodeName: string;
  tagName?: string;
  nodeValue?: string;
  text?: string;
  role?: string;
  visible?: boolean;
  boundingBox?: BoundingBox;
  attributes: Record<string, string>;
  childIds: string[];
  children: ElementSnapshot[];
};

export type DomSnapshotResult = {
  root: ElementSnapshot | null;
  capturedAt: string;
  nodeCount: number;
};

export type BrowserConnectionInfo = {
  endpoint: string;
  connected: boolean;
  targetId: string | null;
  targets: BrowserTarget[];
};

export type IpcApi = {
  ping: () => Promise<string>;
  getAppInfo: () => Promise<AppInfo>;
  listTestPages: () => Promise<TestPage[]>;
  connectBrowser: (endpoint: string) => Promise<BrowserConnectionInfo>;
  disconnectBrowser: () => Promise<void>;
  listBrowserTargets: () => Promise<BrowserTarget[]>;
  selectBrowserTarget: (targetId: string) => Promise<DomSnapshotResult>;
  getDomSnapshot: () => Promise<DomSnapshotResult>;
  highlightElement: (elementId: string) => Promise<void>;
  highlightElements: (elementIds: string[]) => Promise<void>;
};

export const TEST_PAGES: TestPage[] = [
  {
    id: "basic-dom",
    titleKey: "testPages.basicDom.title",
    descriptionKey: "testPages.basicDom.description",
    path: "/test-pages/basic-dom.html"
  },
  {
    id: "iframe",
    titleKey: "testPages.iframe.title",
    descriptionKey: "testPages.iframe.description",
    path: "/test-pages/iframe.html"
  },
  {
    id: "shadow-dom",
    titleKey: "testPages.shadowDom.title",
    descriptionKey: "testPages.shadowDom.description",
    path: "/test-pages/shadow-dom.html"
  },
  {
    id: "dynamic-list",
    titleKey: "testPages.dynamicList.title",
    descriptionKey: "testPages.dynamicList.description",
    path: "/test-pages/dynamic-list.html"
  },
  {
    id: "table",
    titleKey: "testPages.table.title",
    descriptionKey: "testPages.table.description",
    path: "/test-pages/table.html"
  },
  {
    id: "popup",
    titleKey: "testPages.popup.title",
    descriptionKey: "testPages.popup.description",
    path: "/test-pages/popup.html"
  }
];

export const IPC_CHANNELS = {
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
