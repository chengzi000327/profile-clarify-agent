import { createHash, randomUUID } from 'node:crypto'
import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import sensible from '@fastify/sensible'
import Fastify, { type FastifyInstance } from 'fastify'
import { ZodError, z } from 'zod'
import {
  ArtifactTypeSchema,
  ActorContextSchema,
  AgentEventSchema,
  AgentRunSchema,
  CandidateImportSchema,
  CandidateEvidenceSchema,
  CreateRoleSessionSchema,
  ClarificationExtendRequestSchema,
  ClarificationPolicySchema,
  ConversationMessageSchema,
  FactCategorySchema,
  HumanDecisionSchema,
  LoginRequestSchema,
  MessageRequestSchema,
  PublicJDSchema,
  RoleStateSchema,
  type ActorContext,
  type AgentEvent,
  type ArtifactType,
  type CandidateEvidence,
  type ConversationMessage,
} from '@role-clarifier/contracts'
import { DomainError } from '@role-clarifier/domain'
import { AgentRunner } from './agent/runner.js'
import { SidecarHarnessAdapter, type HarnessAdapter } from './agent/harness-adapter.js'
import type { AppConfig } from './config.js'
import { RoleService } from './services/role-service.js'
import { createStore, type ApplicationStore } from './store/index.js'
import { writeSseEvent } from './http/sse.js'
import {
  FeishuGateway,
  FeishuOpenApiClient,
  type FeishuClientLike,
} from './integrations/feishu.js'

const IdParamsSchema = z.object({ id: z.string().uuid() })
const RunParamsSchema = z.object({ run_id: z.string().uuid() })
const ArtifactParamsSchema = z.object({
  id: z.string().uuid(),
  type: ArtifactTypeSchema,
})
const ArtifactIdParamsSchema = z.object({
  id: z.string().uuid(),
  artifact_id: z.string().uuid(),
})
const RevisionSchema = z.object({ expected_revision: z.number().int().nonnegative() })

const stableId = (prefix: string, value: string): string =>
  `${prefix}-${createHash('sha256').update(value).digest('hex').slice(0, 24)}`

const resolveLoginIdentity = (workspaceId: string, accountId: string) => {
  const workspace = workspaceId.trim().toLowerCase()
  const account = accountId.trim().toLowerCase()
  const legacyIds = new Set(['manager-demo', 'hr-demo', 'admin-demo'])
  if (workspace === 'legacy-demo' && legacyIds.has(account)) {
    return { tenantId: 'tenant-demo', userId: account }
  }
  const tenantId = stableId('tenant', workspace)
  return {
    tenantId,
    userId: stableId('user', `${tenantId}\u0000${account}`),
  }
}

const suffixedParam = (
  params: unknown,
  name: string,
  suffix: string,
): string | undefined => {
  if (!params || typeof params !== 'object') return undefined
  const record = params as Record<string, unknown>
  const value = record[name] ?? record[`${name}:${suffix}`]
  if (typeof value !== 'string') return undefined
  const marker = `:${suffix}`
  return value.endsWith(marker) ? value.slice(0, -marker.length) : value
}

const toCandidateEvidencePlaceholder = (
  input: z.infer<typeof CandidateImportSchema>['candidates'][number],
): CandidateEvidence => ({
  candidate_ref: input.candidate_ref,
  channel: input.channel,
  source_format: input.format,
  evidence: [],
  bottlenecks: [],
})

export const visibleAgentEvent = (event: AgentEvent, actor: ActorContext): AgentEvent => {
  if (actor.role === 'ADMIN' || event.type !== 'run.failed') return event
  const { internal_message: _internalMessage, ...payload } = event.payload
  return {
    ...event,
    payload: {
      ...payload,
      message: 'Agent 本轮没有完成，原消息已经保留，请稍后重试。',
    },
  }
}

export interface AppDependencies {
  store?: ApplicationStore
  feishuClient?: FeishuClientLike
  harness?: HarnessAdapter
}

