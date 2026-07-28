# Phase 6：跨域 iframe/OOPIF 多 CDP Session 设计

## 范围与目标

Phase 6 将当前单 page WebSocket、单 Runtime 上下文的浏览器连接改造为统一的多 CDP Session 网页上下文模型，使跨域 iframe/OOPIF 与普通 DOM、同源 iframe 和 open Shadow DOM 使用一致的快照、选择、验证、高亮和导出流程。

本阶段完成 `REQUIREMENTS.md` 中的 6.1–6.7：

- 使用 `Target.setAutoAttach` 管理根页面与相关子 target 的 Session 生命周期。
- 维护 frame、target、session、loader 和 execution context 映射。
- 将 OOPIF 文档拼接到父 iframe 节点，并保留完整 frame 路径。
- 在元素所属 Session 中完成拾取、高亮和 Selector 验证。
- 将子 frame 坐标换算到顶层页面坐标。
- 扩展 JSON、Playwright 和 Selenium 导出。
- 显示无法附加、导航失效和 Session 脱离诊断。

## 非目标

- 不支持 closed Shadow Root 穿透。
- 不引入任意 JavaScript 执行界面；该能力仍属于 Phase 8。
- 不更换现有 Selector 评分与层级编辑语义。
- 不实现浏览器扩展连接方式。
- 不将临时 CDP `sessionId` 写入可移植的 Playwright 或 Selenium 导出。

## 选定架构

使用浏览器级 WebSocket 和扁平 CDP Session。

连接调试端点时，从 `/json/version` 获取浏览器 WebSocket。选择页面后，通过 `Target.attachToTarget({ flatten: true })` 建立根页面 Session，再在根 Session 和新附加的子 Session 上递归调用 `Target.setAutoAttach`。所有命令通过同一 WebSocket 发送，并使用消息顶层的 `sessionId` 路由到对应 Session。

不采用以下方案：

- 保留 page WebSocket 并只附加子 Session：根 target 恢复、递归附加和浏览器级 target 生命周期不够统一。
- 每个 target 单独连接 WebSocket：多连接之间的发现、导航和脱离存在竞态，也无法形成单一事件顺序。

## 组件边界

### 扁平 CDP 连接

主进程中的底层连接负责：

- 发送带可选 `sessionId` 的命令。
- 将响应按命令 ID 返回给调用方。
- 分发带 `sessionId` 的 CDP 事件。
- WebSocket 关闭时拒绝全部待处理请求。

该层不解释 frame 或页面语义。

### 网页上下文注册表

注册表是独立、可测试的纯状态模型。每个上下文记录：

- `targetId`
- `sessionId`
- `frameId`
- `parentFrameId`
- `loaderId`
- 默认 `executionContextId` 或 `executionContextUniqueId`
- 生命周期状态：`attaching`、`active`、`navigating`、`detached`、`unavailable`
- 不可用时的确定性诊断

注册表消费 `Target.attachedToTarget`、`Target.detachedFromTarget`、`Page.frameAttached`、`Page.frameNavigated`、`Page.frameDetached`、`Runtime.executionContextCreated`、`Runtime.executionContextDestroyed` 和 `Runtime.executionContextsCleared`。

导航或脱离会先使旧上下文和快照失效，再接受新的 loader 与 execution context。陈旧 Session、loader 或 snapshot token 不能继续执行拾取、高亮或验证。

### 多 Session 快照编排

现有浏览器脚本继续负责单个文档内部的 DOM、同源 iframe 和 open Shadow DOM 遍历。主进程在每个活动 Session 中执行单文档快照，然后按 frame 映射拼接结果：

1. 获取根页面和 OOPIF Session 的 frame tree。
2. 使用父 Session 的 `DOM.getFrameOwner` 找到子 frame 对应的 iframe host。
3. 在生成父快照前为准确的 frame host 建立临时、不可枚举的 frame 标记。
4. 单 Session 快照返回 frame 标记，主进程据此用子 Session 文档替换原有的跨域不可访问占位节点。
5. 重新计算父子关系、深度、节点数和上下文路径。

