import { describe, expect, it } from 'vitest'
import { ROLE_CLARIFIER_SYSTEM_PROMPT as SHARED_SYSTEM_PROMPT } from '@role-clarifier/agent-spec'
import {
  AssessmentScorecardSchema,
  FactCategorySchema,
  JobDescriptionSchema,
  LegacyRoleProfileContentSchema,
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

  it('岗位说明拒绝 KRA、成功结果与场景之间重复的全局 ID', () => {
    const duplicateAcrossSections = structuredClone({
      hiring_background: {
        business_change: '业务从项目交付转向平台化。', organization_gap: '缺少产品负责人。',
        hiring_conclusion: '招聘平台产品经理。', no_hire_impact: '重复建设增加。', evidence_refs: ['HC-001'],
      },
      job_purpose: { statement: '沉淀标准产品能力。', evidence_refs: ['F-001'] },
      key_accountabilities: [{
        id: 'KRA-01', name: '产品规划', responsibility: '定义产品边界。', core_outputs: ['路线图'],
        success_outcome_refs: ['O-01'], evidence_refs: ['F-002'],
      }],
      success_criteria: [
        { id: 'O-01', horizon: '3个月', title: '形成路线图', definition: '完成诊断。', measures: ['通过评审'], status: '待确认', evidence_refs: ['F-003'] },
        { id: 'O-02', horizon: '6个月', title: '完成验证', definition: '完成试点。', measures: ['通过验收'], status: '待确认', evidence_refs: ['F-003'] },
        { id: 'O-03', horizon: '12个月', title: '规模复用', definition: '多场景复用。', measures: ['达到目标'], status: '待确认', evidence_refs: ['F-003'] },
      ],
      work_scenarios: [{
        id: 'O-01', title: '需求抽象', frequency: '每周', trigger: '出现共性需求', actions: '定义边界',
        output: '机会清单', challenge: '平衡短期与长期', stakeholders: ['研发'],
        success_outcome_refs: ['O-01'], evidence_refs: ['F-004'],
      }],
      boundaries: {
        owns: ['产品边界'], does_not_own: ['项目交付'], decision_rights: ['提出优先级'],
        key_collaborations: ['研发'], available_resources: ['客户反馈'], evidence_refs: ['F-005'],
      },
    })

    const result = JobDescriptionSchema.safeParse(duplicateAcrossSections)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({
          path: ['work_scenarios', 0, 'id'],
          message: expect.stringContaining('全局唯一'),
        }),
      ]))
    }
  })

  it('岗位说明拒绝 KRA 或场景引用不存在的成功结果', () => {
    const base = {
      hiring_background: {
        business_change: '业务从项目交付转向平台化。', organization_gap: '缺少产品负责人。',
        hiring_conclusion: '招聘平台产品经理。', no_hire_impact: '重复建设增加。', evidence_refs: ['HC-001'],
      },
      job_purpose: { statement: '沉淀标准产品能力。', evidence_refs: ['F-001'] },
      key_accountabilities: [{
        id: 'KRA-01', name: '产品规划', responsibility: '定义产品边界。', core_outputs: ['路线图'],
        success_outcome_refs: ['O-MISSING'], evidence_refs: ['F-002'],
      }],
      success_criteria: [
        { id: 'O-01', horizon: '3个月', title: '形成路线图', definition: '完成诊断。', measures: ['通过评审'], status: '待确认', evidence_refs: ['F-003'] },
        { id: 'O-02', horizon: '6个月', title: '完成验证', definition: '完成试点。', measures: ['通过验收'], status: '待确认', evidence_refs: ['F-003'] },
        { id: 'O-03', horizon: '12个月', title: '规模复用', definition: '多场景复用。', measures: ['达到目标'], status: '待确认', evidence_refs: ['F-003'] },
      ],
      work_scenarios: [{
        id: 'S-01', title: '需求抽象', frequency: '每周', trigger: '出现共性需求', actions: '定义边界',
        output: '机会清单', challenge: '平衡短期与长期', stakeholders: ['研发'],
        success_outcome_refs: ['O-UNKNOWN'], evidence_refs: ['F-004'],
      }],
      boundaries: {
        owns: ['产品边界'], does_not_own: ['项目交付'], decision_rights: ['提出优先级'],
        key_collaborations: ['研发'], available_resources: ['客户反馈'], evidence_refs: ['F-005'],
      },
    }

    const result = JobDescriptionSchema.safeParse(base)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: ['key_accountabilities', 0, 'success_outcome_refs', 0], message: expect.stringContaining('不存在') }),
        expect.objectContaining({ path: ['work_scenarios', 0, 'success_outcome_refs', 0], message: expect.stringContaining('不存在') }),
      ]))
    }
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
        necessary_experience: [{ ...traceableRequirement, id: 'QUAL-EXP-01' }],
        role_conditions: [],
        must_have: [traceableRequirement],
        preferred: [],
        alternatives: [],
      },
      competency_model: {
        knowledge: [{ ...traceableRequirement, id: 'COMP-KNOW-01' }],
        skills: [{ ...traceableRequirement, id: 'COMP-01' }],
        behavioral_competencies: [{ ...traceableRequirement, id: 'COMP-BEHAVIOR-01' }],
        values_and_work_style: [{ ...traceableRequirement, id: 'COMP-VALUES-01' }],
        career_motivation: [{ ...traceableRequirement, id: 'COMP-MOTIVATION-01' }],
      },
    },
  }

  const thirteenTraceableRequirements = Array.from({ length: 13 }, (_, index) => ({
    ...traceableRequirement,
    id: `REQ-${String(index + 1).padStart(2, '0')}`,
  }))
  const thirteenTalentProfileDraft = {
    talent_profile: {
      ...validTalentProfileDraft.talent_profile,
      qualifications: {
        ...validTalentProfileDraft.talent_profile.qualifications,
        must_have: thirteenTraceableRequirements.slice(0, 12),
      },
      competency_model: {
        ...validTalentProfileDraft.talent_profile.competency_model,
        skills: [thirteenTraceableRequirements[12]],
      },
    },
  }
  const thirteenLegacyRequirements = thirteenTraceableRequirements.map((requirement) => ({
    id: requirement.id,
    priority: 'Must-have',
    name: requirement.name,
    level: requirement.definition,
    rationale: `对应岗位依据：${requirement.maps_to.join('、')}`,
    maps_to: requirement.maps_to,
    strong_evidence: requirement.observable_evidence,
    substitute_evidence: [],
    risk_signals: [],
    assessment_method: '围绕可观察证据进行结构化追问',
    evidence_refs: requirement.evidence_refs,
  }))

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
    hiring_reason: {
      conclusion: '招聘一名平台产品经理。',
      business_change: '业务从项目交付转向平台化。',
      organization_gap: '缺少统一定义产品边界的岗位。',
      no_hire_impact: '重复建设继续增加。',
      evidence_refs: ['HC-001'],
    },
    mission: '把共性需求沉淀为标准产品能力。',
    success_outcomes: [
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
      stakeholders: '研发、交付', outcome_refs: ['O-01'], evidence_refs: ['F-004'],
    }],
    requirements: [{
      id: 'REQ-01', priority: 'Must-have', name: '复杂需求抽象', level: '识别共性并定义边界。',
      rationale: '对应岗位依据：KRA-01、O-01、S-01', maps_to: ['KRA-01', 'O-01', 'S-01'],
      strong_evidence: ['说明输入、取舍、产出和复用结果'], substitute_evidence: [], risk_signals: [],
      assessment_method: '围绕可观察证据进行结构化追问', evidence_refs: ['F-002'],
    }],
    boundaries: {
      owns: ['产品边界与路线图'], does_not_own: ['单客户项目交付'],
      decision_rights: '提出产品优先级取舍', collaboration_and_resources: '研发、交付及客户反馈与项目复盘',
      evidence_refs: ['F-005'],
    },
  }

  it('接受 requirement ID 全局唯一的人才画像增量输出', () => {
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

  it('拒绝 11 个人才要求分组全部为空的模型输出', () => {
    expect(TalentProfileDraftInputSchema.safeParse({
      talent_profile: {
        ...validTalentProfileDraft.talent_profile,
        qualifications: {
          hard_qualifications: [], necessary_experience: [], role_conditions: [],
          must_have: [], preferred: [], alternatives: [],
        },
        competency_model: {
          knowledge: [], skills: [], behavioral_competencies: [],
          values_and_work_style: [], career_motivation: [],
        },
      },
    }).success).toBe(false)
  })

  it('拒绝目标人才画像任一关键证据数组为空', () => {
    for (const field of [
      'transferable_backgrounds',
      'fit_signals',
      'non_target_and_misjudgments',
      'attraction_factors',
      'evidence_refs',
    ] as const) {
      const input = structuredClone(validTalentProfileDraft)
      input.talent_profile.target_talent_profile[field] = []
      const result = TalentProfileDraftInputSchema.safeParse(input)
      expect(result.success, `${field} must not be empty`).toBe(false)
    }
  })

  it('拒绝必要经历或 Must-have 为空', () => {
    for (const field of ['necessary_experience', 'must_have'] as const) {
      const input = structuredClone(validTalentProfileDraft)
      input.talent_profile.qualifications[field] = []
      const result = TalentProfileDraftInputSchema.safeParse(input)
      expect(result.success, `${field} must not be empty`).toBe(false)
    }
  })

  it('拒绝胜任力素质模型任一冰山维度为空', () => {
    for (const field of [
      'knowledge',
      'skills',
      'behavioral_competencies',
      'values_and_work_style',
      'career_motivation',
    ] as const) {
      const input = structuredClone(validTalentProfileDraft)
      input.talent_profile.competency_model[field] = []
      const result = TalentProfileDraftInputSchema.safeParse(input)
      expect(result.success, `${field} must not be empty`).toBe(false)
    }
  })

  it('接受分布在不同分组的 13 项人才要求输入', () => {
    expect(TalentProfileDraftInputSchema.safeParse(thirteenTalentProfileDraft).success).toBe(true)
  })

  it('拒绝同一分组内重复的 requirement ID', () => {
    expect(TalentProfileDraftInputSchema.safeParse({
      talent_profile: {
        ...validTalentProfileDraft.talent_profile,
        qualifications: {
          ...validTalentProfileDraft.talent_profile.qualifications,
          must_have: [traceableRequirement, { ...traceableRequirement }],
        },
      },
    }).success).toBe(false)
  })

  it('拒绝跨任职资格与胜任力分组重复的 requirement ID', () => {
    expect(TalentProfileDraftInputSchema.safeParse({
      talent_profile: {
        ...validTalentProfileDraft.talent_profile,
        competency_model: {
          ...validTalentProfileDraft.talent_profile.competency_model,
          skills: [{ ...traceableRequirement }],
        },
      },
    }).success).toBe(false)
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

  it('接受带服务端确定性 legacy 投影的 V2 人才画像草稿', () => {
    expect(RoleProfileTalentDraftContentSchema.safeParse(validTalentDraftContent).success).toBe(true)
  })

  it('接受带 13 条 legacy requirements 投影的 V2 人才画像草稿', () => {
    expect(RoleProfileTalentDraftContentSchema.safeParse({
      ...validTalentDraftContent,
      talent_profile: thirteenTalentProfileDraft.talent_profile,
      requirements: thirteenLegacyRequirements,
    }).success).toBe(true)
  })

  it('V2 最终画像接受所有上游合法极限值的无损兼容投影', () => {
    const maxArtifactText = '甲'.repeat(4_000)
    const maxSourceList = Array.from({ length: 12 }, () => maxArtifactText)
    const maxJoinedSourceList = maxSourceList.join('、')
    const maxCollaborationAndResources = `协作：${maxJoinedSourceList}；资源：${maxJoinedSourceList}`
    const maximalFinalContent = structuredClone(validTalentDraftContent)
    const additionalOutcomes = Array.from({ length: 5 }, (_, index) => ({
      ...maximalFinalContent.job_description.success_criteria[0]!,
      id: `O-0${index + 4}`,
      horizon: `${(index + 3) * 6}个月`,
      title: `扩展成功结果 ${index + 4}`,
    }))
    maximalFinalContent.job_description.success_criteria.push(...additionalOutcomes)
    maximalFinalContent.success_outcomes.push(...structuredClone(additionalOutcomes))
    maximalFinalContent.job_description.work_scenarios[0]!.stakeholders = maxSourceList
    maximalFinalContent.work_scenarios[0]!.stakeholders = maxJoinedSourceList
    maximalFinalContent.job_description.boundaries.decision_rights = maxSourceList
    maximalFinalContent.job_description.boundaries.key_collaborations = maxSourceList
    maximalFinalContent.job_description.boundaries.available_resources = maxSourceList
    maximalFinalContent.boundaries.decision_rights = maxJoinedSourceList
    maximalFinalContent.boundaries.collaboration_and_resources = maxCollaborationAndResources
    maximalFinalContent.talent_profile.qualifications.must_have[0]!.definition = maxArtifactText
    maximalFinalContent.requirements[0]!.level = maxArtifactText

    expect(maximalFinalContent.job_description.success_criteria).toHaveLength(8)
    expect(maxJoinedSourceList).toHaveLength(48_011)
    expect(maxCollaborationAndResources).toHaveLength(96_029)
    expect(RoleProfileTalentDraftContentSchema.safeParse(maximalFinalContent).success).toBe(true)
  })

  it('standalone legacy 岗位画像继续保留旧的成功结果、level 与拼接文本上限', () => {
    const {
      schema_version: _schemaVersion,
      stage: _stage,
      job_description: _jobDescription,
      job_description_confirmation: _jobDescriptionConfirmation,
      talent_profile: _talentProfile,
      ...legacyContent
    } = validTalentDraftContent
    const maxArtifactText = '甲'.repeat(4_000)
    const longProjectionText = Array.from({ length: 12 }, () => maxArtifactText).join('、')
    const sevenOutcomes = [
      ...legacyContent.success_outcomes,
      ...Array.from({ length: 4 }, (_, index) => ({
        ...legacyContent.success_outcomes[0]!,
        id: `O-LEGACY-${index + 4}`,
      })),
    ]

    expect(LegacyRoleProfileContentSchema.safeParse({
      ...legacyContent,
      success_outcomes: sevenOutcomes,
    }).success).toBe(false)
    expect(LegacyRoleProfileContentSchema.safeParse({
      ...legacyContent,
      requirements: [{ ...legacyContent.requirements[0]!, level: maxArtifactText }],
    }).success).toBe(false)
    expect(LegacyRoleProfileContentSchema.safeParse({
      ...legacyContent,
      work_scenarios: [{ ...legacyContent.work_scenarios[0]!, stakeholders: longProjectionText }],
    }).success).toBe(false)
    expect(LegacyRoleProfileContentSchema.safeParse({
      ...legacyContent,
      boundaries: { ...legacyContent.boundaries, decision_rights: longProjectionText },
    }).success).toBe(false)
    expect(LegacyRoleProfileContentSchema.safeParse({
      ...legacyContent,
      boundaries: { ...legacyContent.boundaries, collaboration_and_resources: longProjectionText },
    }).success).toBe(false)
  })

  it('V2 最终画像拒绝超过上游理论最大组合长度的兼容投影', () => {
    const aboveJoinedSourceLimit = '甲'.repeat(48_012)
    const aboveCollaborationLimit = '甲'.repeat(96_030)

    expect(RoleProfileTalentDraftContentSchema.safeParse({
      ...validTalentDraftContent,
      work_scenarios: [{
        ...validTalentDraftContent.work_scenarios[0],
        stakeholders: aboveJoinedSourceLimit,
      }],
    }).success).toBe(false)
    expect(RoleProfileTalentDraftContentSchema.safeParse({
      ...validTalentDraftContent,
      boundaries: {
        ...validTalentDraftContent.boundaries,
        collaboration_and_resources: aboveCollaborationLimit,
      },
    }).success).toBe(false)
  })

  it('历史 standalone 岗位画像仍拒绝 13 条 requirements', () => {
    const {
      schema_version: _schemaVersion,
      stage: _stage,
      job_description: _jobDescription,
      job_description_confirmation: _jobDescriptionConfirmation,
      talent_profile: _talentProfile,
      ...legacyContent
    } = validTalentDraftContent
    expect(LegacyRoleProfileContentSchema.safeParse({
      ...legacyContent,
      requirements: thirteenLegacyRequirements,
    }).success).toBe(false)
  })

  it('拒绝缺失 legacy 投影、额外字段或篡改锁定岗位说明的 V2 人才画像草稿', () => {
    const { requirements: _requirements, ...missingLegacyProjection } = validTalentDraftContent
    expect(RoleProfileTalentDraftContentSchema.safeParse(missingLegacyProjection).success).toBe(false)
    expect(RoleProfileTalentDraftContentSchema.safeParse({
      ...validTalentDraftContent,
      unexpected_field: [],
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
    expect(talentPrompt).toContain('necessary_experience 和 must_have 各至少 1 项')
    expect(talentPrompt).toContain('五个分组各至少 1 项')
    expect(talentPrompt).toContain('只能引用已锁定岗位说明中的 KRA、O、S ID')
    expect(talentPrompt).toContain('11 个分组内及跨分组的 id 必须全局唯一')
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
