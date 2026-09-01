# 项目协作与交付规范

## 核心原则

- 先同步、再修改：开始工作前检查 `git status`、当前分支、最近提交和远程差异；工作区干净时执行 `git pull --ff-only`。工作区有用户改动时先保留并核对，不得直接覆盖。
- 只做满足当前需求的最小改动。优先复用现有类型、函数和组件；禁止无关重构、预留式抽象、重复实现和为了“以后可能需要”而增加的层级。
- 代码应短而清晰：一个模块只承担明确职责，能直接表达时不新增包装层；修改范围内出现明显重复或死代码时一并清理。
- 不输出或提交密码、Cookie、Token、API Key、数据库连接串等敏感信息。线上数据查询默认只读。
- 未经用户明确授权，不得使用 `git reset --hard`、强制推送、覆盖远程历史或破坏性数据库操作。

## OpenSpec 分级

### 低风险：直接修改

适用于文案、文档、注释、样式微调、测试调整，以及不改变接口或数据结构的局部修复。

- 不创建 OpenSpec change。
- 阅读相关文件后直接实现最小修补。
- 运行 `git diff --check` 和与改动直接相关的测试或检查。

### 中风险：使用 OpenSpec

适用于用户可见行为变化、新增或调整功能、单模块业务逻辑修改，以及会影响相邻调用方的接口改动。

1. 使用 `$openspec-propose` 创建 proposal、spec、design 和 tasks。
2. 等用户确认后，使用 `$openspec-apply-change` 实现。
3. 使用 `$openspec-verify-change` 核对实现与规格。
4. 完成后使用 `$openspec-archive-change` 归档并同步正式规格。

### 高风险：OpenSpec + 完整验证

以下变更必须使用 OpenSpec，并检查端到端影响：

- 数据库 Schema、迁移或生产数据。
- 登录、权限、租户隔离、岗位成员关系或 HC 审批。
- Agent Run、SSE、Trace、异步任务或缓存。
- 画像产物、版本号、状态转换或下游失效逻辑。
- Web、API、Harness Sidecar 之间的协议或 Railway 部署拓扑。

高风险变更需要核对前端、API、领域类型、存储层、迁移、旧数据兼容和权限边界；涉及生产数据库时，迁移前必须有备份或明确可恢复方案。

## Review 与验证

提交前基于实际 diff 做 Review，重点检查功能正确性、边界条件、跨模块回归、权限与敏感数据、错误处理、并发和不必要的复杂度。

- 低风险：`git diff --check` + 针对性检查。
- 中风险：`git diff --check` + 针对性测试 + `corepack pnpm typecheck`。
- 高风险：`git diff --check`、`corepack pnpm typecheck`、`corepack pnpm test`、`corepack pnpm build`，并执行与改动相关的集成或 Smoke Test。
- 只运行能证明本次改动的检查，不因无关模块缺少外部依赖而扩大工作范围。
- 未执行或失败的检查必须如实说明；不得把未验证结果称为通过。
- 发现 P0/P1、阻塞问题或未解决的跨模块冲突时，先修复，不得提交或部署。

## GitHub 提交

1. 提交前再次 `git fetch`，确认远程没有新提交；如有，先安全整合最新代码再修补和验证。
2. 检查 `git status` 和 diff，排除密钥、构建产物、临时文件及无关改动。
3. 使用清晰的提交信息，推送当前目标分支。
4. 记录 commit hash，并确认远程分支确实指向该提交。

## Railway 部署

- 只有影响运行时代码、依赖、数据库或部署配置的提交才部署 Railway；纯文档、测试、OpenSpec 规格或协作规则变更不触发部署。
- 部署前确认本地提交、GitHub 目标分支和 Railway 待部署 commit 一致。
- 默认让 `web`、`api`、`harness-sidecar` 使用同一目标 commit；用户明确指定服务级历史版本时，以用户给出的映射为准并逐项记录。
- 不新建服务、不擅自修改生产 Secret 或生产数据。
- 部署后按改动范围检查服务状态和关键链路；涉及权限、HC、Agent、SSE 或 Trace 时，再验证对应角色和业务边界。
- 报告每个服务的 deployment ID、commit、状态和未验证项，不能只说“已部署”。

## 交付报告

完成后简要说明：修改内容、Review 结果、测试与验证、GitHub commit 和推送结果、Railway 状态（如适用），以及剩余风险或未执行项。
