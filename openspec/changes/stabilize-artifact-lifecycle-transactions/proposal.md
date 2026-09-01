## Why

岗位产物的生成、确认和下游失效目前由多个独立数据库写操作组成；若中途失败，可能留下“新产物已写入但岗位仍指向旧版本”或“下游已失效但岗位状态未更新”等部分提交状态。岗位说明与人才画像已经成为核心业务事实源，需要在继续扩展产物链路前先保证版本、岗位状态和审计记录的一致性。

## What Changes

- 为岗位产物生成和确认建立明确的事务边界，使产物版本、下游失效、`latest_artifacts`、岗位 revision 和审计记录原子提交。
- 在 PostgreSQL 写入期间锁定目标岗位并校验 expected revision，避免并发请求生成重复版本或覆盖较新的岗位状态。
- 保持现有 API 路径、请求/响应结构、权限规则、产物内容 Schema 和前端行为不变；冲突继续使用现有领域错误语义返回。
- 为 MemoryStore 与 PostgresStore 建立共享的存储契约测试，验证成功提交、失败回滚、并发冲突及租户/权限边界所依赖的读取结果一致。
- 将事务能力限制在产物生命周期用例，不引入通用 Repository 框架，不顺带拆分 API、RoleService、Agent Runner 或前端。
- Railway：需要部署 `api`；若数据库实现只使用现有表和事务能力，则不新增迁移，也不部署 `web`、`harness-sidecar` 或重建 PostgreSQL。

## Capabilities

### New Capabilities

- `artifact-lifecycle-consistency`: 规定产物生成、确认、下游失效、岗位状态和审计写入必须以一致快照原子提交，并在并发或失败时保留原有有效状态。

### Modified Capabilities

无。当前尚无 OpenSpec 主规格；现有 API 和用户流程保持兼容。

## Impact

- 主要影响 `apps/api/src/services/role-service.ts`、`apps/api/src/store/types.ts`、`apps/api/src/store/postgres-store.ts`、`apps/api/src/store/memory-store.ts` 及对应测试。
- 可能增加面向产物生命周期的窄事务接口或工作单元，但不改变应用对外 API。
- 不新增运行时服务或第三方依赖，不修改 Harness 协议，不改变 Railway 服务拓扑。
- PostgreSQL 部署前需要确认没有破坏现有岗位、HC、产物版本、对话、Agent Run 和审计数据；回滚采用重新部署实施前 API commit，不执行破坏性数据库回滚。

## Non-goals

- 不把单体 API 拆成微服务，不在本变更中完成后端垂直切片。
- 不实现持久化 Agent 队列、跨实例 SSE 或任务续跑。
- 不重写全部存储层，也不创建通用 ORM/Repository 抽象。
- 不改变产物生成顺序、角色权限、确认门禁、版本展示或前端交互。
