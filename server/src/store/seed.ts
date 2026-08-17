import type { ArtifactEnvelope, Fact, HcApproval, HcContext, RoleState } from '@role-clarifier/contracts'
import { contentHash, createArtifactEnvelope, makeDefaultJD } from '@role-clarifier/domain'
import type { RoleAggregate, StoredUser } from './types.js'

const now = new Date().toISOString()
export const DEMO_ROLE_SESSION_ID = '11111111-1111-4111-8111-111111111111'

export const createMockHcContext = (input: {
  hiringManagerUserId: string
  assignedHrUserId?: string | null
  department?: string
}): HcContext => ({
  request_id: 'HC-2026-EP-001',
  status: 'APPROVED',
  approved_at: now,
  business_change: '企业服务业务正从单客户定制交付转向标准产品经营，需要建立跨项目的产品化责任主体。',
  organization_gap: '现有团队缺少持续负责产品边界、共性能力沉淀和多客户验证的岗位负责人。',
  approved_reason: '新增一名企业产品经理，负责把重复建设的客户需求转化为可规模复用的标准产品能力。',
  initial_responsibilities: [
    '识别多个客户项目中的共性需求并定义产品边界',
    '规划标准产品路线图，推动研发和交付团队形成复用能力',
    '组织核心客户验证并用结果迭代产品方案',
  ],
  recruiting_budget: '年度新增编制预算内，薪酬上限 50K · 15薪',
  recruiting_constraints: ['8 周内到岗', '北京或上海办公', '优先具备企业 SaaS 或平台产品经验'],
  hiring_manager_user_id: input.hiringManagerUserId,
  assigned_hr_user_id: input.assignedHrUserId ?? null,
  job_basics: {
    recruitment_type: 'NEW_HEADCOUNT',
    headcount: 1,
    level: '3-2 至 4-1',
    reporting_line: '产品负责人',
    locations: ['北京', '上海'],
    employment_type: '全职',
    salary_range: '35K-50K·15薪',
    target_onboard: '8 周内',
  },
})

