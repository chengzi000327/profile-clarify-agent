import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import {
  ROLE_CLARIFIER_SYSTEM_PROMPT,
  RoleProfileContentSchema,
  RoleProfileTalentDraftContentSchema,
  type ArtifactType,
  type CandidateEvidence,
  type RoleProfileJobDescriptionContent,
  type RoleProfileTalentDraftContent,
} from '@role-clarifier/contracts'
import { contentHash } from '@role-clarifier/domain'
import { buildApp, visibleAgentEvent } from './app.js'
import { buildLegacyRoleProfileProjection, RoleService } from './services/role-service.js'
import type {
  HarnessAdapter,
  HarnessHooks,
  HarnessRequest,
  HarnessResult,
} from './agent/harness-adapter.js'
import { loadConfig } from './config.js'
import { MemoryStore } from './store/memory-store.js'
import { createDemoAggregate, DEMO_ROLE_SESSION_ID } from './store/seed.js'

const managerActor = {
  tenant_id: 'tenant-demo',
  user_id: 'manager-demo',
  role: 'MANAGER',
  display_name: '用人经理 · 陈曦',
} as const

const validJobDescription = {
  hiring_background: {
    business_change: '业务从客户项目交付转向可复用的平台能力。',
    organization_gap: '当前缺少持续定义平台产品边界的负责人。',
    hiring_conclusion: '招聘一名企业产品经理负责平台化产品规划。',
    no_hire_impact: '共性需求会持续重复建设，业务响应速度下降。',
    evidence_refs: ['HC-2026-EP-001'],
  },
  job_purpose: {
    statement: '将高频客户需求沉淀为可复用的企业产品能力。',
    evidence_refs: ['HC-2026-EP-001'],
  },
  key_accountabilities: [{
    id: 'KRA-01',
    name: '平台产品规划',
    responsibility: '持续识别共性需求并定义产品边界和路线图。',
    core_outputs: ['平台产品路线图'],
    success_outcome_refs: ['O-01'],
    evidence_refs: ['HC-2026-EP-001'],
  }],
  success_criteria: [
    {
      id: 'O-01', horizon: '3个月', title: '形成平台产品路线图',
      definition: '完成现状诊断，明确产品范围和优先级。', measures: ['路线图通过评审'],
      status: '待确认', evidence_refs: ['HC-2026-EP-001'],
    },
    {
      id: 'O-02', horizon: '6个月', title: '验证重点平台能力',
      definition: '完成重点场景验证并形成复盘。', measures: ['重点场景完成验收'],
      status: '待确认', evidence_refs: ['HC-2026-EP-001'],
    },
    {
      id: 'O-03', horizon: '12个月', title: '形成规模化复用',
      definition: '平台能力在多个业务场景稳定复用。', measures: ['复用范围达到年度目标'],
      status: '待确认', evidence_refs: ['HC-2026-EP-001'],
    },
  ],
  work_scenarios: [{
    id: 'S-01',
    title: '共性需求抽象',
    frequency: '每周',
    trigger: '多个客户提出相似需求。',
    actions: '识别共性并定义产品边界。',
    output: '产品机会与优先级清单。',
    challenge: '平衡短期交付诉求与长期复用价值。',
    stakeholders: ['研发', '交付'],
    success_outcome_refs: ['O-01'],
    evidence_refs: ['HC-2026-EP-001'],
  }],
  boundaries: {
    owns: ['产品边界和产品路线图'],
    does_not_own: ['单客户项目交付'],
    decision_rights: ['提出产品优先级取舍建议'],
    key_collaborations: ['研发', '交付'],
    available_resources: ['客户反馈与项目复盘'],
    evidence_refs: ['HC-2026-EP-001'],
  },
} as const

