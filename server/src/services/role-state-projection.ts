import type {
  ArtifactType,
  CalibrationBoundaryEvaluation,
  CalibrationCandidateSummary,
  CandidateEvidence,
  Conflict,
  Fact,
  RoleState,
} from '@role-clarifier/contracts'
import { evaluateCalibrationBoundary } from '@role-clarifier/domain'
import type { HarnessTask } from '../agent/harness-adapter.js'

const artifactTypes: ArtifactType[] = [
  'ROLE_PROFILE',
  'ASSESSMENT_SCORECARD',
  'PUBLIC_JD',
  'HR_RECRUITING_BRIEF',
]

const artifactDependencies: Record<HarnessTask, ArtifactType[]> = {
  CLARIFY_MESSAGE: [],
  GENERATE_ROLE_PROFILE: [],
  GENERATE_ASSESSMENT: ['ROLE_PROFILE'],
  GENERATE_JD: ['ROLE_PROFILE', 'ASSESSMENT_SCORECARD'],
  GENERATE_HR_BRIEF: ['ROLE_PROFILE', 'ASSESSMENT_SCORECARD', 'PUBLIC_JD'],
  EXTRACT_CANDIDATES: ['ROLE_PROFILE', 'ASSESSMENT_SCORECARD'],
  CALIBRATION_ADVICE: ['ROLE_PROFILE', 'ASSESSMENT_SCORECARD'],
  VERSION_COMPARISON: [],
}

const projectionByTask: Record<HarnessTask, string> = {
  CLARIFY_MESSAGE: 'CLARIFICATION',
  GENERATE_ROLE_PROFILE: 'ROLE_PROFILE',
  GENERATE_ASSESSMENT: 'ASSESSMENT',
  GENERATE_JD: 'JD',
  GENERATE_HR_BRIEF: 'HR_BRIEF',
  EXTRACT_CANDIDATES: 'CANDIDATE',
  CALIBRATION_ADVICE: 'CALIBRATION',
  VERSION_COMPARISON: 'VERSION_DIFF',
}

const harnessTasks = new Set<string>(Object.keys(artifactDependencies))

export const isHarnessTask = (task: string): task is HarnessTask => harnessTasks.has(task)

export interface ProjectedFact {
  category: Fact['category']
  statement: string
  source: string
  status: Fact['status']
  evidence_refs: string[]
}

export interface ProjectedConflict {
  field: string
  left_value: string
  right_value: string
  source_refs: string[]
  status: Conflict['status']
  resolution?: string
}

export interface ArtifactReference {
  type: ArtifactType
  id: string
  version: number
  status: 'DRAFT' | 'CONFIRMED' | 'INVALIDATED'
  content_hash: string
}

export type CandidateEvidenceSummary = CalibrationCandidateSummary

export interface RoleStateProjection {
  projection: string
  state_revision: number
  role: {
    id: string
    title: string
    department: string
    stage: RoleState['stage']
    hc_status: RoleState['hc_status']
  }
  facts: ProjectedFact[]
  conflicts: ProjectedConflict[]
  artifact_refs: ArtifactReference[]
  task_context: {
    task: string
    artifacts: Array<{
      type: ArtifactType
      version: number
      status: 'CONFIRMED'
      content: unknown
    }>
    candidate_summary?: CandidateEvidenceSummary
    calibration_policy?: {
      minimum_candidates: 10
      minimum_channels: 2
      repeated_signal_count: 2
    }
    calibration_evaluation?: CalibrationBoundaryEvaluation
  }
}

const projectFact = (fact: Fact): ProjectedFact => ({
  category: fact.category,
  statement: fact.statement,
  source: fact.source,
  status: fact.status,
  evidence_refs: fact.evidence_refs,
})

const projectConflict = (conflict: Conflict): ProjectedConflict => ({
  field: conflict.field,
  left_value: conflict.left_value,
  right_value: conflict.right_value,
  source_refs: conflict.source_refs,
  status: conflict.status,
  ...(conflict.resolution === undefined ? {} : { resolution: conflict.resolution }),
})

const selectFacts = (state: RoleState, task: string): ProjectedFact[] => {
  if (task === 'CLARIFY_MESSAGE') return state.facts.map(projectFact)
  if (task === 'EXTRACT_CANDIDATES' || task === 'CALIBRATION_ADVICE') return []

  const confirmed = state.facts.filter((fact) => fact.status === 'CONFIRMED')
  if (task === 'GENERATE_ASSESSMENT') {
    return confirmed
      .filter((fact) => ['SUCCESS_CRITERION', 'CONSTRAINT'].includes(fact.category))
      .map(projectFact)
  }
  if (task === 'GENERATE_HR_BRIEF') {
    return confirmed
      .filter((fact) => ['BACKGROUND', 'HIRING_REASON', 'CONSTRAINT'].includes(fact.category))
      .map(projectFact)
  }
  return confirmed.map(projectFact)
}