const demoHcDefinitions = [
  {
    requestId: 'HC-2026-EP-001', title: '企业产品经理', department: '企业服务产品部',
    recruitmentType: 'NEW_HEADCOUNT',
    approvedReason: '业务从单客户定制交付转向标准产品经营，审批新增一名企业产品经理，负责沉淀跨项目可复用的标准产品能力。',
    recruitingBudget: '年度新增编制预算内，薪酬上限 50K · 15薪',
  },
  {
    requestId: 'HC-2026-RD-002', title: '高级后端工程师', department: '平台研发部',
    recruitmentType: 'ATTRITION_REPLACEMENT',
    approvedReason: '原核心服务技术负责人离职，审批在原编制内补充一名高级后端工程师，承接架构演进、稳定性治理和关键系统交接。',
    recruitingBudget: '离职替补使用原研发编制预算，薪酬上限 55K · 15薪',
  },
  {
    requestId: 'HC-2026-AI-003', title: 'AI 产品经理', department: '智能产品部',
    recruitmentType: 'ORGANIZATION_ADJUSTMENT',
    approvedReason: 'AI 产品化职责由创新项目组调整至智能产品部，审批补充一名 AI 产品经理，统一负责场景定义、模型评测和商业化验证。',
    recruitingBudget: '组织调整专项编制预算，薪酬上限 52K · 15薪',
  },
  {
    requestId: 'HC-2026-FE-004', title: '高级前端工程师', department: '平台研发部',
    recruitmentType: 'PERFORMANCE_REPLACEMENT',
    approvedReason: '现有高级前端岗位连续两个评估周期未达到架构与性能治理要求，完成汰换审批后在原编制内补充一名高级前端工程师。',
    recruitingBudget: '汰换补充使用原研发编制预算，薪酬上限 50K · 15薪',
  },
  {
    requestId: 'HC-2026-ALG-005', title: '推荐算法工程师', department: '算法工程部',
    recruitmentType: 'NEW_HEADCOUNT',
    approvedReason: '推荐业务从规则策略升级为模型驱动，审批新增一名推荐算法工程师，负责召回排序模型、在线实验和效果迭代。',
    recruitingBudget: '算法序列新增编制预算，薪酬上限 60K · 16薪',
  },
  {
    requestId: 'HC-2026-DP-006', title: '数据产品经理', department: '数据产品部',
    recruitmentType: 'ATTRITION_REPLACEMENT',
    approvedReason: '原指标平台产品经理离职且交接期有限，审批在原编制内补充一名数据产品经理，持续推进统一指标和自助分析产品。',
    recruitingBudget: '离职替补使用原产品编制预算，薪酬上限 45K · 15薪',
  },
  {
    requestId: 'HC-2026-MLP-007', title: '机器学习平台工程师', department: 'AI 基础设施部',
    recruitmentType: 'NEW_HEADCOUNT',
    approvedReason: '模型训练与推理任务快速增长，审批新增一名机器学习平台工程师，建设统一训练、部署、评测与监控基础设施。',
    recruitingBudget: 'AI 基础设施新增编制预算，薪酬上限 62K · 16薪',
  },
  {
    requestId: 'HC-2026-QA-008', title: '测试开发工程师', department: '质量工程部',
    recruitmentType: 'PERFORMANCE_REPLACEMENT',
    approvedReason: '现有质量工程岗位无法满足自动化平台和发布门禁建设要求，完成汰换审批后补充一名测试开发工程师。',
    recruitingBudget: '汰换补充使用原质量编制预算，薪酬上限 42K · 15薪',
  },
  {
    requestId: 'HC-2026-DE-009', title: '数据工程师', department: '数据平台部',
    recruitmentType: 'OTHER',
    approvedReason: '数据合规与湖仓成本治理进入集中改造期，审批专项补充一名数据工程师，负责实时链路、数据质量和成本优化。',
    recruitingBudget: '数据治理专项编制预算，薪酬上限 52K · 15薪',
  },
  {
    requestId: 'HC-2026-CLIENT-010', title: '客户端工程师', department: '终端研发部',
    recruitmentType: 'ORGANIZATION_ADJUSTMENT',
    approvedReason: '移动端与桌面端基础能力合并至终端研发部，审批随组织调整补充一名客户端工程师，统一负责跨端架构、性能和质量门禁。',
    recruitingBudget: '组织调整编制预算，薪酬上限 50K · 15薪',
  },
] as const satisfies ReadonlyArray<{
  requestId: string
  title: string
  department: string
  recruitmentType: HcContext['job_basics']['recruitment_type']
  approvedReason: string
  recruitingBudget: string
}>

export const demoHcApprovals: HcApproval[] = demoHcDefinitions.map(
  ({ requestId, title, department, recruitmentType, approvedReason, recruitingBudget }, index) => {
    const context = createMockHcContext({
      hiringManagerUserId: 'manager-demo',
      assignedHrUserId: 'hr-demo',
      department,
    })
    context.request_id = requestId
    context.approved_at = new Date(Date.UTC(2026, 7, index + 1, 1)).toISOString()
    context.approved_reason = approvedReason
    context.recruiting_budget = recruitingBudget
    context.job_basics.recruitment_type = recruitmentType
    return {
      request_id: requestId,
      tenant_id: 'tenant-demo',
      title,
      department,
      status: 'APPROVED',
      context,
      role_session_id: index === 0 ? DEMO_ROLE_SESSION_ID : null,
      created_at: context.approved_at,
      updated_at: context.approved_at,
    }
  },
)

export const demoUsers: StoredUser[] = [
  {
    tenant_id: 'tenant-demo',
    user_id: 'manager-demo',
    role: 'MANAGER',
    display_name: '用人经理 · 陈曦',
    active: true,
  },
  {
    tenant_id: 'tenant-demo',
    user_id: 'hr-demo',
    role: 'HR',
    display_name: 'HR · 林夏',
    active: true,
  },
  {
    tenant_id: 'tenant-demo',
    user_id: 'admin-demo',
    role: 'ADMIN',
    display_name: '企业管理员 · 周宁',
    active: true,
  },
]

