## Context

动机见 `proposal.md`。仓库已经是 pnpm monorepo，共享代码位于 `packages/`，但四个运行应用仍使用历史根目录名：`frontend/`、`server/`、`harness-sidecar/`、`agent-intro-frontend/`。这些名字被 workspace、Docker build context、Compose、Railway 文档、Harness runtime 准备脚本、数据库运维脚本和 README 共同引用。

生产环境由 Railway 的 `web`、`api`、`harness-sidecar` 和 PostgreSQL 组成。目录迁移不改变服务发现名称、端口或环境变量，但三个应用服务的 Dockerfile 路径必须与同一 Git commit 一起切换。数据库脚本和迁移文件随 API 目录移动，但迁移内容及生产数据不变。

## Goals / Non-Goals

**Goals:**

- 让顶层目录一眼区分可运行应用、共享包、文档、评测、脚本和变更规格。
- 所有应用采用稳定的 `apps/<service>` 规则，并保持 npm package name 和 Railway service name 不变。
- 通过机械路径迁移保持源码语义和 Git 文件历史，避免把目录重构与业务重构混在一起。
- 在提交前证明 workspace、测试、类型检查、构建、Docker 构建和旧路径检查全部通过。
- 让 GitHub commit、三个 Railway 应用部署和线上健康检查能够被明确对应。

**Non-Goals:**

- 不改变 API、UI、权限、租户、HC、产物、SSE、Trace 或数据库行为。
- 不调整包边界、包名、依赖关系、服务拓扑或环境变量命名。
- 不重排应用内部目录，不清理与路径迁移无关的代码。
- 不移动本地 `.harness/` 缓存；它仍是仓库根下的被忽略运行时目录。

## Decisions

### 1. 使用 `apps/` 统一可部署应用

采用以下一对一映射：

| 旧路径 | 新路径 | npm package / Railway service |
| --- | --- | --- |
| `frontend/` | `apps/web/` | `@role-clarifier/web` / `web` |
| `server/` | `apps/api/` | `@role-clarifier/api` / `api` |
| `harness-sidecar/` | `apps/harness-sidecar/` | `@role-clarifier/harness-sidecar` / `harness-sidecar` |
| `agent-intro-frontend/` | `apps/intro-web/` | `@role-clarifier/intro-web` / 非生产主服务 |

`packages/` 继续容纳可复用 workspace 包和两个 DeepSeek Harness overlay 包。后者继续不进入本仓库安装图，而由 `scripts/prepare-harness-runtime.mjs` 覆盖到锁定的上游 runtime。替代方案是只给旧目录增加说明或仅重命名前端，但不能消除根目录分散和路径命名不一致，因此不采用。

### 2. 文档按用途归档，仓库级控制文件留在根目录

根目录五份中文产品/前端/评测说明移入 `docs/product/`，现有 `docs/railway-deployment.md` 等运维文档保持在 `docs/`，`evals/` 保持独立。`README.md`、`AGENTS.md`、OpenSpec、workspace、Compose 和 TypeScript 根配置仍在根目录，因为它们是仓库入口而非某个应用资产。

不在本次引入多层文档分类体系或批量改名文档，避免链接和阅读入口发生不必要变化。所有被跟踪的内部 Markdown 链接在移动后必须更新并检查。

### 3. 路径更新必须覆盖构建链，而不仅是源码 import

应用内部相对 import 随整个目录移动而保持不变；仓库根路径引用则统一改为新位置，包括：

- `pnpm-workspace.yaml` 的应用 glob/条目及因 importer path 改变而更新的 `pnpm-lock.yaml`。
- `docker-compose.yml` 中三个 Dockerfile 路径。
- 四个应用 Dockerfile 的 package manifest COPY、源码 COPY、构建产物和启动路径。
- Harness runtime lock/cordis、sidecar 构建产物、API `node_modules` 与 `drizzle/` 的脚本路径。
- README、Railway 部署文档及其他受跟踪文本中的目录示例。

采用精确路径替换并在变更后运行 `rg` 残留扫描；不保留根目录软链接或兼容 Dockerfile，因为双路径会让 AI 和部署配置继续产生歧义。对于历史 OpenSpec 变更中的旧路径不回写，它们是当时设计与交付记录，不是当前操作入口；残留检查显式排除归档变更记录。

### 4. 目录移动与依赖重建分离

使用 Git 可识别的重命名移动受跟踪文件，确保 diff 主要显示 rename。被忽略的 `node_modules/` 和 `dist/` 不作为迁移内容或交付物；移动后从仓库根执行冻结锁文件安装/构建来重建有效工作区链接与产物。

