# 岗位画像澄清三闭环 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在保持现有前端布局和 Railway 拓扑不变的前提下，完成 HC 审批主动提醒、企业知识后端检索、岗位事实人工确认与正式生效三个可审计闭环。

**Architecture:** 复用现有 Fastify API、PostgreSQL、Agent Runner、Harness Sidecar、React 工作台和飞书企业应用。新增 PostgreSQL 事务型任务/Outbox、确定性企业知识检索和事实决策服务；站内数据库状态是事实源，飞书只负责可重试触达，正式产物只读取已确认事实。

**Tech Stack:** Node.js 24+、TypeScript 5.9、Fastify 5、Zod 4、Drizzle ORM、PostgreSQL、Vitest 3、React 18、Vite 6、DeepSeek Harness Sidecar、飞书开放平台、Railway CLI 4.57+

**Reference Spec:** `docs/superpowers/specs/2026-08-18-fact-confirmation-design.md`

## Global Constraints

- 最终目标分支是 `main`；禁止强制推送和覆盖远程历史。
- Node.js 必须为 `>=24`，包管理器使用仓库锁定的 `pnpm@10.15.1`。
- Railway 继续保持 `web + api + harness-sidecar + PostgreSQL`，不新增服务、消息队列或向量数据库。
- 前端只能改三处：HC 卡片小状态、对话内事实确认卡、岗位页待处理数量。
- 登录、左侧导航、岗位选择结构、对话整体布局、岗位画像正文、HR 共享工作区和 Trace 位置保持不变。
- 企业知识不得包含候选人姓名、联系方式、简历原文或评价原文；候选人证据继续走岗位级权限链路。
- 所有租户、角色、有效期和知识可见性过滤必须在检索排序之前执行。
- 飞书失败不能影响站内任务；无绑定时禁止猜测接收人。
- Agent 只能写 `DRAFT`；经理或管理员的有效经理角色才能让岗位事实正式生效。
- 每个任务先写失败测试，再做最小实现；每次只暂存任务列出的文件，执行 `git diff --cached --check` 后提交。
- 每个任务提交前根据实际 diff 检查权限、租户、旧数据、幂等、并发、Trace 和相邻调用方。
- 不修改用户现有的 `docs/superpowers/plans/2026-08-17-role-profile-two-stage-implementation.md`。

---

## File Structure

### Shared contracts and domain

- `packages/contracts/src/index.ts`：事实来源字段、企业知识、上下文包、HC 任务摘要、通知摘要和事实决策请求的共享 Zod 合约。
- `packages/contracts/src/index.test.ts`：历史事实兼容、三种事实决策请求和上下文包合约测试。
- `packages/domain/src/fact-decisions.ts`：纯函数形式的事实状态转换与正式产物失效规则。
- `packages/domain/src/index.ts`：导出事实决策纯函数，不承载新的服务协调逻辑。
- `packages/domain/src/index.test.ts`：确认、修改、拒绝、替代版本和产物失效测试。

### Server storage and services

- `server/drizzle/0013_role_clarification_closures.sql`：四张增量表、索引、约束和 Mock 企业知识 Seed。
- `server/src/db/schema.ts`：与迁移一致的 Drizzle 表定义。
- `server/src/store/closure-types.ts`：企业知识、岗位澄清任务、通知 Outbox、飞书绑定和原子提交参数类型。
- `server/src/store/enterprise-knowledge-seed.ts`：内存 Store 使用的同构 Mock 企业知识。
- `server/src/store/types.ts`：按闭环逐步增加最小 Store 接口。
- `server/src/store/memory-store.ts`：开发与单元测试的闭环存储实现。
- `server/src/store/postgres-store.ts`：PostgreSQL 查询、事务、行锁领取和原子提交实现。
- `server/src/services/enterprise-context-retriever.ts`：权限过滤后的确定性相关性排序、Top N 和字符预算。
- `server/src/services/hc-event-service.ts`：HC 审批事件到审批、任务和通知 Outbox 的事务协调。
- `server/src/services/notification-outbox-dispatcher.ts`：通知领取、飞书发送、重试、`UNBOUND` 和 `DEAD` 状态。
- `server/src/services/fact-decision-service.ts`：事实权限、Revision、纯领域转换和原子持久化协调。
- `server/src/integrations/mock-hris.ts`：Mock HRIS 事件 Schema、时间戳与 HMAC 校验。
- `server/src/integrations/feishu.ts`：保留现有入站机器人功能，补充 `open_id` 主动发送和真实用户绑定。

### Agent and API

- `server/src/agent/harness-adapter.ts`：在 Harness 请求中加入 `enterprise_context`。
- `server/src/agent/runner.ts`：运行前检索、失败降级、事实来源关联和 Agent 消息 `fact_id`。
- `server/src/services/role-service.ts`：复用现有岗位工作区与产物流程，委托新的闭环服务。
- `server/src/app.ts`：注册 Mock HRIS 事件、事实决策接口、Dispatcher 生命周期和 OpenAPI。
- `server/src/config.ts`、`.env.example`：HC 事件密钥、通知调度开关与轮询参数。
- `harness-sidecar/src/schemas.ts`：校验 `enterprise_context` 请求。
- `harness-sidecar/src/prompts.ts`：把企业知识作为独立不可信数据块进入上下文与 Prompt。

### Frontend small changes

- `frontend/src/hc-progress.js`、`frontend/src/hc-progress.test.js`：HC 小状态派生。
- `frontend/src/fact-decision.js`、`frontend/src/fact-decision.test.js`：事实卡片状态、权限和待处理数量纯函数。
- `frontend/src/components/HcApprovalLanding.jsx`：只替换现有卡片的小状态计算。
- `frontend/src/components/FactDecisionCard.jsx`：紧凑事实卡、行内修改和 HR 只读态。
- `frontend/src/api/client.js`：增加 `decideFact`。
- `frontend/src/App.jsx`：把事实卡挂在现有 Agent 消息下，并在现有岗位提示区显示待处理数量。
- `frontend/src/styles.css`：仅增加三处局部样式和防溢出规则。
- `frontend/package.json`：把两个纯函数测试加入现有 `node --test` 命令。

### Operations and documentation

- `scripts/send-demo-hc-event.mjs`：使用同一签名算法发送一次新的 Mock HC 审批事件。
- `README.md`、`docs/feishu-integration.md`、`docs/railway-deployment.md`、`docs/implementation-status.md`：配置、边界和验收说明。

---

### Task 1: Shared contracts and fact-decision domain rules

**Files:**
- Modify: `packages/contracts/src/index.ts:55-70,126-139,341-415,430-503`
- Modify: `packages/contracts/src/index.test.ts`
- Create: `packages/domain/src/fact-decisions.ts`
- Modify: `packages/domain/src/index.ts:1-150`
- Modify: `packages/domain/src/index.test.ts`

**Interfaces:**
- Produces: `EnterpriseKnowledgeItem`, `EnterpriseContextBundle`, `FactDecisionRequest`, `FactDecisionResult`, `applyFactDecision()`.
- Consumes: existing `Fact`, `RoleState`, `ArtifactEnvelope`, `ActorRole`, `FactCategory`.

- [ ] **Step 1: Add failing contract tests for old facts and new closure payloads**

```ts
it('旧事实缺少来源与确认字段时补为 null', () => {
  expect(FactSchema.parse({
    id: 'fact-old', category: 'BACKGROUND', statement: '旧事实', source: '历史数据',
    status: 'CONFIRMED', evidence_refs: [], visible_to: 'ALL',
    updated_at: '2026-08-18T00:00:00.000Z',
  })).toMatchObject({
    source_message_id: null,
    source_run_id: null,
    proposed_by_user_id: null,
    confirmed_by_user_id: null,
    confirmed_at: null,
    supersedes_fact_id: null,
    decision_reason: null,
  })
})

it('修改事实必须携带 replacement', () => {
  expect(() => FactDecisionRequestSchema.parse({
    decision: 'REVISE', expected_revision: 3,
  })).toThrow()
})

it('企业上下文最多包含六条有来源命中', () => {
  expect(EnterpriseContextBundleSchema.parse({
    query: {
      role_session_id: '11111111-1111-4111-8111-111111111111',
      task: 'CLARIFY_MESSAGE', department: '企业服务产品部', job_family: '产品',
      query_terms: ['企业产品经理', '职级', '成功标准'],
    },
    hits: Array.from({ length: 7 }, (_, index) => ({
      knowledge_id: `K-${index}`, category: 'ORGANIZATION', title: '组织职责',
      summary: '摘要', source_ref: `mock://org/${index}`, source_version: 'v1',
      relevance_score: 30, match_reasons: ['部门一致'],
    })),
    truncated: false,
  })).toThrow()
})
```

Add a historical `AgentContextSnapshotSchema.parse` case without `enterprise_context` and assert the parsed value is `null`; add an old HC payload without task/notification summaries and assert both defaults are `null`.

- [ ] **Step 2: Run the contract tests and verify failure**

Run: `corepack pnpm --filter @role-clarifier/contracts test`

Expected: FAIL because the new schemas and default fields do not exist.

- [ ] **Step 3: Extend contracts with backward-compatible defaults**

```ts
export const FactSchema = z.object({
  id: z.string(),
  category: FactCategorySchema,
  statement: z.string().min(1),
  source: z.string().min(1),
  status: FactStatusSchema,
  evidence_refs: z.array(z.string()).default([]),
  visible_to: z.enum(['ALL', 'HR_ONLY']).default('ALL'),
  updated_at: z.string().datetime(),
  source_message_id: z.string().nullable().default(null),
  source_run_id: z.string().nullable().default(null),
  proposed_by_user_id: z.string().nullable().default(null),
  confirmed_by_user_id: z.string().nullable().default(null),
  confirmed_at: z.string().datetime().nullable().default(null),
  supersedes_fact_id: z.string().nullable().default(null),
  decision_reason: z.string().nullable().default(null),
})

export const FactDecisionRequestSchema = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('CONFIRM'), expected_revision: z.number().int().nonnegative(), test_role: AdminTestRoleSchema.optional() }).strict(),
  z.object({ decision: z.literal('REJECT'), expected_revision: z.number().int().nonnegative(), reason: z.string().trim().min(3).max(500).optional(), test_role: AdminTestRoleSchema.optional() }).strict(),
  z.object({
    decision: z.literal('REVISE'),
    expected_revision: z.number().int().nonnegative(),
    reason: z.string().trim().min(3).max(500).optional(),
    replacement: z.object({ category: FactCategorySchema, statement: z.string().trim().min(1).max(2_000) }),
    test_role: AdminTestRoleSchema.optional(),
  }).strict(),
])
```

Add these concrete shared schemas and export their inferred types:

```ts
export const EnterpriseKnowledgeCategorySchema = z.enum([
  'ORGANIZATION', 'JOB_FAMILY', 'LEVEL_FRAMEWORK', 'HISTORICAL_JD',
  'ROLE_PROFILE_CASE', 'RECRUITING_POLICY', 'INTERVIEW_STANDARD',
])

export const EnterpriseKnowledgeItemSchema = z.object({
  id: z.string().min(1), tenant_id: z.string().min(1),
  category: EnterpriseKnowledgeCategorySchema,
  title: z.string().min(1), content: z.string().min(1), summary: z.string().min(1),
  department: z.string().nullable(), job_family: z.string().nullable(),
  tags: z.array(z.string().min(1)),
  visible_to: z.enum(['ALL_ROLE_MEMBERS', 'HR_ONLY', 'ADMIN_ONLY']),
  source_ref: z.string().min(1), source_version: z.string().min(1),
  status: z.enum(['ACTIVE', 'ARCHIVED']),
  valid_from: z.string().datetime(), valid_to: z.string().datetime().nullable(),
  updated_at: z.string().datetime(),
})

export const EnterpriseContextHitSchema = z.object({
  knowledge_id: z.string().min(1), category: EnterpriseKnowledgeCategorySchema,
  title: z.string().min(1), summary: z.string().min(1),
  source_ref: z.string().min(1), source_version: z.string().min(1),
  relevance_score: z.number().nonnegative(),
  match_reasons: z.array(z.string().min(1)).min(1),
})

export const EnterpriseContextBundleSchema = z.object({
  query: z.object({
    role_session_id: z.string().uuid(),
    task: z.enum([
      'CLARIFY_MESSAGE', 'GENERATE_ROLE_PROFILE', 'GENERATE_ASSESSMENT',
      'GENERATE_JD', 'GENERATE_HR_BRIEF', 'EXTRACT_CANDIDATES', 'CALIBRATION_ADVICE',
    ]),
    department: z.string().min(1), job_family: z.string().nullable(),
    query_terms: z.array(z.string().min(2).max(24)).max(20),
  }),
  hits: z.array(EnterpriseContextHitSchema).max(6),
  truncated: z.boolean(),
})

