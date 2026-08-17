import { describe, expect, it } from 'vitest'
import { ROLE_CLARIFIER_SYSTEM_PROMPT as SHARED_SYSTEM_PROMPT } from '@role-clarifier/agent-spec'
import {
  AssessmentScorecardSchema,
  FactCategorySchema,
  PublicJDSchema,
  ROLE_CLARIFIER_PROMPT_VERSION,
  ROLE_CLARIFIER_SYSTEM_PROMPT,
  RoleProfileContentSchema,
  RoleProfileTalentDraftContentSchema,
  TalentProfileDraftInputSchema,
  promptForTask,
} from './index.js'

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

  it('岗位画像 Prompt 明确两阶段输出边界', () => {
    const prompt = promptForTask('GENERATE_ROLE_PROFILE')
    expect(prompt).toContain('task_context.role_profile_mode')
    expect(prompt).toContain('JOB_DESCRIPTION')
    expect(prompt).toContain('TALENT_PROFILE')
    expect(prompt).toContain('第二阶段不得输出 job_description')
    expect(prompt).toContain('服务端合并已锁定岗位说明')
    expect(prompt).toContain('{ job_description: {')
    for (const field of [
      'hiring_background',
      'job_purpose',
      'key_accountabilities',
      'success_criteria',
      'work_scenarios',
      'boundaries',
      'evidence_refs',
    ]) {
      expect(prompt).toContain(field)
    }
    expect(prompt).toContain('3个月、6个月、12个月')
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
})