const summarizeCandidates = (candidates: CandidateEvidence[]): CandidateEvidenceSummary => {
  const channelCounts = new Map<string, number>()
  const criterionCounts = new Map<
    string,
    {
      requirement_ref: string
      criterion: string
      evidence_count: number
      signals: Record<'STRONG' | 'MIXED' | 'WEAK' | 'MISSING', number>
      evidence_statuses: Record<
        'SUPPORTED' | 'POSSIBLE_SUPPORT' | 'NOT_MENTIONED' | 'MISMATCH' | 'INTERVIEW_NEEDED',
        number
      >
    }
  >()
  const bottleneckCounts = new Map<string, number>()

  for (const candidate of candidates) {
    channelCounts.set(candidate.channel, (channelCounts.get(candidate.channel) ?? 0) + 1)
    for (const evidence of candidate.evidence) {
      const criterionKey = `${evidence.requirement_ref}\u0000${evidence.criterion}`
      const current = criterionCounts.get(criterionKey) ?? {
        requirement_ref: evidence.requirement_ref,
        criterion: evidence.criterion,
        evidence_count: 0,
        signals: { STRONG: 0, MIXED: 0, WEAK: 0, MISSING: 0 },
        evidence_statuses: {
          SUPPORTED: 0,
          POSSIBLE_SUPPORT: 0,
          NOT_MENTIONED: 0,
          MISMATCH: 0,
          INTERVIEW_NEEDED: 0,
        },
      }
      current.evidence_count += 1
      current.signals[evidence.signal] += 1
      const evidenceStatus = evidence.evidence_status ?? ({
        STRONG: 'SUPPORTED',
        MIXED: 'INTERVIEW_NEEDED',
        WEAK: 'MISMATCH',
        MISSING: 'NOT_MENTIONED',
      } as const)[evidence.signal]
      current.evidence_statuses[evidenceStatus] += 1
      criterionCounts.set(criterionKey, current)
    }
    for (const bottleneck of candidate.bottlenecks) {
      bottleneckCounts.set(bottleneck, (bottleneckCounts.get(bottleneck) ?? 0) + 1)
    }
  }

  const channels = [...channelCounts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
  const criteria = [...criterionCounts.entries()]
    .sort((left, right) =>
      right[1].evidence_count - left[1].evidence_count
      || left[1].requirement_ref.localeCompare(right[1].requirement_ref))
  const bottlenecks = [...bottleneckCounts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))

  return {
    total_candidates: candidates.length,
    channels: channels.slice(0, 20).map(([channel]) => channel),
    omitted_channel_count: Math.max(0, channels.length - 20),
    criteria: criteria.slice(0, 20).map(([, summary]) => summary),
    omitted_criterion_count: Math.max(0, criteria.length - 20),
    top_bottlenecks: bottlenecks.slice(0, 20).map(([label, count]) => ({ label, count })),
    omitted_bottleneck_count: Math.max(0, bottlenecks.length - 20),
  }
}

export const projectRoleStateForTask = (
  state: RoleState,
  task: string,
  candidates: CandidateEvidence[] = [],
): RoleStateProjection => {
  const dependencies = isHarnessTask(task) ? artifactDependencies[task] : []
  const artifactRefs = artifactTypes.flatMap((type) => {
    const artifact = state.latest_artifacts[type]
    return artifact
      ? [{
          type,
          id: artifact.id,
          version: artifact.version,
          status: artifact.status,
          content_hash: artifact.content_hash,
        }]
      : []
  })
  const artifacts = dependencies.flatMap((type) => {
    const artifact = state.latest_artifacts[type]
    return artifact?.status === 'CONFIRMED'
      ? [{ type, version: artifact.version, status: 'CONFIRMED' as const, content: artifact.content }]
      : []
  })

  return {
    projection: isHarnessTask(task) ? projectionByTask[task] : 'MINIMAL',
    state_revision: state.revision,
    role: {
      id: state.id,
      title: state.title,
      department: state.department,
      stage: state.stage,
      hc_status: state.hc_status,
    },
    facts: selectFacts(state, task),
    conflicts: ['CLARIFY_MESSAGE', 'GENERATE_ROLE_PROFILE'].includes(task)
      ? state.conflicts.map(projectConflict)
      : [],
    artifact_refs: artifactRefs,
    task_context: {
      task,
      artifacts,
      ...(task === 'CALIBRATION_ADVICE'
        ? {
            candidate_summary: summarizeCandidates(candidates),
            calibration_policy: {
              minimum_candidates: 10,
              minimum_channels: 2,
              repeated_signal_count: 2,
            },
            calibration_evaluation: evaluateCalibrationBoundary(candidates),
          }
        : {}),
    },
  }
}
