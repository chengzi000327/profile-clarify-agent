import { randomUUID } from 'node:crypto'
import {
  ARTIFACT_VISIBILITY,
  CandidateEvidenceSchema,
  PublicJDSchema,
  type ActorContext,
  type ArtifactEnvelope,
  type ArtifactType,
  type CandidateEvidence,
  type FactCategory,
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
import { createMockHcContext } from '../store/seed.js'
import {
  projectRoleStateForTask,
  type RoleStateProjection,
} from './role-state-projection.js'

const nowIso = (): string => new Date().toISOString()

const artifactDependencies: Record<ArtifactType, ArtifactType[]> = {
  ROLE_PROFILE: [],
  ASSESSMENT_SCORECARD: ['ROLE_PROFILE'],
  PUBLIC_JD: ['ROLE_PROFILE', 'ASSESSMENT_SCORECARD'],
  HR_RECRUITING_BRIEF: ['ROLE_PROFILE', 'ASSESSMENT_SCORECARD'],
}

const artifactNames: Record<ArtifactType, string> = {
  ROLE_PROFILE: '画像依据',
  ASSESSMENT_SCORECARD: '评估方案',
  PUBLIC_JD: '对外 JD',
  HR_RECRUITING_BRIEF: '招聘画像',
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
    effectiveRole: ActorContext['role'] = actor.role,
  ): Promise<RoleStateProjection> {
    const includeCandidates = task === 'CALIBRATION_ADVICE' && ['HR', 'ADMIN'].includes(effectiveRole)
    const aggregate = await this.requireAggregate(roleSessionId, actor, {
      members: false,
      artifacts: false,
      candidates: includeCandidates,
      calibration_signals: false,
      manager_tasks: false,
    })
    return projectRoleStateForTask(
      this.filterState(aggregate.state, { ...actor, role: effectiveRole }),
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
      hc_context: null,
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
      hc_context: createMockHcContext({
        hiringManagerUserId: actor.user_id,
        assignedHrUserId: actor.tenant_id === 'tenant-demo' ? 'hr-demo' : null,
      }),
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
      hc_context: aggregate.state.hc_context ?? createMockHcContext({
        hiringManagerUserId: actor.user_id,
        assignedHrUserId: actor.tenant_id === 'tenant-demo' ? 'hr-demo' : null,
        department: aggregate.state.department,
      }),
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

  async assertArtifactGenerationAllowed(
    roleSessionId: string,
    actor: ActorContext,
    effectiveRole: ActorContext['role'],
    artifactType: ArtifactType,
  ): Promise<void> {
    const aggregate = await this.requireAggregate(roleSessionId, actor)
    if (aggregate.state.hc_status !== 'APPROVED') {
      throw new DomainError('HC_NOT_APPROVED', 'HC 审批通过后才能生成正式岗位产物', 409)
    }
    if (artifactType === 'HR_RECRUITING_BRIEF' && !['HR', 'ADMIN'].includes(effectiveRole)) {
      throw new DomainError('FORBIDDEN', '仅 HR 可以生成内部招聘画像', 403)
    }
    if (artifactType !== 'HR_RECRUITING_BRIEF' && !['MANAGER', 'ADMIN'].includes(effectiveRole)) {
      throw new DomainError('FORBIDDEN', '该产物需要由用人经理生成', 403)
    }
    const missing = artifactDependencies[artifactType].filter(
      (dependency) => aggregate.state.latest_artifacts[dependency]?.status !== 'CONFIRMED',
    )
    if (missing.length > 0) {
      throw new DomainError(
        'ARTIFACT_PREREQUISITES_MISSING',
        `请先确认${missing.map((type) => artifactNames[type]).join('、')}，再生成${artifactNames[artifactType]}`,
        409,
      )
    }
  }

  async saveArtifactDraft<T>(
    roleSessionId: string,
    actor: ActorContext,
    type: ArtifactType,
    content: T,
  ): Promise<ArtifactEnvelope<T>> {
    const aggregate = await this.requireAggregate(roleSessionId, actor)
    assertArtifactAccess(actor, type)
    if (type === 'PUBLIC_JD') PublicJDSchema.parse(content)
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
    effectiveRole: ActorContext['role'] = actor.role,
  ): Promise<ArtifactEnvelope> {
    const aggregate = await this.requireAggregate(roleSessionId, actor)
    assertRevision(aggregate.state.revision, expectedRevision)
    const artifact = aggregate.artifacts.find((item) => item.id === artifactId)
    if (!artifact) throw new DomainError('ARTIFACT_NOT_FOUND', '产物不存在', 404)
    assertArtifactAccess(actor, artifact.type)
    if (artifact.type === 'HR_RECRUITING_BRIEF' && !['HR', 'ADMIN'].includes(effectiveRole)) {
      throw new DomainError('FORBIDDEN', '仅 HR 可以确认内部招聘画像', 403)
    }
    if (artifact.type !== 'HR_RECRUITING_BRIEF' && !['MANAGER', 'ADMIN'].includes(effectiveRole)) {
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
      effective_actor_role: effectiveRole,
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
  ): Promise<{ state: RoleState; evaluation: ReturnType<typeof evaluateCalibrationBoundary> }> {
    if (!['HR', 'ADMIN'].includes(actor.role)) throw new DomainError('FORBIDDEN', '仅 HR 或企业管理员可以导入候选人证据', 403)
    const aggregate = await this.requireAggregate(roleSessionId, actor)
    for (const candidate of candidates) CandidateEvidenceSchema.parse(candidate)
    await this.store.insertCandidates(roleSessionId, candidates, actor.user_id)
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
    const latest = { ...state.latest_artifacts }
    delete latest.HR_RECRUITING_BRIEF
    const hcContext = state.hc_context
      ? {
          ...structuredClone(state.hc_context),
          job_basics: {
            ...structuredClone(state.hc_context.job_basics),
            salary_range: '按权限可见',
          },
        }
      : null
    return {
      ...structuredClone(state),
      hc_context: hcContext,
      facts: state.facts.filter((fact) => fact.visible_to !== 'HR_ONLY'),
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
