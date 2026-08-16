import type {
  ArtifactEnvelope,
  AssessmentScorecard,
  Fact,
  HRRecruitingBrief,
  RoleProfile,
  RoleState,
} from '@role-clarifier/contracts'
import { createArtifactEnvelope, makeDefaultJD } from '@role-clarifier/domain'
import type { RoleAggregate, StoredUser } from './types.js'

const now = new Date().toISOString()
export const DEMO_ROLE_SESSION_ID = '11111111-1111-4111-8111-111111111111'

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
  {
    id: 'fact-04',
    category: 'CONSTRAINT',
    statement: '预算和编制决策由业务负责人确认',
    source: '用人经理确认',
    status: 'CONFIRMED',
    evidence_refs: ['conversation://turn/6'],
    visible_to: 'ALL',
    updated_at: now,
  },
]

const roleProfile = {
  mission: {
    statement: '连接业务策略、产品方案与跨团队落地，形成并验证商业化路线。',
    hiring_reason_fact_refs: ['fact-02'],
    success_criterion_fact_refs: ['fact-03'],
  },
  work: [
    {
      id: 'W-01',
      title: '形成并验证商业化路线',
      description: '把业务目标转化为可执行的商业化路线，并推动关键方案进入验证。',
      deliverables: ['商业化路线图', '关键方案验证结论'],
      success_criterion_fact_refs: ['fact-03'],
      other_fact_refs: ['fact-01', 'fact-02'],
    },
  ],
  boundaries: {
    owns: [{
      statement: '负责商业化路线与关键方案验证的业务推动。',
      fact_refs: ['fact-02', 'fact-03'],
      work_refs: ['W-01'],
    }],
    does_not_own: [{
      statement: '不直接作出预算和编制的最终决定。',
      fact_refs: ['fact-04'],
      work_refs: [],
    }],
    decision_rights: [{
      statement: '预算和编制决策由业务负责人确认。',
      fact_refs: ['fact-04'],
      work_refs: [],
    }],
    collaboration_and_resources: [],
  },
  requirements: [
    {
      id: 'R-01',
      priority: 'MUST_HAVE',
      name: '商业化路线判断与验证',
      level: '能够独立形成路线并推动关键方案验证',
      rationale: '该能力直接支撑入职 90 天内形成路线图并启动关键方案验证。',
      strong_evidence: ['能够说明如何从业务目标形成路线、作出取舍并用验证结果迭代判断'],
      acceptable_alternatives: ['在增长、产品策略或复杂业务方案中完成过相同闭环'],
      risk_signals: ['只有方案描述，无法说明关键取舍、推动过程或验证结果'],
      work_refs: ['W-01'],
      success_criterion_fact_refs: ['fact-03'],
      constraint_fact_refs: [],
    },
  ],
  open_questions: [{
    field_path: 'boundaries.collaboration_and_resources',
    reason: '当前已确认事实没有说明稳定的协作资源。',
    question: '完成商业化路线和方案验证时，可以稳定调用哪些团队或资源？',
  }],
} satisfies RoleProfile

