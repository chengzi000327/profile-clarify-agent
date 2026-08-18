import { randomUUID } from 'node:crypto'
import type {
  ActorContext,
  ArtifactEnvelope,
  Fact,
  FactDecisionRequest,
  RoleState,
} from '@role-clarifier/contracts'
import { applyFactDecision, assertRevision, DomainError } from '@role-clarifier/domain'
import type { ApplicationStore, DecisionRecord, RoleAggregate } from '../store/index.js'
import { RoleService } from './role-service.js'

export interface FactDecisionResponse {
  state: RoleState
  fact: Fact
  invalidated_artifact_ids: string[]
}

const changedArtifacts = (
  before: readonly ArtifactEnvelope[],
  after: readonly ArtifactEnvelope[],
): ArtifactEnvelope[] => {
  const previous = new Map(before.map((artifact) => [artifact.id, artifact.status]))
  return after.filter((artifact) => previous.get(artifact.id) !== artifact.status)
}

export class FactDecisionService {
  constructor(
    private readonly store: ApplicationStore,
    private readonly roleService: RoleService,
  ) {}

  async decide(
    roleSessionId: string,
    factId: string,
    actualActor: ActorContext,
    effectiveActor: ActorContext,
    request: FactDecisionRequest,
  ): Promise<FactDecisionResponse> {
    this.assertManager(effectiveActor)
    const aggregate = await this.requireAggregate(roleSessionId, actualActor)
    const target = this.requireVisibleFact(aggregate, factId)
    const repeated = this.repeatedDecision(aggregate, target, request)
    if (repeated) {
      const view = await this.roleService.get(roleSessionId, actualActor)
      return { state: view.state, fact: repeated, invalidated_artifact_ids: [] }
    }

    const now = new Date().toISOString()
    const result = applyFactDecision({
      state: aggregate.state,
      artifacts: aggregate.artifacts,
      factId,
      request,
      actorUserId: actualActor.user_id,
      now,
      createId: randomUUID,
    })
    if (!result.audit_action) {
      const view = await this.roleService.get(roleSessionId, actualActor)
      return { state: view.state, fact: target, invalidated_artifact_ids: [] }
    }
    const decisions = [this.decisionRecord({
      roleSessionId,
      actor: actualActor,
      effectiveActor,
      action: result.audit_action,
      targetId: result.active_fact_id,
      metadata: { ...result.audit_metadata, decision: request.decision },
      now,
    })]
    if (result.invalidated_artifact_ids.length > 0) {
      decisions.push(this.decisionRecord({
        roleSessionId,
        actor: actualActor,
        effectiveActor,
        action: 'ARTIFACTS_INVALIDATED_BY_FACT',
        targetId: result.active_fact_id,
        metadata: {
          ...result.audit_metadata,
          invalidated_artifact_ids: result.invalidated_artifact_ids,
        },
        now,
      }))
    }
    const committed = await this.store.commitFactDecision({
      role_session_id: roleSessionId,
      tenant_id: actualActor.tenant_id,
      expected_revision: request.expected_revision,
      state: result.state,
      artifacts: changedArtifacts(aggregate.artifacts, result.artifacts),
      decisions,
    })
    if (!committed) throw this.revisionConflict()

    const view = await this.roleService.get(roleSessionId, actualActor)
    const activeFact = view.state.facts.find((fact) => fact.id === result.active_fact_id)
    if (!activeFact) throw new Error('Committed fact decision is not visible')
    return {
      state: view.state,
      fact: activeFact,
      invalidated_artifact_ids: result.invalidated_artifact_ids,
    }
  }

