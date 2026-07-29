# UI Explorer 托管 Chrome 启动与自动连接设计

## 背景

UI Explorer 已支持扫描本机 Chrome DevTools Protocol（CDP）端点、手动连接调试实例、浏览目标页，以及在页面刷新或目标关闭后恢复连接。当前用户仍需在应用外手动启动带远程调试参数的 Chrome，并自行打开待检查网页或内置测试页。

本功能在左侧区域增加一键入口：用户可以输入网址或选择内置测试页，由 UI Explorer 复用已有本机调试实例，或启动使用独立持久化 Profile 的 Chrome。页面始终在新标签页中打开，随后自动连接、选中目标并加载 DOM 快照，不覆盖当前正在检查的标签页。

## 范围与已确认决策

- 首版仅支持 Windows 上的 Google Chrome。
- 自动检查常见 Chrome 安装位置；找不到时允许用户手动选择 `chrome.exe`。
- 已有本机调试实例时始终创建并切换到新标签页，不导航已有标签页。
- 没有实例时启动 UI Explorer 专用 Chrome，并完成同样的创建、连接和选中流程。
- UI Explorer 正常退出时只关闭本次进程启动的专用 Chrome，不关闭外部实例。
- Chrome 使用 UI Explorer 独立且持久化的用户数据目录，保留登录状态和站点设置，但不接触用户日常 Chrome Profile。
- 自定义 URL 不持久化；Chrome 路径、专用 Profile 和最近一次专用调试端点可以持久化。
- 内置测试页在开发和生产环境都必须能由外部 Chrome 通过本机 HTTP 地址访问。
- 顶部已有的调试端点和手动连接功能保持不变。

## 方案选择

### 采用：专用启动器与 CDP 创建标签页

主进程管理 Chrome 可执行文件发现、专用 Profile、进程所有权、调试端点和测试页服务。BrowserSession 通过 `Target.createTarget` 创建页面，并在同一主进程工作流中完成附加和快照。

该方案复用现有 CDP 能力，能够准确区分自有实例和外部实例，并可对启动、连接和页面创建分别诊断。

### 未采用：每次直接执行 `chrome.exe <url>`

Chrome 的单实例行为可能把请求转交给其他 Profile，难以可靠确定调试端点、目标页和进程所有权，也无法保证自动连接到本次打开的页面。

### 未采用：随应用分发 Chrome for Testing

该方案版本行为稳定，但会显著增加安装包体积、更新和安全维护成本。当前需求可以使用本机 Chrome 完成，不引入浏览器分发。

## 架构与职责

### ChromeExecutableLocator

- 按顺序检查已保存路径、`LOCALAPPDATA`、`PROGRAMFILES` 和 `PROGRAMFILES(X86)` 下的 Chrome 常见安装位置。
- 所有候选都通过绝对路径、文件存在性和文件名 `chrome.exe` 校验。
- 自动查找失败时，由主进程显示文件选择器。
- 用户取消选择返回 `cancelled`，不作为错误。
- 验证成功后持久化路径，继续执行当前打开请求，后续启动优先复用；路径失效时自动回退到重新发现。

### ChromeInstanceManager

- 探测当前连接端点、用户输入端点、上次专用端点和默认本机端口。
- 只把 loopback 地址视为本功能可自动复用的本机 Chrome；远程端点继续通过现有手动连接流程使用。
- 在需要时选择可用端口并使用参数数组启动 Chrome，不经过 Shell。
- 保存本次启动的子进程句柄、端点和 `managed` 所有权。
- 轮询 `/json/version` 等待 CDP 就绪，同时观察 Chrome 是否提前退出。
- 向 Renderer 报告 `detecting`、`selecting-executable`、`launching` 和 `connecting` 进度。
- 应用退出时只关闭当前进程拥有的 `managed` 实例。

### TestPageServer