const scorecard = {
  dimensions: [{
    id: 'D-01',
    name: '商业化路线判断与验证',
    criticality: 'CORE',
    weight: 100,
    requirement_refs: ['R-01'],
    work_refs: ['W-01'],
    method: {
      type: 'CASE_EXERCISE',
      instructions: '使用匿名商业化案例，验证候选人形成路线、作出取舍并设计验证的能力。',
    },
    questions: [{
      prompt: '请分析这个商业化案例，说明你会如何形成路线、作出关键取舍并验证判断。',
      probes: ['哪些约束会改变你的路线？', '你会如何判断验证结果是否支持原方案？'],
      evidence_to_collect: ['问题定义', '路线取舍依据', '验证设计', '根据结果迭代判断的方式'],
    }],
    evidence_criteria: {
      strong_evidence: ['能够比较多种路线，说明关键取舍，并用验证结果迭代判断'],
      acceptable_evidence: ['能够形成基本路线并给出可执行的关键方案验证方法'],
      risk_signals: ['只有方案描述，无法说明关键取舍、推动过程或验证结果'],
    },
    anchors: {
      score_1: '已有回答无法把业务目标转化为路线，或无法说明取舍依据和验证方法。',
      score_3: '能够形成基本路线，说明主要取舍，并给出可执行的方案验证方法。',
      score_5: '能够处理复杂约束、比较多种路线，并根据验证结果系统地修正判断。',
    },
  }],
  interview_plan: [{
    id: 'S-01',
    name: '商业化案例评估',
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
} satisfies AssessmentScorecard

const hrBrief = {
  target_candidate_summary: '能够从复杂业务目标中形成商业化产品路线，并亲自推动关键方案验证与迭代的产品人才。',
  target_types: [{
    label: '商业化路线与验证型产品人才',
    fit_rationale: '这类人才有机会同时覆盖路线判断、方案取舍和结果验证。',
    requirement_refs: ['R-01'],
    work_refs: ['W-01'],
  }],
  search_strategy: {
    titles: ['商业化产品负责人', '增长产品负责人', '产品策略负责人'],
    keyword_groups: [
      {
        name: '路线判断',
        keywords: ['商业化路线', '产品策略', '方案取舍'],
        requirement_refs: ['R-01'],
      },
      {
        name: '验证闭环',
        keywords: ['方案验证', '数据分析', '迭代复盘'],
        requirement_refs: ['R-01'],
      },
    ],
    boolean_query: '(“商业化产品负责人” OR “增长产品负责人” OR “产品策略负责人”) AND (“商业化路线” OR “产品策略”) AND (“方案验证” OR “迭代复盘”)',
    priority_channels: [
      {
        channel: '行业社群与定向寻访',
        rationale: '便于按实际商业化路线和验证经历定向识别候选人。',
        basis: 'SUGGESTED',
        source_refs: [],
      },
      {
        channel: '内部推荐',
        rationale: '可以优先核实候选人在复杂业务中的本人职责和实际结果。',
        basis: 'SUGGESTED',
        source_refs: [],
      },
    ],
  },
  resume_screen: {
    thirty_second_checks: [
      {
        criterion: '是否亲自形成过商业化或相似复杂业务路线',
        requirement_refs: ['R-01'],
        evidence_to_find: ['本人负责的问题定义、路线和关键取舍'],
        missing_action: 'VERIFY_NOT_REJECT',
      },
      {
        criterion: '是否推动过关键方案验证',
        requirement_refs: ['R-01'],
        evidence_to_find: ['验证目标、执行动作和结果证据'],
        missing_action: 'VERIFY_NOT_REJECT',
      },
      {
        criterion: '是否根据验证结果修正过判断',
        requirement_refs: ['R-01'],
        evidence_to_find: ['对方案迭代、取舍调整或复盘结论的说明'],
        missing_action: 'VERIFY_NOT_REJECT',
      },
    ],
    non_target_signals: [{
      signal: '已有项目材料只描述跟进执行，无法说明本人的路线判断或验证责任。',
      reason: '当前核心要求需要候选人亲自完成关键取舍并推动验证。',
      requirement_refs: ['R-01'],
      action: 'VERIFY',
    }],
  },
  phone_questions: [
    {
      prompt: '请介绍一个你亲自形成业务或产品路线的案例。',
      probes: ['当时最关键的取舍是什么？'],
      evidence_to_collect: ['本人职责、问题定义和路线取舍'],
      requirement_refs: ['R-01'],
    },
    {
      prompt: '请介绍一次你推动关键方案进入验证的经历。',
      probes: ['你如何确定验证标准？'],
      evidence_to_collect: ['验证方法、推动动作和可观察结果'],
      requirement_refs: ['R-01'],
    },
    {
      prompt: '请介绍一次验证结果与预期不一致时，你如何调整原有判断。',
      probes: ['哪些新证据促使你改变方案？'],
      evidence_to_collect: ['证据解读、判断修正和复盘方式'],
      requirement_refs: ['R-01'],
    },
  ],
  market_context: {
    status: 'NOT_CONNECTED',
    note: '尚未接入真实人才库或渠道数据，不提供供给结论和目标公司。',
    supply_observations: [],
    target_companies: [],
  },
  calibration_watchpoints: [{
    signal: '同一核心要求在多个渠道中持续缺少可验证证据。',
    requirement_refs: ['R-01'],
    trigger_rule: {
      minimum_candidates: 10,
      minimum_channels: 2,
      repeated_signal_count: 2,
    },
    action: 'HR_REVIEW',
  }],
  open_questions: ['人才库和渠道数据尚未接入，需要 HR 后续补充真实供给与渠道证据。'],
} satisfies HRRecruitingBrief

export const createDemoAggregate = (): RoleAggregate => {
  const artifacts: ArtifactEnvelope[] = [
    createArtifactEnvelope({
      roleSessionId: DEMO_ROLE_SESSION_ID,
      type: 'ROLE_PROFILE',
      version: 1,
      content: roleProfile,
      createdBy: 'manager-demo',
      status: 'CONFIRMED',
    }),
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
      content: makeDefaultJD('商业化产品负责人', '产品与商业化', '上海', '全职'),
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
    title: '商业化产品负责人',
    department: '产品与商业化',
    stage: 'JD_DRAFT',
    revision: 4,
    hc_status: 'APPROVED',
    facts,
    conflicts: [],
    public_job_basics: {
      location: {
        value: '上海',
        status: 'CONFIRMED',
        visibility: 'PUBLIC',
        source: 'HR',
        confirmed_at: now,
      },
      employment_type: {
        value: '全职',
        status: 'CONFIRMED',
        visibility: 'PUBLIC',
        source: 'HR',
        confirmed_at: now,
      },
    },
    hr_recruiting_context: {
      talent_pool_status: 'NOT_CONNECTED',
      searchable_fields: [],
      approved_channels: [],
      supply_observations: [],
      target_companies: [],
    },
    latest_artifacts: latestArtifacts,
    candidate_count: 0,
    candidate_channels: [],
    calibration_status: 'OBSERVING',
    created_at: now,
    updated_at: now,
  }
  return {
    state,
    member_ids: demoUsers.map((user) => user.user_id),
    artifacts,
    candidates: [],
    calibration_signals: [],
    manager_tasks: [],
  }
}