const validTalentProfile = {
  target_talent_profile: {
    core_definition: '能在复杂企业场景中平衡业务价值与产品长期复用的产品负责人。',
    transferable_backgrounds: ['企业服务产品规划经历'],
    fit_signals: ['能说明需求优先级取舍依据'],
    non_target_and_misjudgments: ['只负责单一客户项目交付的候选人'],
    attraction_factors: ['参与平台能力从零到一建设'],
    evidence_refs: ['HC-2026-EP-001'],
  },
  qualifications: {
    hard_qualifications: [],
    necessary_experience: [{
      id: 'Q-EXP-01',
      name: '企业服务产品规划经历',
      definition: '具备企业服务产品规划和路线图推进经验。',
      maps_to: ['KRA-01'],
      observable_evidence: ['能复盘一次从需求抽象到路线图评审的过程。'],
      evidence_refs: ['HC-2026-EP-001'],
      status: '推断',
    }],
    role_conditions: [],
    must_have: [{
      id: 'Q-MUST-01',
      name: '跨团队协同',
      definition: '能够推动研发与交付围绕共同优先级协作。',
      maps_to: ['O-01'],
      observable_evidence: ['能说明一次跨团队目标对齐和推进结果。'],
      evidence_refs: ['HC-2026-EP-001'],
      status: '推断',
    }],
    preferred: [{
      id: 'Q-PREF-01',
      name: '平台化经验',
      definition: '有将重复交付沉淀为平台能力的经验。',
      maps_to: ['O-03'],
      observable_evidence: ['能展示平台能力在多个场景复用的结果。'],
      evidence_refs: ['HC-2026-EP-001'],
      status: '推断',
    }],
    alternatives: [{
      id: 'Q-ALT-01',
      name: '可迁移的复杂协同经验',
      definition: '具备在复杂协同环境中推进共识和落地的经验。',
      maps_to: ['S-01'],
      observable_evidence: ['能说明在冲突目标下的取舍和结果。'],
      evidence_refs: ['HC-2026-EP-001'],
      status: '推断',
    }],
  },
  competency_model: {
    knowledge: [],
    skills: [{
      id: 'C-SKILL-01',
      name: '结构化需求判断',
      definition: '能将客户诉求转化为可验证的产品优先级。',
      maps_to: ['S-01'],
      observable_evidence: ['能说明取舍框架和最终决策。'],
      evidence_refs: ['HC-2026-EP-001'],
      status: '推断',
    }],
    behavioral_competencies: [],
    values_and_work_style: [],
    career_motivation: [],
  },
} as const

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
    const roleProfileMode = (request.role_state as unknown as {
      task_context?: { role_profile_mode?: 'JOB_DESCRIPTION' | 'TALENT_PROFILE' }
    }).task_context?.role_profile_mode
      ?? ((request.role_state.latest_artifacts.ROLE_PROFILE?.content as { stage?: string } | undefined)?.stage
        === 'JOB_DESCRIPTION_CONFIRMED'
        ? 'TALENT_PROFILE'
        : 'JOB_DESCRIPTION')
    const content = artifactType === 'ROLE_PROFILE'
      ? roleProfileMode === 'JOB_DESCRIPTION'
        ? { job_description: validJobDescription }
        : { talent_profile: validTalentProfile }
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

