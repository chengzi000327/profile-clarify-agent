import {
  ASSESSMENT_GENERATION_PROMPT,
  CALIBRATION_ADVICE_GENERATION_PROMPT,
  CANDIDATE_EVIDENCE_EXTRACTION_PROMPT,
  HR_RECRUITING_BRIEF_GENERATION_PROMPT,
  PUBLIC_JD_GENERATION_PROMPT,
  ROLE_PROFILE_GENERATION_PROMPT,
  ROLE_ROUTER_SYSTEM_PROMPT,
  type AgentRouteRequest,
  type RoleState,
} from '@role-clarifier/contracts'
import { describe, expect, it } from 'vitest'
import { resolve } from 'node:path'
import { buildSidecarApp, type ExecutorLike } from './app.js'
import { loadSidecarConfig } from './config.js'
import {
  HarnessExecutor,
  assertTaskToolPolicy,
  maxTokensForTask,
  reasoningForTask,
  recoverResultFromTool,
  resolveIncompleteTurnResult,
} from './executor.js'
import {
  buildContextSnapshot,
  buildMaxTokensRecoveryPrompt,
  buildTaskPrompt,
} from './prompts.js'
import { buildRoutePrompt, parseAgentRouteResult } from './routing.js'
import type { RuntimeLaunch, RuntimeTurn } from './protocol-client.js'
import { parseHarnessResult, type HarnessRequest } from './schemas.js'

