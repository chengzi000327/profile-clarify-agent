import type {
  AgentContextSnapshot,
  RoleProfileGenerationProjection,
  RoleState,
} from '@role-clarifier/contracts'
import { describe, expect, it } from 'vitest'
import { buildSidecarApp, type ExecutorLike } from './app.js'
import { loadSidecarConfig } from './config.js'
import {
  HarnessExecutor,
  maxTokensForTask,
  recoverResultFromTool,
  timeoutMsForTask,
} from './executor.js'
import { buildContextSnapshot, buildTaskPrompt } from './prompts.js'
import { HarnessRequestSchema, parseHarnessResult, type HarnessRequest } from './schemas.js'

const state: RoleState = {
  id: '11111111-1111-4111-8111-111111111111',
  tenant_id: 'tenant-demo',
  title: '商业化产品负责人',
  department: '产品与商业化',
  stage: 'SUCCESS_CLARIFYING',
  revision: 1,
  hc_status: 'APPROVED',
  hc_context: null,
  facts: [],
  conflicts: [],
  latest_artifacts: {},
  candidate_count: 0,
  candidate_channels: [],
  calibration_status: 'OBSERVING',
  created_at: '2026-08-15T00:00:00.000Z',
  updated_at: '2026-08-15T00:00:00.000Z',
}

const request: HarnessRequest = {
  task: 'CLARIFY_MESSAGE',
  role_state: state,
  message: '半年内完成三个客户场景的标准化。',
  conversation_context: {
    current_user_role: 'MANAGER',
    open_clarification: { ordinal: 1, question: '半年后的验收结果是什么？' },
    recent_messages: [
      { sender_type: 'AGENT', sender_role: null, content: '请说明半年后的验收结果。' },
    ],
  },
  execution_context: {
    tenant_id: 'tenant-demo',
    actor_user_id: 'manager-demo',
    actor_role: 'MANAGER',
    role_session_id: state.id,
    agent_run_id: 'run-demo',
    trace_id: 'trace-demo',
  },
  maximum_transitions: 10,
  structured_output_repair_attempts: 1,
}

const talentProjection: RoleProfileGenerationProjection = {
  projection: 'ROLE_PROFILE',
  state_revision: 7,
  role: {
    id: state.id,
    title: '商业化产品负责人',
    department: '产品与商业化',
    stage: 'PROFILE_DRAFT',
    hc_status: 'APPROVED',
  },
  facts: [],
  conflicts: [],
  artifact_refs: [],
  task_context: {
    task: 'GENERATE_ROLE_PROFILE',
    artifacts: [],
    role_profile_mode: 'TALENT_PROFILE',
    locked_job_description: {
      artifact_id: 'artifact-locked-job-description',
      version: 2,
      section_hash: '1234567890abcdef1234567890abcdef',
      confirmed_by: 'manager-confirmed-job-description',
      confirmed_at: '2026-08-18T00:00:00.000Z',
      content: {
        hiring_background: {
          business_change: '业务正在从项目交付转向平台化经营。',
          organization_gap: '团队缺少持续负责平台产品边界的岗位。',
          hiring_conclusion: '新增一名平台产品负责人。',
          no_hire_impact: '重复建设将继续增加。',
          evidence_refs: ['E-LOCKED-01'],
        },
        job_purpose: {
          statement: '将分散需求沉淀为可复用的平台能力。',
          evidence_refs: ['E-LOCKED-01'],
        },
        key_accountabilities: [{
          id: 'KRA-01',
          name: '平台产品规划',
          responsibility: '持续定义产品边界与路线。',
          core_outputs: ['产品路线图'],
          success_outcome_refs: ['O-01'],
          evidence_refs: ['E-LOCKED-01'],
        }],
        success_criteria: [
          {
            id: 'O-01', horizon: '3个月', title: '形成产品路线图',
            definition: '完成现状诊断并明确优先级。', measures: ['路线图通过评审'],
            status: '已确认', evidence_refs: ['E-LOCKED-01'],
          },
          {
            id: 'O-02', horizon: '6个月', title: '验证重点能力',
            definition: '完成重点场景验证。', measures: ['场景验收通过'],
            status: '已确认', evidence_refs: ['E-LOCKED-01'],
          },
          {
            id: 'O-03', horizon: '12个月', title: '形成规模复用',
            definition: '平台能力在多个场景复用。', measures: ['复用目标达成'],
            status: '已确认', evidence_refs: ['E-LOCKED-01'],
          },
        ],
        work_scenarios: [{
          id: 'S-01',
          title: '跨团队优先级决策',
          frequency: '每周',
          trigger: '多个需求同时进入评审。',
          actions: '组织评审并完成取舍。',
          output: '优先级决策。',
          challenge: '平衡短期交付和长期复用。',
          stakeholders: ['研发', '交付'],
          success_outcome_refs: ['O-01'],
          evidence_refs: ['E-LOCKED-01'],
        }],
        boundaries: {
          owns: ['产品边界与路线图'],
          does_not_own: ['研发编制决策'],
          decision_rights: ['提出需求优先级取舍'],
          key_collaborations: ['研发', '交付'],
          available_resources: ['客户调研材料'],
          evidence_refs: ['E-LOCKED-01'],
        },
      },
    },
  },
}

