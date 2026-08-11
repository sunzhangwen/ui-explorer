# UI Explorer 需求文档

## 1. 项目概述

**项目名称**：UI Explorer
**项目类型**：桌面应用（Electron + React + TypeScript）
**第一阶段目标**：先完成一个可用的网页 UI Explorer MVP，能够连接 Chrome/Edge，捕获网页元素，展示 DOM/iframe/Shadow 层级、属性和 Selector 信息，支持 Selector 手动编辑、测试、层级属性开关与代码导出。
**长期目标**：逐步扩展到桌面应用 UIAutomation、表格结构提取、UiPath 兼容导出、冻结捕获、JS 指令生成和企业级项目协作能力。

### 1.1 产品定位

UI Explorer 面向 RPA 开发者、测试工程师和前端自动化开发者，用于快速识别 UI 元素、生成稳定 Selector、诊断定位失败原因，并导出到 Playwright、Selenium、UiPath 等自动化环境。

### 1.2 路线原则

1. 当前项目关注网页端能力，先完成“连接目标页面 -> 捕获元素 -> 生成 Selector -> 验证唯一性 -> 导出代码”的闭环。
2. 按“网页能力先稳定，再扩展桌面与生态”的顺序推进；桌面应用识别、冻结捕获、项目资产化、AI 和企业能力均作为规划功能，目前不做落地实现。
3. Selector 能力作为核心竞争力优先建设，必须从第一版支持唯一性、稳定性评分、iframe 路径和 open mode Shadow DOM 路径。
4. 每个阶段必须有可演示、可验收的功能，不以“框架搭好”作为唯一成果。
5. `.uiproj` schema 等网页、桌面和 UiPath 资产模型稳定后再冻结，避免为后续能力反复迁移项目文件。

---

## 2. MVP 范围

### 2.1 MVP 必须完成的能力

| 模块 | MVP 功能 | 优先级 |
|------|----------|--------|
| 目标连接 | 通过 Chrome DevTools Protocol 连接 Chrome/Edge 调试目标 | P0 |
| 页面发现 | 列出可连接页面、显示标题、URL、连接状态 | P0 |
| 元素捕获 | 鼠标悬停高亮、点击选中网页元素 | P0 |
| 层级结构 | 展示 DOM 树、iframe 层级、open mode Shadow DOM 层级 | P0 |
| 属性面板 | 展示元素属性、可访问性属性、布局信息、可见性信息 | P0 |
| Selector 生成 | 自动生成 CSS、XPath、Playwright Locator 候选 | P0 |
| Selector 编辑 | 支持手动编辑 Selector，启用/禁用某一层，启用/禁用某层的某个属性或标签 | P0 |
| Selector 测试 | 实时验证匹配数量、唯一性、可见性和目标一致性 | P0 |
| 稳定性评分 | 对候选 Selector 给出稳定性评分和风险原因 | P0 |
| 高亮联动 | 树节点、Selector 匹配结果和目标页面高亮联动 | P0 |
| 导出 | 导出 JSON、Playwright TypeScript、Selenium Python | P0 |
| 全局样式与语言基础 | 建立主题 token、组件样式变量和 i18n 文案结构，便于后期切换 UI 风格和语言 | P0 |

### 2.2 MVP 暂不承诺的能力

| 功能 | 后置原因 | 计划阶段 |
|------|----------|----------|
| Windows UIAutomation 桌面应用识别 | 需要原生桥接、权限处理和多框架兼容验证 | Phase 10（规划功能，暂不落地） |
| SuspendThread/ResumeThread 冻结捕获 | 有卡死目标进程和权限风险，需要安全保护 | Phase 10（规划功能，暂不落地） |
| 完整 UiPath XAML 活动文件导出 | Phase 9 只做网页端 UiPath Selector XML，不保留 XAML 实验项 | 不纳入当前范围 |
| 项目管理与 Selector 回归验证 | 等网页、桌面和 UiPath 资产模型稳定后再冻结 `.uiproj` schema，避免反复迁移 | Phase 11（规划功能，暂不落地） |
| div 表格智能识别 | 启发式复杂，容易误判 | Phase 7 已完成 |
| 一键执行任意 JS | 有安全和误操作风险 | Phase 8 已完成 |
| AI 辅助 | 依赖稳定的本地诊断、脱敏和结果验证机制 | Phase 12（规划功能，暂不落地） |
| 云同步和团队协作 | 依赖本地项目模型、账户、权限和服务端能力 | Phase 13（规划功能，暂不落地） |

---

## 3. 核心功能需求

### 3.1 目标连接与页面管理

**目标**：稳定连接浏览器调试目标，并管理当前可探索页面。

| 需求项 | 描述 | 优先级 |
|--------|------|--------|
| CDP endpoint 输入 | 支持输入 Chrome/Edge 远程调试端点 | Phase 1 已完成 |
| 本机调试端点发现 | 自动发现本机 Chrome/Edge CDP 端点 | Phase 5 |
| 页面列表 | 展示可连接页面的标题、URL、目标 ID、连接状态 | P0 |
| 连接状态监控 | 断线、页面刷新、目标关闭时提示并可重连 | Phase 5 |
| 调试端口引导 | 当浏览器未开启远程调试时，给出启动参数说明 | Phase 5 |
| 多页面切换 | 在多个 CDP target 之间切换当前探索页面 | Phase 1 已完成 |

### 3.2 网页元素捕获引擎

**目标**：识别网页元素、iframe 内元素和 open mode Shadow DOM 内元素。

| 需求项 | 描述 | 优先级 |
|--------|------|--------|
| DOM 树获取 | 通过 CDP 获取 DOM 层级，支持懒加载和节点展开 | P0 |
| iframe 识别 | 识别 iframe/frame 层级，保存 frame chain | P0 |
| 跨域 iframe/OOPIF | 通过多 CDP Session 遍历、捕获和验证跨域子 frame | Phase 6 |
| Shadow DOM 识别 | 识别 open mode Shadow Root，保存 shadow chain | P0 |
| 实时捕获模式 | 鼠标悬停高亮，点击选中目标元素 | P0 |
| 元素快照 | 捕获元素标签、属性、文本、role、可见性、bounding box、frame path、shadow path | P0 |
| 动态 DOM 刷新 | 页面变化后刷新当前节点和 Selector，并尽可能恢复选择 | Phase 5 |
| closed Shadow 提示 | 检测到无法穿透的 closed Shadow Root 时给出限制说明 | Phase 3 已完成 |

