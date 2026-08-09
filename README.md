# UI Explorer

UI Explorer 是一个基于 Electron + React + TypeScript 的网页 UI 元素探索工具，面向 RPA 开发者、测试工程师和前端自动化开发者。它用于连接 Chrome/Edge 调试目标，捕获页面元素，生成稳定 Selector，并导出到 Playwright、Selenium 等自动化环境。

## 当前能力

- 通过 Chrome DevTools Protocol 连接 Chrome/Edge 调试目标。
- 列出可检查页面，并支持在多个浏览器 target 间切换。
- 捕获并展示 DOM、同源嵌套 iframe 与 open Shadow DOM 层级快照。
- 在元素树和属性面板中保留按进入顺序排列的 frame / Shadow 上下文路径，支持跨多个同源 frame 和嵌套 open Shadow Root 定位元素。
- 展示选中元素的标签、属性、文本、可访问性、可见性和布局信息。
- 自动生成 CSS、XPath、Playwright Locator 三类 Selector 候选。
- 对 Selector 做匹配数量、唯一性、可见性、目标一致性验证。
- 按唯一性、稳定性、可读性计算综合评分，并展示风险诊断。
- 支持启用/禁用上下文（frame、Shadow）及 Selector 的层级、标签和属性，支持手动编辑属性值；上下文层级变更会立即重新验证。
- Selector 多匹配时可在目标页面编号高亮所有匹配元素。
- 支持导出 JSON、Playwright TypeScript、Selenium Python 代码预览；导出会保留 frame 进入顺序并处理 open Shadow DOM 上下文。
- 通过附加的 CDP 子 Session 处理跨域 iframe 与 OOPIF；快照、Selector、表格提取和诊断执行始终路由到目标所属的 Session。
- 支持高级表格提取：选择行列、识别 CSS Grid/Flex 伪表格并导出 CSV、JSON、Markdown 和 Excel。
- 提供受控 JavaScript 诊断：在 Monaco 中审查和编辑代码，经预检、一次性确认令牌后只在目标 Session 执行，并明确展示值、`undefined`、不可序列化值、异常和超时结果。
- 属性编辑经同一受控诊断流程确认后才临时修改 DOM，并刷新快照；这不是自动化执行引擎或安全沙箱。
- 对测试页明确标记的 closed Shadow Root 和已脱离上下文显示限制诊断，避免将不可访问的内部元素当作可定位目标。
- 提供中英文 i18n、深浅主题和普通/紧凑密度界面。

## 技术栈

- Electron 33
- React 18
- TypeScript 5
- Vite 6
- Zustand
- Monaco Editor
- Tailwind CSS
- Node.js test runner

## 快速开始

安装依赖：

```bash
npm install
```

启动开发模式：

```bash
npm run dev
```

开发模式会同时启动：

- Electron 主进程 TypeScript watch
- Vite 渲染进程开发服务
- Electron 桌面窗口

只启动网页预览服务：

```bash
npm exec vite -- --host 127.0.0.1
```

打开地址：

```text
http://127.0.0.1:5173/
```

## 连接浏览器调试目标

Windows 版可以直接从左侧“Chrome 调试实例”区域启动并连接 Google Chrome：

1. 输入网址；留空会打开 `about:blank`。
2. 点击“启动 Chrome 并打开”。如果已经存在本机调试实例，应用会在该实例中新建标签页。
3. UI Explorer 自动连接并选中新标签页，不会覆盖当前正在检查的页面。

应用使用独立且持久化的 Chrome Profile，保留调试环境中的登录状态，但不会访问日常 Chrome Profile。自动查找不到 Chrome 时会要求手动选择 `chrome.exe`。正常退出 UI Explorer 时，只关闭由本次应用进程启动的专用 Chrome。

内置测试页右侧的“在 Chrome 中打开”使用同一流程，并在开发和生产构建中自动提供可访问的本机 HTTP 地址。

顶部调试地址仍可用于手动连接已经开启远程调试端口的 Chrome 或 Edge。故障排查时可以手动启动独立实例：

```bash
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="D:\Temp\ui-explorer-chrome" https://www.bing.com/
```

Edge 示例：

```bash
msedge --remote-debugging-port=9222
```

应用中默认填写：

```text
localhost:9222
```

连接成功后，左侧会显示可检查页面，选择页面后中间区域会展示 DOM 树，右侧会展示元素属性与 Selector 面板。

## 常用脚本

```bash
npm run dev
```

启动完整 Electron 开发环境。

```bash
npm run build
```

编译 Electron 主进程、类型检查渲染进程并执行 Vite 生产构建。

```bash
npm run typecheck
```

执行主进程与渲染进程 TypeScript 类型检查。

```bash
npm test
```

编译测试文件并运行 Node.js 内置测试。

```bash
npm run preview
```

预览生产构建产物。

## 项目结构

