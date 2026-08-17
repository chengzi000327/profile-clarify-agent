import type { ArtifactEnvelope, Fact, HcContext, RoleState } from '@role-clarifier/contracts'
import { createArtifactEnvelope, makeDefaultJD } from '@role-clarifier/domain'
import type { RoleAggregate, StoredUser } from './types.js'

const now = new Date().toISOString()
export const DEMO_ROLE_SESSION_ID = '11111111-1111-4111-8111-111111111111'

export const createMockHcContext = (input: {
  hiringManagerUserId: string
  assignedHrUserId?: string | null
  department?: string
}): HcContext => ({
  request_id: 'HC-2026-001',
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

const roleProfile = {
  mission: '连接商业目标、产品方案与跨团队交付，在不确定环境下持续产出可验证的增长结果。',
  outcomes: [
    { horizon: '30 天', result: '完成关键业务、用户和协作方访谈，形成机会地图' },
    { horizon: '90 天', result: '确认商业化路线图并推动首个重点方案进入验证' },
    { horizon: '180 天', result: '建立可复用的策略与复盘机制，持续改善转化质量' },
  ],
  capabilities: [
    { name: '业务判断', level: '高级', evidence: '能用数据和一线事实解释关键取舍' },
    { name: '复杂问题抽象', level: '高级', evidence: '能把模糊目标拆成可验证的假设和计划' },
    { name: '跨团队推动', level: '高级', evidence: '能在无直接汇报关系下建立承诺并交付' },
  ],
  boundaries: ['负责路线图与关键取舍；预算和编制决策由业务负责人确认'],
}

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