const facts: Fact[] = [
  {
    id: 'fact-01',
    category: 'BACKGROUND',
    statement: '业务进入规模化增长阶段，需要统一商业化策略与交付节奏',
    source: 'S-01 HC 审批单',
    status: 'CONFIRMED',
    evidence_refs: ['mock://hc/2026-001'],
    visible_to: 'ALL',
    updated_at: now,
  },
  {
    id: 'fact-02',
    category: 'HIRING_REASON',
    statement: '现有团队缺少能够连接业务策略、产品方案和跨团队落地的岗位负责人',
    source: '用人经理确认',
    status: 'CONFIRMED',
    evidence_refs: ['conversation://turn/3'],
    visible_to: 'ALL',
    updated_at: now,
  },
  {
    id: 'fact-03',
    category: 'SUCCESS_CRITERION',
    statement: '入职 90 天完成商业化路线图，并推动至少一个关键方案进入验证',
    source: '用人经理确认',
    status: 'CONFIRMED',
    evidence_refs: ['conversation://turn/5'],
    visible_to: 'ALL',
    updated_at: now,
  },
]

const lockedJobDescription = {
  hiring_background: {
    business_change: '企业服务业务正从单客户定制交付转向标准产品经营，相似客户能力正在被重复建设。',
    organization_gap: '现有团队缺少持续负责跨项目产品边界、共性能力沉淀和多客户验证的责任主体。',
    hiring_conclusion: '新增一名企业产品经理，而不是继续补充单客户项目交付角色。',
    no_hire_impact: '标准化路线会继续被项目节奏打断，重复研发和交付成本难以下降。',
    evidence_refs: ['hc://HC-2026-EP-001', 'conversation://turn/3'],
  },
  job_purpose: {
    statement: '将分散在客户交付中的共性需求转化为可规模复用的标准产品，并推动产品完成核心客户验证。',
    evidence_refs: ['hc://HC-2026-EP-001', 'conversation://turn/3'],
  },
  key_accountabilities: [
    {
      id: 'KRA-01', name: '机会诊断与产品边界', responsibility: '识别跨项目共性需求，定义标准能力边界和产品路线。',
      core_outputs: ['共性机会清单', '产品路线图'], success_outcome_refs: ['O-01'], evidence_refs: ['conversation://turn/3'],
    },
    {
      id: 'KRA-02', name: 'MVP 与客户验证', responsibility: '推动优先级最高的标准能力完成 MVP 并进入核心客户验证。',
      core_outputs: ['MVP 范围', '客户试点复盘'], success_outcome_refs: ['O-02'], evidence_refs: ['conversation://turn/5'],
    },
    {
      id: 'KRA-03', name: '复用经营', responsibility: '用复用率、采用率和交付周期持续判断产品价值。',
      core_outputs: ['复用指标看板', '经营复盘'], success_outcome_refs: ['O-03'], evidence_refs: ['hc://HC-2026-EP-001'],
    },
  ],
  success_criteria: [
    {
      id: 'O-01', horizon: '3个月', title: '完成标准化机会诊断，并形成经关键团队评审的产品路线',
      definition: '复盘最近 12 个月不少于 20 个代表性项目，识别至少 3 个高价值共性机会，明确产品边界、价值假设和优先级。',
      measures: ['代表性项目覆盖', '共性机会质量', '路线评审通过', '关键角色共识'],
      status: '方向已确认 · 数字待确认', evidence_refs: ['conversation://turn/5'],
    },
    {
      id: 'O-02', horizon: '6个月', title: '推动首个标准能力完成 MVP 并进入核心客户验证',
      definition: '完成一个优先级最高的标准能力 MVP，至少进入 2 个核心客户试点，建立采用率、定制需求占比和交付周期基线。',
      measures: ['MVP 关键范围上线', '2 个客户试点', '验证指标可观测', '复盘形成迭代决策'],
      status: '试点数量待经理确认', evidence_refs: ['hc://HC-2026-EP-001'],
    },
    {
      id: 'O-03', horizon: '12个月', title: '形成可规模复用的产品能力与持续经营机制',
      definition: '让标准能力覆盖多个活跃客户，并通过复用率、采用率和交付周期判断规模化价值。',
      measures: ['活跃客户覆盖', '场景复用率', '交付周期改善', '路线持续迭代'],
      status: '目标值待业务基线确认', evidence_refs: ['hc://HC-2026-EP-001'],
    },
  ],
  work_scenarios: [
    {
      id: 'S-01', title: '跨项目业务诊断与共性抽象', frequency: '入职前 90 天高频，之后按季度复盘',
      trigger: '多个客户提出相似但表达不同的需求，团队无法判断应该定制还是产品化。',
      actions: '梳理业务目标、使用场景、差异和共性，建立需求分类与机会评估框架。',
      output: '项目需求图谱、共性机会清单和产品边界判断。',
      challenge: '避免被最大客户或最紧急项目绑架，同时保留高价值差异。',
      stakeholders: ['销售', '解决方案', '交付', '客户成功'], success_outcome_refs: ['O-01'], evidence_refs: ['conversation://turn/3'],
    },
    {
      id: 'S-02', title: '产品路线与优先级决策', frequency: '月度规划与重大需求触发',
      trigger: '业务价值、客户承诺、研发成本和长期产品方向发生冲突。',
      actions: '建立统一决策依据，量化价值与成本，明确做、不做和延后，并推动关键角色承诺。',
      output: '产品路线图、需求决策记录、范围与里程碑。',
      challenge: '在缺乏完整数据时作出可解释、可回溯的取舍。',
      stakeholders: ['产品负责人', '研发负责人', '销售负责人', '交付负责人'], success_outcome_refs: ['O-01', 'O-02'], evidence_refs: ['hc://HC-2026-EP-001'],
    },
    {
      id: 'S-03', title: '标准能力定义与 MVP 推动', frequency: '每个产品化机会一个完整周期',
      trigger: '标准化机会进入路线，需要从客户方案转化为清晰的产品能力。',
      actions: '定义核心用户、场景边界、能力模型和 MVP，协调研发完成方案并控制范围。',
      output: '产品方案、MVP 范围、验收标准和上线计划。',
      challenge: '既满足首批客户验证，又避免把首个客户需求重新做成定制项目。',
      stakeholders: ['研发', '设计', '解决方案', '试点客户'], success_outcome_refs: ['O-02'], evidence_refs: ['conversation://turn/5'],
    },
  ],
  boundaries: {
    owns: ['跨项目需求洞察、产品边界和标准化路线', '核心能力优先级、MVP 定义与验证指标', '销售、交付、研发之间的产品化取舍依据'],
    does_not_own: ['单个客户项目的进度管理和最终验收', '销售合同承诺与临时定制需求的直接交付'],
    decision_rights: ['可提出产品路线与需求取舍建议；最终优先级否决权仍需产品负责人确认。'],
    key_collaborations: ['销售', '解决方案', '交付', '研发'],
    available_resources: ['专属研发容量与数据支持尚待确认。'],
    evidence_refs: ['hc://HC-2026-EP-001'],
  },
} as const

