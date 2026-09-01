## Context

动机见 `proposal.md`。当前 `App.jsx` 同时承担认证启动、HC/岗位加载、会话选择、SSE 生命周期、产物动作和大部分页面渲染；同文件还包含岗位说明、人才画像、评估方案和证据抽屉等组件。`styles.css` 由多个阶段追加形成，同一响应式断点和主题存在多段覆盖，因此拆分时必须保持源码顺序和 CSS 级联结果。

现有前端使用 React 18、Vite 和 Node test runner，API 请求统一经过 `api/client.js`。本次不引入新的运行时依赖，不移动权限判断到浏览器，也不改变服务端返回结构。

## Goals / Non-Goals

**Goals:**

- 让应用编排、SSE 副作用、工作台框架、对话和画像产物各自拥有清晰文件边界。
- 保持经理、HR、管理员三个视角，以及岗位说明确认后推导人才画像的 V2 产物链路不变。
- 保持所有现有 class name、关键 DOM 语义、CSS 级联顺序和响应式表现。
- 使用现有 Node test runner 与 React 服务端渲染能力补充轻量回归保护，不新增测试框架。

**Non-Goals:**

- 不以行数指标驱动机械拆分，不创建只有一次调用的包装组件或通用状态框架。
- 不修改 API client、共享契约、权限来源、产物规范化算法或后端逻辑。
- 不重命名大批 CSS class，不重做视觉设计，不顺带清理未被本次边界触及的历史样式。

## Decisions

### 1. 按业务责任拆组件，保留一个轻量应用编排入口

`App.jsx` 只保留顶层认证/入口分支、当前岗位选择和各区域组合。现有内联实现按实际职责移动到以下边界：

- `components/workbench/WorkbenchShell.jsx`：侧栏、页头、标签导航、错误提示和证据抽屉挂载点。
- `components/workbench/EmptyWorkspace.jsx`：未选择岗位或新建会话状态。
- `components/workbench/ConversationView.jsx`：当前与兼容对话视图。
- `components/profile/ProfileView.jsx`：岗位画像主视图、产物空状态和视角切换。
- `components/profile/RoleProfileDocument.jsx`：岗位说明、人才画像、招聘画像及证据展示。
- `components/profile/AssessmentDocument.jsx`：评估方案及评分卡展示。
- `components/profile/EvidenceDrawer.jsx`：证据详情。
- `workbench/presentation.js`：阶段、角色、招聘类型和岗位卡片等纯映射。

组件只在存在独立责任或复用价值时拆分；小型展示函数留在其唯一父组件附近。替代方案是按每个 JSX 函数建文件，但会产生过多跳转和薄包装，因此不采用。

### 2. 只抽取 SSE 生命周期 hook，其余状态继续由 App 编排

新增 `hooks/useAgentRun.js`，负责当前 EventSource 的连接/关闭、事件列表和运行状态，并通过明确回调通知“刷新岗位”“刷新消息”和“报告错误”。登录退出、切换岗位和组件卸载时统一关闭连接。

HC、岗位详情、消息和视图状态仍保留在 `App.jsx`，以避免多个相互依赖 hook 之间出现隐式同步和陈旧闭包。待本次拆分后若仍有独立复杂度，再以新的 OpenSpec change 评估；本次不预建 reducer 或全局 store。

### 3. 纯展示逻辑与副作用分离

`toRoleCard`、角色标签、阶段展示和岗位基本信息等无副作用转换移动到纯模块，并用输入输出测试覆盖。API 调用仍集中在顶层处理函数；子组件通过窄 props 接收数据和动作，不直接复制请求逻辑。

这样可以测试最易回归的权限视图与产物阶段映射，同时避免为测试而暴露内部状态。替代方案是把 API 请求分散到各页面组件，虽然单文件更短，但会让刷新、错误和 SSE 协调更难追踪，因此不采用。

### 4. CSS 按现有演进段落拆分，逐字保持原始级联

将 `main.jsx` 的样式入口改为 `styles/index.css`。为避免语义重组改变同权重选择器和媒体查询的先后关系，第一期以 `styles.css` 当前注释边界为切点，并按原始顺序导入：

1. `base-workbench.css`：当前文件开头至 Approved HC 段落之前的基础工作台。
2. `hc-landing.css`：Approved HC selector 段落。
3. `role-aware-workbench.css`：Role-aware workbench state 段落。
4. `artifact-chain.css`：Role permissions and output decision chain 段落。
5. `recruiting-work-card.css`：Actionable recruiting work card 段落。
6. `recruiting-portrait.css`：Recruitment portrait 段落。
7. `role-profile-v2.css`：V2 岗位说明与人才画像段落。

每个文件内部保留原来的响应式规则位置，`index.css` 导入顺序与旧文件文本顺序一致。第一轮只按连续行移动，不改选择器、声明或重复规则；视觉基线核对完成后，也只删除能证明无调用且不参与级联的规则。替代方案是立即按语义汇总所有 profile 或 media 规则，但这会改变源码顺序，因此不采用。

### 5. 回归验证聚焦真实边界

- 纯映射测试覆盖角色阶段、岗位卡片与 V2 岗位说明/人才画像阶段展示。
- 使用 `react-dom/server` 对无浏览器副作用的提取组件做经理、HR、管理员静态渲染断言，不增加测试依赖。
- 运行现有前端 test、Vite build 和仓库 typecheck。
- 本地 Smoke Test 覆盖登录、HC 选择、对话、岗位说明、人才画像、管理员 Trace，以及 1180px 以下布局。

快照不用于锁定整页 HTML，避免把无意义的标记变化变成维护负担；测试断言只覆盖权限可见性、关键标题、动作和阶段。

## Risks / Trade-offs

- [CSS 移动改变级联顺序，导致页面看似“版本回退”] → 只按连续源码段落切文件，保持文件内文本和 `index.css` 导入顺序，再对关键页面和窄屏做视觉对比。
- [拆出 SSE hook 后出现陈旧岗位 ID 或连接未关闭] → 继续使用当前岗位 ref；切换岗位、退出和卸载都执行同一 stop 函数，并为完成、失败和重连事件写针对性测试。
- [组件 props 过多，边界反而更难理解] → 工作台框架接收少量分区对象与动作；只把稳定、聚合的视图数据向下传递，不引入 Context 来掩盖依赖。
- [纯重构误删兼容视图或旧产物展示] → 保留 `LegacyConversationView` 和旧 schema 分支，搜索所有调用方后再决定是否删除；没有证明则保留。
- [文件减少行数但复杂度只是转移] → Review 以单一职责、重复逻辑和数据流可追踪性为准，不以文件数量或行数作为唯一完成标准。

## Migration Plan

1. 记录当前前端测试、构建和三个角色关键页面基线。
2. 先移动纯展示映射和画像/对话组件，每步保持可构建。
3. 抽取 SSE hook，验证切换岗位、完成、失败、重连和退出清理。
4. 按连续源码段落原样拆分 CSS，核对桌面与 1180px 以下布局；本次不跨段重排媒体查询或同名选择器。
5. 完成全量前端测试、仓库 typecheck/build 和关键业务 Smoke Test。
6. 推送单一已验证 commit，仅部署 Railway `web`，确认 deployment commit 与 GitHub 一致。

回滚时不涉及数据库或 API；将 `web` 重新部署到实施前 commit 即可。若线上仅出现样式差异，仍整体回滚该前端 commit，不在线上拼接不同源码快照。
