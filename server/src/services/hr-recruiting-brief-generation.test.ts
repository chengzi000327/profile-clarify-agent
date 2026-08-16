import { describe, expect, it } from 'vitest'
import type {
  ActorContext,
  HRRecruitingBrief,
  RoleState,
} from '@role-clarifier/contracts'
import { MemoryStore } from '../store/memory-store.js'
import { DEMO_ROLE_SESSION_ID } from '../store/seed.js'
import {
  RoleService,
  evaluateHRBriefGenerationReadiness,
} from './role-service.js'

const hrActor: ActorContext = {
  tenant_id: 'tenant-demo',
  user_id: 'hr-demo',
  role: 'HR',
  display_name: 'HR',
}

const brief = (): HRRecruitingBrief => ({
  target_candidate_summary: '能够形成商业化路线并亲自推动关键方案验证的产品人才。',
  target_types: [{
    label: '路线与验证型产品人才',
    fit_rationale: '能够覆盖路线取舍和方案验证。',
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
})

const baseState = (): RoleState => ({
  id: 'role-test',
  tenant_id: 'tenant-demo',
  title: '增长负责人',
  department: '增长团队',
  stage: 'ASSESSMENT_CONFIRMED',
  revision: 1,
  hc_status: 'APPROVED',
  facts: [],
  conflicts: [],
  latest_artifacts: {},
  candidate_count: 0,
  candidate_channels: [],
  calibration_status: 'OBSERVING',
  created_at: '2026-08-16T00:00:00.000Z',
  updated_at: '2026-08-16T00:00:00.000Z',
})

describe('HR 招聘画像生成门禁与安全校验', () => {
  it('缺少已确认岗位画像时在模型前稳定阻断', () => {
    expect(evaluateHRBriefGenerationReadiness(baseState())).toMatchObject({
      allowed: false,
      code: 'ROLE_PROFILE_CONFIRMATION_REQUIRED',
    })
  })

  it('接受不编造市场数据且完整覆盖 Must-have 的草稿', async () => {
    const store = new MemoryStore()
    await store.initialize()
    const service = new RoleService(store)

    await expect(service.saveArtifactDraft(
      DEMO_ROLE_SESSION_ID,
      hrActor,
      'HR_RECRUITING_BRIEF',
      brief(),
    )).resolves.toMatchObject({ type: 'HR_RECRUITING_BRIEF', status: 'DRAFT' })
  })

  it('拒绝伪造的人才库目标公司', async () => {
    const store = new MemoryStore()
    await store.initialize()
    const service = new RoleService(store)
    const content = brief()
    content.market_context.target_companies = [{
      name: '某公司',
      rationale: '模型自行推测',
      source_refs: ['guess'],
    }]

    await expect(service.saveArtifactDraft(
      DEMO_ROLE_SESSION_ID,
      hrActor,
      'HR_RECRUITING_BRIEF',
      content,
    )).rejects.toBeTruthy()
  })

  it('拒绝不存在的岗位画像引用和 Must-have 覆盖缺失', async () => {
    const store = new MemoryStore()
    await store.initialize()
    const service = new RoleService(store)
    const content = brief()
    content.resume_screen.thirty_second_checks.forEach((item) => {
      item.requirement_refs = ['R-99']
    })

    await expect(service.saveArtifactDraft(
      DEMO_ROLE_SESSION_ID,
      hrActor,
      'HR_RECRUITING_BRIEF',
      content,
    )).rejects.toMatchObject({
      code: 'HR_BRIEF_INVALID_PROFILE_REFERENCE',
      statusCode: 422,
    })
  })

  it('拒绝岗位画像未支持的学历和大厂代理条件', async () => {
    const store = new MemoryStore()
    await store.initialize()
    const service = new RoleService(store)
    const content = brief()
    content.target_candidate_summary = '硕士及以上且具备大厂背景的候选人。'

    await expect(service.saveArtifactDraft(
      DEMO_ROLE_SESSION_ID,
      hrActor,
      'HR_RECRUITING_BRIEF',
      content,
    )).rejects.toMatchObject({
      code: 'HR_BRIEF_UNSUPPORTED_PROXY_REQUIREMENT',
      statusCode: 422,
    })
  })
})