先记录干净工作区、当前分支、远程 HEAD 和基线验证，再执行移动。任何用户未提交文件都先保留并单独处理，不能被目录移动掩盖。替代方案是在新目录复制后删除旧目录，会降低 rename 可读性并增加漏文件风险，因此不采用。

### 5. Railway 以同一 commit 协调切换三个应用服务

GitHub 推送后，将已有 Railway 服务的 Dockerfile 路径更新为：

- `web`: `/apps/web/Dockerfile`
- `api`: `/apps/api/Dockerfile`
- `harness-sidecar`: `/apps/harness-sidecar/Dockerfile`

不创建服务，不修改数据库变量，不改变内部地址。先只读确认项目、环境、服务 ID、当前 deployment 和变量引用；随后让三个服务构建同一 Git commit。部署顺序为 `harness-sidecar`、`api`、`web`，因为新旧版本的网络契约不变，顺序只用于从下游到入口逐层验证。每个服务都核对 deployment commit、构建状态和 health check，最后验证登录、岗位列表、岗位详情、岗位说明、人才画像及相关角色权限。

目录变更不需要数据库迁移，API 容器启动时现有 `db:migrate` 仍会运行幂等迁移；部署前只读确认迁移目录内容未发生语义变化。

### 6. 用可重复验证约束“目录清晰”

完成标准不依赖肉眼查看目录：

- 根目录仅保留约定的一层分类和仓库级配置，不再出现四个旧应用目录及五份散落产品文档。
- `pnpm install --frozen-lockfile`、typecheck、test、build 全部从根目录成功。
- Compose 配置解析成功，三个生产 Dockerfile 都能从仓库根 context 构建。
- 路径残留扫描在当前源码/配置/文档中无旧应用路径，仅允许归档 OpenSpec 记录。
- Railway 三个服务都指向新 Dockerfile 路径和同一目标 commit，线上关键链路通过。

## Risks / Trade-offs

- [移动本地 `node_modules` 后 pnpm 相对链接失效] → 不把本地依赖视为迁移结果；移动后从根目录重新执行冻结安装并验证四个 workspace 包。
- [Dockerfile COPY 路径遗漏导致 Railway 构建失败] → 本地分别构建三个生产镜像，并在部署前扫描全部旧路径引用。
- [Railway 配置已切到新路径但部署 commit 仍是旧版本] → 先推送包含新路径的 commit，再更新配置和触发部署；逐服务核对 commit，不接受“只显示成功但 hash 不一致”。
- [三个服务无法原子切换，出现短暂混合版本] → 保持协议、端口和变量完全兼容，从 sidecar 到 API 到 web 逐层部署；任一服务失败即停止继续切换并执行该服务回滚。
- [回滚到旧 commit 时新 Dockerfile 路径不存在] → 回滚必须同时恢复该服务旧 Dockerfile 路径并 redeploy 迁移前 deployment；记录迁移前每个 deployment ID/commit/path。
- [纯路径重构混入业务修改] → Review 以 rename 相似度和完整 diff 为依据；除路径/文档变化外的源码差异视为阻塞问题。
- [历史文档仍出现旧路径，扫描产生噪声] → 保留归档 OpenSpec 的历史真实性，仅在扫描命令中明确排除 `openspec/changes/`，不把豁免扩展到当前 README 或运维文档。

## Migration Plan

1. 拉取并确认远程最新状态，记录当前 commit、Railway 三服务 deployment/commit/Dockerfile 路径，运行仓库基线检查。
2. 建立 `apps/` 和 `docs/product/`，一对一移动受跟踪文件与五份产品文档，不修改应用内部逻辑。
3. 更新 workspace、lockfile、Docker/Compose、脚本、README 和部署文档；运行旧路径残留与敏感信息检查。
4. 重建依赖链接并执行全仓 typecheck、test、build、Compose 解析和三个生产 Docker 镜像构建。
5. 基于完整 diff Review rename、跨模块路径、权限/数据/迁移不变性；通过 OpenSpec verify 后提交并推送 GitHub。
6. 只读复核 Railway，切换三个既有服务的 Dockerfile 路径并部署同一 commit；逐层健康检查并完成经理、HR、管理员关键链路 Smoke Test。
7. 若失败，将对应 Railway 服务恢复到迁移前 Dockerfile 路径和 deployment；GitHub 不强推、不改写历史，使用明确的回滚提交处理仓库路径。