### 3.3 树形结构展示

**目标**：以结构化树展示 DOM、iframe 和 Shadow 层级。

| 需求项 | 描述 | 优先级 |
|--------|------|--------|
| 树形面板 | 左侧显示元素层级树，支持展开、折叠、选择 | P0 |
| 虚拟化渲染 | 大型 DOM 使用虚拟列表，避免一次性渲染 10K 节点 | P0 |
| 节点图标 | 根据元素类型显示不同图标，如按钮、输入框、链接、表格、iframe、Shadow Root | Phase 5 |
| 节点搜索 | 支持按标签、文本、属性、role、Selector 片段搜索 | Phase 3 已完成 |
| 路径标记 | iframe 和 Shadow 节点使用特殊标记，显示穿透路径 | P0 |
| 高亮联动 | 选中树节点时目标页面高亮对应元素 | P0 |

### 3.4 属性面板

**目标**：显示选中元素的可定位属性和诊断信息。

| 需求项 | 描述 | 优先级 |
|--------|------|--------|
| 属性列表 | 显示 id、class、name、role、aria-*、data-*、href、placeholder、text 等 | P0 |
| 可访问性属性 | 显示 accessible name、role、label、description | Phase 5 |
| 布局与交互状态 | 显示 bounding box、可见性、遮挡、禁用和可点击状态 | Phase 5 |
| 属性搜索/过滤 | 支持按属性名和值过滤 | Phase 5 |
| 定位价值标记 | 标记属性是否适合用于 Selector，如唯一、稳定、疑似动态 | Phase 5 |
| 属性编辑 | 通过受控 JS 在目标页面临时修改 DOM 属性，仅用于调试 | Phase 8 |

### 3.5 Selector 编辑器

**目标**：提供类似 UiPath UI Explorer 的层级化 Selector 编辑体验，确保稳定性和唯一性。

#### 3.5.1 Selector 支持格式

| 格式 | MVP 支持 | 说明 |
|------|----------|------|
| CSS Selector | 是 | 用于网页定位和基础导出 |
| XPath | 是 | 用于兼容传统自动化场景 |
| Playwright Locator | 是 | 优先生成 role、label、text、test id 等稳定定位 |
| UiPath Selector XML | 是 | 网页端完整/部分 Selector XML；桌面映射后续接入 |
| Selenium Locator | 是 | 以 Python 代码导出形式支持 |

#### 3.5.2 “最优 Selector”定义

最优 Selector 必须同时考虑唯一性、稳定性、可读性和跨层级路径完整性。

| 维度 | 定义 | 验证方式 |
|------|------|----------|
| 唯一性 | 在当前 frame/shadow 上下文中只匹配 1 个目标元素 | 每次生成和编辑后实时执行匹配 |
| 目标一致性 | 匹配元素与用户捕获的原始元素一致 | 比较 backendNodeId、节点路径、关键属性快照 |
| 稳定性 | 优先使用语义属性，避免动态 class、随机 id、纯位置索引 | 根据评分规则给出 0-100 分 |
| 可维护性 | Selector 可读，层级不过深，可解释每层作用 | UI 中展示每层贡献和风险 |
| 穿透完整性 | iframe chain 和 open Shadow chain 明确保存和导出 | 导出代码必须包含 frame/shadow 进入逻辑 |

#### 3.5.3 稳定性评分规则

| 属性或策略 | 建议权重 | 说明 |
|------------|----------|------|
| `data-testid`、`data-test`、`data-cy` | 高 | 默认认为稳定，可配置项目级优先级 |
| `aria-label`、`role`、label 关联 | 高 | 适合 Playwright Locator 和可访问性定位 |
| 稳定 `id` | 高 | 排除明显随机、哈希、UUID、带时间戳的 id |
| `name`、`placeholder`、稳定文本 | 中 | 文本过长或多语言场景需降权 |
| 业务语义 class | 中 | 排除 CSS module、hash class、Tailwind 工具类组合 |
| 父子层级约束 | 中 | 用于消除歧义，但层级越深维护成本越高 |
| `nth-child`、索引路径 | 低 | 仅作为兜底策略，必须提示风险 |
| 绝对 XPath | 很低 | 仅在无其他可用属性时生成 |

#### 3.5.4 层级化 Selector 编辑

| 需求项 | 描述 | 优先级 |
|--------|------|--------|
| 层级列表 | 将 Selector 拆成页面、iframe、Shadow Root、祖先节点、目标节点等层级 | P0 |
| 层级启用/禁用 | 用户可手动启用或去掉某一层，实时重新生成 Selector | P0 |
| 标签启用/禁用 | 用户可启用或去掉某一层的标签名，如 `button`、`input`、`div` | P0 |
| 属性启用/禁用 | 用户可启用或去掉某一层的某个属性，如 id、class、role、text | P0 |
| 属性值编辑 | 用户可手动修改属性匹配值，实时验证匹配结果 | P0 |
| 操作风险提示 | 去掉某层或属性后若匹配多个元素，必须提示唯一性破坏 | P0 |
| 候选切换 | 支持在 CSS、XPath、Playwright Locator 等候选之间切换 | P0 |
| Selector diff | 用户修改前后显示层级和属性变化 | Phase 5 |

#### 3.5.5 Selector 失败诊断

| 诊断项 | 描述 | 优先级 |
|--------|------|--------|
| 未匹配 | 提示可能原因：页面刷新、DOM 变化、frame 未进入、shadow 不可穿透 | P0 |
| 多匹配 | 显示匹配数量和高亮所有匹配元素 | P0 |
| 不可见 | 匹配到元素但不可见时显示原因，如 `display:none`、尺寸为 0、被遮挡 | Phase 5 |
| 动态属性风险 | 标记疑似随机 id、hash class、索引路径 | P0 |
| 建议修复 | 根据本地快照和验证结果给出替代属性或更稳定候选 | Phase 5 |

### 3.6 高亮叠加层

**目标**：在目标页面中直观展示选中元素和 Selector 匹配结果。

| 需求项 | 描述 | 优先级 |
|--------|------|--------|
| 单元素高亮 | 选中元素时绘制边框和遮罩 | P0 |
| 多元素高亮 | Selector 匹配多个元素时同时高亮并编号 | P0 |
| 信息提示 | 显示标签、role、名称、Selector 评分、匹配数量 | Phase 5 |
| iframe 坐标换算 | iframe 内元素高亮时换算到页面可视坐标 | P0 |
| Shadow 元素高亮 | Shadow 内元素可正常高亮 | P0 |