元素 ID 使用快照级命名空间和 Session 上下文生成，保证不同 Session 中不会出现 `n-1` 冲突。Renderer 仍接收一棵 `ElementSnapshot` 树。

无法找到 frame owner、子 target 无法附加或子 Session 尚未就绪时，保留诊断节点，不得把空内容报告为成功快照。

## 捕获、验证与高亮

每个元素的内部运行时引用包含所属 Session 和该 Session 的本地元素 ID。Renderer 只传输不透明的全局元素 ID；主进程负责解析并路由。

- 拾取：在所有活动文档 Session 中安装现有捕获监听器，轮询时汇总各 Session 的拾取结果。
- 验证：候选 Selector 按 frame/shadow 层级解析，在目标所属 Session 中验证最终匹配；多匹配结果转换为全局元素 ID。
- 高亮：高亮脚本在每个匹配元素所属 Session 内执行，并返回逐元素状态。
- 坐标：快照中的 `boundingBox` 保存顶层页面坐标。子 Session 局部坐标沿 frame owner 链累加 iframe content box 偏移；任一边界已脱离时返回 `detached-context`。

高亮覆盖层仍绘制在元素所属文档中，因此不会跨文档修改 DOM；顶层坐标用于工作台信息和跨上下文一致性。

## 导出

内部 `ContextBoundary` 增加可选的 frame/Session 路由元数据，但可移植导出仅使用稳定边界：

- JSON：保存有序 frame chain、shadow chain，以及用于诊断的 frame/target 上下文；临时 Session ID 只作为运行时诊断信息，不作为重放条件。
- Playwright：继续使用 `frameLocator(...)` 逐层进入 frame，并在目标上下文应用 Locator。
- Selenium：继续使用 `switch_to.frame(...)` 逐层进入 frame；Shadow DOM 逻辑保持现有实现。

同源 iframe 与 OOPIF 使用相同导出模型，调用方无需感知进程边界。

## 错误与诊断

新增或细化以下诊断状态：

- `frame-attach-failed`：发现 OOPIF，但未能建立可用 Session。
- `frame-owner-unresolved`：无法把子 frame 映射回父 iframe host。
- `navigation-invalidated`：操作引用了导航前的 loader 或快照。
- `session-detached`：目标 Session 已脱离。

诊断节点可展示、不可作为普通元素选择，也不能生成成功的 Selector 验证结果。错误信息提供中英文文案，并保留底层 CDP 错误摘要用于排查。

## 测试策略

对行为密集型上下文与 IPC 逻辑使用 RED/GREEN：

- 扁平命令和事件的 `sessionId` 路由。
- attached、递归 auto-attach、导航、frame swap 和 detach 状态转换。
- frame/target/session 映射与旧上下文失效。
- 多 Session 快照拼接、全局元素 ID 和上下文路径。
- 跨 Session 高亮、拾取、验证和多匹配分组。
- Playwright、Selenium、JSON 的 OOPIF 导出。
- 无法附加和导航失效诊断。

新增内置 OOPIF 测试页。父页和子页在 `localhost` 与 `127.0.0.1` 之间切换 hostname、复用当前端口，使其成为跨站 frame；验收 Chrome 保持默认 Site Isolation。测试页包含可选元素、嵌套 frame、导航替换和多匹配样例。

最终验证执行：

- 相关 Node 测试。
- `npm test`
- `npm run typecheck`
- `npm run build`
- 在可行时使用真实 Chrome/Edge 调试端点人工验证 OOPIF 捕获、高亮、导航和脱离。

## 实施顺序

1. 扩展 WebSocket CDP 客户端支持事件和扁平 Session 路由。
2. 实现并测试上下文注册表。
3. 将 `BrowserSession` 迁移到浏览器 WebSocket、根 Session 与递归 auto-attach。
4. 实现 frame owner 标记、多 Session 快照和全局元素引用。
5. 路由拾取、高亮和验证，并实现坐标换算。
6. 扩展 IPC、诊断、i18n 和导出。
7. 增加 OOPIF 测试页和回归测试。
8. 完成全量验证与人工验收。
