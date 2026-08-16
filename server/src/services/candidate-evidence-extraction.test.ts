import { describe, expect, it } from 'vitest'
import type {
  ActorContext,
  CandidateEvidence,
  CandidateEvidenceFailure,
  RoleState,
} from '@role-clarifier/contracts'
import { MemoryStore } from '../store/memory-store.js'
import { DEMO_ROLE_SESSION_ID } from '../store/seed.js'
import { partitionCandidateImports } from '../agent/runner.js'
import {
  RoleService,
  assertCandidateEvidenceMatchesSources,
  evaluateCandidateEvidenceExtractionReadiness,
  type CandidateEvidenceSource,
} from './role-service.js'

const hrActor: ActorContext = {
  tenant_id: 'tenant-demo',
  user_id: 'hr-demo',
  role: 'HR',
  display_name: '招聘 HR',
}

const blockedState = (): RoleState => ({
  id: 'role-candidate-evidence-test',
  tenant_id: 'tenant-demo',
  title: '平台产品经理',
  department: '产品团队',
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
})

describe('P-07 候选人证据提取门禁与结果校验', () => {
  it('大批量按条数和字符预算切分，单份材料不会被拆开', () => {
    const candidates = Array.from({ length: 21 }, (_, index) => ({
      candidate_ref: `CAND-P07-${String(index + 1).padStart(3, '0')}`,
      channel: '招聘平台',
      format: 'TEXT' as const,
      content: index === 0 ? 'x'.repeat(30_000) : '常规脱敏候选人材料',
    }))
    const batches = partitionCandidateImports(candidates)
    expect(batches.map((batch) => batch.length)).toEqual([10, 10, 1])
    expect(batches.flat()).toEqual(candidates)
    expect(partitionCandidateImports(candidates.slice(0, 7), 16).map((batch) => batch.length))
      .toEqual([3, 3, 1])
  })

  it('没有已确认岗位画像时在模型调用前阻断', () => {
    expect(evaluateCandidateEvidenceExtractionReadiness(blockedState())).toMatchObject({
      allowed: false,
      code: 'ROLE_PROFILE_CONFIRMATION_REQUIRED',
    })
  })

  it('接受覆盖全部要求、原文可定位且状态映射正确的证据', async () => {
    const store = new MemoryStore()
    await store.initialize()
    const service = new RoleService(store)
    const view = await service.get(DEMO_ROLE_SESSION_ID, hrActor)
    const readiness = evaluateCandidateEvidenceExtractionReadiness(view.state)
    if (!readiness.allowed) throw new Error(readiness.reason)

    const source: CandidateEvidenceSource = {
      candidate_ref: 'CAND-P07-001',
      channel: '内推',
      format: 'TEXT',
      content: '主导商业化产品路线，并根据客户验证结果调整关键方案。',
    }
    const candidate: CandidateEvidence = {
      candidate_ref: source.candidate_ref,
      channel: source.channel,
      source_format: source.format,
      evidence: readiness.profile.requirements.map((requirement, index) => ({
        requirement_ref: requirement.id,
        criterion: requirement.name,
        dimension_refs: readiness.assessment.dimensions
          .filter((dimension) => dimension.requirement_refs.includes(requirement.id))
          .map((dimension) => dimension.id),
        evidence_status: index === 0 ? 'SUPPORTED' : 'NOT_MENTIONED',
        signal: index === 0 ? 'STRONG' : 'MISSING',
        confidence: 'HIGH',
        quote_span: index === 0
          ? { quote: '主导商业化产品路线', locator: '第1句' }
          : null,
        rationale: index === 0
          ? '原文直接说明本人主导相关工作。'
          : '当前材料没有提供该项要求的相关信息。',
        needs_interview: index !== 0,
        interview_question: index === 0
          ? null
          : `请补充与“${requirement.name}”相关的本人职责、行动和结果。`,
      })),
      bottlenecks: [],
    }

    expect(() => assertCandidateEvidenceMatchesSources(
      [candidate],
      [],
      [source],
      readiness.profile,
      readiness.assessment,
    )).not.toThrow()
  })

  it('拒绝不存在于当前候选人材料中的原文引用', async () => {
    const store = new MemoryStore()
    await store.initialize()
    const service = new RoleService(store)
    const view = await service.get(DEMO_ROLE_SESSION_ID, hrActor)
    const readiness = evaluateCandidateEvidenceExtractionReadiness(view.state)
    if (!readiness.allowed) throw new Error(readiness.reason)

    const requirement = readiness.profile.requirements[0]!
    const source: CandidateEvidenceSource = {
      candidate_ref: 'CAND-P07-002',
      channel: '招聘平台',
      format: 'TEXT',
      content: '材料只描述常规项目跟进。',
    }
    const evidence = readiness.profile.requirements.map((item, index) => ({
      requirement_ref: item.id,
      criterion: item.name,
      dimension_refs: readiness.assessment.dimensions
        .filter((dimension) => dimension.requirement_refs.includes(item.id))
        .map((dimension) => dimension.id),
      evidence_status: index === 0 ? 'MISMATCH' as const : 'NOT_MENTIONED' as const,
      signal: index === 0 ? 'WEAK' as const : 'MISSING' as const,
      confidence: 'HIGH' as const,
      quote_span: index === 0
        ? { quote: '本人从未承担任何相关工作', locator: '虚构位置' }
        : null,
      rationale: index === 0 ? '错误地声称存在直接反证。' : '当前材料未提及。',
      needs_interview: index !== 0,
      interview_question: index === 0 ? null : `请补充与“${item.name}”相关的证据。`,
    }))
    const candidate: CandidateEvidence = {
      candidate_ref: source.candidate_ref,
      channel: source.channel,
      source_format: source.format,
      evidence,
      bottlenecks: [`${requirement.id}:MISMATCH`],
    }

    expect(() => assertCandidateEvidenceMatchesSources(
      [candidate],
      [],
      [source],
      readiness.profile,
      readiness.assessment,
    )).toThrowError(expect.objectContaining({
      code: 'CANDIDATE_EVIDENCE_QUOTE_NOT_FOUND',
    }))
  })

  it('允许单个候选人失败而保留同批次其他候选人结果', async () => {
    const store = new MemoryStore()
    await store.initialize()
    const service = new RoleService(store)
    const view = await service.get(DEMO_ROLE_SESSION_ID, hrActor)
    const readiness = evaluateCandidateEvidenceExtractionReadiness(view.state)
    if (!readiness.allowed) throw new Error(readiness.reason)

    const sources: CandidateEvidenceSource[] = [
      { candidate_ref: 'CAND-P07-003', channel: '内推', format: 'TEXT', content: '材料未覆盖当前岗位要求。' },
      { candidate_ref: 'CAND-P07-004', channel: '招聘平台', format: 'TEXT', content: '' },
    ]
    const candidate: CandidateEvidence = {
      candidate_ref: sources[0]!.candidate_ref,
      channel: sources[0]!.channel,
      source_format: sources[0]!.format,
      evidence: readiness.profile.requirements.map((requirement) => ({
        requirement_ref: requirement.id,
        criterion: requirement.name,
        dimension_refs: readiness.assessment.dimensions
          .filter((dimension) => dimension.requirement_refs.includes(requirement.id))
          .map((dimension) => dimension.id),
        evidence_status: 'NOT_MENTIONED',
        signal: 'MISSING',
        confidence: 'HIGH',
        quote_span: null,
        rationale: '当前材料没有提供该项要求的相关信息。',
        needs_interview: true,
        interview_question: `请补充与“${requirement.name}”相关的岗位证据。`,
      })),
      bottlenecks: [],
    }
    const failures: CandidateEvidenceFailure[] = [{
      candidate_ref: sources[1]!.candidate_ref,
      code: 'EMPTY_CONTENT',
      message: '候选人材料为空，无法提取岗位证据。',
    }]

    await expect(service.importCandidateEvidence(
      DEMO_ROLE_SESSION_ID,
      hrActor,
      [candidate],
      sources,
      failures,
    )).resolves.toMatchObject({
      state: { candidate_count: 1 },
    })
  })
})