export const RoleClarificationTaskSummarySchema = z.object({
  id: z.string(), status: z.enum(['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']),
  assignee_user_id: z.string(), started_at: z.string().datetime().nullable(),
  completed_at: z.string().datetime().nullable(),
})

export const NotificationDeliverySummarySchema = z.object({
  channel: z.literal('FEISHU'),
  status: z.enum(['PENDING', 'PROCESSING', 'SENT', 'RETRY', 'UNBOUND', 'DEAD']),
  sent_at: z.string().datetime().nullable(), last_error_code: z.string().nullable(),
})
```

Extend `HcApprovalSchema` with `clarification_task: RoleClarificationTaskSummarySchema.nullable().default(null)` and `notification_delivery: NotificationDeliverySummarySchema.nullable().default(null)`. Add `context.retrieval_failed` to `AgentEventTypeSchema`. Extend `AgentContextSnapshot.long_term_memory` with `enterprise_context: EnterpriseContextBundleSchema.nullable().default(null)` so historical Trace snapshots still parse.

- [ ] **Step 4: Add failing domain tests for all fact transitions**

```ts
it('确认替代草稿后淘汰旧事实并让全部正式产物失效', () => {
  const result = applyFactDecision({
    state: roleStateWithConfirmedFactAndReplacement,
    artifacts: confirmedArtifacts,
    factId: 'fact-replacement',
    request: { decision: 'CONFIRM', expected_revision: 7 },
    actorUserId: 'manager-demo',
    now: '2026-08-18T02:00:00.000Z',
  })
  expect(result.state.facts.find((fact) => fact.id === 'fact-original')?.status).toBe('STALE')
  expect(result.state.facts.find((fact) => fact.id === 'fact-replacement')?.status).toBe('CONFIRMED')
  expect(result.artifacts.filter((item) => item.status === 'INVALIDATED')).toHaveLength(4)
  expect(result.audit_action).toBe('FACT_CONFIRMED')
})
```

Also test: confirm new draft; reject draft without invalidation; revise draft; revise confirmed fact while keeping the old fact active; revise that replacement again and confirm the newest draft so the confirmed ancestor becomes `STALE`; only latest referenced confirmed artifacts invalidate; repeated confirmation is idempotent; stale fact rejection returns `FACT_NOT_DECIDABLE`.

- [ ] **Step 5: Implement the pure domain transition**

```ts
export interface ApplyFactDecisionInput {
  state: RoleState
  artifacts: readonly ArtifactEnvelope[]
  factId: string
  request: FactDecisionRequest
  actorUserId: string
  now: string
  createId: () => string
}

export interface FactDecisionResult {
  state: RoleState
  artifacts: ArtifactEnvelope[]
  active_fact_id: string
  invalidated_artifact_ids: string[]
  audit_action: 'FACT_CONFIRMED' | 'FACT_REVISED' | 'FACT_REJECTED' | null
  audit_metadata: Record<string, unknown>
}

const confirmedAncestorId = (facts: readonly Fact[], target: Fact): string | null => {
  const byId = new Map(facts.map((fact) => [fact.id, fact]))
  const visited = new Set<string>()
  let currentId = target.supersedes_fact_id
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId)
    const current = byId.get(currentId)
    if (!current) return null
    if (current.status === 'CONFIRMED') return current.id
    currentId = current.supersedes_fact_id
  }
  return null
}

