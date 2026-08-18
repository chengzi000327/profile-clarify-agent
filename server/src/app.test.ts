import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import {
  ROLE_CLARIFIER_SYSTEM_PROMPT,
  type AgentRun,
  type ArtifactType,
  type CandidateEvidence,
  type Fact,
  type RoleState,
} from '@role-clarifier/contracts'
import { buildApp, visibleAgentEvent } from './app.js'
import type {
  HarnessAdapter,
  HarnessHooks,
  HarnessRequest,
  HarnessResult,
} from './agent/harness-adapter.js'
import { loadConfig } from './config.js'
import { MemoryStore } from './store/memory-store.js'
import { createMockHcContext, DEMO_ROLE_SESSION_ID } from './store/seed.js'
import { signMockHrisEvent } from './integrations/mock-hris.js'

const config = loadConfig({
  NODE_ENV: 'test',
  SESSION_SECRET: 'test-session-secret-that-is-long-enough',
  HC_EVENT_SECRET: 'test-hc-event-secret-that-is-at-least-32-characters',
})

const capturedHarnessRequests: HarnessRequest[] = []

class TestHarnessStub implements HarnessAdapter {
  async run(request: HarnessRequest, hooks: HarnessHooks): Promise<HarnessResult> {
    capturedHarnessRequests.push(structuredClone(request))
    const { tenant_id: _tenantId, ...roleState } = request.role_state
    let toolCount = 0
    const tool = async (name: string, args: unknown, result: unknown): Promise<void> => {
      toolCount += 1
      await hooks.onToolStarted(name, args)
      await hooks.onToolCompleted(name, `${name} completed by test stub`, result)
    }
    const finish = async (result: HarnessResult, visible: string): Promise<HarnessResult> => {
      await hooks.onModelResponse(JSON.stringify(result))
      await hooks.onDelta(visible)
      await hooks.onTrace({
        model: 'test-harness-stub',
        provider: 'test-only',
        tool_count: toolCount,
        input_tokens: 1,
        output_tokens: 1,
        duration_ms: 1,
        repaired: false,
      })
      return result
    }

    await hooks.onContextSnapshot({
      system_prompt: {
        section_name: 'role-clarifier:guardrails',
        content: ROLE_CLARIFIER_SYSTEM_PROMPT,
        provenance: 'HARNESS_SYSTEM_PROMPT',
        harness_managed_base: {
          included: false,
          captured_as_text: false,
          description: '测试替身仅验证 API 编排，不代表可运行的 Harness 模式。',
        },
      },
      current_user_input: {
        content: request.message === undefined
          ? { candidate_data: request.candidates ?? [] }
          : { message: request.message },
        source: 'CURRENT_REQUEST',
      },
      short_term_memory: {
        source: 'RECENT_CONVERSATION',
        window_size: request.conversation_context?.recent_messages.length ?? 0,
        messages: request.conversation_context?.recent_messages ?? [],
      },
      long_term_memory: {
        source: 'BUSINESS_DATABASE',
        role_state: roleState,
        enterprise_context: request.enterprise_context,
      },
      task_state: {
        task: request.task,
        current_user_role: request.conversation_context?.current_user_role ?? null,
        open_clarification: request.conversation_context?.open_clarification ?? null,
        maximum_transitions: request.maximum_transitions,
      },
    })
    await hooks.onModelRequest(JSON.stringify({
      task: request.task,
      message: request.message,
      role_state: roleState,
    }))

    const message = request.message?.trim() ?? ''
    if (
      request.task === 'CLARIFY_MESSAGE'
      && /你在吗|在不在|干啥|做什么|怎么用|帮助|^(你好|您好|嗨|hi|hello)/i.test(message)
    ) {
      await hooks.onStatus('测试替身返回普通对话结果')
      const answer = '我在，可以继续帮你澄清岗位和招聘问题。'
      return finish({ kind: 'CONVERSATION', persistence: 'NONE', answer }, answer)
    }

    await hooks.onStatus('测试替身执行 Agent 任务')
    await tool('read_role_state', {}, request.role_state)

    if (request.task === 'CLARIFY_MESSAGE') {
      const category: 'HIRING_REASON' | 'SUCCESS_CRITERION' = request.role_state.facts.some(
        (fact) => fact.category === 'HIRING_REASON',
      )
        ? 'SUCCESS_CRITERION'
        : 'HIRING_REASON'
      const title = message.match(
        /(?:招聘|招|找)(?:一名|一个|一位|位|个|名)?\s*([^，。！？\n]{2,30}?(?:经理|负责人|工程师|设计师|运营|销售|顾问|专家|总监|主管|HR|人力资源))/,
      )?.[1]?.trim()
      if (title) await tool('update_role_identity_draft', { title }, { saved: true })
      const factDraft = { category, statement: message }
      await tool('save_fact_draft', factDraft, { saved: true })
      const answer = `已记录本轮${category === 'HIRING_REASON' ? '招聘原因' : '成功标准'}。`
      return finish({
        kind: 'CLARIFICATION',
        answer,
        question: category === 'HIRING_REASON'
          ? '如果半年后证明招聘成功，最重要的业务结果是什么？'
          : '这个结果由谁验收、如何判断达成？',
        ...(title ? { role_identity: { title } } : {}),
        fact_draft: factDraft,
      }, answer)
    }

    if (request.task === 'EXTRACT_CANDIDATES') {
      const candidates: CandidateEvidence[] = (request.candidates ?? []).map((candidate) => {
        const text = typeof candidate.content === 'string'
          ? candidate.content
          : JSON.stringify(candidate.content)
        const businessGap = /业务判断/.test(text) && /不足|缺少|较弱|未体现/.test(text)
        return {
          candidate_ref: candidate.candidate_ref,
          channel: candidate.channel,
          source_format: candidate.format,
          evidence: [{
            criterion: '业务判断',
            signal: /业务|商业|增长/.test(text) ? 'MIXED' : 'MISSING',
            excerpt: businessGap ? '业务判断证据不足，需要面试验证。' : '存在业务相关经历。',
          }],
          bottlenecks: businessGap ? ['业务判断证据不足'] : [],
        }
      })
      await tool('save_candidate_evidence', { candidates }, { saved: true })
      const summary = `已完成 ${candidates.length} 份候选人证据分析。`
      return finish({ kind: 'CANDIDATE_EVIDENCE', candidates, summary }, summary)
    }

    if (request.task === 'CALIBRATION_ADVICE') {
      const proposedChange = { action: 'REVIEW_CAPABILITY_ANCHORS' }
      await tool('propose_calibration_signal', {
        focus: '能力锚点',
        evidence_summary: {},
        proposed_change: proposedChange,
      }, { saved: true })
      const summary = '建议复核岗位画像中的能力锚点。'
      return finish({
        kind: 'CALIBRATION_ADVICE',
        summary,
        proposed_change: proposedChange,
      }, summary)
    }

    const artifactTypeByTask: Record<
      Exclude<HarnessRequest['task'], 'CLARIFY_MESSAGE' | 'EXTRACT_CANDIDATES' | 'CALIBRATION_ADVICE'>,
      ArtifactType
    > = {
      GENERATE_ROLE_PROFILE: 'ROLE_PROFILE',
      GENERATE_ASSESSMENT: 'ASSESSMENT_SCORECARD',
      GENERATE_JD: 'PUBLIC_JD',
      GENERATE_HR_BRIEF: 'HR_RECRUITING_BRIEF',
    }
    const artifactType = artifactTypeByTask[request.task]
    const content = artifactType === 'ROLE_PROFILE'
      ? {
          hiring_reason: {
            conclusion: `补充一名${request.role_state.title}。`,
            business_change: request.role_state.hc_context?.business_change ?? '业务发生变化。',
            organization_gap: request.role_state.hc_context?.organization_gap ?? '组织存在能力缺口。',
            no_hire_impact: '关键业务目标无法按期完成。',
            evidence_refs: [request.role_state.hc_context?.request_id ?? 'HC-TEST'],
          },
          mission: `负责${request.role_state.title}岗位的关键业务结果。`,
          success_outcomes: [{
            id: 'O-01', horizon: '90 天', title: '完成现状诊断', definition: '形成岗位关键任务与推进计划。',
            measures: ['输出诊断与计划'], status: '已确认', evidence_refs: [],
          }],
          work_scenarios: [{
            id: 'T-01', title: '关键任务推进', frequency: '每周', trigger: '业务目标进入执行阶段',
            actions: '识别问题并推动跨团队协作', output: '可验收结果', challenge: '协作链路复杂',
            stakeholders: request.role_state.department, outcome_refs: ['O-01'], evidence_refs: [],
          }],
          requirements: [{
            id: 'C-01', priority: 'Must-have', name: '结构化问题解决', level: '熟练', rationale: '支撑 O-01 与 T-01',
            maps_to: ['O-01', 'T-01'], strong_evidence: ['能够说明问题、取舍和结果'], substitute_evidence: [],
            risk_signals: ['只能描述过程'], assessment_method: '案例面试', evidence_refs: [],
          }],
          boundaries: {
            owns: ['岗位关键目标与结果'], does_not_own: ['其他团队的专业决策'], decision_rights: '提出岗位范围内的优先级建议',
            collaboration_and_resources: request.role_state.department, evidence_refs: [],
          },
        }
      : artifactType === 'ASSESSMENT_SCORECARD'
        ? {
            dimensions: [{
              id: 'A-01', name: '结构化问题解决', weight: 100, method: '案例面试', owner: '用人经理',
              question: '请说明一次复杂问题的判断与推进过程。', evidence: '问题、取舍、行动和结果完整',
              anchors: { 1: '只能描述过程', 3: '能够说明方案与结果', 5: '形成可复用的方法并验证结果' },
            }],
            decision_rule: {
              status: '草稿', summary: '核心维度达到 3 分后进入综合校准', scoring: '按权重计算加权得分',
              pass_thresholds: '核心维度不得低于 3 分', calibration: '面试官提交证据后统一校准',
            },
          }
        : artifactType === 'PUBLIC_JD'
          ? {
          title_and_basics: {
            title: request.role_state.title,
            location: '上海 / 可协商',
            employment_type: '全职',
            reporting_line: `${request.role_state.department}负责人`,
          },
          about_the_role: '负责围绕关键业务目标推动方案落地。',
          what_you_will_do: ['澄清目标并推动交付'],
          what_we_look_for: ['具备结构化分析和协作能力'],
        }
          : { title: request.role_state.title, generated_for: artifactType }
    await tool('save_artifact_draft', { artifact_type: artifactType, content }, { saved: true })
    const summary = artifactType === 'ROLE_PROFILE' ? '岗位画像草稿已生成。' : '产物草稿已生成。'
    return finish({ kind: 'ARTIFACT', artifact_type: artifactType, content, summary }, summary)
  }
}