  async confirmBatch(
    roleSessionId: string,
    factIds: string[],
    actualActor: ActorContext,
    effectiveActor: ActorContext,
    expectedRevision: number,
  ): Promise<{ state: RoleState; invalidated_artifact_ids: string[] }> {
    this.assertManager(effectiveActor)
    const aggregate = await this.requireAggregate(roleSessionId, actualActor)
    assertRevision(aggregate.state.revision, expectedRevision)
    const targets = [...new Set(factIds)].map((factId) => {
      const fact = this.requireVisibleFact(aggregate, factId)
      if (fact.status === 'STALE') {
        throw new DomainError('FACT_NOT_DECIDABLE', '该事实已经失效', 409)
      }
      return fact
    })

    const now = new Date().toISOString()
    let state = structuredClone(aggregate.state)
    let artifacts = structuredClone(aggregate.artifacts)
    const decisions: DecisionRecord[] = []
    const invalidatedIds = new Set<string>()
    for (const target of targets) {
      const result = applyFactDecision({
        state,
        artifacts,
        factId: target.id,
        request: { decision: 'CONFIRM', expected_revision: state.revision },
        actorUserId: actualActor.user_id,
        now,
        createId: randomUUID,
      })
      state = result.state
      artifacts = result.artifacts
      for (const id of result.invalidated_artifact_ids) invalidatedIds.add(id)
      if (result.audit_action) {
        decisions.push(this.decisionRecord({
          roleSessionId,
          actor: actualActor,
          effectiveActor,
          action: result.audit_action,
          targetId: result.active_fact_id,
          metadata: { ...result.audit_metadata, decision: 'CONFIRM', batch: true },
          now,
        }))
      }
    }
    if (decisions.length === 0) {
      const view = await this.roleService.get(roleSessionId, actualActor)
      return { state: view.state, invalidated_artifact_ids: [] }
    }
    state = { ...state, revision: expectedRevision + 1, updated_at: now }
    if (invalidatedIds.size > 0) {
      decisions.push(this.decisionRecord({
        roleSessionId,
        actor: actualActor,
        effectiveActor,
        action: 'ARTIFACTS_INVALIDATED_BY_FACT',
        targetId: targets.at(-1)?.id ?? roleSessionId,
        metadata: {
          active_fact_ids: targets.map((fact) => fact.id),
          invalidated_artifact_ids: [...invalidatedIds],
          batch: true,
        },
        now,
      }))
    }
    const committed = await this.store.commitFactDecision({
      role_session_id: roleSessionId,
      tenant_id: actualActor.tenant_id,
      expected_revision: expectedRevision,
      state,
      artifacts: changedArtifacts(aggregate.artifacts, artifacts),
      decisions,
    })
    if (!committed) throw this.revisionConflict()
    const view = await this.roleService.get(roleSessionId, actualActor)
    return { state: view.state, invalidated_artifact_ids: [...invalidatedIds] }
  }

  private assertManager(actor: ActorContext): void {
    if (actor.role !== 'MANAGER') {
      throw new DomainError('FORBIDDEN', '仅用人经理可以确认岗位事实', 403)
    }
  }

  private async requireAggregate(
    roleSessionId: string,
    actor: ActorContext,
  ): Promise<RoleAggregate> {
    const aggregate = await this.store.getRoleAggregate(roleSessionId, actor)
    if (!aggregate) throw new DomainError('ROLE_SESSION_NOT_FOUND', '岗位会话不存在', 404)
    return aggregate
  }

  private requireVisibleFact(aggregate: RoleAggregate, factId: string): Fact {
    const target = aggregate.state.facts.find((fact) => fact.id === factId)
    if (!target || target.visible_to === 'HR_ONLY') {
      throw new DomainError('FACT_NOT_FOUND', '岗位事实不存在', 404)
    }
    return target
  }

  private repeatedDecision(
    aggregate: RoleAggregate,
    target: Fact,
    request: FactDecisionRequest,
  ): Fact | null {
    if (request.decision === 'CONFIRM' && target.status === 'CONFIRMED') return target
    if (
      request.decision === 'REJECT'
      && target.status === 'STALE'
      && target.decision_reason === (request.reason ?? null)
      && !aggregate.state.facts.some((fact) => fact.supersedes_fact_id === target.id)
    ) return target
    if (request.decision === 'REVISE') {
      return aggregate.state.facts.find((fact) =>
        fact.supersedes_fact_id === target.id
        && fact.status !== 'STALE'
        && fact.category === request.replacement.category
        && fact.statement === request.replacement.statement
        && fact.decision_reason === (request.reason ?? null),
      ) ?? null
    }
    return null
  }

  private decisionRecord(input: {
    roleSessionId: string
    actor: ActorContext
    effectiveActor: ActorContext
    action: string
    targetId: string
    metadata: Record<string, unknown>
    now: string
  }): DecisionRecord {
    return {
      id: randomUUID(),
      role_session_id: input.roleSessionId,
      actor_user_id: input.actor.user_id,
      action: input.action,
      target_type: input.action === 'ARTIFACTS_INVALIDATED_BY_FACT' ? 'ARTIFACT_SET' : 'FACT',
      target_id: input.targetId,
      metadata: {
        ...input.metadata,
        actual_actor_role: input.actor.role,
        effective_actor_role: input.effectiveActor.role,
      },
      created_at: input.now,
    }
  }

  private revisionConflict(): DomainError {
    return new DomainError('REVISION_CONFLICT', '岗位数据已被其他操作更新，请刷新后重试', 409)
  }
}