### 3.7 导出能力

**目标**：将元素、Selector 和代码导出为自动化可用格式。

| 需求项 | 描述 | 优先级 |
|--------|------|--------|
| JSON 导出 | 导出元素快照、候选 Selector、frame chain、shadow chain、评分结果 | P0 |
| Playwright 导出 | 生成 TypeScript 示例代码，包含 frame/shadow 定位逻辑 | P0 |
| Selenium 导出 | 生成 Python 示例代码，包含 iframe 切换逻辑 | P0 |
| 导出预览 | 导出前预览生成内容 | P0 |
| 一键复制 | 复制当前 Selector 或代码到剪贴板 | P0 |
| UiPath Selector XML | 导出与内部层级一致的网页 `<html>` / `<webctrl>` XML 片段 | P0（Phase 9 已完成） |
| UiPath XAML 活动文件 | 不保留最小 XAML 实验项，后续如有真实集成需求再重新评估 | 不纳入当前范围 |

### 3.8 项目管理（Phase 11，规划功能）

**目标**：保存和维护自动化定位资产。

| 需求项 | 描述 | 优先级 |
|--------|------|--------|
| 项目 CRUD | 创建、打开、保存、另存为、删除项目 | Phase 11（规划功能，暂不落地） |
| `.uiproj` 文件 | 使用带 schema 版本和迁移机制的 JSON 保存项目数据 | Phase 11（规划功能，暂不落地） |
| 资产类型 | 以明确类型保存网页、桌面、表格等定位资产 | Phase 11（规划功能，暂不落地） |
| Selector 集合 | 按文件夹、页面、业务模块管理 Selector | Phase 11（规划功能，暂不落地） |
| 元素截图 | 保存元素小截图，便于后续识别 | Phase 11（规划功能，暂不落地） |
| 最近项目 | 显示最近打开项目列表 | Phase 11（规划功能，暂不落地） |
| 项目搜索 | 全局搜索 Selector、页面、属性、备注 | Phase 11（规划功能，暂不落地） |
| Selector 回归验证 | 重新连接页面后批量验证已保存 Selector 是否仍然有效 | Phase 11（规划功能，暂不落地） |

### 3.9 表格识别与提取（Phase 4 已完成基础能力，Phase 7 已完成增强）

**目标**：识别网页表格并导出结构化数据。

| 需求项 | 描述 | 优先级 |
|--------|------|--------|
| HTML 表格识别 | 识别 `<table>`、`<thead>`、`<tbody>`、`<tr>`、`<td>`、`<th>` | Phase 4 已完成 |
| 合并单元格 | 处理 `colspan`、`rowspan` | Phase 4 已完成 |
| 表头检测 | 自动检测单级和多级表头 | Phase 4 已完成 |
| 表格预览 | 使用虚拟滚动网格预览数据 | Phase 4 已完成 |
| 基础数据导出 | 导出 CSV、JSON、Markdown | Phase 4 已完成 |
| Excel 导出 | 导出 `.xlsx` 文件 | Phase 7 已完成 |
| div 表格识别 | 识别 CSS Grid/Flexbox 布局的伪表格并给出置信度 | Phase 7 已完成 |
| 选择性提取 | 支持行、列筛选和导出范围预览 | Phase 7 已完成 |

### 3.10 桌面应用识别（Phase 10，规划功能）

**目标**：通过 Windows UIAutomation API 识别桌面应用元素。

| 需求项 | 描述 | 优先级 |
|--------|------|--------|
| UIA 树获取 | 获取窗口、控件和 AutomationElement 层级 | Phase 10（规划功能，暂不落地） |
| UIA 属性展示 | 显示 AutomationId、Name、ClassName、ControlType、BoundingRectangle | Phase 10（规划功能，暂不落地） |
| 桌面元素高亮 | 使用透明置顶窗口高亮桌面控件 | Phase 10（规划功能，暂不落地） |
| 桌面 Selector 生成 | 生成基于 UIA 属性的定位描述 | Phase 10（规划功能，暂不落地） |
| 框架兼容验证 | 验证 Win32、WPF、WinUI、UWP、Electron、Qt、Java Swing/AWT | Phase 10（规划功能，暂不落地） |

### 3.11 瞬态元素与冻结捕获（Phase 5 已完成 / Phase 10 规划）

**目标**：捕获菜单、tooltip 等瞬态元素。

| 需求项 | 描述 | 优先级 |
|--------|------|--------|
| 延迟捕获 | 提供倒计时捕获和全局热键捕获，不冻结目标进程 | Phase 5 |
| 安全冻结实验 | 桌面目标模型稳定后评估 SuspendThread/ResumeThread | Phase 10（规划功能，暂不落地） |
| 自动解冻 | 超时 30 秒自动解冻目标进程 | Phase 10（规划功能，暂不落地） |
| 异常恢复 | 应用崩溃或异常退出时尝试恢复目标线程 | Phase 10（规划功能，暂不落地） |
| 权限提示 | 冻结前明确提示风险和目标进程 | Phase 10（规划功能，暂不落地） |

### 3.12 JavaScript 指令生成（Phase 8 已完成）

**目标**：当常规 Selector 难以定位时，生成可执行 JS 辅助代码。

| 需求项 | 描述 | 优先级 |
|--------|------|--------|
| DOM 查询策略 | 生成 querySelector/querySelectorAll 代码 | Phase 8 |
| 树遍历策略 | 根据文本、属性、位置遍历 DOM | Phase 8 |
| Shadow 穿透策略 | 生成 open Shadow Root 穿透代码 | Phase 8 |
| iframe 穿透策略 | 生成 iframe 进入代码 | Phase 8 |
| 代码编辑器 | 使用 Monaco 编辑生成代码 | Phase 8 |
| 一键执行 | 通过目标所属 CDP Session 的 Runtime.evaluate 受控执行代码 | Phase 8 |
| 执行安全提示 | 执行前提示代码影响和目标页面 | Phase 8 |

### 3.13 AI 辅助（Phase 12，规划功能）

**目标**：辅助解释定位失败和推荐更稳定 Selector。

| 需求项 | 描述 | 优先级 |
|--------|------|--------|
| Selector 解释 | 用自然语言解释每一层 Selector 的作用 | Phase 12（规划功能，暂不落地） |
| 失败原因总结 | 根据匹配结果和 DOM 快照总结失败原因 | Phase 12（规划功能，暂不落地） |
| 候选推荐 | 推荐更稳定的属性组合并执行本地验证 | Phase 12（规划功能，暂不落地） |
| 敏感数据保护 | 发送给 AI 前脱敏 URL、文本和属性值 | Phase 12（规划功能，暂不落地） |

