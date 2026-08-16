import { describe, expect, it } from 'vitest'
import {
  ASSESSMENT_GENERATION_PROMPT as SHARED_ASSESSMENT_PROMPT,
  CALIBRATION_ADVICE_GENERATION_PROMPT as SHARED_CALIBRATION_ADVICE_PROMPT,
  CANDIDATE_EVIDENCE_EXTRACTION_PROMPT as SHARED_CANDIDATE_EVIDENCE_PROMPT,
  HR_RECRUITING_BRIEF_GENERATION_PROMPT as SHARED_HR_BRIEF_PROMPT,
  PUBLIC_JD_GENERATION_PROMPT as SHARED_PUBLIC_JD_PROMPT,
  ROLE_CLARIFIER_SYSTEM_PROMPT as SHARED_SYSTEM_PROMPT,
  ROLE_PROFILE_GENERATION_PROMPT as SHARED_ROLE_PROFILE_PROMPT,
  ROLE_ROUTER_SYSTEM_PROMPT as SHARED_ROUTER_PROMPT,
} from '@role-clarifier/agent-spec'
import {
  ASSESSMENT_GENERATION_PROMPT,
  AssessmentScorecardSchema,
  CALIBRATION_ADVICE_GENERATION_PROMPT,
  CalibrationAdviceSchema,
  CANDIDATE_EVIDENCE_EXTRACTION_PROMPT,
  CandidateEvidenceSchema,
  FactCategorySchema,
  HARNESS_TASK_TOOL_POLICY,
  HRRecruitingBriefSchema,
  HR_RECRUITING_BRIEF_GENERATION_PROMPT,
  PublicJDSchema,
  PUBLIC_JD_GENERATION_PROMPT,
  ROLE_CLARIFIER_SYSTEM_PROMPT,
  ROLE_PROFILE_GENERATION_PROMPT,
  ROLE_ROUTER_SYSTEM_PROMPT,
  RoleProfileSchema,
} from './index.js'

describe('共享 Agent 规范', () => {
  it('从单一事实源导出 System Prompt', () => {
    expect(ROLE_CLARIFIER_SYSTEM_PROMPT).toBe(SHARED_SYSTEM_PROMPT)
    expect(ROLE_ROUTER_SYSTEM_PROMPT).toBe(SHARED_ROUTER_PROMPT)
    expect(ROLE_PROFILE_GENERATION_PROMPT).toBe(SHARED_ROLE_PROFILE_PROMPT)
    expect(ASSESSMENT_GENERATION_PROMPT).toBe(SHARED_ASSESSMENT_PROMPT)
    expect(CANDIDATE_EVIDENCE_EXTRACTION_PROMPT).toBe(SHARED_CANDIDATE_EVIDENCE_PROMPT)
    expect(PUBLIC_JD_GENERATION_PROMPT).toBe(SHARED_PUBLIC_JD_PROMPT)
    expect(HR_RECRUITING_BRIEF_GENERATION_PROMPT).toBe(SHARED_HR_BRIEF_PROMPT)
    expect(CALIBRATION_ADVICE_GENERATION_PROMPT).toBe(SHARED_CALIBRATION_ADVICE_PROMPT)
  })

  it('统一支持四类岗位事实', () => {
    expect(FactCategorySchema.options).toEqual([
      'BACKGROUND',
      'HIRING_REASON',
      'SUCCESS_CRITERION',
      'CONSTRAINT',
    ])
  })

  it('为每个领域任务声明最小工具白名单', () => {
    expect(HARNESS_TASK_TOOL_POLICY.CLARIFY_MESSAGE.allowed).toEqual([
      'read_role_state',
      'read_recruiting_context',
      'update_role_identity_draft',
      'save_fact_draft',
    ])
    expect(HARNESS_TASK_TOOL_POLICY.GENERATE_ROLE_PROFILE).toEqual({
      allowed: [],
      required: [],
    })
    expect(HARNESS_TASK_TOOL_POLICY.GENERATE_ASSESSMENT).toEqual({
      allowed: [],
      required: [],
    })
    expect(HARNESS_TASK_TOOL_POLICY.GENERATE_JD).toEqual({
      allowed: [],
      required: [],
    })
    expect(HARNESS_TASK_TOOL_POLICY.GENERATE_HR_BRIEF).toEqual({
      allowed: [],
      required: [],
    })
    expect(HARNESS_TASK_TOOL_POLICY.CALIBRATION_ADVICE).toEqual({
      allowed: [],
      required: [],
    })
    expect(HARNESS_TASK_TOOL_POLICY.VERSION_COMPARISON.allowed).toEqual([
      'read_version_diff',
    ])
  })
})