const talentProfile = {
  target_talent_profile: {
    core_definition: '能从复杂企业客户场景中抽象共性需求，并把产品价值转化为可验证复用能力的产品负责人。',
    transferable_backgrounds: ['企业服务产品规划', '平台化或产品化转型', '复杂客户交付转产品'],
    fit_signals: ['能说明产品边界与优先级取舍', '有从机会判断到客户验证的完整闭环'],
    non_target_and_misjudgments: ['只负责单客户项目交付', '只描述协调推进而无法说明本人决策'],
    attraction_factors: ['参与平台能力从零到一建设', '直接影响产品经营与多客户复用'],
    evidence_refs: ['hc://HC-2026-EP-001', 'conversation://turn/3'],
  },
  qualifications: {
    hard_qualifications: [],
    necessary_experience: [{
      id: 'C-01', name: '复杂 B 端问题抽象与产品化', definition: '能够独立完成', maps_to: ['S-01', 'S-02'],
      observable_evidence: ['覆盖多个客户或业务单元，并形成被复用的标准能力'], evidence_refs: ['conversation://turn/3'], status: '推断',
    }],
    role_conditions: [],
    must_have: [
      {
        id: 'C-02', name: '从机会判断到 MVP 验证的闭环能力', definition: '至少主导过 1 次', maps_to: ['S-03'],
        observable_evidence: ['能说明机会判断、MVP 取舍、上线验证、指标结果和后续迭代'], evidence_refs: ['conversation://turn/5'], status: '推断',
      },
      {
        id: 'C-03', name: '跨销售、交付与研发的决策推动', definition: '能在无汇报关系下推动', maps_to: ['S-02', 'S-03'],
        observable_evidence: ['能还原目标冲突、决策依据、关键角色承诺和最终结果'], evidence_refs: ['hc://HC-2026-EP-001'], status: '推断',
      },
      {
        id: 'C-04', name: '以指标验证产品价值', definition: '能够定义并使用核心指标', maps_to: ['O-02', 'O-03'],
        observable_evidence: ['能说明指标定义、基线、数据限制以及指标如何改变产品决策'], evidence_refs: ['conversation://turn/5'], status: '推断',
      },
    ],
    preferred: [
      {
        id: 'C-05', name: '企业服务客户与交付链路理解', definition: '能够快速进入复杂场景', maps_to: ['S-01'],
        observable_evidence: ['接触过采购、决策、使用和交付角色分离的复杂 B 端场景'], evidence_refs: ['hc://HC-2026-EP-001'], status: '推断',
      },
      {
        id: 'C-06', name: '同行业经验', definition: '加速项，不作为简历硬筛', maps_to: ['S-01'],
        observable_evidence: ['能从行业洞察推导到产品决策并说明结果'], evidence_refs: ['hc://HC-2026-EP-001'], status: '推断',
      },
    ],
    alternatives: [],
  },
  competency_model: {
    knowledge: [{
      id: 'C-07',
      name: '企业服务产品经营知识',
      definition: '理解企业客户多角色决策、产品标准化与规模复用之间的关系。',
      maps_to: ['KRA-01', 'O-01'],
      observable_evidence: ['能结合真实业务说明采购、使用、交付角色差异如何影响产品边界与路线决策。'],
      evidence_refs: ['hc://HC-2026-EP-001', 'conversation://turn/3'],
      status: '推断',
    }],
    skills: [{
      id: 'C-08',
      name: '共性需求抽象与 MVP 定义',
      definition: '能把分散客户诉求转化为边界清晰、可验证的标准产品能力。',
      maps_to: ['KRA-01', 'KRA-02', 'S-01', 'S-03'],
      observable_evidence: ['能完整说明需求归类、取舍依据、MVP 范围、客户验证与后续迭代结果。'],
      evidence_refs: ['conversation://turn/3', 'conversation://turn/5'],
      status: '推断',
    }],
    behavioral_competencies: [{
      id: 'C-09',
      name: '跨团队影响与决策推动',
      definition: '在无直接汇报关系下推动销售、交付与研发围绕共同产品目标作出承诺。',
      maps_to: ['KRA-02', 'S-02', 'S-03'],
      observable_evidence: ['能还原一次目标冲突中的关键关系人、影响动作、决策形成过程和最终业务结果。'],
      evidence_refs: ['hc://HC-2026-EP-001', 'conversation://turn/5'],
      status: '推断',
    }],
    values_and_work_style: [{
      id: 'C-10',
      name: '长期价值与事实导向',
      definition: '面对短期交付压力时，以客户证据和经营指标维护长期产品边界。',
      maps_to: ['KRA-03', 'O-03', 'S-02'],
      observable_evidence: ['能说明一次拒绝、延后或收敛低复用需求的证据、取舍及对客户关系的处理。'],
      evidence_refs: ['hc://HC-2026-EP-001', 'conversation://turn/5'],
      status: '推断',
    }],
    career_motivation: [{
      id: 'C-11',
      name: '规模化产品建设动机',
      definition: '愿意承担从不确定机会识别到多客户复用的长期产品经营责任。',
      maps_to: ['KRA-02', 'KRA-03', 'O-02', 'O-03'],
      observable_evidence: ['能具体说明为何选择长期产品建设，以及过去如何在延迟反馈中持续推动验证和复用。'],
      evidence_refs: ['hc://HC-2026-EP-001', 'conversation://turn/3'],
      status: '推断',
    }],
  },
} as const

