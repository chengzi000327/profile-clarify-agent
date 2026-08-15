import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from './app.js'
import { loadConfig } from './config.js'
import { MemoryStore } from './store/memory-store.js'
import { DEMO_ROLE_SESSION_ID } from './store/seed.js'

const config = loadConfig({
  NODE_ENV: 'test',
  SESSION_SECRET: 'test-session-secret-that-is-long-enough',
  HARNESS_MODE: 'mock',
})

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
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { user_id: userId },
  })
  expect(response.statusCode).toBe(200)
  return cookieFrom(response)
}

describe('Role Clarifier API', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    app = await buildApp(config, { store: new MemoryStore() })
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
  })

  it('消息接口立即落库并返回 202，企业管理员可读取不含用户原文的 Trace', async () => {
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
    expect(trace.privacy).toEqual({
      raw_user_message_logged: false,
      candidate_content_logged: false,
      hidden_reasoning_exposed: false,
    })
    expect(JSON.stringify(trace)).not.toContain('半年内要建立')

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

    const recoveringApp = await buildApp(config, { store })
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
