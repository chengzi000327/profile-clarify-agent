import { describe, expect, it } from 'vitest'
import {
  applyFactDecision,
  contentHash,
  detectPII,
  evaluateCalibrationBoundary,
  invalidateDownstreamArtifacts,
} from './index.js'
import type { ArtifactEnvelope, ArtifactType, CandidateEvidence, Fact, RoleState } from '@role-clarifier/contracts'

const candidate = (index: number, bottlenecks: string[] = []): CandidateEvidence => ({
  candidate_ref: `CAND-${String(index).padStart(3, '0')}`,
  channel: index % 2 === 0 ? '内推' : '招聘网站',
  source_format: 'TEXT',
  evidence: [],
  bottlenecks,
})

const artifact = (
  id: string,
  type: ArtifactType,
  status: ArtifactEnvelope['status'] = 'CONFIRMED',
): ArtifactEnvelope => ({
  id,
  role_session_id: 'role-1',
  type,
  version: 1,
  status,
  content: { id },
  content_hash: `hash-${id}-0123456789`,
  based_on_hash: null,
  created_by: 'manager-demo',
  created_at: '2026-08-18T00:00:00.000Z',
  confirmed_by: status === 'CONFIRMED' ? 'manager-demo' : null,
  confirmed_at: status === 'CONFIRMED' ? '2026-08-18T00:30:00.000Z' : null,
})

const confirmedArtifacts = [
  artifact('artifact-profile', 'ROLE_PROFILE'),
  artifact('artifact-assessment', 'ASSESSMENT_SCORECARD'),
  artifact('artifact-jd', 'PUBLIC_JD'),
  artifact('artifact-hr', 'HR_RECRUITING_BRIEF'),
  artifact('artifact-profile-history', 'ROLE_PROFILE'),
]

const fact = (overrides: Partial<Fact> & Pick<Fact, 'id' | 'status'>): Fact => {
  const { id, status, ...rest } = overrides
  return {
    id,
    category: 'SUCCESS_CRITERION',
    statement: '入职 90 天形成产品路线图',
    source: 'Agent 从本轮对话提取，待人工确认',
    status,
    evidence_refs: [],
    visible_to: 'ALL',
    updated_at: '2026-08-18T01:00:00.000Z',
    source_message_id: 'message-1',
    source_run_id: 'run-1',
    proposed_by_user_id: 'manager-demo',
    confirmed_by_user_id: status === 'CONFIRMED' ? 'manager-demo' : null,
    confirmed_at: status === 'CONFIRMED' ? '2026-08-18T01:00:00.000Z' : null,
    supersedes_fact_id: null,
    decision_reason: null,
    ...rest,
  }
}

const roleState = (facts: Fact[], revision = 7): RoleState => ({
  id: 'role-1',
  tenant_id: 'tenant-demo',
  title: '企业产品经理',
  department: '企业服务产品部',
  stage: 'HR_BRIEF_CONFIRMED',
  revision,
  hc_status: 'APPROVED',
  hc_context: null,
  facts,
  conflicts: [],
  latest_artifacts: {
    ROLE_PROFILE: { id: 'artifact-profile', version: 1, status: 'CONFIRMED', content_hash: 'hash-artifact-profile-0123456789', content: {} },
    ASSESSMENT_SCORECARD: { id: 'artifact-assessment', version: 1, status: 'CONFIRMED', content_hash: 'hash-artifact-assessment-0123456789', content: {} },
    PUBLIC_JD: { id: 'artifact-jd', version: 1, status: 'CONFIRMED', content_hash: 'hash-artifact-jd-0123456789', content: {} },
    HR_RECRUITING_BRIEF: { id: 'artifact-hr', version: 1, status: 'CONFIRMED', content_hash: 'hash-artifact-hr-0123456789', content: {} },
  },
  candidate_count: 0,
  candidate_channels: [],
  calibration_status: 'OBSERVING',
  created_at: '2026-08-18T00:00:00.000Z',
  updated_at: '2026-08-18T01:00:00.000Z',
})

describe('domain rules', () => {
  it('规范化对象键顺序后计算稳定内容哈希', () => {
    expect(contentHash({ b: 2, a: 1 })).toBe(contentHash({ a: 1, b: 2 }))
  })

  it('确认上游变化后让已确认的下游产物失效', () => {
    const artifacts = [
      { id: '1', type: 'ROLE_PROFILE', status: 'CONFIRMED' },
      { id: '2', type: 'ASSESSMENT_SCORECARD', status: 'CONFIRMED' },
      { id: '3', type: 'PUBLIC_JD', status: 'DRAFT' },
    ] as ArtifactEnvelope[]
    const result = invalidateDownstreamArtifacts(artifacts, 'ROLE_PROFILE')
    expect(result[1]?.status).toBe('INVALIDATED')
    expect(result[2]?.status).toBe('DRAFT')
  })

  it('满足 10 名、2 渠道、2 次同类卡点后才进入 HR 审核', () => {
    const candidates = Array.from({ length: 10 }, (_, index) =>
      candidate(index, index < 2 ? ['商业判断证据不足'] : []),
    )
    expect(evaluateCalibrationBoundary(candidates)).toMatchObject({
      eligible: true,
      status: 'HR_REVIEW',
      candidate_count: 10,
      channel_count: 2,
    })
  })

  it('候选人资料发现联系方式和显式姓名时拒绝', () => {
    expect(detectPII('姓名：张三，邮箱 zhangsan@example.com，电话 13812345678')).toEqual([
      'PHONE',
      'EMAIL',
      'NAME',
    ])
  })
})

