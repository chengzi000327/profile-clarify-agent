import { createHash, randomUUID } from 'node:crypto'
import {
  ARTIFACT_VISIBILITY,
  CALIBRATION_BOUNDARY,
  type ActorContext,
  type ArtifactEnvelope,
  type ArtifactStatus,
  type ArtifactType,
  type CandidateEvidence,
  type PublicJD,
  type RoleSessionStage,
  type RoleState,
} from '@role-clarifier/contracts'

export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400,
  ) {
    super(message)
    this.name = 'DomainError'
  }
}

export const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export const contentHash = (value: unknown): string =>
  createHash('sha256').update(canonicalJson(value)).digest('hex')

const allowedStageTransitions: Record<RoleSessionStage, readonly RoleSessionStage[]> = {
  CREATED: ['CONTEXT_SYNCING', 'ARCHIVED'],
  CONTEXT_SYNCING: ['REASON_CLARIFYING', 'ARCHIVED'],
  REASON_CLARIFYING: ['SUCCESS_CLARIFYING', 'PROFILE_DRAFT', 'ARCHIVED'],
  SUCCESS_CLARIFYING: ['PROFILE_DRAFT', 'ARCHIVED'],
  PROFILE_DRAFT: ['PROFILE_CONFIRMED', 'ARCHIVED'],
  PROFILE_CONFIRMED: ['ASSESSMENT_DRAFT', 'PROFILE_DRAFT', 'ARCHIVED'],
  ASSESSMENT_DRAFT: ['ASSESSMENT_CONFIRMED', 'PROFILE_DRAFT', 'ARCHIVED'],
  ASSESSMENT_CONFIRMED: ['JD_DRAFT', 'ASSESSMENT_DRAFT', 'ARCHIVED'],
  JD_DRAFT: ['JD_CONFIRMED', 'ASSESSMENT_DRAFT', 'ARCHIVED'],
  JD_CONFIRMED: ['HR_BRIEF_DRAFT', 'JD_DRAFT', 'READY_TO_PUBLISH', 'ARCHIVED'],
  HR_BRIEF_DRAFT: ['HR_BRIEF_CONFIRMED', 'JD_DRAFT', 'ARCHIVED'],
  HR_BRIEF_CONFIRMED: ['RECRUITING', 'JD_DRAFT', 'READY_TO_PUBLISH', 'ARCHIVED'],
  RECRUITING: ['CALIBRATION_OBSERVING', 'CALIBRATION_HR_REVIEW', 'ARCHIVED'],
  CALIBRATION_OBSERVING: ['CALIBRATION_HR_REVIEW', 'RECRUITING', 'ARCHIVED'],
  CALIBRATION_HR_REVIEW: ['CALIBRATION_OBSERVING', 'CALIBRATION_MANAGER_REVIEW', 'ARCHIVED'],
  CALIBRATION_MANAGER_REVIEW: ['RECRUITING', 'PROFILE_DRAFT', 'ARCHIVED'],
  READY_TO_PUBLISH: ['JD_DRAFT', 'RECRUITING', 'ARCHIVED'],
  ARCHIVED: [],
}

export const assertStageTransition = (from: RoleSessionStage, to: RoleSessionStage): void => {
  if (!allowedStageTransitions[from].includes(to)) {
    throw new DomainError('INVALID_STAGE_TRANSITION', `不能从 ${from} 进入 ${to}`, 409)
  }
}

export const assertRevision = (actual: number, expected: number): void => {
  if (actual !== expected) {
    throw new DomainError(
      'REVISION_CONFLICT',
      `岗位数据已更新（当前版本 ${actual}，请求版本 ${expected}）`,
      409,
    )
  }
}

export const assertRoleAccess = (actor: ActorContext, state: RoleState): void => {
  if (actor.tenant_id !== state.tenant_id) {
    throw new DomainError('ROLE_SESSION_NOT_FOUND', '岗位会话不存在', 404)
  }
}

export const assertArtifactAccess = (actor: ActorContext, type: ArtifactType): void => {
  if (ARTIFACT_VISIBILITY[type] === 'HR_ONLY' && !['HR', 'ADMIN'].includes(actor.role)) {
    throw new DomainError('ROLE_SESSION_NOT_FOUND', '产物不存在', 404)
  }
}

export const createArtifactEnvelope = <T>(input: {
  roleSessionId: string
  type: ArtifactType
  version: number
  content: T
  createdBy: string
  basedOnHash?: string | null
  status?: ArtifactStatus
}): ArtifactEnvelope<T> => ({
  id: randomUUID(),
  role_session_id: input.roleSessionId,
  type: input.type,
  version: input.version,
  status: input.status ?? 'DRAFT',
  content: input.content,
  content_hash: contentHash(input.content),
  based_on_hash: input.basedOnHash ?? null,
  created_by: input.createdBy,
  created_at: new Date().toISOString(),
  confirmed_by: null,
  confirmed_at: null,
})