const testHarness = new TestHarnessStub()

const cookieFrom = (response: {
  headers: Record<string, string | string[] | number | undefined>
}): string => {
  const header = response.headers['set-cookie']
  const value = Array.isArray(header) ? header[0] : header
  if (!value) throw new Error('Missing session cookie')
  return String(value).split(';')[0] ?? ''
}

const login = async (
  app: FastifyInstance,
  userId: 'manager-demo' | 'hr-demo' | 'admin-demo',
): Promise<string> => {
  const profile = {
    'manager-demo': { display_name: '用人经理 · 陈曦', role: 'MANAGER' },
    'hr-demo': { display_name: 'HR · 林夏', role: 'HR' },
    'admin-demo': { display_name: '企业管理员 · 周宁', role: 'ADMIN' },
  }[userId] as { display_name: string; role: 'MANAGER' | 'HR' | 'ADMIN' }
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: {
      workspace_id: 'legacy-demo',
      account_id: userId,
      display_name: profile.display_name,
      role: profile.role,
    },
  })
  expect(response.statusCode).toBe(200)
  return cookieFrom(response)
}

const submitFactAndWait = async (
  app: FastifyInstance,
  cookie: string,
  content: string,
): Promise<{ run: AgentRun; fact: Fact; state: RoleState }> => {
  const submitted = await app.inject({
    method: 'POST',
    url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}/messages`,
    headers: { cookie },
    payload: { content },
  })
  expect(submitted.statusCode, submitted.body).toBe(202)
  const runId = submitted.json().run_id
  let run: AgentRun | undefined
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const status = await app.inject({
      method: 'GET',
      url: `/api/v1/agent-runs/${runId}`,
      headers: { cookie },
    })
    run = status.json().run
    if (run?.status === 'COMPLETED') break
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  expect(run?.status).toBe('COMPLETED')
  if (!run) throw new Error('Run did not complete')
  const detail = (await app.inject({
    method: 'GET',
    url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}`,
    headers: { cookie },
  })).json()
  const fact = detail.state.facts.find(
    (item: { source_run_id: string | null }) => item.source_run_id === runId,
  )
  expect(fact).toBeDefined()
  return { run, fact, state: detail.state }
}

