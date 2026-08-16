import { randomUUID } from 'node:crypto'
import {
  AssessmentScorecardSchema,
  ARTIFACT_VISIBILITY,
  CalibrationAdviceSchema,
  CandidateEvidenceSchema,
  HRRecruitingBriefSchema,
  PublicJDSchema,
  RoleProfileSchema,
  type AssessmentScorecard,
  type ActorContext,
  type ArtifactEnvelope,
  type ArtifactType,
  type CalibrationAdvice,
  type CalibrationAdviceContext,
  type CandidateEvidence,
  type CandidateEvidenceFailure,
  type FactCategory,
  type HRRecruitingBrief,
  type HRRecruitingContext,
  type PublicJD,
  type PublicJobBasics,
  type PublicJobBasicsUpdate,
  type RoleProfile,
  type RoleState,
} from '@role-clarifier/contracts'
import {
  DomainError,
  assertArtifactAccess,
  assertRevision,
  confirmArtifact,
  createArtifactEnvelope,
  detectPII,
  evaluateCalibrationBoundary,
  invalidateDownstreamArtifacts,
} from '@role-clarifier/domain'
import type {
  ApplicationStore,
  CalibrationSignalRecord,
  DecisionRecord,
  ManagerTaskRecord,
  RoleAggregate,
  RoleAggregateReadOptions,
} from '../store/index.js'
import {
  projectRoleStateForTask,
  type RoleStateProjection,
} from './role-state-projection.js'

const nowIso = (): string => new Date().toISOString()

export type RoleProfileGenerationBlockCode =
  | 'HC_APPROVAL_REQUIRED'
  | 'ROLE_IDENTITY_REQUIRED'
  | 'HIRING_REASON_REQUIRED'
  | 'SUCCESS_CRITERION_REQUIRED'
  | 'CORE_INPUT_CONFLICTED'

export type RoleProfileGenerationReadiness =
  | { allowed: true; code: null; reason: null }
  | { allowed: false; code: RoleProfileGenerationBlockCode; reason: string }

export const evaluateRoleProfileGenerationReadiness = (
  state: RoleState,
): RoleProfileGenerationReadiness => {
  if (state.hc_status !== 'APPROVED') {
    return {
      allowed: false,
      code: 'HC_APPROVAL_REQUIRED',
      reason: '当前 HC 尚未审批，需先完成 HC 审批后再生成岗位画像。',
    }
  }
  if (
    !state.title.trim()
    || !state.department.trim()
    || /待识别|待确认/.test(state.title)
    || /待识别|待确认/.test(state.department)
  ) {
    return {
      allowed: false,
      code: 'ROLE_IDENTITY_REQUIRED',
      reason: '岗位名称或所属团队尚未明确，需先完成岗位身份澄清。',
    }
  }
  if (state.conflicts.some((conflict) => conflict.status === 'OPEN')) {
    return {
      allowed: false,
      code: 'CORE_INPUT_CONFLICTED',
      reason: '当前存在尚未解决的岗位事实冲突，需由有权限的人类处理后再生成岗位画像。',
    }
  }
  if (!state.facts.some(
    (fact) => fact.status === 'CONFIRMED' && fact.category === 'HIRING_REASON',
  )) {
    return {
      allowed: false,
      code: 'HIRING_REASON_REQUIRED',
      reason: '当前没有已确认的招聘原因，需先完成招聘原因澄清和人工确认。',
    }
  }
  if (!state.facts.some(
    (fact) => fact.status === 'CONFIRMED' && fact.category === 'SUCCESS_CRITERION',
  )) {
    return {
      allowed: false,
      code: 'SUCCESS_CRITERION_REQUIRED',
      reason: '当前没有已确认的成功标准，需先完成至少一项成功标准的澄清和人工确认。',
    }
  }
  return { allowed: true, code: null, reason: null }
}

export type AssessmentGenerationBlockCode =
  | 'HC_APPROVAL_REQUIRED'
  | 'ROLE_PROFILE_CONFIRMATION_REQUIRED'
  | 'ROLE_PROFILE_INVALID'
  | 'ROLE_PROFILE_MUST_HAVE_REQUIRED'
  | 'ASSESSMENT_INPUT_CONFLICTED'

export type AssessmentGenerationReadiness =
  | { allowed: true; code: null; reason: null; profile: RoleProfile }
  | { allowed: false; code: AssessmentGenerationBlockCode; reason: string }

export const evaluateAssessmentGenerationReadiness = (
  state: RoleState,
): AssessmentGenerationReadiness => {
  if (state.hc_status !== 'APPROVED') {
    return {
      allowed: false,
      code: 'HC_APPROVAL_REQUIRED',
      reason: '当前 HC 尚未审批，需先完成 HC 审批后再生成评估方案。',
    }
  }
  if (state.conflicts.some((conflict) => conflict.status === 'OPEN')) {
    return {
      allowed: false,
      code: 'ASSESSMENT_INPUT_CONFLICTED',
      reason: '当前存在尚未解决的上游事实冲突，需由有权限的人类处理后再生成评估方案。',
    }
  }
  const artifact = state.latest_artifacts.ROLE_PROFILE
  if (!artifact || artifact.status !== 'CONFIRMED') {
    return {
      allowed: false,
      code: 'ROLE_PROFILE_CONFIRMATION_REQUIRED',
      reason: '当前没有已确认且有效的岗位画像，需先由用人经理和 HR 完成岗位画像审核确认。',
    }
  }
  const parsed = RoleProfileSchema.safeParse(artifact.content)
  if (!parsed.success) {
    return {
      allowed: false,
      code: 'ROLE_PROFILE_INVALID',
      reason: '当前已确认岗位画像不满足结构要求，需先修复并重新确认岗位画像。',
    }
  }
  if (!parsed.data.requirements.some((requirement) => requirement.priority === 'MUST_HAVE')) {
    return {
      allowed: false,
      code: 'ROLE_PROFILE_MUST_HAVE_REQUIRED',
      reason: '当前岗位画像没有 Must-have 要求，无法生成可追溯的核心评估维度。',
    }
  }
  return { allowed: true, code: null, reason: null, profile: parsed.data }
}

export type PublicJDGenerationBlockCode =
  | 'HC_APPROVAL_REQUIRED'
  | 'ROLE_IDENTITY_REQUIRED'
  | 'PUBLIC_JD_INPUT_CONFLICTED'
  | 'ROLE_PROFILE_CONFIRMATION_REQUIRED'
  | 'ROLE_PROFILE_INVALID'
  | 'ASSESSMENT_CONFIRMATION_REQUIRED'
  | 'ASSESSMENT_INVALID'
  | 'PUBLIC_JOB_BASICS_REQUIRED'

export type PublicJDGenerationReadiness =
  | {
      allowed: true
      code: null
      reason: null
      profile: RoleProfile
      assessment: AssessmentScorecard
      publicJobBasics: PublicJobBasics
    }
  | { allowed: false; code: PublicJDGenerationBlockCode; reason: string }

export const evaluatePublicJDGenerationReadiness = (
  state: RoleState,
): PublicJDGenerationReadiness => {
  if (state.hc_status !== 'APPROVED') {
    return {
      allowed: false,
      code: 'HC_APPROVAL_REQUIRED',
      reason: '当前 HC 尚未审批，需先完成 HC 审批后再生成对外 JD。',
    }
  }
  if (
    !state.title.trim()
    || !state.department.trim()
    || /待识别|待确认/.test(state.title)
    || /待识别|待确认/.test(state.department)
  ) {
    return {
      allowed: false,
      code: 'ROLE_IDENTITY_REQUIRED',
      reason: '岗位名称或所属团队尚未明确，需先完成岗位身份澄清。',
    }
  }
  if (state.conflicts.some((conflict) => conflict.status === 'OPEN')) {
    return {
      allowed: false,
      code: 'PUBLIC_JD_INPUT_CONFLICTED',
      reason: '当前存在尚未解决的上游事实冲突，需由有权限的人类处理后再生成对外 JD。',
    }
  }

  const profileArtifact = state.latest_artifacts.ROLE_PROFILE
  if (!profileArtifact || profileArtifact.status !== 'CONFIRMED') {
    return {
      allowed: false,
      code: 'ROLE_PROFILE_CONFIRMATION_REQUIRED',
      reason: '当前没有已确认且有效的岗位画像，需先完成岗位画像审核确认。',
    }
  }
  const profile = RoleProfileSchema.safeParse(profileArtifact.content)
  if (!profile.success) {
    return {
      allowed: false,
      code: 'ROLE_PROFILE_INVALID',
      reason: '当前已确认岗位画像不满足结构要求，需先修复并重新确认。',
    }
  }

  const assessmentArtifact = state.latest_artifacts.ASSESSMENT_SCORECARD
  if (!assessmentArtifact || assessmentArtifact.status !== 'CONFIRMED') {
    return {
      allowed: false,
      code: 'ASSESSMENT_CONFIRMATION_REQUIRED',
      reason: '当前没有已确认且有效的评估方案，需先完成评估方案审核确认。',
    }
  }
  const assessment = AssessmentScorecardSchema.safeParse(assessmentArtifact.content)
  if (!assessment.success) {
    return {
      allowed: false,
      code: 'ASSESSMENT_INVALID',
      reason: '当前已确认评估方案不满足结构要求，需先修复并重新确认。',
    }
  }

  const publicJobBasics = state.public_job_basics ?? {}
  if (!publicJobBasics.location || !publicJobBasics.employment_type) {
    return {
      allowed: false,
      code: 'PUBLIC_JOB_BASICS_REQUIRED',
      reason: '工作地点或雇佣类型尚未由人类确认并标记为可公开，暂不能生成对外 JD。',
    }
  }
  return {
    allowed: true,
    code: null,
    reason: null,
    profile: profile.data,
    assessment: assessment.data,
    publicJobBasics,
  }
}

export type HRBriefGenerationBlockCode =
  | 'HC_APPROVAL_REQUIRED'
  | 'ROLE_IDENTITY_REQUIRED'
  | 'HR_BRIEF_INPUT_CONFLICTED'
  | 'ROLE_PROFILE_CONFIRMATION_REQUIRED'
  | 'ROLE_PROFILE_INVALID'
  | 'ROLE_PROFILE_MUST_HAVE_REQUIRED'
  | 'ASSESSMENT_CONFIRMATION_REQUIRED'
  | 'ASSESSMENT_INVALID'

export type HRBriefGenerationReadiness =
  | {
      allowed: true
      code: null
      reason: null
      profile: RoleProfile
      assessment: AssessmentScorecard
      recruitingContext: HRRecruitingContext
    }
  | { allowed: false; code: HRBriefGenerationBlockCode; reason: string }

