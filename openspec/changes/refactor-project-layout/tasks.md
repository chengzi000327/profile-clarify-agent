## 1. 基线与迁移保护

- [x] 1.1 检查 `git status`、当前分支、远程 HEAD 和最近提交，先 fetch 并安全整合 GitHub 最新版本；记录迁移前 commit，确认未覆盖用户改动。
- [x] 1.2 只读记录 Railway `web`、`api`、`harness-sidecar` 当前 Dockerfile 路径、deployment ID、commit 和健康状态，形成三个服务可执行的回滚基线且不输出敏感变量。
- [x] 1.3 运行迁移前 `corepack pnpm typecheck`、`corepack pnpm test`、`corepack pnpm build`，记录基线通过项和任何既有失败。

## 2. 建立统一目录结构

- [x] 2.1 将受 Git 跟踪的 `frontend/`、`server/`、`harness-sidecar/`、`agent-intro-frontend/` 分别移动到 `apps/web/`、`apps/api/`、`apps/harness-sidecar/`、`apps/intro-web/`，用 `git diff --summary` 确认是重命名且业务源码内容未改变。
- [x] 2.2 将根目录五份中文产品、前端与评测说明移动到 `docs/product/`，检查内部 Markdown 引用，并确认根目录不再散落这些文档。
- [x] 2.3 更新 `pnpm-workspace.yaml` 及 lockfile importer 路径，执行 `corepack pnpm install --frozen-lockfile` 并用 `pnpm list -r --depth -1` 确认四个应用和三个 workspace 共享包均被正确发现。

## 3. 更新构建、脚本与文档路径

- [x] 3.1 更新四个应用 Dockerfile 和 `docker-compose.yml` 的 manifest、源码、产物、启动及 Dockerfile 路径；本机无 Docker 时以 YAML/路径断言解析，并由 Railway 真实构建完成生产等价验证。
- [x] 3.2 更新 Harness 准备/验证、sidecar smoke、数据库备份/治理/迁移脚本中的 runtime、构建产物、API 依赖和 drizzle 路径，运行对应的非生产验证命令证明路径可达。
- [x] 3.3 更新 README 项目地图、开发命令说明和 `docs/railway-deployment.md`，确保 Railway 新路径明确为 `/apps/web/Dockerfile`、`/apps/api/Dockerfile`、`/apps/harness-sidecar/Dockerfile`。
- [x] 3.4 新增可重复的目录布局检查脚本并接入根 package script，验证它能确认必需目录存在、旧应用目录不存在且当前源码/配置/操作文档无旧路径引用，同时显式排除历史 OpenSpec 记录。

## 4. 完整验证与 Review

- [x] 4.1 执行目录检查、`git diff --check`、`corepack pnpm typecheck`、`corepack pnpm test` 与 `corepack pnpm build`，记录所有结果并修复本变更引入的失败。
- [ ] 4.2 从仓库根 context 分别构建 `apps/web/Dockerfile`、`apps/api/Dockerfile`、`apps/harness-sidecar/Dockerfile`，并运行 Compose 本地健康检查或等价容器 smoke，确认三条生产构建链可用。
- [x] 4.3 基于完整 diff Review rename 相似度、路径残留、锁文件、Docker COPY、权限/租户/HC/产物/SSE/Trace 不变性、数据库迁移内容和敏感信息，发现 P0/P1 或非路径业务差异时先修复再重新 Review。

## 5. GitHub 与 Railway 交付

- [ ] 5.1 提交前再次 fetch GitHub 并安全整合远程最新代码，确认无无关文件、密钥、`node_modules` 或 `dist` 后提交并推送，验证远程分支包含目标 commit hash。
- [ ] 5.2 在既有 Railway 项目和环境中按 `harness-sidecar`、`api`、`web` 顺序将 Dockerfile 路径切到新位置并部署同一个 Git commit；逐服务核对 deployment ID、commit、构建状态和 health check，失败时停止后续切换并按基线回滚。
- [ ] 5.3 线上 Smoke Test `/healthz`、API 健康状态、登录、岗位列表、岗位详情、岗位说明和人才画像；涉及权限的关键链路分别核对经理、HR、管理员视角，并记录 PostgreSQL 未迁移、未重建、数据未修改。
- [ ] 5.4 使用 `openspec-verify-change` 核对 proposal、design 和任务实现，确认无 CRITICAL 问题且所有未执行检查均有明确原因。
