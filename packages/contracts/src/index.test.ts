import { describe, expect, it } from 'vitest'
import { ROLE_CLARIFIER_SYSTEM_PROMPT as SHARED_SYSTEM_PROMPT } from '@role-clarifier/agent-spec'
import {
  AgentContextSnapshotSchema,
  AssessmentScorecardSchema,
  EnterpriseContextBundleSchema,
  FactDecisionRequestSchema,
  FactCategorySchema,
  FactSchema,
  HcApprovalSchema,
  artifactTypeForTask,
  PublicJDSchema,
  ROLE_CLARIFIER_PROMPT_VERSION,
  ROLE_CLARIFIER_SYSTEM_PROMPT,
  RoleProfileContentSchema,
  promptForTask,
} from './index.js'

const oldHc = {
  request_id: 'HC-OLD-001',
  tenant_id: 'tenant-demo',
  title: '企业产品经理',
  department: '企业服务产品部',
  status: 'APPROVED' as const,
  context: {
    request_id: 'HC-OLD-001',
    status: 'APPROVED' as const,
    approved_at: '2026-08-18T00:00:00.000Z',
    business_change: '业务进入标准产品经营阶段。',
    organization_gap: '缺少产品化责任人。',
    approved_reason: '新增企业产品经理。',
    initial_responsibilities: ['定义产品边界'],
    recruiting_budget: '年度预算内',
    recruiting_constraints: [],
    hiring_manager_user_id: 'manager-demo',
    assigned_hr_user_id: 'hr-demo',
    job_basics: {
      recruitment_type: 'NEW_HEADCOUNT' as const,
      headcount: 1,
      level: '3-2',
      reporting_line: '产品负责人',
      locations: ['北京'],
      employment_type: '全职',
      salary_range: '35K-50K',
      target_onboard: '8 周内',
    },
  },
  role_session_id: null,
  created_at: '2026-08-18T00:00:00.000Z',
  updated_at: '2026-08-18T00:00:00.000Z',
}

describe('共享 Agent 规范', () => {
  it('从单一事实源导出 System Prompt', () => {
    expect(ROLE_CLARIFIER_SYSTEM_PROMPT).toBe(SHARED_SYSTEM_PROMPT)
  })

  it('按任务只组合核心规则和对应任务规则', () => {
    expect(ROLE_CLARIFIER_PROMPT_VERSION).toBe('role-clarifier-v13-explicit-output-constraints')
    expect(promptForTask('GENERATE_JD')).toContain('<P-01')
    expect(promptForTask('GENERATE_JD')).toContain('<P-05')
    expect(promptForTask('GENERATE_JD')).not.toContain('<P-07')
  })

  it('能力询问以用户明确指定的输出格式为准', () => {
    const prompt = promptForTask('CLARIFY_MESSAGE')
    expect(prompt).toContain('能力询问未指定输出格式时，结合上下文自然、简洁回复')
    expect(prompt).toContain('指定了输出格式时，以用户的格式要求为准')
  })

  it('统一支持四类岗位事实', () => {
    expect(FactCategorySchema.options).toEqual([
      'BACKGROUND',
      'HIRING_REASON',
      'SUCCESS_CRITERION',
      'CONSTRAINT',
    ])
  })

  it.each([
    ['GENERATE_ROLE_PROFILE', 'ROLE_PROFILE'],
    ['GENERATE_ASSESSMENT', 'ASSESSMENT_SCORECARD'],
    ['GENERATE_JD', 'PUBLIC_JD'],
    ['GENERATE_HR_BRIEF', 'HR_RECRUITING_BRIEF'],
  ] as const)('将 %s 映射为唯一的 %s 产物类型', (task, artifactType) => {
    expect(artifactTypeForTask(task)).toBe(artifactType)
  })
})