export const evaluateHRBriefGenerationReadiness = (
  state: RoleState,
): HRBriefGenerationReadiness => {
  if (state.hc_status !== 'APPROVED') {
    return {
      allowed: false,
      code: 'HC_APPROVAL_REQUIRED',
      reason: '当前 HC 尚未审批，需先完成 HC 审批后再生成 HR 招聘画像。',
    }
  }
  if (
    !state.title.trim()
    || !state.department.trim()
    || /待识别|待确认/.test(state.title)
    || /待识别|待确认/.test(state.department)
  ) {
    return {
      allowed: false,
      code: 'ROLE_IDENTITY_REQUIRED',
      reason: '岗位名称或所属团队尚未明确，需先完成岗位身份澄清。',
    }
  }
  if (state.conflicts.some((conflict) => conflict.status === 'OPEN')) {
    return {
      allowed: false,
      code: 'HR_BRIEF_INPUT_CONFLICTED',
      reason: '当前存在尚未解决的上游事实冲突，需由有权限的人类处理后再生成 HR 招聘画像。',
    }
  }
  const profileArtifact = state.latest_artifacts.ROLE_PROFILE
  if (!profileArtifact || profileArtifact.status !== 'CONFIRMED') {
    return {
      allowed: false,
      code: 'ROLE_PROFILE_CONFIRMATION_REQUIRED',
      reason: '当前没有已确认且有效的岗位画像，需先完成岗位画像审核确认。',
    }
  }
  const profile = RoleProfileSchema.safeParse(profileArtifact.content)
  if (!profile.success) {
    return {
      allowed: false,
      code: 'ROLE_PROFILE_INVALID',
      reason: '当前已确认岗位画像不满足结构要求，需先修复并重新确认。',
    }
  }
  if (!profile.data.requirements.some((item) => item.priority === 'MUST_HAVE')) {
    return {
      allowed: false,
      code: 'ROLE_PROFILE_MUST_HAVE_REQUIRED',
      reason: '当前岗位画像没有 Must-have 要求，无法生成可追溯的简历初筛和电话问题。',
    }
  }
  const assessmentArtifact = state.latest_artifacts.ASSESSMENT_SCORECARD
  if (!assessmentArtifact || assessmentArtifact.status !== 'CONFIRMED') {
    return {
      allowed: false,
      code: 'ASSESSMENT_CONFIRMATION_REQUIRED',
      reason: '当前没有已确认且有效的评估方案，需先完成评估方案审核确认。',
    }
  }
  const assessment = AssessmentScorecardSchema.safeParse(assessmentArtifact.content)
  if (!assessment.success) {
    return {
      allowed: false,
      code: 'ASSESSMENT_INVALID',
      reason: '当前已确认评估方案不满足结构要求，需先修复并重新确认。',
    }
  }
  const recruitingContext: HRRecruitingContext = state.hr_recruiting_context ?? {
    talent_pool_status: 'NOT_CONNECTED',
    searchable_fields: [],
    approved_channels: [],
    supply_observations: [],
    target_companies: [],
  }
  return {
    allowed: true,
    code: null,
    reason: null,
    profile: profile.data,
    assessment: assessment.data,
    recruitingContext,
  }
}

export type CandidateEvidenceExtractionBlockCode =
  | 'HC_APPROVAL_REQUIRED'
  | 'CANDIDATE_EVIDENCE_INPUT_CONFLICTED'
  | 'ROLE_PROFILE_CONFIRMATION_REQUIRED'
  | 'ROLE_PROFILE_INVALID'
  | 'ASSESSMENT_CONFIRMATION_REQUIRED'
  | 'ASSESSMENT_INVALID'

export type CandidateEvidenceExtractionReadiness =
  | {
      allowed: true
      code: null
      reason: null
      profile: RoleProfile
      assessment: AssessmentScorecard
    }
  | { allowed: false; code: CandidateEvidenceExtractionBlockCode; reason: string }

export const evaluateCandidateEvidenceExtractionReadiness = (
  state: RoleState,
): CandidateEvidenceExtractionReadiness => {
  if (state.hc_status !== 'APPROVED') {
    return {
      allowed: false,
      code: 'HC_APPROVAL_REQUIRED',
      reason: '当前 HC 尚未审批，不能导入候选人并提取证据。',
    }
  }
  if (state.conflicts.some((conflict) => conflict.status === 'OPEN')) {
    return {
      allowed: false,
      code: 'CANDIDATE_EVIDENCE_INPUT_CONFLICTED',
      reason: '当前存在尚未解决的上游事实冲突，需由有权限的人类处理后再提取候选人证据。',
    }
  }
  const profileArtifact = state.latest_artifacts.ROLE_PROFILE
  if (!profileArtifact || profileArtifact.status !== 'CONFIRMED') {
    return {
      allowed: false,
      code: 'ROLE_PROFILE_CONFIRMATION_REQUIRED',
      reason: '当前没有已确认且有效的岗位画像，无法确定候选人证据对应的岗位要求。',
    }
  }
  const profile = RoleProfileSchema.safeParse(profileArtifact.content)
  if (!profile.success) {
    return {
      allowed: false,
      code: 'ROLE_PROFILE_INVALID',
      reason: '当前已确认岗位画像不满足结构要求，需先修复并重新确认。',
    }
  }
  const assessmentArtifact = state.latest_artifacts.ASSESSMENT_SCORECARD
  if (!assessmentArtifact || assessmentArtifact.status !== 'CONFIRMED') {
    return {
      allowed: false,
      code: 'ASSESSMENT_CONFIRMATION_REQUIRED',
      reason: '当前没有已确认且有效的评估方案，无法建立候选人证据与评估维度的对应关系。',
    }
  }
  const assessment = AssessmentScorecardSchema.safeParse(assessmentArtifact.content)
  if (!assessment.success) {
    return {
      allowed: false,
      code: 'ASSESSMENT_INVALID',
      reason: '当前已确认评估方案不满足结构要求，需先修复并重新确认。',
    }
  }
  return {
    allowed: true,
    code: null,
    reason: null,
    profile: profile.data,
    assessment: assessment.data,
  }
}

export interface CandidateEvidenceSource {
  candidate_ref: string
  channel: string
  format: 'JSON' | 'TEXT'
  content: string | Record<string, unknown>
}

const candidateEvidenceSignalByStatus = {
  SUPPORTED: 'STRONG',
  POSSIBLE_SUPPORT: 'MIXED',
  NOT_MENTIONED: 'MISSING',
  MISMATCH: 'WEAK',
  INTERVIEW_NEEDED: 'MIXED',
} as const

const candidateSourceText = (source: CandidateEvidenceSource): string =>
  typeof source.content === 'string' ? source.content : JSON.stringify(source.content)

export const assertCandidateEvidenceMatchesSources = (
  candidates: CandidateEvidence[],
  failedCandidates: CandidateEvidenceFailure[],
  sources: CandidateEvidenceSource[],
  profile: RoleProfile,
  assessment: AssessmentScorecard,
): void => {
  const sourceByRef = new Map(sources.map((source) => [source.candidate_ref, source] as const))
  const outputRefs = [...candidates, ...failedCandidates].map((item) => item.candidate_ref)
  if (
    outputRefs.length !== sources.length
    || new Set(outputRefs).size !== outputRefs.length
    || outputRefs.some((ref) => !sourceByRef.has(ref))
  ) {
    throw new DomainError(
      'CANDIDATE_EVIDENCE_BATCH_MISMATCH',
      '候选人证据结果必须让每个输入 candidate_ref 恰好出现一次，且不得增加、遗漏或重复候选人。',
      422,
    )
  }
  for (const failure of failedCandidates) {
    const source = sourceByRef.get(failure.candidate_ref)
    if (!source) continue
    const isEmpty = typeof source.content === 'string'
      ? source.content.trim().length === 0
      : Object.keys(source.content).length === 0
    if (failure.code === 'EMPTY_CONTENT' && !isEmpty) {
      throw new DomainError(
        'CANDIDATE_EVIDENCE_FAILURE_REASON_INVALID',
        `${failure.candidate_ref} 的材料不为空，不能标记为 EMPTY_CONTENT。`,
        422,
      )
    }
  }

  const requirements = new Map(profile.requirements.map((item) => [item.id, item] as const))
  const dimensions = new Map(assessment.dimensions.map((item) => [item.id, item] as const))
  const expectedRequirementOrder = profile.requirements.map((item) => item.id)

  for (const candidate of candidates) {
    const source = sourceByRef.get(candidate.candidate_ref)
    if (!source) continue
    if (candidate.channel !== source.channel || candidate.source_format !== source.format) {
      throw new DomainError(
        'CANDIDATE_EVIDENCE_SOURCE_MISMATCH',
        `${candidate.candidate_ref} 的渠道或来源格式与当前输入不一致。`,
        422,
      )
    }
    const actualRequirementOrder = candidate.evidence.map((item) => item.requirement_ref)
    if (
      actualRequirementOrder.length !== expectedRequirementOrder.length
      || actualRequirementOrder.some((ref, index) => ref !== expectedRequirementOrder[index])
    ) {
      throw new DomainError(
        'CANDIDATE_EVIDENCE_REQUIREMENT_COVERAGE_INVALID',
        `${candidate.candidate_ref} 必须按当前岗位画像顺序覆盖每一项 requirement。`,
        422,
      )
    }

    const expectedBottlenecks: string[] = []
    const sourceText = candidateSourceText(source)
    for (const [index, evidence] of candidate.evidence.entries()) {
      const requirement = requirements.get(evidence.requirement_ref)
      if (!requirement || evidence.criterion !== requirement.name) {
        throw new DomainError(
          'CANDIDATE_EVIDENCE_REQUIREMENT_REFERENCE_INVALID',
          `${candidate.candidate_ref}.evidence.${index} 没有精确引用当前岗位要求。`,
          422,
        )
      }
      for (const dimensionRef of evidence.dimension_refs) {
        const dimension = dimensions.get(dimensionRef)
        if (!dimension || !dimension.requirement_refs.includes(evidence.requirement_ref)) {
          throw new DomainError(
            'CANDIDATE_EVIDENCE_DIMENSION_REFERENCE_INVALID',
            `${candidate.candidate_ref}.evidence.${index}.dimension_refs 包含不存在或未关联该要求的维度。`,
            422,
          )
        }
      }
      if (evidence.signal !== candidateEvidenceSignalByStatus[evidence.evidence_status]) {
        throw new DomainError(
          'CANDIDATE_EVIDENCE_SIGNAL_MAPPING_INVALID',
          `${candidate.candidate_ref}.evidence.${index} 的证据状态与 signal 映射不一致。`,
          422,
        )
      }
      if (evidence.quote_span && !sourceText.includes(evidence.quote_span.quote)) {
        throw new DomainError(
          'CANDIDATE_EVIDENCE_QUOTE_NOT_FOUND',
          `${candidate.candidate_ref}.evidence.${index}.quote_span 不是当前候选人材料中的连续原文。`,
          422,
        )
      }
      if (evidence.evidence_status === 'MISMATCH') {
        expectedBottlenecks.push(`${evidence.requirement_ref}:MISMATCH`)
      } else if (
        evidence.evidence_status === 'POSSIBLE_SUPPORT'
        || evidence.evidence_status === 'INTERVIEW_NEEDED'
      ) {
        expectedBottlenecks.push(`${evidence.requirement_ref}:NEEDS_VERIFICATION`)
      }
    }
    if (
      candidate.bottlenecks.length !== expectedBottlenecks.length
      || candidate.bottlenecks.some((item, index) => item !== expectedBottlenecks[index])
    ) {
      throw new DomainError(
        'CANDIDATE_EVIDENCE_BOTTLENECK_INVALID',
        `${candidate.candidate_ref}.bottlenecks 必须由证据状态确定，且不得把 NOT_MENTIONED 记为卡点。`,
        422,
      )
    }
  }

  const serializedOutput = JSON.stringify({
    candidates: candidates.map((candidate) => ({
      candidate_ref: candidate.candidate_ref,
      evidence: candidate.evidence.map((evidence) => ({
        quote_span: evidence.quote_span,
        rationale: evidence.rationale,
        interview_question: evidence.interview_question,
      })),
      bottlenecks: candidate.bottlenecks,
    })),
    failed_candidates: failedCandidates,
  })
  const pii = detectPII(serializedOutput)
  if (pii.length > 0) {
    throw new DomainError(
      'CANDIDATE_EVIDENCE_PII_DETECTED',
      `候选人证据输出包含疑似个人信息（${pii.join(', ')}）。`,
      422,
    )
  }
  if (/年龄|性别|民族|宗教|婚育|婚姻|家庭状况|健康状况|残障|身份证|住址|照片/.test(serializedOutput)) {
    throw new DomainError(
      'CANDIDATE_EVIDENCE_SENSITIVE_ATTRIBUTE_DETECTED',
      '候选人证据输出包含不允许的敏感个人属性。',
      422,
    )
  }
}