const buildRoleProfile = (jobDescriptionConfirmation: {
  source_artifact_id: string
  section_hash: string
  confirmed_by: string
  confirmed_at: string
}) => ({
  schema_version: '2',
  stage: 'TALENT_PROFILE_DRAFT',
  job_description: lockedJobDescription,
  job_description_confirmation: jobDescriptionConfirmation,
  talent_profile: talentProfile,
  hiring_reason: {
    conclusion: lockedJobDescription.hiring_background.hiring_conclusion,
    business_change: lockedJobDescription.hiring_background.business_change,
    organization_gap: lockedJobDescription.hiring_background.organization_gap,
    no_hire_impact: lockedJobDescription.hiring_background.no_hire_impact,
    evidence_refs: lockedJobDescription.hiring_background.evidence_refs,
  },
  mission: lockedJobDescription.job_purpose.statement,
  success_outcomes: lockedJobDescription.success_criteria,
  work_scenarios: lockedJobDescription.work_scenarios.map((scenario) => ({
    id: scenario.id,
    title: scenario.title,
    frequency: scenario.frequency,
    trigger: scenario.trigger,
    actions: scenario.actions,
    output: scenario.output,
    challenge: scenario.challenge,
    stakeholders: scenario.stakeholders.join('、'),
    outcome_refs: scenario.success_outcome_refs,
    evidence_refs: scenario.evidence_refs,
  })),
  requirements: [
    ...talentProfile.qualifications.necessary_experience.map((item) => ({ ...item, priority: 'Must-have' as const })),
    ...talentProfile.qualifications.must_have.map((item) => ({ ...item, priority: 'Must-have' as const })),
    ...talentProfile.qualifications.preferred.map((item) => ({ ...item, priority: 'Preferred' as const })),
    ...talentProfile.competency_model.knowledge.map((item) => ({ ...item, priority: 'Must-have' as const })),
    ...talentProfile.competency_model.skills.map((item) => ({ ...item, priority: 'Must-have' as const })),
    ...talentProfile.competency_model.behavioral_competencies.map((item) => ({ ...item, priority: 'Must-have' as const })),
    ...talentProfile.competency_model.values_and_work_style.map((item) => ({ ...item, priority: 'Must-have' as const })),
    ...talentProfile.competency_model.career_motivation.map((item) => ({ ...item, priority: 'Must-have' as const })),
  ].map((item) => ({
    id: item.id,
    priority: item.priority,
    name: item.name,
    level: item.definition,
    rationale: `对应岗位依据：${item.maps_to.join('、')}`,
    maps_to: item.maps_to,
    strong_evidence: item.observable_evidence,
    substitute_evidence: [],
    risk_signals: [],
    assessment_method: '围绕可观察证据进行结构化追问',
    evidence_refs: item.evidence_refs,
  })),
  boundaries: {
    owns: lockedJobDescription.boundaries.owns,
    does_not_own: lockedJobDescription.boundaries.does_not_own,
    decision_rights: lockedJobDescription.boundaries.decision_rights.join('、'),
    collaboration_and_resources: [
      `协作：${lockedJobDescription.boundaries.key_collaborations.join('、')}`,
      `资源：${lockedJobDescription.boundaries.available_resources.join('、')}`,
    ].join('；'),
    evidence_refs: lockedJobDescription.boundaries.evidence_refs,
  },
})

