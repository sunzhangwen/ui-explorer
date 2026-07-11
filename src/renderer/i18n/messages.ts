export type MessageKey =
  | "app.title"
  | "toolbar.targetPlaceholder"
  | "toolbar.connect"
  | "toolbar.disconnect"
  | "toolbar.refresh"
  | "toolbar.theme"
  | "toolbar.language"
  | "toolbar.density"
  | "toolbar.ipcReady"
  | "toolbar.ipcError"
  | "toolbar.pickElement"
  | "panel.targets"
  | "panel.explorer"
  | "panel.properties"
  | "panel.selector"
  | "panel.tests"
  | "empty.tree"
  | "empty.properties"
  | "empty.selector"
  | "connection.status"
  | "connection.notConnected"
  | "connection.connecting"
  | "connection.connected"
  | "connection.error"
  | "connection.noTargets"
  | "connection.debugPort"
  | "connection.guide"
  | "target.current"
  | "target.empty"
  | "tree.nodes"
  | "tree.empty"
  | "tree.searchPlaceholder"
  | "tree.searchResults"
  | "tree.searchNoResults"
  | "tree.previousMatch"
  | "tree.nextMatch"
  | "properties.selected"
  | "properties.attributes"
  | "properties.accessibility"
  | "properties.layout"
  | "properties.text"
  | "properties.visible"
  | "properties.hidden"
  | "properties.boundingBox"
  | "properties.role"
  | "properties.tag"
  | "properties.nodeName"
  | "properties.nodeType"
  | "preview.title"
  | "preview.openPage"
  | "preview.monaco"
  | "preview.currentTarget"
  | "preview.selectedSnapshot"
  | "selector.candidates"
  | "selector.matchCount"
  | "selector.totalScore"
  | "selector.stability"
  | "selector.readability"
  | "selector.layers"
  | "selector.targetLayer"
  | "selector.ancestorLayer"
  | "selector.diagnostics"
  | "selector.noRisks"
  | "selector.exportPreview"
  | "selector.export.json"
  | "selector.export.playwright"
  | "selector.export.selenium"
  | "selector.copy"
  | "selector.diagnostic.missing"
  | "selector.diagnostic.multiple"
  | "selector.diagnostic.hidden"
  | "selector.risk.dynamicId"
  | "selector.risk.lowSignal"
  | "diagnostics.phase"
  | "diagnostics.ipc"
  | "diagnostics.app"
  | "diagnostics.nodes"
  | "diagnostics.capturedAt"
  | "diagnostics.target"
  | "testPages.basicDom.title"
  | "testPages.basicDom.description"
  | "testPages.iframe.title"
  | "testPages.iframe.description"
  | "testPages.shadowDom.title"
  | "testPages.shadowDom.description"
  | "testPages.dynamicList.title"
  | "testPages.dynamicList.description"
  | "testPages.table.title"
  | "testPages.table.description"
  | "testPages.popup.title"
  | "testPages.popup.description";