const assertCandidateEvidenceSummarySafe = (summary: string): void => {
  const pii = detectPII(summary)
  if (pii.length > 0 || /年龄|性别|民族|宗教|婚育|婚姻|家庭状况|健康状况|残障|身份证|住址/.test(summary)) {
    throw new DomainError(
      'CANDIDATE_EVIDENCE_SUMMARY_SENSITIVE_CONTENT',
      '候选人证据摘要包含不允许的个人信息。',
      422,
    )
  }
  if (/(?:建议|应当|应该|直接|可以|不建议).{0,4}(?:录用|淘汰|推进|拒绝)|候选人排名|综合分|匹配分/.test(summary)) {
    throw new DomainError(
      'CANDIDATE_EVIDENCE_SUMMARY_DECISION_NOT_ALLOWED',
      '候选人证据摘要不得包含评分、排名或人事决定。',
      422,
    )
  }
}

export const assertCalibrationAdviceMatchesContext = (
  advice: CalibrationAdvice,
  context: CalibrationAdviceContext,
  profile: RoleProfile,
): void => {
  CalibrationAdviceSchema.parse(advice)
  const evaluation = context.calibration_evaluation
  const trigger = advice.trigger_evaluation
  if (
    trigger.policy.minimum_candidates !== context.calibration_policy.minimum_candidates
    || trigger.policy.minimum_channels !== context.calibration_policy.minimum_channels
    || trigger.policy.repeated_signal_count !== context.calibration_policy.repeated_signal_count
    || trigger.actual.candidate_count !== evaluation.candidate_count
    || trigger.actual.channel_count !== evaluation.channel_count
    || trigger.boundary_met !== evaluation.eligible
    || trigger.missing_conditions.length !== evaluation.missing_conditions.length
    || trigger.missing_conditions.some((item, index) => item !== evaluation.missing_conditions[index])
    || trigger.actual.repeated_signals.length !== evaluation.repeated_bottlenecks.length
    || trigger.actual.repeated_signals.some((item, index) => {
      const expected = evaluation.repeated_bottlenecks[index]
      return !expected || item.label !== expected.label || item.count !== expected.count
    })
  ) {
    throw new DomainError(
      'CALIBRATION_ADVICE_BOUNDARY_MISMATCH',
      '校准建议中的策略、样本、重复卡点或边界结论与服务端确定性计算不一致。',
      422,
    )
  }

  const expectedDisposition = evaluation.eligible ? 'HR_REVIEW_REQUIRED' : 'OBSERVING'
  if (
    advice.disposition !== expectedDisposition
    || advice.requires_hr_review !== evaluation.eligible
    || advice.next_check.action !== (evaluation.eligible ? 'HR_REVIEW' : 'CONTINUE_OBSERVING')
  ) {
    throw new DomainError(
      'CALIBRATION_ADVICE_DISPOSITION_MISMATCH',
      '校准建议的状态、HR 审核要求或下一步动作与确定性边界不一致。',
      422,
    )
  }

  const expectedPatterns = context.candidate_summary.criteria
  const actualPatterns = advice.evidence_summary.observed_patterns
  if (
    actualPatterns.length !== expectedPatterns.length
    || actualPatterns.some((pattern, index) => {
      const expected = expectedPatterns[index]
      return !expected
        || pattern.requirement_ref !== expected.requirement_ref
        || pattern.criterion !== expected.criterion
        || JSON.stringify(pattern.statuses) !== JSON.stringify(expected.evidence_statuses)
    })
  ) {
    throw new DomainError(
      'CALIBRATION_ADVICE_EVIDENCE_SUMMARY_MISMATCH',
      'observed_patterns 必须按输入顺序完整保留候选人证据五态聚合。',
      422,
    )
  }

  const requirements = new Map(profile.requirements.map((item) => [item.id, item] as const))
  const referenceGroups = [
    advice.focus.requirement_refs,
    advice.recommendation.target_requirement_refs,
    advice.recommendation.changes.map((change) => change.requirement_ref),
  ]
  for (const refs of referenceGroups) {
    for (const ref of refs) {
      if (!requirements.has(ref)) {
        throw new DomainError(
          'CALIBRATION_ADVICE_REQUIREMENT_REFERENCE_INVALID',
          `校准建议引用了当前已确认岗位画像中不存在的要求：${ref}`,
          422,
        )
      }
    }
    if (new Set(refs).size !== refs.length) {
      throw new DomainError(
        'CALIBRATION_ADVICE_REQUIREMENT_REFERENCE_INVALID',
        '校准建议的 requirement_refs 不得重复。',
        422,
      )
    }
  }
  for (const change of advice.recommendation.changes) {
    if (change.before !== requirements.get(change.requirement_ref)?.level) {
      throw new DomainError(
        'CALIBRATION_ADVICE_BEFORE_MISMATCH',
        `${change.requirement_ref} 的 before 必须逐字复制当前已确认 requirement.level。`,
        422,
      )
    }
  }

  if (advice.exclusion_checks.recruitment_execution_verified) {
    throw new DomainError(
      'CALIBRATION_ADVICE_EXECUTION_EVIDENCE_MISSING',
      '当前上下文没有招聘执行核验数据，不能声称检索、渠道或初筛执行已经验证。',
      422,
    )
  }
  const changeActions = ['REWRITE', 'RELAX', 'DELETE']
  if (changeActions.includes(advice.recommendation.action)) {
    const repeatedRequirementRefs = new Set(
      evaluation.repeated_bottlenecks
        .map((item) => item.label.match(/^(R-\d{2}):/)?.[1])
        .filter((item): item is string => Boolean(item)),
    )
    const proposedRequirementRefs = [
      ...advice.recommendation.target_requirement_refs,
      ...advice.recommendation.changes.map((change) => change.requirement_ref),
    ]
    if (proposedRequirementRefs.some((ref) => !repeatedRequirementRefs.has(ref))) {
      throw new DomainError(
        'CALIBRATION_ADVICE_CHANGE_WITHOUT_REPEATED_SIGNAL',
        '画像变更建议只能指向已达到重复证据门槛的要求。',
        422,
      )
    }
  }

  if (!advice.evidence_summary.sample_limitations.some((item) =>
    /已导入候选人/.test(item)
    && /渠道/.test(item)
    && /不能.*(?:完整|整体).*人才市场/.test(item))) {
    throw new DomainError(
      'CALIBRATION_ADVICE_SAMPLE_LIMIT_MISSING',
      '校准建议必须明确当前数据仅代表已导入候选人和当前渠道，不能外推为完整人才市场。',
      422,
    )
  }

  const naturalText = JSON.stringify(advice)
  if (/\bCAND-[A-Z0-9-]+\b/i.test(naturalText)) {
    throw new DomainError(
      'CALIBRATION_ADVICE_CANDIDATE_DETAIL_FORBIDDEN',
      '校准建议不得包含 candidate_ref 或单个候选人明细。',
      422,
    )
  }
  if (/年龄|性别|民族|宗教|婚育|婚姻|家庭状况|健康状况|残障|身份证|住址|姓名|电话|邮箱/.test(naturalText)) {
    throw new DomainError(
      'CALIBRATION_ADVICE_SENSITIVE_CONTENT',
      '校准建议不得包含候选人身份或敏感属性。',
      422,
    )
  }
  if (/市场上?(?:没有|不存在|都没有)|市场供给(?:充足|不足|稀缺)|\d+\s*名匹配人才/.test(naturalText)) {
    throw new DomainError(
      'CALIBRATION_ADVICE_UNSUPPORTED_MARKET_CLAIM',
      '当前候选人样本不能外推为完整人才市场结论。',
      422,
    )
  }
}

const assertRoleProfileFactReferences = (
  profile: RoleProfile,
  state: RoleState,
): void => {
  const confirmedFacts = new Map(
    state.facts
      .filter((fact) => fact.status === 'CONFIRMED')
      .map((fact) => [fact.id, fact] as const),
  )
  const assertRefs = (
    refs: string[],
    fieldPath: string,
    expectedCategory?: FactCategory,
  ): void => {
    for (const ref of refs) {
      const fact = confirmedFacts.get(ref)
      if (!fact || (expectedCategory && fact.category !== expectedCategory)) {
        throw new DomainError(
          'ROLE_PROFILE_INVALID_FACT_REFERENCE',
          `${fieldPath} 包含不存在、未确认或类别不匹配的事实引用：${ref}`,
          422,
        )
      }
    }
  }

  assertRefs(
    profile.mission.hiring_reason_fact_refs,
    'mission.hiring_reason_fact_refs',
    'HIRING_REASON',
  )
  assertRefs(
    profile.mission.success_criterion_fact_refs,
    'mission.success_criterion_fact_refs',
    'SUCCESS_CRITERION',
  )
  for (const [index, work] of profile.work.entries()) {
    assertRefs(
      work.success_criterion_fact_refs,
      `work.${index}.success_criterion_fact_refs`,
      'SUCCESS_CRITERION',
    )
    assertRefs(work.other_fact_refs, `work.${index}.other_fact_refs`)
  }
  for (const [groupName, items] of Object.entries(profile.boundaries)) {
    for (const [index, item] of items.entries()) {
      assertRefs(item.fact_refs, `boundaries.${groupName}.${index}.fact_refs`)
    }
  }
  for (const [index, requirement] of profile.requirements.entries()) {
    assertRefs(
      requirement.success_criterion_fact_refs,
      `requirements.${index}.success_criterion_fact_refs`,
      'SUCCESS_CRITERION',
    )
    assertRefs(
      requirement.constraint_fact_refs,
      `requirements.${index}.constraint_fact_refs`,
      'CONSTRAINT',
    )
  }
}