describe('三类岗位产物契约', () => {
  it('接受含 3/6/12 个月成功标准的 V2 岗位说明，并拒绝缺失周期或提前出现人才画像', () => {
    const base = {
      schema_version: '2',
      stage: 'JOB_DESCRIPTION_DRAFT',
      job_description: {
        hiring_background: {
          business_change: '业务从项目交付转向平台化。',
          organization_gap: '缺少统一定义产品边界的岗位。',
          hiring_conclusion: '招聘一名平台产品经理。',
          no_hire_impact: '重复建设继续增加。',
          evidence_refs: ['HC-001'],
        },
        job_purpose: {
          statement: '把共性需求沉淀为标准产品能力。',
          evidence_refs: ['F-001'],
        },
        key_accountabilities: [{
          id: 'KRA-01',
          name: '平台产品规划',
          responsibility: '持续识别共性需求并定义产品边界。',
          core_outputs: ['产品路线图'],
          success_outcome_refs: ['O-01'],
          evidence_refs: ['F-002'],
        }],
        success_criteria: [
          {
            id: 'O-01', horizon: '3个月', title: '形成产品路线图',
            definition: '完成现状诊断并明确优先级。', measures: ['路线图通过评审'],
            status: '待确认', evidence_refs: ['F-003'],
          },
          {
            id: 'O-02', horizon: '6个月', title: '验证平台能力',
            definition: '完成重点场景验证并形成复盘。', measures: ['重点场景完成验收'],
            status: '待确认', evidence_refs: ['F-003'],
          },
          {
            id: 'O-03', horizon: '12个月', title: '形成规模化复用',
            definition: '平台能力在多个业务场景稳定复用。', measures: ['复用范围达到年度目标'],
            status: '待确认', evidence_refs: ['F-003'],
          },
        ],
        work_scenarios: [{
          id: 'S-01', title: '共性需求抽象', frequency: '每周',
          trigger: '多个客户提出相似需求', actions: '识别共性并定义边界',
          output: '机会清单', challenge: '短期交付与长期复用冲突',
          stakeholders: ['研发', '交付'], success_outcome_refs: ['O-01'], evidence_refs: ['F-004'],
        }],
        boundaries: {
          owns: ['产品边界与路线图'], does_not_own: ['单客户项目交付'],
          decision_rights: ['提出产品优先级取舍'], key_collaborations: ['研发', '交付'],
          available_resources: ['客户反馈与项目复盘'], evidence_refs: ['F-005'],
        },
      },
    }

    expect(RoleProfileContentSchema.safeParse(base).success).toBe(true)
    const missingSixMonth = {
      ...base,
      job_description: {
        ...base.job_description,
        success_criteria: base.job_description.success_criteria.filter((item) => item.horizon !== '6个月'),
      },
    }
    expect(RoleProfileContentSchema.safeParse(missingSixMonth).success).toBe(false)
    expect(RoleProfileContentSchema.safeParse({ ...base, talent_profile: {} }).success).toBe(false)
  })

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

describe('人才画像增量契约', () => {
  const traceableRequirement = {
    id: 'REQ-01',
    name: '复杂需求抽象',
    definition: '识别共性并定义边界。',
    maps_to: ['KRA-01', 'O-01', 'S-01'],
    observable_evidence: ['说明输入、取舍、产出和复用结果'],
    evidence_refs: ['F-002'],
    status: '推断',
  }

  const validTalentProfileDraft = {
    talent_profile: {
      target_talent_profile: {
        core_definition: '能把复杂项目经验迁移为平台化产品能力的人。',
        transferable_backgrounds: ['平台产品', '复杂解决方案产品化'],
        fit_signals: ['能说明抽象、取舍和复用结果'],
        non_target_and_misjudgments: ['只有单项目跟单经验不等于平台产品经验'],
        attraction_factors: ['从项目交付转向平台产品建设'],
        evidence_refs: ['KRA-01', 'O-01'],
      },
      qualifications: {
        hard_qualifications: [],
        necessary_experience: [],
        role_conditions: [],
        must_have: [traceableRequirement],
        preferred: [],
        alternatives: [],
      },
      competency_model: {
        knowledge: [],
        skills: [traceableRequirement],
        behavioral_competencies: [],
        values_and_work_style: [],
        career_motivation: [],
      },
    },
  }

  const validTalentDraftContent = {
    schema_version: '2',
    stage: 'TALENT_PROFILE_DRAFT',
    job_description: {
      hiring_background: {
        business_change: '业务从项目交付转向平台化。',
        organization_gap: '缺少统一定义产品边界的岗位。',
        hiring_conclusion: '招聘一名平台产品经理。',
        no_hire_impact: '重复建设继续增加。',
        evidence_refs: ['HC-001'],
      },
      job_purpose: {
        statement: '把共性需求沉淀为标准产品能力。',
        evidence_refs: ['F-001'],
      },
      key_accountabilities: [{
        id: 'KRA-01',
        name: '平台产品规划',
        responsibility: '持续识别共性需求并定义产品边界。',
        core_outputs: ['产品路线图'],
        success_outcome_refs: ['O-01'],
        evidence_refs: ['F-002'],
      }],
      success_criteria: [
        {
          id: 'O-01', horizon: '3个月', title: '形成产品路线图',
          definition: '完成现状诊断并明确优先级。', measures: ['路线图通过评审'],
          status: '待确认', evidence_refs: ['F-003'],
        },
        {
          id: 'O-02', horizon: '6个月', title: '验证平台能力',
          definition: '完成重点场景验证并形成复盘。', measures: ['重点场景完成验收'],
          status: '待确认', evidence_refs: ['F-003'],
        },
        {
          id: 'O-03', horizon: '12个月', title: '形成规模化复用',
          definition: '平台能力在多个业务场景稳定复用。', measures: ['复用范围达到年度目标'],
          status: '待确认', evidence_refs: ['F-003'],
        },
      ],
      work_scenarios: [{
        id: 'S-01', title: '共性需求抽象', frequency: '每周',
        trigger: '多个客户提出相似需求', actions: '识别共性并定义边界',
        output: '机会清单', challenge: '短期交付与长期复用冲突',
        stakeholders: ['研发', '交付'], success_outcome_refs: ['O-01'], evidence_refs: ['F-004'],
      }],
      boundaries: {
        owns: ['产品边界与路线图'], does_not_own: ['单客户项目交付'],
        decision_rights: ['提出产品优先级取舍'], key_collaborations: ['研发', '交付'],
        available_resources: ['客户反馈与项目复盘'], evidence_refs: ['F-005'],
      },
    },
    job_description_confirmation: {
      source_artifact_id: 'b34fffc8-8f33-4d2a-98b8-8505ae51f27a',
      section_hash: '4bc1b52b4d098f88',
      confirmed_by: 'manager-demo',
      confirmed_at: '2026-08-18T00:00:00.000Z',
    },
    talent_profile: validTalentProfileDraft.talent_profile,
  }

  it('接受只包含人才画像增量的第二阶段模型输出', () => {
    const result = TalentProfileDraftInputSchema.safeParse(validTalentProfileDraft)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(Object.keys(result.data.talent_profile)).toEqual([
        'target_talent_profile',
        'qualifications',
        'competency_model',
      ])
    }
  })

  it('拒绝缺失可观察证据、岗位映射、证据引用或合法状态的人才条目', () => {
    for (const requirement of [
      { ...traceableRequirement, maps_to: [] },
      { ...traceableRequirement, observable_evidence: [] },
      { ...traceableRequirement, evidence_refs: [] },
      { ...traceableRequirement, status: '已发布' },
    ]) {
      expect(TalentProfileDraftInputSchema.safeParse({
        ...validTalentProfileDraft,
        talent_profile: {
          ...validTalentProfileDraft.talent_profile,
          qualifications: {
            ...validTalentProfileDraft.talent_profile.qualifications,
            must_have: [requirement],
          },
        },
      }).success).toBe(false)
    }
  })

  it('拒绝夹带岗位说明的第二阶段模型输出', () => {
    expect(TalentProfileDraftInputSchema.safeParse({
      ...validTalentProfileDraft,
      job_description: {},
    }).success).toBe(false)
  })

  it('接受独立的 V2 人才画像草稿，不要求 legacy 投影字段', () => {
    expect(RoleProfileTalentDraftContentSchema.safeParse(validTalentDraftContent).success).toBe(true)
  })

  it('拒绝 V2 人才画像草稿中的额外或篡改结构', () => {
    expect(RoleProfileTalentDraftContentSchema.safeParse({
      ...validTalentDraftContent,
      legacy_requirements: [],
    }).success).toBe(false)
    expect(RoleProfileTalentDraftContentSchema.safeParse({
      ...validTalentDraftContent,
      job_description: {},
    }).success).toBe(false)
  })

  it('岗位画像 Prompt 给出三块人才画像及可追溯条目的输出契约', () => {
    const prompt = promptForTask('GENERATE_ROLE_PROFILE')
    const talentPrompt = prompt.slice(prompt.indexOf('当 task_context.role_profile_mode 为 TALENT_PROFILE'))
    expect(talentPrompt).toContain('target_talent_profile')
    expect(talentPrompt).toContain('qualifications')
    expect(talentPrompt).toContain('competency_model')
    expect(talentPrompt).toContain('maps_to')
    expect(talentPrompt).toContain('observable_evidence')
    expect(talentPrompt).toContain('evidence_refs')
    expect(talentPrompt).toContain('status')
    expect(talentPrompt.indexOf('target_talent_profile')).toBeLessThan(talentPrompt.indexOf('qualifications'))
    expect(talentPrompt.indexOf('qualifications')).toBeLessThan(talentPrompt.indexOf('competency_model'))
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
