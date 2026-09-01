## 1. 基线与回归保护

- [ ] 1.1 拉取并确认远程最新 commit，运行 `corepack pnpm --filter @role-clarifier/web test` 和 `corepack pnpm --filter @role-clarifier/web build`，记录实施前基线与任何既有失败。
- [ ] 1.2 为阶段映射、岗位卡片和 V2 岗位说明/人才画像状态补充纯函数测试，并验证新增测试在现有实现上通过。
- [ ] 1.3 使用 `react-dom/server` 为经理、HR、管理员关键视图增加聚焦渲染断言，并验证岗位说明、人才画像动作和 Trace 可见性保持现状。

## 2. 拆分组件与展示逻辑

- [ ] 2.1 将阶段、角色、招聘类型、岗位卡片和岗位基本信息映射移入 `workbench/presentation.js`，运行对应单元测试并确认所有调用方使用唯一实现。
- [ ] 2.2 提取 `EmptyWorkspace`、`ConversationView` 和兼容对话视图到 `components/workbench/`，运行前端测试与构建验证 props、文案和交互入口不变。
- [ ] 2.3 提取 `ProfileView`、岗位说明/人才画像文档、评估方案和证据抽屉到 `components/profile/`，运行三角色渲染测试并验证 V2 阶段动作不变。
- [ ] 2.4 提取 `WorkbenchShell` 并将 `App.jsx` 收敛为认证、岗位数据和区域组合入口，运行前端测试与构建确认导航和权限分支不变。

## 3. 隔离 Agent Run 副作用

- [ ] 3.1 新增 `hooks/useAgentRun.js`，集中连接、重连、完成、失败和关闭逻辑，并通过针对性测试或可控 EventSource 桩验证事件与清理行为。
- [ ] 3.2 将 `App.jsx` 接入新 hook，手动验证切换岗位、退出登录、Run 完成与失败时不会保留旧连接或刷新错误岗位。

## 4. 拆分样式并保持视觉结果

- [ ] 4.1 创建固定顺序的 `styles/index.css`，按现有注释边界将连续源码段落原样移动到七个样式文件，并用拼接对比或等价 diff 验证声明和先后顺序未改变。
- [ ] 4.2 更新 `main.jsx` 样式入口，运行前端构建并在桌面宽度核对登录、HC、对话、岗位说明、人才画像和 Trace 页面。
- [ ] 4.3 在 1180px 以下核对侧栏、对话和画像布局；不跨段重排媒体查询或同名选择器，只删除经搜索与渲染确认完全无效的规则，并再次运行前端测试与构建。

## 5. Review、提交与部署

- [ ] 5.1 基于完整 diff Review 组件边界、重复逻辑、权限、SSE 生命周期和 CSS 级联，执行 `git diff --check`、`corepack pnpm typecheck`、`corepack pnpm test` 与 `corepack pnpm build`。
- [ ] 5.2 使用 `$openspec-verify-change` 核对实现与 proposal/design/tasks，修复所有 CRITICAL 问题并确认任务全部完成。
- [ ] 5.3 再次 fetch 并安全整合远程最新代码，提交并推送 GitHub，验证远程分支 commit hash 与本地一致。
- [ ] 5.4 仅部署 Railway `web` 到该 commit，记录 deployment ID，并 Smoke Test 登录、HC 选择、对话、岗位说明、人才画像和管理员 Trace；`api` 与 `harness-sidecar` 不重新部署。