const assertAssessmentProfileReferences = (
  scorecard: AssessmentScorecard,
  profile: RoleProfile,
): void => {
  const requirements = new Map(profile.requirements.map((item) => [item.id, item] as const))
  const workIds = new Set(profile.work.map((item) => item.id))
  const coveredMustHave = new Set<string>()

  for (const [dimensionIndex, dimension] of scorecard.dimensions.entries()) {
    let referencesMustHave = false
    for (const ref of dimension.requirement_refs) {
      const requirement = requirements.get(ref)
      if (!requirement) {
        throw new DomainError(
          'ASSESSMENT_INVALID_PROFILE_REFERENCE',
          `dimensions.${dimensionIndex}.requirement_refs 包含当前已确认岗位画像中不存在的要求：${ref}`,
          422,
        )
      }
      if (requirement.priority === 'MUST_HAVE') {
        referencesMustHave = true
        coveredMustHave.add(ref)
      }
    }
    for (const ref of dimension.work_refs) {
      if (!workIds.has(ref)) {
        throw new DomainError(
          'ASSESSMENT_INVALID_PROFILE_REFERENCE',
          `dimensions.${dimensionIndex}.work_refs 包含当前已确认岗位画像中不存在的关键工作：${ref}`,
          422,
        )
      }
    }
    const expectedCriticality = referencesMustHave ? 'CORE' : 'SUPPORTING'
    if (dimension.criticality !== expectedCriticality) {
      throw new DomainError(
        'ASSESSMENT_CRITICALITY_MISMATCH',
        `dimensions.${dimensionIndex}.criticality 应为 ${expectedCriticality}，必须与所引用要求的优先级一致。`,
        422,
      )
    }
  }

  const uncovered = profile.requirements
    .filter((requirement) =>
      requirement.priority === 'MUST_HAVE' && !coveredMustHave.has(requirement.id))
    .map((requirement) => requirement.id)
  if (uncovered.length > 0) {
    throw new DomainError(
      'ASSESSMENT_MUST_HAVE_NOT_COVERED',
      `以下 Must-have 要求没有对应评估维度：${uncovered.join(', ')}`,
      422,
    )
  }
}

const assertPublicJDMatchesConfirmedInputs = (
  jd: PublicJD,
  state: RoleState,
  profile: RoleProfile,
  basics: PublicJobBasics,
): void => {
  const header = jd.title_and_basics
  const requiredHeader: Record<'title' | 'department' | 'location' | 'employment_type', string> = {
    title: state.title,
    department: state.department,
    location: basics.location!.value,
    employment_type: basics.employment_type!.value,
  }
  for (const [field, expected] of Object.entries(requiredHeader)) {
    if (header[field as keyof typeof requiredHeader] !== expected) {
      throw new DomainError(
        'PUBLIC_JD_BASIC_FIELD_MISMATCH',
        `title_and_basics.${field} 必须与已确认公开字段精确一致。`,
        422,
      )
    }
  }

  const optionalFields = [
    'level',
    'work_mode',
    'reporting_line',
    'compensation',
  ] as const
  for (const field of optionalFields) {
    const output = header[field]
    const confirmed = basics[field]?.value
    if (output !== undefined && output !== confirmed) {
      throw new DomainError(
        'PUBLIC_JD_BASIC_FIELD_MISMATCH',
        `title_and_basics.${field} 没有已确认公开依据或与确认值不一致。`,
        422,
      )
    }
  }

  const publicText = [
    jd.about_the_role,
    ...jd.what_you_will_do,
    ...jd.what_we_look_for,
  ].join('\n')
  const forbiddenPatterns: Array<[RegExp, string]> = [
    [/\b(?:fact|candidate)-[A-Za-z0-9-]+\b/i, '内部事实或候选人标识'],
    [/\b(?:W|R|D|S)-\d{2}\b/, '内部工作、要求、维度或环节 ID'],
    [/HC\s*审批|Must[-_ ]?have|Preferred|评分卡|评分锚点|维度权重|风险信号|strong_evidence|risk_signals/i, '内部评估或岗位治理信息'],
    [/布尔检索|目标公司|寻源策略|渠道策略|人才供给/, 'HR 内部招聘策略'],
    [/年龄|性别|婚育|民族|宗教|身份证|照片要求|家庭状况|健康状况|残障/, '敏感或无关个人属性'],
    [/薪资|薪酬|\d+\s*[kK]\s*[·x×]?\s*\d*薪|元\s*\/\s*月|万元\s*\/\s*年/, '正文中的薪酬信息'],
  ]
  for (const [pattern, label] of forbiddenPatterns) {
    if (pattern.test(publicText)) {
      throw new DomainError(
        'PUBLIC_JD_FORBIDDEN_CONTENT',
        `对外 JD 包含不允许公开的${label}。`,
        422,
      )
    }
  }

  const upstreamRequirementText = profile.requirements
    .flatMap((requirement) => [
      requirement.name,
      requirement.level,
      requirement.rationale,
      ...requirement.strong_evidence,
      ...requirement.acceptable_alternatives,
    ])
    .join('\n')
  const proxyPatterns: Array<[RegExp, string]> = [
    [/本科|硕士|博士|学历|学位/, '学历或学位'],
    [/\d+\s*年以上|[一二三四五六七八九十]+年以上/, '固定工作年限'],
    [/985|211|名校|大厂|头部公司/, '学校或公司背景'],
    [/NeurIPS|ICML|ICLR|CVPR|ICCV|ACL|KDD|顶会|论文/i, '论文或会议经历'],
    [/ACM|ICPC|NOI|IOI|TopCoder|Kaggle|竞赛/i, '竞赛经历'],
  ]
  for (const [pattern, label] of proxyPatterns) {
    if (pattern.test(publicText) && !pattern.test(upstreamRequirementText)) {
      throw new DomainError(
        'PUBLIC_JD_UNSUPPORTED_PROXY_REQUIREMENT',
        `对外 JD 包含岗位画像未支持的${label}要求。`,
        422,
      )
    }
  }
}

const sameStringSet = (left: string[], right: string[]): boolean =>
  left.length === right.length
  && [...left].sort().every((item, index) => item === [...right].sort()[index])

