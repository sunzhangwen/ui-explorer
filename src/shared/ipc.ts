import type { TableExportFormat } from "./tableExport.js";
import type {
  OpenChromePageProgress,
  OpenChromePageRequest,
  OpenChromePageResult
} from "./chromeLaunch.js";

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

export type BrowserDebugEndpoint = {
  endpoint: string;
  browser: string;
  webSocketDebuggerUrl?: string;
};

export type BoundingBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ElementLayoutSnapshot = {
  display: string;
  flexDirection: string;
  gridTemplateColumns: string;
  rowGap: string;
  columnGap: string;
};

export type ElementNodeKind = "element" | "page" | "frame" | "shadow" | "diagnostic";
export type ContextBoundaryKind = "frame" | "shadow";
export type SnapshotDiagnosticCode =
  | "cross-origin-frame"
  | "closed-shadow-root"
  | "detached-context"
  | "frame-attach-failed"
  | "frame-owner-unresolved"
  | "navigation-invalidated"
  | "session-detached";

export type ContextBoundary = {
  kind: ContextBoundaryKind;
  hostNodeId: string;
  hostTagName: string;
  hostAttributes: Record<string, string>;
  frameId?: string;
  targetId?: string;
  sessionId?: string;
  ownerContentOffset?: {
    x: number;
    y: number;
  };
};

export type SnapshotDiagnostic = {
  code: SnapshotDiagnosticCode;
  messageKey: string;
  detail: string;
};

export type HighlightTargetStatus =
  | {
      elementId: string;
      status: "highlighted";
    }
  | {
      elementId: string;
      status: "detached";
      diagnostic: SnapshotDiagnostic & { code: "detached-context" };
    };

export type HighlightResult = {
  targets: HighlightTargetStatus[];
};

export type HighlightElementRequest = {
  elementId: string;
  snapshotToken: string | null;
};

export type HighlightElementsRequest = {
  elementIds: string[];
  snapshotToken: string | null;
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
  accessibleName?: string;
  description?: string;
  visible?: boolean;
  disabled?: boolean;
  clickable?: boolean;
  occluded?: boolean;
  visibilityReasons?: string[];
  boundingBox?: BoundingBox;
  layout?: ElementLayoutSnapshot;
  kind?: ElementNodeKind;
  context?: ContextBoundary[];
  diagnostic?: SnapshotDiagnostic;
  attributes: Record<string, string>;
  childIds: string[];
  children: ElementSnapshot[];
};

export type DomSnapshotResult = {
  root: ElementSnapshot | null;
  capturedAt: string;
  snapshotToken?: string;
  nodeCount: number;
};

export type BrowserConnectionInfo = {
  endpoint: string;
  connected: boolean;
  status: "connected" | "no-targets" | "target-closed" | "reconnected" | "navigated";
  targetId: string | null;
  targets: BrowserTarget[];
  diagnostics?: BrowserConnectionDiagnostics;
};

export type BrowserConnectionDiagnostics = {
  listUrl: string;
  rawTargetCount: number;
  inspectableTargetCount: number;
  rawTargetTypes: string[];
};

export type TableExportSaveRequest = {
  format: TableExportFormat;
  content: string;
  suggestedBaseName: string;
};

export type TableExportSaveResult =
  | { status: "saved"; filePath: string }
  | { status: "cancelled" }
  | { status: "error"; message: string };

export type IpcApi = {
  ping: () => Promise<string>;
  getAppInfo: () => Promise<AppInfo>;
  listTestPages: () => Promise<TestPage[]>;
  openChromePage: (request: OpenChromePageRequest) => Promise<OpenChromePageResult>;
  onOpenChromePageProgress: (listener: (progress: OpenChromePageProgress) => void) => () => void;
  discoverBrowserEndpoints: () => Promise<BrowserDebugEndpoint[]>;
  connectBrowser: (endpoint: string) => Promise<BrowserConnectionInfo>;
  refreshBrowserConnection: () => Promise<BrowserConnectionInfo>;
  disconnectBrowser: () => Promise<void>;
  listBrowserTargets: () => Promise<BrowserTarget[]>;
  selectBrowserTarget: (targetId: string) => Promise<DomSnapshotResult>;
  getDomSnapshot: () => Promise<DomSnapshotResult>;
  highlightElement: (request: HighlightElementRequest) => Promise<HighlightResult>;
  highlightElements: (request: HighlightElementsRequest) => Promise<HighlightResult>;
  setElementPickerEnabled: (enabled: boolean) => Promise<void>;
  getPickedElementId: () => Promise<string | null>;
  onCaptureRequested: (listener: () => void) => () => void;
  saveTableExport: (request: TableExportSaveRequest) => Promise<TableExportSaveResult>;
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
    id: "oopif",
    titleKey: "testPages.oopif.title",
    descriptionKey: "testPages.oopif.description",
    path: "/test-pages/oopif.html"
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