---

## 4. 非功能需求

### 4.1 性能需求

| 指标 | 目标值 |
|------|--------|
| CDP 连接建立 | < 2s |
| DOM 首屏加载 | < 1s（DOM 节点 < 10K） |
| 树节点展开 | < 100ms（局部懒加载） |
| Selector 测试响应 | < 100ms（普通页面） |
| 多匹配高亮 | < 200ms（匹配元素 < 200） |
| 内存占用 | < 250MB（常规网页探索） |
| 项目文件保存 | < 500ms（Selector 数量 < 1000） |

### 4.2 兼容性需求

| 平台 | 支持范围 |
|------|----------|
| Windows | Windows 10/11 |
| 浏览器 | Chrome 90+、Edge 90+ |
| 网页结构 | DOM、iframe、open mode Shadow DOM |
| UiPath Studio | 2025.10 LTS 为网页 Selector XML 基线；2024.10 LTS 做静态兼容性抽测 |
| 桌面框架 | Win32、WPF、WinUI、UWP 优先，Electron/Qt/Java 后续验证 |

### 4.3 用户体验需求

| 需求项 | 描述 |
|--------|------|
| 三栏布局 | 左侧树、中间详情/预览、右侧 Selector 编辑器或属性面板 |
| 面板拖拽 | 面板可调整宽度并记忆布局 |
| 全局样式系统 | 使用统一 design tokens 管理颜色、字号、间距、圆角、阴影、边框、状态色和组件密度 |
| 主题系统 | 内置 light/dark，ocean/solarized 后续加入；主题切换不得修改业务组件代码 |
| UI 风格切换 | 预留不同 UI 风格包，如紧凑工具型、现代深色、企业浅色；通过全局 token 和组件变体切换 |
| 快捷键 | 捕获、搜索、复制、验证、保存支持快捷键，后续可自定义 |
| 多语言 | 中文/英文界面，MVP 可先中文，但所有用户可见文案必须通过 i18n key 管理 |
| 语言切换 | 语言切换后菜单、按钮、面板标题、提示、错误诊断、导出预览说明同步更新 |
| 诊断可见 | 每次 Selector 验证都显示匹配数量、评分、风险原因 |

### 4.4 安全需求

| 需求项 | 描述 |
|--------|------|
| CDP 连接提示 | 连接远程调试端口时提示目标地址和风险 |
| JS 执行限制 | 一键执行 JS 默认为后置能力，启用时需明确确认 |
| 项目数据本地存储 | Phase 11 作为规划功能时默认仅本地保存，不上传项目数据 |
| 敏感信息处理 | 导出和 AI 辅助前支持隐藏 token、cookie、邮箱、手机号等字段 |
| 冻结保护 | 系统级冻结功能必须有超时、恢复和权限提示 |

---

## 5. 技术架构

### 5.1 技术栈

| 层级 | 技术选型 |
|------|----------|
| 桌面框架 | Electron |
| 前端框架 | React + TypeScript |
| 构建工具 | Vite |
| 状态管理 | Zustand |
| UI 样式 | Tailwind CSS |
| 全局样式 | Design Tokens + CSS Variables + Tailwind Theme |
| 国际化 | i18n 资源文件，默认中文，预留英文 |
| 代码编辑器 | Monaco Editor |
| 浏览器协议 | Chrome DevTools Protocol |
| 桌面识别 | Windows UIAutomation API（Phase 10 规划功能） |
| Native 能力 | .NET sidecar、Rust sidecar 或 Node Native Addon（Phase 10 评估） |

### 5.2 核心模块

```
ui-explorer/
├── electron/
│   ├── main.ts                 # Electron 主进程入口
│   ├── preload.ts              # 安全暴露 IPC API
│   ├── cdp/                    # CDP 连接、页面管理、DOM/Runtime 调用
│   ├── project/                # Phase 11 项目文件读写（规划）
│   └── native/                 # Phase 10 UIAutomation 与冻结实验（规划）
├── src/
│   ├── app/                    # 应用布局、路由、全局初始化
│   ├── styles/                 # 全局样式、主题 token、CSS variables
│   ├── i18n/                   # 多语言资源、语言切换、文案 key
│   ├── components/
│   │   ├── tree/               # 元素树
│   │   ├── properties/         # 属性面板
│   │   ├── selector/           # Selector 编辑器
│   │   └── overlay/            # 高亮状态展示
│   ├── stores/                 # Zustand store
│   ├── services/
│   │   ├── selector/           # Selector 生成、评分、验证
│   │   ├── export/             # 通用导出与 Phase 9 UiPath 导出
│   │   └── diagnostics/        # 失败诊断
│   ├── types/                  # 统一数据模型
│   └── utils/
├── test-fixtures/              # iframe、shadow、动态 DOM、表格测试页
└── package.json
```

### 5.3 全局样式与国际化架构

#### 5.3.1 样式分层

| 层级 | 职责 |
|------|------|
| Design Tokens | 定义颜色、字体、字号、间距、圆角、边框、阴影、动效、z-index、状态色 |
| CSS Variables | 将 token 暴露为运行时可切换变量，如 `--color-bg`、`--space-2` |
| Tailwind Theme | 绑定 CSS Variables，业务组件只使用语义类名和 token |
| Component Variants | 为按钮、输入框、面板、树节点、标签、提示等组件定义统一尺寸和状态 |
| Theme Presets | 管理 light、dark、ocean、solarized 以及后续企业定制风格 |

#### 5.3.2 样式约束

1. 业务组件不得硬编码颜色、字号、阴影和间距，必须使用 token 或组件变体。
2. 主题切换必须运行时生效，不需要重新构建应用。
3. 组件状态色必须覆盖 hover、active、focus、disabled、selected、warning、error、success。
4. 树、属性表、Selector 层级编辑器等高密度界面必须支持普通密度和紧凑密度。
5. 新增 UI 风格时优先新增 theme preset，不直接改业务组件样式。

#### 5.3.3 国际化约束