const assertHRBriefMatchesConfirmedInputs = (
  brief: HRRecruitingBrief,
  profile: RoleProfile,
  recruitingContext: HRRecruitingContext,
): void => {
  const requirements = new Map(profile.requirements.map((item) => [item.id, item] as const))
  const workIds = new Set(profile.work.map((item) => item.id))
  const mustHaveIds = profile.requirements
    .filter((item) => item.priority === 'MUST_HAVE')
    .map((item) => item.id)

  const assertRequirementRefs = (
    refs: string[],
    path: string,
    mustHaveOnly = false,
  ): void => {
    for (const ref of refs) {
      const requirement = requirements.get(ref)
      if (!requirement) {
        throw new DomainError(
          'HR_BRIEF_INVALID_PROFILE_REFERENCE',
          `${path} 包含当前已确认岗位画像中不存在的要求：${ref}`,
          422,
        )
      }
      if (mustHaveOnly && requirement.priority !== 'MUST_HAVE') {
        throw new DomainError(
          'HR_BRIEF_PREFERRED_USED_AS_REJECTION',
          `${path} 不得把 Preferred 要求 ${ref} 作为非目标或降优先级信号。`,
          422,
        )
      }
    }
  }
  const assertWorkRefs = (refs: string[], path: string): void => {
    for (const ref of refs) {
      if (!workIds.has(ref)) {
        throw new DomainError(
          'HR_BRIEF_INVALID_PROFILE_REFERENCE',
          `${path} 包含当前已确认岗位画像中不存在的关键工作：${ref}`,
          422,
        )
      }
    }
  }

  for (const [index, targetType] of brief.target_types.entries()) {
    assertRequirementRefs(targetType.requirement_refs, `target_types.${index}.requirement_refs`)
    assertWorkRefs(targetType.work_refs, `target_types.${index}.work_refs`)
  }
  for (const [index, group] of brief.search_strategy.keyword_groups.entries()) {
    assertRequirementRefs(
      group.requirement_refs,
      `search_strategy.keyword_groups.${index}.requirement_refs`,
    )
  }

  const resumeCovered = new Set<string>()
  for (const [index, check] of brief.resume_screen.thirty_second_checks.entries()) {
    assertRequirementRefs(
      check.requirement_refs,
      `resume_screen.thirty_second_checks.${index}.requirement_refs`,
    )
    for (const ref of check.requirement_refs) {
      if (requirements.get(ref)?.priority === 'MUST_HAVE') resumeCovered.add(ref)
    }
  }
  for (const [index, signal] of brief.resume_screen.non_target_signals.entries()) {
    assertRequirementRefs(
      signal.requirement_refs,
      `resume_screen.non_target_signals.${index}.requirement_refs`,
      true,
    )
  }

  const phoneCovered = new Set<string>()
  for (const [index, question] of brief.phone_questions.entries()) {
    assertRequirementRefs(
      question.requirement_refs,
      `phone_questions.${index}.requirement_refs`,
    )
    for (const ref of question.requirement_refs) {
      if (requirements.get(ref)?.priority === 'MUST_HAVE') phoneCovered.add(ref)
    }
  }
  for (const [index, watchpoint] of brief.calibration_watchpoints.entries()) {
    assertRequirementRefs(
      watchpoint.requirement_refs,
      `calibration_watchpoints.${index}.requirement_refs`,
    )
  }

  const uncoveredResume = mustHaveIds.filter((id) => !resumeCovered.has(id))
  const uncoveredPhone = mustHaveIds.filter((id) => !phoneCovered.has(id))
  if (uncoveredResume.length > 0 || uncoveredPhone.length > 0) {
    throw new DomainError(
      'HR_BRIEF_MUST_HAVE_NOT_COVERED',
      [
        uncoveredResume.length > 0
          ? `简历初筛未覆盖：${uncoveredResume.join(', ')}`
          : '',
        uncoveredPhone.length > 0
          ? `电话初筛未覆盖：${uncoveredPhone.join(', ')}`
          : '',
      ].filter(Boolean).join('；'),
      422,
    )
  }

  const query = brief.search_strategy.boolean_query.toLocaleLowerCase('zh-CN')
  const containsTitle = brief.search_strategy.titles.some((title) =>
    query.includes(title.toLocaleLowerCase('zh-CN')))
  const containsKeyword = brief.search_strategy.keyword_groups.some((group) =>
    group.keywords.some((keyword) => query.includes(keyword.toLocaleLowerCase('zh-CN'))))
  if (!containsTitle || !containsKeyword) {
    throw new DomainError(
      'HR_BRIEF_SEARCH_QUERY_NOT_TRACEABLE',
      '布尔检索式必须至少使用一个已输出职称和一个已输出关键词。',
      422,
    )
  }
  if (/\bNOT\b/i.test(brief.search_strategy.boolean_query)) {
    throw new DomainError(
      'HR_BRIEF_UNSUPPORTED_EXCLUSION',
      '当前 HR 招聘画像不允许使用无依据的 NOT 检索条件。',
      422,
    )
  }

  const approvedChannels = new Map(
    recruitingContext.approved_channels.map((item) => [item.channel, item] as const),
  )
  for (const [index, channel] of brief.search_strategy.priority_channels.entries()) {
    if (channel.basis !== 'CONFIRMED_DATA') continue
    const approved = approvedChannels.get(channel.channel)
    if (!approved || !sameStringSet(channel.source_refs, approved.source_refs)) {
      throw new DomainError(
        'HR_BRIEF_UNSUPPORTED_CHANNEL_DATA',
        `search_strategy.priority_channels.${index} 没有匹配的已授权渠道数据。`,
        422,
      )
    }
  }

  if (brief.market_context.status !== recruitingContext.talent_pool_status) {
    throw new DomainError(
      'HR_BRIEF_MARKET_STATUS_MISMATCH',
      'market_context.status 必须与当前人才库接入状态一致。',
      422,
    )
  }
  if (
    recruitingContext.talent_pool_status === 'NOT_CONNECTED'
    && !/未接入|未连接|尚无.*数据/.test(brief.market_context.note)
  ) {
    throw new DomainError(
      'HR_BRIEF_MARKET_STATUS_MISMATCH',
      '人才库未接入时，market_context.note 必须明确说明数据缺失。',
      422,
    )
  }
  if (
    recruitingContext.talent_pool_status === 'DEMO'
    && !/演示|demo/i.test(brief.market_context.note)
  ) {
    throw new DomainError(
      'HR_BRIEF_MARKET_STATUS_MISMATCH',
      'DEMO 人才库数据必须在 market_context.note 中明确标记为演示。',
      422,
    )
  }
  const authorizedObservations = new Map(
    recruitingContext.supply_observations.map((item) => [item.statement, item] as const),
  )
  for (const [index, observation] of brief.market_context.supply_observations.entries()) {
    const authorized = authorizedObservations.get(observation.statement)
    if (!authorized || !sameStringSet(observation.source_refs, authorized.source_refs)) {
      throw new DomainError(
        'HR_BRIEF_UNSUPPORTED_MARKET_DATA',
        `market_context.supply_observations.${index} 没有匹配的已授权市场数据。`,
        422,
      )
    }
  }
  const authorizedCompanies = new Map(
    recruitingContext.target_companies.map((item) => [item.name, item] as const),
  )
  for (const [index, company] of brief.market_context.target_companies.entries()) {
    const authorized = authorizedCompanies.get(company.name)
    if (
      !authorized
      || company.rationale !== authorized.rationale
      || !sameStringSet(company.source_refs, authorized.source_refs)
    ) {
      throw new DomainError(
        'HR_BRIEF_UNSUPPORTED_MARKET_DATA',
        `market_context.target_companies.${index} 没有匹配的已授权目标公司数据。`,
        422,
      )
    }
  }

  const naturalText = [
    brief.target_candidate_summary,
    ...brief.target_types.flatMap((item) => [item.label, item.fit_rationale]),
    ...brief.search_strategy.titles,
    ...brief.search_strategy.keyword_groups.flatMap((item) => [item.name, ...item.keywords]),
    brief.search_strategy.boolean_query,
    ...brief.search_strategy.priority_channels.flatMap((item) => [item.channel, item.rationale]),
    ...brief.resume_screen.thirty_second_checks.flatMap((item) => [
      item.criterion,
      ...item.evidence_to_find,
    ]),
    ...brief.resume_screen.non_target_signals.flatMap((item) => [item.signal, item.reason]),
    ...brief.phone_questions.flatMap((item) => [
      item.prompt,
      ...item.probes,
      ...item.evidence_to_collect,
    ]),
    brief.market_context.note,
    ...brief.calibration_watchpoints.map((item) => item.signal),
    ...brief.open_questions,
  ].join('\n')
  const forbiddenPatterns: Array<[RegExp, string]> = [
    [/\bCAND-[A-Z0-9-]+\b/i, '候选人标识'],
    [/\b(?:D|S)-\d{2}\b|score_[135]|strong_evidence|risk_signals|维度权重|评分锚点/i, '内部评分逻辑'],
    [/自动淘汰|直接淘汰|一票否决|简历未提及.*(?:淘汰|不具备)/, '自动淘汰规则'],
    [/年龄|性别|婚育|民族|宗教|身份证|照片要求|家庭状况|健康状况|残障/, '敏感或无关个人属性'],
  ]
  for (const [pattern, label] of forbiddenPatterns) {
    if (pattern.test(naturalText)) {
      throw new DomainError(
        'HR_BRIEF_FORBIDDEN_CONTENT',
        `HR 招聘画像包含不允许的${label}。`,
        422,
      )
    }
  }

  const upstreamRequirementText = profile.requirements
    .flatMap((requirement) => [
      requirement.name,
      requirement.level,
      requirement.rationale,
      ...requirement.strong_evidence,
      ...requirement.acceptable_alternatives,
    ])
    .join('\n')
  const proxyPatterns: Array<[RegExp, string]> = [
    [/本科|硕士|博士|学历|学位/, '学历或学位'],
    [/\d+\s*年以上|[一二三四五六七八九十]+年以上/, '固定工作年限'],
    [/985|211|名校|大厂|头部公司/, '学校或公司背景'],
    [/NeurIPS|ICML|ICLR|CVPR|ICCV|ACL|KDD|顶会|论文/i, '论文或会议经历'],
    [/ACM|ICPC|NOI|IOI|TopCoder|Kaggle|竞赛/i, '竞赛经历'],
  ]
  for (const [pattern, label] of proxyPatterns) {
    if (pattern.test(naturalText) && !pattern.test(upstreamRequirementText)) {
      throw new DomainError(
        'HR_BRIEF_UNSUPPORTED_PROXY_REQUIREMENT',
        `HR 招聘画像包含岗位画像未支持的${label}条件。`,
        422,
      )
    }
  }
}

export interface RoleView {
  state: RoleState
  artifacts: ArtifactEnvelope[]
  candidates?: CandidateEvidence[]
  calibration_signals?: CalibrationSignalRecord[]
  manager_tasks: ManagerTaskRecord[]
}

export class RoleService {
  constructor(private readonly store: ApplicationStore) {}

  async list(actor: ActorContext): Promise<RoleState[]> {
    const states = await this.store.listRoleStates(actor)
    return states.map((state) => this.filterState(state, actor))
  }

  async get(roleSessionId: string, actor: ActorContext): Promise<RoleView> {
    const aggregate = await this.requireAggregate(roleSessionId, actor)
    return this.toView(aggregate, actor)
  }

  async readStateForTask(
    roleSessionId: string,
    actor: ActorContext,
    task: string,
  ): Promise<RoleStateProjection> {
    const includeCandidates = task === 'CALIBRATION_ADVICE' && ['HR', 'ADMIN'].includes(actor.role)
    const aggregate = await this.requireAggregate(roleSessionId, actor, {
      members: false,
      artifacts: false,
      candidates: includeCandidates,
      calibration_signals: false,
      manager_tasks: false,
    })
    return projectRoleStateForTask(
      this.filterState(aggregate.state, actor),
      task,
      includeCandidates ? aggregate.candidates : [],
    )
  }

  async create(
    actor: ActorContext,
    input: { title: string; department: string },
  ): Promise<RoleView> {
    const timestamp = nowIso()
    const state: RoleState = {
      id: randomUUID(),
      tenant_id: actor.tenant_id,
      title: input.title,
      department: input.department,
      stage: 'CREATED',
      revision: 0,
      hc_status: 'PENDING',
      facts: [],
      conflicts: [],
      latest_artifacts: {},
      candidate_count: 0,
      candidate_channels: [],
      calibration_status: 'OBSERVING',
      created_at: timestamp,
      updated_at: timestamp,
    }
    const aggregate: RoleAggregate = {
      state,
      member_ids: [actor.user_id],
      artifacts: [],
      candidates: [],
      calibration_signals: [],
      manager_tasks: [],
    }
    await this.store.createRoleAggregate(aggregate)
    return this.toView(aggregate, actor)
  }

  async createIntake(actor: ActorContext): Promise<RoleView> {
    const timestamp = nowIso()
    const state: RoleState = {
      id: randomUUID(),
      tenant_id: actor.tenant_id,
      title: '待识别岗位',
      department: '待确认团队',
      stage: 'REASON_CLARIFYING',
      revision: 0,
      hc_status: 'APPROVED',
      facts: [],
      conflicts: [],
      latest_artifacts: {},
      candidate_count: 0,
      candidate_channels: [],
      calibration_status: 'OBSERVING',
      created_at: timestamp,
      updated_at: timestamp,
    }
    const aggregate: RoleAggregate = {
      state,
      member_ids: [actor.user_id],
      artifacts: [],
      candidates: [],
      calibration_signals: [],
      manager_tasks: [],
    }
    await this.store.createRoleAggregate(aggregate)
    return this.toView(aggregate, actor)
  }

  async updateRoleIdentityDraft(
    roleSessionId: string,
    actor: ActorContext,
    identity: { title?: string; department?: string },
  ): Promise<RoleState> {
    const aggregate = await this.requireAggregate(roleSessionId, actor)
    const title = identity.title?.trim()
    const department = identity.department?.trim()
    if (!title && !department) {
      throw new DomainError('ROLE_IDENTITY_EMPTY', '岗位名称与所属团队不能同时为空', 400)
    }
    const timestamp = nowIso()
    const state: RoleState = {
      ...aggregate.state,
      ...(title ? { title } : {}),
      ...(department ? { department } : {}),
      revision: aggregate.state.revision + 1,
      updated_at: timestamp,
    }
    await this.persistState(state, aggregate.state.revision)
    return this.filterState(state, actor)
  }