- 开发环境直接使用 `VITE_DEV_SERVER_URL` 作为测试页基址。
- 生产环境首次打开测试页时，按需启动静态 HTTP 服务。
- 静态根目录固定为构建产物中的 `dist/test-pages`，请求路径经过解码、规范化和根目录约束，拒绝路径穿越。
- 使用显式 MIME 映射提供 HTML、CSS、JavaScript 和必要静态资源。
- Windows 生产环境同时服务 IPv4 loopback 与 IPv6 loopback，使 OOPIF 测试页中的 `127.0.0.1`/`localhost` 切换保持可用；服务不得监听局域网接口。
- 测试页只按 `TEST_PAGES` 中存在的 ID 解析，Renderer 不能传入任意服务器文件路径。
- 应用退出时关闭所有监听器。

### BrowserSession

新增原子能力 `createAndSelectTarget(endpoint, url)`：

1. 确保浏览器级 WebSocket 已连接到指定端点。
2. 发送 `Target.createTarget`，获取新 `targetId`。
3. 刷新目标列表并等待新 Target 可见。
4. 附加到准确的 `targetId`，不依赖 URL 或标题猜测。
5. 初始化 Page、Runtime、DOM 和多 Session 自动附加能力。
6. 获取并返回新页面快照。

目标创建成功但首次附加失败时，刷新目标并重试一次。最终失败时保留已创建标签页，并让目标列表可用于手动选择。

### IPC 工作流

主进程 IPC 处理器协调上述组件，但不在 Renderer 中拆分为多个启动和连接调用。共享请求使用来源联合类型：

```ts
type OpenChromePageRequest = {
  requestId: string;
  preferredEndpoint?: string;
  source:
    | { kind: "custom"; value: string }
    | { kind: "test-page"; id: string };
};
```

主进程负责解析测试页 ID 和校验自定义 URL。成功结果一次性携带 BrowserConnectionInfo 和 DomSnapshotResult，使 Renderer 原子更新连接、目标和快照状态：

```ts
type OpenChromePageResult =
  | {
      status: "opened";
      ownership: "managed" | "external";
      endpoint: string;
      targetId: string;
      connection: BrowserConnectionInfo;
      snapshot: DomSnapshotResult;
    }
  | { status: "cancelled" }
  | {
      status: "error";
      code: ChromeLaunchErrorCode;
      message: string;
      endpoint?: string;
      targetId?: string;
    };
```

进度事件携带 `requestId`。Renderer 只接收当前请求的事件，忽略已完成或过期请求的进度。

## 端点选择与完整数据流

候选端点严格按以下优先级处理：

1. 当前 BrowserSession 已连接且健康的本机端点。
2. 顶部调试地址输入框指定且可访问的本机端点。
3. 持久化记录的上次专用端点。
4. 本机扫描结果中的第一个健康端点。
5. 新启动的 UI Explorer 专用实例。

完整流程：

```text
用户输入网址或点击测试页“在 Chrome 中打开”
  -> 主进程解析、规范化并校验来源
  -> 检测可复用的 loopback CDP 端点
  -> 没有端点时定位 chrome.exe 并选择空闲端口
  -> 使用专用 Profile 启动 Chrome
  -> 等待 /json/version 就绪
  -> Target.createTarget 创建新标签页
  -> 附加到返回的 targetId
  -> 获取 DOM 快照
  -> Renderer 原子更新连接和工作台
```

若外部端点在探测后、创建 Target 前失效，工作流重新扫描一次；仍不可用时启动专用实例。当前工作台状态在新页面成功附加前不清空。

## URL 规范化

URL 解析放在可独立测试的共享纯函数中，规则如下：

- 去除输入首尾空白。
- 空字符串转换为内部固定值 `about:blank`。
- 已包含 `http://`、`https://` 或 `file://` 的输入按 URL 标准解析后使用。
- `localhost`、`127.0.0.1`、私有局域网 IP 及其端口和路径自动补全 `http://`。
- 其他未带协议的域名或公有 IP 自动补全 `https://`。
- `about:blank` 只允许由空输入产生，不接受用户输入的其他 `about:` 地址。
- 明确拒绝 `javascript:`、`data:`、`chrome:` 及其他未允许协议。
- Windows 本地路径不会隐式转换成 `file://`；用户必须明确输入合法的 `file://` URL。
- 无法解析的输入返回 `invalid-url`，不得启动 Chrome 或改变当前连接。

## Chrome 启动与 Profile

专用 Profile 位于：

```text
<Electron app userData>/chrome-profile
```

Chrome 以参数数组启动：