1. 所有用户可见文案必须通过 i18n key 获取，包括菜单、按钮、面板标题、表格列名、错误提示、诊断原因、空状态、导出说明。
2. 文案 key 使用模块化命名，如 `selector.validation.unique`、`tree.search.placeholder`。
3. i18n 资源默认包含 `zh-CN`，预留 `en-US`。
4. 数字、日期、快捷键提示和复数形式必须通过格式化函数处理。
5. 日志、内部错误码和导出代码中的技术标识不翻译，但面向用户的解释文本必须翻译。

### 5.4 关键数据模型

#### 5.4.1 ElementSnapshot

```ts
type ElementSnapshot = {
  id: string;
  backendNodeId?: number;
  tagName: string;
  text: string;
  attributes: Record<string, string>;
  accessibility: {
    role?: string;
    name?: string;
    description?: string;
  };
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  framePath: FramePathSegment[];
  shadowPath: ShadowPathSegment[];
  selectorCandidates: SelectorCandidate[];
};
```

#### 5.4.2 SelectorCandidate

```ts
type SelectorCandidate = {
  id: string;
  format: "css" | "xpath" | "playwright" | "uipath";
  value: string;
  layers: SelectorLayer[];
  score: {
    uniqueness: number;
    stability: number;
    readability: number;
    overall: number;
  };
  validation: {
    matchCount: number;
    matchesOriginal: boolean;
    visibleMatchCount: number;
    warnings: string[];
  };
};
```

#### 5.4.3 SelectorLayer

```ts
type SelectorLayer = {
  id: string;
  kind: "page" | "frame" | "shadow-root" | "ancestor" | "target";
  enabled: boolean;
  tag: {
    value: string;
    enabled: boolean;
  };
  attributes: Array<{
    name: string;
    value: string;
    enabled: boolean;
    stability: "high" | "medium" | "low";
    warning?: string;
  }>;
};
```

---

## 6. 分阶段实施计划与验收标准

以下周期为相对项目周，用于表达工作量和依赖顺序，不代表固定发布日期。阶段状态以仓库中已实现并验证的范围为准。

### Phase 0：项目脚手架与测试样例（第 1 周，已完成）

**目标**：建立可运行的 Electron + React 基础工程和后续验收需要的测试页面。

| 任务 | 描述 |
|------|------|
| 0.1 | 初始化 Electron + React + TypeScript + Vite |
| 0.2 | 配置 Tailwind、Zustand、Monaco Editor 基础依赖 |
| 0.3 | 建立主进程、预加载脚本、渲染进程 IPC 通信 |
| 0.4 | 创建三栏基础布局，支持面板拖拽 |
| 0.5 | 建立全局样式系统：design tokens、CSS variables、Tailwind theme、组件基础变体 |
| 0.6 | 建立 i18n 资源结构：`zh-CN` 默认文案、`en-US` 占位文案、语言切换 API |
| 0.7 | 创建测试页面集合：普通 DOM、iframe、open Shadow DOM、动态列表、表格 |

**阶段验收标准**：

1. 应用可在 Windows 10/11 启动。
2. 三栏布局显示正常，面板可拖拽并记忆宽度。
3. 全局主题 token 生效，至少支持 light/dark 两套主题运行时切换。
4. 所有导航、按钮、面板标题、空状态等基础文案通过 i18n key 渲染。
5. 切换语言后，基础布局中的用户可见文案同步变化。
6. 测试页面可本地打开，包含 iframe、Shadow DOM、动态 DOM、表格场景。
7. 基础 IPC 调用可从渲染进程请求主进程并返回结果。

### Phase 1：网页连接与元素捕获 MVP（第 2–3 周，已完成）

**目标**：连接 Chrome/Edge，通过 CDP 捕获网页元素并展示基础树和属性。

| 任务 | 描述 |
|------|------|
| 1.1 | 实现 CDP endpoint 输入、连接、断开和手动重连 |
| 1.2 | 实现页面 target 列表和当前页面选择 |
| 1.3 | 获取 DOM 树并映射为内部 ElementSnapshot |
| 1.4 | 实现元素树虚拟化展示和节点选择 |
| 1.5 | 实现属性面板，展示 DOM 属性、文本、role、可见性和 bounding box |
| 1.6 | 实现目标页面单元素高亮 |

**阶段验收标准**：

1. 能连接已开启远程调试的 Chrome/Edge 页面。
2. 能展示页面 DOM 树，10K 节点以内首屏加载 < 1s。
3. 点击树节点后，属性面板展示对应元素信息。
4. 点击树节点后，目标页面对应元素高亮。
5. 连接失败或手动断开后，应用能显示状态并允许重新连接。
6. 本阶段新增的所有用户可见文案不得硬编码在组件中，必须进入 i18n 资源。
7. 本阶段新增 UI 不得硬编码颜色、字号和间距，必须使用全局 token 或组件变体。

### Phase 2：Selector 核心能力 MVP（第 4–6 周，已完成）

**目标**：完成稳定唯一 Selector 生成、层级化编辑、实时验证和导出闭环。

| 任务 | 描述 |
|------|------|
| 2.1 | 生成 CSS、XPath、Playwright Locator 候选 |
| 2.2 | 建立 Selector 稳定性评分规则 |
| 2.3 | 实现 Selector 实时验证：匹配数量、唯一性、可见性、目标一致性 |
| 2.4 | 实现层级化 Selector 编辑器 |
| 2.5 | 支持启用/禁用某一层、某层标签、某层属性 |
| 2.6 | 支持属性值手动编辑和实时重新验证 |
| 2.7 | 实现多匹配高亮和失败诊断 |
| 2.8 | 导出 JSON、Playwright TypeScript、Selenium Python |

**阶段验收标准**：

1. 选中任意普通 DOM 元素后，至少生成 CSS、XPath、Playwright 三类候选。
2. 每个候选显示唯一性、稳定性、可读性和综合评分。
3. 当 Selector 匹配 0 个、1 个、多个元素时，UI 明确显示不同状态。
4. 用户去掉某一层、某个标签或某个属性后，Selector 自动重算并实时验证。
5. 若修改导致匹配多个元素，页面同时高亮所有匹配项并显示数量。
6. Playwright 和 Selenium 导出代码可在测试页面上定位到同一元素。

### Phase 3：iframe 与 Shadow DOM 穿透（第 7–8 周，已完成）

**目标**：让 MVP 能覆盖复杂网页结构，接近 UiPath UI Explorer 的层级探索体验。

