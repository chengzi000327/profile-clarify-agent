import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import {
  ROLE_CLARIFIER_SYSTEM_PROMPT,
  type ArtifactType,
  type CandidateEvidence,
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
import { DEMO_ROLE_SESSION_ID } from './store/seed.js'

const config = loadConfig({
  NODE_ENV: 'test',
  SESSION_SECRET: 'test-session-secret-that-is-long-enough',
})

class TestHarnessStub implements HarnessAdapter {
  async run(request: HarnessRequest, hooks: HarnessHooks): Promise<HarnessResult> {
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
      long_term_memory: { source: 'BUSINESS_DATABASE', role_state: roleState },
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
    const content = artifactType === 'PUBLIC_JD'
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
      : artifactType === 'ASSESSMENT_SCORECARD'
        ? {
            dimensions: [{
              name: '业务判断',
              weight: 100,
              method: '结构化案例面试',
              owner: '用人经理',
              question: '请说明一次关键业务取舍。',
              evidence: '能够说明约束、取舍和结果。',
              anchors: { 1: '无法说明取舍', 3: '能完成基本判断', 5: '能验证复杂取舍' },
            }],
            decision_rule: {
              status: '待确认',
              scoring: '各维度按 1-5 分评分',
              pass_thresholds: '加权总分不低于 3.5',
              calibration: '由 HR 和用人经理校准',
            },
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

describe('Role Clarifier API', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    app = await buildApp(config, { store: new MemoryStore(), harness: testHarness })
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

  it('动态账号选择角色：新账号为空，同一账号恢复岗位，不同账号互相隔离', async () => {
    const loginDynamic = async (accountId: string, displayName: string, role = 'MANAGER') => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          workspace_id: 'acme-demo',
          account_id: accountId,
          display_name: displayName,
          role,
        },
      })
      return { response, cookie: response.statusCode === 200 ? cookieFrom(response) : '' }
    }

    const first = await loginDynamic('zhangsan', '张三')
    expect(first.response.statusCode).toBe(200)
    expect(first.response.json()).toMatchObject({
      is_new_account: true,
      actor: { display_name: '张三', role: 'MANAGER' },
    })
    const initiallyEmpty = await app.inject({
      method: 'GET',
      url: '/api/v1/role-sessions',
      headers: { cookie: first.cookie },
    })
    expect(initiallyEmpty.json().items).toEqual([])

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/role-sessions',
      headers: { cookie: first.cookie },
      payload: { title: '增长负责人', department: '增长团队' },
    })
    expect(created.statusCode).toBe(201)

    const sameAccount = await loginDynamic('zhangsan', '张三')
    expect(sameAccount.response.json().is_new_account).toBe(false)
    const restored = await app.inject({
      method: 'GET',
      url: '/api/v1/role-sessions',
      headers: { cookie: sameAccount.cookie },
    })
    expect(restored.json().items).toHaveLength(1)

    const second = await loginDynamic('lisi', '李四')
    const isolated = await app.inject({
      method: 'GET',
      url: '/api/v1/role-sessions',
      headers: { cookie: second.cookie },
    })
    expect(isolated.json().items).toEqual([])

    const roleMismatch = await loginDynamic('zhangsan', '张三', 'HR')
    expect(roleMismatch.response.statusCode).toBe(409)
    expect(roleMismatch.response.json().error.code).toBe('ACCOUNT_ROLE_MISMATCH')
  })

  it('空账号发送第一条消息后自动建立岗位并由 Agent 识别岗位名称', async () => {
    const loginResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        workspace_id: 'conversation-first-demo',
        account_id: 'manager-one',
        display_name: '对话经理',
        role: 'MANAGER',
      },
    })
    const cookie = cookieFrom(loginResponse)
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
    expect(roles.json().items).toHaveLength(1)
    expect(roles.json().items[0].title).toBe('企业产品经理')
    const messages = await app.inject({
      method: 'GET',
      url: `/api/v1/role-sessions/${intake.json().role.state.id}/messages`,
      headers: { cookie },
    })
    expect(messages.json().items.map((item: { sender_type: string }) => item.sender_type))
      .toEqual(['HUMAN', 'AGENT'])
  })

  it('飞书事件可开启同一岗位澄清链路并回传 Agent 与岗位画像卡片', async () => {
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
    })
    const feishuApp = await buildApp(feishuConfig, {
      store: new MemoryStore(),
      harness: testHarness,
      feishuClient: {
        configured: () => true,
        sendText: async (chatId, text) => {
          texts.push({ chatId, text })
        },
        sendCard: async (chatId, card) => {
          cards.push({ chatId, card })
        },
      },
    })
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
    for (let attempt = 0; attempt < 60 && cards.length < 1; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    expect(cards).toHaveLength(1)
    expect(JSON.stringify(cards[0]?.card)).toContain('岗位画像')
    expect(JSON.stringify(cards[0]?.card)).not.toContain('"tag":"a"')

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

  it('结构化评估方案可以生成并保存为前端可消费的数据', async () => {
    const managerCookie = await login(app, 'manager-demo')
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}/artifacts/ASSESSMENT_SCORECARD/generate`,
      headers: { cookie: managerCookie },
    })
    expect(response.statusCode, response.body).toBe(202)

    const runId = response.json().run_id
    let completedRun
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const run = await app.inject({
        method: 'GET',
        url: `/api/v1/agent-runs/${runId}`,
        headers: { cookie: managerCookie },
      })
      completedRun = run.json().run
      if (completedRun.status === 'COMPLETED' || completedRun.status === 'FAILED') break
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    let failureDetail: unknown = completedRun
    if (completedRun?.status === 'FAILED') {
      const adminCookie = await login(app, 'admin-demo')
      const trace = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/agent-runs/${runId}/trace`,
        headers: { cookie: adminCookie },
      })
      failureDetail = trace.json().events.find((event: { type: string }) => event.type === 'run.failed')
    }
    expect(completedRun?.status, JSON.stringify(failureDetail)).toBe('COMPLETED')

    const role = await app.inject({
      method: 'GET',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}`,
      headers: { cookie: managerCookie },
    })
    expect(role.statusCode).toBe(200)
    expect(role.json().state.latest_artifacts.ASSESSMENT_SCORECARD.content).toMatchObject({
      dimensions: [expect.objectContaining({
        name: '业务判断',
        anchors: { 1: '无法说明取舍', 3: '能完成基本判断', 5: '能验证复杂取舍' },
      })],
      decision_rule: {
        status: '待确认',
        scoring: '各维度按 1-5 分评分',
        pass_thresholds: '加权总分不低于 3.5',
        calibration: '由 HR 和用人经理校准',
      },
    })
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