const scorecard = {
  dimensions: [
    {
      name: '业务判断',
      weight: 35,
      method: '结构化案例访谈',
      anchors: ['能够识别核心约束', '能说明取舍与风险', '用结果验证判断'],
    },
    {
      name: '问题抽象',
      weight: 35,
      method: '现场 Case',
      anchors: ['定义问题边界', '拆解关键假设', '形成可执行路径'],
    },
    {
      name: '跨团队推动',
      weight: 30,
      method: '行为访谈 + 背调问题',
      anchors: ['建立共同目标', '处理冲突', '持续闭环'],
    },
  ],
  decision_rule: '任一核心维度低于 3/5 不建议录用；总分相同优先业务判断。',
}

const hrBrief = {
  candidate_definition: '寻找一名能够从多个复杂客户项目中抽象共性需求、形成标准产品路线，并主导产品完成多客户验证的 B 端产品经理。',
  sourcing: {
    target_types: [
      {
        code: 'A',
        title: '企业 SaaS / 平台产品经理',
        why: '通常同时具备多客户、标准产品和持续经营经验。',
        check: '是否把多个客户需求沉淀成统一能力，并产生复用结果。',
      },
      {
        code: 'B',
        title: '从交付转产品的产品负责人',
        why: '熟悉复杂客户问题，也经历过从项目制走向产品化。',
        check: '是否真正摆脱单客户视角，而不是更高级的项目交付。',
      },
      {
        code: 'C',
        title: '行业解决方案产品经理',
        why: '业务理解深，能够处理客户差异和多角色协同。',
        check: '是否主导过标准产品，而不只是输出方案和完成验收。',
      },
    ],
    titles: ['企业产品经理', 'B 端产品经理', '平台产品经理', '行业产品经理'],
    keywords: ['多客户', '标准化', '产品化', '平台能力', 'MVP', '复用率'],
    query: '(企业产品经理 OR 平台产品经理 OR B端产品经理) AND (标准化 OR 产品化 OR 平台化) AND (多客户 OR 复用 OR 客户试点)',
    non_target: ['只有单客户定制项目', '主要负责需求承接和项目验收', '只描述协调研发与推动上线'],
  },
  resume_screening: {
    decision: '两项核心证据都明确则推进；命中一项则电话验证；都不明确则暂不推进。',
    core_signals: [
      {
        id: 'P-01',
        title: '多客户需求抽象',
        required: true,
        look_for: ['覆盖多个客户或业务单元', '形成统一模块、平台能力或产品边界', '出现复用率或交付效率结果'],
        not_enough: '只写负责客户需求管理或完成多个项目交付不算。',
      },
      {
        id: 'P-02',
        title: '完整产品化闭环',
        required: true,
        look_for: ['参与机会判断和 MVP 定义', '推动真实客户试点', '根据采用或复用结果迭代'],
        not_enough: '只写推动产品上线但没有验证结果不算。',
      },
      {
        id: 'P-03',
        title: '复杂协作与取舍',
        required: false,
        look_for: ['处理销售承诺与产品路线冲突', '推动定制与标准化取舍', '本人形成依据并促成决策'],
        not_enough: '只写协调各方、保障进度不能证明决策能力。',
      },
    ],
    rules: [
      { label: '直接推进', condition: 'P-01、P-02 证据明确，且能看到本人贡献', tone: 'go' },
      { label: '电话验证', condition: '命中一项核心证据，另一项经历存在但结果模糊', tone: 'verify' },
      { label: '暂不推进', condition: '只有项目交付、需求承接或同行业标签', tone: 'stop' },
    ],
  },
  phone_screen: [
    {
      question: '讲一个你把多个客户需求变成标准产品能力的案例。',
      listen_for: '客户差异、抽象过程、产品边界和最终复用结果。',
      risk: '只是汇总需求，没有说明如何取舍。',
    },
    {
      question: '哪些客户需求最后没有做？为什么？',
      listen_for: '明确的判断依据、影响对象和本人决策。',
      risk: '全部归因于领导决定，无法说明个人判断。',
    },
    {
      question: '产品上线后如何判断值得继续投入？',
      listen_for: '采用率、复用率、交付效率或明确业务结果。',
      risk: '把按时上线当作唯一成功标准。',
    },
    {
      question: '这件事里你本人推动了哪个关键决定？',
      listen_for: '本人角色、关键动作、阻力和最终结果。',
      risk: '反复使用“我们”，说不清本人贡献。',
    },
  ],
}