| 任务 | 描述 |
|------|------|
| 3.1 | 识别 iframe/frame 层级并保存 frame chain |
| 3.2 | 支持 iframe 内 DOM 树展开和元素捕获 |
| 3.3 | 识别 open mode Shadow Root 并保存 shadow chain |
| 3.4 | 支持 Shadow DOM 内元素树展示、捕获、高亮 |
| 3.5 | Selector 层级编辑器展示 page/frame/shadow/ancestor/target 层 |
| 3.6 | 导出代码包含 iframe 和 Shadow 进入逻辑 |
| 3.7 | 对 closed Shadow Root 显示不可穿透诊断 |

**阶段验收标准**：

1. 能在测试 iframe 内捕获元素，并显示完整 frame path。
2. 能在 open Shadow DOM 内捕获元素，并显示完整 shadow path。
3. iframe 和 Shadow 节点在树中有明确图标和层级标记。
4. Selector 编辑器可手动启用或禁用 frame、shadow、ancestor、target 层。
5. 导出的 Playwright 代码能定位 iframe 和 open Shadow DOM 内元素。
6. closed Shadow Root 场景不会误报成功，必须给出限制说明。

### Phase 4：标准 HTML 表格识别与导出（第 9–10 周，已完成）

**目标**：识别标准 HTML 表格，将合并单元格和多级表头规范化为可预览、可导出的结构化数据。

| 任务 | 描述 |
|------|------|
| 4.1 | 识别标准 `<table>`、表格区段、行和单元格 |
| 4.2 | 展开 `rowspan`、`colspan` 并规范化多级表头 |
| 4.3 | 使用虚拟化网格预览提取结果 |
| 4.4 | 导出 CSV、JSON、Markdown，并支持复制和原生文件保存 |

**阶段验收标准**：

1. 选中表格或其内部节点时，能识别最近的所属表格。
2. `rowspan`、`colspan` 和多级表头能转换为稳定矩形数据。
3. 内置表格测试页生成 5 列规范化数据，合并值按逻辑单元格展开。
4. CSV、JSON、Markdown 与预览使用同一数据模型且内容一致。
5. Excel、伪表格和选择性提取不计入本阶段完成范围。

### Phase 5：网页可靠性、动态页面与安全瞬态捕获（第 11–13 周，已完成）

**目标**：在不冻结目标进程的前提下，提高动态网页、短暂 UI 和定位失败场景的捕获与诊断可靠性。

| 任务 | 描述 |
|------|------|
| 5.1 | 自动发现本机调试端点，监控目标关闭、跳转和刷新，并提供状态提示与重连 |
| 5.2 | 刷新动态 DOM，并在目标仍可识别时恢复原选择 |
| 5.3 | 完善 accessible name、description、disabled、clickable、遮挡和不可见原因 |
| 5.4 | 实现属性过滤、定位价值标记和语义化节点图标 |
| 5.5 | 展示 Selector 修改 diff、失败原因、信息提示和确定性修复建议 |
| 5.6 | 实现延迟捕获、倒计时和全局热键 |

**阶段验收标准**：

1. 页面刷新、跳转或目标关闭时，应用显示准确状态并可恢复连接。
2. 动态 DOM 刷新后，仍存在的目标尽可能恢复选择；无法恢复时给出原因。
3. 属性面板能区分隐藏、遮挡、禁用和不可点击等状态。
4. Selector 修改前后差异、失败原因和本地修复建议可追溯。
5. 延迟捕获和热键能稳定捕获测试页面中的菜单、tooltip 和弹层。
6. 本阶段不得调用 SuspendThread/ResumeThread 或冻结目标进程。

### Phase 6：跨域 iframe/OOPIF 多 CDP Session（第 14–17 周，已完成）

**目标**：建立统一的多 Session 网页上下文模型，完整支持跨域 iframe/OOPIF。

| 任务 | 描述 |
|------|------|
| 6.1 | 使用 `Target.setAutoAttach` 管理多 CDP Session 生命周期 |
| 6.2 | 建立 frame、target、session 映射并处理导航与脱离 |
| 6.3 | 将跨域子 frame 纳入 DOM 树、捕获和选择 |
| 6.4 | 实现跨 Session 高亮和坐标换算 |
| 6.5 | 在统一上下文中验证 Selector 并高亮多匹配结果 |
| 6.6 | 扩展 JSON、Playwright、Selenium 导出 |
| 6.7 | 展示无法附加、导航失效和 Session 脱离诊断 |

**阶段验收标准**：

1. 能遍历测试跨域 iframe/OOPIF，并保留完整 frame 与 Session 路径。
2. 跨域子 frame 内元素可捕获、选择、高亮和验证。
3. 页面导航或子 Session 脱离后，不得复用陈旧上下文。
4. 导出代码能进入正确 frame 并定位同一目标。
5. 无法附加的子 frame 必须显示限制诊断，不得误报成功。

### Phase 7：高级表格与结构化数据提取（第 18–20 周，已完成）

**目标**：在标准 HTML 表格基础上支持选择性提取、Excel 和带置信度的伪表格识别。

| 任务 | 描述 |
|------|------|
| 7.1 | 支持行列选择和导出范围预览 |
| 7.2 | 导出 Excel `.xlsx` 文件 |
| 7.3 | 启发式识别 CSS Grid/Flex 伪表格 |
| 7.4 | 展示识别置信度、证据和误判诊断 |
| 7.5 | 在 iframe、Shadow、OOPIF 中一致提取表格 |
| 7.6 | 验证大表格预览和导出的性能 |

**阶段验收标准**：

1. 用户可选择行列，并在导出前确认实际范围。
2. `.xlsx`、CSV、JSON、Markdown 的行列顺序与预览一致。
3. 高置信度 Grid/Flex 测试样例可识别为表格。
4. 普通 Grid/Flex 布局不得被静默误报；低置信度结果必须提示。
5. 同一表格在页面、iframe、Shadow 和 OOPIF 中使用一致的数据模型。

### Phase 8：JS 指令生成、受控执行与高级诊断（第 21–22 周，已完成）

**目标**：基于统一网页上下文，为常规 Selector 难以处理的页面提供可审查、可控的兜底能力。

| 任务 | 描述 |
|------|------|
| 8.1 | 生成 DOM 查询、树遍历、iframe 和 Shadow 穿透代码 |
| 8.2 | 使用 Monaco 编辑和预览生成代码 |
| 8.3 | 在目标所属 CDP Session 中受控执行 |
| 8.4 | 执行前展示目标、代码和风险，并要求明确触发 |
| 8.5 | 展示返回值、异常和超时 |
| 8.6 | 基于本地 DOM、上下文和验证结果给出确定性修复建议 |