  async syncMockContext(
    roleSessionId: string,
    actor: ActorContext,
    expectedRevision: number,
  ): Promise<RoleState> {
    const aggregate = await this.requireAggregate(roleSessionId, actor)
    if (!['MANAGER', 'ADMIN'].includes(actor.role)) throw new DomainError('FORBIDDEN', '仅用人经理或企业管理员可同步岗位背景', 403)
    assertRevision(aggregate.state.revision, expectedRevision)
    if (!['CREATED', 'CONTEXT_SYNCING'].includes(aggregate.state.stage)) {
      throw new DomainError('INVALID_STAGE', '当前阶段不能再次同步背景', 409)
    }
    const timestamp = nowIso()
    const state: RoleState = {
      ...aggregate.state,
      stage: 'REASON_CLARIFYING',
      hc_status: 'APPROVED',
      revision: aggregate.state.revision + 1,
      facts: [
        {
          id: randomUUID(),
          category: 'BACKGROUND',
          statement: `${aggregate.state.department}已完成 HC 审批，岗位目标是补齐关键业务能力`,
          source: 'S-01 Mock HC',
          status: 'DRAFT',
          evidence_refs: ['mock://hc/S-01'],
          visible_to: 'ALL',
          updated_at: timestamp,
        },
        {
          id: randomUUID(),
          category: 'CONSTRAINT',
          statement: '首期仅站内协作，不连接外部发布渠道',
          source: 'S-02 Mock 招聘约束',
          status: 'DRAFT',
          evidence_refs: ['mock://constraint/S-02'],
          visible_to: 'ALL',
          updated_at: timestamp,
        },
      ],
      updated_at: timestamp,
    }
    await this.persistState(state, aggregate.state.revision)
    return this.filterState(state, actor)
  }

  async updatePublicJobBasics(
    roleSessionId: string,
    actor: ActorContext,
    input: PublicJobBasicsUpdate,
  ): Promise<RoleState> {
    const aggregate = await this.requireAggregate(roleSessionId, actor)
    if (!['MANAGER', 'HR', 'ADMIN'].includes(actor.role)) {
      throw new DomainError('FORBIDDEN', '当前角色不能确认对外 JD 基础信息', 403)
    }
    assertRevision(aggregate.state.revision, input.expected_revision)
    const timestamp = nowIso()
    const existing = aggregate.state.public_job_basics ?? {}
    const source = actor.role
    const confirmedField = (value: string) => ({
      value,
      status: 'CONFIRMED' as const,
      visibility: 'PUBLIC' as const,
      source,
      confirmed_at: timestamp,
    })
    const publicJobBasics: PublicJobBasics = {
      location: confirmedField(input.location),
      employment_type: confirmedField(input.employment_type),
    }
    for (const field of [
      'level',
      'work_mode',
      'reporting_line',
      'compensation',
    ] as const) {
      const value = input[field]
      if (typeof value === 'string') publicJobBasics[field] = confirmedField(value)
      else if (value === undefined && existing[field]) publicJobBasics[field] = existing[field]
    }

    const invalidated = aggregate.artifacts.map((artifact) =>
      (artifact.type === 'PUBLIC_JD' || artifact.type === 'HR_RECRUITING_BRIEF')
        && artifact.status !== 'INVALIDATED'
        ? { ...artifact, status: 'INVALIDATED' as const }
        : artifact,
    )
    for (const item of invalidated) {
      const previous = aggregate.artifacts.find((artifact) => artifact.id === item.id)
      if (previous && previous.status !== item.status) await this.store.updateArtifact(item)
    }
    const latest = { ...aggregate.state.latest_artifacts }
    for (const artifact of invalidated.filter((item) => item.status === 'INVALIDATED')) {
      const current = latest[artifact.type]
      if (current?.id === artifact.id) latest[artifact.type] = { ...current, status: 'INVALIDATED' }
    }
    const state: RoleState = {
      ...aggregate.state,
      public_job_basics: publicJobBasics,
      latest_artifacts: latest,
      stage: invalidated.some((item) => item.status === 'INVALIDATED')
        ? 'ASSESSMENT_CONFIRMED'
        : aggregate.state.stage,
      revision: aggregate.state.revision + 1,
      updated_at: timestamp,
    }
    await this.persistState(state, aggregate.state.revision)
    await this.audit(actor, roleSessionId, 'UPDATE_PUBLIC_JOB_BASICS', 'ROLE_SESSION', roleSessionId, {
      fields: Object.keys(publicJobBasics),
      invalidated_artifact_types: invalidated
        .filter((item) => item.status === 'INVALIDATED')
        .map((item) => item.type),
    })
    return this.filterState(state, actor)
  }

  async saveFactDraft(
    roleSessionId: string,
    actor: ActorContext,
    statement: string,
    category: FactCategory,
  ): Promise<RoleState> {
    const aggregate = await this.requireAggregate(roleSessionId, actor)
    if (aggregate.state.hc_status !== 'APPROVED') {
      throw new DomainError('HC_NOT_APPROVED', 'HC 未审批，不能进入岗位澄清', 409)
    }
    const timestamp = nowIso()
    const state: RoleState = {
      ...aggregate.state,
      stage:
        category === 'SUCCESS_CRITERION'
          ? 'SUCCESS_CLARIFYING'
          : aggregate.state.stage === 'CONTEXT_SYNCING'
            ? 'REASON_CLARIFYING'
            : aggregate.state.stage,
      revision: aggregate.state.revision + 1,
      facts: [
        ...aggregate.state.facts,
        {
          id: randomUUID(),
          category,
          statement,
          source: 'Agent 从本轮对话提取，待人工确认',
          status: 'DRAFT',
          evidence_refs: [],
          visible_to: 'ALL',
          updated_at: timestamp,
        },
      ],
      updated_at: timestamp,
    }
    await this.persistState(state, aggregate.state.revision)
    return this.filterState(state, actor)
  }

  async confirmFacts(
    roleSessionId: string,
    actor: ActorContext,
    factIds: string[],
    expectedRevision: number,
  ): Promise<RoleState> {
    const aggregate = await this.requireAggregate(roleSessionId, actor)
    if (!['MANAGER', 'ADMIN'].includes(actor.role)) throw new DomainError('FORBIDDEN', '仅用人经理或企业管理员可确认岗位事实', 403)
    assertRevision(aggregate.state.revision, expectedRevision)
    const ids = new Set(factIds)
    const timestamp = nowIso()
    const state: RoleState = {
      ...aggregate.state,
      revision: aggregate.state.revision + 1,
      facts: aggregate.state.facts.map((fact) =>
        ids.has(fact.id) ? { ...fact, status: 'CONFIRMED' as const, updated_at: timestamp } : fact,
      ),
      updated_at: timestamp,
    }
    await this.persistState(state, aggregate.state.revision)
    return this.filterState(state, actor)
  }

  async saveArtifactDraft<T>(
    roleSessionId: string,
    actor: ActorContext,
    type: ArtifactType,
    content: T,
  ): Promise<ArtifactEnvelope<T>> {
    const aggregate = await this.requireAggregate(roleSessionId, actor)
    assertArtifactAccess(actor, type)
    if (type === 'ROLE_PROFILE') {
      const visibleState = this.filterState(aggregate.state, actor)
      const readiness = evaluateRoleProfileGenerationReadiness(visibleState)
      if (!readiness.allowed) {
        throw new DomainError(readiness.code, readiness.reason, 409)
      }
      const profile = RoleProfileSchema.parse(content)
      assertRoleProfileFactReferences(profile, visibleState)
    }
    if (type === 'ASSESSMENT_SCORECARD') {
      const visibleState = this.filterState(aggregate.state, actor)
      const readiness = evaluateAssessmentGenerationReadiness(visibleState)
      if (!readiness.allowed) {
        throw new DomainError(readiness.code, readiness.reason, 409)
      }
      const scorecard = AssessmentScorecardSchema.parse(content)
      assertAssessmentProfileReferences(scorecard, readiness.profile)
    }
    if (type === 'PUBLIC_JD') {
      const visibleState = this.filterState(aggregate.state, actor)
      const readiness = evaluatePublicJDGenerationReadiness(visibleState)
      if (!readiness.allowed) {
        throw new DomainError(readiness.code, readiness.reason, 409)
      }
      const jd = PublicJDSchema.parse(content)
      assertPublicJDMatchesConfirmedInputs(
        jd,
        visibleState,
        readiness.profile,
        readiness.publicJobBasics,
      )
    }
    if (type === 'HR_RECRUITING_BRIEF') {
      if (!['HR', 'ADMIN'].includes(actor.role)) {
        throw new DomainError('FORBIDDEN', '仅 HR 或企业管理员可以生成内部招聘画像', 403)
      }
      const visibleState = this.filterState(aggregate.state, actor)
      const readiness = evaluateHRBriefGenerationReadiness(visibleState)
      if (!readiness.allowed) {
        throw new DomainError(readiness.code, readiness.reason, 409)
      }
      const brief = HRRecruitingBriefSchema.parse(content)
      assertHRBriefMatchesConfirmedInputs(
        brief,
        readiness.profile,
        readiness.recruitingContext,
      )
    }
    const version =
      Math.max(
        0,
        ...aggregate.artifacts
          .filter((artifact) => artifact.type === type)
          .map((artifact) => artifact.version),
      ) + 1
    const previous = aggregate.artifacts
      .filter((artifact) => artifact.type === type)
      .sort((left, right) => right.version - left.version)[0]
    const artifact = createArtifactEnvelope({
      roleSessionId,
      type,
      version,
      content,
      createdBy: actor.user_id,
      basedOnHash: previous?.content_hash ?? null,
    })

    const invalidated = invalidateDownstreamArtifacts(aggregate.artifacts, type)
    for (const item of invalidated) {
      const previousItem = aggregate.artifacts.find((candidate) => candidate.id === item.id)
      if (previousItem && previousItem.status !== item.status) await this.store.updateArtifact(item)
    }
    await this.store.insertArtifact(artifact)

    const stageByType = {
      ROLE_PROFILE: 'PROFILE_DRAFT',
      ASSESSMENT_SCORECARD: 'ASSESSMENT_DRAFT',
      PUBLIC_JD: 'JD_DRAFT',
      HR_RECRUITING_BRIEF: 'HR_BRIEF_DRAFT',
    } as const
    const latest = {
      ...aggregate.state.latest_artifacts,
      [type]: {
        id: artifact.id,
        version: artifact.version,
        status: artifact.status,
        content_hash: artifact.content_hash,
        content: artifact.content,
      },
    }
    for (const invalidatedArtifact of invalidated.filter((item) => item.status === 'INVALIDATED')) {
      const current = latest[invalidatedArtifact.type]
      if (current?.id === invalidatedArtifact.id) {
        latest[invalidatedArtifact.type] = {
          ...current,
          status: 'INVALIDATED',
        }
      }
    }
    const state: RoleState = {
      ...aggregate.state,
      stage: stageByType[type],
      revision: aggregate.state.revision + 1,
      latest_artifacts: latest,
      updated_at: nowIso(),
    }
    await this.persistState(state, aggregate.state.revision)
    return artifact
  }