describe('岗位事实决策', () => {
  it('确认替代草稿后淘汰旧事实并只让最新正式产物失效', () => {
    const original = fact({ id: 'fact-original', status: 'CONFIRMED' })
    const replacement = fact({
      id: 'fact-replacement',
      status: 'DRAFT',
      statement: '入职 90 天形成并评审产品路线图',
      supersedes_fact_id: original.id,
      confirmed_by_user_id: null,
      confirmed_at: null,
    })
    const result = applyFactDecision({
      state: roleState([original, replacement]),
      artifacts: confirmedArtifacts,
      factId: replacement.id,
      request: { decision: 'CONFIRM', expected_revision: 7 },
      actorUserId: 'manager-demo',
      now: '2026-08-18T02:00:00.000Z',
      createId: () => 'unused',
    })

    expect(result.state.facts.find((item) => item.id === original.id)?.status).toBe('STALE')
    expect(result.state.facts.find((item) => item.id === replacement.id)?.status).toBe('CONFIRMED')
    expect(result.invalidated_artifact_ids).toEqual([
      'artifact-profile', 'artifact-assessment', 'artifact-jd', 'artifact-hr',
    ])
    expect(result.artifacts.find((item) => item.id === 'artifact-profile-history')?.status).toBe('CONFIRMED')
  })

  it('拒绝未生效草稿不会让正式产物失效', () => {
    const draft = fact({ id: 'fact-draft', status: 'DRAFT' })
    const result = applyFactDecision({
      state: roleState([draft]),
      artifacts: confirmedArtifacts,
      factId: draft.id,
      request: { decision: 'REJECT', expected_revision: 7, reason: '该事实与岗位目标不符' },
      actorUserId: 'manager-demo',
      now: '2026-08-18T02:00:00.000Z',
      createId: () => 'unused',
    })

    expect(result.state.facts[0]).toMatchObject({ status: 'STALE', decision_reason: '该事实与岗位目标不符' })
    expect(result.invalidated_artifact_ids).toEqual([])
  })

  it('修改已生效事实时先保留旧版本并创建待确认替代版本', () => {
    const original = fact({ id: 'fact-original', status: 'CONFIRMED' })
    const result = applyFactDecision({
      state: roleState([original]),
      artifacts: confirmedArtifacts,
      factId: original.id,
      request: {
        decision: 'REVISE',
        expected_revision: 7,
        replacement: { category: 'SUCCESS_CRITERION', statement: '入职 60 天完成产品路线图' },
      },
      actorUserId: 'manager-demo',
      now: '2026-08-18T02:00:00.000Z',
      createId: () => 'fact-replacement',
    })

    expect(result.state.facts.find((item) => item.id === original.id)?.status).toBe('CONFIRMED')
    expect(result.state.facts.find((item) => item.id === 'fact-replacement')).toMatchObject({
      status: 'DRAFT',
      supersedes_fact_id: original.id,
      proposed_by_user_id: 'manager-demo',
    })
    expect(result.invalidated_artifact_ids).toEqual([])
  })

  it('连续修改替代草稿后确认最新版本会淘汰已生效祖先', () => {
    const original = fact({ id: 'fact-original', status: 'CONFIRMED' })
    const firstDraft = fact({ id: 'fact-first-draft', status: 'STALE', supersedes_fact_id: original.id })
    const newestDraft = fact({ id: 'fact-newest', status: 'DRAFT', supersedes_fact_id: firstDraft.id })
    const result = applyFactDecision({
      state: roleState([original, firstDraft, newestDraft]),
      artifacts: confirmedArtifacts,
      factId: newestDraft.id,
      request: { decision: 'CONFIRM', expected_revision: 7 },
      actorUserId: 'manager-demo',
      now: '2026-08-18T02:00:00.000Z',
      createId: () => 'unused',
    })

    expect(result.state.facts.find((item) => item.id === original.id)?.status).toBe('STALE')
    expect(result.state.facts.find((item) => item.id === newestDraft.id)?.status).toBe('CONFIRMED')
  })

  it('重复确认已生效事实保持幂等且不重复失效', () => {
    const confirmed = fact({ id: 'fact-confirmed', status: 'CONFIRMED' })
    const state = roleState([confirmed])
    const result = applyFactDecision({
      state,
      artifacts: confirmedArtifacts,
      factId: confirmed.id,
      request: { decision: 'CONFIRM', expected_revision: 7 },
      actorUserId: 'manager-demo',
      now: '2026-08-18T02:00:00.000Z',
      createId: () => 'unused',
    })

    expect(result.state).toBe(state)
    expect(result.audit_action).toBeNull()
    expect(result.invalidated_artifact_ids).toEqual([])
  })

  it('已失效事实不能再次决策', () => {
    const stale = fact({ id: 'fact-stale', status: 'STALE' })
    expect(() => applyFactDecision({
      state: roleState([stale]),
      artifacts: confirmedArtifacts,
      factId: stale.id,
      request: { decision: 'CONFIRM', expected_revision: 7 },
      actorUserId: 'manager-demo',
      now: '2026-08-18T02:00:00.000Z',
      createId: () => 'unused',
    })).toThrow(expect.objectContaining({ code: 'FACT_NOT_DECIDABLE' }))
  })
})