**阶段验收标准**：

1. JS 生成结果能在普通 DOM、iframe、Shadow 和 OOPIF 测试页面定位目标。
2. 代码只在目标所属 Session 中执行，不得错误作用于其他页面。
3. 执行前必须展示完整代码、目标和风险，默认不自动运行。
4. 超时、异常和不可序列化返回值均有明确结果。
5. 本阶段不调用 AI，也不上传页面数据。

### Phase 9：UiPath 兼容增强（第 23–25 周，已完成）

**目标**：在网页 Selector 模型稳定后，提供网页端 UiPath Selector XML 互操作能力；兼容基线采用 UiPath Studio 2025.10 LTS，2024.10 LTS 作为兼容性抽测版本，2023.4 仅作为历史参考，不作为基线。桌面 UIA 映射等待 Phase 10 规划功能成熟后再接入。

| 任务 | 描述 |
|------|------|
| 9.1 | 定义内部 Selector 到 UiPath Selector XML 的映射 |
| 9.2 | 以 UiPath Studio 2025.10 LTS 为基线导出网页 UiPath Selector XML |
| 9.3 | 提供 UiPath 风格层级编辑视图 |
| 9.4 | 保持 XML 与内部层级启停一致 |
| 9.5 | 使用 2024.10 LTS 做兼容性抽测，记录与 2025.10 LTS 的差异 |
| 9.6 | 记录桌面 UIA Selector 映射依赖，等待 Phase 10 后续评估 |

**阶段验收标准**：

1. 网页元素能生成与内部层级一致的 UiPath Selector XML。
2. 用户在 UiPath 风格视图中的层级和属性启停会同步更新内部模型。
3. 生成的 XML 以 UiPath Studio 2025.10 LTS 作为兼容基线，并记录 2024.10 LTS 抽测结果。
4. 本阶段只做网页端 UiPath Selector XML，不保留最小 XAML 实验项。
5. 桌面 Selector 不作为本阶段验收范围，只记录后续映射依赖。

**实现与兼容性记录**：

- 页面层映射为 `<html>`，从当前 CDP 浏览器版本映射 `chrome.exe` / `msedge.exe`，并带入当前 target 的 `title` 和 `url`；frame、open Shadow、普通祖先和目标层按内部顺序映射为 `<webctrl>`。
- `tag`、`id`、`name`、`class`、`aria-label`、`href` 等 UiPath 原生 WEBCTRL 属性直接输出；内部 `text` 映射为 `innertext`；`data-testid`、`type`、`placeholder` 等非原生属性合并到 `css-selector`，所有 XML 属性值统一转义。
- UiPath 风格层级视图直接读取当前 `SelectorLayer[]`。层级、标签、属性启停和属性值编辑仍通过同一 `applySelectorEdit` 数据流，因此 XML 预览、JSON、Playwright、Selenium 和验证结果同步更新，不保存第二份 UiPath 编辑状态。
- 不可访问的 frame、closed Shadow、脱离或失效上下文只输出 XML 注释诊断，不伪造可运行的 UiPath Selector。
- 2025.10 LTS 基线和 2024.10 LTS 抽测均使用官方 Selector XML 节点/属性定义与官方 `<webctrl>` 示例做静态兼容性验证；两版在本阶段使用的传统网页 Selector XML 结构上未发现差异。自动化回归覆盖完整/部分 Selector、Chrome/Edge、frame/open Shadow 顺序、启停同步、属性回退与 XML 转义。
- 桌面 UIA 后续依赖：先在 Phase 10 确定 sidecar/Native Addon 技术路线，再补充窗口/进程根节点、UIA `automationid`/`name`/`role`/`cls` 等属性、RuntimeId 身份、桌面坐标与进程位数边界；在这些模型稳定前不扩展本阶段的网页 XML schema，也不输出 XAML。

### Phase 10：桌面 UIAutomation 探索版与冻结实验（规划功能，暂不落地）

**目标**：规划 Windows 桌面元素探索能力，并在桌面目标模型稳定后评估安全冻结；当前项目阶段不做落地实现。

| 规划项 | 描述 |
|------|------|
| 10.1 | 评估并确定 .NET sidecar、Rust sidecar 或 Node Native Addon |
| 10.2 | 定义通用目标、快照、属性和 Selector 适配接口 |
| 10.3 | 规划窗口选择、UIA 树和 AutomationElement 属性展示 |
| 10.4 | 规划桌面控件高亮 overlay |
| 10.5 | 规划 UIA 定位描述生成 |
| 10.6 | 规划 Win32、WPF、WinUI/UWP、Electron、Qt、Java 验证矩阵 |
| 10.7 | 桌面模型稳定后再评估进程冻结、30 秒自动解冻和异常恢复 |

**规划验收标准**：

1. 形成桌面 UIA 技术方案、进程边界、安全风险和验证矩阵。
2. 明确首批支持与不支持的桌面框架范围。
3. 明确冻结实验的风险、权限、恢复机制和默认关闭策略。
4. 本阶段只作为后续规划，不进入当前网页端落地范围。

### Phase 11：项目管理与 Selector 回归验证（规划功能，暂不落地）

**目标**：在资产模型稳定后规划保存、组织和批量验证网页、桌面与表格定位资产；当前不做落地实现。

| 规划项 | 描述 |
|------|------|
| 11.1 | 定义带 schema 版本和迁移机制的 `.uiproj` JSON 格式 |
| 11.2 | 实现项目创建、打开、保存、另存为和删除 |
| 11.3 | 以明确类型保存网页、桌面和表格定位资产 |
| 11.4 | 实现 Selector 分组、命名、备注和搜索 |
| 11.5 | 保存元素快照和截图，并显示最近项目 |
| 11.6 | 批量回归验证已保存 Selector 并展示失败原因 |
| 11.7 | 对当前环境无法验证的资产显示“未运行” |

**规划验收标准**：

1. 项目保存后重新打开，资产类型、Selector、评分、快照、截图和分组不丢失。
2. schema 升级有确定的版本识别和迁移路径。
3. 重新连接目标后可批量验证已保存 Selector。
4. DOM、上下文或桌面属性变化导致失效时，能标记失败并显示原因。
5. 当前平台或连接环境无法验证的资产显示“未运行”，不得误报通过或失败。
6. 项目默认仅保存在本地，不包含账户、云同步或协作逻辑。

### Phase 12：AI 辅助（规划功能，暂不落地）

**目标**：规划基于稳定本地诊断结果的脱敏、可验证解释和候选建议；当前不做落地实现。