export const messages: Record<"zh-CN" | "en-US", Record<MessageKey, string>> = {
  "zh-CN": {
    "app.title": "UI Explorer",
    "toolbar.targetPlaceholder": "localhost:9222",
    "toolbar.connect": "连接",
    "toolbar.disconnect": "断开",
    "toolbar.refresh": "刷新",
    "toolbar.theme": "主题",
    "toolbar.language": "语言",
    "toolbar.density": "密度",
    "toolbar.ipcReady": "IPC 已就绪",
    "toolbar.ipcError": "IPC 异常",
    "toolbar.pickElement": "点选",
    "panel.targets": "目标",
    "panel.explorer": "结构",
    "panel.properties": "属性",
    "panel.selector": "Selector",
    "panel.tests": "测试页面",
    "empty.tree": "Phase 1 会在这里显示 DOM、iframe 和 Shadow 层级。",
    "empty.properties": "选择元素后，这里会显示属性、可访问性和布局信息。",
    "empty.selector": "Selector 候选、评分和诊断将在 Phase 2 接入。",
    "connection.status": "连接状态",
    "connection.notConnected": "未连接调试目标",
    "connection.connecting": "正在连接",
    "connection.connected": "已连接调试目标",
    "connection.error": "连接异常",
    "connection.noTargets": "未发现可检查页面",
    "connection.debugPort": "调试端口",
    "connection.guide": "启动 Chrome/Edge 时添加 --remote-debugging-port=9222。",
    "target.current": "当前页面",
    "target.empty": "连接后会显示 Chrome/Edge 可检查页面。",
    "tree.nodes": "节点",
    "tree.empty": "连接页面后会显示 DOM 树。",
    "tree.searchPlaceholder": "搜索节点",
    "tree.searchResults": "搜索",
    "tree.searchNoResults": "0",
    "tree.previousMatch": "上一个匹配",
    "tree.nextMatch": "下一个匹配",
    "properties.selected": "选中元素",
    "properties.attributes": "DOM 属性",
    "properties.accessibility": "可访问性",
    "properties.layout": "布局",
    "properties.text": "文本",
    "properties.visible": "可见",
    "properties.hidden": "不可见",
    "properties.boundingBox": "边界",
    "properties.role": "角色",
    "properties.tag": "标签",
    "properties.nodeName": "节点名",
    "properties.nodeType": "节点类型",
    "preview.title": "验收样例",
    "preview.openPage": "打开页面",
    "preview.monaco": "导出预览占位",
    "preview.currentTarget": "当前页面",
    "preview.selectedSnapshot": "选中元素快照",
    "selector.candidates": "Selector 候选",
    "selector.matchCount": "匹配数",
    "selector.totalScore": "综合分",
    "selector.stability": "稳定性",
    "selector.readability": "可读性",
    "selector.layers": "层级编辑",
    "selector.targetLayer": "目标层",
    "selector.ancestorLayer": "祖先层",
    "selector.diagnostics": "诊断",
    "selector.noRisks": "暂无风险",
    "selector.exportPreview": "导出预览",
    "selector.export.json": "JSON",
    "selector.export.playwright": "Playwright",
    "selector.export.selenium": "Selenium",
    "selector.copy": "复制导出内容",
    "selector.diagnostic.missing": "未匹配任何元素",
    "selector.diagnostic.multiple": "匹配到多个元素",
    "selector.diagnostic.hidden": "目标元素不可见",
    "selector.risk.dynamicId": "疑似动态 ID",
    "selector.risk.lowSignal": "低稳定性属性",
    "diagnostics.phase": "Phase 1 网页连接与元素捕获",
    "diagnostics.ipc": "主进程往返",
    "diagnostics.app": "运行环境",
    "diagnostics.nodes": "快照节点",
    "diagnostics.capturedAt": "捕获时间",
    "diagnostics.target": "调试目标",
    "testPages.basicDom.title": "普通 DOM",
    "testPages.basicDom.description": "按钮、输入框、链接、动态 class 和语义属性。",
    "testPages.iframe.title": "iframe",
    "testPages.iframe.description": "单层 iframe 和 frame 内部可选元素。",
    "testPages.shadowDom.title": "Shadow DOM",
    "testPages.shadowDom.description": "open、嵌套 open 和 closed Shadow 场景。",
    "testPages.dynamicList.title": "动态列表",
    "testPages.dynamicList.description": "索引变化、随机 id 和 hash class。",
    "testPages.table.title": "表格",
    "testPages.table.description": "标准表格、合并单元格和多级表头。",
    "testPages.popup.title": "弹层",
    "testPages.popup.description": "菜单、tooltip、弹层和延迟捕获样例。"
  },
  "en-US": {
    "app.title": "UI Explorer",
    "toolbar.targetPlaceholder": "localhost:9222",
    "toolbar.connect": "Connect",
    "toolbar.disconnect": "Disconnect",
    "toolbar.refresh": "Refresh",
    "toolbar.theme": "Theme",
    "toolbar.language": "Language",
    "toolbar.density": "Density",
    "toolbar.ipcReady": "IPC ready",
    "toolbar.ipcError": "IPC error",
    "toolbar.pickElement": "Pick",
    "panel.targets": "Targets",
    "panel.explorer": "Structure",
    "panel.properties": "Properties",
    "panel.selector": "Selector",
    "panel.tests": "Test pages",
    "empty.tree": "Phase 1 will render DOM, iframe, and Shadow hierarchy here.",
    "empty.properties": "Selected element attributes, accessibility, and layout will appear here.",
    "empty.selector": "Selector candidates, scoring, and diagnostics arrive in Phase 2.",
    "connection.status": "Connection",
    "connection.notConnected": "No debug target connected",
    "connection.connecting": "Connecting",
    "connection.connected": "Debug target connected",
    "connection.error": "Connection error",
    "connection.noTargets": "No inspectable pages found",
    "connection.debugPort": "Debug port",
    "connection.guide": "Start Chrome/Edge with --remote-debugging-port=9222.",
    "target.current": "Current page",
    "target.empty": "Inspectable Chrome/Edge pages appear after connecting.",
    "tree.nodes": "Nodes",
    "tree.empty": "Connect a page to render the DOM tree.",
    "tree.searchPlaceholder": "Search nodes",
    "tree.searchResults": "Search",
    "tree.searchNoResults": "0",
    "tree.previousMatch": "Previous match",
    "tree.nextMatch": "Next match",
    "properties.selected": "Selected element",
    "properties.attributes": "DOM attributes",
    "properties.accessibility": "Accessibility",
    "properties.layout": "Layout",
    "properties.text": "Text",
    "properties.visible": "Visible",
    "properties.hidden": "Hidden",
    "properties.boundingBox": "Bounds",
    "properties.role": "Role",
    "properties.tag": "Tag",
    "properties.nodeName": "Node name",
    "properties.nodeType": "Node type",
    "preview.title": "Acceptance samples",
    "preview.openPage": "Open page",
    "preview.monaco": "Export preview placeholder",
    "preview.currentTarget": "Current page",
    "preview.selectedSnapshot": "Selected element snapshot",
    "selector.candidates": "Selector candidates",
    "selector.matchCount": "Matches",
    "selector.totalScore": "Score",
    "selector.stability": "Stability",
    "selector.readability": "Readability",
    "selector.layers": "Layer editor",
    "selector.targetLayer": "Target layer",
    "selector.ancestorLayer": "Ancestor layer",
    "selector.diagnostics": "Diagnostics",
    "selector.noRisks": "No risks",
    "selector.exportPreview": "Export preview",
    "selector.export.json": "JSON",
    "selector.export.playwright": "Playwright",
    "selector.export.selenium": "Selenium",
    "selector.copy": "Copy export",
    "selector.diagnostic.missing": "No elements matched",
    "selector.diagnostic.multiple": "Multiple elements matched",
    "selector.diagnostic.hidden": "Target element is hidden",
    "selector.risk.dynamicId": "Possible dynamic ID",
    "selector.risk.lowSignal": "Low-stability attribute",
    "diagnostics.phase": "Phase 1 web capture MVP",
    "diagnostics.ipc": "Main process round trip",
    "diagnostics.app": "Runtime",
    "diagnostics.nodes": "Snapshot nodes",
    "diagnostics.capturedAt": "Captured at",
    "diagnostics.target": "Debug target",
    "testPages.basicDom.title": "Basic DOM",
    "testPages.basicDom.description": "Buttons, inputs, links, dynamic classes, and semantic attributes.",
    "testPages.iframe.title": "iframe",
    "testPages.iframe.description": "Single iframe with selectable frame content.",
    "testPages.shadowDom.title": "Shadow DOM",
    "testPages.shadowDom.description": "Open, nested open, and closed Shadow scenarios.",
    "testPages.dynamicList.title": "Dynamic list",
    "testPages.dynamicList.description": "Changing indexes, random ids, and hash classes.",
    "testPages.table.title": "Table",
    "testPages.table.description": "Standard tables, merged cells, and grouped headers.",
    "testPages.popup.title": "Popup",
    "testPages.popup.description": "Menus, tooltips, popovers, and delayed capture samples."
  }
};
