## Why

前端岗位工作台的核心实现集中在 2,245 行的 `App.jsx` 和 6,374 行的 `styles.css` 中，组件、会话状态、SSE、副作用和多版样式相互交织，使岗位说明与人才画像等关键页面难以安全修改。现在需要先在不改变用户行为的前提下建立清晰边界，降低后续迭代引发回归和版本漂移的风险。

## What Changes

- 将 `App.jsx` 拆为应用编排、岗位会话控制、工作台框架、对话视图和画像产物视图等聚焦模块。
- 将 `styles.css` 按现有功能演进段落拆分为有序样式文件，保持选择器、响应式规则和源码级联顺序。
- 为岗位工作台的关键导航与画像展示补充组件级回归测试，覆盖经理、HR 和管理员视角。
- 删除拆分过程中确认无调用方的重复前端实现，但不改变 API、数据结构或页面文案。
- Railway：需要部署 `web` 服务验证构建产物；`api`、`harness-sidecar` 和数据库不变。

## Capabilities

### New Capabilities

无。本变更是纯内部重构，`.openspec.yaml` 已设置 `skip_specs: true`。

### Modified Capabilities

无。现有用户可见行为、权限规则、API 契约和产物状态均保持不变。

## Impact

- 主要影响 `frontend/src/App.jsx`、`frontend/src/styles.css`，并新增聚焦的组件、hooks、样式文件和前端测试。
- 不修改后端路由、共享契约、数据库 Schema、迁移、Agent Run/SSE 协议或 Railway 服务拓扑。
- 前端仍使用现有 `api/client.js`、内容规范化模块和既有权限数据，不增加运行时依赖。

## Non-goals

- 不重新设计页面视觉，不调整岗位说明、人才画像、对话或 Trace 的业务流程。
- 不修改服务端领域逻辑、权限判断、持久化结构或演示数据。
- 不为未来需求预建新的状态框架、设计系统或通用抽象层。
