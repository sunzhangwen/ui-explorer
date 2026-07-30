export type MessageKey =
  | "app.title"
  | "app.description"
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
  | "capture.delay"
  | "capture.now"
  | "capture.start"
  | "capture.cancel"
  | "capture.hotkey"
  | "panel.targets"
  | "panel.explorer"
  | "panel.properties"
  | "panel.selector"
  | "panel.tableData"
  | "panel.tests"
  | "chrome.cardTitle"
  | "chrome.url"
  | "chrome.urlPlaceholder"
  | "chrome.launchAndOpen"
  | "chrome.openNewTab"
  | "chrome.openTestPage"
  | "chrome.opened"
  | "chrome.instance.none"
  | "chrome.instance.external"
  | "chrome.progress.detecting"
  | "chrome.progress.selecting-executable"
  | "chrome.progress.launching"
  | "chrome.progress.connecting"
  | "chrome.progress.opening"
  | "chrome.error.chrome-not-found"
  | "chrome.error.invalid-chrome-path"
  | "chrome.error.invalid-url"
  | "chrome.error.no-debug-port"
  | "chrome.error.profile-in-use"
  | "chrome.error.launch-failed"
  | "chrome.error.launch-exited"
  | "chrome.error.cdp-timeout"
  | "chrome.error.target-create-failed"
  | "chrome.error.target-attach-failed"
  | "chrome.error.test-server-failed"
  | "empty.properties"
  | "empty.selector"
  | "connection.status"
  | "connection.notConnected"
  | "connection.connecting"
  | "connection.connected"
  | "connection.error"
  | "connection.noTargets"
  | "connection.targetClosed"
  | "connection.reconnected"
  | "connection.navigated"
  | "connection.reconnecting"
  | "connection.debugPort"
  | "connection.guide"
  | "connection.discover"
  | "connection.discovering"
  | "selection.restored"
  | "selection.ambiguous"
  | "selection.notFound"
  | "target.current"
  | "target.empty"
  | "tree.nodes"
  | "tree.empty"
  | "tree.searchPlaceholder"
  | "tree.searchResults"
  | "tree.searchNoResults"
  | "tree.previousMatch"
  | "tree.nextMatch"
  | "tree.badge.page"
  | "tree.badge.frame"
  | "tree.badge.shadow"
  | "tree.badge.limit"
  | "properties.selected"
  | "properties.attributes"
  | "properties.accessibility"
  | "properties.layout"
  | "properties.text"
  | "properties.visible"
  | "properties.hidden"
  | "properties.boundingBox"
  | "properties.role"
  | "properties.accessibleName"
  | "properties.description"
  | "properties.disabled"
  | "properties.clickable"
  | "properties.occluded"
  | "properties.visibilityReasons"
  | "properties.yes"
  | "properties.no"
  | "properties.filterAttributes"
  | "properties.attribute.unique"
  | "properties.attribute.stable"
  | "properties.attribute.dynamic"
  | "properties.attribute.neutral"
  | "properties.tag"
  | "properties.nodeName"
  | "properties.nodeType"
  | "properties.context"
  | "properties.framePath"
  | "properties.shadowPath"
  | "preview.title"
  | "preview.openPage"
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
  | "selector.layer.page"
  | "selector.layer.frame"
  | "selector.layer.shadow"
  | "selector.layer.ancestor"
  | "selector.layer.target"
  | "selector.diagnostics"
  | "selector.noRisks"
  | "selector.diff"
  | "selector.diffEmpty"
  | "selector.repairs"
  | "selector.repair.enableAttribute"
  | "selector.validation.unique"
  | "selector.validation.multiple"
  | "selector.validation.missing"
  | "selector.validation.mismatch"
  | "selector.exportPreview"
  | "selector.export.json"
  | "selector.export.playwright"
  | "selector.export.selenium"
  | "selector.copy"
  | "table.rows"
  | "table.columns"
  | "table.selectedRows"
  | "table.selectedColumns"
  | "table.headerLevels"
  | "table.empty"
  | "table.dataPreview"
  | "table.exportPreview"
  | "table.format.csv"
  | "table.format.json"
  | "table.format.markdown"
  | "table.format.xlsx"
  | "table.source.html"
  | "table.source.css-grid"
  | "table.source.flex"
  | "table.confidence.score"
  | "table.confidence.high"
  | "table.confidence.medium"
  | "table.confidence.low"
  | "table.confidence.warning"
  | "table.diagnostics"
  | "table.diagnostic.layoutPattern"
  | "table.diagnostic.consistentColumns"
  | "table.diagnostic.columnAlignment"
  | "table.diagnostic.semanticRoles"
  | "table.diagnostic.headerEvidence"
  | "table.diagnostic.irregularColumns"
  | "table.diagnostic.weakAlignment"
  | "table.diagnostic.missingSemantics"
  | "table.diagnostic.ambiguousHeader"
  | "table.selectAll"
  | "table.clear"
  | "table.toggleRow"
  | "table.toggleColumn"
  | "table.selection.empty"
  | "table.excel.title"
  | "table.excel.frozenHeader"
  | "table.excel.autoFilter"
  | "table.excel.columnWidths"
  | "table.excel.copyUnavailable"
  | "table.copy"
  | "table.save"
  | "table.copied"
  | "table.saved"
  | "table.cancelled"
  | "table.copyFailed"
  | "table.saveFailed"
  | "selector.diagnostic.missing"
  | "selector.diagnostic.multiple"
  | "selector.diagnostic.targetMismatch"
  | "selector.diagnostic.hidden"
  | "selector.risk.dynamicId"
  | "selector.risk.lowSignal"
  | "diagnostic.crossOriginFrame"
  | "diagnostic.closedShadowRoot"
  | "diagnostic.detachedContext"
  | "diagnostic.frameAttachFailed"
  | "diagnostic.frameOwnerUnresolved"
  | "diagnostic.navigationInvalidated"
  | "diagnostic.sessionDetached"
  | "diagnostics.ipc"
  | "diagnostics.app"
  | "diagnostics.nodes"
  | "diagnostics.capturedAt"
  | "diagnostics.target"
  | "testPages.basicDom.title"
  | "testPages.basicDom.description"
  | "testPages.iframe.title"
  | "testPages.iframe.description"
  | "testPages.oopif.title"
  | "testPages.oopif.description"
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
    "capture.delay": "延迟",
    "capture.now": "立即",
    "capture.start": "捕获",
    "capture.cancel": "取消",
    "capture.hotkey": "全局热键：Ctrl/Cmd+Shift+E",
    "panel.targets": "目标",
    "panel.explorer": "结构",
    "panel.properties": "属性",
    "panel.selector": "Selector",
    "panel.tableData": "表格数据",
    "panel.tests": "测试页面",
    "chrome.cardTitle": "Chrome 调试实例",
    "chrome.url": "页面网址",
    "chrome.urlPlaceholder": "留空打开空白页，或输入 example.com",
    "chrome.launchAndOpen": "启动 Chrome 并打开",
    "chrome.openNewTab": "在新标签页打开",
    "chrome.openTestPage": "在 Chrome 中打开",
    "chrome.opened": "已打开并自动连接",
    "chrome.instance.none": "未检测到调试实例",
    "chrome.instance.external": "可复用现有调试实例",
    "chrome.progress.detecting": "正在检测…",
    "chrome.progress.selecting-executable": "正在选择 Chrome…",
    "chrome.progress.launching": "正在启动…",
    "chrome.progress.connecting": "正在连接…",
    "chrome.progress.opening": "正在打开页面…",
    "chrome.error.chrome-not-found": "未找到 Google Chrome。",
    "chrome.error.invalid-chrome-path": "选择的文件不是有效的 chrome.exe。",
    "chrome.error.invalid-url": "网址格式或协议不受支持。",
    "chrome.error.no-debug-port": "没有可用的本机调试端口。",
    "chrome.error.profile-in-use": "专用 Chrome 配置正在被其他实例使用。",
    "chrome.error.launch-failed": "无法启动 Chrome。",
    "chrome.error.launch-exited": "Chrome 在启动过程中提前退出。",
    "chrome.error.cdp-timeout": "等待 Chrome 调试端点超时。",
    "chrome.error.target-create-failed": "无法创建新的 Chrome 标签页。",
    "chrome.error.target-attach-failed": "标签页已打开，但无法自动连接。",
    "chrome.error.test-server-failed": "无法启动内置测试页服务。",
    "empty.properties": "选择元素后，这里会显示属性、可访问性和布局信息。",
    "empty.selector": "选择页面元素后，这里会显示 Selector 候选、评分和诊断。",
    "connection.status": "连接状态",
    "connection.notConnected": "未连接调试目标",
    "connection.connecting": "正在连接",
    "connection.connected": "已连接调试目标",
    "connection.error": "连接异常",
    "connection.noTargets": "未发现可检查页面",
    "connection.targetClosed": "目标已关闭，正在等待重连",
    "connection.reconnected": "已恢复连接",
    "connection.navigated": "页面已刷新或跳转",
    "connection.reconnecting": "连接中断，正在重试",
    "connection.debugPort": "调试端口",
    "connection.guide": "启动 Chrome/Edge 时添加 --remote-debugging-port=9222。",
    "connection.discover": "扫描本机端点",
    "connection.discovering": "正在扫描",
    "selection.restored": "已恢复原选择",
    "selection.ambiguous": "原选择存在多个候选，已回到根节点",
    "selection.notFound": "原选择已消失，已回到根节点",
    "target.current": "当前页面",
    "target.empty": "连接后会显示 Chrome/Edge 可检查页面。",
    "tree.nodes": "节点",
    "tree.empty": "连接页面后会显示 DOM 树。",
    "tree.searchPlaceholder": "搜索节点",
    "tree.searchResults": "搜索",
    "tree.searchNoResults": "0",
    "tree.previousMatch": "上一个匹配",
    "tree.nextMatch": "下一个匹配",
    "tree.badge.page": "PAGE",
    "tree.badge.frame": "FRAME",
    "tree.badge.shadow": "SHADOW",
    "tree.badge.limit": "LIMIT",
    "properties.selected": "选中元素",
    "properties.attributes": "DOM 属性",
    "properties.accessibility": "可访问性",
    "properties.layout": "布局",
    "properties.text": "文本",
    "properties.visible": "可见",
    "properties.hidden": "不可见",
    "properties.boundingBox": "边界",
    "properties.role": "角色",
    "properties.accessibleName": "可访问名称",
    "properties.description": "可访问描述",
    "properties.disabled": "已禁用",
    "properties.clickable": "可点击",
    "properties.occluded": "被遮挡",
    "properties.visibilityReasons": "不可见/遮挡原因",
    "properties.yes": "是",
    "properties.no": "否",
    "properties.filterAttributes": "按属性名或值过滤",
    "properties.attribute.unique": "唯一",
    "properties.attribute.stable": "稳定",
    "properties.attribute.dynamic": "疑似动态",
    "properties.attribute.neutral": "一般",
    "properties.tag": "标签",
    "properties.nodeName": "节点名",
    "properties.nodeType": "节点类型",
    "properties.context": "上下文",
    "properties.framePath": "Frame 路径",
    "properties.shadowPath": "Shadow 路径",
    "preview.title": "验收样例",
    "preview.openPage": "打开页面",
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
    "selector.layer.page": "页面层",
    "selector.layer.frame": "Frame 层",
    "selector.layer.shadow": "Shadow 层",
    "selector.layer.ancestor": "祖先层",
    "selector.layer.target": "目标层",
    "selector.diagnostics": "诊断",
    "selector.noRisks": "暂无风险",
    "selector.diff": "修改记录",
    "selector.diffEmpty": "尚未修改",
    "selector.repairs": "确定性修复建议",
    "selector.repair.enableAttribute": "启用已验证的稳定属性",
    "selector.validation.unique": "唯一匹配当前目标",
    "selector.validation.multiple": "匹配多个候选",
    "selector.validation.missing": "未找到匹配元素",
    "selector.validation.mismatch": "唯一匹配指向其他元素",
    "selector.exportPreview": "导出预览",
    "selector.export.json": "JSON",
    "selector.export.playwright": "Playwright",
    "selector.export.selenium": "Selenium",
    "selector.copy": "复制导出内容",
    "table.rows": "数据行",
    "table.columns": "列",
    "table.selectedRows": "已选行",
    "table.selectedColumns": "已选列",
    "table.headerLevels": "表头层级",
    "table.empty": "该表格没有可提取的数据。",
    "table.dataPreview": "数据预览",
    "table.exportPreview": "格式预览",
    "table.format.csv": "CSV",
    "table.format.json": "JSON",
    "table.format.markdown": "Markdown",
    "table.format.xlsx": "Excel",
    "table.source.html": "HTML 表格",
    "table.source.css-grid": "CSS Grid 伪表格",
    "table.source.flex": "Flex 伪表格",
    "table.confidence.score": "置信度",
    "table.confidence.high": "高置信度",
    "table.confidence.medium": "中置信度",
    "table.confidence.low": "低置信度",
    "table.confidence.warning": "该结果可能是普通布局，请核对数据范围后再导出。",
    "table.diagnostics": "识别依据",
    "table.diagnostic.layoutPattern": "检测到重复的表格式布局",
    "table.diagnostic.consistentColumns": "各行列数一致",
    "table.diagnostic.columnAlignment": "单元格列位置对齐",
    "table.diagnostic.semanticRoles": "存在表格 ARIA 语义",
    "table.diagnostic.headerEvidence": "首行具有明确表头语义",
    "table.diagnostic.irregularColumns": "各行列数不一致",
    "table.diagnostic.weakAlignment": "列位置对齐较弱",
    "table.diagnostic.missingSemantics": "缺少表格 ARIA 语义",
    "table.diagnostic.ambiguousHeader": "无法可靠判断表头，首行已保留为数据",
    "table.selectAll": "全选",
    "table.clear": "清空",
    "table.toggleRow": "选择行",
    "table.toggleColumn": "选择列",
    "table.selection.empty": "请至少选择一行和一列后再导出。",
    "table.excel.title": "Excel 工作簿预览",
    "table.excel.frozenHeader": "冻结首行",
    "table.excel.autoFilter": "启用自动筛选",
    "table.excel.columnWidths": "列宽范围",
    "table.excel.copyUnavailable": "Excel 是二进制文件，请使用保存文件。",
    "table.copy": "复制",
    "table.save": "保存文件",
    "table.copied": "已复制",
    "table.saved": "已保存",
    "table.cancelled": "已取消",
    "table.copyFailed": "复制失败",
    "table.saveFailed": "保存失败",
    "selector.diagnostic.missing": "未匹配任何元素",
    "selector.diagnostic.multiple": "匹配到多个元素",
    "selector.diagnostic.targetMismatch": "唯一匹配结果不是捕获目标",
    "selector.diagnostic.hidden": "目标元素不可见",
    "selector.risk.dynamicId": "疑似动态 ID",
    "selector.risk.lowSignal": "低稳定性属性",
    "diagnostic.crossOriginFrame": "跨域 Frame 内容不可访问",
    "diagnostic.closedShadowRoot": "Closed Shadow Root 内容不可访问",
    "diagnostic.detachedContext": "上下文已分离，无法访问",
    "diagnostic.frameAttachFailed": "无法附加跨域 Frame 调试 Session",
    "diagnostic.frameOwnerUnresolved": "无法定位跨域 Frame 的宿主元素",
    "diagnostic.navigationInvalidated": "页面导航已使捕获上下文失效",
    "diagnostic.sessionDetached": "跨域 Frame 调试 Session 已脱离",
    "app.description": "连接并检查网页 UI，生成 Selector 与结构化数据",
    "diagnostics.ipc": "主进程往返",
    "diagnostics.app": "运行环境",
    "diagnostics.nodes": "快照节点",
    "diagnostics.capturedAt": "捕获时间",
    "diagnostics.target": "调试目标",
    "testPages.basicDom.title": "普通 DOM",
    "testPages.basicDom.description": "按钮、输入框、链接、动态 class 和语义属性。",
    "testPages.iframe.title": "iframe",
    "testPages.iframe.description": "同源嵌套 iframe 和各层 frame 内部可选元素。",
    "testPages.oopif.title": "跨域 iframe / OOPIF",
    "testPages.oopif.description": "跨站子 Frame、嵌套 Frame、导航失效和多匹配样例。",
    "testPages.shadowDom.title": "Shadow DOM",
    "testPages.shadowDom.description": "open、嵌套 open 和 closed Shadow 场景。",
    "testPages.dynamicList.title": "动态列表",
    "testPages.dynamicList.description": "索引变化、随机 id 和 hash class。",
    "testPages.table.title": "表格",
    "testPages.table.description": "标准表格、Grid/Flex 伪表格、误判防护和大型数据集。",
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
    "capture.delay": "Delay",
    "capture.now": "Now",
    "capture.start": "Capture",
    "capture.cancel": "Cancel",
    "capture.hotkey": "Global hotkey: Ctrl/Cmd+Shift+E",
    "panel.targets": "Targets",
    "panel.explorer": "Structure",
    "panel.properties": "Properties",
    "panel.selector": "Selector",
    "panel.tableData": "Table data",
    "panel.tests": "Test pages",
    "chrome.cardTitle": "Chrome debug instance",
    "chrome.url": "Page URL",
    "chrome.urlPlaceholder": "Leave blank for a blank page, or enter example.com",
    "chrome.launchAndOpen": "Launch Chrome and open",
    "chrome.openNewTab": "Open in new tab",
    "chrome.openTestPage": "Open in Chrome",
    "chrome.opened": "Opened and connected",
    "chrome.instance.none": "No debug instance detected",
    "chrome.instance.external": "An existing debug instance is available",
    "chrome.progress.detecting": "Detecting…",
    "chrome.progress.selecting-executable": "Selecting Chrome…",
    "chrome.progress.launching": "Launching…",
    "chrome.progress.connecting": "Connecting…",
    "chrome.progress.opening": "Opening page…",
    "chrome.error.chrome-not-found": "Google Chrome was not found.",
    "chrome.error.invalid-chrome-path": "The selected file is not a valid chrome.exe.",
    "chrome.error.invalid-url": "The URL format or protocol is not supported.",
    "chrome.error.no-debug-port": "No local debug port is available.",
    "chrome.error.profile-in-use": "The dedicated Chrome profile is already in use.",
    "chrome.error.launch-failed": "Chrome could not be launched.",
    "chrome.error.launch-exited": "Chrome exited before startup completed.",
    "chrome.error.cdp-timeout": "Timed out waiting for the Chrome debug endpoint.",
    "chrome.error.target-create-failed": "A new Chrome tab could not be created.",
    "chrome.error.target-attach-failed": "The tab opened, but UI Explorer could not connect.",
    "chrome.error.test-server-failed": "The built-in test page server could not start.",
    "empty.properties": "Selected element attributes, accessibility, and layout will appear here.",
    "empty.selector": "Select a page element to view selector candidates, scores, and diagnostics.",
    "connection.status": "Connection",
    "connection.notConnected": "No debug target connected",
    "connection.connecting": "Connecting",
    "connection.connected": "Debug target connected",
    "connection.error": "Connection error",
    "connection.noTargets": "No inspectable pages found",
    "connection.targetClosed": "Target closed; waiting to reconnect",
    "connection.reconnected": "Connection restored",
    "connection.navigated": "Page refreshed or navigated",
    "connection.reconnecting": "Connection interrupted; retrying",
    "connection.debugPort": "Debug port",
    "connection.guide": "Start Chrome/Edge with --remote-debugging-port=9222.",
    "connection.discover": "Scan local endpoints",
    "connection.discovering": "Scanning",
    "selection.restored": "Previous selection restored",
    "selection.ambiguous": "Previous selection is ambiguous; returned to root",
    "selection.notFound": "Previous selection disappeared; returned to root",
    "target.current": "Current page",
    "target.empty": "Inspectable Chrome/Edge pages appear after connecting.",
    "tree.nodes": "Nodes",
    "tree.empty": "Connect a page to render the DOM tree.",
    "tree.searchPlaceholder": "Search nodes",
    "tree.searchResults": "Search",
    "tree.searchNoResults": "0",
    "tree.previousMatch": "Previous match",
    "tree.nextMatch": "Next match",
    "tree.badge.page": "PAGE",
    "tree.badge.frame": "FRAME",
    "tree.badge.shadow": "SHADOW",
    "tree.badge.limit": "LIMIT",
    "properties.selected": "Selected element",
    "properties.attributes": "DOM attributes",
    "properties.accessibility": "Accessibility",
    "properties.layout": "Layout",
    "properties.text": "Text",
    "properties.visible": "Visible",
    "properties.hidden": "Hidden",
    "properties.boundingBox": "Bounds",
    "properties.role": "Role",
    "properties.accessibleName": "Accessible name",
    "properties.description": "Description",
    "properties.disabled": "Disabled",
    "properties.clickable": "Clickable",
    "properties.occluded": "Occluded",
    "properties.visibilityReasons": "Visibility reasons",
    "properties.yes": "Yes",
    "properties.no": "No",
    "properties.filterAttributes": "Filter by attribute name or value",
    "properties.attribute.unique": "Unique",
    "properties.attribute.stable": "Stable",
    "properties.attribute.dynamic": "Possibly dynamic",
    "properties.attribute.neutral": "Neutral",
    "properties.tag": "Tag",
    "properties.nodeName": "Node name",
    "properties.nodeType": "Node type",
    "properties.context": "Context",
    "properties.framePath": "Frame path",
    "properties.shadowPath": "Shadow path",
    "preview.title": "Acceptance samples",
    "preview.openPage": "Open page",
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
    "selector.layer.page": "Page layer",
    "selector.layer.frame": "Frame layer",
    "selector.layer.shadow": "Shadow layer",
    "selector.layer.ancestor": "Ancestor layer",
    "selector.layer.target": "Target layer",
    "selector.diagnostics": "Diagnostics",
    "selector.noRisks": "No risks",
    "selector.diff": "Changes",
    "selector.diffEmpty": "No changes",
    "selector.repairs": "Deterministic repairs",
    "selector.repair.enableAttribute": "Enable validated stable attribute",
    "selector.validation.unique": "Uniquely matches the current target",
    "selector.validation.multiple": "Matches multiple candidates",
    "selector.validation.missing": "No matching element",
    "selector.validation.mismatch": "Unique match points to another element",
    "selector.exportPreview": "Export preview",
    "selector.export.json": "JSON",
    "selector.export.playwright": "Playwright",
    "selector.export.selenium": "Selenium",
    "selector.copy": "Copy export",
    "table.rows": "Data rows",
    "table.columns": "Columns",
    "table.selectedRows": "Selected rows",
    "table.selectedColumns": "Selected columns",
    "table.headerLevels": "Header levels",
    "table.empty": "This table has no extractable data.",
    "table.dataPreview": "Data preview",
    "table.exportPreview": "Format preview",
    "table.format.csv": "CSV",
    "table.format.json": "JSON",
    "table.format.markdown": "Markdown",
    "table.format.xlsx": "Excel",
    "table.source.html": "HTML table",
    "table.source.css-grid": "CSS Grid pseudo-table",
    "table.source.flex": "Flex pseudo-table",
    "table.confidence.score": "Confidence",
    "table.confidence.high": "High confidence",
    "table.confidence.medium": "Medium confidence",
    "table.confidence.low": "Low confidence",
    "table.confidence.warning": "This may be a regular layout. Verify the data range before exporting.",
    "table.diagnostics": "Recognition evidence",
    "table.diagnostic.layoutPattern": "A repeated table-like layout was detected",
    "table.diagnostic.consistentColumns": "Every row has a consistent column count",
    "table.diagnostic.columnAlignment": "Cells align into stable columns",
    "table.diagnostic.semanticRoles": "Table ARIA semantics are present",
    "table.diagnostic.headerEvidence": "The first row has explicit header semantics",
    "table.diagnostic.irregularColumns": "Row column counts are inconsistent",
    "table.diagnostic.weakAlignment": "Column alignment is weak",
    "table.diagnostic.missingSemantics": "Table ARIA semantics are missing",
    "table.diagnostic.ambiguousHeader": "Header detection was ambiguous, so the first row remains data",
    "table.selectAll": "Select all",
    "table.clear": "Clear",
    "table.toggleRow": "Toggle row",
    "table.toggleColumn": "Toggle column",
    "table.selection.empty": "Select at least one row and one column before exporting.",
    "table.excel.title": "Excel workbook preview",
    "table.excel.frozenHeader": "Freeze the header row",
    "table.excel.autoFilter": "Enable automatic filters",
    "table.excel.columnWidths": "Column width range",
    "table.excel.copyUnavailable": "Excel is a binary file. Use Save file instead.",
    "table.copy": "Copy",
    "table.save": "Save file",
    "table.copied": "Copied",
    "table.saved": "Saved",
    "table.cancelled": "Cancelled",
    "table.copyFailed": "Copy failed",
    "table.saveFailed": "Save failed",
    "selector.diagnostic.missing": "No elements matched",
    "selector.diagnostic.multiple": "Multiple elements matched",
    "selector.diagnostic.targetMismatch": "Unique match is not the captured target",
    "selector.diagnostic.hidden": "Target element is hidden",
    "selector.risk.dynamicId": "Possible dynamic ID",
    "selector.risk.lowSignal": "Low-stability attribute",
    "diagnostic.crossOriginFrame": "Cross-origin frame content is unavailable",
    "diagnostic.closedShadowRoot": "Closed Shadow Root content is unavailable",
    "diagnostic.detachedContext": "The browsing context is detached and unavailable",
    "diagnostic.frameAttachFailed": "Unable to attach the cross-origin frame debugging session",
    "diagnostic.frameOwnerUnresolved": "Unable to resolve the cross-origin frame owner element",
    "diagnostic.navigationInvalidated": "Page navigation invalidated the captured context",
    "diagnostic.sessionDetached": "The cross-origin frame debugging session detached",
    "app.description": "Inspect web UI, generate selectors, and extract structured data",
    "diagnostics.ipc": "Main process round trip",
    "diagnostics.app": "Runtime",
    "diagnostics.nodes": "Snapshot nodes",
    "diagnostics.capturedAt": "Captured at",
    "diagnostics.target": "Debug target",
    "testPages.basicDom.title": "Basic DOM",
    "testPages.basicDom.description": "Buttons, inputs, links, dynamic classes, and semantic attributes.",
    "testPages.iframe.title": "iframe",
    "testPages.iframe.description": "Nested same-origin iframes with selectable content at each depth.",
    "testPages.oopif.title": "Cross-origin iframe / OOPIF",
    "testPages.oopif.description": "Cross-site child frames, nested frames, navigation invalidation, and multiple matches.",
    "testPages.shadowDom.title": "Shadow DOM",
    "testPages.shadowDom.description": "Open, nested open, and closed Shadow scenarios.",
    "testPages.dynamicList.title": "Dynamic list",
    "testPages.dynamicList.description": "Changing indexes, random ids, and hash classes.",
    "testPages.table.title": "Table",
    "testPages.table.description": "Standard, Grid/Flex pseudo, false-positive, and large table fixtures.",
    "testPages.popup.title": "Popup",
    "testPages.popup.description": "Menus, tooltips, popovers, and delayed capture samples."
  }
};