const recoverInterruptedRuns = async (store: ApplicationStore): Promise<void> => {
  const interrupted = await store.listActiveRuns()
  for (const record of interrupted) {
    const completedAt = new Date().toISOString()
    const priorEvents = await store.listRunEvents(record.run.id)
    let sequence = priorEvents.at(-1)?.sequence ?? 0
    const messages = record.run.input_message_id
      ? await store.listConversationMessages(record.run.role_session_id)
      : []
    const inputMessage = messages.find((message) => message.id === record.run.input_message_id)
    let recoveryMessage: ConversationMessage | null = null
    if (inputMessage) {
      recoveryMessage = {
        id: randomUUID(),
        tenant_id: inputMessage.tenant_id,
        role_session_id: record.run.role_session_id,
        run_id: record.run.id,
        clarification_round_id: inputMessage.clarification_round_id,
        sender_type: 'SYSTEM',
        sender_user_id: null,
        sender_role: null,
        sender_name: '系统',
        content: '服务重启中断了本次 Agent 运行，原消息已保留，请重新发送或继续对话。',
        structured_content: { error_code: 'RUN_INTERRUPTED' },
        status: 'FAILED',
        sequence: (messages.at(-1)?.sequence ?? 0) + 1,
        created_at: completedAt,
        completed_at: completedAt,
      }
      await store.appendConversationMessage(recoveryMessage)
    }
    await store.updateRun({
      ...record.run,
      status: 'FAILED',
      completed_at: completedAt,
      error_code: 'RUN_INTERRUPTED',
      output_message_id: recoveryMessage?.id ?? null,
    })
    const failureEvent: AgentEvent = {
      id: randomUUID(),
      run_id: record.run.id,
      sequence: ++sequence,
      type: 'run.failed',
      payload: {
        code: 'RUN_INTERRUPTED',
        message: '服务重启中断了本次 Agent 运行，原输入已保留',
      },
      created_at: completedAt,
    }
    await store.appendRunEvent(failureEvent)
    if (recoveryMessage) {
      await store.appendRunEvent({
        id: randomUUID(),
        run_id: record.run.id,
        sequence: ++sequence,
        type: 'assistant.completed',
        payload: { message_id: recoveryMessage.id, status: recoveryMessage.status },
        created_at: completedAt,
      })
    }
  }
}