| 规划项 | 描述 |
|------|------|
| 12.1 | 用自然语言解释 Selector 层级 |
| 12.2 | 总结本地验证得到的失败原因 |
| 12.3 | 推荐更稳定的 Selector 候选 |
| 12.4 | 脱敏 URL、文本、属性和凭据 |
| 12.5 | 对外部模型接入提供显式选择和数据预览 |
| 12.6 | 对 AI 推荐执行本地 Selector 验证 |

**规划验收标准**：

1. 未经用户明确选择，不向外部模型发送页面数据。
2. 发送前展示脱敏后的实际内容。
3. AI 推荐必须经过本地验证并展示匹配数量和目标一致性。
4. AI 不直接执行代码，也不直接修改项目资产。

### Phase 13：企业协作与扩展生态（规划功能，暂不落地）

**目标**：在本地项目模型稳定且有明确用户需求后，规划团队级能力；当前不做落地实现。

| 规划项 | 描述 |
|------|------|
| 13.1 | 云同步和项目版本历史 |
| 13.2 | 团队共享、评论和变更记录 |
| 13.3 | 项目级和团队级权限 |
| 13.4 | Selector 变更、导出和执行审计日志 |
| 13.5 | 带沙箱和 API 版本管理的插件系统 |
| 13.6 | 同步冲突解决和项目 schema 升级策略 |

**阶段验收标准**：

1. 企业能力必须基于明确用户需求启动，不进入 MVP。
2. 云同步和协作必须有账户、权限、审计和冲突解决设计。
3. 插件系统必须有沙箱、最小权限和 API 版本管理。
4. 云端项目升级不得破坏 Phase 11 的本地项目兼容性。

---

## 7. 里程碑总览

| 阶段 | 状态 | 里程碑 | 预计时间 | 主要价值 |
|------|------|--------|----------|----------|
| Phase 0 | 已完成 | 基础工程和测试样例 | 第 1 周 | 可运行、可验证 |
| Phase 1 | 已完成 | 网页元素捕获 MVP | 第 3 周末 | 能连接页面、看树、看属性、高亮 |
| Phase 2 | 已完成 | Selector 核心 MVP | 第 6 周末 | 能生成、编辑、验证、导出稳定 Selector |
| Phase 3 | 已完成 | iframe/Shadow 穿透 | 第 8 周末 | 覆盖同源复杂网页结构 |
| Phase 4 | 已完成 | 标准 HTML 表格识别与导出 | 第 10 周末 | 提取标准表格并导出结构化数据 |
| Phase 5 | 已完成 | 网页可靠性与安全瞬态捕获 | 第 13 周末 | 稳定处理动态页面和短暂 UI |
| Phase 6 | 已完成 | 跨域 iframe/OOPIF | 第 17 周末 | 建立统一多 Session 网页上下文 |
| Phase 7 | 已完成 | 高级表格与结构化提取 | 第 20 周末 | 支持选择性提取、Excel 和伪表格 |
| Phase 8 | 已完成 | JS 受控执行与高级诊断 | 第 22 周末 | 为复杂网页提供可审查兜底能力 |
| Phase 9 | 已完成 | UiPath 兼容增强 | 第 25 周末 | 基于 UiPath Studio 2025.10 LTS 输出网页端 Selector XML |
| Phase 10 | 规划中，暂不落地 | 桌面 UIAutomation 探索版 | 后续规划 | 初步支持 Windows 桌面应用 |
| Phase 11 | 规划中，暂不落地 | 项目管理与回归验证 | 后续规划 | 保存、组织和批量验证定位资产 |
| Phase 12 | 规划中，暂不落地 | AI 辅助 | 后续规划 | 提供脱敏且经本地验证的智能建议 |
| Phase 13 | 规划中，暂不落地 | 企业协作与扩展生态 | 后续规划 | 团队化、治理和商业化 |

---

## 8. 测试与验收资产

### 8.1 内置测试页面

| 页面 | 覆盖场景 |
|------|----------|
| `basic-dom.html` | 常见按钮、输入框、链接、文本、动态 class |
| `iframe.html` | 单层 iframe、多层 iframe、跨 frame 坐标高亮 |
| `shadow-dom.html` | open Shadow Root、嵌套 Shadow Root、closed Shadow Root 限制提示 |
| `dynamic-list.html` | 动态列表、索引变化、随机 id、hash class |
| `table.html` | 标准表格、合并单元格、多级表头 |
| `popup.html` | 菜单、tooltip、弹层、延迟捕获 |

### 8.2 Selector 回归用例

| 用例 | 期望 |
|------|------|
| 稳定 `data-testid` 元素 | 生成高分 Playwright Locator |
| 随机 id 元素 | id 降权并提示动态风险 |
| 多个同名按钮 | 显示多匹配并建议增加层级或文本约束 |
| iframe 内按钮 | 导出代码包含 frame 定位 |
| Shadow 内输入框 | 导出代码包含 Shadow 穿透逻辑 |
| 绝对 XPath | 仅作为低分兜底候选 |
| UiPath 完整网页 Selector | 按页面、frame、Shadow、祖先和目标顺序输出 `<html>` / `<webctrl>` |
| UiPath 层级或属性启停 | XML、内部模型和验证结果同步更新 |
| UiPath 非原生网页属性 | 合并到合法转义的 `css-selector` 属性 |
| UiPath 不可访问上下文 | 只输出非运行型 XML 注释诊断 |

---

## 9. 待确认需求

1. Phase 10 是否继续只支持 Windows，还是在通用适配接口中提前约束 macOS/Linux 扩展边界？
2. Phase 10 未来采用 .NET sidecar、Rust sidecar 还是 Node Native Addon，首批扩展样例是否包含 Electron、Qt 和 Java？
3. Phase 11 需要支持迁移哪些早期 `.uiproj` schema，元素截图采用内嵌还是外部文件？
4. Phase 12 是否允许接入外部模型，还是必须使用本地或私有化模型？
5. Phase 5–6 是否需要浏览器扩展简化 CDP 连接，还是继续使用远程调试端口？
6. Phase 13 的云同步是否有明确部署区域、合规和数据驻留要求？

---

## 10. 参考资料

- [UiPath UI Explorer](https://docs.uipath.com/studio/docs/ui-explorer)
- [Playwright Locators](https://playwright.dev/docs/locators)
- [Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/)
- [Selenium WebDriver](https://www.selenium.dev/documentation/webdriver/)
