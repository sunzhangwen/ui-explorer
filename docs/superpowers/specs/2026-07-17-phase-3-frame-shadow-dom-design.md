# Phase 3 iframe 与 Shadow DOM 穿透设计

## 目标与范围

Phase 3 在现有 Electron、CDP、React 和 Selector 能力上补齐复杂网页上下文探索。用户可以在同源及嵌套 iframe、open Shadow DOM 中浏览 DOM 树、捕获和高亮元素，并生成带上下文进入逻辑的 Selector 导出代码。

本阶段不通过多 CDP session 穿透跨域 iframe 或 OOPIF。此类 frame 必须显示不可穿透诊断，不得表现为成功捕获。完整 CDP target/session 管理移至 Phase 8。

## 方案选择

采用增量扩展现有快照模型的方案。现有 `ElementSnapshot` 树继续作为 DOM、选择状态和本地验证的唯一数据来源，在节点上补充上下文边界和诊断信息。该方案能复用当前捕获、高亮、Selector 编辑器和导出链路，改动集中且可逐步测试。

未采用以下方案：

- 独立 Context Graph：边界清晰，但需要重写树、选择和验证的数据流，超出 Phase 3 范围。
- 仅在导出阶段拼接 frame/shadow 字符串：改动较少，但无法满足树展示、分层编辑、上下文验证和限制诊断要求。

## 快照与上下文模型

`ElementSnapshot` 增加结构类型和上下文元数据：

- 普通页面根节点属于 `page` 上下文。
- iframe 元素仍作为 DOM 元素展示，其同源文档根作为 `frame` 边界子节点，边界保存 frame 元素的稳定定位信息和完整 frame chain。
- open Shadow Root 使用 `shadow` 边界节点，保存宿主元素定位信息和完整 shadow chain。
- 无法访问的 iframe 使用 `inaccessible-frame` 诊断，包含同源限制说明。
- 无 `shadowRoot` 但已知通过 closed mode 创建的测试宿主使用 `closed-shadow-root` 诊断。通用页面若无法从公开 DOM/CDP 信息可靠判断 closed mode，则不猜测、不误报。

frame chain 和 shadow chain 使用从页面根到当前上下文的有序边界描述。每个边界包含宿主节点 ID、标签和用于导出的 Selector 层信息。嵌套 frame 或 shadow 时在父 chain 基础上追加，保证选中任意内部元素都可还原完整路径。

## 捕获、高亮与树展示

快照脚本递归遍历当前 document、可访问 iframe document 和 open Shadow Root。元素注册表覆盖所有可访问上下文，使树点击和拾取结果继续使用统一元素 ID。

高亮在目标元素所属 document 内创建 overlay。iframe 内元素使用该 frame 的局部 viewport 坐标，因此 overlay 附着到 `ownerDocument`；open Shadow DOM 元素同样通过 `ownerDocument` 高亮。清理 overlay 时递归清理所有已访问 document，防止 frame 内残留。

树组件根据结构类型显示不同图标和标签：页面、frame、shadow、普通元素和限制诊断可以直接区分。边界节点可正常展开；不可穿透节点没有伪造子树，并显示诊断文案。

拾取监听器安装到主 document 和所有同源 iframe document。事件的 composed path 用于识别 open Shadow DOM 内元素。跨域 iframe 和 closed Shadow Root 内部不会产生成功拾取结果。

## Selector 分层、验证与编辑

`SelectorLayer.kind` 扩展为 `page | frame | shadow | ancestor | target`。

- `page` 表示当前顶层页面，是上下文起点。
- `frame` 表示进入 iframe 的定位步骤。
- `shadow` 表示进入 open Shadow Root 的宿主边界。
- `ancestor` 和 `target` 沿用 Phase 2 的元素约束。

生成候选时，从目标节点路径提取所有上下文边界，再选择靠近目标的普通祖先和目标层。所有层均可独立启用或禁用；frame、shadow 层也可编辑标签和属性。禁用上下文层后立即重新序列化并在快照中验证。

验证只在启用边界所确定的上下文内寻找候选。frame 或 shadow 边界存在但被禁用时，验证结果应反映更宽上下文中的实际匹配，不将不同 document 或 shadow tree 中的同名节点错误地视作同一直接 DOM 范围。

## 导出

JSON 导出保留完整分层模型、frame chain、shadow chain、评分、验证和诊断。

Playwright TypeScript 导出按启用层生成：

1. 从 `page` 开始。
2. 每个 frame 层追加 `frameLocator(...)`。
3. open Shadow DOM 使用 Playwright locator 的原生 open-shadow 穿透能力定位宿主内部目标，同时保留 shadow 边界注释，便于读者理解上下文路径。
4. 最后追加 ancestor/target locator，并执行可见性断言和示例操作。

Selenium Python 对 iframe 使用 `switch_to.frame(...)`。由于 Selenium 对 Shadow Root 的 API 和浏览器版本约束不同，open Shadow DOM 导出通过 `shadow_root` 逐层进入。不可穿透上下文不生成伪成功代码，而在导出结果中给出限制说明。

## 错误与限制诊断

诊断使用稳定代码和可本地化消息：

- `cross-origin-frame`：当前 Phase 仅支持同源 frame，完整 CDP 支持位于 Phase 8。
- `closed-shadow-root`：closed mode 不暴露内部树，无法浏览、拾取或生成内部 Selector。
- `detached-context`：快照后 frame 或 shadow host 已被移除，需要刷新快照。

诊断同时出现在树节点、元素/Selector 面板和导出预览中。限制场景的状态与普通的 Selector 零匹配状态分开呈现。

## 测试与验收

单元测试覆盖：

- 上下文路径提取，包括单层和嵌套 frame、嵌套 open Shadow Root、frame 与 shadow 混合路径。
- `page/frame/shadow/ancestor/target` 层生成、启停和重新验证。
- Playwright 与 Selenium 的 frame/shadow 导出顺序。
- closed Shadow Root 和不可访问 frame 的诊断，不产生成功定位代码。
- 快照统计和树辅助函数对边界节点的处理。

内置测试页扩展为嵌套 iframe、嵌套 open Shadow Root、closed Shadow Root 标记场景。最终运行 `npm test`、`npm run typecheck` 和 `npm run build`，并用 Electron 连接测试页手动检查树标记、拾取、高亮和导出预览。

## Phase 8 后续能力

Phase 8 增加“跨域 iframe/OOPIF CDP 穿透”任务：通过 `Target.setAutoAttach`、扁平 session 和 frame/target 映射管理跨域子 frame，使快照、拾取、高亮、验证和导出可以跨 CDP session 工作。该任务在 Phase 3 的同源上下文模型稳定后实施。