const state: RoleState = {
  id: '11111111-1111-4111-8111-111111111111',
  tenant_id: 'tenant-demo',
  title: '商业化产品负责人',
  department: '产品与商业化',
  stage: 'SUCCESS_CLARIFYING',
  revision: 1,
  hc_status: 'APPROVED',
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

const roleProfileContent = {
  mission: {
    statement: '推动商业化路线形成并完成关键方案验证。',
    hiring_reason_fact_refs: ['fact-hiring'],
    success_criterion_fact_refs: ['fact-success'],
  },
  work: [{
    id: 'W-01',
    title: '形成商业化路线',
    description: '把业务目标转化为可执行路线并推动验证。',
    deliverables: ['商业化路线图', '方案验证结论'],
    success_criterion_fact_refs: ['fact-success'],
    other_fact_refs: ['fact-hiring'],
  }],
  boundaries: {
    owns: [{ statement: '负责路线形成与验证推动。', fact_refs: [], work_refs: ['W-01'] }],
    does_not_own: [],
    decision_rights: [],
    collaboration_and_resources: [],
  },
  requirements: [{
    id: 'R-01',
    priority: 'MUST_HAVE',
    name: '业务路线判断与验证',
    level: '能够独立完成',
    rationale: '直接支撑关键工作和成功标准。',
    strong_evidence: ['能够说明路线取舍、推动过程和验证结果'],
    acceptable_alternatives: ['在相似复杂业务中完成过同类闭环'],
    risk_signals: ['只有方案描述，没有验证结果'],
    work_refs: ['W-01'],
    success_criterion_fact_refs: ['fact-success'],
    constraint_fact_refs: [],
  }],
  open_questions: [],
}

const assessmentContent = {
  dimensions: [{
    id: 'D-01',
    name: '业务路线判断与验证',
    criticality: 'CORE',
    weight: 100,
    requirement_refs: ['R-01'],
    work_refs: ['W-01'],
    method: {
      type: 'CASE_EXERCISE',
      instructions: '使用匿名业务案例验证路线判断和方案验证能力。',
    },
    questions: [{
      prompt: '请分析案例并说明路线取舍、验证方法和判断依据。',
      probes: ['哪些约束会改变你的判断？'],
      evidence_to_collect: ['问题定义、取舍依据、验证设计和结果复盘'],
    }],
    evidence_criteria: {
      strong_evidence: ['能够比较方案并根据验证结果修正判断'],
      acceptable_evidence: ['能够形成基本路线并给出可执行验证方法'],
      risk_signals: ['只有方案描述，无法说明判断依据或验证方式'],
    },
    anchors: {
      score_1: '已有回答无法建立目标和方案之间的关系，也无法说明判断依据。',
      score_3: '能够完成基本问题拆解，形成可执行路线并说明验证方法。',
      score_5: '能够处理复杂约束、比较方案并根据验证结果迭代判断。',
    },
  }],
  interview_plan: [{
    id: 'S-01',
    name: '业务案例评估',
    interviewer_role: '用人经理或业务面试官',
    duration_minutes: 60,
    dimension_refs: ['D-01'],
  }],
  scoring_rules: {
    scale: '1_3_5',
    weighted_total_formula: 'SUM(dimension_score / 5 * weight)',
    insufficient_evidence_action: 'DO_NOT_SCORE_AND_FOLLOW_UP',
    preferred_requirement_can_veto: false,
    final_decision: 'HUMAN_REQUIRED',
  },
  open_questions: [],
}

const publicJDContent = {
  title_and_basics: {
    title: '商业化产品负责人',
    department: '产品与商业化',
    location: '上海',
    employment_type: '全职',
  },
  about_the_role: '你将加入产品与商业化团队，围绕关键业务目标推动商业化路线形成和关键方案验证。',
  what_you_will_do: [
    '分析业务目标和用户问题，形成清晰的商业化产品路线',
    '推动关键产品方案设计、验证和持续迭代',
    '协同业务、产品和交付团队建立工作目标与推进节奏',
    '沉淀关键决策和验证结论，支持后续产品演进',
  ],
  what_we_look_for: [
    '能够从复杂业务目标中识别关键问题并形成方案取舍',
    '能够通过用户、数据或实验结果验证产品判断',
    '能够在跨团队协作中建立承诺并持续推动闭环',
    '能够清晰说明本人在复杂项目中的职责、行动和结果',
  ],
}

const hrRecruitingBriefContent = {
  target_candidate_summary: '能够形成业务路线并亲自推动方案验证的产品人才。',
  target_types: [{
    label: '路线与验证型产品人才',
    fit_rationale: '可同时覆盖路线取舍和方案验证。',
    requirement_refs: ['R-01'],
    work_refs: ['W-01'],
  }],
  search_strategy: {
    titles: ['商业化产品负责人', '增长产品负责人', '产品策略负责人'],
    keyword_groups: [
      { name: '路线判断', keywords: ['商业化路线', '方案取舍'], requirement_refs: ['R-01'] },
      { name: '验证闭环', keywords: ['方案验证', '迭代复盘'], requirement_refs: ['R-01'] },
    ],
    boolean_query: '(“商业化产品负责人” OR “增长产品负责人”) AND (“商业化路线” OR “方案验证”)',
    priority_channels: [],
  },
  resume_screen: {
    thirty_second_checks: [
      { criterion: '路线责任', requirement_refs: ['R-01'], evidence_to_find: ['本人路线取舍'], missing_action: 'VERIFY_NOT_REJECT' },
      { criterion: '方案验证', requirement_refs: ['R-01'], evidence_to_find: ['验证方法与结果'], missing_action: 'VERIFY_NOT_REJECT' },
      { criterion: '迭代复盘', requirement_refs: ['R-01'], evidence_to_find: ['根据结果修正判断'], missing_action: 'VERIFY_NOT_REJECT' },
    ],
    non_target_signals: [],
  },
  phone_questions: [
    { prompt: '你如何形成业务路线？', probes: ['关键取舍是什么？'], evidence_to_collect: ['本人责任与取舍'], requirement_refs: ['R-01'] },
    { prompt: '你如何推动方案验证？', probes: ['如何定义验证标准？'], evidence_to_collect: ['验证方法与结果'], requirement_refs: ['R-01'] },
    { prompt: '结果不符预期时你如何调整？', probes: ['哪些证据改变了判断？'], evidence_to_collect: ['判断修正与复盘'], requirement_refs: ['R-01'] },
  ],
  market_context: {
    status: 'NOT_CONNECTED',
    note: '尚未接入真实人才库数据。',
    supply_observations: [],
    target_companies: [],
  },
  calibration_watchpoints: [{
    signal: '核心要求持续缺少可验证证据。',
    requirement_refs: ['R-01'],
    trigger_rule: { minimum_candidates: 10, minimum_channels: 2, repeated_signal_count: 2 },
    action: 'HR_REVIEW',
  }],
  open_questions: [],
}

const config = loadSidecarConfig({
  NODE_ENV: 'test',
  HARNESS_SIDECAR_TOKEN: 'test-sidecar-token-at-least-24-chars',
})

describe('Harness sidecar', () => {
  it('does not expose actor identity fields to the model prompt', () => {
    const prompt = buildTaskPrompt(request)
    expect(prompt).not.toContain('actor_user_id')
    expect(prompt).not.toContain('manager-demo')
    expect(prompt).not.toContain('tenant-demo')
    expect(prompt).not.toContain('tenant_id')
    expect(prompt).toContain('半年内完成三个客户场景的标准化。')
    expect(prompt).toContain('半年后的验收结果是什么？')
    expect(prompt).toContain('CLARIFICATION')
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

  it('injects source-tagged recruiting context separately from confirmed role facts', () => {
    const contextualRequest: HarnessRequest = {
      ...request,
      recruiting_context: {
        purpose: 'CLARIFY_MESSAGE',
        generated_at: '2026-08-16T12:00:00.000Z',
        projections: ['ORGANIZATION'],
        facts: [{
          fact_id: 'CTX-ORG-TEAM-01-MISSION',
          category: 'TEAM_MISSION',
          statement: '产品团队正在形成可复制的企业产品。',
          authority: 'REFERENCE',
          confirmation_status: 'UNCONFIRMED_CONTEXT',
          data_classification: 'MINIMIZED_INTERNAL',
          scope: { team_id: 'TEAM-01', role_title: '商业化产品负责人' },
          source: {
            provider: 'RECRUITING_CONTEXT_STORE',
            system: 'MOCK_HRIS',
            record_type: 'ORGANIZATION_UNIT',
            record_id: 'TEAM-01',
            observed_at: '2026-08-16T01:00:00.000Z',
            synthetic: true,
            verification_status: 'PENDING_REVIEW',
          },
        }],
        warnings: [],
        usage_policy: {
          may_support_clarification: true,
          may_guide_draft_style: true,
          may_become_role_fact_without_human_confirmation: false,
        },
      },
    }
    const context = buildContextSnapshot(contextualRequest)
    expect(context.long_term_memory.recruiting_context?.facts[0]).toMatchObject({
      fact_id: 'CTX-ORG-TEAM-01-MISSION',
      confirmation_status: 'UNCONFIRMED_CONTEXT',
      source: { synthetic: true, system: 'MOCK_HRIS' },
    })
    const prompt = buildTaskPrompt(contextualRequest)
    expect(prompt).toContain('CTX-ORG-TEAM-01-MISSION')
    expect(prompt).toContain('may_become_role_fact_without_human_confirmation')
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
    const routeRequest: AgentRouteRequest = {
      message: '你好，你可以做什么？',
      role_state: state,
      conversation_context: request.conversation_context!,
    }
    const prompt = buildRoutePrompt(routeRequest)
    expect(prompt).toContain('你好，你可以做什么？')
    expect(prompt).toContain('按照 P-02')
    expect(prompt).not.toContain('<router_system>')
    expect(ROLE_ROUTER_SYSTEM_PROMPT).toContain('无工具意图 Router')
    expect(ROLE_ROUTER_SYSTEM_PROMPT).toContain('RESPOND')
    expect(ROLE_ROUTER_SYSTEM_PROMPT).toContain('HANDOFF')
  })

  it('parses every free-text route outcome', () => {
    const outcomes = [
      { action: 'RESPOND', answer: '你好，我在。' },
      { action: 'ASK', question: '你希望生成哪一种产物？' },
      { action: 'HANDOFF', task: 'CLARIFY_MESSAGE' },
      { action: 'HANDOFF', task: 'GENERATE_ROLE_PROFILE' },
      { action: 'HANDOFF', task: 'GENERATE_ASSESSMENT' },
      { action: 'HANDOFF', task: 'GENERATE_JD' },
      { action: 'HANDOFF', task: 'GENERATE_HR_BRIEF' },
      { action: 'HANDOFF', task: 'CALIBRATION_ADVICE' },
      {
        action: 'HANDOFF',
        task: 'VERSION_COMPARISON',
        artifact_type: 'ROLE_PROFILE',
        from_version: 1,
        to_version: 2,
      },
    ]
    for (const outcome of outcomes) {
      expect(parseAgentRouteResult(JSON.stringify(outcome))).toMatchObject(outcome)
    }
  })

  it('rejects both unexpected tools and missing required tools', () => {
    expect(() => assertTaskToolPolicy(
      'CLARIFY_MESSAGE',
      ['read_role_state', 'save_artifact_draft'],
      ['read_role_state', 'save_artifact_draft'],
    )).toThrow('outside CLARIFY_MESSAGE allowlist')
    expect(() => assertTaskToolPolicy(
      'GENERATE_JD',
      ['read_role_state'],
      ['read_role_state'],
    )).toThrow('outside GENERATE_JD allowlist')
    expect(() => assertTaskToolPolicy(
      'GENERATE_ROLE_PROFILE',
      ['read_role_state'],
      ['read_role_state'],
    )).toThrow('outside GENERATE_ROLE_PROFILE allowlist')
    expect(() => assertTaskToolPolicy('GENERATE_ROLE_PROFILE', [], [])).not.toThrow()
    expect(() => assertTaskToolPolicy('GENERATE_ASSESSMENT', [], [])).not.toThrow()
    expect(() => assertTaskToolPolicy('GENERATE_JD', [], [])).not.toThrow()
    expect(() => assertTaskToolPolicy('GENERATE_HR_BRIEF', [], [])).not.toThrow()
    expect(() => assertTaskToolPolicy('EXTRACT_CANDIDATES', [], [])).not.toThrow()
    expect(() => assertTaskToolPolicy('CALIBRATION_ADVICE', [], [])).not.toThrow()
    expect(() => assertTaskToolPolicy(
      'EXTRACT_CANDIDATES',
      ['save_candidate_evidence'],
      ['save_candidate_evidence'],
    )).toThrow('outside EXTRACT_CANDIDATES allowlist')
    expect(() => assertTaskToolPolicy(
      'GENERATE_HR_BRIEF',
      ['read_role_state'],
      ['read_role_state'],
    )).toThrow('outside GENERATE_HR_BRIEF allowlist')
    expect(() => assertTaskToolPolicy(
      'CALIBRATION_ADVICE',
      ['propose_calibration_signal'],
      ['propose_calibration_signal'],
    )).toThrow('outside CALIBRATION_ADVICE allowlist')
  })

  it('uses the standalone P-03 prompt and caller persistence without tools', () => {
    const prompt = buildTaskPrompt({
      ...request,
      task: 'GENERATE_ROLE_PROFILE',
      message: '请根据现有已确认事实生成岗位画像',
      maximum_transitions: 0,
      role_state: {
        ...state,
        facts: [
          {
            id: 'fact-hiring',
            category: 'HIRING_REASON',
            statement: '缺少商业化路线负责人',
            source: '经理确认',
            status: 'CONFIRMED',
            evidence_refs: [],
            visible_to: 'ALL',
            updated_at: state.updated_at,
          },
          {
            id: 'fact-success',
            category: 'SUCCESS_CRITERION',
            statement: '六个月内形成路线并推动方案验证',
            source: '经理确认',
            status: 'CONFIRMED',
            evidence_refs: [],
            visible_to: 'ALL',
            updated_at: state.updated_at,
          },
        ],
      },
    })

    expect(prompt).toContain(ROLE_PROFILE_GENERATION_PROMPT)
    expect(prompt).toContain('fact-hiring')
    expect(prompt).toContain('fact-success')
    expect(prompt).toContain('"persistence":"CALLER"')
    expect(prompt).toContain('不得调用任何工具')

    const result = parseHarnessResult(JSON.stringify({
      kind: 'ARTIFACT',
      persistence: 'CALLER',
      artifact_type: 'ROLE_PROFILE',
      content: roleProfileContent,
      summary: '岗位画像草稿已生成。',
    }))
    expect(result).toMatchObject({
      kind: 'ARTIFACT',
      persistence: 'CALLER',
      artifact_type: 'ROLE_PROFILE',
    })
  })

  it('rejects ROLE_PROFILE tool persistence and unsupported Must-have references', () => {
    expect(() => parseHarnessResult(JSON.stringify({
      kind: 'ARTIFACT',
      persistence: 'TOOL',
      artifact_type: 'ROLE_PROFILE',
      content: {
        ...roleProfileContent,
        requirements: [{
          ...roleProfileContent.requirements[0],
          work_refs: [],
          success_criterion_fact_refs: [],
          constraint_fact_refs: [],
        }],
      },
      summary: '错误结果',
    }))).toThrow()
  })

  it('uses P-04 with only the confirmed role profile and caller persistence', () => {
    const prompt = buildTaskPrompt({
      ...request,
      task: 'GENERATE_ASSESSMENT',
      message: '请生成评估方案',
      maximum_transitions: 0,
      role_state: {
        ...state,
        latest_artifacts: {
          ROLE_PROFILE: {
            id: 'profile-v1',
            version: 1,
            status: 'CONFIRMED',
            content_hash: '1234567890abcdef',
            content: roleProfileContent,
          },
          ASSESSMENT_SCORECARD: {
            id: 'assessment-old',
            version: 1,
            status: 'INVALIDATED',
            content_hash: 'abcdef1234567890',
            content: { forbidden_old_dimension: '不得进入 P-04 上下文' },
          },
        },
      },
    })

    expect(prompt).toContain(ASSESSMENT_GENERATION_PROMPT)
    expect(prompt).toContain('业务路线判断与验证')
    expect(prompt).not.toContain('forbidden_old_dimension')
    expect(prompt).toContain('不得调用任何工具')
    expect(prompt).toContain('"persistence":"CALLER"')

    expect(parseHarnessResult(JSON.stringify({
      kind: 'ARTIFACT',
      persistence: 'CALLER',
      artifact_type: 'ASSESSMENT_SCORECARD',
      content: assessmentContent,
      summary: '评估方案草稿已生成。',
    }))).toMatchObject({
      kind: 'ARTIFACT',
      persistence: 'CALLER',
      artifact_type: 'ASSESSMENT_SCORECARD',
    })
  })

  it('rejects assessment tool persistence and invalid dimension coverage', () => {
    expect(() => parseHarnessResult(JSON.stringify({
      kind: 'ARTIFACT',
      persistence: 'TOOL',
      artifact_type: 'ASSESSMENT_SCORECARD',
      content: {
        ...assessmentContent,
        interview_plan: [{
          ...assessmentContent.interview_plan[0],
          dimension_refs: ['D-99'],
        }],
      },
      summary: '错误结果',
    }))).toThrow()
  })

  it('uses P-05 with confirmed upstream artifacts and public basics only', () => {
    const prompt = buildTaskPrompt({
      ...request,
      task: 'GENERATE_JD',
      message: '请生成对外 JD',
      maximum_transitions: 0,
      role_state: {
        ...state,
        public_job_basics: {
          location: {
            value: '上海',
            status: 'CONFIRMED',
            visibility: 'PUBLIC',
            source: 'HR',
            confirmed_at: state.updated_at,
          },
          employment_type: {
            value: '全职',
            status: 'CONFIRMED',
            visibility: 'PUBLIC',
            source: 'HR',
            confirmed_at: state.updated_at,
          },
        },
        latest_artifacts: {
          ROLE_PROFILE: {
            id: 'profile-v1',
            version: 1,
            status: 'CONFIRMED',
            content_hash: '1234567890abcdef',
            content: roleProfileContent,
          },
          ASSESSMENT_SCORECARD: {
            id: 'assessment-v1',
            version: 1,
            status: 'CONFIRMED',
            content_hash: 'abcdef1234567890',
            content: assessmentContent,
          },
          PUBLIC_JD: {
            id: 'old-jd',
            version: 1,
            status: 'INVALIDATED',
            content_hash: '1111222233334444',
            content: { forbidden_old_jd: '不得进入 P-05 上下文' },
          },
        },
      },
    })

    expect(prompt).toContain(PUBLIC_JD_GENERATION_PROMPT)
    expect(prompt).toContain('业务路线判断与验证')
    expect(prompt).toContain('"location":"上海"')
    expect(prompt).not.toContain('forbidden_old_jd')
    expect(prompt).toContain('不得调用任何工具')
    expect(prompt).toContain('"persistence":"CALLER"')

    expect(parseHarnessResult(JSON.stringify({
      kind: 'ARTIFACT',
      persistence: 'CALLER',
      artifact_type: 'PUBLIC_JD',
      content: publicJDContent,
      summary: '对外 JD 草稿已生成。',
    }))).toMatchObject({
      kind: 'ARTIFACT',
      persistence: 'CALLER',
      artifact_type: 'PUBLIC_JD',
    })
  })

  it('rejects PUBLIC_JD tool persistence and extra modules', () => {
    expect(() => parseHarnessResult(JSON.stringify({
      kind: 'ARTIFACT',
      persistence: 'TOOL',
      artifact_type: 'PUBLIC_JD',
      content: { ...publicJDContent, interview_scorecard: [] },
      summary: '错误结果',
    }))).toThrow()
  })

  it('uses P-06 with confirmed HR-only inputs and caller persistence', () => {
    const prompt = buildTaskPrompt({
      ...request,
      task: 'GENERATE_HR_BRIEF',
      message: '请生成 HR 招聘画像',
      maximum_transitions: 0,
      conversation_context: {
        current_user_role: 'HR',
        open_clarification: null,
        recent_messages: [],
      },
      role_state: {
        ...state,
        facts: [{
          id: 'fact-hiring',
          category: 'HIRING_REASON',
          statement: '需要补齐商业化路线判断能力',
          source: 'manager-confirmed',
          status: 'CONFIRMED',
          evidence_refs: [],
          visible_to: 'ALL',
          updated_at: state.updated_at,
        }],
        hr_recruiting_context: {
          talent_pool_status: 'NOT_CONNECTED',
          searchable_fields: [],
          approved_channels: [],
          supply_observations: [],
          target_companies: [],
        },
        latest_artifacts: {
          ROLE_PROFILE: {
            id: 'profile-v1',
            version: 1,
            status: 'CONFIRMED',
            content_hash: '1234567890abcdef',
            content: roleProfileContent,
          },
          ASSESSMENT_SCORECARD: {
            id: 'assessment-v1',
            version: 1,
            status: 'CONFIRMED',
            content_hash: 'abcdef1234567890',
            content: assessmentContent,
          },
          HR_RECRUITING_BRIEF: {
            id: 'old-hr-brief',
            version: 1,
            status: 'INVALIDATED',
            content_hash: '1111222233334444',
            content: { forbidden_old_hr_content: '不得进入 P-06 上下文' },
          },
        },
      },
    })

    expect(prompt).toContain(HR_RECRUITING_BRIEF_GENERATION_PROMPT)
    expect(prompt).toContain('业务路线判断与验证')
    expect(prompt).toContain('NOT_CONNECTED')
    expect(prompt).toContain('"current_user_role":"HR"')
    expect(prompt).not.toContain('forbidden_old_hr_content')
    expect(prompt).toContain('不得调用任何工具')
    expect(prompt).toContain('"persistence":"CALLER"')

    expect(parseHarnessResult(JSON.stringify({
      kind: 'ARTIFACT',
      persistence: 'CALLER',
      artifact_type: 'HR_RECRUITING_BRIEF',
      content: hrRecruitingBriefContent,
      summary: 'HR 招聘画像草稿已生成。',
    }))).toMatchObject({
      kind: 'ARTIFACT',
      persistence: 'CALLER',
      artifact_type: 'HR_RECRUITING_BRIEF',
    })
  })

  it('rejects HR brief tool persistence and fabricated market data', () => {
    expect(() => parseHarnessResult(JSON.stringify({
      kind: 'ARTIFACT',
      persistence: 'TOOL',
      artifact_type: 'HR_RECRUITING_BRIEF',
      content: {
        ...hrRecruitingBriefContent,
        market_context: {
          ...hrRecruitingBriefContent.market_context,
          target_companies: [{ name: '某公司', rationale: '猜测', source_refs: ['guess'] }],
        },
      },
      summary: '错误结果',
    }))).toThrow()
  })

  it('uses P-07 with confirmed profile and scorecard in one zero-tool call', () => {
    const prompt = buildTaskPrompt({
      ...request,
      task: 'EXTRACT_CANDIDATES',
      message: undefined,
      candidates: [{
        candidate_ref: 'CAND-001',
        channel: '内推',
        format: 'TEXT',
        content: '负责商业化产品路线，并根据客户验证结果调整方案。',
      }],
      maximum_transitions: 0,
      conversation_context: {
        current_user_role: 'HR',
        open_clarification: null,
        recent_messages: [],
      },
      role_state: {
        ...state,
        latest_artifacts: {
          ROLE_PROFILE: {
            id: 'profile-v1',
            version: 1,
            status: 'CONFIRMED',
            content_hash: '1234567890abcdef',
            content: roleProfileContent,
          },
          ASSESSMENT_SCORECARD: {
            id: 'assessment-v1',
            version: 1,
            status: 'CONFIRMED',
            content_hash: 'abcdef1234567890',
            content: assessmentContent,
          },
        },
      },
    })

    expect(prompt).toContain(CANDIDATE_EVIDENCE_EXTRACTION_PROMPT)
    expect(prompt).toContain('业务路线判断与验证')
    expect(prompt).toContain('CAND-001')
    expect(prompt).toContain('不得调用任何工具')
    expect(prompt).toContain('"persistence":"CALLER"')

    expect(parseHarnessResult(JSON.stringify({
      kind: 'CANDIDATE_EVIDENCE',
      persistence: 'CALLER',
      candidates: [{
        candidate_ref: 'CAND-001',
        channel: '内推',
        source_format: 'TEXT',
        evidence: [{
          requirement_ref: 'R-01',
          criterion: '商业化路线判断与方案验证',
          dimension_refs: ['D-01'],
          evidence_status: 'SUPPORTED',
          signal: 'STRONG',
          confidence: 'HIGH',
          quote_span: {
            quote: '负责商业化产品路线，并根据客户验证结果调整方案',
            locator: '第1段',
          },
          rationale: '原文直接说明路线责任和基于验证结果调整方案。',
          needs_interview: false,
          interview_question: null,
        }],
        bottlenecks: [],
      }],
      failed_candidates: [],
      summary: '已完成 1 份候选人材料的证据提取。',
    }))).toMatchObject({
      kind: 'CANDIDATE_EVIDENCE',
      persistence: 'CALLER',
      failed_candidates: [],
    })
  })

  it('uses P-08 with server-computed calibration context and caller persistence', () => {
    const calibrationContext = {
      calibration_policy: {
        minimum_candidates: 10 as const,
        minimum_channels: 2 as const,
        repeated_signal_count: 2 as const,
      },
      candidate_summary: {
        total_candidates: 3,
        channels: ['内推'],
        omitted_channel_count: 0,
        criteria: [{
          requirement_ref: 'R-01',
          criterion: '业务路线判断与验证',
          evidence_count: 3,
          signals: { STRONG: 1, MIXED: 0, WEAK: 0, MISSING: 2 },
          evidence_statuses: {
            SUPPORTED: 1,
            POSSIBLE_SUPPORT: 0,
            NOT_MENTIONED: 2,
            MISMATCH: 0,
            INTERVIEW_NEEDED: 0,
          },
        }],
        omitted_criterion_count: 0,
        top_bottlenecks: [],
        omitted_bottleneck_count: 0,
      },
      calibration_evaluation: {
        status: 'OBSERVING' as const,
        eligible: false,
        candidate_count: 3,
        channel_count: 1,
        repeated_bottlenecks: [],
        missing_conditions: [
          '还需 7 名有效候选人',
          '还需覆盖 1 个渠道',
          '尚未出现 2 次同类卡点',
        ],
      },
    }
    const prompt = buildTaskPrompt({
      ...request,
      task: 'CALIBRATION_ADVICE',
      message: '请给出当前岗位画像校准建议',
      maximum_transitions: 0,
      calibration_context: calibrationContext,
      conversation_context: {
        current_user_role: 'HR',
        open_clarification: null,
        recent_messages: [],
      },
      role_state: {
        ...state,
        latest_artifacts: {
          ROLE_PROFILE: {
            id: 'profile-v1',
            version: 1,
            status: 'CONFIRMED',
            content_hash: '1234567890abcdef',
            content: roleProfileContent,
          },
          ASSESSMENT_SCORECARD: {
            id: 'assessment-v1',
            version: 1,
            status: 'CONFIRMED',
            content_hash: 'abcdef1234567890',
            content: assessmentContent,
          },
        },
      },
    })

    expect(prompt).toContain(CALIBRATION_ADVICE_GENERATION_PROMPT)
    expect(prompt).toContain('"eligible":false')
    expect(prompt).toContain('"NOT_MENTIONED":2')
    expect(prompt).not.toContain('CAND-001')
    expect(prompt).toContain('不得调用任何工具')

    expect(parseHarnessResult(JSON.stringify({
      kind: 'CALIBRATION_ADVICE',
      persistence: 'CALLER',
      advice: {
        signal_type: 'RECRUITMENT_SIGNAL',
        disposition: 'OBSERVING',
        focus: {
          requirement_refs: ['R-01'],
          statement: '当前证据尚不足以形成岗位画像调整信号。',
        },
        trigger_evaluation: {
          policy: calibrationContext.calibration_policy,
          actual: { candidate_count: 3, channel_count: 1, repeated_signals: [] },
          boundary_met: false,
          missing_conditions: calibrationContext.calibration_evaluation.missing_conditions,
        },
        evidence_summary: {
          observed_patterns: [{
            requirement_ref: 'R-01',
            criterion: '业务路线判断与验证',
            statuses: calibrationContext.candidate_summary.criteria[0]!.evidence_statuses,
            interpretation: '两份材料未提及该项要求，不等于候选人不具备。',
          }],
          sample_limitations: ['当前数据只代表已导入候选人和当前渠道，不能代表完整人才市场。'],
        },
        exclusion_checks: {
          not_mentioned_separated: true,
          sensitive_attributes_excluded: true,
          recruitment_execution_verified: false,
        },
        recommendation: {
          action: 'COLLECT_MORE_EVIDENCE',
          target_requirement_refs: [],
          changes: [],
          rationale: '当前样本、渠道和重复证据均未达到校准边界。',
          downstream_impact: {
            role_profile: 'NONE',
            assessment_scorecard: 'NONE',
            public_jd: 'NONE',
            hr_recruiting_brief: 'NONE',
          },
        },
        next_check: {
          owner: 'HR',
          condition: '补足服务端列出的缺失条件后重新评估。',
          action: 'CONTINUE_OBSERVING',
        },
        confidence_note: '当前只形成低置信观察，不支持修改正式画像。',
        requires_hr_review: false,
        manager_task_created: false,
        formal_profile_changed: false,
      },
      summary: '当前证据未达到校准边界，继续观察，不修改岗位画像。',
    }))).toMatchObject({
      kind: 'CALIBRATION_ADVICE',
      persistence: 'CALLER',
      advice: { disposition: 'OBSERVING' },
    })
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
    expect(maxTokensForTask('CLARIFY_MESSAGE', 16_384)).toBe(8_192)
    expect(maxTokensForTask('EXTRACT_CANDIDATES', 16_384)).toBe(8_192)
    expect(maxTokensForTask('GENERATE_JD', 16_384)).toBe(16_384)
  })

  it('disables expensive reasoning for routing and clarification only', () => {
    expect(reasoningForTask('ROUTER')).toEqual({ thinking: 'disabled', effort: 'off' })
    expect(reasoningForTask('CLARIFY_MESSAGE')).toEqual({ thinking: 'disabled', effort: 'off' })
    expect(reasoningForTask('GENERATE_JD')).toEqual({ thinking: 'enabled', effort: 'high' })
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

  it('does not accept a max-token clarification before required tools complete', () => {
    expect(resolveIncompleteTurnResult(request, '', [], [], [])).toBeNull()
  })

  it('recovers a max-token clarification only after all required tools complete', () => {
    const successfulCalls = [
      { name: 'read_role_state', arguments: {} },
      {
        name: 'save_fact_draft',
        arguments: {
          category: 'SUCCESS_CRITERION',
          statement: '半年内完成三个客户场景的标准化',
        },
      },
    ]
    const recovered = resolveIncompleteTurnResult(
      request,
      '',
      successfulCalls.map((call) => call.name),
      successfulCalls.map((call) => call.name),
      successfulCalls,
    )
    expect(recovered?.recoveredFromTool).toBe(true)
    expect(recovered?.result).toMatchObject({
      kind: 'CLARIFICATION',
      fact_draft: {
        category: 'SUCCESS_CRITERION',
        statement: '半年内完成三个客户场景的标准化',
      },
    })
  })

  it('builds a bounded fresh-session prompt for max-token clarification recovery', () => {
    const prompt = buildMaxTokensRecoveryPrompt(request, [])
    expect(prompt).toContain(String(request.message))
    expect(prompt).toContain('read_role_state, save_fact_draft')
    expect(prompt).toContain('不得输出 Markdown')
    expect(prompt).not.toContain('recruiting_context')
  })

  it.each([
    { label: 'max-token stop', finishReason: 'max-tokens' as const, finalResponse: '' },
    { label: 'completed invalid output', finishReason: 'completed' as const, finalResponse: 'not-json' },
  ])('retries a clarification with $label once in a fresh minimal session', async ({
    finishReason,
    finalResponse,
  }) => {
    const launches: RuntimeLaunch[] = []
    const prompts: string[] = []
    const runtimeTurns: RuntimeTurn[][] = [
      [{
        finalResponse,
        toolNames: [],
        successfulToolNames: [],
        successfulToolCalls: [],
        toolEvents: [],
        inputTokens: 100,
        outputTokens: 8_192,
        finishReason,
      }],
      [{
        finalResponse: JSON.stringify({
          kind: 'CLARIFICATION',
          persistence: 'TOOL',
          answer: '我已记录：半年内完成三个客户场景的标准化。',
          question: '这项结果由谁验收？',
          fact_draft: {
            category: 'SUCCESS_CRITERION',
            statement: '半年内完成三个客户场景的标准化',
          },
        }),
        toolNames: ['read_role_state', 'save_fact_draft'],
        successfulToolNames: ['read_role_state', 'save_fact_draft'],
        successfulToolCalls: [
          { name: 'read_role_state', arguments: {} },
          {
            name: 'save_fact_draft',
            arguments: {
              category: 'SUCCESS_CRITERION',
              statement: '半年内完成三个客户场景的标准化',
            },
          },
        ],
        toolEvents: [],
        inputTokens: 60,
        outputTokens: 120,
        finishReason: 'completed',
      }],
    ]
    const executor = new HarnessExecutor({
      ...config,
      DEEPSEEK_API_KEY: 'test-deepseek-key',
      DSH_RUNTIME_BIN: process.execPath,
      DSH_CORDIS_CONFIG: resolve(process.cwd(), 'runtime/cordis.yml'),
    }, (launch) => {
      launches.push(launch)
      const turns = runtimeTurns.shift()
      if (!turns) throw new Error('Unexpected extra runtime')
      return {
        runTurn: async (_sessionId, prompt) => {
          prompts.push(prompt)
          const turn = turns.shift()
          if (!turn) throw new Error('Unexpected extra turn')
          return turn
        },
        close: async () => undefined,
      }
    })

    const execution = await executor.execute(request, new AbortController().signal)

    expect(launches).toHaveLength(2)
    expect(launches[0]?.env.DSH_SESSION_ROOT).not.toBe(launches[1]?.env.DSH_SESSION_ROOT)
    expect(prompts[1]).toContain('最小化恢复')
    expect(execution.result).toMatchObject({
      kind: 'CLARIFICATION',
      fact_draft: { statement: '半年内完成三个客户场景的标准化' },
    })
    expect(execution.trace.repaired).toBe(true)
    expect(execution.events[0]?.value).toContain('受控恢复')
  })

  it('does not recover P-06 from a write tool because caller persistence is authoritative', () => {
    expect(() => recoverResultFromTool(
      { ...request, task: 'GENERATE_HR_BRIEF', message: undefined },
      [{
        name: 'save_artifact_draft',
        arguments: {
          artifact_type: 'HR_RECRUITING_BRIEF',
          content: {
            sourcing: {},
          },
        },
      }],
    )).toThrow('persisted by the caller')
  })

  it('protects the run endpoint and returns executor output', async () => {
    const executor: ExecutorLike = {
      readiness: () => ({ runtime: true, credential: true }),
      route: async () => ({
        result: {
          action: 'RESPOND',
          answer: '你好，我在。',
        },
        events: [],
        trace: {
          model: 'deepseek-v4-flash',
          provider: 'deepseek-official',
          harness_source_version: '0.1.0-rc.5',
          harness_commit: '47f943859bef60e4160492346772ded9b24f765a',
          tool_count: 0,
          input_tokens: 10,
          output_tokens: 5,
          duration_ms: 10,
          repaired: false,
          recovered_from_tool: false,
        },
      }),
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
    const routed = await app.inject({
      method: 'POST',
      url: '/v1/role-clarifier/routes',
      headers: { authorization: `Bearer ${config.HARNESS_SIDECAR_TOKEN}` },
      payload: {
        message: '你好',
        role_state: state,
        conversation_context: request.conversation_context,
      },
    })
    expect(routed.statusCode).toBe(200)
    expect(routed.json().result).toMatchObject({
      action: 'RESPOND',
      answer: '你好，我在。',
    })
    await app.close()
  })
})