  async confirmArtifact(
    roleSessionId: string,
    artifactId: string,
    actor: ActorContext,
    submittedHash: string,
    expectedRevision: number,
  ): Promise<ArtifactEnvelope> {
    const aggregate = await this.requireAggregate(roleSessionId, actor)
    assertRevision(aggregate.state.revision, expectedRevision)
    const artifact = aggregate.artifacts.find((item) => item.id === artifactId)
    if (!artifact) throw new DomainError('ARTIFACT_NOT_FOUND', '产物不存在', 404)
    assertArtifactAccess(actor, artifact.type)
    if (artifact.type === 'HR_RECRUITING_BRIEF' && !['HR', 'ADMIN'].includes(actor.role)) {
      throw new DomainError('FORBIDDEN', '仅 HR 可以确认内部招聘画像', 403)
    }
    if (artifact.type !== 'HR_RECRUITING_BRIEF' && !['MANAGER', 'ADMIN'].includes(actor.role)) {
      throw new DomainError('FORBIDDEN', '该产物需要用人经理确认', 403)
    }
    const confirmed = confirmArtifact(artifact, actor, submittedHash)
    await this.store.updateArtifact(confirmed)
    const confirmedStage = {
      ROLE_PROFILE: 'PROFILE_CONFIRMED',
      ASSESSMENT_SCORECARD: 'ASSESSMENT_CONFIRMED',
      PUBLIC_JD: 'JD_CONFIRMED',
      HR_RECRUITING_BRIEF: 'HR_BRIEF_CONFIRMED',
    } as const
    const state: RoleState = {
      ...aggregate.state,
      stage: confirmedStage[artifact.type],
      revision: aggregate.state.revision + 1,
      latest_artifacts: {
        ...aggregate.state.latest_artifacts,
        [artifact.type]: {
          id: confirmed.id,
          version: confirmed.version,
          status: confirmed.status,
          content_hash: confirmed.content_hash,
          content: confirmed.content,
        },
      },
      updated_at: nowIso(),
    }
    await this.persistState(state, aggregate.state.revision)
    await this.audit(actor, roleSessionId, 'CONFIRM_ARTIFACT', artifact.type, artifact.id, {
      content_hash: submittedHash,
      version: artifact.version,
    })
    return confirmed
  }

  async preparePublish(
    roleSessionId: string,
    actor: ActorContext,
    expectedRevision: number,
  ): Promise<RoleState> {
    const aggregate = await this.requireAggregate(roleSessionId, actor)
    if (!['HR', 'ADMIN'].includes(actor.role)) throw new DomainError('FORBIDDEN', '仅 HR 或企业管理员可以执行发布准备', 403)
    assertRevision(aggregate.state.revision, expectedRevision)
    const required: ArtifactType[] = ['ROLE_PROFILE', 'ASSESSMENT_SCORECARD', 'PUBLIC_JD']
    const missing = required.filter(
      (type) => aggregate.state.latest_artifacts[type]?.status !== 'CONFIRMED',
    )
    if (missing.length > 0) {
      throw new DomainError('ARTIFACTS_NOT_CONFIRMED', `以下产物尚未确认：${missing.join(', ')}`, 409)
    }
    const state: RoleState = {
      ...aggregate.state,
      stage: 'READY_TO_PUBLISH',
      revision: aggregate.state.revision + 1,
      updated_at: nowIso(),
    }
    await this.persistState(state, aggregate.state.revision)
    await this.audit(actor, roleSessionId, 'PREPARE_PUBLISH', 'ROLE_SESSION', roleSessionId, {})
    return this.filterState(state, actor)
  }

  async importCandidateEvidence(
    roleSessionId: string,
    actor: ActorContext,
    candidates: CandidateEvidence[],
    sources?: CandidateEvidenceSource[],
    failedCandidates: CandidateEvidenceFailure[] = [],
    summary?: string,
  ): Promise<{ state: RoleState; evaluation: ReturnType<typeof evaluateCalibrationBoundary> }> {
    if (!['HR', 'ADMIN'].includes(actor.role)) throw new DomainError('FORBIDDEN', '仅 HR 或企业管理员可以导入候选人证据', 403)
    const aggregate = await this.requireAggregate(roleSessionId, actor)
    for (const candidate of candidates) CandidateEvidenceSchema.parse(candidate)
    if (sources) {
      const readiness = evaluateCandidateEvidenceExtractionReadiness(aggregate.state)
      if (!readiness.allowed) {
        throw new DomainError(readiness.code, readiness.reason, 409)
      }
      assertCandidateEvidenceMatchesSources(
        candidates,
        failedCandidates,
        sources,
        readiness.profile,
        readiness.assessment,
      )
      if (summary !== undefined) assertCandidateEvidenceSummarySafe(summary)
    }
    if (candidates.length > 0) {
      await this.store.insertCandidates(roleSessionId, candidates, actor.user_id)
    }
    const byRef = new Map(aggregate.candidates.map((item) => [item.candidate_ref, item]))
    for (const candidate of candidates) byRef.set(candidate.candidate_ref, candidate)
    const allCandidates = [...byRef.values()]
    const evaluation = evaluateCalibrationBoundary(allCandidates)
    let signal: CalibrationSignalRecord | undefined
    if (
      evaluation.eligible &&
      !aggregate.calibration_signals.some((item) =>
        ['HR_REVIEW', 'MANAGER_REVIEW'].includes(item.status),
      )
    ) {
      const timestamp = nowIso()
      const createdSignal: CalibrationSignalRecord = {
        id: randomUUID(),
        role_session_id: roleSessionId,
        status: 'HR_REVIEW',
        proposed_change: {
          action: 'REVIEW_ROLE_PROFILE',
          focus: evaluation.repeated_bottlenecks[0]?.label ?? '候选人同类卡点',
        },
        evidence_summary: { ...evaluation },
        reviewed_by: null,
        review_reason: null,
        created_at: timestamp,
        updated_at: timestamp,
      }
      signal = createdSignal
      await this.store.insertCalibrationSignal(createdSignal)
    }
    const state: RoleState = {
      ...aggregate.state,
      stage: evaluation.eligible ? 'CALIBRATION_HR_REVIEW' : 'CALIBRATION_OBSERVING',
      revision: aggregate.state.revision + 1,
      candidate_count: allCandidates.length,
      candidate_channels: [...new Set(allCandidates.map((item) => item.channel))],
      calibration_status: evaluation.status,
      updated_at: nowIso(),
    }
    await this.persistState(state, aggregate.state.revision)
    await this.audit(actor, roleSessionId, 'IMPORT_CANDIDATE_EVIDENCE', 'ROLE_SESSION', roleSessionId, {
      imported_count: candidates.length,
      failed_count: failedCandidates.length,
      calibration_eligible: evaluation.eligible,
      signal_id: signal?.id,
    })
    return { state, evaluation }
  }

  async reviewCalibrationSignal(
    roleSessionId: string,
    signalId: string,
    actor: ActorContext,
    decision: 'APPROVE' | 'REJECT',
    reason: string,
    expectedRevision: number,
  ): Promise<{ signal: CalibrationSignalRecord; task: ManagerTaskRecord | null }> {
    if (!['HR', 'ADMIN'].includes(actor.role)) throw new DomainError('FORBIDDEN', '仅 HR 或企业管理员可以审核校准信号', 403)
    const aggregate = await this.requireAggregate(roleSessionId, actor)
    assertRevision(aggregate.state.revision, expectedRevision)
    const current = aggregate.calibration_signals.find((item) => item.id === signalId)
    if (!current || current.status !== 'HR_REVIEW') {
      throw new DomainError('CALIBRATION_SIGNAL_NOT_REVIEWABLE', '校准信号不存在或已处理', 409)
    }
    let managerAssigneeId: string | null = null
    if (decision === 'APPROVE') {
      const members = await Promise.all(
        aggregate.member_ids.map((memberId) => this.store.getUser(memberId)),
      )
      managerAssigneeId = members.find((member) => member?.role === 'MANAGER')?.user_id ?? null
      if (!managerAssigneeId) {
        throw new DomainError(
          'MANAGER_MEMBER_REQUIRED',
          '岗位尚未加入用人经理，不能创建经理校准任务',
          409,
        )
      }
    }
    const timestamp = nowIso()
    const signal: CalibrationSignalRecord = {
      ...current,
      status: decision === 'APPROVE' ? 'MANAGER_REVIEW' : 'DISMISSED',
      reviewed_by: actor.user_id,
      review_reason: reason,
      updated_at: timestamp,
    }
    await this.store.updateCalibrationSignal(signal)
    let task: ManagerTaskRecord | null = null
    if (decision === 'APPROVE') {
      task = {
        id: randomUUID(),
        role_session_id: roleSessionId,
        signal_id: signalId,
        assignee_user_id: managerAssigneeId!,
        status: 'OPEN',
        decision_reason: null,
        due_at: new Date(Date.now() + 3 * 24 * 60 * 60 * 1_000).toISOString(),
        created_at: timestamp,
        completed_at: null,
      }
      await this.store.insertManagerTask(task)
    }
    const state: RoleState = {
      ...aggregate.state,
      stage: decision === 'APPROVE' ? 'CALIBRATION_MANAGER_REVIEW' : 'CALIBRATION_OBSERVING',
      revision: aggregate.state.revision + 1,
      calibration_status: decision === 'APPROVE' ? 'MANAGER_REVIEW' : 'DISMISSED',
      updated_at: timestamp,
    }
    await this.persistState(state, aggregate.state.revision)
    await this.audit(actor, roleSessionId, 'REVIEW_CALIBRATION', 'CALIBRATION_SIGNAL', signalId, {
      decision,
      reason,
      task_id: task?.id,
    })
    return { signal, task }
  }

  async proposeCalibrationSignal(
    roleSessionId: string,
    actor: ActorContext,
    proposedChange: Record<string, unknown>,
    evidenceSummary: Record<string, unknown>,
  ): Promise<CalibrationSignalRecord> {
    if (!['HR', 'ADMIN'].includes(actor.role)) {
      throw new DomainError('FORBIDDEN', '仅 HR 运行上下文可以保存校准信号草稿', 403)
    }
    const aggregate = await this.requireAggregate(roleSessionId, actor)
    if (aggregate.calibration_signals.some((signal) =>
      ['HR_REVIEW', 'MANAGER_REVIEW'].includes(signal.status))) {
      throw new DomainError(
        'CALIBRATION_SIGNAL_ALREADY_PENDING',
        '当前已有待审核的校准信号',
        409,
      )
    }
    const evaluation = evaluateCalibrationBoundary(aggregate.candidates)
    if (!evaluation.eligible) {
      throw new DomainError(
        'CALIBRATION_BOUNDARY_NOT_MET',
        `校准仍在观察期：${evaluation.missing_conditions.join('；')}`,
        409,
      )
    }
    const timestamp = nowIso()
    const signal: CalibrationSignalRecord = {
      id: randomUUID(),
      role_session_id: roleSessionId,
      status: 'HR_REVIEW',
      proposed_change: proposedChange,
      evidence_summary: { ...evidenceSummary, boundary: evaluation },
      reviewed_by: null,
      review_reason: null,
      created_at: timestamp,
      updated_at: timestamp,
    }
    await this.store.insertCalibrationSignal(signal)
    return signal
  }