export const confirmArtifact = <T>(
  artifact: ArtifactEnvelope<T>,
  actor: ActorContext,
  submittedHash: string,
): ArtifactEnvelope<T> => {
  if (artifact.content_hash !== submittedHash) {
    throw new DomainError('CONTENT_HASH_MISMATCH', '产物已发生变化，请查看最新版本后再确认', 409)
  }
  if (artifact.status !== 'DRAFT') {
    throw new DomainError('ARTIFACT_NOT_CONFIRMABLE', '仅草稿可以确认', 409)
  }
  const now = new Date().toISOString()
  return { ...artifact, status: 'CONFIRMED', confirmed_by: actor.user_id, confirmed_at: now }
}

export const invalidateDownstreamArtifacts = (
  artifacts: readonly ArtifactEnvelope[],
  changedType: ArtifactType,
): ArtifactEnvelope[] => {
  const order: ArtifactType[] = [
    'ROLE_PROFILE',
    'ASSESSMENT_SCORECARD',
    'PUBLIC_JD',
    'HR_RECRUITING_BRIEF',
  ]
  const changedIndex = order.indexOf(changedType)
  return artifacts.map((artifact) =>
    order.indexOf(artifact.type) > changedIndex && artifact.status === 'CONFIRMED'
      ? { ...artifact, status: 'INVALIDATED' as const }
      : artifact,
  )
}

const phonePattern = /(?<!\d)(?:\+?86[- ]?)?1[3-9]\d{9}(?!\d)/
const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i
const explicitNamePattern = /(?:姓名|name)\s*[:：]\s*[\p{L}·]{2,30}/iu

export const detectPII = (value: unknown): string[] => {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  const findings: string[] = []
  if (phonePattern.test(text)) findings.push('PHONE')
  if (emailPattern.test(text)) findings.push('EMAIL')
  if (explicitNamePattern.test(text)) findings.push('NAME')
  return findings
}

export interface CalibrationEvaluation {
  status: 'OBSERVING' | 'HR_REVIEW'
  eligible: boolean
  candidate_count: number
  channel_count: number
  repeated_bottlenecks: Array<{ label: string; count: number }>
  missing_conditions: string[]
}

export const evaluateCalibrationBoundary = (
  candidates: readonly CandidateEvidence[],
): CalibrationEvaluation => {
  const channels = new Set(candidates.map((candidate) => candidate.channel))
  const bottleneckCounts = new Map<string, number>()
  for (const candidate of candidates) {
    for (const label of new Set(candidate.bottlenecks)) {
      bottleneckCounts.set(label, (bottleneckCounts.get(label) ?? 0) + 1)
    }
  }
  const repeated = [...bottleneckCounts.entries()]
    .filter(([, count]) => count >= CALIBRATION_BOUNDARY.repeatedBottleneckCount)
    .map(([label, count]) => ({ label, count }))
    .sort((left, right) => right.count - left.count)
  const missing: string[] = []
  if (candidates.length < CALIBRATION_BOUNDARY.minimumCandidates) {
    missing.push(`还需 ${CALIBRATION_BOUNDARY.minimumCandidates - candidates.length} 名有效候选人`)
  }
  if (channels.size < CALIBRATION_BOUNDARY.minimumChannels) {
    missing.push(`还需覆盖 ${CALIBRATION_BOUNDARY.minimumChannels - channels.size} 个渠道`)
  }
  if (repeated.length === 0) missing.push('尚未出现 2 次同类卡点')
  const eligible = missing.length === 0
  return {
    status: eligible ? 'HR_REVIEW' : 'OBSERVING',
    eligible,
    candidate_count: candidates.length,
    channel_count: channels.size,
    repeated_bottlenecks: repeated,
    missing_conditions: missing,
  }
}

export const makeDefaultJD = (title: string, department: string): PublicJD => ({
  title_and_basics: {
    title,
    location: '上海 / 可协商',
    employment_type: '全职',
    reporting_line: `${department}负责人`,
  },
  about_the_role: `你将加入${department}，围绕关键业务目标定义问题、推动方案落地，并对可验证的业务结果负责。`,
  what_you_will_do: [
    '与业务、产品和交付团队澄清目标，将复杂问题拆成可执行的路线图',
    '建立结果指标与复盘机制，持续推动跨团队协作和交付质量',
    '基于用户与业务反馈迭代方案，对关键取舍给出清晰判断',
  ],
  what_we_look_for: [
    '具备复杂问题抽象、结构化分析和端到端推动能力',
    '能用事实与结果沟通，并在信息不完整时做出高质量判断',
    '认同协作透明、责任清晰、持续复盘的工作方式',
  ],
})