```text
--remote-debugging-address=127.0.0.1
--remote-debugging-port=<selected-port>
--user-data-dir=<UI Explorer chrome-profile>
--no-first-run
--no-default-browser-check
```

启动参数中不直接放入用户 URL。Chrome 就绪后统一通过 CDP 创建目标页，保证新启动和复用实例走同一页面创建路径。

端口选择先尝试用户偏好的 loopback 端口，再按升序检查 `9222` 至 `9232`（含首尾）。该范围均不可用时返回 `no-debug-port`，首版不扫描任意系统端口。端口可用性检查和 Chrome 启动之间仍可能存在竞争，因此最终以 `/json/version` 返回的 Chrome 元数据为成功依据。端口被其他服务占用时跳过，不能把任意 HTTP 服务识别为 CDP。

启动最长等待 15 秒。Chrome 提前退出返回 `launch-exited`；进程仍在但 CDP 未就绪返回 `cdp-timeout`。

新启动 Chrome 时只传入固定启动页 `about:blank`，不把用户 URL 放入进程参数。CDP 就绪后先记录该启动空白 Target，再创建用户请求的新 Target。新 Target 成功附加后，仅当原 Target 仍为本次新实例中记录的 `about:blank` 时将其关闭；不按 URL 批量查找，也不关闭恢复出来的历史标签页。由此避免正常路径留下额外空标签页，同时保持持久化 Profile 的会话恢复安全。

## 进程所有权与退出

- 本次 UI Explorer 进程启动的实例标记为 `managed`。
- 启动前已存在、手动启动或上一次异常退出后残留的实例标记为 `external`。
- 正常退出时，先对 `managed` 端点发送 CDP `Browser.close`。
- 等待最多 3 秒；仍未退出时，只对保存的本次子进程句柄调用终止。
- 不通过进程名、端口或全局进程搜索批量结束 Chrome。
- 外部实例无论是否使用 UI Explorer 专用 Profile 都不得自动关闭。
- 退出清理使用一次性 guard，避免 Electron 多个退出事件重复执行。

专用 Profile 保留 Cookie、登录状态、证书授权和站点设置。UI Explorer 不读取或复制 Profile 内容，也不允许调试实例使用 Chrome 默认用户目录。

## 左侧交互

### Chrome 调试实例卡片

左侧“目标”区域新增“Chrome 调试实例”卡片，包含：

- 实例状态：未检测到、外部调试实例、UI Explorer 专用实例。
- 单行 URL 输入框。
- 主按钮。
- 行内进度或错误信息。
- 仅在自动定位失败时出现的 Chrome 路径选择流程。

主按钮文案：

- 无实例：`启动 Chrome 并打开`
- 已有实例：`在新标签页打开`
- 进行中：按实际阶段显示 `正在检测…`、`正在启动…`、`正在连接…` 或 `正在打开页面…`

输入为空时打开 `about:blank`。按 Enter 等同于点击主按钮。操作进行时输入框和按钮禁用，防止同一界面并发创建多个页面。成功后自动切换到 DOM 工作台。

自定义 URL 只保存在当前 React 会话状态，不加入 Zustand 持久化切片，也不输出到日志。

### 测试页面区域

- 点击测试页主体继续切换中间的内置预览。
- 每行增加独立的“在 Chrome 中打开”按钮。
- 启动按钮按测试页 ID 调用统一打开工作流。
- 成功后保留测试页选择，同时自动连接并检查 Chrome 中的新 Target。
- 自定义页面与测试页共用同一操作状态，同一时间只允许一个打开请求。

### 手动连接兼容

顶部调试端点输入框和“连接/断开”按钮保持现有行为。自动打开功能不会删除高级用户的手动连接入口，也不会自动对非 loopback 端点创建页面。

## Renderer 状态模型

使用判别联合表示互斥状态：

```ts
type ChromeOpenState =
  | { status: "idle" }
  | { status: "detecting"; requestId: string }
  | { status: "selecting-executable"; requestId: string }
  | { status: "launching"; requestId: string }
  | { status: "connecting"; requestId: string; endpoint: string }
  | { status: "opening"; requestId: string; endpoint: string }
  | {
      status: "success";
      requestId: string;
      endpoint: string;
      targetId: string;
      ownership: "managed" | "external";
    }
  | {
      status: "error";
      requestId: string;
      code: ChromeLaunchErrorCode;
      message: string;
    };
```