const jobDescriptionProjection: RoleProfileGenerationProjection = {
  projection: 'ROLE_PROFILE',
  state_revision: 4,
  role: {
    id: state.id,
    title: '商业化产品负责人',
    department: '产品与商业化',
    stage: 'SUCCESS_CLARIFYING',
    hc_status: 'APPROVED',
    hc_context: {
      request_id: 'HC-FIRST-STAGE-001',
      status: 'APPROVED',
      approved_at: '2026-08-18T00:00:00.000Z',
      business_change: 'FIRST_STAGE_HC_BUSINESS_CHANGE',
      organization_gap: 'FIRST_STAGE_HC_ORGANIZATION_GAP',
      approved_reason: 'FIRST_STAGE_HC_APPROVED_REASON',
      initial_responsibilities: ['FIRST_STAGE_INITIAL_RESPONSIBILITY'],
      recruiting_budget: 'FIRST_STAGE_RECRUITING_BUDGET',
      recruiting_constraints: ['FIRST_STAGE_RECRUITING_CONSTRAINT'],
      hiring_manager_user_id: 'manager-first-stage',
      assigned_hr_user_id: 'hr-first-stage',
      job_basics: {
        recruitment_type: 'NEW_HEADCOUNT',
        headcount: 1,
        level: 'P7',
        reporting_line: '产品负责人',
        locations: ['北京'],
        employment_type: '全职',
        salary_range: '内部审批范围',
        target_onboard: '8 周内',
      },
    },
  },
  facts: [{
    category: 'SUCCESS_CRITERION',
    statement: 'FIRST_STAGE_CONFIRMED_FACT',
    source: '用人经理确认',
    status: 'CONFIRMED',
    evidence_refs: ['conversation://first-stage'],
  }],
  conflicts: [{
    field: '岗位范围',
    left_value: 'FIRST_STAGE_CONFLICT_LEFT',
    right_value: 'FIRST_STAGE_CONFLICT_RIGHT',
    source_refs: ['hc://first-stage', 'conversation://first-stage'],
    status: 'OPEN',
  }],
  artifact_refs: [],
  task_context: {
    task: 'GENERATE_ROLE_PROFILE',
    artifacts: [],
    role_profile_mode: 'JOB_DESCRIPTION',
  },
}

const config = loadSidecarConfig({
  NODE_ENV: 'test',
  HARNESS_SIDECAR_TOKEN: 'test-sidecar-token-at-least-24-chars',
})