export const applyFactDecision = (input: ApplyFactDecisionInput): FactDecisionResult => {
  assertRevision(input.state.revision, input.request.expected_revision)
  const target = input.state.facts.find((fact) => fact.id === input.factId)
  if (!target) throw new DomainError('FACT_NOT_FOUND', '岗位事实不存在', 404)
  if (target.status === 'STALE') throw new DomainError('FACT_NOT_DECIDABLE', '该事实已经失效', 409)
  if (input.request.decision === 'CONFIRM' && target.status === 'CONFIRMED') {
    return { state: input.state, artifacts: [...input.artifacts], active_fact_id: target.id, invalidated_artifact_ids: [], audit_action: null, audit_metadata: {} }
  }
  if (input.request.decision === 'REJECT' && target.status === 'CONFIRMED') {
    throw new DomainError('FACT_NOT_DECIDABLE', '已生效事实只能通过替代版本修改', 409)
  }

  let facts = input.state.facts.map((fact) => ({ ...fact }))
  let activeFact = target
  let auditAction: Exclude<FactDecisionResult['audit_action'], null>
  let invalidate = false
  let supersededConfirmedId: string | null = null

  if (input.request.decision === 'CONFIRM') {
    supersededConfirmedId = confirmedAncestorId(facts, target)
    facts = facts.map((fact) => {
      if (fact.id === supersededConfirmedId) return { ...fact, status: 'STALE' as const, updated_at: input.now }
      if (fact.id === target.id) return { ...fact, status: 'CONFIRMED' as const, confirmed_by_user_id: input.actorUserId, confirmed_at: input.now, updated_at: input.now }
      return fact
    })
    activeFact = facts.find((fact) => fact.id === target.id)!
    auditAction = 'FACT_CONFIRMED'
    invalidate = true
  } else if (input.request.decision === 'REJECT') {
    facts = facts.map((fact) => fact.id === target.id
      ? { ...fact, status: 'STALE' as const, decision_reason: input.request.reason ?? null, updated_at: input.now }
      : fact)
    activeFact = facts.find((fact) => fact.id === target.id)!
    auditAction = 'FACT_REJECTED'
  } else {
    const replacement: Fact = {
      ...target,
      id: input.createId(),
      category: input.request.replacement.category,
      statement: input.request.replacement.statement,
      status: 'DRAFT',
      proposed_by_user_id: input.actorUserId,
      confirmed_by_user_id: null,
      confirmed_at: null,
      supersedes_fact_id: target.id,
      decision_reason: input.request.reason ?? null,
      updated_at: input.now,
    }
    facts = [
      ...facts.map((fact) => fact.id === target.id && target.status !== 'CONFIRMED'
        ? { ...fact, status: 'STALE' as const, updated_at: input.now }
        : fact),
      replacement,
    ]
    activeFact = replacement
    auditAction = 'FACT_REVISED'
  }

  const latestArtifactIds = new Set(Object.values(input.state.latest_artifacts).flatMap((artifact) => artifact?.status === 'CONFIRMED' ? [artifact.id] : []))
  const artifacts = input.artifacts.map((artifact) => invalidate && latestArtifactIds.has(artifact.id)
    ? { ...artifact, status: 'INVALIDATED' as const }
    : { ...artifact })
  const invalidatedIds = artifacts.filter((artifact, index) => artifact.status !== input.artifacts[index]?.status).map((artifact) => artifact.id)
  const latestArtifacts = { ...input.state.latest_artifacts }
  for (const artifact of artifacts.filter((item) => invalidatedIds.includes(item.id))) {
    if (latestArtifacts[artifact.type]?.id === artifact.id) latestArtifacts[artifact.type] = { ...latestArtifacts[artifact.type]!, status: 'INVALIDATED' }
  }
  return {
    state: { ...input.state, facts, latest_artifacts: latestArtifacts, revision: input.state.revision + 1, updated_at: input.now },
    artifacts,
    active_fact_id: activeFact.id,
    invalidated_artifact_ids: invalidatedIds,
    audit_action: auditAction,
    audit_metadata: { source_fact_id: target.id, active_fact_id: activeFact.id, superseded_confirmed_fact_id: supersededConfirmedId },
  }
}
```

Tests pass `createId: () => 'fact-replacement'`; the service passes `createId: randomUUID`.

- [ ] **Step 6: Run package tests and type checks**

Run:

```bash
corepack pnpm --filter @role-clarifier/contracts test
corepack pnpm --filter @role-clarifier/domain test
corepack pnpm --filter @role-clarifier/contracts typecheck
corepack pnpm --filter @role-clarifier/domain typecheck
```

Expected: all commands exit 0.

- [ ] **Step 7: Review and commit Task 1**

```bash
git diff -- packages/contracts/src packages/domain/src
git add packages/contracts/src/index.ts packages/contracts/src/index.test.ts packages/domain/src/fact-decisions.ts packages/domain/src/index.ts packages/domain/src/index.test.ts
git diff --cached --check
git commit -m "feat: define three-closure domain contracts"
```

---

### Task 2: Additive database schema and Mock enterprise knowledge seed

**Files:**
- Create: `server/drizzle/0013_role_clarification_closures.sql`
- Modify: `server/src/db/schema.ts`
- Create: `server/src/store/closure-types.ts`
- Create: `server/src/store/enterprise-knowledge-seed.ts`
- Create: `server/src/store/enterprise-knowledge-seed.test.ts`

**Interfaces:**
- Consumes: `EnterpriseKnowledgeItem` from Task 1.
- Produces: Drizzle tables `enterpriseKnowledgeItems`, `roleClarificationTasks`, `userChannelBindings`, `notificationOutbox`; internal record types shared by both stores.

- [ ] **Step 1: Write a failing seed validation test**

```ts
it('Mock 企业知识覆盖七类数据且不包含候选人个人信息', () => {
  const categories = new Set(demoEnterpriseKnowledge.map((item) => item.category))
  expect(categories).toEqual(new Set([
    'ORGANIZATION', 'JOB_FAMILY', 'LEVEL_FRAMEWORK', 'HISTORICAL_JD',
    'ROLE_PROFILE_CASE', 'RECRUITING_POLICY', 'INTERVIEW_STANDARD',
  ]))
  for (const item of demoEnterpriseKnowledge) {
    expect(item.tenant_id).toBe('tenant-demo')
    expect(detectPII(`${item.title}\n${item.content}\n${item.summary}`)).toEqual([])
  }
})
```

- [ ] **Step 2: Run the seed test and verify failure**

Run: `corepack pnpm --filter @role-clarifier/api test -- enterprise-knowledge-seed.test.ts`

Expected: FAIL because the seed module does not exist.

- [ ] **Step 3: Define focused internal storage records**

```ts
export interface RoleClarificationTaskRecord {
  id: string
  tenant_id: string
  hc_request_id: string
  role_session_id: string | null
  assignee_user_id: string
  status: 'OPEN' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED'
  due_at: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

export interface NotificationOutboxRecord {
  id: string
  tenant_id: string
  task_id: string
  dedupe_key: string
  channel: 'FEISHU'
  recipient_user_id: string
  template: 'HC_CLARIFICATION_ASSIGNED'
  payload: Record<string, unknown>
  status: 'PENDING' | 'PROCESSING' | 'SENT' | 'RETRY' | 'UNBOUND' | 'DEAD'
  attempt_count: number
  next_attempt_at: string
  locked_by: string | null
  locked_until: string | null
  last_error_code: string | null
  sent_at: string | null
  created_at: string
  updated_at: string
}

export interface UserChannelBindingRecord {
  tenant_id: string
  user_id: string
  channel: 'FEISHU'
  recipient_type: 'OPEN_ID'
  recipient_id: string
  status: 'ACTIVE' | 'REVOKED'
  verified_at: string
  updated_at: string
}

export interface ApprovedHcIngestion {
  external_event_channel: 'MOCK_HRIS'
  external_event_id: string
  approval: HcApproval
  task: RoleClarificationTaskRecord
  notification: Omit<NotificationOutboxRecord, 'task_id'>
}

export interface NotificationClaim {
  worker_id: string
  now: string
  locked_until: string
  limit: number
}

export interface FactDecisionCommit {
  role_session_id: string
  tenant_id: string
  expected_revision: number
  state: RoleState
  artifacts: ArtifactEnvelope[]
  decisions: DecisionRecord[]
}
```

- [ ] **Step 4: Add the Drizzle schema and SQL migration**

The migration must use `BEGIN`/`COMMIT`, `CREATE TABLE IF NOT EXISTS`, named checks, and additive indexes. The core DDL is:

```sql
CREATE TABLE IF NOT EXISTS "enterprise_knowledge_items" (
  "id" text PRIMARY KEY,
  "tenant_id" text NOT NULL,
  "category" text NOT NULL,
  "title" text NOT NULL,
  "content" text NOT NULL,
  "summary" text NOT NULL,
  "department" text,
  "job_family" text,
  "tags" text[] NOT NULL DEFAULT '{}',
  "visible_to" text NOT NULL,
  "source_ref" text NOT NULL,
  "source_version" text NOT NULL,
  "status" text NOT NULL,
  "valid_from" timestamptz NOT NULL,
  "valid_to" timestamptz,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("tenant_id", "source_ref", "source_version")
);

CREATE TABLE IF NOT EXISTS "role_clarification_tasks" (
  "id" uuid PRIMARY KEY,
  "tenant_id" text NOT NULL,
  "hc_request_id" text NOT NULL,
  "role_session_id" uuid REFERENCES "role_sessions"("id") ON DELETE SET NULL,
  "assignee_user_id" text NOT NULL REFERENCES "users"("id"),
  "status" text NOT NULL,
  "due_at" timestamptz,
  "started_at" timestamptz,
  "completed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("tenant_id", "hc_request_id")
);

CREATE TABLE IF NOT EXISTS "user_channel_bindings" (
  "tenant_id" text NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id"),
  "channel" text NOT NULL,
  "recipient_type" text NOT NULL,
  "recipient_id" text NOT NULL,
  "status" text NOT NULL,
  "verified_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("tenant_id", "user_id", "channel"),
  CONSTRAINT "user_channel_bindings_channel_check" CHECK ("channel" IN ('FEISHU')),
  CONSTRAINT "user_channel_bindings_recipient_type_check" CHECK ("recipient_type" IN ('OPEN_ID')),
  CONSTRAINT "user_channel_bindings_status_check" CHECK ("status" IN ('ACTIVE', 'REVOKED'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "user_channel_bindings_active_recipient_idx"
  ON "user_channel_bindings" ("tenant_id", "channel", "recipient_id")
  WHERE "status" = 'ACTIVE';

CREATE TABLE IF NOT EXISTS "notification_outbox" (
  "id" uuid PRIMARY KEY,
  "tenant_id" text NOT NULL,
  "task_id" uuid NOT NULL REFERENCES "role_clarification_tasks"("id") ON DELETE CASCADE,
  "dedupe_key" text NOT NULL UNIQUE,
  "channel" text NOT NULL,
  "recipient_user_id" text NOT NULL REFERENCES "users"("id"),
  "template" text NOT NULL,
  "payload" jsonb NOT NULL,
  "status" text NOT NULL,
  "attempt_count" integer NOT NULL DEFAULT 0,
  "next_attempt_at" timestamptz NOT NULL,
  "locked_by" text,
  "locked_until" timestamptz,
  "last_error_code" text,
  "sent_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "notification_outbox_channel_check" CHECK ("channel" IN ('FEISHU')),
  CONSTRAINT "notification_outbox_template_check" CHECK ("template" IN ('HC_CLARIFICATION_ASSIGNED')),
  CONSTRAINT "notification_outbox_status_check" CHECK ("status" IN ('PENDING', 'PROCESSING', 'SENT', 'RETRY', 'UNBOUND', 'DEAD')),
  CONSTRAINT "notification_outbox_attempt_count_check" CHECK ("attempt_count" >= 0)
);

CREATE INDEX IF NOT EXISTS "notification_outbox_due_idx"
  ON "notification_outbox" ("status", "next_attempt_at");
CREATE INDEX IF NOT EXISTS "notification_outbox_recipient_idx"
  ON "notification_outbox" ("recipient_user_id", "status");
```

Add explicit category/visibility/status checks plus indexes `(tenant_id,status,category)`, `(tenant_id,department)`, `(tenant_id,job_family)` and a GIN index on `tags` to `enterprise_knowledge_items`; add the task status check and preserve its `(tenant_id,hc_request_id)` unique key. Mirror every SQL column, default, enum and index in `server/src/db/schema.ts`.

- [ ] **Step 5: Add the shared Mock knowledge seed**

Create these seven validated initial records, all under `tenant-demo` and `source_version: '2026.08'`:

| ID | Category | Title | Scope | `source_ref` |
|---|---|---|---|---|
| `EK-ORG-PRODUCT-001` | `ORGANIZATION` | 企业服务产品部职责 | `ALL_ROLE_MEMBERS` | `mock://organization/product-division` |
| `EK-JOB-PRODUCT-001` | `JOB_FAMILY` | 产品岗位族能力框架 | `ALL_ROLE_MEMBERS` | `mock://job-family/product` |
| `EK-LEVEL-34-001` | `LEVEL_FRAMEWORK` | 3-2 至 4-1 职级要求 | `ALL_ROLE_MEMBERS` | `mock://level/product-3-2-4-1` |
| `EK-JD-PM-001` | `HISTORICAL_JD` | 企业产品经理历史岗位说明 | `ALL_ROLE_MEMBERS` | `mock://historical-jd/enterprise-pm` |
| `EK-ROLE-PM-001` | `ROLE_PROFILE_CASE` | 企业产品经理成功画像案例 | `ALL_ROLE_MEMBERS` | `mock://role-profile/enterprise-pm` |
| `EK-RECRUIT-POLICY-001` | `RECRUITING_POLICY` | 招聘审批与筛选协作规范 | `HR_ONLY` | `mock://recruiting-policy/approved-role` |
| `EK-INTERVIEW-PM-001` | `INTERVIEW_STANDARD` | 产品岗位结构化面试标准 | `ALL_ROLE_MEMBERS` | `mock://interview-standard/product` |

Every `content` and `summary` is Chinese, names the organizational or policy source, and contains no candidate name, résumé, contact detail or interview evaluation. Department-specific product records use `department: '企业服务产品部'` and `job_family: '产品'`; company-wide policy records use null scope fields. Tags include the exact matching terms used by Task 3 tests.

Insert the same records in migration `0013` with `ON CONFLICT (tenant_id,source_ref,source_version) DO NOTHING`. Do not update or delete existing business rows.

- [ ] **Step 6: Run targeted validation**

Run:

```bash
corepack pnpm --filter @role-clarifier/api test -- enterprise-knowledge-seed.test.ts
corepack pnpm --filter @role-clarifier/api typecheck
git diff --check -- server/drizzle/0013_role_clarification_closures.sql server/src/db/schema.ts server/src/store
```

Expected: seed test and typecheck pass; diff check prints nothing.

- [ ] **Step 7: Review and commit Task 2**

Review that the migration contains no `DROP`, destructive `ALTER`, update of existing role data, credential, Open ID or candidate data.

```bash
git add server/drizzle/0013_role_clarification_closures.sql server/src/db/schema.ts server/src/store/closure-types.ts server/src/store/enterprise-knowledge-seed.ts server/src/store/enterprise-knowledge-seed.test.ts
git diff --cached --check
git commit -m "feat: add three-closure persistence schema"
```

---

### Task 3: Enterprise knowledge Store queries and deterministic retriever

**Files:**
- Modify: `server/src/store/types.ts:52-120`
- Modify: `server/src/store/memory-store.ts:1-120`
- Modify: `server/src/store/postgres-store.ts:1-260`
- Create: `server/src/services/enterprise-context-retriever.ts`
- Create: `server/src/services/enterprise-context-retriever.test.ts`

**Interfaces:**
- Consumes: `EnterpriseKnowledgeItem`, `EnterpriseContextBundle`, `HarnessTask`.
- Produces: `ApplicationStore.listEnterpriseKnowledge(input)` and `EnterpriseContextRetriever.retrieve(input): Promise<EnterpriseContextBundle>`.

- [ ] **Step 1: Write failing retriever tests**

```ts
it('经理先经过租户和角色过滤，再按任务与岗位排序', async () => {
  const result = await retriever.retrieve({
    actor: managerActor,
    effective_role: 'MANAGER',
    task: 'GENERATE_ROLE_PROFILE',
    role: roleState,
    message: null,
  })
  expect(result.hits[0]).toMatchObject({
    knowledge_id: 'EK-ROLE-PM-001',
    match_reasons: expect.arrayContaining(['任务类别匹配', '部门一致', '岗位族一致']),
  })
  expect(result.hits.every((hit) => hit.knowledge_id !== 'EK-HR-POLICY-PRIVATE')).toBe(true)
  expect(result.hits).toHaveLength(Math.min(6, result.hits.length))
})

it('跨租户和过期知识在评分前被排除', async () => {
  const result = await retriever.retrieve({ actor: managerActor, effective_role: 'MANAGER', task: 'CLARIFY_MESSAGE', role: roleState, message: '职级和成功标准' })
  expect(result.hits.map((item) => item.knowledge_id)).not.toContain('EK-OTHER-TENANT')
  expect(result.hits.map((item) => item.knowledge_id)).not.toContain('EK-EXPIRED')
})
```

- [ ] **Step 2: Run tests and verify failure**

Run: `corepack pnpm --filter @role-clarifier/api test -- enterprise-context-retriever.test.ts`

Expected: FAIL because the Store query and retriever are absent.

- [ ] **Step 3: Add the minimal Store query to both implementations**

```ts
listEnterpriseKnowledge(input: {
  tenant_id: string
  visible_to: Array<'ALL_ROLE_MEMBERS' | 'HR_ONLY' | 'ADMIN_ONLY'>
  categories: EnterpriseKnowledgeItem['category'][]
  now: string
}): Promise<EnterpriseKnowledgeItem[]>
```

MemoryStore initializes its map from `demoEnterpriseKnowledge`. PostgresStore applies tenant, status, category, visibility, `valid_from <= now`, and `(valid_to IS NULL OR valid_to > now)` in SQL. Neither store applies relevance scoring.

`RetrievalInput.actor.tenant_id` is always the authenticated tenant and `effective_role` is passed from the server-side `PendingRun`; neither value comes from the browser request body. Map visibility as: manager → `ALL_ROLE_MEMBERS`; HR → `ALL_ROLE_MEMBERS + HR_ONLY`; administrator → all three scopes. An administrator testing as manager therefore receives manager-visible enterprise knowledge, not `ADMIN_ONLY` content.

- [ ] **Step 4: Implement deterministic scoring and limits**

```ts
const scoreItem = (item: EnterpriseKnowledgeItem, query: RetrievalInput) => {
  let score = 0
  const reasons: string[] = []
  if (preferredCategories[query.task].includes(item.category)) { score += 30; reasons.push('任务类别匹配') }
  if (item.department && item.department === query.role.department) { score += 25; reasons.push('部门一致') }
  if (item.job_family && item.job_family === query.job_family) { score += 20; reasons.push('岗位族一致') }
  const tagHits = item.tags.filter((tag) => query.query_terms.some((term) => tag.includes(term) || term.includes(tag))).length
  if (tagHits > 0) { score += Math.min(30, tagHits * 10); reasons.push(`标签命中 ${tagHits} 项`) }
  const haystack = `${item.title}\n${item.summary}\n${item.content}`
  const textHits = query.query_terms.filter((term) => term.length >= 2 && haystack.includes(term)).length
  if (textHits > 0) { score += Math.min(20, textHits * 5); reasons.push(`关键词命中 ${textHits} 项`) }
  return { score, reasons }
}
```

Sort by score descending, `updated_at` descending, then `id` ascending. Keep at most 6 hits and stop before the concatenated summaries exceed 4,000 characters. Return `truncated: true` when candidates were excluded by count or character budget.

Construct `query_terms` only from role title, department, job family, confirmed fact statements and the current manager/HR clarification message. Normalize whitespace and punctuation, keep unique 2–24 character terms, sort them with `localeCompare('zh-CN')`, and cap at 20. Never derive terms from candidate imports, candidate evidence or interview evaluation text. The preferred-category map covers `CLARIFY_MESSAGE`, `GENERATE_ROLE_PROFILE`, `GENERATE_ASSESSMENT`, `GENERATE_JD` and `GENERATE_HR_BRIEF`; `EXTRACT_CANDIDATES` and `CALIBRATION_ADVICE` return an empty enterprise bundle without querying candidate content.

- [ ] **Step 5: Run retriever and full API tests**

```bash
corepack pnpm --filter @role-clarifier/api test -- enterprise-context-retriever.test.ts
corepack pnpm --filter @role-clarifier/api test
corepack pnpm --filter @role-clarifier/api typecheck
```

Expected: all pass.

- [ ] **Step 6: Review and commit Task 3**

```bash
git add server/src/store/types.ts server/src/store/memory-store.ts server/src/store/postgres-store.ts server/src/services/enterprise-context-retriever.ts server/src/services/enterprise-context-retriever.test.ts
git diff --cached --check
git commit -m "feat: retrieve tenant-scoped enterprise context"
```

---

### Task 4: Atomic HC approval ingestion, clarification task, and notification Outbox creation

**Files:**
- Modify: `server/src/store/types.ts`
- Modify: `server/src/store/memory-store.ts`
- Modify: `server/src/store/postgres-store.ts`
- Create: `server/src/integrations/mock-hris.ts`
- Create: `server/src/services/hc-event-service.ts`
- Create: `server/src/services/hc-event-service.test.ts`

**Interfaces:**
- Produces: `MockHrisHcApprovedEventSchema`, `ApplicationStore.ingestApprovedHcClosure(input)` and `HcEventService.accept(event)`.
- Consumes: existing `external_event_receipts`, `hc_approvals`; new task and Outbox records from Task 2.

- [ ] **Step 1: Write failing idempotency and rollback tests**

```ts
it('第一次 HC_APPROVED 同时创建审批、任务和一条飞书 Outbox', async () => {
  const first = await service.accept(approvedEvent)
  expect(first).toMatchObject({ accepted: true, duplicate: false })
  expect(await store.getClarificationTaskByHc('tenant-demo', 'HC-NEW-001')).toMatchObject({
    assignee_user_id: 'manager-demo', status: 'OPEN',
  })
  expect(await store.listNotificationsForTest()).toHaveLength(1)
})

it('同一 event_id 重放不重复建任务或通知', async () => {
  await service.accept(approvedEvent)
  const replay = await service.accept(approvedEvent)
  expect(replay.duplicate).toBe(true)
  expect(await store.listNotificationsForTest()).toHaveLength(1)
})

it('不同 event_id 重复上报同一 HC 也不重复业务提醒', async () => {
  await service.accept(approvedEvent)
  await service.accept({ ...approvedEvent, event_id: 'evt-hc-retry-with-new-id' })
  expect(await store.listNotificationsForTest()).toHaveLength(1)
})
```

Also inject a MemoryStore failure before Outbox insertion and assert that approval and task are both absent, matching PostgreSQL transaction semantics.

Add rejection tests for an unknown manager, a manager from another tenant, a non-manager assignee, an unknown/non-HR assigned HR, and disagreement between `hc.request_id`/manager/HR and the duplicate fields inside `hc.context`. None may create an event receipt, HC, task or notification.

- [ ] **Step 2: Run the service test and verify failure**

Run: `corepack pnpm --filter @role-clarifier/api test -- hc-event-service.test.ts`

Expected: FAIL because atomic ingestion is not implemented.

- [ ] **Step 3: Add an atomic Store method**

```ts
ingestApprovedHcClosure(input: {
  external_event_channel: 'MOCK_HRIS'
  external_event_id: string
  approval: HcApproval
  task: RoleClarificationTaskRecord
  notification: Omit<NotificationOutboxRecord, 'task_id'>
}): Promise<{ inserted: boolean }>
```

MemoryStore clones all affected maps before applying writes and restores them on error. PostgresStore uses `this.db.transaction`; it first inserts `external_event_receipts ON CONFLICT DO NOTHING` and returns `{inserted:false}` when no row is returned. For a new event receipt, upsert HC fields without replacing an existing `role_session_id`, insert the task with `ON CONFLICT (tenant_id,hc_request_id) DO NOTHING`, resolve the actual task ID, then insert Outbox with `ON CONFLICT (dedupe_key) DO NOTHING` in the same transaction. Thus both event replay and a second source event ID for the same approved HC remain business-idempotent.

- [ ] **Step 4: Implement HcEventService record construction**

```ts
export const MockHrisHcApprovedEventSchema = z.object({
  event_id: z.string().min(1),
  event_type: z.literal('HC_APPROVED'),
  occurred_at: z.string().datetime(),
  tenant_id: z.string().min(1),
  hc: z.object({
    request_id: z.string().min(1),
    title: z.string().min(1),
    department: z.string().min(1),
    hiring_manager_user_id: z.string().min(1),
    assigned_hr_user_id: z.string().min(1),
    context: HcContextSchema,
  }).strict(),
}).strict()

export type MockHrisHcApprovedEvent = z.infer<typeof MockHrisHcApprovedEventSchema>

export class HcEventService {
  constructor(private readonly store: ApplicationStore, private readonly createId = randomUUID) {}

  async accept(event: MockHrisHcApprovedEvent) {
    const timestamp = event.occurred_at
    const taskId = this.createId()
    const notificationId = this.createId()
    return this.store.ingestApprovedHcClosure({
      external_event_channel: 'MOCK_HRIS',
      external_event_id: event.event_id,
      approval: {
        request_id: event.hc.request_id,
        tenant_id: event.tenant_id,
        title: event.hc.title,
        department: event.hc.department,
        status: 'APPROVED',
        context: event.hc.context,
        role_session_id: null,
        clarification_status: 'NOT_STARTED',
        role_stage: null,
        created_at: timestamp,
        updated_at: timestamp,
      },
      task: {
        id: taskId,
        tenant_id: event.tenant_id,
        hc_request_id: event.hc.request_id,
        role_session_id: null,
        assignee_user_id: event.hc.hiring_manager_user_id,
        status: 'OPEN',
        due_at: null,
        started_at: null,
        completed_at: null,
        created_at: timestamp,
        updated_at: timestamp,
      },
      notification: {
        id: notificationId,
        tenant_id: event.tenant_id,
        dedupe_key: `HC_CLARIFICATION_ASSIGNED:${event.tenant_id}:${event.hc.request_id}:${event.hc.hiring_manager_user_id}`,
        channel: 'FEISHU',
        recipient_user_id: event.hc.hiring_manager_user_id,
        template: 'HC_CLARIFICATION_ASSIGNED',
        payload: {
          hc_request_id: event.hc.request_id,
          title: event.hc.title,
          department: event.hc.department,
          approved_reason: event.hc.context.approved_reason,
        },
        status: 'PENDING',
        attempt_count: 0,
        next_attempt_at: timestamp,
        locked_by: null,
        locked_until: null,
        last_error_code: null,
        sent_at: null,
        created_at: timestamp,
        updated_at: timestamp,
      },
    }).then(({ inserted }) => ({ accepted: true, duplicate: !inserted }))
  }
}
```

Add a schema-level `superRefine` that rejects when `hc.context.request_id`, `hiring_manager_user_id` or `assigned_hr_user_id` differs from the matching `hc` field. Validate once with `MockHrisHcApprovedEventSchema.parse` at the integration boundary. Before building records, `HcEventService` loads both users and requires active same-tenant roles `MANAGER` and `HR`; failure returns `HC_EVENT_MEMBER_INVALID` with 422 and happens before `ingestApprovedHcClosure`. The service always derives `recipient_user_id` from `hiring_manager_user_id`; `assigned_hr_user_id` is retained in HC context but never copied to the notification recipient.

- [ ] **Step 5: Run service tests and typecheck**

```bash
corepack pnpm --filter @role-clarifier/api test -- hc-event-service.test.ts
corepack pnpm --filter @role-clarifier/api typecheck
```

- [ ] **Step 6: Review and commit Task 4**

```bash
git add server/src/store/types.ts server/src/store/memory-store.ts server/src/store/postgres-store.ts server/src/integrations/mock-hris.ts server/src/services/hc-event-service.ts server/src/services/hc-event-service.test.ts
git diff --cached --check
git commit -m "feat: create clarification tasks from HC events"
```

---

### Task 5: Signed Mock HRIS event endpoint

**Files:**
- Modify: `server/src/integrations/mock-hris.ts`
- Create: `server/src/integrations/mock-hris.test.ts`
- Modify: `server/src/config.ts:10-45`
- Modify: `.env.example`
- Modify: `server/src/app.ts:1-370,900-960`
- Modify: `server/src/app.test.ts`

**Interfaces:**
- Consumes: `HcEventService.accept(event)` from Task 4 and `canonicalJson()` from domain.
- Produces: public integration route `POST /api/v1/integrations/mock-hris/hc-events` protected by timestamped HMAC.

- [ ] **Step 1: Write failing signature and route tests**

```ts
it('合法签名接受事件，过期时间戳和错误签名被拒绝', async () => {
  const timestamp = '2026-08-18T02:00:00.000Z'
  const signature = signMockHrisEvent(testSecret, timestamp, approvedEvent)
  const accepted = await app.inject({
    method: 'POST', url: '/api/v1/integrations/mock-hris/hc-events',
    headers: { 'x-hc-event-timestamp': timestamp, 'x-hc-event-signature': signature },
    payload: approvedEvent,
  })
  expect(accepted.statusCode).toBe(202)
  expect(accepted.json()).toEqual({ accepted: true, duplicate: false })

  const rejected = await app.inject({
    method: 'POST', url: '/api/v1/integrations/mock-hris/hc-events',
    headers: { 'x-hc-event-timestamp': timestamp, 'x-hc-event-signature': 'bad' },
    payload: approvedEvent,
  })
  expect(rejected.statusCode).toBe(401)
})
```

- [ ] **Step 2: Run targeted tests and verify failure**

Run: `corepack pnpm --filter @role-clarifier/api test -- mock-hris.test.ts app.test.ts`

Expected: FAIL because config, signer and route do not exist.

- [ ] **Step 3: Add strict event parsing and HMAC verification**

```ts
export const signMockHrisEvent = (secret: string, timestamp: string, body: unknown): string =>
  createHmac('sha256', secret)
    .update(`${timestamp}.${canonicalJson(body)}`)
    .digest('hex')

export const verifyMockHrisEvent = (input: {
  secret: string; timestamp: string; signature: string; body: unknown; nowMs: number; maxSkewSeconds: number
}) => {
  const eventMs = Date.parse(input.timestamp)
  if (!Number.isFinite(eventMs) || Math.abs(input.nowMs - eventMs) > input.maxSkewSeconds * 1_000) {
    throw new DomainError('HC_EVENT_EXPIRED', 'HC 事件时间戳无效或已过期', 401)
  }
  const expected = signMockHrisEvent(input.secret, input.timestamp, input.body)
  if (expected.length !== input.signature.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(input.signature))) {
    throw new DomainError('HC_EVENT_UNAUTHORIZED', 'HC 事件签名无效', 401)
  }
  return MockHrisHcApprovedEventSchema.parse(input.body)
}
```

The Zod schema must require `event_type: 'HC_APPROVED'`, matching `tenant_id`, `hc.request_id`, `hc.context.request_id`, manager ID, approved timestamp and full `HcContext`.

- [ ] **Step 4: Register config and unauthenticated integration route safely**

Add:

```ts
HC_EVENT_SECRET: z.string().min(32).optional(),
HC_EVENT_MAX_SKEW_SECONDS: z.coerce.number().int().min(30).max(900).default(300),
```

Only exempt the exact Mock HRIS path from Cookie auth. Return `503 HC_EVENT_NOT_CONFIGURED` when the secret is absent and never log the signature or secret. Add the route to OpenAPI.

- [ ] **Step 5: Run API tests and typecheck**

```bash
corepack pnpm --filter @role-clarifier/api test -- mock-hris.test.ts app.test.ts
corepack pnpm --filter @role-clarifier/api typecheck
```

- [ ] **Step 6: Review and commit Task 5**

```bash
git add .env.example server/src/config.ts server/src/integrations/mock-hris.ts server/src/integrations/mock-hris.test.ts server/src/app.ts server/src/app.test.ts
git diff --cached --check
git commit -m "feat: receive signed HC approval events"
```

---

### Task 6: Proactive Feishu delivery, identity binding, and Outbox dispatcher

**Files:**
- Modify: `server/src/store/types.ts`
- Modify: `server/src/store/memory-store.ts`
- Modify: `server/src/store/postgres-store.ts`
- Modify: `server/src/integrations/feishu.ts:55-145,243-430`
- Create: `server/src/services/notification-outbox-dispatcher.ts`
- Create: `server/src/services/notification-outbox-dispatcher.test.ts`
- Modify: `server/src/config.ts`
- Modify: `server/src/app.ts:105-235,960-975`
- Modify: `server/src/app.test.ts:500-610`

**Interfaces:**
- Produces: `FeishuClientLike.sendCardToOpenId()`, binding Store methods, Outbox claim/result methods, `NotificationOutboxDispatcher.start()/stop()/dispatchOnce()`.
- Consumes: task Outbox from Task 4 and current `FEISHU_USER_MAPPINGS_JSON`.

- [ ] **Step 1: Write failing dispatcher tests with a fake clock and sender**

```ts
it('有绑定时按 open_id 发送并标记 SENT', async () => {
  await store.upsertUserChannelBinding(activeBinding)
  const dispatcher = new NotificationOutboxDispatcher(store, fakeSender, config, fakeClock)
  await dispatcher.dispatchOnce()
  expect(fakeSender.cards).toEqual([{ openId: 'ou_manager_demo', template: 'HC_CLARIFICATION_ASSIGNED' }])
  expect((await store.getNotification(notificationId))?.status).toBe('SENT')
})

it('无绑定标记 UNBOUND，技术失败依次在 1/5/30 分钟后重试并最终 DEAD', async () => {
  await dispatcher.dispatchOnce()
  expect((await store.getNotification(notificationId))?.status).toBe('UNBOUND')
  await store.upsertUserChannelBinding(activeBinding)
  await store.requeueUnboundNotificationsForUser('tenant-demo', 'manager-demo', fakeClock.now())
  fakeSender.failWith('FEISHU_RATE_LIMITED')
  await dispatchThroughAllRetries(dispatcher, fakeClock)
  expect((await store.getNotification(notificationId))?.status).toBe('DEAD')
})
```

- [ ] **Step 2: Run dispatcher tests and verify failure**

Run: `corepack pnpm --filter @role-clarifier/api test -- notification-outbox-dispatcher.test.ts`

- [ ] **Step 3: Implement lease-based Store methods**

```ts
claimDueNotifications(input: { worker_id: string; now: string; locked_until: string; limit: number }): Promise<NotificationOutboxRecord[]>
getUserChannelBinding(tenantId: string, userId: string, channel: 'FEISHU'): Promise<UserChannelBindingRecord | null>
upsertUserChannelBinding(binding: UserChannelBindingRecord): Promise<void>
requeueUnboundNotificationsForUser(tenantId: string, userId: string, nextAttemptAt: string): Promise<number>
markNotificationSent(id: string, workerId: string, sentAt: string): Promise<void>
markNotificationRetry(input: NotificationRetryUpdate): Promise<void>
markNotificationUnbound(id: string, workerId: string, updatedAt: string): Promise<void>
markNotificationDead(input: NotificationFailureUpdate): Promise<void>
```

Postgres claim must use one transaction and `FOR UPDATE SKIP LOCKED`; it can reclaim `PROCESSING` records whose `locked_until` is earlier than `now`. Every result update must include `locked_by = worker_id` in its predicate.

- [ ] **Step 4: Extend Feishu client and identity mapping**

```ts
export interface FeishuClientLike {
  configured(): boolean
  sendText?(chatId: string, text: string): Promise<void>
  sendCard(chatId: string, card: FeishuCard): Promise<void>
  sendCardToOpenId(openId: string, card: FeishuCard): Promise<void>
}
```

`FeishuOpenApiClient.sendCardToOpenId` calls `/im/v1/messages?receive_id_type=open_id`. Make `actorFor(openId)` asynchronous: when a configured mapping exists, load the actual stored Web user by `account_id`, verify the user is active, then upsert an `ACTIVE` binding. Keep the existing isolated fallback only for inbound unmapped conversations; never use it for proactive delivery.

Add `FeishuGateway.initializeBindings()` and call it during `buildApp`. It syncs only mappings whose `account_id` resolves to an existing user, and does not log Open IDs.

- [ ] **Step 5: Implement dispatcher lifecycle and retry schedule**

```ts
const RETRY_DELAYS_MS = [60_000, 300_000, 1_800_000] as const

export class NotificationOutboxDispatcher {
  private timer: ReturnType<typeof setInterval> | null = null
  start() { if (!this.timer) this.timer = setInterval(() => void this.dispatchOnce(), this.config.NOTIFICATION_POLL_INTERVAL_MS) }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null }
  async dispatchOnce() {
    const now = this.clock.now()
    const lockedUntil = new Date(Date.parse(now) + this.config.NOTIFICATION_LEASE_MS).toISOString()
    const items = await this.store.claimDueNotifications({
      worker_id: this.workerId,
      now,
      locked_until: lockedUntil,
      limit: this.config.NOTIFICATION_BATCH_SIZE,
    })
    for (const item of items) {
      const binding = await this.store.getUserChannelBinding(item.tenant_id, item.recipient_user_id, 'FEISHU')
      if (!binding || binding.status !== 'ACTIVE') {
        await this.store.markNotificationUnbound(item.id, this.workerId, now)
        continue
      }
      try {
        await this.sender.sendCardToOpenId(binding.recipient_id, buildHcClarificationCard(item.payload, this.config.WEB_ORIGIN))
        await this.store.markNotificationSent(item.id, this.workerId, now)
      } catch (error) {
        const code = deliveryErrorCode(error)
        if (item.attempt_count >= 4) {
          await this.store.markNotificationDead({ id: item.id, worker_id: this.workerId, error_code: code, updated_at: now })
        } else {
          const nextAttemptAt = new Date(Date.parse(now) + RETRY_DELAYS_MS[item.attempt_count - 1]!).toISOString()
          await this.store.markNotificationRetry({ id: item.id, worker_id: this.workerId, error_code: code, next_attempt_at: nextAttemptAt, updated_at: now })
        }
      }
    }
  }
}
```

`claimDueNotifications` increments `attempt_count` while it changes the record to `PROCESSING`, so values 1–3 index the three delays and value 4 moves to `DEAD`. Implement `deliveryErrorCode` as a whitelist (`FEISHU_RATE_LIMITED`, `FEISHU_AUTH_FAILED`, `FEISHU_UNAVAILABLE`, `UNKNOWN_DELIVERY_ERROR`) and never persist raw response bodies. `buildHcClarificationCard` reads only `title`, `department`, `hc_request_id` and the first 120 characters of `approved_reason`; its button URL is `WEB_ORIGIN`, so login and the existing HC page remain the authorization boundary without adding frontend routing.

Add explicit config: `NOTIFICATION_DISPATCH_ENABLED=false`, `NOTIFICATION_POLL_INTERVAL_MS=5000`, `NOTIFICATION_BATCH_SIZE=20`, `NOTIFICATION_LEASE_MS=30000`. Start only when enabled; stop before Store close. One business reminder is sent; retries only address technical delivery failure.

- [ ] **Step 6: Run Feishu and dispatcher tests**

```bash
corepack pnpm --filter @role-clarifier/api test -- notification-outbox-dispatcher.test.ts app.test.ts
corepack pnpm --filter @role-clarifier/api typecheck
```

- [ ] **Step 7: Review and commit Task 6**

Review for Open ID leakage, infinite timers in tests, expired leases, multi-instance duplicates and accidental HR notification.

```bash
git add server/src/store/types.ts server/src/store/memory-store.ts server/src/store/postgres-store.ts server/src/integrations/feishu.ts server/src/services/notification-outbox-dispatcher.ts server/src/services/notification-outbox-dispatcher.test.ts server/src/config.ts server/src/app.ts server/src/app.test.ts
git diff --cached --check
git commit -m "feat: deliver proactive HC reminders through Feishu"
```

---

### Task 7: Clarification task lifecycle and HC response summaries

**Files:**
- Modify: `server/src/store/types.ts`
- Modify: `server/src/store/memory-store.ts`
- Modify: `server/src/store/postgres-store.ts`
- Modify: `server/src/services/role-service.ts:60-175,540-600`
- Modify: `server/src/app.test.ts`

**Interfaces:**
- Produces: atomic `createRoleAggregateForHc()` result `{roleSessionId,created}`, HC task/notification summaries, automatic task completion on `PROFILE_CONFIRMED`.
- Consumes: task and Outbox tables, existing `openApprovedHc()` and `confirmArtifact()`.

- [ ] **Step 1: Write failing lifecycle tests**

```ts
it('HC 状态从待澄清到已提醒、进行中并在画像确认后完成', async () => {
  expect((await listApprovals()).items[0].clarification_task.status).toBe('OPEN')
  expect((await listApprovals()).items[0].notification_delivery.status).toBe('SENT')
  const workspace = await openWorkspace()
  expect(workspace.statusCode).toBe(201)
  expect((await listApprovals()).items[0].clarification_task.status).toBe('IN_PROGRESS')
  await confirmRoleProfile(workspace.json().role.state.id)
  expect((await listApprovals()).items[0].clarification_task.status).toBe('COMPLETED')
})

it('重复进入同一 HC 不重复创建岗位、任务或首问', async () => {
  const first = await openWorkspace()
  const second = await openWorkspace()
  expect(second.json().role.state.id).toBe(first.json().role.state.id)
  expect((await listMessages(first.json().role.state.id)).items).toHaveLength(1)
})

it('升级前已经绑定岗位的 OPEN 任务在再次进入时补为进行中', async () => {
  await seedPrelinkedHcWithOpenTask()
  await openWorkspace()
  expect((await listApprovals()).items[0].clarification_task.status).toBe('IN_PROGRESS')
})
```

- [ ] **Step 2: Run app tests and verify failure**

Run: `corepack pnpm --filter @role-clarifier/api test -- app.test.ts`

- [ ] **Step 3: Make workspace binding and task start atomic**

Change the Store signature to:

```ts
createRoleAggregateForHc(
  hcRequestId: string,
  aggregate: RoleAggregate,
): Promise<{ roleSessionId: string; created: boolean }>
```

In PostgresStore, insert the aggregate, bind `hc_approvals.role_session_id`, and update the unique task to `IN_PROGRESS` with `role_session_id` and `started_at` in one transaction. In MemoryStore, apply the same state change before returning. RoleService uses the returned `created` boolean and keeps `ensureHcOpeningQuestion` idempotent.

Add this idempotent compatibility method for HC rows that already had a workspace before the migration:

```ts
startClarificationTaskForExistingWorkspace(input: {
  tenant_id: string
  hc_request_id: string
  role_session_id: string
  started_at: string
}): Promise<void>
```

`RoleService.openApprovedHc` calls it before returning the pre-linked workspace. Both Store implementations update only `OPEN`; they leave `IN_PROGRESS`, `COMPLETED` and `CANCELLED` unchanged, so reopening cannot regress task state.

- [ ] **Step 4: Return task and notification summaries from existing HC list**

Join task by `(tenant_id,request_id)` and its notification by `notification_outbox.task_id`, returning:

```ts
clarification_task: task ? {
  id: task.id, status: task.status, assignee_user_id: task.assignee_user_id,
  started_at: task.started_at, completed_at: task.completed_at,
} : null,
notification_delivery: notification ? {
  channel: 'FEISHU', status: notification.status,
  sent_at: notification.sent_at, last_error_code: notification.last_error_code,
} : null,
```

Do not expose Open ID, locks, attempt payload or full Feishu errors.

- [ ] **Step 5: Complete the task when the role profile state becomes confirmed**

Update both Store implementations so the successful `saveRoleState` transaction also sets the linked task to `COMPLETED` when `state.stage === 'PROFILE_CONFIRMED'`. The Postgres update occurs in the same transaction as the Revision-protected role update. Later artifact stages must not reopen the completed task.

- [ ] **Step 6: Run lifecycle regression tests**

```bash
corepack pnpm --filter @role-clarifier/api test -- app.test.ts
corepack pnpm --filter @role-clarifier/api typecheck
```

- [ ] **Step 7: Review and commit Task 7**

```bash
git add server/src/store/types.ts server/src/store/memory-store.ts server/src/store/postgres-store.ts server/src/services/role-service.ts server/src/app.test.ts
git diff --cached --check
git commit -m "feat: track HC clarification task lifecycle"
```

---

### Task 8: Inject retrieved enterprise context into Harness and Trace

**Files:**
- Modify: `server/src/agent/harness-adapter.ts:1-45`
- Modify: `server/src/agent/runner.ts:20-380`
- Modify: `server/src/app.ts:190-225`
- Modify: `server/src/config.ts`
- Modify: `.env.example`
- Modify: `server/src/app.test.ts:700-810`
- Modify: `harness-sidecar/src/schemas.ts:1-55`
- Modify: `harness-sidecar/src/prompts.ts:1-180`
- Modify: `harness-sidecar/src/app.test.ts:55-115`

**Interfaces:**
- Consumes: `EnterpriseContextRetriever.retrieve()` from Task 3.
- Produces: `HarnessRequest.enterprise_context`, `AgentContextSnapshot.long_term_memory.enterprise_context`, `context.retrieval_failed` trace event.

- [ ] **Step 1: Write failing Runner and Sidecar tests**

```ts
it('Agent Run 只把检索命中摘要与来源注入 Harness', async () => {
  await submitManagerMessage('这个岗位半年成功标准是什么')
  expect(capturedHarnessRequest.enterprise_context.hits[0]).toMatchObject({
    knowledge_id: 'EK-ROLE-PM-001', source_ref: 'mock://role-profile/enterprise-pm',
  })
  expect(JSON.stringify(capturedHarnessRequest.enterprise_context)).not.toContain('候选人')
})

it('检索失败时记录事件并使用空上下文继续 Run', async () => {
  retriever.failWith(new Error('database unavailable'))
  const run = await submitManagerMessage('继续澄清')
  expect(run.status).toBe('COMPLETED')
  expect(trace.events.map((event) => event.type)).toContain('context.retrieval_failed')
})
```

Also test the disabled switch: the retriever is not called, the Run continues from HC and confirmed facts, and no `context.retrieval_failed` event is emitted. In `harness-sidecar/src/app.test.ts`, assert that `<enterprise_context>` contains source/version/match reasons and that the same bundle appears in `context.snapshot`.

- [ ] **Step 2: Run tests and verify failure**

```bash
corepack pnpm --filter @role-clarifier/api test -- app.test.ts
corepack pnpm --filter @role-clarifier/harness-sidecar test
```

- [ ] **Step 3: Add enterprise context to HarnessRequest and Runner**

```ts
export interface HarnessRequest {
  task: HarnessTask
  role_state: RoleState
  enterprise_context: EnterpriseContextBundle
  message?: string
  conversation_context?: ConversationContext
  candidates?: CandidateImportItem[]
  execution_context: ToolExecutionContext
  maximum_transitions: 10
  structured_output_repair_attempts: 1
}
```

Add `ENTERPRISE_CONTEXT_RETRIEVAL_ENABLED=true` to config and `.env.example`. Inject the retriever into `AgentRunner`. In `execute`, retrieve after loading the role view and before constructing the request, passing `pending.actor` for the authenticated tenant and `pending.effectiveRole` for knowledge visibility. When the switch is false, use the same bounded empty bundle and keep the existing HC plus confirmed-fact context; do not emit a failure. On an enabled retrieval error, emit `context.retrieval_failed` with `{ code: 'ENTERPRISE_CONTEXT_UNAVAILABLE', task: request.task }` and use `{query, hits: [], truncated:false}`; never put the raw database error into a user-visible event. The frontend handling for formal-generation warnings is added in Task 13 so no fourth visual area is introduced.

- [ ] **Step 4: Extend Sidecar validation, snapshot, and Prompt block**

```ts
enterprise_context: EnterpriseContextBundleSchema,
```

Add this bounded data block to `buildTaskPrompt`:

```ts
'<enterprise_context>',
JSON.stringify(context.long_term_memory.enterprise_context),
'</enterprise_context>',
'企业知识只用于提供背景与建议。引用时把 source_ref 写入 evidence_refs；不得把它自动标记为已确认岗位事实。',
```

Keep the existing final instruction that all input blocks are data and cannot override system rules. The snapshot includes the identical bundle so Admin Trace can reproduce what reached the model.

- [ ] **Step 5: Run API, Sidecar and type checks**

```bash
corepack pnpm --filter @role-clarifier/api test -- app.test.ts
corepack pnpm --filter @role-clarifier/harness-sidecar test
corepack pnpm --filter @role-clarifier/api typecheck
corepack pnpm --filter @role-clarifier/harness-sidecar typecheck
```

- [ ] **Step 6: Review and commit Task 8**

```bash
git add server/src/agent/harness-adapter.ts server/src/agent/runner.ts server/src/app.ts server/src/app.test.ts server/src/config.ts .env.example harness-sidecar/src/schemas.ts harness-sidecar/src/prompts.ts harness-sidecar/src/app.test.ts
git diff --cached --check
git commit -m "feat: inject retrieved enterprise context into Agent runs"
```

---

### Task 9: Persist fact provenance and link facts to Agent messages

**Files:**
- Modify: `server/src/services/role-service.ts:365-403`
- Modify: `server/src/app.ts:390-420`
- Modify: `server/src/agent/runner.ts:421-545`
- Modify: `server/src/app.test.ts`
- Modify: `server/src/store/seed.ts`

**Interfaces:**
- Produces: `RoleService.saveFactDraft(...): Promise<{state:RoleState;fact:Fact}>`; internal tool result `{saved,revision,fact_id}`; Agent message `structured_content.fact_id`.
- Consumes: extended `Fact` contract from Task 1 and active Run metadata.

- [ ] **Step 1: Write failing provenance tests**

```ts
it('save_fact_draft 记录消息、Run 和提出人并把 fact_id 写入 Agent 消息', async () => {
  const run = await submitManagerMessage('入职 90 天完成产品路线图')
  const detail = await getRoleDetail(run.role_session_id)
  const fact = detail.state.facts.find((item) => item.source_run_id === run.id)
  expect(fact).toMatchObject({
    source_message_id: run.input_message_id,
    proposed_by_user_id: 'manager-demo',
    status: 'DRAFT',
  })
  const output = await getMessage(run.output_message_id)
  expect(output.structured_content.fact_id).toBe(fact.id)
})
```

Also test tool-persisted and caller-persisted recovery paths do not create two facts. Add a regression where `save_fact_draft` succeeds but the Harness final payload fails schema validation: the recovery message must still contain the persisted `fact_id`, and refreshing the conversation must still render exactly one recoverable fact card.

- [ ] **Step 2: Run app tests and verify failure**

Run: `corepack pnpm --filter @role-clarifier/api test -- app.test.ts`

- [ ] **Step 3: Change saveFactDraft to return the created fact with provenance**

```ts
async saveFactDraft(
  roleSessionId: string,
  actor: ActorContext,
  input: {
    statement: string
    category: FactCategory
    source_message_id: string | null
    source_run_id: string
    proposed_by_user_id: string
    evidence_refs?: string[]
  },
): Promise<{ state: RoleState; fact: Fact }>
```

Set `source` to `Agent 从本轮对话提取，待人工确认`, initialize decision fields to null, and return the exact appended fact.

- [ ] **Step 4: Return fact_id from the internal tool and persist it in Agent output**

The internal `save_fact_draft` route uses `activeRun.run.input_message_id`, `activeRun.run.id`, and `activeRun.run.actor_user_id`. Return `{saved:true,revision,fact_id}`.

For tool persistence, `AgentRunner.persistHarnessResult` reloads the role state and finds the fact by `source_run_id === run.id`. For caller persistence, use the fact returned by `saveFactDraft`. Add `fact_id`, `fact_category`, and `fact_status: 'DRAFT'` to both `CLARIFICATION` and `CLARIFICATION_LIMIT` structured content.

- [ ] **Step 5: Backfill in-memory seed defaults without changing historical meaning**

Update seed Fact objects with null provenance/decision fields and keep current IDs, statements, evidence and statuses unchanged.

- [ ] **Step 6: Run API regression tests**

```bash
corepack pnpm --filter @role-clarifier/api test
corepack pnpm --filter @role-clarifier/api typecheck
```

- [ ] **Step 7: Review and commit Task 9**

```bash
git add server/src/services/role-service.ts server/src/app.ts server/src/agent/runner.ts server/src/app.test.ts server/src/store/seed.ts
git diff --cached --check
git commit -m "feat: trace Agent fact drafts to source messages"
```

---

### Task 10: Atomic fact decision API, generation gate, and artifact invalidation

**Files:**
- Modify: `server/src/store/types.ts`
- Modify: `server/src/store/memory-store.ts`
- Modify: `server/src/store/postgres-store.ts`
- Create: `server/src/services/fact-decision-service.ts`
- Create: `server/src/services/fact-decision-service.test.ts`
- Modify: `server/src/services/role-service.ts:404-465`
- Modify: `server/src/app.ts:620-655,920-950`
- Modify: `server/src/app.test.ts`

**Interfaces:**
- Produces: `FactDecisionService.decide()`, `ApplicationStore.commitFactDecision()`, `POST /api/v1/role-sessions/:id/facts/:fact_id:decide`.
- Consumes: `applyFactDecision()` from Task 1 and fact provenance from Task 9.

- [ ] **Step 1: Write failing service tests for permission, concurrency, and invalidation**

```ts
it('经理确认事实并在一个提交中更新事实、产物和审计', async () => {
  const result = await service.decide(roleId, factId, managerActor, managerActor, {
    decision: 'CONFIRM', expected_revision: 4,
  })
  expect(result.state.facts.find((fact) => fact.id === factId)?.status).toBe('CONFIRMED')
  expect(result.state.latest_artifacts.ROLE_PROFILE?.status).toBe('INVALIDATED')
  expect(await store.listDecisionsForTest()).toContainEqual(expect.objectContaining({ action: 'FACT_CONFIRMED' }))
  expect(await store.listDecisionsForTest()).toContainEqual(expect.objectContaining({ action: 'ARTIFACTS_INVALIDATED_BY_FACT' }))
})

it('HR、跨租户和旧 Revision 不能改变事实', async () => {
  await expect(service.decide(roleId, factId, hrActor, hrActor, confirmRequest)).rejects.toMatchObject({ code: 'FORBIDDEN' })
  await expect(service.decide(roleId, factId, otherTenantActor, otherTenantActor, confirmRequest)).rejects.toMatchObject({ code: 'ROLE_SESSION_NOT_FOUND' })
  await expect(service.decide(roleId, factId, managerActor, managerActor, { ...confirmRequest, expected_revision: 1 })).rejects.toMatchObject({ code: 'REVISION_CONFLICT' })
})
```

- [ ] **Step 2: Run service tests and verify failure**

Run: `corepack pnpm --filter @role-clarifier/api test -- fact-decision-service.test.ts`

- [ ] **Step 3: Add atomic fact decision persistence**

```ts
commitFactDecision(input: {
  role_session_id: string
  tenant_id: string
  expected_revision: number
  state: RoleState
  artifacts: ArtifactEnvelope[]
  decisions: DecisionRecord[]
}): Promise<boolean>
```

PostgresStore transaction must Revision-update the tenant-scoped role row, update only changed latest-artifact statuses, and append every supplied `decision_logs` row; if the role update affects zero rows, roll back and return false. MemoryStore checks tenant and Revision before replacing state, artifacts and the decision array as one cloned unit.

- [ ] **Step 4: Implement service authorization and idempotency**

```ts
async decide(
  roleSessionId: string,
  factId: string,
  actualActor: ActorContext,
  effectiveActor: ActorContext,
  request: FactDecisionRequest,
): Promise<{ state: RoleState; fact: Fact; invalidated_artifact_ids: string[] }>
```

Require effective role `MANAGER`; a real administrator may act only after existing `resolveTestActor` resolves `test_role: 'MANAGER'`. Preserve actual actor in `actor_user_id` and store `actual_actor_role` plus `effective_actor_role` in audit metadata. Build one fact decision record and, when `invalidated_artifact_ids` is non-empty, a second `ARTIFACTS_INVALIDATED_BY_FACT` record containing the active fact ID, superseded confirmed fact ID and invalidated artifact IDs. Return current state without duplicate audit when the exact same final decision is repeated. Map a failed atomic commit to `REVISION_CONFLICT`.

- [ ] **Step 5: Add route and generation gate**

Register:

```http
POST /api/v1/role-sessions/:id/facts/:fact_id:decide
```

Parse `FactDecisionRequestSchema`, resolve admin test role with existing `resolveTestActor`, and return `{state,fact,invalidated_artifact_ids}`.

Keep the existing `POST /api/v1/role-sessions/:id/facts:confirm` for short frontend/backend rollback compatibility, but remove its direct `RoleService.confirmFacts` write path. Route it through `FactDecisionService.confirmBatch`, extend its strict body with optional `test_role`, and require the same effective `MANAGER` permission. `confirmBatch` validates all IDs before mutation, applies confirmations in memory, sets the final Revision to `expected_revision + 1`, invalidates latest referenced artifacts once, builds one `FACT_CONFIRMED` decision per changed fact plus at most one `ARTIFACTS_INVALIDATED_BY_FACT` decision, and calls `commitFactDecision` once. Any missing, stale or cross-tenant ID rejects the whole batch without partial state.

In `RoleService.assertArtifactGenerationAllowed`, before `ROLE_PROFILE` generation, collect visible `DRAFT` and `CONFLICTED` fact IDs. Throw:

```ts
new DomainError('UNRESOLVED_FACTS_PENDING', `还有 ${pending.length} 条岗位事实待确认`, 409, {
  fact_ids: pending.map((fact) => fact.id),
  count: pending.length,
})
```

Extend the existing error without changing callers that use three arguments:

```ts
export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'DomainError'
  }
}
```

The Fastify handler returns `error: {code,message,...(details ? {details} : {}),request_id}`. Add a handler test for both a legacy three-argument error and `UNRESOLVED_FACTS_PENDING`; never include hidden fact text in details.

- [ ] **Step 6: Add API integration tests**

Test manager confirm/revise/reject; HR 403; administrator without test role 403; admin `test_role: MANAGER`; normal user cannot spoof `test_role`; missing/cross-tenant fact 404; stale fact 409; Revision conflict; pending generation 409; confirmed generation 202; invalidated role profile and all downstream latest artifacts. Add legacy batch tests proving one Revision increment, no partial write on one invalid ID, identical audit/invalidation behavior, and old manager requests without `test_role` remain accepted.

- [ ] **Step 7: Run API, domain, and full server tests**

```bash
corepack pnpm --filter @role-clarifier/domain test
corepack pnpm --filter @role-clarifier/api test -- fact-decision-service.test.ts app.test.ts
corepack pnpm --filter @role-clarifier/api typecheck
```

- [ ] **Step 8: Review and commit Task 10**

```bash
git add packages/domain/src server/src/store/types.ts server/src/store/memory-store.ts server/src/store/postgres-store.ts server/src/services/fact-decision-service.ts server/src/services/fact-decision-service.test.ts server/src/services/role-service.ts server/src/app.ts server/src/app.test.ts
git diff --cached --check
git commit -m "feat: confirm role facts and invalidate stale outputs"
```

---

### Task 11: Frontend small change 1 — HC task status label

**Files:**
- Create: `frontend/src/hc-progress.js`
- Create: `frontend/src/hc-progress.test.js`
- Modify: `frontend/src/components/HcApprovalLanding.jsx:15-30,105-145`
- Modify: `frontend/src/styles.css:1970-2050,2110-2130`
- Modify: `frontend/package.json`

**Interfaces:**
- Consumes: `HcApproval.clarification_task` and `.notification_delivery`.
- Produces: `hcProgress(hc)` returning `{status,action,tone}` without altering card structure.

- [ ] **Step 1: Write failing pure-function tests**

```js
test('HC 小状态只显示待澄清、已提醒、进行中，完成后复用画像状态', () => {
  assert.equal(hcProgress(hc({ task: 'OPEN', delivery: 'PENDING' })).status, '待澄清')
  assert.equal(hcProgress(hc({ task: 'OPEN', delivery: 'SENT' })).status, '已提醒')
  assert.equal(hcProgress(hc({ task: 'IN_PROGRESS', delivery: 'SENT' })).status, '进行中')
  assert.equal(hcProgress(hc({ task: 'COMPLETED', roleStage: 'PROFILE_CONFIRMED' })).status, '画像已确认')
})
```

- [ ] **Step 2: Add the test to frontend/package.json and verify failure**

Set the test script to run `node --test src/hc-progress.test.js src/fact-decision.test.js src/profile-content.test.js src/assessment-content.test.js src/public-jd-content.test.js` after Task 12 creates the second file. Until Task 12, list only existing files plus `hc-progress.test.js`.

Run: `corepack pnpm --filter @role-clarifier/web test`

Expected: FAIL because `hcProgress` has not been extracted.

- [ ] **Step 3: Extract the current helper and add new mappings**

```js
export const hcProgress = (hc) => {
  if (hc.clarification_task?.status === 'IN_PROGRESS') return { status: '进行中', action: '进入原会话', tone: 'continue' }
  if (hc.clarification_task?.status === 'OPEN') {
    return hc.notification_delivery?.status === 'SENT'
      ? { status: '已提醒', action: '开始澄清', tone: 'reminded' }
      : { status: '待澄清', action: '开始澄清', tone: 'new' }
  }
  if (hc.clarification_status === 'PROFILE_READY') {
    return { status: hc.role_stage === 'PROFILE_DRAFT' ? '画像待确认' : '画像已确认', action: '查看并继续', tone: 'ready' }
  }
  return { status: '待澄清', action: '开始澄清', tone: 'new' }
}
```

Import it in `HcApprovalLanding.jsx`; do not change the card markup, click behavior, list layout, sidebar or header.

- [ ] **Step 4: Add one local style tone without changing dimensions**

Add `.hc-choice-action.reminded strong { color: #0d78a8; }`. Preserve current grid columns, card padding and responsive breakpoint.

- [ ] **Step 5: Run frontend tests and build**

```bash
corepack pnpm --filter @role-clarifier/web test
corepack pnpm --filter @role-clarifier/web build
```

- [ ] **Step 6: Review and commit Task 11**

```bash
git add frontend/src/hc-progress.js frontend/src/hc-progress.test.js frontend/src/components/HcApprovalLanding.jsx frontend/src/styles.css frontend/package.json
git diff --cached --check
git commit -m "feat: show HC clarification task status"
```

---

### Task 12: Frontend small change 2 — inline fact confirmation card

**Files:**
- Create: `frontend/src/fact-decision.js`
- Create: `frontend/src/fact-decision.test.js`
- Create: `frontend/src/components/FactDecisionCard.jsx`
- Modify: `frontend/src/api/client.js:35-125`
- Modify: `frontend/src/App.jsx:150-525,920-1015`
- Modify: `frontend/src/styles.css`
- Modify: `frontend/package.json`

**Interfaces:**
- Consumes: Agent message `structured_content.fact_id`, `RoleState.facts`, actor/effective role and Task 10 endpoint.
- Produces: `api.decideFact()`, `FactDecisionCard`, pure helpers `factStatusLabel`, `canDecideFact`, `pendingFacts`.

- [ ] **Step 1: Write failing helper tests**

```js
test('HR 只读，经理和管理员有效经理角色可以处理待确认事实', () => {
  assert.equal(canDecideFact('HR', draftFact), false)
  assert.equal(canDecideFact('MANAGER', draftFact), true)
  assert.equal(canDecideFact('MANAGER', staleFact), false)
})

test('只有 DRAFT 和 CONFLICTED 计入待处理数量', () => {
  assert.deepEqual(pendingFacts([draftFact, conflictedFact, confirmedFact, staleFact]).map((fact) => fact.id), ['draft', 'conflicted'])
})

test('消息始终解析到同一来源链上最新可操作的事实版本', () => {
  assert.equal(factForMessage([confirmedOriginal, staleDraft, newestDraft], 'fact-original')?.id, 'fact-newest')
})
```

- [ ] **Step 2: Run frontend tests and verify failure**

Run: `corepack pnpm --filter @role-clarifier/web test`

- [ ] **Step 3: Add the API client method**

```js
decideFact(id, factId, payload) {
  return request(`/api/v1/role-sessions/${id}/facts/${encodeURIComponent(factId)}:decide`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
},
```

- [ ] **Step 4: Implement the compact card with inline revise mode**

```jsx
export default function FactDecisionCard({ fact, effectiveRole, pending, onDecide }) {
  const [editing, setEditing] = useState(false)
  const [statement, setStatement] = useState(fact.statement)
  const [category, setCategory] = useState(fact.category)
  const canDecide = canDecideFact(effectiveRole, fact)
  return (
    <section className={`fact-decision-card status-${fact.status.toLowerCase()}`}>
      <header><span>{factCategoryLabel[category]} · {factStatusLabel[fact.status]}</span></header>
      {editing ? <>
        <select value={category} onChange={(event) => setCategory(event.target.value)}>
          {Object.entries(factCategoryLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <textarea value={statement} maxLength={2000} onChange={(event) => setStatement(event.target.value)} />
      </> : <p>{fact.statement}</p>}
      <small>{fact.source}{fact.confirmed_at ? ` · ${formatDateTime(fact.confirmed_at)} 已确认` : ''}</small>
      {canDecide && !editing ? <div className="fact-decision-actions">
        <button disabled={pending} onClick={() => onDecide('CONFIRM')}>确认生效</button>
        <button disabled={pending} onClick={() => setEditing(true)}>修改</button>
        <button disabled={pending} onClick={() => onDecide('REJECT')}>拒绝</button>
      </div> : null}
      {canDecide && editing ? <div className="fact-decision-actions">
        <button disabled={pending || !statement.trim()} onClick={() => onDecide('REVISE', { replacement: { category, statement: statement.trim() } })}>保存修改</button>
        <button disabled={pending} onClick={() => setEditing(false)}>取消</button>
      </div> : null}
      {!canDecide ? <small>等待用人经理确认</small> : null}
    </section>
  )
}
```

Use the existing date formatter or add the equivalent local `formatDateTime` helper in this file. Keep buttons disabled while pending. Show source and confirmation time, but do not expose user IDs when a display name is unavailable.

- [ ] **Step 5: Wire the card into existing Agent messages**

In `ConversationView`, call the tested `factForMessage(facts, structured.fact_id)` helper. It starts from the referenced fact, selects facts with the same non-null `source_run_id` and `source_message_id`, sorts by `updated_at` descending, and prefers the latest `DRAFT`/`CONFLICTED` item before a current `CONFIRMED` item. Immediately after the existing question/limit content, render the card only when this lookup resolves. Pass `effectiveActorRole` and `handleFactDecision` from App.

`handleFactDecision` sends the current `roleDetail.state.revision` and `test_role` only for actual admins. On success, update `roleDetail` from the returned state and refresh conversation. On 409, refresh role detail and show “事实已被更新，请查看最新状态”。

- [ ] **Step 6: Add bounded, non-layout-changing CSS**

Use `max-width: 680px`, `overflow-wrap: anywhere`, textarea `width:100%`, buttons that wrap under 560px, and no fixed heights. Do not modify `.conversation-surface`, `.conversation-scroll`, sidebar widths or transcript grid.

- [ ] **Step 7: Run frontend tests and build**

```bash
corepack pnpm --filter @role-clarifier/web test
corepack pnpm --filter @role-clarifier/web build
```

- [ ] **Step 8: Review and commit Task 12**

```bash
git add frontend/src/fact-decision.js frontend/src/fact-decision.test.js frontend/src/components/FactDecisionCard.jsx frontend/src/api/client.js frontend/src/App.jsx frontend/src/styles.css frontend/package.json
git diff --cached --check
git commit -m "feat: confirm facts inside the existing conversation"
```

---

### Task 13: Frontend small change 3 — pending fact count and generation guidance

**Files:**
- Modify: `frontend/src/App.jsx:480-525,1240-1385`
- Modify: `frontend/src/api/client.js:125-155`
- Modify: `frontend/src/fact-decision.test.js`
- Modify: `frontend/src/styles.css:5350-5400,5880-5910`

**Interfaces:**
- Consumes: `pendingFacts(state.facts)` from Task 12 and server `UNRESOLVED_FACTS_PENDING` response from Task 10.
- Produces: one existing-page notice and conversation navigation action.

- [ ] **Step 1: Add a failing display-model test**

```js
test('待处理提示给出数量和生成按钮文案', () => {
  assert.deepEqual(pendingFactNotice([draftFact, conflictedFact]), {
    count: 2,
    text: '还有 2 条岗位事实待确认',
    action: '返回对话处理',
    generationBlocked: true,
  })
})

test('正式产物检索失败复用现有错误提示，普通澄清不打断对话', () => {
  assert.equal(enterpriseContextWarning({ type: 'context.retrieval_failed', payload: { task: 'GENERATE_ROLE_PROFILE' } }), '企业背景未完整加载，本轮结果需人工复核')
  assert.equal(enterpriseContextWarning({ type: 'context.retrieval_failed', payload: { task: 'CLARIFY_MESSAGE' } }), '')
})
```

- [ ] **Step 2: Run the test and verify failure**

Run: `corepack pnpm --filter @role-clarifier/web test`

- [ ] **Step 3: Implement one compact notice in the existing profile heading area**

Add `pendingFactNotice()` to `fact-decision.js`. In `ProfileView`, render the notice between `profile-permission-note` and existing sub-navigation only when count is greater than zero. The action calls the existing `setActiveView('conversation')`; do not add a tab, modal or new route.

When the active artifact is `ROLE_PROFILE`, disable generation and show `先确认 N 条事实`. Other artifact dependency behavior remains server-driven.

- [ ] **Step 4: Handle the server gate consistently**

In `handleArtifactAction`, if `ApiError.code === 'UNRESOLVED_FACTS_PENDING'`, set the same Chinese notice message and switch to conversation. Do not bypass the backend check after the local count becomes zero.

Add `context.retrieval_failed` to the existing SSE event-name array in `frontend/src/api/client.js`. In `connectRun`, call the tested `enterpriseContextWarning(event)` helper and, when it returns text, write it to the existing `workspace-error` banner. This adds no page, card, route or layout and satisfies the formal-generation degradation notice.

- [ ] **Step 5: Add minimal responsive CSS and run checks**

```bash
corepack pnpm --filter @role-clarifier/web test
corepack pnpm --filter @role-clarifier/web build
```

Inspect the CSS diff and verify it does not alter profile grid, tabs, document width or HR-only portrait rules.

- [ ] **Step 6: Review and commit Task 13**

```bash
git add frontend/src/App.jsx frontend/src/api/client.js frontend/src/fact-decision.js frontend/src/fact-decision.test.js frontend/src/styles.css
git diff --cached --check
git commit -m "feat: guide managers to pending fact decisions"
```

---

### Task 14: Operational script, configuration, and deployment documentation

**Files:**
- Create: `scripts/send-demo-hc-event.mjs`
- Modify: `package.json`
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `docs/feishu-integration.md`
- Modify: `docs/railway-deployment.md`
- Modify: `docs/implementation-status.md`

**Interfaces:**
- Consumes: Mock HRIS signature contract and environment variables from Tasks 5–6.
- Produces: reproducible demo event command and exact Railway configuration checklist.

- [ ] **Step 1: Add the event sender with deterministic signing**

```js
import { createHmac } from 'node:crypto'

const canonicalJson = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

const endpoint = process.env.HC_EVENT_URL
const secret = process.env.HC_EVENT_SECRET
if (!endpoint || !secret) throw new Error('HC_EVENT_URL and HC_EVENT_SECRET are required')
const occurredAt = new Date().toISOString()
const suffix = occurredAt.replaceAll(/[-:.TZ]/g, '')
const requestId = `HC-DEMO-${suffix}`
const buildDemoApprovedEvent = () => ({
  event_id: `evt-${requestId}-approved`,
  event_type: 'HC_APPROVED',
  occurred_at: occurredAt,
  tenant_id: 'tenant-demo',
  hc: {
    request_id: requestId,
    title: '企业产品经理',
    department: '企业服务产品部',
    hiring_manager_user_id: 'manager-demo',
    assigned_hr_user_id: 'hr-demo',
    context: {
      request_id: requestId,
      status: 'APPROVED',
      approved_at: occurredAt,
      business_change: '企业服务业务从项目交付转向标准产品经营。',
      organization_gap: '缺少统一负责产品边界和规模化验证的岗位。',
      approved_reason: '新增企业产品经理，沉淀跨项目可复用能力。',
      initial_responsibilities: ['定义产品边界', '规划产品路线图', '组织客户验证'],
      recruiting_budget: '年度新增编制预算内',
      recruiting_constraints: ['8 周内到岗'],
      hiring_manager_user_id: 'manager-demo',
      assigned_hr_user_id: 'hr-demo',
      job_basics: {
        recruitment_type: 'NEW_HEADCOUNT', headcount: 1, level: '3-2 至 4-1',
        reporting_line: '产品负责人', locations: ['北京', '上海'],
        employment_type: '全职', salary_range: '35K-50K·15薪', target_onboard: '8 周内',
      },
    },
  },
})
const event = buildDemoApprovedEvent()
const signature = createHmac('sha256', secret)
  .update(`${occurredAt}.${canonicalJson(event)}`)
  .digest('hex')
const response = await fetch(endpoint, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-hc-event-timestamp': occurredAt,
    'x-hc-event-signature': signature,
  },
  body: JSON.stringify(event),
})
if (!response.ok) throw new Error(`HC event failed with HTTP ${response.status}`)
console.log(JSON.stringify(await response.json()))
```

Use a unique request ID derived from the current UTC timestamp, assign `manager-demo` and `hr-demo`, and never print the secret or full Feishu mapping.

- [ ] **Step 2: Add the package command and syntax check**

Add `"hc:demo:event": "node scripts/send-demo-hc-event.mjs"`.

Run: `node --check scripts/send-demo-hc-event.mjs`

Expected: exit 0.

- [ ] **Step 3: Document exact API variables**

Add to `.env.example` and Railway docs:

```dotenv
HC_EVENT_SECRET=
HC_EVENT_MAX_SKEW_SECONDS=300
ENTERPRISE_CONTEXT_RETRIEVAL_ENABLED=true
NOTIFICATION_DISPATCH_ENABLED=false
NOTIFICATION_POLL_INTERVAL_MS=5000
NOTIFICATION_BATCH_SIZE=20
NOTIFICATION_LEASE_MS=30000
```

Railway production enables Dispatcher only after `FEISHU_ENABLED=true`, a valid mapped manager Open ID, and successful callback verification. Secrets remain Railway variables and never enter the repository.

- [ ] **Step 4: Document business behavior and failure boundaries**

Update docs with: one manager-only reminder; HR station-only visibility; no daily repeated reminders; `UNBOUND` behavior; three frontend-only changes; enterprise knowledge categories; no candidate PII; Trace evidence; original service topology.

- [ ] **Step 5: Review docs and commit Task 14**

```bash
git diff --check
rg -n "HC_EVENT_SECRET|NOTIFICATION_DISPATCH_ENABLED|企业知识|待确认事实" README.md docs .env.example
git add scripts/send-demo-hc-event.mjs package.json .env.example README.md docs/feishu-integration.md docs/railway-deployment.md docs/implementation-status.md
git diff --cached --check
git commit -m "docs: document three-closure operations"
```

---

### Task 15: Full review, automated verification, and rendered browser acceptance

**Files:**
- Modify only files required to fix issues found during this task.
- Update after verified: `docs/implementation-status.md`

**Interfaces:**
- Consumes: all previous tasks.
- Produces: reviewed, test-passing, visually accepted release candidate.

- [ ] **Step 1: Review the complete actual diff before running the final suite**

Run:

```bash
git status --short
git diff --check
git diff origin/main...HEAD -- packages/contracts packages/domain server harness-sidecar frontend scripts docs README.md .env.example package.json
```

Review in this order: P0/P1 correctness; migrations and recovery; tenant/role/privacy; idempotency and leases; Agent/SSE/Trace; API/frontend field consistency; old data and empty/error states; scope of the three frontend changes. Fix every blocking finding with a failing regression test first.

- [ ] **Step 2: Run targeted closure tests**

```bash
corepack pnpm --filter @role-clarifier/contracts test
corepack pnpm --filter @role-clarifier/domain test
corepack pnpm --filter @role-clarifier/api test -- enterprise-context-retriever.test.ts hc-event-service.test.ts mock-hris.test.ts notification-outbox-dispatcher.test.ts fact-decision-service.test.ts app.test.ts
corepack pnpm --filter @role-clarifier/harness-sidecar test
corepack pnpm --filter @role-clarifier/web test
```

Expected: all pass.

- [ ] **Step 3: Run repository-wide checks**

```bash
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
```

Expected: all workspaces exit 0. Record exact test counts in `docs/implementation-status.md` only after the commands finish.

- [ ] **Step 4: Build the three deployment images**

```bash
docker build -f frontend/Dockerfile -t role-clarifier-web:three-closures .
docker build -f server/Dockerfile -t role-clarifier-api:three-closures .
docker build -f harness-sidecar/Dockerfile -t role-clarifier-sidecar:three-closures .
```

Expected: all images build successfully.

- [ ] **Step 5: Run local browser acceptance at desktop and narrow widths**

Verify with manager, HR and admin sessions:

1. HC card keeps the original layout and only changes the small status.
2. Fact card is inside the original Agent message and does not overflow at 1440×900 or 390×844.
3. HR sees read-only fact state and can use the existing conversation to supplement an opinion; manager sees that message and can confirm/revise/reject the related fact.
4. Pending fact count appears in the existing profile notice area.
5. Login, navigation, role selection, profile body, HR shared workspace and Trace positions match the pre-change screenshots.

Capture screenshots under an ignored temporary output directory; do not commit generated images unless the user asks.

- [ ] **Step 6: Update verified status and commit only resulting fixes/status**

```bash
git add docs/implementation-status.md
git diff --cached --check
git commit -m "chore: verify three role clarification closures"
```

Regression fixes found in Step 1 must be staged by their exact reviewed paths and committed immediately after their targeted test passes, before the status-only command above. If there are no fixes and the status document already reflects exact results, do not create an empty commit.

---

### Task 16: GitHub push, Railway deployment, migration safety, and production smoke test

**Files:**
- No source edits expected. If production validation exposes a defect, stop deployment, add a failing regression test, fix in a new commit, and repeat Task 15.

**Interfaces:**
- Consumes: the verified release candidate from Task 15.
- Produces: GitHub `main` and Railway services running the same commit with production acceptance evidence.

- [ ] **Step 1: Confirm exact release scope and Railway linkage**

```bash
git status --short --branch
git log -1 --format='%H %s'
git diff --check origin/main...HEAD
railway status --json
railway service list --json
railway deployment list --service web --limit 2 --json
railway deployment list --service api --limit 2 --json
railway deployment list --service harness-sidecar --limit 2 --json
```

Expected: only the user-owned untracked plan remains; no secrets or temporary files are staged; `web`, `api`, `harness-sidecar`, and PostgreSQL are the existing services. Record the current successful deployment ID for each application service as the rollback target before pushing.

- [ ] **Step 2: Back up and inspect production PostgreSQL before migration**

```bash
mkdir -p ../outputs/three-closures-predeploy
node scripts/backup-production-db.mjs ../outputs/three-closures-predeploy
railway run --service api corepack pnpm --filter @role-clarifier/api db:migrate
```

Expected: backup command returns output path, row count and SHA-256 without printing credentials; migration applies `0013_role_clarification_closures.sql` once and preserves all existing row counts for roles, HC, messages, artifacts, candidates and decision logs.

- [ ] **Step 3: Configure variables without exposing values**

Verify the API service has `HC_EVENT_SECRET`, `NOTIFICATION_DISPATCH_ENABLED`, the notification timing variables, enabled Feishu credentials and a manager mapping. Because Railway's `--json` and `--kv` modes both contain raw values, pipe JSON directly into a key-only parser:

```bash
railway variable list --service api --json | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const v=JSON.parse(s);const keys=Array.isArray(v)?v.map(x=>x.name):Object.keys(v);process.stdout.write(keys.sort().join("\n"))})'
```

Confirm the names `HC_EVENT_SECRET`, `ENTERPRISE_CONTEXT_RETRIEVAL_ENABLED`, `NOTIFICATION_DISPATCH_ENABLED`, `NOTIFICATION_POLL_INTERVAL_MS`, `NOTIFICATION_BATCH_SIZE`, `NOTIFICATION_LEASE_MS`, `FEISHU_ENABLED`, `FEISHU_APP_ID`, `FEISHU_APP_SECRET` and `FEISHU_USER_MAPPINGS_JSON`. Set or rotate values only in Railway's variable editor, enable Dispatcher after the valid manager binding is present, and do not paste values into logs, chat or commits.

- [ ] **Step 4: Push the reviewed commit to GitHub main**

```bash
git push origin main
git rev-parse HEAD
git ls-remote origin refs/heads/main
```

Expected: local `HEAD` equals the remote `main` hash. Do not deploy a different commit.

- [ ] **Step 5: Wait for and verify Railway deployments**

```bash
railway deployment list --service web --limit 3 --json
railway deployment list --service api --limit 3 --json
railway deployment list --service harness-sidecar --limit 3 --json
railway logs --service api --latest --lines 100 --filter "@level:error"
railway logs --service harness-sidecar --latest --lines 100 --filter "@level:error"
```

Expected: latest deployments succeed and correspond to the pushed commit; no migration, Dispatcher, Feishu or Harness startup errors appear.

- [ ] **Step 6: Run production health and three-closure smoke tests**

Use the configured public Web origin:

```bash
curl --fail --silent --show-error "$WEB_ORIGIN/healthz"
HC_EVENT_URL="$WEB_ORIGIN/api/v1/integrations/mock-hris/hc-events" HC_EVENT_SECRET="$HC_EVENT_SECRET" corepack pnpm hc:demo:event
```

Then verify:

1. Manager receives one Feishu single-chat reminder; HR receives none.
2. Manager HC page displays `已提醒`; repeated event is marked duplicate and sends no second message.
3. Entering the HC changes it to `进行中` and restores the same workspace on repeat entry.
4. Admin Trace shows enterprise context IDs, source versions and match reasons for a real Agent Run.
5. Manager confirms a new fact; the next role profile generation contains that fact.
6. HR sees facts and task progress, can add a message through the existing shared conversation, but receives 403 when attempting a decision.
7. Admin test-manager action records actual `ADMIN` and effective `MANAGER`.
8. With Feishu sending temporarily disabled, a new HC still creates a station task and the notification becomes retryable without data loss.

- [ ] **Step 7: Verify rollback controls before declaring success**

Confirm `NOTIFICATION_DISPATCH_ENABLED=false` stops new proactive sends while HC ingestion and station tasks remain available, and `ENTERPRISE_CONTEXT_RETRIEVAL_ENABLED=false` keeps Runs working from HC plus confirmed facts. Restore both production values after the checks. If only Web acceptance fails, redeploy the previously recorded successful Web deployment from Railway without changing API or Sidecar. If a server regression blocks release, first disable the two switches, then create normal `git revert` commits for the offending application commits and push them; never force-push and never run a down migration or delete the four additive tables. Re-run `/healthz`, login, role list and the legacy manager `facts:confirm` request after rollback.

- [ ] **Step 8: Record final delivery evidence**

Record in the delivery report: modified files, Review findings/fixes, test counts, Docker builds, commit hash, GitHub push result, migration/backup evidence, Railway deployment IDs/statuses, manager/HR/admin acceptance, Feishu delivery/failure behavior and remaining risks. Do not commit credentials, cookies, Open IDs, candidate data or raw production snapshots.