describe('CalibrationAdviceSchema', () => {
  const observingAdvice = {
    signal_type: 'RECRUITMENT_SIGNAL',
    disposition: 'OBSERVING',
    focus: {
      requirement_refs: ['R-01'],
      statement: '当前证据尚不足以形成岗位画像调整信号。',
    },
    trigger_evaluation: {
      policy: { minimum_candidates: 10, minimum_channels: 2, repeated_signal_count: 2 },
      actual: { candidate_count: 3, channel_count: 1, repeated_signals: [] },
      boundary_met: false,
      missing_conditions: ['还需 7 名有效候选人', '还需覆盖 1 个渠道', '尚未出现 2 次同类卡点'],
    },
    evidence_summary: {
      observed_patterns: [{
        requirement_ref: 'R-01',
        criterion: '业务判断',
        statuses: {
          SUPPORTED: 1,
          POSSIBLE_SUPPORT: 0,
          NOT_MENTIONED: 2,
          MISMATCH: 0,
          INTERVIEW_NEEDED: 0,
        },
        interpretation: '当前材料中两份未提及该要求，不等于候选人不具备。',
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
  }

  it('接受未达到 10/2/2 边界的观察建议', () => {
    expect(CalibrationAdviceSchema.safeParse(observingAdvice).success).toBe(true)
  })

  it('拒绝观察阶段提出画像变更或伪造 HR 审核状态', () => {
    expect(CalibrationAdviceSchema.safeParse({
      ...observingAdvice,
      disposition: 'HR_REVIEW_REQUIRED',
      requires_hr_review: true,
      recommendation: {
        ...observingAdvice.recommendation,
        action: 'RELAX',
        changes: [{ requirement_ref: 'R-01', before: '独立负责', after: '参与负责' }],
      },
    }).success).toBe(false)
  })
})

describe('CandidateEvidenceSchema', () => {
  const validCandidateEvidence = {
    candidate_ref: 'CAND-001',
    channel: '内推',
    source_format: 'TEXT',
    evidence: [{
      requirement_ref: 'R-01',
      criterion: '多租户平台产品经验',
      dimension_refs: ['D-01'],
      evidence_status: 'NOT_MENTIONED',
      signal: 'MISSING',
      confidence: 'HIGH',
      quote_span: null,
      rationale: '当前材料没有提供多租户平台相关信息。',
      needs_interview: true,
      interview_question: '请说明是否参与过多租户平台，并介绍本人职责。',
    }],
    bottlenecks: [],
  }

  it('保留“未提及”语义并要求后续验证', () => {
    expect(CandidateEvidenceSchema.safeParse(validCandidateEvidence).success).toBe(true)
  })

  it('拒绝把 NOT_MENTIONED 映射为 WEAK 或伪造原文', () => {
    expect(CandidateEvidenceSchema.safeParse({
      ...validCandidateEvidence,
      evidence: [{
        ...validCandidateEvidence.evidence[0],
        signal: 'WEAK',
        quote_span: { quote: '简历未提及', locator: '模型判断' },
      }],
    }).success).toBe(false)
  })
})

const validRoleProfile = {
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

describe('RoleProfileSchema', () => {
  it('接受带字段级引用的岗位画像', () => {
    expect(RoleProfileSchema.safeParse(validRoleProfile).success).toBe(true)
  })

  it('拒绝不存在的关键工作引用和额外字段', () => {
    const result = RoleProfileSchema.safeParse({
      ...validRoleProfile,
      hidden_note: '不得进入岗位画像',
      requirements: [{
        ...validRoleProfile.requirements[0],
        work_refs: ['W-99'],
      }],
    })
    expect(result.success).toBe(false)
  })
})

const validAssessmentScorecard = {
  dimensions: [{
    id: 'D-01',
    name: '业务路线判断与验证',
    criticality: 'CORE',
    weight: 100,
    requirement_refs: ['R-01'],
    work_refs: ['W-01'],
    method: {
      type: 'CASE_EXERCISE',
      instructions: '使用匿名业务案例，要求候选人说明路线取舍和验证方案。',
    },
    questions: [{
      prompt: '请分析案例并说明你会如何形成路线、作出取舍并验证判断。',
      probes: ['哪些约束会改变你的判断？'],
      evidence_to_collect: ['问题定义、取舍依据、验证设计和结果复盘'],
    }],
    evidence_criteria: {
      strong_evidence: ['能够比较多种方案并根据验证结果修正判断'],
      acceptable_evidence: ['能够形成基本路线并给出可执行验证方法'],
      risk_signals: ['只有方案描述，无法说明取舍依据或验证方式'],
    },
    anchors: {
      score_1: '无法建立业务目标与方案之间的关系，已有回答缺少判断依据。',
      score_3: '能够完成基本问题拆解，形成可执行路线并说明验证方法。',
      score_5: '能够处理复杂约束、比较方案，并根据验证结果迭代判断。',
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

describe('AssessmentScorecardSchema', () => {
  it('接受权重为 100 且面试计划完整覆盖的评估方案', () => {
    expect(AssessmentScorecardSchema.safeParse(validAssessmentScorecard).success).toBe(true)
  })

  it('拒绝权重错误、虚假维度引用和遗漏覆盖', () => {
    const result = AssessmentScorecardSchema.safeParse({
      ...validAssessmentScorecard,
      dimensions: [{ ...validAssessmentScorecard.dimensions[0], weight: 90 }],
      interview_plan: [{
        ...validAssessmentScorecard.interview_plan[0],
        dimension_refs: ['D-99'],
      }],
    })
    expect(result.success).toBe(false)
  })

  it('拒绝加分项一票否决和额外字段', () => {
    const result = AssessmentScorecardSchema.safeParse({
      ...validAssessmentScorecard,
      scoring_rules: {
        ...validAssessmentScorecard.scoring_rules,
        preferred_requirement_can_veto: true,
      },
      hidden_note: '不得保存',
    })
    expect(result.success).toBe(false)
  })
})

describe('PublicJDSchema', () => {
  const validPublicJD = {
    title_and_basics: {
      title: '商业化产品经理',
      department: '产品与商业化团队',
      location: '上海',
      employment_type: '全职',
    },
    about_the_role: '你将加入产品与商业化团队，围绕关键业务目标推动产品方案形成和验证。',
    what_you_will_do: [
      '分析业务目标与用户问题，形成可执行的产品路线',
      '推动关键产品方案设计、验证和持续迭代',
      '协同业务和交付团队建立清晰的工作目标与节奏',
      '沉淀关键决策和验证结论，支持后续产品演进',
    ],
    what_we_look_for: [
      '能够从复杂业务目标中识别关键问题并形成方案取舍',
      '能够通过用户、数据或实验结果验证产品判断',
      '能够在跨团队协作中建立承诺并持续推动闭环',
      '能够清晰说明本人在复杂项目中的职责、行动和结果',
    ],
  }

  it('接受四段式公开 JD，且汇报关系不再强制要求', () => {
    expect(PublicJDSchema.safeParse(validPublicJD).success).toBe(true)
  })

  it('拒绝额外模块和不足数量的职责要求', () => {
    const result = PublicJDSchema.safeParse({
      ...validPublicJD,
      title_and_basics: {
        title: '商业化产品经理',
        department: '产品与商业化团队',
        location: '上海',
        employment_type: '全职',
      },
      what_you_will_do: ['定义路线图并推动跨团队交付'],
      what_we_look_for: ['具备复杂业务抽象能力'],
      hidden_hr_note: '不得进入公开 JD',
    })

    expect(result.success).toBe(false)
  })
})

const validHRRecruitingBrief = {
  target_candidate_summary: '能够形成业务路线并亲自推动关键方案验证的产品人才。',
  target_types: [{
    label: '路线与验证型产品人才',
    fit_rationale: '能够同时覆盖路线取舍和方案验证。',
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
    priority_channels: [{
      channel: '定向寻访',
      rationale: '便于按实际项目证据识别候选人。',
      basis: 'SUGGESTED',
      source_refs: [],
    }],
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
    { prompt: '验证结果不符预期时你如何调整？', probes: ['哪些证据改变了判断？'], evidence_to_collect: ['判断修正与复盘'], requirement_refs: ['R-01'] },
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

describe('HRRecruitingBriefSchema', () => {
  it('接受可追溯、无人才库伪数据的 HR 招聘画像', () => {
    expect(HRRecruitingBriefSchema.safeParse(validHRRecruitingBrief).success).toBe(true)
  })

  it('拒绝未接人才库时的目标公司、错误门槛和额外字段', () => {
    expect(HRRecruitingBriefSchema.safeParse({
      ...validHRRecruitingBrief,
      market_context: {
        ...validHRRecruitingBrief.market_context,
        target_companies: [{ name: '某公司', rationale: '自行推测', source_refs: ['guess'] }],
      },
      hidden_manager_note: '不得保存',
    }).success).toBe(false)
  })
})