describe('Harness sidecar', () => {
  it('accepts the strict role profile projection at the Sidecar boundary', () => {
    const parsed = HarnessRequestSchema.safeParse({
      ...request,
      task: 'GENERATE_ROLE_PROFILE',
      role_state: talentProjection,
      message: undefined,
      conversation_context: undefined,
    })

    expect(parsed.success).toBe(true)
  })

  it('rejects talent projections polluted with HC or unrelated artifact references', () => {
    const requestBase = {
      ...request,
      task: 'GENERATE_ROLE_PROFILE',
      message: undefined,
      conversation_context: undefined,
    }
    const withHcContext = {
      ...talentProjection,
      role: {
        ...talentProjection.role,
        hc_context: jobDescriptionProjection.role.hc_context,
      },
    }
    const withArtifactReference = {
      ...talentProjection,
      artifact_refs: [{
        type: 'ASSESSMENT_SCORECARD',
        id: 'assessment-secret-reference',
        version: 1,
        status: 'CONFIRMED',
        content_hash: '1234567890abcdef',
      }],
    }

    expect(HarnessRequestSchema.safeParse({
      ...requestBase,
      role_state: withHcContext,
    }).success).toBe(false)
    expect(HarnessRequestSchema.safeParse({
      ...requestBase,
      role_state: withArtifactReference,
    }).success).toBe(false)
  })

  it('builds the talent prompt from the locked job description without restoring HC context', () => {
    const roleProfileRequest: HarnessRequest = {
      ...request,
      task: 'GENERATE_ROLE_PROFILE',
      role_state: talentProjection,
      message: undefined,
      conversation_context: undefined,
    }
    let prompt = ''
    let context: AgentContextSnapshot | undefined

    expect(() => {
      context = buildContextSnapshot(roleProfileRequest)
      prompt = buildTaskPrompt(roleProfileRequest)
    }).not.toThrow()

    expect(context?.long_term_memory.role_state).toEqual(talentProjection)
    expect(prompt).toContain('artifact-locked-job-description')
    expect(prompt).toContain('manager-confirmed-job-description')
    expect(prompt).toContain('将分散需求沉淀为可复用的平台能力。')
    expect(prompt).toContain('先调用 read_role_state')
    expect(prompt).not.toContain('hc_context')
    expect(prompt).not.toContain('request_id')
    expect(prompt).not.toContain('年度新增编制预算内')
    expect(prompt).not.toContain('latest_artifacts')
    expect(prompt).not.toContain('ASSESSMENT_SCORECARD')
    expect(prompt).not.toContain('PUBLIC_JD')
    expect(prompt).not.toContain('HR_RECRUITING_BRIEF')
  })

  it('keeps approved HC facts and conflicts in the first-stage job description prompt', () => {
    const roleProfileRequest: HarnessRequest = {
      ...request,
      task: 'GENERATE_ROLE_PROFILE',
      role_state: jobDescriptionProjection,
      message: undefined,
      conversation_context: undefined,
    }
    const context = buildContextSnapshot(roleProfileRequest)
    const prompt = buildTaskPrompt(roleProfileRequest)

    expect(prompt).toContain('FIRST_STAGE_HC_BUSINESS_CHANGE')
    expect(prompt).toContain('FIRST_STAGE_CONFIRMED_FACT')
    expect(prompt).toContain('FIRST_STAGE_CONFLICT_LEFT')
    expect(prompt).toContain('"role_profile_mode":"JOB_DESCRIPTION"')
    expect(prompt).toContain('先调用 read_role_state')
    expect(context.long_term_memory.role_state).not.toHaveProperty(
      'task_context.locked_job_description',
    )
  })

  it('does not expose actor identity fields to the model prompt', () => {
    const prompt = buildTaskPrompt(request)
    expect(prompt).not.toContain('actor_user_id')
    expect(prompt).not.toContain('manager-demo')
    expect(prompt).not.toContain('tenant-demo')
    expect(prompt).not.toContain('tenant_id')
    expect(prompt).toContain('半年内完成三个客户场景的标准化。')
    expect(prompt).toContain('半年后的验收结果是什么？')
    expect(prompt).toContain('CONVERSATION')
  })

  it('separates system prompt, current input, short-term memory, long-term memory and task state', () => {
    const context = buildContextSnapshot(request)
    expect(context.system_prompt.content).toContain('岗位画像澄清 Agent')
    expect(context.current_user_input.content).toEqual({
      message: '半年内完成三个客户场景的标准化。',
    })
    expect(context.short_term_memory.messages).toHaveLength(1)
    expect(context.long_term_memory.role_state).toMatchObject({
      role: { title: '商业化产品负责人' },
      state_revision: 1,
    })
    expect(context.task_state).toMatchObject({
      task: 'CLARIFY_MESSAGE',
      current_user_role: 'MANAGER',
    })
  })

  it('loads only the core and current task prompt', () => {
    const clarification = buildContextSnapshot(request)
    expect(clarification.system_prompt.content).toContain('<P-01')
    expect(clarification.system_prompt.content).not.toContain('<P-02')
    expect(clarification.task_state.orchestration_instructions).toContain('<P-02')
    expect(clarification.task_state.orchestration_instructions).not.toContain('<P-03')

    const jd = buildContextSnapshot({
      ...request,
      task: 'GENERATE_JD',
      message: undefined,
      conversation_context: undefined,
    })
    expect(jd.system_prompt.content).toContain('<P-01')
    expect(jd.task_state.orchestration_instructions).toContain('<P-05')
    expect(jd.task_state.orchestration_instructions).not.toContain('<P-07')
  })

  it('repairs fenced model JSON into the typed result', () => {
    const result = parseHarnessResult(`\`\`\`json
      {"kind":"CLARIFICATION","persistence":"TOOL","answer":"已记录","question":"如何验收？","fact_draft":{"category":"SUCCESS_CRITERION","statement":"完成标准化"}}
    \`\`\``)
    expect(result.kind).toBe('CLARIFICATION')
  })

  it.each(['BACKGROUND', 'CONSTRAINT'] as const)(
    'accepts %s clarification facts supported by save_fact_draft',
    (category) => {
      const result = parseHarnessResult(JSON.stringify({
        kind: 'CLARIFICATION',
        persistence: 'TOOL',
        answer: '已记录',
        question: '接下来最需要澄清什么？',
        fact_draft: { category, statement: '这是一条待确认的岗位事实。' },
      }))
      expect(result).toMatchObject({
        kind: 'CLARIFICATION',
        fact_draft: { category },
      })
    },
  )

  it('accepts a direct conversation result without a write tool', () => {
    const result = parseHarnessResult(
      '{"kind":"CONVERSATION","persistence":"NONE","answer":"我在，可以帮你澄清岗位。"}',
    )
    expect(result).toMatchObject({ kind: 'CONVERSATION', persistence: 'NONE' })
  })

  it('sends greetings and capability questions through the model prompt', () => {
    const prompt = buildTaskPrompt({ ...request, message: '你好，你可以做什么？' })
    expect(prompt).toContain('你好，你可以做什么？')
    expect(prompt).toContain('<P-02')
    expect(prompt).not.toContain('<P-03')
    expect(prompt).toContain('CONVERSATION 不调用工具')
    expect(prompt).toContain('"kind":"CONVERSATION"')
  })

  it('puts an explicit user reply constraint ahead of contextual capability guidance', () => {
    const prompt = buildTaskPrompt({
      ...request,
      message: '请只回复：我可以协助澄清岗位。',
    })

    expect(prompt).toContain('请只回复：我可以协助澄清岗位。')
    expect(prompt).toContain('必须严格遵守该输出约束')
    expect(prompt).toContain('不得补充岗位名称、当前状态、历史事实、下一步建议或寒暄')
    expect(prompt).toContain('指定了输出格式时，以用户的格式要求为准')
  })

  it('keeps artifact content out of the initial model prompt and only exposes references', () => {
    const prompt = buildTaskPrompt({
      ...request,
      role_state: {
        ...state,
        latest_artifacts: {
          ROLE_PROFILE: {
            id: 'artifact-profile-v1',
            version: 1,
            status: 'CONFIRMED',
            content_hash: '1234567890abcdef',
            content: { secret_marker: 'FULL_ARTIFACT_CONTENT_MUST_NOT_BE_IN_PROMPT' },
          },
        },
      },
    })

    expect(prompt).toContain('artifact-profile-v1')
    expect(prompt).toContain('1234567890abcdef')
    expect(prompt).not.toContain('FULL_ARTIFACT_CONTENT_MUST_NOT_BE_IN_PROMPT')
  })

  it('caps Flash token budgets without shrinking Pro artifact generation', () => {
    expect(maxTokensForTask('CLARIFY_MESSAGE', 16_384)).toBe(4_096)
    expect(maxTokensForTask('EXTRACT_CANDIDATES', 16_384)).toBe(8_192)
    expect(maxTokensForTask('GENERATE_JD', 16_384)).toBe(16_384)
  })

  it('extends only role profile generation beyond the default run timeout', () => {
    expect(timeoutMsForTask('GENERATE_ROLE_PROFILE', 90_000, 240_000)).toBe(240_000)
    expect(timeoutMsForTask('CLARIFY_MESSAGE', 90_000, 240_000)).toBe(90_000)
    expect(timeoutMsForTask('GENERATE_JD', 90_000, 240_000)).toBe(90_000)
  })

  it('does not fabricate a canned conversation when model output is invalid', () => {
    expect(() => recoverResultFromTool({ ...request, message: '你能做什么？' }, []))
      .toThrow('Cannot recover a model-generated conversation')
  })

  it('recovers a relevant clarification answer from exact saved tool arguments', () => {
    const result = recoverResultFromTool(request, [
      {
        name: 'update_role_identity_draft',
        arguments: { title: '企业产品经理', department: '企业服务产品部' },
      },
      {
        name: 'save_fact_draft',
        arguments: {
          category: 'SUCCESS_CRITERION',
          statement: '半年内完成三个客户场景的标准化',
        },
      },
    ])
    expect(result.kind).toBe('CLARIFICATION')
    if (result.kind !== 'CLARIFICATION') throw new Error('Expected clarification')
    expect(result.answer).toContain('半年内完成三个客户场景的标准化')
    expect(result.question).not.toContain('这条事实是否准确')
    expect(result.role_identity).toEqual({
      title: '企业产品经理',
      department: '企业服务产品部',
    })
  })

  it('normalizes a missing display-only summary after tools already persisted the artifact', () => {
    const result = parseHarnessResult(JSON.stringify({
      kind: 'ARTIFACT',
      persistence: 'TOOL',
      artifact_type: 'PUBLIC_JD',
      content: {},
    }))
    expect(result.kind).toBe('ARTIFACT')
    if (result.kind !== 'ARTIFACT') throw new Error('Expected artifact result')
    expect(result.summary).toContain('草稿已保存')
  })

  it('recovers the result envelope from a successful authoritative write tool', () => {
    const result = recoverResultFromTool(
      { ...request, task: 'GENERATE_JD', message: undefined },
      [{
        name: 'save_artifact_draft',
        arguments: {
          artifact_type: 'PUBLIC_JD',
          content: {
            title_and_basics: {},
            about_the_role: '岗位说明',
            what_you_will_do: [],
            what_we_look_for: [],
          },
        },
      }],
    )
    expect(result.kind).toBe('ARTIFACT')
  })

  it('protects the run endpoint and returns executor output', async () => {
    const executor: ExecutorLike = {
      readiness: () => ({ runtime: true, credential: true }),
      execute: async () => ({
        result: {
          kind: 'CLARIFICATION',
          persistence: 'TOOL',
          answer: '已记录',
          question: '如何验收？',
          fact_draft: { category: 'SUCCESS_CRITERION', statement: '完成标准化' },
        },
        events: [],
        trace: {
          model: 'deepseek-v4-flash',
          provider: 'deepseek-official',
          harness_source_version: '0.1.0-rc.5',
          harness_commit: '47f943859bef60e4160492346772ded9b24f765a',
          tool_count: 2,
          input_tokens: 10,
          output_tokens: 5,
          duration_ms: 10,
          repaired: false,
          recovered_from_tool: false,
        },
      }),
    }
    const app = buildSidecarApp(config, executor)
    const denied = await app.inject({ method: 'POST', url: '/v1/role-clarifier/runs', payload: request })
    expect(denied.statusCode).toBe(401)
    const accepted = await app.inject({
      method: 'POST',
      url: '/v1/role-clarifier/runs',
      headers: { authorization: `Bearer ${config.HARNESS_SIDECAR_TOKEN}` },
      payload: request,
    })
    expect(accepted.statusCode).toBe(200)
    expect(accepted.json().result.persistence).toBe('TOOL')
    await app.close()
  })
})