describe('Role Clarifier API', () => {
  let app: FastifyInstance
  let store: MemoryStore
  let roleService: RoleService

  beforeEach(async () => {
    store = new MemoryStore()
    roleService = new RoleService(store)
    app = await buildApp(config, { store, harness: testHarness })
  })

  it('预置 ROLE_PROFILE 是已确认的 V2 人才画像，并保留确定性兼容投影', () => {
    const aggregate = createDemoAggregate()
    const seedRoleProfile = aggregate.artifacts.find((artifact) => artifact.type === 'ROLE_PROFILE')

    expect(seedRoleProfile).toMatchObject({
      type: 'ROLE_PROFILE',
      status: 'CONFIRMED',
      content: {
        schema_version: '2',
        stage: 'TALENT_PROFILE_DRAFT',
        job_description_confirmation: expect.any(Object),
        talent_profile: expect.any(Object),
        mission: expect.any(String),
        requirements: expect.any(Array),
      },
    })
    expect(seedRoleProfile).toBeDefined()

    const parsed = RoleProfileContentSchema.safeParse(seedRoleProfile!.content)
    expect(parsed.success).toBe(true)
    const talentParsed = RoleProfileTalentDraftContentSchema.safeParse(seedRoleProfile!.content)
    expect(talentParsed.success).toBe(true)
    if (!talentParsed.success) {
      throw new Error('预置 ROLE_PROFILE 必须是 V2 TALENT_PROFILE_DRAFT 内容')
    }

    const content = talentParsed.data
    expect(content.job_description_confirmation).toMatchObject({
      source_artifact_id: expect.any(String),
      confirmed_by: 'manager-demo',
      confirmed_at: expect.any(String),
    })
    expect(content.job_description_confirmation.section_hash).toBe(contentHash(content.job_description))
    expect({
      hiring_reason: content.hiring_reason,
      mission: content.mission,
      success_outcomes: content.success_outcomes,
      work_scenarios: content.work_scenarios,
      boundaries: content.boundaries,
      requirements: content.requirements,
    }).toEqual(buildLegacyRoleProfileProjection(content))

    expect(aggregate.artifacts.filter((artifact) => artifact.type !== 'ROLE_PROFILE')).toMatchObject([
      { type: 'ASSESSMENT_SCORECARD', version: 1, status: 'CONFIRMED', created_by: 'manager-demo' },
      { type: 'PUBLIC_JD', version: 1, status: 'DRAFT', created_by: 'manager-demo' },
      { type: 'HR_RECRUITING_BRIEF', version: 1, status: 'DRAFT', created_by: 'hr-demo' },
    ])
    expect(aggregate).toMatchObject({
      member_ids: ['manager-demo', 'hr-demo'],
      candidates: [],
      calibration_signals: [],
      manager_tasks: [],
    })
  })

  it('每次创建预置聚合时隔离 ROLE_PROFILE 内容变更', () => {
    const first = createDemoAggregate()
    const second = createDemoAggregate()
    const firstContent = first.artifacts.find((artifact) => artifact.type === 'ROLE_PROFILE')!.content as {
      job_description: { job_purpose: { statement: string } }
    }
    const secondContent = second.artifacts.find((artifact) => artifact.type === 'ROLE_PROFILE')!.content as {
      job_description: { job_purpose: { statement: string } }
    }
    const originalPurpose = secondContent.job_description.job_purpose.statement

    try {
      firstContent.job_description.job_purpose.statement = '不应泄漏到下一次预置聚合的测试变更'
      expect(secondContent.job_description.job_purpose.statement).toBe(originalPurpose)
    } finally {
      firstContent.job_description.job_purpose.statement = originalPurpose
    }
  })

  const lockJobDescription = async () => {
    const draft = await roleService.saveArtifactDraft(
      DEMO_ROLE_SESSION_ID,
      managerActor,
      'ROLE_PROFILE',
      { job_description: validJobDescription },
    )
    const afterDraft = await roleService.get(DEMO_ROLE_SESSION_ID, managerActor)
    const locked = await roleService.confirmArtifact(
      DEMO_ROLE_SESSION_ID,
      draft.id,
      managerActor,
      draft.content_hash,
      afterDraft.state.revision,
    )
    return { locked, afterLock: await roleService.get(DEMO_ROLE_SESSION_ID, managerActor) }
  }

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

  it('首次生成 ROLE_PROFILE 保存岗位说明草稿，并在未确认时拒绝再次生成', async () => {
    const managerCookie = await login(app, 'manager-demo')
    const generated = await app.inject({
      method: 'POST',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}/artifacts/ROLE_PROFILE/generate`,
      headers: { cookie: managerCookie },
    })
    expect(generated.statusCode, generated.body).toBe(202)

    for (let attempt = 0; attempt < 30; attempt += 1) {
      const status = await app.inject({
        method: 'GET',
        url: `/api/v1/agent-runs/${generated.json().run_id}`,
        headers: { cookie: managerCookie },
      })
      if (status.json().run.status === 'COMPLETED') break
      await new Promise((resolve) => setTimeout(resolve, 10))
    }

    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}`,
      headers: { cookie: managerCookie },
    })
    expect(detail.statusCode).toBe(200)
    const draft = detail.json().state.latest_artifacts.ROLE_PROFILE
    expect(draft).toMatchObject({
      status: 'DRAFT',
      content: {
        schema_version: '2',
        stage: 'JOB_DESCRIPTION_DRAFT',
        job_description: validJobDescription,
      },
    })
    await expect(roleService.assertArtifactGenerationAllowed(
      DEMO_ROLE_SESSION_ID,
      managerActor,
      'MANAGER',
      'ROLE_PROFILE',
    )).rejects.toMatchObject({ code: 'JOB_DESCRIPTION_CONFIRMATION_REQUIRED' })
  })

  it('第一次确认 ROLE_PROFILE 只锁定岗位说明并创建只追加版本', async () => {
    const managerCookie = await login(app, 'manager-demo')
    const before = await app.inject({
      method: 'GET',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}`,
      headers: { cookie: managerCookie },
    })
    const draft = await roleService.saveArtifactDraft(
      DEMO_ROLE_SESSION_ID,
      managerActor,
      'ROLE_PROFILE',
      { job_description: validJobDescription },
    )
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}/artifacts/${draft.id}:confirm`,
      headers: { cookie: managerCookie },
      payload: {
        content_hash: draft.content_hash,
        expected_revision: before.json().state.revision + 1,
      },
    })

    expect(response.statusCode, response.body).toBe(200)
    const locked = response.json().artifact
    expect(locked).toMatchObject({
      type: 'ROLE_PROFILE',
      status: 'DRAFT',
      version: draft.version + 1,
      content: {
        schema_version: '2',
        stage: 'JOB_DESCRIPTION_CONFIRMED',
        job_description: validJobDescription,
        job_description_confirmation: {
          source_artifact_id: draft.id,
          confirmed_by: 'manager-demo',
        },
      },
    })
    expect(locked.id).not.toBe(draft.id)
    expect(locked.content.job_description_confirmation.section_hash)
      .toBe(contentHash(validJobDescription))
    expect((store as unknown as { decisions: Array<{ action: string; metadata: Record<string, unknown> }> }).decisions)
      .toContainEqual(expect.objectContaining({
        action: 'CONFIRM_ARTIFACT',
        metadata: expect.objectContaining({ confirmation_scope: 'JOB_DESCRIPTION' }),
      }))

    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}`,
      headers: { cookie: managerCookie },
    })
    expect(detail.json().state).toMatchObject({
      stage: 'PROFILE_DRAFT',
      latest_artifacts: { ROLE_PROFILE: { id: locked.id, status: 'DRAFT' } },
    })
    expect(detail.json().artifacts.filter((artifact: { type: string }) => artifact.type === 'ROLE_PROFILE'))
      .toHaveLength(3)

    const lockedAgain = await app.inject({
      method: 'POST',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}/artifacts/${locked.id}:confirm`,
      headers: { cookie: managerCookie },
      payload: {
        content_hash: locked.content_hash,
        expected_revision: detail.json().state.revision,
      },
    })
    expect(lockedAgain.statusCode).toBe(409)
    expect(lockedAgain.json().error.code).toBe('TALENT_PROFILE_GENERATION_REQUIRED')

    const unchanged = await app.inject({
      method: 'GET',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}`,
      headers: { cookie: managerCookie },
    })
    expect(unchanged.json().state).toMatchObject({
      stage: 'PROFILE_DRAFT',
      revision: detail.json().state.revision,
      latest_artifacts: {
        ROLE_PROFILE: { id: locked.id, status: 'DRAFT', content_hash: locked.content_hash },
      },
    })
  })

  it('岗位说明锁定后允许生成一次人才画像，并在草稿存在时阻止重复生成', async () => {
    const managerCookie = await login(app, 'manager-demo')
    const { locked } = await lockJobDescription()

    await expect(roleService.assertArtifactGenerationAllowed(
      DEMO_ROLE_SESSION_ID,
      managerActor,
      'MANAGER',
      'ROLE_PROFILE',
    )).resolves.toBeUndefined()
    const generated = await app.inject({
      method: 'POST',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}/artifacts/ROLE_PROFILE/generate`,
      headers: { cookie: managerCookie },
    })
    expect(generated.statusCode, generated.body).toBe(202)

    for (let attempt = 0; attempt < 30; attempt += 1) {
      const status = await app.inject({
        method: 'GET',
        url: `/api/v1/agent-runs/${generated.json().run_id}`,
        headers: { cookie: managerCookie },
      })
      if (status.json().run.status === 'COMPLETED') break
      await new Promise((resolve) => setTimeout(resolve, 10))
    }

    const talentDraft = await roleService.get(DEMO_ROLE_SESSION_ID, managerActor)
    expect(talentDraft.state.latest_artifacts.ROLE_PROFILE?.id).not.toBe(locked.id)
    expect(talentDraft.state.latest_artifacts.ROLE_PROFILE).toMatchObject({
      status: 'DRAFT',
      content: { stage: 'TALENT_PROFILE_DRAFT', talent_profile: validTalentProfile },
    })
    await expect(roleService.assertArtifactGenerationAllowed(
      DEMO_ROLE_SESSION_ID,
      managerActor,
      'MANAGER',
      'ROLE_PROFILE',
    )).rejects.toMatchObject({ code: 'TALENT_PROFILE_CONFIRMATION_REQUIRED' })
  })

  it('锁定岗位说明后只接受人才增量，服务端复制锁定内容并确定性投影兼容字段', async () => {
    const { locked } = await lockJobDescription()
    const lockedContent = locked.content as Extract<
      RoleProfileJobDescriptionContent,
      { stage: 'JOB_DESCRIPTION_CONFIRMED' }
    >

    await expect(roleService.saveArtifactDraft(
      DEMO_ROLE_SESSION_ID,
      managerActor,
      'ROLE_PROFILE',
      { job_description: validJobDescription, talent_profile: validTalentProfile },
    )).rejects.toMatchObject({ code: 'ARTIFACT_CONTENT_INVALID' })
    await expect(roleService.saveArtifactDraft(
      DEMO_ROLE_SESSION_ID,
      managerActor,
      'ROLE_PROFILE',
      { talent_profile: validTalentProfile, mission: '模型不能覆写已锁定岗位使命' },
    )).rejects.toMatchObject({ code: 'ARTIFACT_CONTENT_INVALID' })

    const talentDraft = await roleService.saveArtifactDraft(
      DEMO_ROLE_SESSION_ID,
      managerActor,
      'ROLE_PROFILE',
      { talent_profile: validTalentProfile },
    )
    const talentContent = talentDraft.content as unknown as RoleProfileTalentDraftContent

    expect(talentContent).toMatchObject({
      schema_version: '2',
      stage: 'TALENT_PROFILE_DRAFT',
      job_description: lockedContent.job_description,
      job_description_confirmation: lockedContent.job_description_confirmation,
      talent_profile: validTalentProfile,
      hiring_reason: {
        conclusion: lockedContent.job_description.hiring_background.hiring_conclusion,
        business_change: lockedContent.job_description.hiring_background.business_change,
        organization_gap: lockedContent.job_description.hiring_background.organization_gap,
        no_hire_impact: lockedContent.job_description.hiring_background.no_hire_impact,
        evidence_refs: lockedContent.job_description.hiring_background.evidence_refs,
      },
      mission: lockedContent.job_description.job_purpose.statement,
      success_outcomes: lockedContent.job_description.success_criteria,
      work_scenarios: [{
        id: 'S-01',
        title: '共性需求抽象',
        frequency: '每周',
        trigger: '多个客户提出相似需求。',
        actions: '识别共性并定义产品边界。',
        output: '产品机会与优先级清单。',
        challenge: '平衡短期交付诉求与长期复用价值。',
        stakeholders: '研发、交付',
        outcome_refs: ['O-01'],
        evidence_refs: ['HC-2026-EP-001'],
      }],
      boundaries: {
        owns: lockedContent.job_description.boundaries.owns,
        does_not_own: lockedContent.job_description.boundaries.does_not_own,
        decision_rights: lockedContent.job_description.boundaries.decision_rights.join('、'),
        collaboration_and_resources: '协作：研发、交付；资源：客户反馈与项目复盘',
        evidence_refs: lockedContent.job_description.boundaries.evidence_refs,
      },
    })
    expect(contentHash(talentContent.job_description)).toBe(lockedContent.job_description_confirmation.section_hash)
    expect(talentContent.requirements).toEqual([
      expect.objectContaining({ id: 'Q-EXP-01', priority: 'Must-have', substitute_evidence: [] }),
      expect.objectContaining({ id: 'Q-MUST-01', priority: 'Must-have', substitute_evidence: [] }),
      expect.objectContaining({ id: 'Q-PREF-01', priority: 'Preferred', substitute_evidence: [] }),
      expect.objectContaining({ id: 'Q-ALT-01', priority: 'Must-have', substitute_evidence: ['能说明在冲突目标下的取舍和结果。'] }),
      expect.objectContaining({ id: 'C-SKILL-01', priority: 'Must-have', substitute_evidence: [] }),
    ])
    expect(RoleProfileContentSchema.safeParse(talentContent).success).toBe(true)
    await expect(roleService.saveArtifactDraft(
      DEMO_ROLE_SESSION_ID,
      managerActor,
      'ROLE_PROFILE',
      { talent_profile: validTalentProfile },
    )).rejects.toMatchObject({ code: 'TALENT_PROFILE_CONFIRMATION_REQUIRED' })
  })

  it('人才画像草稿经现有通用确认后进入 PROFILE_CONFIRMED', async () => {
    await lockJobDescription()
    const talentDraft = await roleService.saveArtifactDraft(
      DEMO_ROLE_SESSION_ID,
      managerActor,
      'ROLE_PROFILE',
      { talent_profile: validTalentProfile },
    )
    const beforeConfirm = await roleService.get(DEMO_ROLE_SESSION_ID, managerActor)

    const confirmed = await roleService.confirmArtifact(
      DEMO_ROLE_SESSION_ID,
      talentDraft.id,
      managerActor,
      talentDraft.content_hash,
      beforeConfirm.state.revision,
    )

    expect(confirmed).toMatchObject({ id: talentDraft.id, status: 'CONFIRMED' })
    const afterConfirm = await roleService.get(DEMO_ROLE_SESSION_ID, managerActor)
    expect(afterConfirm.state).toMatchObject({
      stage: 'PROFILE_CONFIRMED',
      latest_artifacts: { ROLE_PROFILE: { id: talentDraft.id, status: 'CONFIRMED' } },
    })
  })

  it('岗位说明确认拒绝旧版本、错误 hash、错误 revision 和 HR 操作', async () => {
    const managerCookie = await login(app, 'manager-demo')
    const firstDraft = await roleService.saveArtifactDraft(
      DEMO_ROLE_SESSION_ID, managerActor, 'ROLE_PROFILE', { job_description: validJobDescription },
    )
    await roleService.saveArtifactDraft(
      DEMO_ROLE_SESSION_ID, managerActor, 'ROLE_PROFILE', { job_description: validJobDescription },
    )
    const afterSecondDraft = await app.inject({
      method: 'GET',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}`,
      headers: { cookie: managerCookie },
    })
    const stale = await app.inject({
      method: 'POST',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}/artifacts/${firstDraft.id}:confirm`,
      headers: { cookie: managerCookie },
      payload: { content_hash: firstDraft.content_hash, expected_revision: afterSecondDraft.json().state.revision },
    })
    expect(stale.statusCode).toBe(409)
    expect(stale.json().error.code).toBe('ARTIFACT_VERSION_STALE')

    const draft = afterSecondDraft.json().state.latest_artifacts.ROLE_PROFILE
    const wrongHash = await app.inject({
      method: 'POST',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}/artifacts/${draft.id}:confirm`,
      headers: { cookie: managerCookie },
      payload: { content_hash: '0'.repeat(64), expected_revision: afterSecondDraft.json().state.revision },
    })
    expect(wrongHash.statusCode).toBe(409)
    expect(wrongHash.json().error.code).toBe('CONTENT_HASH_MISMATCH')

    const wrongRevision = await app.inject({
      method: 'POST',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}/artifacts/${draft.id}:confirm`,
      headers: { cookie: managerCookie },
      payload: { content_hash: draft.content_hash, expected_revision: afterSecondDraft.json().state.revision - 1 },
    })
    expect(wrongRevision.statusCode).toBe(409)
    expect(wrongRevision.json().error.code).toBe('REVISION_CONFLICT')

    const hrCookie = await login(app, 'hr-demo')
    const hr = await app.inject({
      method: 'POST',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}/artifacts/${draft.id}:confirm`,
      headers: { cookie: hrCookie },
      payload: { content_hash: draft.content_hash, expected_revision: afterSecondDraft.json().state.revision },
    })
    expect(hr.statusCode).toBe(403)
    expect(hr.json().error.code).toBe('FORBIDDEN')
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
