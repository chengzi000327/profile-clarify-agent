import { randomUUID } from 'node:crypto'
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
  HumanDecisionSchema,
  LoginRequestSchema,
  MessageRequestSchema,
  PublicJDSchema,
  RoleStateSchema,
  type ActorContext,
  type ArtifactType,
  type CandidateEvidence,
} from '@role-clarifier/contracts'
import { DomainError } from '@role-clarifier/domain'
import { AgentRunner } from './agent/runner.js'
import { createHarnessAdapter } from './agent/harness-adapter.js'
import type { AppConfig } from './config.js'
import { RoleService } from './services/role-service.js'
import { createStore, type ApplicationStore } from './store/index.js'
import { writeSseEvent } from './http/sse.js'

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

export interface AppDependencies {
  store?: ApplicationStore
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
  const roleService = new RoleService(store)
  const runner = new AgentRunner(store, roleService, createHarnessAdapter(config), config)

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

  app.addHook('onRequest', async (request) => {
    if (
      request.url === '/healthz' ||
      request.url === '/api/v1/auth/login' ||
      request.url === '/api/v1/openapi.json'
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

  app.get('/healthz', async () => ({ status: 'ok', harness_mode: config.HARNESS_MODE }))

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
      const view = await roleService.get(roleSessionId, actor)
      const { tenant_id: _tenantId, ...state } = view.state
      return { ...view, state }
    }
    if (tool_name === 'save_fact_draft') {
      const input = z
        .object({
          category: z.enum(['BACKGROUND', 'HIRING_REASON', 'SUCCESS_CRITERION', 'CONSTRAINT']),
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
    const user = await store.getUser(body.user_id)
    if (!user) throw new DomainError('INVALID_LOGIN', '测试账号不存在', 401)
    reply.setCookie('role_agent_session', user.user_id, {
      signed: true,
      httpOnly: true,
      sameSite: 'lax',
      secure: config.NODE_ENV === 'production',
      path: '/',
      maxAge: 8 * 60 * 60,
    })
    return {
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

  app.get('/api/v1/role-sessions/:id', async (request) => {
    const { id } = IdParamsSchema.parse(request.params)
    return roleService.get(id, request.actor)
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
    const run = await runner.submitMessage(id, request.actor, body.content)
    return reply.status(202).send({
      run_id: run.id,
      stream_url: `/api/v1/agent-runs/${run.id}/events`,
    })
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

  app.get('/api/v1/agent-runs/:run_id/trace', async (request) => {
    const { run_id } = RunParamsSchema.parse(request.params)
    const record = await store.getRun(run_id)
    if (!record) throw new DomainError('AGENT_RUN_NOT_FOUND', 'Agent Run 不存在', 404)
    await roleService.get(record.run.role_session_id, request.actor)
    if (record.run.actor_user_id !== request.actor.user_id && request.actor.role !== 'HR') {
      throw new DomainError('AGENT_RUN_NOT_FOUND', 'Agent Run 不存在', 404)
    }
    const events = await store.listRunEvents(run_id)
    return {
      run: record.run,
      events: events.map((event) =>
        event.type === 'assistant.delta'
          ? { ...event, payload: { redacted: true, character_count: String(event.payload.delta ?? '').length } }
          : event,
      ),
      privacy: {
        raw_user_message_logged: false,
        candidate_content_logged: false,
      },
    }
  })

  app.get('/api/v1/agent-runs/:run_id/events', async (request, reply) => {
    const { run_id } = RunParamsSchema.parse(request.params)
    const record = await store.getRun(run_id)
    if (!record) throw new DomainError('AGENT_RUN_NOT_FOUND', 'Agent Run 不存在', 404)
    await roleService.get(record.run.role_session_id, request.actor)
    if (record.run.actor_user_id !== request.actor.user_id && request.actor.role !== 'HR') {
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
      writeSseEvent(reply.raw, event)
    }
    const latest = await store.getRun(run_id)
    if (latest && ['COMPLETED', 'FAILED', 'CANCELLED'].includes(latest.run.status)) {
      reply.raw.end()
      return
    }
    const unsubscribe = store.subscribeToRun(run_id, (event) => {
      writeSseEvent(reply.raw, event)
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

  app.get('/api/v1/openapi.json', async () => ({
    openapi: '3.1.0',
    info: { title: 'Role Clarifier Agent API', version: '0.1.0' },
    paths: {
      '/api/v1/role-sessions/{id}/messages': {
        post: { summary: '创建异步 Agent Run，返回 SSE 地址' },
      },
      '/api/v1/agent-runs/{run_id}/events': {
        get: { summary: '支持 Last-Event-ID 续传的 Agent 事件流' },
      },
      '/api/v1/agent-runs/{run_id}:cancel': {
        post: { summary: '取消 Agent Run' },
      },
      '/api/v1/agent-runs/{run_id}/trace': {
        get: { summary: '读取脱敏 Trace' },
      },
    },
    components: {
      schemas: {
        ActorContext: z.toJSONSchema(ActorContextSchema),
        RoleState: z.toJSONSchema(RoleStateSchema),
        AgentRun: z.toJSONSchema(AgentRunSchema),
        AgentEvent: z.toJSONSchema(AgentEventSchema),
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