```text
src/
  main/
    browserSession.ts      # CDP 连接、DOM 快照、元素高亮
    diagnosticExecution.ts # 一次性诊断执行令牌与运行时结果归一化
    main.ts                # Electron 主进程与 IPC 注册
    preload.ts             # 安全暴露渲染进程 API
  renderer/
    components/            # React 工作台界面
    i18n/                  # 中英文文案
    store/                 # Zustand 应用状态
    styles/                # 全局样式与主题变量
  shared/
    browserTargets.ts      # 浏览器 target 解析
    domSnapshot.ts         # DOM 快照工具
    ipc.ts                 # IPC 类型和通道定义
    javascriptDiagnostics.ts # 诊断代码草稿、校验与确定性建议
    selector.ts            # Selector 生成、评分、验证和导出
  types/
    global.d.ts            # window.uiExplorer 类型声明
```

## 测试页面

内置测试页面位于 `public/test-pages/`，覆盖普通 DOM、iframe、Shadow DOM、OOPIF、动态列表、HTML/伪表格和弹层等场景。它们用于验证元素捕获、Selector 生成、评分、验证、导出和受控 JavaScript 诊断。

其中 `iframe.html` 覆盖同源嵌套 frame，`shadow-dom.html` 覆盖 open、嵌套 open 与 closed Shadow Root，`oopif.html` 在 `localhost` 和 `127.0.0.1` 之间创建跨站子 frame。四类诊断上下文均有稳定的 `data-testid="phase-8-diagnostic-target"` 目标；`basic-dom.html` 还提供 `window.phase8Diagnostics`，用于人工验证 `undefined`、循环对象、DOM 节点、拒绝和超时结果。对于 frame、Shadow 和 OOPIF，元素树、属性路径、Selector 层级、导出代码、表格提取和诊断执行共用同一套上下文信息。

### 在浏览器中直接加载

只查看测试页面时，启动 Vite：

```bash
npm exec vite -- --host 127.0.0.1
```

然后访问以下地址：

| 场景 | 地址 |
|------|------|
| 普通 DOM | `http://127.0.0.1:5173/test-pages/basic-dom.html` |
| 同源嵌套 iframe | `http://127.0.0.1:5173/test-pages/iframe.html` |
| Shadow DOM | `http://127.0.0.1:5173/test-pages/shadow-dom.html` |
| 跨站 OOPIF | `http://127.0.0.1:5173/test-pages/oopif.html` |
| 动态列表 | `http://127.0.0.1:5173/test-pages/dynamic-list.html` |
| HTML 表格 | `http://127.0.0.1:5173/test-pages/table.html` |
| 弹层与瞬态元素 | `http://127.0.0.1:5173/test-pages/popup.html` |

如果 `5173` 端口已被占用，Vite 会在终端输出实际端口；请将上述地址中的端口替换为终端显示的端口。

### 在 UI Explorer 中检查

先启动完整开发环境：

```bash
npm run dev
```

保持该命令运行，再打开另一个 PowerShell 窗口，以独立用户数据目录启动 Chrome，并直接加载需要检查的测试页面：

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  --remote-debugging-port=9222 `
  --user-data-dir="D:\Temp\ui-explorer-chrome" `
  "http://127.0.0.1:5173/test-pages/table.html"
```

也可以使用 Edge：

```powershell
msedge `
  --remote-debugging-port=9222 `
  --user-data-dir="D:\Temp\ui-explorer-edge" `
  "http://127.0.0.1:5173/test-pages/table.html"
```

在 UI Explorer 中保持调试地址为 `localhost:9222`，点击“连接”，然后从左侧目标列表选择刚打开的测试页面。切换场景时，可以修改浏览器地址栏中的 `/test-pages/*.html` 路径，也可以重新执行启动命令并替换最后的 URL。

## 上下文范围与限制

当前支持遍历同源嵌套 iframe、进入 open Shadow DOM，并通过附加 CDP 子 Session 检查跨域 iframe/OOPIF。OOPIF 中的 Selector、表格提取和诊断代码从子 Session 的 `document` 开始，绝不假装可经由父页 `contentDocument` 跨域访问。对于带有测试标记、可确认 closed mode 的宿主，应用只显示限制诊断，无法捕获或定位其内部节点；普通页面若无法可靠识别 closed Shadow Root，则不会猜测或误报。

## 开发状态

项目当前支持 Chrome/Edge 调试目标连接与恢复、DOM/iframe/open Shadow/OOPIF 快照、元素捕获与属性诊断、Selector 生成与验证、高级 HTML/伪表格提取和 CSV、JSON、Markdown、Excel 导出，以及受预检和单次确认约束的 JavaScript 诊断。Phase 8 已完成自动化验证和代表性浏览器验收，包括精确 Session 路由、一次性确认、受限结果序列化、异常与超时展示、临时属性编辑，以及离线可用的本地 Monaco 编辑器。后续规划包括桌面 UIAutomation、UiPath 兼容、项目管理和 AI 辅助等能力。

详细需求见 [REQUIREMENTS.md](./REQUIREMENTS.md)。