export const buildApp = async (
  config: AppConfig,
  dependencies: AppDependencies = {},
): Promise<FastifyInstance> => {
  const app = Fastify({
    logger:
      config.NODE_ENV === 'test'
        ? false
        : {
            level: 'info',
            redact: [
              'req.headers.cookie',
              'req.body.content',
              'req.body.candidates',
              'res.headers.set-cookie',
            ],
          },
    genReqId: () => randomUUID(),
  })
  const store = dependencies.store ?? createStore(config)
  await store.initialize()
  await recoverInterruptedRuns(store)
  const roleService = new RoleService(store)
  const runner = new AgentRunner(
    store,
    roleService,
    dependencies.harness ?? new SidecarHarnessAdapter(config),
    config,
  )
  const feishu = new FeishuGateway(
    config,
    store,
    roleService,
    runner,
    dependencies.feishuClient ?? new FeishuOpenApiClient(config),
    (error) => app.log.error({ err: error }, 'Feishu message processing failed'),
  )

  await app.register(cookie, {
    secret: config.SESSION_SECRET,
    hook: 'onRequest',
  })
  await app.register(cors, {
    origin: config.WEB_ORIGIN,
    credentials: true,
  })
  await app.register(sensible)

  app.decorateRequest('actor', undefined as unknown as ActorContext)

  const requireAdmin = (actor: ActorContext): void => {
    if (actor.role !== 'ADMIN') {
      throw new DomainError('FORBIDDEN', '仅企业管理员可以访问该功能', 403)
    }
  }

  const fullTrace = async (runId: string, actor: ActorContext) => {
    requireAdmin(actor)
    const record = await store.getRun(runId)
    if (!record) throw new DomainError('AGENT_RUN_NOT_FOUND', 'Agent Run 不存在', 404)
    const view = await roleService.get(record.run.role_session_id, actor)
    if (view.state.tenant_id !== actor.tenant_id) {
      throw new DomainError('AGENT_RUN_NOT_FOUND', 'Agent Run 不存在', 404)
    }
    const events = await store.listRunEvents(runId)
    await store.appendTraceAccessAudit({
      id: randomUUID(),
      tenant_id: actor.tenant_id,
      actor_user_id: actor.user_id,
      run_id: runId,
      action: 'VIEW',
      reason: null,
      created_at: new Date().toISOString(),
    })
    return {
      run: record.run,
      events,
      visibility: {
        mode: 'FULL_ADMIN',
        raw_user_message_logged: true,
        model_prompt_logged: true,
        model_response_logged: true,
        tool_arguments_logged: true,
        tool_results_logged: true,
        pii_screened_candidate_content_logged: true,
        secrets_exposed: false,
        hidden_reasoning_exposed: false,
      },
    }
  }

  app.addHook('onRequest', async (request) => {
    if (
      request.url === '/healthz' ||
      request.url === '/api/v1/auth/login' ||
      request.url === '/api/v1/openapi.json' ||
      request.url === '/api/v1/integrations/feishu/events'
    ) {
      return
    }
    if (!request.url.startsWith('/api/v1/')) return
    const cookieValue = request.cookies.role_agent_session
    if (!cookieValue) throw new DomainError('UNAUTHENTICATED', '请先登录', 401)
    const unsigned = request.unsignCookie(cookieValue)
    if (!unsigned.valid || !unsigned.value) {
      throw new DomainError('UNAUTHENTICATED', '登录状态无效', 401)
    }
    const user = await store.getUser(unsigned.value)
    if (!user) throw new DomainError('UNAUTHENTICATED', '用户不存在或已停用', 401)
    request.actor = {
      tenant_id: user.tenant_id,
      user_id: user.user_id,
      role: user.role,
      display_name: user.display_name,
    }
  })

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof DomainError) {
      return reply.status(error.statusCode).send({
        error: { code: error.code, message: error.message, request_id: request.id },
      })
    }
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: '请求格式不正确',
          details: error.issues,
          request_id: request.id,
        },
      })
    }
    request.log.error(error)
    return reply.status(500).send({
      error: {
        code: 'INTERNAL_ERROR',
        message: '服务暂时不可用',
        request_id: request.id,
      },
    })
  })

  app.get('/healthz', async () => ({
    status: 'ok',
    harness_mode: 'sidecar',
    integrations: { feishu: feishu.status() },
  }))

  app.post('/api/v1/integrations/feishu/events', async (request) => {
    try {
      return await feishu.receive(request.body)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Feishu webhook failed'
      if (message.includes('verification token')) {
        throw new DomainError('FEISHU_UNAUTHORIZED', '飞书回调校验失败', 401)
      }
      if (message.includes('not configured')) {
        throw new DomainError('FEISHU_NOT_CONFIGURED', '飞书连接尚未配置', 503)
      }
      throw error
    }
  })

  app.post('/internal/v1/harness/tools/:tool_name', async (request) => {
    const bearer = request.headers.authorization
    if (bearer !== `Bearer ${config.ROLE_AGENT_TOOL_TOKEN}`) {
      throw new DomainError('HARNESS_TOOL_UNAUTHORIZED', 'Harness tool token 无效', 401)
    }
    const harnessSessionId = request.headers['x-harness-session-id']
    const rawSessionId = Array.isArray(harnessSessionId) ? harnessSessionId[0] : harnessSessionId
    const roleSessionId = rawSessionId?.startsWith('role-') ? rawSessionId.slice(5) : ''
    if (!z.string().uuid().safeParse(roleSessionId).success) {
      throw new DomainError('HARNESS_CONTEXT_MISSING', 'Harness Session 未绑定业务岗位', 401)
    }
    const activeRun = await store.findActiveRunByRole(roleSessionId)
    if (!activeRun) throw new DomainError('HARNESS_CONTEXT_EXPIRED', 'Agent Run 已结束', 409)
    const user = await store.getUser(activeRun.run.actor_user_id)
    if (!user) throw new DomainError('HARNESS_CONTEXT_EXPIRED', 'Agent Run 用户不存在', 409)
    const actor: ActorContext = {
      tenant_id: user.tenant_id,
      user_id: user.user_id,
      role: user.role,
      display_name: user.display_name,
    }
    const { tool_name } = z.object({ tool_name: z.string() }).parse(request.params)
    const body = request.body ?? {}
    if (tool_name === 'read_role_state') {
      return roleService.readStateForTask(roleSessionId, actor, activeRun.run.task)
    }
    if (tool_name === 'save_fact_draft') {
      const input = z
        .object({
          category: FactCategorySchema,
          statement: z.string().min(1).max(2_000),
          source_refs: z.array(z.string()).max(20).optional(),
        })
        .strict()
        .parse(body)
      const state = await roleService.saveFactDraft(
        roleSessionId,
        actor,
        input.statement,
        input.category,
      )
      return { saved: true, revision: state.revision }
    }
    if (tool_name === 'update_role_identity_draft') {
      const input = z
        .object({
          title: z.string().trim().min(1).max(120).optional(),
          department: z.string().trim().min(1).max(120).optional(),
        })
        .strict()
        .refine((value) => Boolean(value.title || value.department))
        .parse(body)
      const identity = {
        ...(input.title ? { title: input.title } : {}),
        ...(input.department ? { department: input.department } : {}),
      }
      const state = await roleService.updateRoleIdentityDraft(roleSessionId, actor, identity)
      return {
        saved: true,
        revision: state.revision,
        role_identity: { title: state.title, department: state.department },
      }
    }
    if (tool_name === 'save_artifact_draft') {
      const input = z
        .object({
          artifact_type: ArtifactTypeSchema,
          content: z.unknown(),
          based_on_hash: z.string().optional(),
        })
        .strict()
        .parse(body)
      const artifact = await roleService.saveArtifactDraft(
        roleSessionId,
        actor,
        input.artifact_type,
        input.content,
      )
      return {
        saved: true,
        artifact: {
          id: artifact.id,
          type: artifact.type,
          version: artifact.version,
          content_hash: artifact.content_hash,
          status: artifact.status,
        },
      }
    }
    if (tool_name === 'save_candidate_evidence') {
      const candidates = z
        .object({ candidates: z.array(CandidateEvidenceSchema).min(1).max(100) })
        .strict()
        .parse(body)
      const outcome = await roleService.importCandidateEvidence(
        roleSessionId,
        actor,
        candidates.candidates,
      )
      return {
        saved: true,
        candidate_count: outcome.state.candidate_count,
        calibration_status: outcome.evaluation.status,
      }
    }
    if (tool_name === 'propose_calibration_signal') {
      const input = z
        .object({
          focus: z.string().min(1),
          evidence_summary: z.record(z.string(), z.unknown()),
          proposed_change: z.record(z.string(), z.unknown()),
        })
        .strict()
        .parse(body)
      const signal = await roleService.proposeCalibrationSignal(
        roleSessionId,
        actor,
        { ...input.proposed_change, focus: input.focus },
        input.evidence_summary,
      )
      return { saved: true, signal_id: signal.id, status: signal.status }
    }
    if (tool_name === 'read_version_diff') {
      const input = z
        .object({
          artifact_type: ArtifactTypeSchema,
          from_version: z.number().int().positive(),
          to_version: z.number().int().positive(),
        })
        .strict()
        .parse(body)
      return roleService.readVersionDiff(
        roleSessionId,
        actor,
        input.artifact_type,
        input.from_version,
        input.to_version,
      )
    }
    throw new DomainError('HARNESS_TOOL_NOT_ALLOWED', '工具不在领域白名单中', 404)
  })

  app.post('/api/v1/auth/login', async (request, reply) => {
    const body = LoginRequestSchema.parse(request.body)
    const identity = resolveLoginIdentity(body.workspace_id, body.account_id)
    const existing = await store.getUser(identity.userId)
    if (existing && (existing.tenant_id !== identity.tenantId || existing.role !== body.role)) {
      throw new DomainError(
        'ACCOUNT_ROLE_MISMATCH',
        '该账号已绑定其他角色；同一账号的角色不能在登录时变更',
        409,
      )
    }
    const user = existing
      ? { ...existing, display_name: body.display_name, active: true }
      : {
          tenant_id: identity.tenantId,
          user_id: identity.userId,
          role: body.role,
          display_name: body.display_name,
          active: true,
        }
    await store.saveUser(user)
    reply.setCookie('role_agent_session', user.user_id, {
      signed: true,
      httpOnly: true,
      sameSite: 'lax',
      secure: config.NODE_ENV === 'production',
      path: '/',
      maxAge: 8 * 60 * 60,
    })
    return {
      is_new_account: !existing,
      actor: {
        tenant_id: user.tenant_id,
        user_id: user.user_id,
        role: user.role,
        display_name: user.display_name,
      },
    }
  })

  app.post('/api/v1/auth/logout', async (_request, reply) => {
    reply.clearCookie('role_agent_session', { path: '/' })
    return { ok: true }
  })

  app.get('/api/v1/auth/me', async (request) => ({ actor: request.actor }))

  app.get('/api/v1/role-sessions', async (request) => ({
    items: await roleService.list(request.actor),
  }))

  app.post('/api/v1/role-sessions', async (request, reply) => {
    const body = CreateRoleSessionSchema.parse(request.body)
    const result = await roleService.create(request.actor, body)
    return reply.status(201).send(result)
  })

  app.post('/api/v1/intake/messages', async (request, reply) => {
    const body = MessageRequestSchema.parse(request.body)
    const role = await roleService.createIntake(request.actor)
    const result = await runner.submitMessage(role.state.id, request.actor, body.content)
    return reply.status(202).send({
      role,
      run_id: result.run.id,
      message: result.message,
      stream_url: `/api/v1/agent-runs/${result.run.id}/events`,
    })
  })

  app.get('/api/v1/role-sessions/:id', async (request) => {
    const { id } = IdParamsSchema.parse(request.params)
    return roleService.get(id, request.actor)
  })

  app.get('/api/v1/role-sessions/:id/messages', async (request) => {
    const { id } = IdParamsSchema.parse(request.params)
    await roleService.get(id, request.actor)
    const query = z
      .object({ after_sequence: z.coerce.number().int().nonnegative().default(0) })
      .parse(request.query)
    return {
      items: await store.listConversationMessages(id, query.after_sequence),
      policy: await store.getClarificationPolicy(id),
    }
  })

  app.post('/api/v1/role-sessions/:id/context:sync', async (request) => {
    const { id } = IdParamsSchema.parse(request.params)
    const { expected_revision } = RevisionSchema.parse(request.body)
    return {
      state: await roleService.syncMockContext(id, request.actor, expected_revision),
      sources: ['S-01 Mock HC', 'S-02 Mock 招聘约束'],
    }
  })

  app.post('/api/v1/role-sessions/:id/facts:confirm', async (request) => {
    const { id } = IdParamsSchema.parse(request.params)
    const body = z
      .object({
        fact_ids: z.array(z.string()).min(1),
        expected_revision: z.number().int().nonnegative(),
      })
      .parse(request.body)
    return {
      state: await roleService.confirmFacts(
        id,
        request.actor,
        body.fact_ids,
        body.expected_revision,
      ),
    }
  })

  app.post('/api/v1/role-sessions/:id/messages', async (request, reply) => {
    const { id } = IdParamsSchema.parse(request.params)
    const body = MessageRequestSchema.parse(request.body)
    const result = await runner.submitMessage(id, request.actor, body.content)
    return reply.status(202).send({
      run_id: result.run.id,
      message: result.message,
      stream_url: `/api/v1/agent-runs/${result.run.id}/events`,
    })
  })

  app.post('/api/v1/role-sessions/:id/clarification:extend', async (request) => {
    const { id } = IdParamsSchema.parse(request.params)
    const body = ClarificationExtendRequestSchema.parse(request.body)
    await roleService.get(id, request.actor)
    const policy = await store.getClarificationPolicy(id)
    const updated = {
      ...policy,
      granted_rounds: policy.granted_rounds + policy.extension_size,
      status: 'ACTIVE' as const,
      updated_by: request.actor.user_id,
      updated_at: new Date().toISOString(),
    }
    await store.saveClarificationPolicy(updated)
    await store.appendDecision({
      id: randomUUID(),
      role_session_id: id,
      actor_user_id: request.actor.user_id,
      action: 'EXTEND_CLARIFICATION',
      target_type: 'CLARIFICATION_POLICY',
      target_id: id,
      metadata: { reason: body.reason, added_rounds: policy.extension_size },
      created_at: new Date().toISOString(),
    })
    return { policy: updated }
  })

  app.post('/api/v1/role-sessions/:id/artifacts/:type/generate', async (request, reply) => {
    const { id, type } = ArtifactParamsSchema.parse(request.params)
    const run = await runner.submitArtifact(id, request.actor, type)
    return reply.status(202).send({
      run_id: run.id,
      stream_url: `/api/v1/agent-runs/${run.id}/events`,
    })
  })

  app.get('/api/v1/role-sessions/:id/artifacts/:type/versions', async (request) => {
    const { id, type } = ArtifactParamsSchema.parse(request.params)
    const view = await roleService.get(id, request.actor)
    return {
      items: view.artifacts
        .filter((artifact) => artifact.type === type)
        .sort((left, right) => right.version - left.version),
    }
  })

  app.post('/api/v1/role-sessions/:id/artifacts/:artifact_id:confirm', async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).passthrough().parse(request.params)
    const artifact_id = z
      .string()
      .uuid()
      .parse(suffixedParam(request.params, 'artifact_id', 'confirm'))
    const body = z
      .object({
        content_hash: z.string().min(16),
        expected_revision: z.number().int().nonnegative(),
      })
      .parse(request.body)
    return {
      artifact: await roleService.confirmArtifact(
        id,
        artifact_id,
        request.actor,
        body.content_hash,
        body.expected_revision,
      ),
    }
  })

  app.post('/api/v1/role-sessions/:id/publish:prepare', async (request) => {
    const { id } = IdParamsSchema.parse(request.params)
    const { expected_revision } = RevisionSchema.parse(request.body)
    return {
      state: await roleService.preparePublish(id, request.actor, expected_revision),
      external_publish_called: false,
    }
  })

  app.post('/api/v1/role-sessions/:id/candidates:import', async (request, reply) => {
    const { id } = IdParamsSchema.parse(request.params)
    const body = CandidateImportSchema.parse(request.body)
    for (const candidate of body.candidates) roleService.rejectCandidatePII(candidate.content)
    const run = await runner.submitCandidates(id, request.actor, body.candidates)
    return reply.status(202).send({
      run_id: run.id,
      stream_url: `/api/v1/agent-runs/${run.id}/events`,
      accepted_candidates: body.candidates.map(toCandidateEvidencePlaceholder),
    })
  })

  app.post(
    '/api/v1/role-sessions/:id/calibration-signals/:signal_id:review',
    async (request) => {
      const { id } = z.object({ id: z.string().uuid() }).passthrough().parse(request.params)
      const signalId = z
        .string()
        .uuid()
        .parse(suffixedParam(request.params, 'signal_id', 'review'))
      const body = HumanDecisionSchema.parse(request.body)
      return roleService.reviewCalibrationSignal(
        id,
        signalId,
        request.actor,
        body.decision,
        body.reason,
        body.expected_revision,
      )
    },
  )

  app.post('/api/v1/role-sessions/:id/manager-tasks/:task_id:decide', async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).passthrough().parse(request.params)
    const taskId = z
      .string()
      .uuid()
      .parse(suffixedParam(request.params, 'task_id', 'decide'))
    const body = HumanDecisionSchema.parse(request.body)
    return {
      task: await roleService.decideManagerTask(
        id,
        taskId,
        request.actor,
        body.decision,
        body.reason,
        body.expected_revision,
      ),
    }
  })

  app.post('/api/v1/agent-runs/:run_id:cancel', async (request) => {
    const run_id = z
      .string()
      .uuid()
      .parse(suffixedParam(request.params, 'run_id', 'cancel'))
    await runner.cancel(run_id, request.actor)
    return { ok: true }
  })

  app.get('/api/v1/agent-runs/:run_id', async (request) => {
    const { run_id } = RunParamsSchema.parse(request.params)
    const record = await store.getRun(run_id)
    if (!record) throw new DomainError('AGENT_RUN_NOT_FOUND', 'Agent Run 不存在', 404)
    await roleService.get(record.run.role_session_id, request.actor)
    if (
      record.run.actor_user_id !== request.actor.user_id &&
      !['HR', 'ADMIN'].includes(request.actor.role)
    ) {
      throw new DomainError('AGENT_RUN_NOT_FOUND', 'Agent Run 不存在', 404)
    }
    return { run: record.run }
  })

  app.get('/api/v1/agent-runs/:run_id/trace', async (request) => {
    const { run_id } = RunParamsSchema.parse(request.params)
    return fullTrace(run_id, request.actor)
  })

  app.get('/api/v1/agent-runs/:run_id/events', async (request, reply) => {
    const { run_id } = RunParamsSchema.parse(request.params)
    const record = await store.getRun(run_id)
    if (!record) throw new DomainError('AGENT_RUN_NOT_FOUND', 'Agent Run 不存在', 404)
    await roleService.get(record.run.role_session_id, request.actor)
    if (
      record.run.actor_user_id !== request.actor.user_id &&
      !['HR', 'ADMIN'].includes(request.actor.role)
    ) {
      throw new DomainError('AGENT_RUN_NOT_FOUND', 'Agent Run 不存在', 404)
    }
    const rawLastId = request.headers['last-event-id']
    const lastSequence = Number(Array.isArray(rawLastId) ? rawLastId[0] : rawLastId ?? '0')

    reply.hijack()
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    reply.raw.write('retry: 2000\n\n')
    for (const event of await store.listRunEvents(run_id, Number.isFinite(lastSequence) ? lastSequence : 0)) {
      writeSseEvent(reply.raw, visibleAgentEvent(event, request.actor))
    }
    const latest = await store.getRun(run_id)
    if (latest && ['COMPLETED', 'FAILED', 'CANCELLED'].includes(latest.run.status)) {
      reply.raw.end()
      return
    }
    const unsubscribe = store.subscribeToRun(run_id, (event) => {
      writeSseEvent(reply.raw, visibleAgentEvent(event, request.actor))
      if (['run.completed', 'run.failed'].includes(event.type)) {
        unsubscribe()
        clearInterval(heartbeat)
        reply.raw.end()
      }
    })
    const heartbeat = setInterval(() => reply.raw.write(': heartbeat\n\n'), 15_000)
    request.raw.on('close', () => {
      clearInterval(heartbeat)
      unsubscribe()
    })
  })

  app.get('/api/v1/admin/agent-runs', async (request) => {
    requireAdmin(request.actor)
    const query = z
      .object({
        status: z.enum(['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED']).optional(),
        model_tier: z.enum(['FLASH', 'PRO']).optional(),
        role_session_id: z.string().uuid().optional(),
      })
      .parse(request.query)
    const records = await store.listRunsForTenant(request.actor.tenant_id)
    return {
      items: records.filter(
        ({ run }) =>
          (!query.status || run.status === query.status) &&
          (!query.model_tier || run.model_tier === query.model_tier) &&
          (!query.role_session_id || run.role_session_id === query.role_session_id),
      ),
    }
  })

  app.get('/api/v1/admin/agent-runs/:run_id/trace', async (request) => {
    const { run_id } = RunParamsSchema.parse(request.params)
    return fullTrace(run_id, request.actor)
  })

  app.get('/api/v1/admin/trace-audits', async (request) => {
    requireAdmin(request.actor)
    return { items: await store.listTraceAccessAudits(request.actor.tenant_id) }
  })

  app.put('/api/v1/admin/agent-policy', async (request) => {
    requireAdmin(request.actor)
    const body = z
      .object({
        initial_budget: z.number().int().min(1).max(30),
        extension_size: z.number().int().min(1).max(10),
      })
      .parse(request.body)
    const roles = await roleService.list(request.actor)
    for (const role of roles) {
      const current = await store.getClarificationPolicy(role.id)
      await store.saveClarificationPolicy({
        ...current,
        initial_budget: body.initial_budget,
        extension_size: body.extension_size,
        status:
          current.opened_rounds < body.initial_budget + current.granted_rounds
            ? 'ACTIVE'
            : current.status,
        updated_by: request.actor.user_id,
        updated_at: new Date().toISOString(),
      })
    }
    return { initial_budget: body.initial_budget, extension_size: body.extension_size }
  })

  app.get('/api/v1/openapi.json', async () => ({
    openapi: '3.1.0',
    info: { title: 'Role Clarifier Agent API', version: '0.1.0' },
    paths: {
      '/api/v1/intake/messages': {
        post: { summary: '以第一条自然语言消息建立岗位并创建异步 Agent Run' },
      },
      '/api/v1/integrations/feishu/events': {
        post: { summary: '接收飞书 URL 验证与 im.message.receive_v1 事件' },
      },
      '/api/v1/role-sessions/{id}/messages': {
        get: { summary: '读取持久化多角色对话和澄清策略' },
        post: { summary: '保存人类消息并创建异步 Agent Run' },
      },
      '/api/v1/agent-runs/{run_id}/events': {
        get: { summary: '支持 Last-Event-ID 续传的 Agent 事件流' },
      },
      '/api/v1/agent-runs/{run_id}:cancel': {
        post: { summary: '取消 Agent Run' },
      },
      '/api/v1/agent-runs/{run_id}/trace': {
        get: { summary: '企业管理员读取完整执行 Trace' },
      },
      '/api/v1/admin/agent-runs': {
        get: { summary: '企业管理员读取租户内 Agent Run' },
      },
    },
    components: {
      schemas: {
        ActorContext: z.toJSONSchema(ActorContextSchema),
        RoleState: z.toJSONSchema(RoleStateSchema),
        AgentRun: z.toJSONSchema(AgentRunSchema),
        AgentEvent: z.toJSONSchema(AgentEventSchema),
        ConversationMessage: z.toJSONSchema(ConversationMessageSchema),
        ClarificationPolicy: z.toJSONSchema(ClarificationPolicySchema),
        PublicJD: z.toJSONSchema(PublicJDSchema),
        CandidateEvidence: z.toJSONSchema(CandidateEvidenceSchema),
      },
    },
    'x-contract-source': '@role-clarifier/contracts generated with Zod 4 toJSONSchema',
  }))

  app.addHook('onClose', async () => {
    await store.close()
  })

  return app
}
