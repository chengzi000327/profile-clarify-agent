import { describe, expect, it } from 'vitest'
import type { ActorContext, RoleProfile } from '@role-clarifier/contracts'
import { MemoryStore } from '../store/memory-store.js'
import { DEMO_ROLE_SESSION_ID } from '../store/seed.js'
import { RoleService } from './role-service.js'

const manager: ActorContext = {
  tenant_id: 'tenant-demo',
  user_id: 'manager-demo',
  role: 'MANAGER',
  display_name: '用人经理',
}

const reviewingHr: ActorContext = {
  tenant_id: 'tenant-demo',
  user_id: 'hr-reviewer-outside-role',
  role: 'HR',
  display_name: '审核 HR',
}

const profile: RoleProfile = {
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
}

describe('岗位画像 HR 审核工作流', () => {
  it('只在经理提交后进入 HR 队列，并由 HR 作出最终通过决定', async () => {
    const store = new MemoryStore()
    await store.initialize()
    await store.saveUser({ ...reviewingHr, active: true })
    const service = new RoleService(store)

    expect(await service.list(reviewingHr)).toEqual([])

    const draft = await service.saveArtifactDraft(
      DEMO_ROLE_SESSION_ID,
      manager,
      'ROLE_PROFILE',
      profile,
    )
    expect(await service.list(reviewingHr)).toEqual([])

    const beforeSubmit = await service.get(DEMO_ROLE_SESSION_ID, manager)
    const submitted = await service.submitRoleProfileForReview(
      DEMO_ROLE_SESSION_ID,
      draft.id,
      manager,
      draft.content_hash,
      beforeSubmit.state.revision,
    )
    expect(submitted.profile_review).toMatchObject({
      status: 'PENDING',
      submitted_by: manager.user_id,
      submitted_by_name: manager.display_name,
      agent_advice: { recommendation: 'APPROVE' },
    })

    const queue = await service.list(reviewingHr)
    expect(queue).toHaveLength(1)
    expect(queue[0]?.id).toBe(DEMO_ROLE_SESSION_ID)

    await expect(service.saveArtifactDraft(
      DEMO_ROLE_SESSION_ID,
      reviewingHr,
      'ROLE_PROFILE',
      profile,
    )).rejects.toMatchObject({ code: 'FORBIDDEN', statusCode: 403 })

    const hrView = await service.get(DEMO_ROLE_SESSION_ID, reviewingHr)
    const reviewed = await service.reviewRoleProfile(
      DEMO_ROLE_SESSION_ID,
      draft.id,
      reviewingHr,
      {
        decision: 'APPROVE',
        comment: '画像依据完整，同意进入后续招聘设计。',
        content_hash: draft.content_hash,
        expected_revision: hrView.state.revision,
      },
    )
    expect(reviewed.artifact.status).toBe('CONFIRMED')
    expect(reviewed.state.profile_review).toMatchObject({
      status: 'APPROVED',
      reviewed_by: reviewingHr.user_id,
    })

    const managerView = await service.get(DEMO_ROLE_SESSION_ID, manager)
    expect(managerView.state.latest_artifacts.ROLE_PROFILE?.status).toBe('CONFIRMED')
    expect(managerView.state.profile_review?.review_comment).toContain('同意')
  })

  it('HR 不能代替用人经理发起新的岗位需求', async () => {
    const store = new MemoryStore()
    await store.initialize()
    const service = new RoleService(store)

    await expect(service.createIntake(reviewingHr)).rejects.toMatchObject({
      code: 'HR_REVIEW_ONLY',
      statusCode: 403,
    })
  })
})
