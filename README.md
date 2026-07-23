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
- 对跨域 frame、OOPIF、测试页明确标记的 closed Shadow Root 和已脱离上下文显示限制诊断，避免将不可访问的内部元素当作可定位目标。
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

UI Explorer 需要连接开启远程调试端口的 Chrome 或 Edge。

Chrome 示例：

```bash
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222
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

连接成功后，左侧会显示可检查页面，选择页面后中间区域会展示 DOM 树和测试页面预览，右侧会展示元素属性与 Selector 面板。

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
    selector.ts            # Selector 生成、评分、验证和导出
  types/
    global.d.ts            # window.uiExplorer 类型声明
```

## 测试页面

内置测试页面位于 `public/test-pages/`，覆盖普通 DOM、iframe、Shadow DOM、动态列表、表格和弹层等场景。它们用于验证元素捕获、Selector 生成、评分、验证和导出能力。

其中 `iframe.html` 覆盖同源嵌套 frame，`shadow-dom.html` 覆盖 open、嵌套 open 与 closed Shadow Root。对于同源 frame 与 open Shadow DOM，元素树、属性路径、Selector 层级、导出代码和限制诊断共用同一套上下文信息。

## 上下文范围与限制

Phase 3 支持遍历同源嵌套 iframe，以及进入 open Shadow DOM。跨域 iframe 与浏览器以 OOPIF（Out-of-Process iframe）形式承载的 frame 内容不在本阶段的遍历范围内：应用会显示不可访问的上下文诊断，而不会报告其内部的可选元素。该能力明确推迟到 Phase 8。对于带有测试标记、可确认 closed mode 的宿主，应用只显示限制诊断，无法捕获或定位其内部节点；普通页面若无法可靠识别 closed Shadow Root，则不会猜测或误报。

## 开发状态

项目已完成网页端 MVP 的基础连接、快照展示、Phase 2 Selector 核心能力，以及 Phase 3 的同源 frame / open Shadow DOM 上下文支持。后续规划包括项目保存、跨域/OOPIF frame 遍历（Phase 8）、表格识别、UiPath 兼容导出、桌面 UIAutomation 捕获、冻结捕获和高级诊断能力。

详细需求见 [REQUIREMENTS.md](./REQUIREMENTS.md)。
