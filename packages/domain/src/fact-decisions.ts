import type {
  ArtifactEnvelope,
  Fact,
  FactDecisionRequest,
  RoleState,
} from '@role-clarifier/contracts'
import { assertRevision, DomainError } from './index.js'

export interface ApplyFactDecisionInput {
  state: RoleState
  artifacts: readonly ArtifactEnvelope[]
  factId: string
  request: FactDecisionRequest
  actorUserId: string
  now: string
  createId: () => string
}

export interface FactDecisionResult {
  state: RoleState
  artifacts: ArtifactEnvelope[]
  active_fact_id: string
  invalidated_artifact_ids: string[]
  audit_action: 'FACT_CONFIRMED' | 'FACT_REVISED' | 'FACT_REJECTED' | null
  audit_metadata: Record<string, unknown>
}

const confirmedAncestorId = (facts: readonly Fact[], target: Fact): string | null => {
  const byId = new Map(facts.map((fact) => [fact.id, fact]))
  const visited = new Set<string>()
  let currentId = target.supersedes_fact_id
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId)
    const current = byId.get(currentId)
    if (!current) return null
    if (current.status === 'CONFIRMED') return current.id
    currentId = current.supersedes_fact_id
  }
  return null
}

export const applyFactDecision = (input: ApplyFactDecisionInput): FactDecisionResult => {
  assertRevision(input.state.revision, input.request.expected_revision)
  const target = input.state.facts.find((fact) => fact.id === input.factId)
  if (!target) throw new DomainError('FACT_NOT_FOUND', '岗位事实不存在', 404)
  if (target.status === 'STALE') {
    throw new DomainError('FACT_NOT_DECIDABLE', '该事实已经失效', 409)
  }
  if (input.request.decision === 'CONFIRM' && target.status === 'CONFIRMED') {
    return {
      state: input.state,
      artifacts: [...input.artifacts],
      active_fact_id: target.id,
      invalidated_artifact_ids: [],
      audit_action: null,
      audit_metadata: {},
    }
  }
  if (input.request.decision === 'REJECT' && target.status === 'CONFIRMED') {
    throw new DomainError('FACT_NOT_DECIDABLE', '已生效事实只能通过替代版本修改', 409)
  }

  let facts = input.state.facts.map((fact) => ({ ...fact }))
  let activeFact = target
  let auditAction: Exclude<FactDecisionResult['audit_action'], null>
  let invalidate = false
  let supersededConfirmedId: string | null = null

  if (input.request.decision === 'CONFIRM') {
    supersededConfirmedId = confirmedAncestorId(facts, target)
    facts = facts.map((fact) => {
      if (fact.id === supersededConfirmedId) {
        return { ...fact, status: 'STALE' as const, updated_at: input.now }
      }
      if (fact.id === target.id) {
        return {
          ...fact,
          status: 'CONFIRMED' as const,
          confirmed_by_user_id: input.actorUserId,
          confirmed_at: input.now,
          updated_at: input.now,
        }
      }
      return fact
    })
    activeFact = facts.find((fact) => fact.id === target.id)!
    auditAction = 'FACT_CONFIRMED'
    invalidate = true
  } else if (input.request.decision === 'REJECT') {
    const rejectionReason = input.request.reason ?? null
    facts = facts.map((fact) => fact.id === target.id
      ? {
          ...fact,
          status: 'STALE' as const,
          decision_reason: rejectionReason,
          updated_at: input.now,
        }
      : fact)
    activeFact = facts.find((fact) => fact.id === target.id)!
    auditAction = 'FACT_REJECTED'
  } else {
    const replacement: Fact = {
      ...target,
      id: input.createId(),
      category: input.request.replacement.category,
      statement: input.request.replacement.statement,
      status: 'DRAFT',
      proposed_by_user_id: input.actorUserId,
      confirmed_by_user_id: null,
      confirmed_at: null,
      supersedes_fact_id: target.id,
      decision_reason: input.request.reason ?? null,
      updated_at: input.now,
    }
    facts = [
      ...facts.map((fact) => fact.id === target.id && target.status !== 'CONFIRMED'
        ? { ...fact, status: 'STALE' as const, updated_at: input.now }
        : fact),
      replacement,
    ]
    activeFact = replacement
    auditAction = 'FACT_REVISED'
  }

  const latestArtifactIds = new Set(
    Object.values(input.state.latest_artifacts)
      .flatMap((artifact) => artifact?.status === 'CONFIRMED' ? [artifact.id] : []),
  )
  const artifacts = input.artifacts.map((artifact) =>
    invalidate && latestArtifactIds.has(artifact.id)
      ? { ...artifact, status: 'INVALIDATED' as const }
      : { ...artifact },
  )
  const invalidatedIds = artifacts
    .filter((artifact, index) => artifact.status !== input.artifacts[index]?.status)
    .map((artifact) => artifact.id)
  const latestArtifacts = { ...input.state.latest_artifacts }
  for (const artifact of artifacts.filter((item) => invalidatedIds.includes(item.id))) {
    if (latestArtifacts[artifact.type]?.id === artifact.id) {
      latestArtifacts[artifact.type] = {
        ...latestArtifacts[artifact.type]!,
        status: 'INVALIDATED',
      }
    }
  }

  return {
    state: {
      ...input.state,
      facts,
      latest_artifacts: latestArtifacts,
      revision: input.state.revision + 1,
      updated_at: input.now,
    },
    artifacts,
    active_fact_id: activeFact.id,
    invalidated_artifact_ids: invalidatedIds,
    audit_action: auditAction,
    audit_metadata: {
      source_fact_id: target.id,
      active_fact_id: activeFact.id,
      superseded_confirmed_fact_id: supersededConfirmedId,
    },
  }
}