打开操作期间拒绝新的 UI 请求。取消后立即回到 `idle`；成功或错误状态保留到下一次操作或连接状态变化，便于用户读取结果。连接状态仍以现有 BrowserConnectionStatus 为唯一事实来源。

## 错误与恢复

稳定错误码包括：

- `chrome-not-found`
- `invalid-chrome-path`
- `invalid-url`
- `no-debug-port`
- `profile-in-use`
- `launch-failed`
- `launch-exited`
- `cdp-timeout`
- `target-create-failed`
- `target-attach-failed`
- `test-server-failed`

错误码映射到中英文 i18n 文案，操作系统原始错误只作为开发诊断细节，不直接充当主要用户提示。

恢复规则：

- 用户取消选择 Chrome：返回 `cancelled`，恢复空闲且不显示错误。
- URL 无效或测试页 ID 不存在：不启动浏览器，不改变当前连接。
- 外部实例失效：重扫一次，随后回退到启动专用实例。
- 新标签页已创建但附加失败：保留页面和新 Target 信息，刷新左侧目标列表并提示可手动选择。
- 测试页服务失败：在启动或创建 Chrome 标签页前终止流程。
- 新页面连接成功前保留现有目标、快照、选择和 Selector 草稿。

## 安全要求

- 启动 Chrome 使用 `spawn(executable, args, { shell: false })`，禁止拼接 Shell 命令。
- 自动复用仅限 loopback CDP 端点。
- Chrome 调试端口显式绑定 loopback。
- Chrome 路径必须是绝对路径、存在且文件名为 `chrome.exe`。
- URL 使用允许协议列表；测试页使用 ID 白名单。
- 静态服务只绑定 IPv4/IPv6 loopback，并对解析后的绝对路径执行根目录包含检查。
- 不记录自定义 URL，不读取默认 Chrome Profile，不复制专用 Profile 中的凭据。
- 退出时只关闭当前进程明确拥有的实例。

## 测试策略

### 自动化测试

- URL 补全、协议白名单、空输入、局域网地址和非法输入。
- Chrome 已保存路径、常见路径、失效路径和手动选择结果。
- 端点优先级、CDP 元数据验证、端口占用、启动退出和超时。
- `managed`/`external` 所有权以及只关闭自有实例。
- BrowserSession 创建准确 Target、附加重试和快照返回。
- TestPageServer 的 ID 白名单、MIME 类型、IPv4/IPv6 loopback 和路径穿越防护。
- IPC 请求、结果与进度事件的运行时边界校验。
- Zustand 判别联合转换、重复点击保护和过期 `requestId` 事件忽略。
- 成功结果原子替换连接、目标、快照和选择。

### 人工验收

1. 未启动 Chrome，空输入打开 `about:blank` 并自动连接。
2. 无协议域名、本机地址、局域网地址和完整 URL 按规则加载。
3. 已有调试实例时创建并选中新标签页，原页面不被覆盖。
4. 所有内置测试页都能一键在 Chrome 中打开并自动检查。
5. 生产构建中的 OOPIF 测试页可通过本机 HTTP 服务加载跨站子 frame。
6. 找不到 Chrome 时可以手动选择，后续无需重复选择。
7. 关闭 UI Explorer 只关闭本次启动的专用实例。
8. 专用 Profile 的登录状态跨重启保留。
9. 非法 URL、端口冲突、Chrome 提前退出和 CDP 超时显示准确提示。
10. 手动连接已有端点的流程不发生回归。

完成 UI 和 IPC 功能后运行项目全量测试、类型检查和生产构建，并在开发环境与生产构建各执行一次代表性浏览器验收。

## 非目标

- Edge、macOS 或 Linux 浏览器启动。
- 自动下载、升级或随应用捆绑 Chrome。
- 使用或迁移用户日常 Chrome Profile。
- 同时管理多个 UI Explorer 专用 Chrome 实例。
- 导航、刷新或覆盖已有标签页。
- 远程 CDP 实例的一键页面创建。
- 保存自定义 URL 历史记录。
