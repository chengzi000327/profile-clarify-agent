import { describe, expect, it } from 'vitest'
import type {
  ActorContext,
  AssessmentScorecard,
  RoleState,
} from '@role-clarifier/contracts'
import { MemoryStore } from '../store/memory-store.js'
import { DEMO_ROLE_SESSION_ID } from '../store/seed.js'
import {
  RoleService,
  evaluateAssessmentGenerationReadiness,
} from './role-service.js'

const actor: ActorContext = {
  tenant_id: 'tenant-demo',
  user_id: 'manager-demo',
  role: 'MANAGER',
  display_name: '用人经理',
}

const scorecard = (): AssessmentScorecard => ({
  dimensions: [{
    id: 'D-01',
    name: '业务路线判断与验证',
    criticality: 'CORE',
    weight: 100,
    requirement_refs: ['R-01'],
    work_refs: ['W-01'],
    method: {
      type: 'CASE_EXERCISE',
      instructions: '使用匿名业务案例验证路线判断和方案验证能力。',
    },
    questions: [{
      prompt: '请分析案例并说明路线取舍、验证方法和判断依据。',
      probes: ['哪些约束会改变你的判断？'],
      evidence_to_collect: ['问题定义、取舍依据、验证设计和结果复盘'],
    }],
    evidence_criteria: {
      strong_evidence: ['能够比较方案并根据验证结果修正判断'],
      acceptable_evidence: ['能够形成基本路线并给出可执行验证方法'],
      risk_signals: ['只有方案描述，无法说明判断依据或验证方式'],
    },
    anchors: {
      score_1: '已有回答无法建立目标和方案之间的关系，也无法说明判断依据。',
      score_3: '能够完成基本问题拆解，形成可执行路线并说明验证方法。',
      score_5: '能够处理复杂约束、比较方案并根据验证结果迭代判断。',
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
})

describe('评估方案生成门禁与上游引用校验', () => {
  it('没有已确认岗位画像时稳定阻断', () => {
    const state: RoleState = {
      id: 'role-test',
      tenant_id: 'tenant-demo',
      title: '增长负责人',
      department: '增长团队',
      stage: 'PROFILE_DRAFT',
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
    }
    expect(evaluateAssessmentGenerationReadiness(state)).toMatchObject({
      allowed: false,
      code: 'ROLE_PROFILE_CONFIRMATION_REQUIRED',
    })
  })

  it('拒绝模型编造岗位画像 requirement 引用', async () => {
    const store = new MemoryStore()
    await store.initialize()
    const service = new RoleService(store)
    const content = scorecard()
    content.dimensions[0]!.requirement_refs = ['R-99']

    await expect(service.saveArtifactDraft(
      DEMO_ROLE_SESSION_ID,
      actor,
      'ASSESSMENT_SCORECARD',
      content,
    )).rejects.toMatchObject({
      code: 'ASSESSMENT_INVALID_PROFILE_REFERENCE',
      statusCode: 422,
    })
  })

  it('拒绝遗漏 Must-have 或错误降级为 Supporting', async () => {
    const store = new MemoryStore()
    await store.initialize()
    const service = new RoleService(store)
    const content = scorecard()
    content.dimensions[0]!.criticality = 'SUPPORTING'

    await expect(service.saveArtifactDraft(
      DEMO_ROLE_SESSION_ID,
      actor,
      'ASSESSMENT_SCORECARD',
      content,
    )).rejects.toMatchObject({
      code: 'ASSESSMENT_CRITICALITY_MISMATCH',
      statusCode: 422,
    })
  })
})