export const createDemoAggregate = (): RoleAggregate => {
  const sourceRoleProfile = createArtifactEnvelope({
    roleSessionId: DEMO_ROLE_SESSION_ID,
    type: 'ROLE_PROFILE',
    version: 1,
    content: {
      schema_version: '2',
      stage: 'JOB_DESCRIPTION_DRAFT',
      job_description: structuredClone(lockedJobDescription),
    },
    createdBy: 'manager-demo',
  })
  const jobDescriptionConfirmation = {
    source_artifact_id: sourceRoleProfile.id,
    section_hash: contentHash(lockedJobDescription),
    confirmed_by: 'manager-demo',
    confirmed_at: '2026-08-17T09:00:00.000Z',
  }
  const lockedRoleProfile = createArtifactEnvelope({
    roleSessionId: DEMO_ROLE_SESSION_ID,
    type: 'ROLE_PROFILE',
    version: 2,
    content: {
      schema_version: '2',
      stage: 'JOB_DESCRIPTION_CONFIRMED',
      job_description: structuredClone(lockedJobDescription),
      job_description_confirmation: structuredClone(jobDescriptionConfirmation),
    },
    createdBy: 'manager-demo',
    basedOnHash: sourceRoleProfile.content_hash,
  })
  const finalRoleProfileContent = structuredClone(buildRoleProfile(jobDescriptionConfirmation))
  const finalRoleProfile: ArtifactEnvelope = {
    ...createArtifactEnvelope({
      roleSessionId: DEMO_ROLE_SESSION_ID,
      type: 'ROLE_PROFILE',
      version: 3,
      content: finalRoleProfileContent,
      createdBy: 'manager-demo',
      basedOnHash: lockedRoleProfile.content_hash,
      status: 'CONFIRMED',
    }),
    confirmed_by: 'manager-demo',
    confirmed_at: '2026-08-17T09:05:00.000Z',
  }
  const artifacts: ArtifactEnvelope[] = [
    sourceRoleProfile,
    lockedRoleProfile,
    finalRoleProfile,
    createArtifactEnvelope({
      roleSessionId: DEMO_ROLE_SESSION_ID,
      type: 'ASSESSMENT_SCORECARD',
      version: 1,
      content: scorecard,
      createdBy: 'manager-demo',
      status: 'CONFIRMED',
    }),
    createArtifactEnvelope({
      roleSessionId: DEMO_ROLE_SESSION_ID,
      type: 'PUBLIC_JD',
      version: 1,
      content: makeDefaultJD('企业产品经理', '企业服务产品部'),
      createdBy: 'manager-demo',
      status: 'DRAFT',
    }),
    createArtifactEnvelope({
      roleSessionId: DEMO_ROLE_SESSION_ID,
      type: 'HR_RECRUITING_BRIEF',
      version: 1,
      content: hrBrief,
      createdBy: 'hr-demo',
      status: 'DRAFT',
    }),
  ]
  const latestArtifacts: RoleState['latest_artifacts'] = {}
  for (const artifact of artifacts) {
    latestArtifacts[artifact.type] = {
      id: artifact.id,
      version: artifact.version,
      status: artifact.status,
      content_hash: artifact.content_hash,
      content: artifact.content,
    }
  }
  const state: RoleState = {
    id: DEMO_ROLE_SESSION_ID,
    tenant_id: 'tenant-demo',
    title: '企业产品经理',
    department: '企业服务产品部',
    stage: 'JD_DRAFT',
    revision: 4,
    hc_status: 'APPROVED',
    hc_context: createMockHcContext({
      hiringManagerUserId: 'manager-demo',
      assignedHrUserId: 'hr-demo',
      department: '企业服务产品部',
    }),
    facts,
    conflicts: [],
    latest_artifacts: latestArtifacts,
    candidate_count: 0,
    candidate_channels: [],
    calibration_status: 'OBSERVING',
    created_at: now,
    updated_at: now,
  }
  return {
    state,
    member_ids: ['manager-demo', 'hr-demo'],
    artifacts,
    candidates: [],
    calibration_signals: [],
    manager_tasks: [],
  }
}