  async saveCalibrationAdvice(
    roleSessionId: string,
    actor: ActorContext,
    advice: CalibrationAdvice,
  ): Promise<{
    evaluation: ReturnType<typeof evaluateCalibrationBoundary>
    signal: CalibrationSignalRecord | null
  }> {
    if (!['HR', 'ADMIN'].includes(actor.role)) {
      throw new DomainError('FORBIDDEN', '仅 HR 或企业管理员可以保存岗位画像校准建议', 403)
    }
    const aggregate = await this.requireAggregate(roleSessionId, actor)
    if (aggregate.calibration_signals.some((signal) => signal.status === 'MANAGER_REVIEW')) {
      throw new DomainError(
        'CALIBRATION_MANAGER_REVIEW_PENDING',
        '当前校准信号已经进入经理审核，不能重新生成招聘执行建议。',
        409,
      )
    }
    const readiness = evaluateCandidateEvidenceExtractionReadiness(aggregate.state)
    if (!readiness.allowed) {
      throw new DomainError(readiness.code, readiness.reason, 409)
    }
    const projection = projectRoleStateForTask(
      this.filterState(aggregate.state, actor),
      'CALIBRATION_ADVICE',
      aggregate.candidates,
    )
    const candidateSummary = projection.task_context.candidate_summary
    const calibrationPolicy = projection.task_context.calibration_policy
    const evaluation = projection.task_context.calibration_evaluation
    if (!candidateSummary || !calibrationPolicy || !evaluation) {
      throw new DomainError(
        'CALIBRATION_CONTEXT_UNAVAILABLE',
        '当前校准聚合上下文不可用，请稍后重试。',
        500,
      )
    }
    assertCalibrationAdviceMatchesContext(
      advice,
      {
        calibration_policy: calibrationPolicy,
        candidate_summary: candidateSummary,
        calibration_evaluation: evaluation,
      },
      readiness.profile,
    )

    let signal: CalibrationSignalRecord | null = null
    if (evaluation.eligible) {
      const timestamp = nowIso()
      const existing = aggregate.calibration_signals.find((item) => item.status === 'HR_REVIEW')
      signal = {
        id: existing?.id ?? randomUUID(),
        role_session_id: roleSessionId,
        status: 'HR_REVIEW',
        proposed_change: {
          signal_type: advice.signal_type,
          disposition: advice.disposition,
          focus: advice.focus,
          recommendation: advice.recommendation,
          next_check: advice.next_check,
          confidence_note: advice.confidence_note,
          requires_hr_review: advice.requires_hr_review,
          manager_task_created: advice.manager_task_created,
          formal_profile_changed: advice.formal_profile_changed,
        },
        evidence_summary: {
          trigger_evaluation: advice.trigger_evaluation,
          evidence_summary: advice.evidence_summary,
          exclusion_checks: advice.exclusion_checks,
        },
        reviewed_by: null,
        review_reason: null,
        created_at: existing?.created_at ?? timestamp,
        updated_at: timestamp,
      }
      if (existing) await this.store.updateCalibrationSignal(signal)
      else await this.store.insertCalibrationSignal(signal)

      if (
        aggregate.state.stage !== 'CALIBRATION_HR_REVIEW'
        || aggregate.state.calibration_status !== 'HR_REVIEW'
      ) {
        const state: RoleState = {
          ...aggregate.state,
          stage: 'CALIBRATION_HR_REVIEW',
          revision: aggregate.state.revision + 1,
          calibration_status: 'HR_REVIEW',
          updated_at: timestamp,
        }
        await this.persistState(state, aggregate.state.revision)
      }
    }
    await this.audit(actor, roleSessionId, 'SAVE_CALIBRATION_ADVICE', 'ROLE_SESSION', roleSessionId, {
      disposition: advice.disposition,
      action: advice.recommendation.action,
      candidate_count: evaluation.candidate_count,
      channel_count: evaluation.channel_count,
      signal_id: signal?.id,
    })
    return { evaluation, signal }
  }

  async calibrationAdviceReadiness(
    roleSessionId: string,
    actor: ActorContext,
  ): Promise<{ allowed: boolean; reason: string | null }> {
    if (!['HR', 'ADMIN'].includes(actor.role)) {
      return { allowed: false, reason: '只有 HR 或企业管理员可以发起画像校准建议。' }
    }
    const aggregate = await this.requireAggregate(roleSessionId, actor)
    if (aggregate.calibration_signals.some((signal) => signal.status === 'MANAGER_REVIEW')) {
      return { allowed: false, reason: '当前校准信号已经进入经理审核，请先完成现有经理决策。' }
    }
    const readiness = evaluateCandidateEvidenceExtractionReadiness(aggregate.state)
    if (!readiness.allowed) return { allowed: false, reason: readiness.reason }
    return { allowed: true, reason: null }
  }

  async readVersionDiff(
    roleSessionId: string,
    actor: ActorContext,
    type: ArtifactType,
    fromVersion: number,
    toVersion: number,
  ): Promise<{
    artifact_type: ArtifactType
    from_version: number
    to_version: number
    changes: Array<{ path: string; before: unknown; after: unknown }>
  }> {
    assertArtifactAccess(actor, type)
    const aggregate = await this.requireAggregate(roleSessionId, actor)
    const from = aggregate.artifacts.find(
      (artifact) => artifact.type === type && artifact.version === fromVersion,
    )
    const to = aggregate.artifacts.find(
      (artifact) => artifact.type === type && artifact.version === toVersion,
    )
    if (!from || !to) throw new DomainError('ARTIFACT_VERSION_NOT_FOUND', '产物版本不存在', 404)
    const changes: Array<{ path: string; before: unknown; after: unknown }> = []
    const walk = (before: unknown, after: unknown, path: string): void => {
      if (Object.is(before, after)) return
      if (
        before &&
        after &&
        typeof before === 'object' &&
        typeof after === 'object' &&
        !Array.isArray(before) &&
        !Array.isArray(after)
      ) {
        const keys = new Set([
          ...Object.keys(before as Record<string, unknown>),
          ...Object.keys(after as Record<string, unknown>),
        ])
        for (const key of [...keys].sort()) {
          walk(
            (before as Record<string, unknown>)[key],
            (after as Record<string, unknown>)[key],
            path ? `${path}.${key}` : key,
          )
        }
        return
      }
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        changes.push({ path: path || '$', before, after })
      }
    }
    walk(from.content, to.content, '')
    return {
      artifact_type: type,
      from_version: fromVersion,
      to_version: toVersion,
      changes,
    }
  }

  async decideManagerTask(
    roleSessionId: string,
    taskId: string,
    actor: ActorContext,
    decision: 'APPROVE' | 'REJECT',
    reason: string,
    expectedRevision: number,
  ): Promise<ManagerTaskRecord> {
    if (!['MANAGER', 'ADMIN'].includes(actor.role)) throw new DomainError('FORBIDDEN', '仅用人经理或企业管理员可以处理校准任务', 403)
    const aggregate = await this.requireAggregate(roleSessionId, actor)
    assertRevision(aggregate.state.revision, expectedRevision)
    const current = aggregate.manager_tasks.find(
      (item) => item.id === taskId && item.assignee_user_id === actor.user_id,
    )
    if (!current || current.status !== 'OPEN') {
      throw new DomainError('MANAGER_TASK_NOT_OPEN', '校准任务不存在或已处理', 409)
    }
    const timestamp = nowIso()
    const task: ManagerTaskRecord = {
      ...current,
      status: decision === 'APPROVE' ? 'ACCEPTED' : 'REJECTED',
      decision_reason: reason,
      completed_at: timestamp,
    }
    await this.store.updateManagerTask(task)
    const signal = aggregate.calibration_signals.find((item) => item.id === task.signal_id)
    if (signal) {
      await this.store.updateCalibrationSignal({
        ...signal,
        status: decision === 'APPROVE' ? 'ACCEPTED' : 'REJECTED',
        updated_at: timestamp,
      })
    }
    const state: RoleState = {
      ...aggregate.state,
      stage: decision === 'APPROVE' ? 'PROFILE_DRAFT' : 'RECRUITING',
      revision: aggregate.state.revision + 1,
      calibration_status: decision === 'APPROVE' ? 'ACCEPTED' : 'REJECTED',
      updated_at: timestamp,
    }
    await this.persistState(state, aggregate.state.revision)
    await this.audit(actor, roleSessionId, 'DECIDE_CALIBRATION', 'MANAGER_TASK', taskId, {
      decision,
      reason,
    })
    return task
  }

  rejectCandidatePII(content: unknown): void {
    const pii = detectPII(content)
    if (pii.length > 0) {
      throw new DomainError(
        'CANDIDATE_PII_DETECTED',
        `候选人资料包含疑似个人信息（${pii.join(', ')}），请脱敏后重试`,
        422,
      )
    }
  }

  private async requireAggregate(
    roleSessionId: string,
    actor: ActorContext,
    options?: RoleAggregateReadOptions,
  ): Promise<RoleAggregate> {
    const aggregate = await this.store.getRoleAggregate(roleSessionId, actor, options)
    if (!aggregate) throw new DomainError('ROLE_SESSION_NOT_FOUND', '岗位会话不存在', 404)
    return aggregate
  }

  private async persistState(state: RoleState, expectedRevision: number): Promise<void> {
    const saved = await this.store.saveRoleState(state, expectedRevision)
    if (!saved) {
      throw new DomainError('REVISION_CONFLICT', '岗位数据已被其他操作更新，请刷新后重试', 409)
    }
  }

  private filterState(state: RoleState, actor: ActorContext): RoleState {
    if (actor.role === 'HR' || actor.role === 'ADMIN') return structuredClone(state)
    const filtered = structuredClone(state)
    const latest = { ...filtered.latest_artifacts }
    delete latest.HR_RECRUITING_BRIEF
    delete filtered.hr_recruiting_context
    return {
      ...filtered,
      facts: filtered.facts.filter((fact) => fact.visible_to !== 'HR_ONLY'),
      latest_artifacts: latest,
    }
  }

  private toView(aggregate: RoleAggregate, actor: ActorContext): RoleView {
    const artifacts = aggregate.artifacts.filter(
      (artifact) => ARTIFACT_VISIBILITY[artifact.type] !== 'HR_ONLY' || actor.role === 'HR' || actor.role === 'ADMIN',
    )
    if (actor.role === 'HR' || actor.role === 'ADMIN') {
      return {
        state: this.filterState(aggregate.state, actor),
        artifacts,
        candidates: aggregate.candidates,
        calibration_signals: aggregate.calibration_signals,
        manager_tasks: aggregate.manager_tasks,
      }
    }
    return {
      state: this.filterState(aggregate.state, actor),
      artifacts,
      manager_tasks: aggregate.manager_tasks.filter(
        (task) => task.assignee_user_id === actor.user_id,
      ),
    }
  }

  private async audit(
    actor: ActorContext,
    roleSessionId: string,
    action: string,
    targetType: string,
    targetId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    const record: DecisionRecord = {
      id: randomUUID(),
      role_session_id: roleSessionId,
      actor_user_id: actor.user_id,
      action,
      target_type: targetType,
      target_id: targetId,
      metadata,
      created_at: nowIso(),
    }
    await this.store.appendDecision(record)
  }
}
