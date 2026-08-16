import { describe, expect, it } from 'vitest'
import type { ActorContext, RoleProfile, RoleState } from '@role-clarifier/contracts'
import { MemoryStore } from '../store/memory-store.js'
import { DEMO_ROLE_SESSION_ID } from '../store/seed.js'
import {
  RoleService,
  evaluateRoleProfileGenerationReadiness,
} from './role-service.js'

const actor: ActorContext = {
  tenant_id: 'tenant-demo',
  user_id: 'manager-demo',
  role: 'MANAGER',
  display_name: '用人经理',
}

const profile = (): RoleProfile => ({
  mission: {
    statement: '形成商业化路线并推动关键方案验证。',
    hiring_reason_fact_refs: ['fact-02'],
    success_criterion_fact_refs: ['fact-03'],
  },
  work: [{
    id: 'W-01',
    title: '形成商业化路线',
    description: '将业务目标转化为路线并推动验证。',
    deliverables: ['商业化路线图', '关键方案验证结论'],
    success_criterion_fact_refs: ['fact-03'],
    other_fact_refs: ['fact-02'],
  }],
  boundaries: {
    owns: [{ statement: '负责路线形成和验证推动。', fact_refs: [], work_refs: ['W-01'] }],
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
    success_criterion_fact_refs: ['fact-03'],
    constraint_fact_refs: [],
  }],
  open_questions: [],
})

describe('岗位画像生成门禁与引用校验', () => {
  const blockedCases: Array<[Partial<RoleState>, string]> = [
    [{ hc_status: 'PENDING' }, 'HC_APPROVAL_REQUIRED'],
    [{ title: '待识别岗位' }, 'ROLE_IDENTITY_REQUIRED'],
    [{ facts: [] }, 'HIRING_REASON_REQUIRED'],
  ]

  it.each(blockedCases)('在前置条件不足时返回稳定阻断码', (patch, code) => {
    const base: RoleState = {
      id: 'role-test',
      tenant_id: 'tenant-demo',
      title: '增长负责人',
      department: '增长团队',
      stage: 'SUCCESS_CLARIFYING',
      revision: 1,
      hc_status: 'APPROVED',
      facts: [
        {
          id: 'hiring',
          category: 'HIRING_REASON',
          statement: '缺少增长负责人',
          source: '经理确认',
          status: 'CONFIRMED',
          evidence_refs: [],
          visible_to: 'ALL',
          updated_at: '2026-08-16T00:00:00.000Z',
        },
        {
          id: 'success',
          category: 'SUCCESS_CRITERION',
          statement: '六个月内完成增长路线验证',
          source: '经理确认',
          status: 'CONFIRMED',
          evidence_refs: [],
          visible_to: 'ALL',
          updated_at: '2026-08-16T00:00:00.000Z',
        },
      ],
      conflicts: [],
      latest_artifacts: {},
      candidate_count: 0,
      candidate_channels: [],
      calibration_status: 'OBSERVING',
      created_at: '2026-08-16T00:00:00.000Z',
      updated_at: '2026-08-16T00:00:00.000Z',
      ...patch,
    }
    expect(evaluateRoleProfileGenerationReadiness(base)).toMatchObject({
      allowed: false,
      code,
    })
  })

  it('拒绝模型编造或引用未确认的 fact_id', async () => {
    const store = new MemoryStore()
    await store.initialize()
    const service = new RoleService(store)
    const content = profile()
    content.mission.success_criterion_fact_refs = ['invented-fact-id']

    await expect(service.saveArtifactDraft(
      DEMO_ROLE_SESSION_ID,
      actor,
      'ROLE_PROFILE',
      content,
    )).rejects.toMatchObject({
      code: 'ROLE_PROFILE_INVALID_FACT_REFERENCE',
      statusCode: 422,
    })
  })
})