describe('Role Clarifier API', () => {
  let app: FastifyInstance
  let store: MemoryStore

  beforeEach(async () => {
    capturedHarnessRequests.length = 0
    store = new MemoryStore()
    app = await buildApp(config, { store, harness: testHarness })
  })

  it('普通成员的 SSE 不暴露内部错误，企业管理员 Trace 保留诊断信息', () => {
    const event = {
      id: 'event-failed',
      run_id: 'run-failed',
      sequence: 1,
      type: 'run.failed' as const,
      payload: {
        code: 'HARNESS_EXECUTION_FAILED',
        message: 'Agent 本轮没有完成，原消息已经保留，请稍后重试。',
        internal_message: 'runtime stack for administrator',
      },
      created_at: '2026-08-16T00:00:00.000Z',
    }
    const managerEvent = visibleAgentEvent(event, {
      tenant_id: 'tenant-demo',
      user_id: 'manager-demo',
      role: 'MANAGER',
      display_name: '用人经理',
    })
    const adminEvent = visibleAgentEvent(event, {
      tenant_id: 'tenant-demo',
      user_id: 'admin-demo',
      role: 'ADMIN',
      display_name: '企业管理员',
    })
    expect(managerEvent.payload.internal_message).toBeUndefined()
    expect(managerEvent.payload.message).toBe('Agent 本轮没有完成，原消息已经保留，请稍后重试。')
    expect(adminEvent.payload.internal_message).toBe('runtime stack for administrator')
  })

  it('只允许三个预置账号按固定姓名和角色登录', async () => {
    const arbitrary = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        workspace_id: 'demo-company',
        account_id: 'someone@example.com',
        display_name: '临时账号',
        role: 'HR',
      },
    })
    expect(arbitrary.statusCode).toBe(403)
    expect(arbitrary.json().error.code).toBe('LOGIN_NOT_ALLOWED')

    const mismatchedIdentity = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        workspace_id: 'legacy-demo',
        account_id: 'manager-demo',
        display_name: '用人经理 · 陈曦',
        role: 'HR',
      },
    })
    expect(mismatchedIdentity.statusCode).toBe(403)
    expect(mismatchedIdentity.json().error.code).toBe('LOGIN_IDENTITY_MISMATCH')

    const managerCookie = await login(app, 'manager-demo')
    const session = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: managerCookie },
    })
    expect(session.statusCode).toBe(200)
    expect(session.json().actor).toMatchObject({
      tenant_id: 'tenant-demo',
      user_id: 'manager-demo',
      role: 'MANAGER',
      display_name: '用人经理 · 陈曦',
    })
  })

  it('无需 Cookie 但必须使用有效签名接收 HC 审批事件', async () => {
    const context = createMockHcContext({
      hiringManagerUserId: 'manager-demo',
      assignedHrUserId: 'hr-demo',
    })
    context.request_id = 'HC-ROUTE-001'
    context.approved_at = new Date().toISOString()
    const body = {
      event_id: 'evt-route-001',
      event_type: 'HC_APPROVED' as const,
      occurred_at: context.approved_at,
      tenant_id: 'tenant-demo',
      hc: {
        request_id: context.request_id,
        title: '企业产品经理',
        department: '企业服务产品部',
        hiring_manager_user_id: 'manager-demo',
        assigned_hr_user_id: 'hr-demo',
        context,
      },
    }
    const timestamp = new Date().toISOString()
    const signature = signMockHrisEvent(config.HC_EVENT_SECRET!, timestamp, body)
    const accepted = await app.inject({
      method: 'POST',
      url: '/api/v1/integrations/mock-hris/hc-events',
      headers: {
        'x-hc-event-timestamp': timestamp,
        'x-hc-event-signature': signature,
      },
      payload: body,
    })
    expect(accepted.statusCode).toBe(202)
    expect(accepted.json()).toEqual({ accepted: true, duplicate: false })

    const rejected = await app.inject({
      method: 'POST',
      url: '/api/v1/integrations/mock-hris/hc-events',
      headers: {
        'x-hc-event-timestamp': timestamp,
        'x-hc-event-signature': 'bad',
      },
      payload: body,
    })
    expect(rejected.statusCode).toBe(401)
    expect(rejected.json().error.code).toBe('HC_EVENT_UNAUTHORIZED')
  })

  it('未配置 HC 事件密钥时集成入口返回 503', async () => {
    const unconfiguredApp = await buildApp(loadConfig({
      NODE_ENV: 'test',
      SESSION_SECRET: 'test-session-secret-that-is-long-enough',
    }), { store: new MemoryStore(), harness: testHarness })
    const response = await unconfiguredApp.inject({
      method: 'POST',
      url: '/api/v1/integrations/mock-hris/hc-events',
      payload: {},
    })
    expect(response.statusCode).toBe(503)
    expect(response.json().error.code).toBe('HC_EVENT_NOT_CONFIGURED')
    await unconfiguredApp.close()
  })

  it('三个角色登录后读取十条有效 HC，经理敏感薪酬字段保持脱敏', async () => {
    for (const userId of ['manager-demo', 'hr-demo', 'admin-demo'] as const) {
      const cookie = await login(app, userId)
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/hc-approvals',
        headers: { cookie },
      })
      expect(response.statusCode).toBe(200)
      expect(response.json().items).toHaveLength(10)
      expect(response.json().items.every(
        (item: { status: string; clarification_status: string; context: { request_id: string } }) =>
          item.status === 'APPROVED' && Boolean(item.context.request_id) &&
          ['NOT_STARTED', 'IN_PROGRESS', 'PROFILE_READY'].includes(item.clarification_status),
      )).toBe(true)
      expect(response.json().items.map((item: { title: string }) => item.title).sort())
        .toEqual([
          'AI 产品经理', '企业产品经理', '客户端工程师', '推荐算法工程师', '数据产品经理',
          '数据工程师', '机器学习平台工程师', '测试开发工程师', '高级前端工程师', '高级后端工程师',
        ].sort())
      expect(new Set(response.json().items.map(
        (item: { context: { job_basics: { recruitment_type: string } } }) =>
          item.context.job_basics.recruitment_type,
      ))).toEqual(new Set([
        'NEW_HEADCOUNT',
        'ATTRITION_REPLACEMENT',
        'PERFORMANCE_REPLACEMENT',
        'ORGANIZATION_ADJUSTMENT',
        'OTHER',
      ]))
      expect(response.json().items.some(
        (item: { context: { approved_reason: string } }) => item.context.approved_reason.includes('离职'),
      )).toBe(true)
      expect(response.json().items.some(
        (item: { context: { approved_reason: string } }) => item.context.approved_reason.includes('汰换'),
      )).toBe(true)
      const salary = response.json().items[0].context.job_basics.salary_range
      expect(salary).toBe(userId === 'manager-demo' ? '按权限可见' : '35K-50K·15薪')
    }
  })

  it('HC 状态从待澄清到已提醒、进行中并在画像确认后完成', async () => {
    const context = createMockHcContext({
      hiringManagerUserId: 'manager-demo',
      assignedHrUserId: 'hr-demo',
    })
    context.request_id = 'HC-LIFECYCLE-001'
    context.approved_at = new Date().toISOString()
    const event = {
      event_id: 'evt-lifecycle-001',
      event_type: 'HC_APPROVED' as const,
      occurred_at: context.approved_at,
      tenant_id: 'tenant-demo',
      hc: {
        request_id: context.request_id,
        title: '企业产品经理',
        department: '企业服务产品部',
        hiring_manager_user_id: 'manager-demo',
        assigned_hr_user_id: 'hr-demo',
        context,
      },
    }
    const timestamp = new Date().toISOString()
    await app.inject({
      method: 'POST',
      url: '/api/v1/integrations/mock-hris/hc-events',
      headers: {
        'x-hc-event-timestamp': timestamp,
        'x-hc-event-signature': signMockHrisEvent(config.HC_EVENT_SECRET!, timestamp, event),
      },
      payload: event,
    })
    const [claimed] = await store.claimDueNotifications({
      worker_id: 'test-worker',
      now: timestamp,
      locked_until: new Date(Date.parse(timestamp) + 30_000).toISOString(),
      limit: 1,
    })
    await store.markNotificationSent(claimed!.id, 'test-worker', timestamp)

    const managerCookie = await login(app, 'manager-demo')
    const listHc = async () => (await app.inject({
      method: 'GET',
      url: '/api/v1/hc-approvals',
      headers: { cookie: managerCookie },
    })).json().items.find((item: { request_id: string }) => item.request_id === context.request_id)

    expect(await listHc()).toMatchObject({
      clarification_task: { status: 'OPEN', assignee_user_id: 'manager-demo' },
      notification_delivery: { status: 'SENT', channel: 'FEISHU' },
    })

    const workspace = await app.inject({
      method: 'POST',
      url: `/api/v1/hc-approvals/${context.request_id}/workspace`,
      headers: { cookie: managerCookie },
    })
    expect(workspace.statusCode).toBe(201)
    const roleId = workspace.json().role.state.id as string
    expect(await listHc()).toMatchObject({ clarification_task: { status: 'IN_PROGRESS' } })

    const generated = await app.inject({
      method: 'POST',
      url: `/api/v1/role-sessions/${roleId}/artifacts/ROLE_PROFILE/generate`,
      headers: { cookie: managerCookie },
      payload: {},
    })
    expect(generated.statusCode).toBe(202)
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const status = await app.inject({
        method: 'GET',
        url: `/api/v1/agent-runs/${generated.json().run_id}`,
        headers: { cookie: managerCookie },
      })
      if (status.json().run.status === 'COMPLETED') break
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    const detail = (await app.inject({
      method: 'GET',
      url: `/api/v1/role-sessions/${roleId}`,
      headers: { cookie: managerCookie },
    })).json()
    const profile = detail.state.latest_artifacts.ROLE_PROFILE
    const confirmed = await app.inject({
      method: 'POST',
      url: `/api/v1/role-sessions/${roleId}/artifacts/${profile.id}:confirm`,
      headers: { cookie: managerCookie },
      payload: {
        content_hash: profile.content_hash,
        expected_revision: detail.state.revision,
      },
    })
    expect(confirmed.statusCode, confirmed.body).toBe(200)
    expect(await listHc()).toMatchObject({ clarification_task: { status: 'COMPLETED' } })
    const hrCookie = await login(app, 'hr-demo')
    const hrApproval = (await app.inject({
      method: 'GET',
      url: '/api/v1/hc-approvals',
      headers: { cookie: hrCookie },
    })).json().items.find((item: { request_id: string }) => item.request_id === context.request_id)
    expect(hrApproval).toMatchObject({
      clarification_task: { status: 'COMPLETED' },
      notification_delivery: { status: 'SENT' },
    })

    const messagesBeforeReopen = await app.inject({
      method: 'GET',
      url: `/api/v1/role-sessions/${roleId}/messages`,
      headers: { cookie: managerCookie },
    })
    const reopened = await app.inject({
      method: 'POST',
      url: `/api/v1/hc-approvals/${context.request_id}/workspace`,
      headers: { cookie: managerCookie },
    })
    expect(reopened.statusCode).toBe(200)
    expect(reopened.json().role.state.id).toBe(roleId)
    const messages = await app.inject({
      method: 'GET',
      url: `/api/v1/role-sessions/${roleId}/messages`,
      headers: { cookie: managerCookie },
    })
    expect(messages.json().items).toHaveLength(messagesBeforeReopen.json().items.length)
  })

  it('选择 HC 后由 Agent 幂等发起首问，重复进入不会生成重复会话或消息', async () => {
    const managerCookie = await login(app, 'manager-demo')
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/hc-approvals/HC-2026-RD-002/workspace',
      headers: { cookie: managerCookie },
    })
    expect(first.statusCode, first.body).toBe(201)
    expect(first.json().created).toBe(true)
    expect(first.json().role.state).toMatchObject({
      title: '高级后端工程师',
      department: '平台研发部',
      stage: 'REASON_CLARIFYING',
      hc_status: 'APPROVED',
    })
    const roleId = first.json().role.state.id
    const approvalsAfterOpen = await app.inject({
      method: 'GET',
      url: '/api/v1/hc-approvals',
      headers: { cookie: managerCookie },
    })
    const openedHc = approvalsAfterOpen.json().items.find(
      (item: { request_id: string }) => item.request_id === 'HC-2026-RD-002',
    )
    expect(openedHc).toMatchObject({
      role_session_id: roleId,
      clarification_status: 'IN_PROGRESS',
      role_stage: 'REASON_CLARIFYING',
    })
    const messages = await app.inject({
      method: 'GET',
      url: `/api/v1/role-sessions/${roleId}/messages`,
      headers: { cookie: managerCookie },
    })
    expect(messages.statusCode).toBe(200)
    expect(messages.json().items).toHaveLength(1)
    expect(messages.json().items[0]).toMatchObject({
      sender_type: 'AGENT',
      sender_name: '画像澄清 Agent',
      sequence: 1,
      status: 'COMPLETED',
      structured_content: {
        kind: 'HC_OPENING_QUESTION',
        hc_request_id: 'HC-2026-RD-002',
      },
    })
    expect(messages.json().items[0].structured_content.question).toContain('入职 90 天后')

    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/hc-approvals/HC-2026-RD-002/workspace',
      headers: { cookie: managerCookie },
    })
    expect(second.statusCode).toBe(200)
    expect(second.json().created).toBe(false)
    expect(second.json().role.state.id).toBe(roleId)

    const repeatedMessages = await app.inject({
      method: 'GET',
      url: `/api/v1/role-sessions/${roleId}/messages`,
      headers: { cookie: managerCookie },
    })
    expect(repeatedMessages.json().items).toHaveLength(1)

    const hrCookie = await login(app, 'hr-demo')
    const hrView = await app.inject({
      method: 'POST',
      url: '/api/v1/hc-approvals/HC-2026-RD-002/workspace',
      headers: { cookie: hrCookie },
    })
    expect(hrView.statusCode).toBe(200)
    expect(hrView.json().role.state.id).toBe(roleId)
  })

  it('预置经理发送第一条 intake 消息后自动建立岗位并由 Agent 识别岗位名称', async () => {
    const cookie = await login(app, 'manager-demo')
    const intake = await app.inject({
      method: 'POST',
      url: '/api/v1/intake/messages',
      headers: { cookie },
      payload: { content: '我想招聘一位企业产品经理，请从招聘原因开始帮我澄清。' },
    })
    expect(intake.statusCode, intake.body).toBe(202)
    expect(intake.json().role.state).toMatchObject({
      title: '待识别岗位',
      department: '待确认团队',
      stage: 'REASON_CLARIFYING',
    })

    const runId = intake.json().run_id
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const status = await app.inject({
        method: 'GET',
        url: `/api/v1/agent-runs/${runId}`,
        headers: { cookie },
      })
      if (status.json().run.status === 'COMPLETED') break
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    const roles = await app.inject({
      method: 'GET',
      url: '/api/v1/role-sessions',
      headers: { cookie },
    })
    const createdRole = roles.json().items.find(
      (item: { id: string }) => item.id === intake.json().role.state.id,
    )
    expect(createdRole?.title).toBe('企业产品经理')
    const messages = await app.inject({
      method: 'GET',
      url: `/api/v1/role-sessions/${intake.json().role.state.id}/messages`,
      headers: { cookie },
    })
    expect(messages.json().items.map((item: { sender_type: string }) => item.sender_type))
      .toEqual(['HUMAN', 'AGENT'])
  })

  it('飞书事件可开启同一岗位澄清链路，待确认事实会引导经理回 Web 生效', async () => {
    const cards: Array<{ chatId: string; card: Record<string, unknown> }> = []
    const texts: Array<{ chatId: string; text: string }> = []
    const feishuConfig = loadConfig({
      NODE_ENV: 'test',
      SESSION_SECRET: 'test-session-secret-that-is-long-enough',
      FEISHU_ENABLED: 'true',
      FEISHU_APP_ID: 'cli_test',
      FEISHU_APP_SECRET: 'test-secret',
      FEISHU_VERIFICATION_TOKEN: 'verification-token',
      FEISHU_WORKSPACE_ID: 'conversation-first-demo',
      FEISHU_USER_MAPPINGS_JSON: JSON.stringify({
        ou_manager_one: {
          account_id: 'manager-demo',
          display_name: '用人经理 · 陈曦',
          role: 'MANAGER',
        },
      }),
    })
    const feishuStore = new MemoryStore()
    const feishuApp = await buildApp(feishuConfig, {
      store: feishuStore,
      harness: testHarness,
      feishuClient: {
        configured: () => true,
        sendText: async (chatId, text) => {
          texts.push({ chatId, text })
        },
        sendCard: async (chatId, card) => {
          cards.push({ chatId, card })
        },
        sendCardToOpenId: async () => {},
      },
    })
    expect(await feishuStore.getUserChannelBinding(
      'tenant-demo',
      'manager-demo',
      'FEISHU',
    )).toMatchObject({ recipient_id: 'ou_manager_one', status: 'ACTIVE' })
    const challenge = await feishuApp.inject({
      method: 'POST',
      url: '/api/v1/integrations/feishu/events',
      payload: {
        type: 'url_verification',
        challenge: 'challenge-code',
        token: 'verification-token',
      },
    })
    expect(challenge.statusCode).toBe(200)
    expect(challenge.json()).toEqual({ challenge: 'challenge-code' })

    const event = (messageId: string, text: string) => ({
      schema: '2.0',
      header: {
        event_id: `event-${messageId}`,
        event_type: 'im.message.receive_v1',
        token: 'verification-token',
        tenant_key: 'tenant-key',
      },
      event: {
        sender: {
          sender_id: { open_id: 'ou_manager_one' },
          sender_type: 'user',
        },
        message: {
          message_id: messageId,
          chat_id: 'oc_p2p_chat',
          chat_type: 'p2p',
          message_type: 'text',
          content: JSON.stringify({ text }),
        },
      },
    })
    const first = await feishuApp.inject({
      method: 'POST',
      url: '/api/v1/integrations/feishu/events',
      payload: event('om_001', '我想招聘一位企业产品经理，请从招聘原因开始帮我澄清。'),
    })
    expect(first.statusCode, first.body).toBe(200)
    for (let attempt = 0; attempt < 60 && texts.length < 1; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    expect(texts).toHaveLength(1)
    expect(texts[0]?.text).toContain('下一步需要你补充')
    expect(cards).toHaveLength(0)

    await feishuApp.inject({
      method: 'POST',
      url: '/api/v1/integrations/feishu/events',
      payload: event('om_002', '生成岗位画像'),
    })
    for (let attempt = 0; attempt < 60 && texts.length < 2; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    expect(cards).toHaveLength(0)
    expect(texts[1]?.text).toContain('岗位事实待确认')
    expect(texts[1]?.text).toContain('Web 工作台')

    const duplicate = await feishuApp.inject({
      method: 'POST',
      url: '/api/v1/integrations/feishu/events',
      payload: event('om_002', '生成岗位画像'),
    })
    expect(duplicate.json()).toMatchObject({ ok: true, duplicate: true })
    await feishuApp.close()
  })

  afterEach(async () => {
    await app.close()
  })

  it('权限由后端 Session 决定，经理响应中不存在 HR 内部数据', async () => {
    const managerCookie = await login(app, 'manager-demo')
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}`,
      headers: { cookie: managerCookie },
    })
    expect(response.statusCode).toBe(200)
    const payload = response.json()
    expect(payload.candidates).toBeUndefined()
    expect(payload.calibration_signals).toBeUndefined()
    expect(payload.artifacts.some((item: { type: string }) => item.type === 'HR_RECRUITING_BRIEF')).toBe(false)
    expect(payload.state.latest_artifacts.HR_RECRUITING_BRIEF).toBeUndefined()
    expect(payload.state.hc_context).toMatchObject({
      request_id: 'HC-2026-EP-001',
      status: 'APPROVED',
      assigned_hr_user_id: 'hr-demo',
      job_basics: {
        recruitment_type: 'NEW_HEADCOUNT',
        headcount: 1,
        level: '3-2 至 4-1',
        reporting_line: '产品负责人',
        locations: ['北京', '上海'],
        employment_type: '全职',
        salary_range: '按权限可见',
        target_onboard: '8 周内',
      },
    })
  })

  it('HR 可以读取内部招聘画像，但经理不能让 Agent 生成该产物', async () => {
    const managerCookie = await login(app, 'manager-demo')
    const forbidden = await app.inject({
      method: 'POST',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}/artifacts/HR_RECRUITING_BRIEF/generate`,
      headers: { cookie: managerCookie },
    })
    expect(forbidden.statusCode).toBe(403)

    const hrCookie = await login(app, 'hr-demo')
    const allowed = await app.inject({
      method: 'GET',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}`,
      headers: { cookie: hrCookie },
    })
    expect(allowed.statusCode).toBe(200)
    expect(
      allowed.json().artifacts.some(
        (item: { type: string }) => item.type === 'HR_RECRUITING_BRIEF',
      ),
    ).toBe(true)
    expect(allowed.json().state.hc_context.job_basics.salary_range).toBe('35K-50K·15薪')
  })

  it('HC Mock 指定负责 HR 后自动把 HR 加入同一岗位会话', async () => {
    const managerCookie = await login(app, 'manager-demo')
    const intake = await app.inject({
      method: 'POST',
      url: '/api/v1/intake/messages',
      headers: { cookie: managerCookie },
      payload: { content: '我要新增一名企业产品经理，先澄清招聘原因。' },
    })
    expect(intake.statusCode, intake.body).toBe(202)
    const roleId = intake.json().role.state.id

    const hrCookie = await login(app, 'hr-demo')
    const roles = await app.inject({
      method: 'GET',
      url: '/api/v1/role-sessions',
      headers: { cookie: hrCookie },
    })
    expect(roles.statusCode).toBe(200)
    expect(roles.json().items.map((item: { id: string }) => item.id)).toContain(roleId)
    const role = await app.inject({
      method: 'GET',
      url: `/api/v1/role-sessions/${roleId}`,
      headers: { cookie: hrCookie },
    })
    expect(role.statusCode).toBe(200)
    expect(role.json().state.hc_context.assigned_hr_user_id).toBe('hr-demo')
  })

  it('普通用户不能伪造管理员测试身份', async () => {
    const managerCookie = await login(app, 'manager-demo')
    const message = await app.inject({
      method: 'POST',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}/messages`,
      headers: { cookie: managerCookie },
      payload: { content: '以 HR 身份测试', test_role: 'HR' },
    })
    expect(message.statusCode).toBe(403)
    expect(message.json().error.code).toBe('FORBIDDEN')

    const artifact = await app.inject({
      method: 'POST',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}/artifacts/HR_RECRUITING_BRIEF/generate`,
      headers: { cookie: managerCookie },
      payload: { test_role: 'HR' },
    })
    expect(artifact.statusCode).toBe(403)
    expect(artifact.json().error.code).toBe('FORBIDDEN')
  })

  it('企业管理员可按 HR 身份测试，Trace 同时保留真实身份和测试身份', async () => {
    const adminCookie = await login(app, 'admin-demo')
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}/messages`,
      headers: { cookie: adminCookie },
      payload: { content: '请说明当前招聘画像的用途。', test_role: 'HR' },
    })
    expect(response.statusCode, response.body).toBe(202)
    const runId = response.json().run_id
    let trace
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const traceResponse = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/agent-runs/${runId}/trace`,
        headers: { cookie: adminCookie },
      })
      trace = traceResponse.json()
      if (trace.run.status === 'COMPLETED') break
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    expect(trace.actual_actor_role).toBe('ADMIN')
    expect(trace.run.effective_actor_role).toBe('HR')
    const started = trace.events.find((event: { type: string }) => event.type === 'run.started')
    expect(started.payload).toMatchObject({
      actor_user_id: 'admin-demo',
      actual_actor_role: 'ADMIN',
      test_actor_role: 'HR',
      effective_actor_role: 'HR',
    })
    const context = trace.events.find((event: { type: string }) => event.type === 'context.snapshot')
    expect(context.payload.task_state.current_user_role).toBe('HR')
  })

  it('Agent Run 只把检索命中摘要与来源注入 Harness', async () => {
    const managerCookie = await login(app, 'manager-demo')
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}/messages`,
      headers: { cookie: managerCookie },
      payload: { content: '这个岗位半年成功标准是什么' },
    })
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const status = await app.inject({
        method: 'GET',
        url: `/api/v1/agent-runs/${response.json().run_id}`,
        headers: { cookie: managerCookie },
      })
      if (status.json().run.status === 'COMPLETED') break
      await new Promise((resolve) => setTimeout(resolve, 10))
    }

    expect(capturedHarnessRequests.at(-1)?.enterprise_context.hits[0]).toMatchObject({
      knowledge_id: 'EK-ROLE-PM-001',
      source_ref: 'mock://role-profile/enterprise-pm',
    })
    expect(JSON.stringify(capturedHarnessRequests.at(-1)?.enterprise_context)).not.toContain('候选人')
  })

  it('企业上下文检索失败时记录安全事件并使用空上下文继续 Run', async () => {
    capturedHarnessRequests.length = 0
    const failingApp = await buildApp(config, {
      store: new MemoryStore(),
      harness: testHarness,
      enterpriseContextRetriever: {
        retrieve: async () => { throw new Error('database unavailable with internal details') },
      },
    })
    const managerCookie = await login(failingApp, 'manager-demo')
    const submitted = await failingApp.inject({
      method: 'POST',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}/messages`,
      headers: { cookie: managerCookie },
      payload: { content: '继续澄清' },
    })
    let runStatus = ''
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const status = await failingApp.inject({
        method: 'GET',
        url: `/api/v1/agent-runs/${submitted.json().run_id}`,
        headers: { cookie: managerCookie },
      })
      runStatus = status.json().run.status
      if (runStatus === 'COMPLETED') break
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    const adminCookie = await login(failingApp, 'admin-demo')
    const trace = await failingApp.inject({
      method: 'GET',
      url: `/api/v1/agent-runs/${submitted.json().run_id}/trace`,
      headers: { cookie: adminCookie },
    })

    expect(runStatus).toBe('COMPLETED')
    expect(trace.json().events).toContainEqual(expect.objectContaining({
      type: 'context.retrieval_failed',
      payload: {
        code: 'ENTERPRISE_CONTEXT_UNAVAILABLE',
        task: 'CLARIFY_MESSAGE',
      },
    }))
    expect(JSON.stringify(trace.json())).not.toContain('database unavailable')
    expect(capturedHarnessRequests.at(-1)?.enterprise_context.hits).toEqual([])
    await failingApp.close()
  })

  it('关闭企业上下文检索时不调用 Retriever，也不记录失败事件', async () => {
    let retrievalCalls = 0
    const disabledConfig = loadConfig({
      NODE_ENV: 'test',
      SESSION_SECRET: 'test-session-secret-that-is-long-enough',
      ENTERPRISE_CONTEXT_RETRIEVAL_ENABLED: 'false',
    })
    const disabledApp = await buildApp(disabledConfig, {
      store: new MemoryStore(),
      harness: testHarness,
      enterpriseContextRetriever: {
        retrieve: async () => {
          retrievalCalls += 1
          throw new Error('must not run')
        },
      },
    })
    const managerCookie = await login(disabledApp, 'manager-demo')
    const submitted = await disabledApp.inject({
      method: 'POST',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}/messages`,
      headers: { cookie: managerCookie },
      payload: { content: '继续澄清' },
    })
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const status = await disabledApp.inject({
        method: 'GET',
        url: `/api/v1/agent-runs/${submitted.json().run_id}`,
        headers: { cookie: managerCookie },
      })
      if (status.json().run.status === 'COMPLETED') break
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    const adminCookie = await login(disabledApp, 'admin-demo')
    const trace = await disabledApp.inject({
      method: 'GET',
      url: `/api/v1/agent-runs/${submitted.json().run_id}/trace`,
      headers: { cookie: adminCookie },
    })
    expect(retrievalCalls).toBe(0)
    expect(trace.json().events.map((event: { type: string }) => event.type))
      .not.toContain('context.retrieval_failed')
    await disabledApp.close()
  })

  it('caller 持久化事实时记录消息、Run 和提出人，并把 fact_id 写入 Agent 消息', async () => {
    const managerCookie = await login(app, 'manager-demo')
    const submitted = await app.inject({
      method: 'POST',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}/messages`,
      headers: { cookie: managerCookie },
      payload: { content: '入职 90 天完成产品路线图' },
    })
    const runId = submitted.json().run_id
    let completedRun: AgentRun | undefined
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const status = await app.inject({
        method: 'GET',
        url: `/api/v1/agent-runs/${runId}`,
        headers: { cookie: managerCookie },
      })
      completedRun = status.json().run
      if (completedRun?.status === 'COMPLETED') break
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    expect(completedRun?.status).toBe('COMPLETED')
    if (!completedRun) throw new Error('Run did not complete')
    const detail = (await app.inject({
      method: 'GET',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}`,
      headers: { cookie: managerCookie },
    })).json()
    const conversation = (await app.inject({
      method: 'GET',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}/messages`,
      headers: { cookie: managerCookie },
    })).json()
    const facts = detail.state.facts.filter(
      (item: { source_run_id: string | null }) => item.source_run_id === runId,
    )
    const output = conversation.items.find(
      (item: { id: string }) => item.id === completedRun.output_message_id,
    )

    expect(facts).toHaveLength(1)
    expect(facts[0]).toMatchObject({
      source_message_id: completedRun.input_message_id,
      proposed_by_user_id: 'manager-demo',
      status: 'DRAFT',
    })
    expect(output.structured_content).toMatchObject({
      fact_id: facts[0].id,
      fact_category: facts[0].category,
      fact_status: 'DRAFT',
    })
  })

  it('工具已保存事实后的恢复结果只关联一条事实卡，不由 caller 重复写入', async () => {
    const toolStore = new MemoryStore()
    let toolApp: FastifyInstance
    const toolPersistingHarness: HarnessAdapter = {
      run: async (request) => {
        const factDraft = {
          category: 'SUCCESS_CRITERION' as const,
          statement: '入职 90 天完成三个客户场景的标准化',
          source_refs: ['mock://role-profile/enterprise-pm'],
        }
        const save = await toolApp.inject({
          method: 'POST',
          url: '/internal/v1/harness/tools/save_fact_draft',
          headers: {
            authorization: `Bearer ${config.ROLE_AGENT_TOOL_TOKEN}`,
            'x-harness-session-id': `role-${request.role_state.id}`,
          },
          payload: factDraft,
        })
        expect(save.statusCode, save.body).toBe(200)
        expect(save.json().fact_id).toEqual(expect.any(String))
        return {
          kind: 'CLARIFICATION',
          persistence: 'TOOL',
          answer: '已从成功的工具调用恢复本轮结果。',
          question: '这个结果由谁验收？',
          fact_draft: {
            category: factDraft.category,
            statement: factDraft.statement,
          },
        }
      },
    }
    toolApp = await buildApp(config, { store: toolStore, harness: toolPersistingHarness })
    const managerCookie = await login(toolApp, 'manager-demo')
    const submitted = await toolApp.inject({
      method: 'POST',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}/messages`,
      headers: { cookie: managerCookie },
      payload: { content: '请记录新的成功标准' },
    })
    const runId = submitted.json().run_id
    let completedRun: AgentRun | undefined
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const status = await toolApp.inject({
        method: 'GET',
        url: `/api/v1/agent-runs/${runId}`,
        headers: { cookie: managerCookie },
      })
      completedRun = status.json().run
      if (completedRun?.status === 'COMPLETED') break
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    expect(completedRun?.status).toBe('COMPLETED')
    if (!completedRun) throw new Error('Run did not complete')
    const detail = (await toolApp.inject({
      method: 'GET',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}`,
      headers: { cookie: managerCookie },
    })).json()
    const conversation = (await toolApp.inject({
      method: 'GET',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}/messages`,
      headers: { cookie: managerCookie },
    })).json()
    const facts = detail.state.facts.filter(
      (item: { source_run_id: string | null }) => item.source_run_id === runId,
    )
    const output = conversation.items.find(
      (item: { id: string }) => item.id === completedRun.output_message_id,
    )

    expect(facts).toHaveLength(1)
    expect(output.structured_content.fact_id).toBe(facts[0].id)
    await toolApp.close()
  })

  it('同一 Run 的事实工具重试保持幂等，并拒绝写入第二条不同事实', async () => {
    const toolStore = new MemoryStore()
    let toolApp: FastifyInstance
    const toolPersistingHarness: HarnessAdapter = {
      run: async (request) => {
        const headers = {
          authorization: `Bearer ${config.ROLE_AGENT_TOOL_TOKEN}`,
          'x-harness-session-id': `role-${request.role_state.id}`,
        }
        const firstPayload = {
          category: 'SUCCESS_CRITERION' as const,
          statement: '入职 90 天完成三个客户场景的标准化',
          source_refs: ['mock://role-profile/enterprise-pm'],
        }
        const first = await toolApp.inject({
          method: 'POST',
          url: '/internal/v1/harness/tools/save_fact_draft',
          headers,
          payload: firstPayload,
        })
        const repeated = await toolApp.inject({
          method: 'POST',
          url: '/internal/v1/harness/tools/save_fact_draft',
          headers,
          payload: firstPayload,
        })
        const conflicting = await toolApp.inject({
          method: 'POST',
          url: '/internal/v1/harness/tools/save_fact_draft',
          headers,
          payload: {
            ...firstPayload,
            statement: '同一轮不应再写入的第二条事实',
          },
        })

        expect(first.statusCode, first.body).toBe(200)
        expect(repeated.statusCode, repeated.body).toBe(200)
        expect(repeated.json().fact_id).toBe(first.json().fact_id)
        expect(conflicting.statusCode).toBe(409)
        expect(conflicting.json().error.code).toBe('FACT_DRAFT_ALREADY_SAVED')
        return {
          kind: 'CLARIFICATION',
          persistence: 'TOOL',
          answer: '已记录本轮唯一事实。',
          question: '这个结果由谁验收？',
          fact_draft: {
            category: firstPayload.category,
            statement: firstPayload.statement,
          },
        }
      },
    }
    toolApp = await buildApp(config, { store: toolStore, harness: toolPersistingHarness })
    const managerCookie = await login(toolApp, 'manager-demo')
    const submitted = await toolApp.inject({
      method: 'POST',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}/messages`,
      headers: { cookie: managerCookie },
      payload: { content: '请记录唯一的成功标准' },
    })
    const runId = submitted.json().run_id
    let finalStatus = ''
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const status = await toolApp.inject({
        method: 'GET',
        url: `/api/v1/agent-runs/${runId}`,
        headers: { cookie: managerCookie },
      })
      finalStatus = status.json().run.status
      if (finalStatus === 'COMPLETED') break
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    expect(finalStatus).toBe('COMPLETED')
    const detail = (await toolApp.inject({
      method: 'GET',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}`,
      headers: { cookie: managerCookie },
    })).json()
    expect(detail.state.facts.filter(
      (item: { source_run_id: string | null }) => item.source_run_id === runId,
    )).toHaveLength(1)
    await toolApp.close()
  })

  it('内部产物工具拒绝与当前 Run 不匹配的类型，且不写入该草稿', async () => {
    const toolStore = new MemoryStore()
    let toolApp: FastifyInstance
    let saveAttempt: { statusCode: number; json(): { error: { code: string } } } | undefined
    const mismatchedArtifactHarness: HarnessAdapter = {
      run: async (request) => {
        saveAttempt = await toolApp.inject({
          method: 'POST',
          url: '/internal/v1/harness/tools/save_artifact_draft',
          headers: {
            authorization: `Bearer ${config.ROLE_AGENT_TOOL_TOKEN}`,
            'x-harness-session-id': `role-${request.role_state.id}`,
          },
          payload: {
            artifact_type: 'PUBLIC_JD',
            content: {
              title_and_basics: {
                title: request.role_state.title,
                location: '上海',
                employment_type: '全职',
                reporting_line: '产品负责人',
              },
              about_the_role: '错误类型不应写入。',
              what_you_will_do: ['推动关键任务落地'],
              what_we_look_for: ['具备结构化问题解决能力'],
            },
          },
        })
        throw new Error('测试在错误类型工具调用后停止本次 Run')
      },
    }
    toolApp = await buildApp(config, { store: toolStore, harness: mismatchedArtifactHarness })
    const managerCookie = await login(toolApp, 'manager-demo')
    const before = (await toolApp.inject({
      method: 'GET',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}`,
      headers: { cookie: managerCookie },
    })).json()
    const submitted = await toolApp.inject({
      method: 'POST',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}/artifacts/ROLE_PROFILE/generate`,
      headers: { cookie: managerCookie },
      payload: {},
    })
    expect(submitted.statusCode, submitted.body).toBe(202)
    const runId = submitted.json().run_id
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const status = await toolApp.inject({
        method: 'GET',
        url: `/api/v1/agent-runs/${runId}`,
        headers: { cookie: managerCookie },
      })
      if (status.json().run.status === 'FAILED') break
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    expect(saveAttempt?.statusCode).toBe(409)
    expect(saveAttempt?.json().error.code).toBe('HARNESS_ARTIFACT_TYPE_MISMATCH')
    const after = (await toolApp.inject({
      method: 'GET',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}`,
      headers: { cookie: managerCookie },
    })).json()
    expect(after.artifacts.filter((artifact: { type: string }) => artifact.type === 'PUBLIC_JD'))
      .toHaveLength(before.artifacts.filter((artifact: { type: string }) => artifact.type === 'PUBLIC_JD').length)
    await toolApp.close()
  })

  it('待确认事实阻断岗位画像生成，经理确认后正式生效并使旧产物失效', async () => {
    const managerCookie = await login(app, 'manager-demo')
    const created = await submitFactAndWait(app, managerCookie, '半年内完成三个客户场景标准化')
    const blocked = await app.inject({
      method: 'POST',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}/artifacts/ROLE_PROFILE/generate`,
      headers: { cookie: managerCookie },
      payload: {},
    })
    expect(blocked.statusCode).toBe(409)
    expect(blocked.json().error).toMatchObject({
      code: 'UNRESOLVED_FACTS_PENDING',
      details: { fact_ids: [created.fact.id], count: 1 },
    })
    expect(JSON.stringify(blocked.json().error.details)).not.toContain(created.fact.statement)

    const confirmed = await app.inject({
      method: 'POST',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}/facts/${created.fact.id}:decide`,
      headers: { cookie: managerCookie },
      payload: { decision: 'CONFIRM', expected_revision: created.state.revision },
    })
    expect(confirmed.statusCode, confirmed.body).toBe(200)
    expect(confirmed.json().fact).toMatchObject({ id: created.fact.id, status: 'CONFIRMED' })
    expect(confirmed.json().state.latest_artifacts).toMatchObject({
      ROLE_PROFILE: { status: 'INVALIDATED' },
      ASSESSMENT_SCORECARD: { status: 'INVALIDATED' },
    })
    expect(confirmed.json().invalidated_artifact_ids).toHaveLength(2)

    const allowed = await app.inject({
      method: 'POST',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}/artifacts/ROLE_PROFILE/generate`,
      headers: { cookie: managerCookie },
      payload: {},
    })
    expect(allowed.statusCode, allowed.body).toBe(202)
  })

  it('事实修订保留来源链，驳回后旧事实不可再次决策', async () => {
    const managerCookie = await login(app, 'manager-demo')
    const created = await submitFactAndWait(app, managerCookie, '原始成功标准')
    const revised = await app.inject({
      method: 'POST',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}/facts/${created.fact.id}:decide`,
      headers: { cookie: managerCookie },
      payload: {
        decision: 'REVISE',
        expected_revision: created.state.revision,
        reason: '补充可验收结果',
        replacement: {
          category: 'SUCCESS_CRITERION',
          statement: '入职 90 天完成产品路线图并通过评审',
        },
      },
    })
    expect(revised.statusCode, revised.body).toBe(200)
    expect(revised.json().fact).toMatchObject({
      status: 'DRAFT',
      supersedes_fact_id: created.fact.id,
      statement: '入职 90 天完成产品路线图并通过评审',
    })
    expect(revised.json().state.facts.find(
      (fact: { id: string }) => fact.id === created.fact.id,
    ).status).toBe('STALE')

    const rejected = await app.inject({
      method: 'POST',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}/facts/${revised.json().fact.id}:decide`,
      headers: { cookie: managerCookie },
      payload: {
        decision: 'REJECT',
        expected_revision: revised.json().state.revision,
        reason: '当前无法提供可靠验收口径',
      },
    })
    expect(rejected.statusCode, rejected.body).toBe(200)
    expect(rejected.json().fact).toMatchObject({
      status: 'STALE',
      decision_reason: '当前无法提供可靠验收口径',
    })
    const stale = await app.inject({
      method: 'POST',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}/facts/${created.fact.id}:decide`,
      headers: { cookie: managerCookie },
      payload: { decision: 'CONFIRM', expected_revision: rejected.json().state.revision },
    })
    expect(stale.statusCode).toBe(409)
    expect(stale.json().error.code).toBe('FACT_NOT_DECIDABLE')
  })

  it('事实决策只允许经理，管理员必须显式使用经理测试身份', async () => {
    const managerCookie = await login(app, 'manager-demo')
    const hrCookie = await login(app, 'hr-demo')
    const adminCookie = await login(app, 'admin-demo')
    const created = await submitFactAndWait(app, managerCookie, '补充一条待确认约束')
    const url = `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}/facts/${created.fact.id}:decide`

    const hrAttempt = await app.inject({
      method: 'POST', url, headers: { cookie: hrCookie },
      payload: { decision: 'CONFIRM', expected_revision: created.state.revision },
    })
    expect(hrAttempt.statusCode).toBe(403)
    const adminAttempt = await app.inject({
      method: 'POST', url, headers: { cookie: adminCookie },
      payload: { decision: 'CONFIRM', expected_revision: created.state.revision },
    })
    expect(adminAttempt.statusCode).toBe(403)
    const spoofed = await app.inject({
      method: 'POST', url, headers: { cookie: managerCookie },
      payload: {
        decision: 'CONFIRM',
        expected_revision: created.state.revision,
        test_role: 'MANAGER',
      },
    })
    expect(spoofed.statusCode).toBe(403)
    const adminAsManager = await app.inject({
      method: 'POST', url, headers: { cookie: adminCookie },
      payload: {
        decision: 'CONFIRM',
        expected_revision: created.state.revision,
        test_role: 'MANAGER',
      },
    })
    expect(adminAsManager.statusCode, adminAsManager.body).toBe(200)
    expect(store.listDecisionsForTest()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        actor_user_id: 'admin-demo',
        action: 'FACT_CONFIRMED',
        metadata: expect.objectContaining({
          actual_actor_role: 'ADMIN',
          effective_actor_role: 'MANAGER',
        }),
      }),
    ]))
  })

  it('兼容批量确认接口保持单次 Revision，任一无效 ID 时不部分写入', async () => {
    const managerCookie = await login(app, 'manager-demo')
    const created = await submitFactAndWait(app, managerCookie, '需要批量确认的事实')
    const failed = await app.inject({
      method: 'POST',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}/facts:confirm`,
      headers: { cookie: managerCookie },
      payload: {
        fact_ids: [created.fact.id, 'missing-fact'],
        expected_revision: created.state.revision,
      },
    })
    expect(failed.statusCode).toBe(404)
    const afterFailure = (await app.inject({
      method: 'GET',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}`,
      headers: { cookie: managerCookie },
    })).json().state
    expect(afterFailure.revision).toBe(created.state.revision)
    expect(afterFailure.facts.find((fact: { id: string }) => fact.id === created.fact.id).status)
      .toBe('DRAFT')

    const confirmed = await app.inject({
      method: 'POST',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}/facts:confirm`,
      headers: { cookie: managerCookie },
      payload: { fact_ids: [created.fact.id], expected_revision: created.state.revision },
    })
    expect(confirmed.statusCode, confirmed.body).toBe(200)
    expect(confirmed.json().state.revision).toBe(created.state.revision + 1)
  })

  it('消息接口立即落库并返回 202，企业管理员可读取完整执行 Trace', async () => {
    const cookie = await login(app, 'manager-demo')
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}/messages`,
      headers: { cookie },
      payload: { content: '半年内要建立一套可复用的商业化产品机制' },
    })
    expect(response.statusCode).toBe(202)
    const { run_id: runId } = response.json()
    expect(response.json().message.content).toBe('半年内要建立一套可复用的商业化产品机制')
    const managerTrace = await app.inject({
      method: 'GET',
      url: `/api/v1/agent-runs/${runId}/trace`,
      headers: { cookie },
    })
    expect(managerTrace.statusCode).toBe(403)

    const adminCookie = await login(app, 'admin-demo')
    let trace
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const traceResponse = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/agent-runs/${runId}/trace`,
        headers: { cookie: adminCookie },
      })
      trace = traceResponse.json()
      if (trace.run.status === 'COMPLETED') break
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    expect(trace.run.status).toBe('COMPLETED')
    expect(trace.events.map((event: { type: string }) => event.type)).toContain('question.ready')
    expect(trace.visibility).toEqual({
      mode: 'FULL_ADMIN',
      raw_user_message_logged: true,
      model_prompt_logged: true,
      model_response_logged: true,
      tool_arguments_logged: true,
      tool_results_logged: true,
      pii_screened_candidate_content_logged: true,
      secrets_exposed: false,
      hidden_reasoning_exposed: false,
    })
    expect(JSON.stringify(trace)).toContain('半年内要建立')
    expect(trace.events.map((event: { type: string }) => event.type)).toContain('context.snapshot')
    const runPage = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/agent-runs?page=1&page_size=1&q=企业产品经理',
      headers: { cookie: adminCookie },
    })
    expect(runPage.statusCode).toBe(200)
    expect(runPage.json()).toMatchObject({ page: 1, page_size: 1 })
    expect(runPage.json().total).toBeGreaterThanOrEqual(1)
    expect(runPage.json().items).toHaveLength(1)
    const contextEvent = trace.events.find(
      (event: { type: string }) => event.type === 'context.snapshot',
    )
    expect(contextEvent.payload.system_prompt.content).toContain('岗位画像澄清 Agent')
    expect(contextEvent.payload.current_user_input.content.message).toContain('半年内要建立')
    expect(contextEvent.payload.short_term_memory.source).toBe('RECENT_CONVERSATION')
    expect(contextEvent.payload.long_term_memory.source).toBe('BUSINESS_DATABASE')
    expect(trace.events.map((event: { type: string }) => event.type)).toContain('model.request')
    expect(trace.events.map((event: { type: string }) => event.type)).toContain('model.response')
    expect(trace.events.find((event: { type: string }) => event.type === 'tool.started').payload)
      .toHaveProperty('arguments')

    const messages = await app.inject({
      method: 'GET',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}/messages`,
      headers: { cookie },
    })
    expect(messages.statusCode).toBe(200)
    expect(messages.json().items.map((item: { sender_type: string }) => item.sender_type)).toEqual([
      'HUMAN',
      'AGENT',
    ])
    expect(messages.json().policy.opened_rounds).toBe(1)
  })

  it('普通问答会直接回应，不保存岗位事实也不消耗主动澄清轮次', async () => {
    const cookie = await login(app, 'manager-demo')
    const before = (
      await app.inject({
        method: 'GET',
        url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}`,
        headers: { cookie },
      })
    ).json()
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}/messages`,
      headers: { cookie },
      payload: { content: '你在吗？你可以干啥？' },
    })
    expect(response.statusCode).toBe(202)
    const runId = response.json().run_id
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const status = await app.inject({
        method: 'GET',
        url: `/api/v1/agent-runs/${runId}`,
        headers: { cookie },
      })
      if (status.json().run.status === 'COMPLETED') break
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    const conversation = (
      await app.inject({
        method: 'GET',
        url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}/messages`,
        headers: { cookie },
      })
    ).json()
    const after = (
      await app.inject({
        method: 'GET',
        url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}`,
        headers: { cookie },
      })
    ).json()

    expect(conversation.items.at(-1).content).toContain('我在')
    expect(conversation.items.at(-1).structured_content.kind).toBe('CONVERSATION')
    expect(conversation.policy.opened_rounds).toBe(0)
    expect(after.state.facts).toHaveLength(before.state.facts.length)
  })

  it('存在待回答澄清题时，普通问答不会误完成当前轮或开启下一轮', async () => {
    const cookie = await login(app, 'manager-demo')
    const factResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}/messages`,
      headers: { cookie },
      payload: { content: '这个岗位半年内要完成一个真实客户验证' },
    })
    const factRunId = factResponse.json().run_id
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const status = await app.inject({
        method: 'GET',
        url: `/api/v1/agent-runs/${factRunId}`,
        headers: { cookie },
      })
      if (status.json().run.status === 'COMPLETED') break
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    const beforeQuestion = (
      await app.inject({
        method: 'GET',
        url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}/messages`,
        headers: { cookie },
      })
    ).json()
    expect(beforeQuestion.policy.opened_rounds).toBe(1)
    expect(beforeQuestion.policy.completed_rounds).toBe(0)

    const chatResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}/messages`,
      headers: { cookie },
      payload: { content: '你在吗？你可以干啥？' },
    })
    const chatRunId = chatResponse.json().run_id
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const status = await app.inject({
        method: 'GET',
        url: `/api/v1/agent-runs/${chatRunId}`,
        headers: { cookie },
      })
      if (status.json().run.status === 'COMPLETED') break
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    const afterQuestion = (
      await app.inject({
        method: 'GET',
        url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}/messages`,
        headers: { cookie },
      })
    ).json()

    expect(afterQuestion.policy.opened_rounds).toBe(1)
    expect(afterQuestion.policy.completed_rounds).toBe(0)
    expect(afterQuestion.policy.open_round_id).toBe(beforeQuestion.policy.open_round_id)
    expect(afterQuestion.items.at(-2).clarification_round_id).toBeNull()
    expect(afterQuestion.items.at(-1).structured_content.kind).toBe('CONVERSATION')
  })

  it('经理、HR与企业管理员都能用真实身份和 Agent 对话', async () => {
    for (const userId of ['manager-demo', 'hr-demo', 'admin-demo'] as const) {
      const cookie = await login(app, userId)
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}/messages`,
        headers: { cookie },
        payload: { content: `${userId} 补充岗位信息` },
      })
      expect(response.statusCode, response.body).toBe(202)
      const runId = response.json().run_id
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const status = await app.inject({
          method: 'GET',
          url: `/api/v1/agent-runs/${runId}`,
          headers: { cookie },
        })
        if (status.json().run.status === 'COMPLETED') break
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
    }
    const adminCookie = await login(app, 'admin-demo')
    const messages = (
      await app.inject({
        method: 'GET',
        url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}/messages`,
        headers: { cookie: adminCookie },
      })
    ).json().items
    expect(messages.filter((item: { sender_type: string }) => item.sender_type === 'HUMAN'))
      .toMatchObject([
        { sender_role: 'MANAGER' },
        { sender_role: 'HR' },
        { sender_role: 'ADMIN' },
      ])
  })

  it('主动澄清预算由企业策略控制，达到上限后可审计地增加轮数', async () => {
    const adminCookie = await login(app, 'admin-demo')
    const policyUpdate = await app.inject({
      method: 'PUT',
      url: '/api/v1/admin/agent-policy',
      headers: { cookie: adminCookie },
      payload: { initial_budget: 1, extension_size: 2 },
    })
    expect(policyUpdate.statusCode).toBe(200)

    const managerCookie = await login(app, 'manager-demo')
    const first = await app.inject({
      method: 'POST',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}/messages`,
      headers: { cookie: managerCookie },
      payload: { content: '先确认这个岗位的招聘原因' },
    })
    const firstRunId = first.json().run_id
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const status = await app.inject({
        method: 'GET',
        url: `/api/v1/agent-runs/${firstRunId}`,
        headers: { cookie: managerCookie },
      })
      if (status.json().run.status === 'COMPLETED') break
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    const second = await app.inject({
      method: 'POST',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}/messages`,
      headers: { cookie: managerCookie },
      payload: { content: '半年内形成可复用的方法并完成一次验证' },
    })
    const secondRunId = second.json().run_id
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const status = await app.inject({
        method: 'GET',
        url: `/api/v1/agent-runs/${secondRunId}`,
        headers: { cookie: managerCookie },
      })
      if (status.json().run.status === 'COMPLETED') break
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    const beforeExtend = (
      await app.inject({
        method: 'GET',
        url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}/messages`,
        headers: { cookie: managerCookie },
      })
    ).json().policy
    expect(beforeExtend).toMatchObject({
      initial_budget: 1,
      completed_rounds: 1,
      status: 'LIMIT_REACHED',
    })

    const extended = await app.inject({
      method: 'POST',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}/clarification:extend`,
      headers: { cookie: managerCookie },
      payload: { reason: '仍需确认结果验收口径' },
    })
    expect(extended.statusCode).toBe(200)
    expect(extended.json().policy).toMatchObject({ granted_rounds: 2, status: 'ACTIVE' })
  })

  it('候选人资料发现手机号时在进入模型前拒绝', async () => {
    const cookie = await login(app, 'hr-demo')
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}/candidates:import`,
      headers: { cookie },
      payload: {
        candidates: [
          {
            candidate_ref: 'CAND-001',
            channel: '内推',
            format: 'TEXT',
            content: '负责增长产品，手机号 13812345678',
          },
        ],
      },
    })
    expect(response.statusCode).toBe(422)
    expect(response.json().error.code).toBe('CANDIDATE_PII_DETECTED')
  })

  it('按 content_hash 确认四段式 JD', async () => {
    const cookie = await login(app, 'manager-demo')
    const detailResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}`,
      headers: { cookie },
    })
    const detail = detailResponse.json()
    const jd = detail.state.latest_artifacts.PUBLIC_JD
    const confirmResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}/artifacts/${jd.id}:confirm`,
      headers: { cookie },
      payload: {
        content_hash: jd.content_hash,
        expected_revision: detail.state.revision,
      },
    })
    expect(confirmResponse.statusCode, confirmResponse.body).toBe(200)
    expect(confirmResponse.json().artifact.status).toBe('CONFIRMED')
  })

  it('10/2/2 边界命中后必须先经 HR 审核，再创建经理校准任务', async () => {
    const hrCookie = await login(app, 'hr-demo')
    const candidates = Array.from({ length: 10 }, (_, index) => ({
      candidate_ref: `CAND-${String(index + 1).padStart(3, '0')}`,
      channel: index % 2 === 0 ? '内推' : '招聘网站',
      format: 'TEXT',
      content:
        index < 2
          ? '参与商业产品项目，但业务判断证据不足，需要面试验证'
          : '负责业务产品与跨团队协作，完成方案验证',
    }))
    const importResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}/candidates:import`,
      headers: { cookie: hrCookie },
      payload: { candidates },
    })
    expect(importResponse.statusCode).toBe(202)
    const runId = importResponse.json().run_id
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const traceResponse = await app.inject({
        method: 'GET',
        url: `/api/v1/agent-runs/${runId}`,
        headers: { cookie: hrCookie },
      })
      if (traceResponse.json().run.status === 'COMPLETED') break
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    const hrDetailResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}`,
      headers: { cookie: hrCookie },
    })
    const hrDetail = hrDetailResponse.json()
    expect(hrDetail.state.calibration_status).toBe('HR_REVIEW')
    expect(hrDetail.state.candidate_count).toBe(10)
    const signal = hrDetail.calibration_signals[0]
    const reviewResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}/calibration-signals/${signal.id}:review`,
      headers: { cookie: hrCookie },
      payload: {
        decision: 'APPROVE',
        reason: '两个渠道均重复出现相同能力证据卡点',
        expected_revision: hrDetail.state.revision,
      },
    })
    expect(reviewResponse.statusCode, reviewResponse.body).toBe(200)
    expect(reviewResponse.json().task.status).toBe('OPEN')

    const managerCookie = await login(app, 'manager-demo')
    const managerDetail = (
      await app.inject({
        method: 'GET',
        url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}`,
        headers: { cookie: managerCookie },
      })
    ).json()
    expect(managerDetail.calibration_signals).toBeUndefined()
    expect(managerDetail.manager_tasks).toHaveLength(1)
    const task = managerDetail.manager_tasks[0]
    const decisionResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}/manager-tasks/${task.id}:decide`,
      headers: { cookie: managerCookie },
      payload: {
        decision: 'APPROVE',
        reason: '同意重开岗位画像草稿，优先校准业务判断锚点',
        expected_revision: managerDetail.state.revision,
      },
    })
    expect(decisionResponse.statusCode, decisionResponse.body).toBe(200)
    expect(decisionResponse.json().task.status).toBe('ACCEPTED')
  })

  it('未登录请求不能通过请求参数伪造角色', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}?actor_role=HR&tenant_id=tenant-demo`,
    })
    expect(response.statusCode).toBe(401)
  })

  it('服务重启后会关闭中断的 Run，并在对话中保留可重试提示', async () => {
    const store = new MemoryStore()
    await store.initialize()
    const createdAt = new Date().toISOString()
    await store.createRun({
      id: '22222222-2222-4222-8222-222222222222',
      role_session_id: DEMO_ROLE_SESSION_ID,
      actor_user_id: 'hr-demo',
      effective_actor_role: 'HR',
      status: 'RUNNING',
      model_tier: 'FLASH',
      task: 'CLARIFY_MESSAGE',
      harness_session_id: `role-${DEMO_ROLE_SESSION_ID}`,
      prompt_version: 'role-clarifier-v1',
      model_name: 'deepseek-v4-flash',
      tool_count: 0,
      input_tokens: 0,
      output_tokens: 0,
      started_at: createdAt,
      completed_at: null,
      error_code: null,
      input_message_id: '33333333-3333-4333-8333-333333333333',
      output_message_id: null,
    })
    await store.appendConversationMessage({
      id: '33333333-3333-4333-8333-333333333333',
      tenant_id: 'tenant-demo',
      role_session_id: DEMO_ROLE_SESSION_ID,
      run_id: '22222222-2222-4222-8222-222222222222',
      clarification_round_id: null,
      sender_type: 'HUMAN',
      sender_user_id: 'hr-demo',
      sender_role: 'HR',
      sender_name: 'HR · 林夏',
      content: '这条消息在部署切换时仍在执行',
      structured_content: null,
      status: 'COMPLETED',
      sequence: 1,
      created_at: createdAt,
      completed_at: createdAt,
    })

    const recoveringApp = await buildApp(config, { store, harness: testHarness })
    const recovered = await store.getRun('22222222-2222-4222-8222-222222222222')
    const messages = await store.listConversationMessages(DEMO_ROLE_SESSION_ID)
    const events = await store.listRunEvents('22222222-2222-4222-8222-222222222222')

    expect(recovered?.run.status).toBe('FAILED')
    expect(recovered?.run.error_code).toBe('RUN_INTERRUPTED')
    expect(messages.at(-1)?.sender_type).toBe('SYSTEM')
    expect(messages.at(-1)?.content).toContain('原消息已保留')
    expect(events.map((event) => event.type)).toEqual(['run.failed', 'assistant.completed'])
    await recoveringApp.close()
  })
})
