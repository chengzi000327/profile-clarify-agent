## Why

当前四个可运行应用散落在仓库根目录，产品文档、评测资料、共享包和运维脚本也缺少统一分区；同时 Docker、Railway、workspace 和脚本中存在大量旧目录硬编码，使开发者和 AI 在修改或部署时容易选错入口、漏改路径并造成版本漂移。现在需要在保持业务行为不变的前提下，建立可预测的 monorepo 目录结构和单一目录说明。

## What Changes

- 将四个可运行应用统一放入 `apps/`：`apps/web`、`apps/api`、`apps/harness-sidecar`、`apps/intro-web`。
- 保留 `packages/` 作为共享库和 Harness overlay 包目录，保留 `scripts/`、`openspec/`、`evals/` 的职责边界。
- 将根目录产品与方案文档归档到 `docs/product/`，并更新 README 中的项目地图和开发入口。
- 更新 pnpm workspace、根脚本、Dockerfile、Compose、Railway 文档、Harness 准备/验证脚本以及数据库运维脚本中的全部路径引用。
- 为旧路径残留增加可重复检查，确保源码、构建配置和部署文档只引用新目录。
- **BREAKING（仓库与部署配置）**：源码物理路径和 Railway `RAILWAY_DOCKERFILE_PATH` 改变；API、数据库、权限和用户可见行为不变。
- Railway：需要按同一个 Git commit 依次更新并部署 `web`、`api`、`harness-sidecar`；PostgreSQL 不迁移、不重建、不修改数据。

## Capabilities

### New Capabilities

无。本变更是纯目录、构建与部署配置重构，`.openspec.yaml` 已设置 `skip_specs: true`。

### Modified Capabilities

无。现有 API 契约、业务流程、权限边界、Agent Run/SSE、产物版本和数据库结构均保持不变。

## Impact

- 移动 `frontend/`、`server/`、`harness-sidecar/`、`agent-intro-frontend/` 及其受 Git 跟踪内容，不提交 `node_modules/` 或 `dist/`。
- 修改根 `package.json`、`pnpm-workspace.yaml`、`pnpm-lock.yaml`、`docker-compose.yml`、各应用 Dockerfile、README、Railway 文档和路径相关脚本。
- Git 历史保留为文件重命名；包名、服务名、端口、环境变量、内部网络地址和公开路由不变。
- 不新增运行时依赖，不修改数据库 Schema/迁移，不变更 Railway 服务拓扑，不触碰生产数据。

## Non-goals

- 不借目录迁移重写前后端架构、重命名 npm package、重构业务代码或清理历史功能。
- 不合并或拆分 Railway 服务，不创建新项目、环境、数据库或域名。
- 不移动 OpenSpec 主目录、AGENTS.md 或仓库级配置到子目录。
- 不将被 `.gitignore` 忽略的本机构建产物和依赖目录纳入版本控制。