describe('三类岗位产物契约', () => {
  it('岗位画像必须包含前端展示所需的完整判断链', () => {
    const result = RoleProfileContentSchema.safeParse({
      hiring_reason: {
        conclusion: '补充一名客户端工程师。',
        business_change: '跨端业务规模增长。',
        organization_gap: '缺少客户端架构负责人。',
        no_hire_impact: '稳定性问题持续扩大。',
        evidence_refs: ['HC-001'],
      },
      mission: '建设稳定、可复用的客户端平台。',
      success_outcomes: [{
        id: 'O-01', horizon: '90 天', title: '完成架构诊断', definition: '形成改造路线图。',
        measures: ['输出诊断报告'], status: '已确认', evidence_refs: ['E-01'],
      }],
      work_scenarios: [{
        id: 'T-01', title: '稳定性治理', frequency: '每周', trigger: '线上异常增加',
        actions: '定位根因并推动治理', output: '治理方案', challenge: '跨端链路复杂',
        stakeholders: '客户端与服务端团队', outcome_refs: ['O-01'], evidence_refs: ['E-02'],
      }],
      requirements: [{
        id: 'C-01', priority: 'Must-have', name: '稳定性治理', level: '高级', rationale: '支撑 O-01',
        maps_to: ['O-01', 'T-01'], strong_evidence: ['建立过监控治理体系'], substitute_evidence: [],
        risk_signals: ['只能描述单点修复'], assessment_method: '案例面试', evidence_refs: ['E-03'],
      }],
      boundaries: {
        owns: ['客户端架构与稳定性'], does_not_own: ['服务端业务逻辑'], decision_rights: '提出架构取舍',
        collaboration_and_resources: '客户端、服务端与测试团队', evidence_refs: ['E-04'],
      },
    })
    expect(result.success).toBe(true)
  })

  it('评估方案拒绝对象文本和不等于 100 的权重', () => {
    const result = AssessmentScorecardSchema.safeParse({
      dimensions: [{
        id: 'A-01', name: '稳定性治理', weight: 60, method: '案例面试', owner: '用人经理',
        question: '如何治理线上稳定性？', evidence: '能解释指标与结果', anchors: { 1: '只描述修复', 3: '能形成方案', 5: '形成治理闭环' },
      }],
      decision_rule: {
        status: '草稿', summary: '核心维度不得低于 3 分', scoring: '加权平均',
        pass_thresholds: '总分不低于 3.5', calibration: '面试后统一校准',
      },
    })
    expect(result.success).toBe(false)
  })

  it('评估方案接受可直接渲染的 100 权重结构', () => {
    const result = AssessmentScorecardSchema.safeParse({
      dimensions: [{
        id: 'A-01', name: '稳定性治理', weight: 100, method: '案例面试', owner: '用人经理',
        question: '如何治理线上稳定性？', evidence: '能解释指标与结果', anchors: { 1: '只描述修复', 3: '能形成方案', 5: '形成治理闭环' },
      }],
      decision_rule: {
        status: '草稿', summary: '核心维度不得低于 3 分', scoring: '加权平均',
        pass_thresholds: '总分不低于 3.5', calibration: '面试后统一校准',
      },
    })
    expect(result.success).toBe(true)
  })
})

describe('PublicJDSchema', () => {
  it('只接受四段式公开 JD', () => {
    const result = PublicJDSchema.safeParse({
      title_and_basics: {
        title: '商业化产品经理',
        location: '上海',
        employment_type: '全职',
        reporting_line: '产品负责人',
      },
      about_the_role: '负责商业化产品从策略到落地。',
      what_you_will_do: ['定义路线图并推动跨团队交付'],
      what_we_look_for: ['具备复杂业务抽象能力'],
      hidden_hr_note: '不得进入公开 JD',
    })

    expect(result.success).toBe(false)
  })
})

describe('三闭环共享契约', () => {
  it('旧事实缺少来源与确认字段时补为 null', () => {
    expect(FactSchema.parse({
      id: 'fact-old',
      category: 'BACKGROUND',
      statement: '旧事实',
      source: '历史数据',
      status: 'CONFIRMED',
      evidence_refs: [],
      visible_to: 'ALL',
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

  it('修改事实必须携带替代内容', () => {
    expect(() => FactDecisionRequestSchema.parse({
      decision: 'REVISE',
      expected_revision: 3,
    })).toThrow()
  })

  it('企业上下文拒绝超过六条的命中', () => {
    expect(() => EnterpriseContextBundleSchema.parse({
      query: {
        role_session_id: '11111111-1111-4111-8111-111111111111',
        task: 'CLARIFY_MESSAGE',
        department: '企业服务产品部',
        job_family: '产品',
        query_terms: ['企业产品经理', '职级', '成功标准'],
      },
      hits: Array.from({ length: 7 }, (_, index) => ({
        knowledge_id: `K-${index}`,
        category: 'ORGANIZATION',
        title: '组织职责',
        summary: '摘要',
        source_ref: `mock://org/${index}`,
        source_version: 'v1',
        relevance_score: 30,
        match_reasons: ['部门一致'],
      })),
      truncated: false,
    })).toThrow()
  })

  it('历史 HC 与 Trace 缺少闭环字段时使用兼容默认值', () => {
    expect(HcApprovalSchema.parse(oldHc)).toMatchObject({
      clarification_task: null,
      notification_delivery: null,
    })
    expect(AgentContextSnapshotSchema.parse({
      system_prompt: {
        section_name: 'system',
        content: 'rules',
        provenance: 'HARNESS_SYSTEM_PROMPT',
        harness_managed_base: {
          included: true,
          captured_as_text: false,
          description: 'Harness managed',
        },
      },
      current_user_input: { content: '继续澄清', source: 'CURRENT_REQUEST' },
      short_term_memory: { source: 'RECENT_CONVERSATION', window_size: 1, messages: [] },
      long_term_memory: { source: 'BUSINESS_DATABASE', role_state: {} },
      task_state: {},
    }).long_term_memory.enterprise_context).toBeNull()
  })
})
