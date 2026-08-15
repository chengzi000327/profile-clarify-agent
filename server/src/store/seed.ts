import type { ArtifactEnvelope, Fact, RoleState } from '@role-clarifier/contracts'
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
  sourcing: {
    priority_channels: ['行业社群与定向寻访', '内部推荐'],
    search_titles: ['商业化产品负责人', '增长产品负责人', '产品策略负责人'],
  },
  calibration_notes: ['不要用“大厂背景”替代真实业务判断证据', '重点验证候选人是否亲自完成关键取舍'],
  compensation_note: '薪酬区间仅供 HR 在获批范围内使用，不向用人经理之外的候选人渠道暴露。',
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
      content: makeDefaultJD('商业化产品负责人', '产品与商业化'),
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
