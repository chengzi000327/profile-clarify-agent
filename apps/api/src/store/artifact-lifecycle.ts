import type { ArtifactEnvelope, ArtifactType, RoleState } from '@role-clarifier/contracts'
import type { ArtifactLifecycleCommit, RoleAggregate } from './types.js'

function invariant(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error(`INVALID_ARTIFACT_LIFECYCLE_COMMIT:${code}`)
}

const immutableArtifactFieldsMatch = (
  current: ArtifactEnvelope,
  updated: ArtifactEnvelope,
): boolean =>
  current.id === updated.id
  && current.role_session_id === updated.role_session_id
  && current.type === updated.type
  && current.version === updated.version
  && current.created_by === updated.created_by
  && current.created_at === updated.created_at

const validateLatestArtifacts = (
  state: RoleState,
  artifacts: ArtifactEnvelope[],
): void => {
  const byId = new Map(artifacts.map((artifact) => [artifact.id, artifact]))
  for (const [type, latest] of Object.entries(state.latest_artifacts)) {
    if (!latest) continue
    const artifact = byId.get(latest.id)
    invariant(artifact, `LATEST_ARTIFACT_MISSING:${type}`)
    invariant(artifact.type === type, `LATEST_ARTIFACT_TYPE:${type}`)
    invariant(artifact.version === latest.version, `LATEST_ARTIFACT_VERSION:${type}`)
    invariant(artifact.status === latest.status, `LATEST_ARTIFACT_STATUS:${type}`)
    invariant(artifact.content_hash === latest.content_hash, `LATEST_ARTIFACT_HASH:${type}`)
  }
}

export const validateArtifactLifecycleCommit = (
  current: RoleAggregate,
  change: ArtifactLifecycleCommit,
): RoleAggregate => {
  invariant(current.state.id === change.role_session_id, 'CURRENT_ROLE')
  invariant(change.next_state.id === change.role_session_id, 'NEXT_ROLE')
  invariant(change.next_state.tenant_id === current.state.tenant_id, 'TENANT')
  invariant(change.expected_revision === current.state.revision, 'EXPECTED_REVISION')
  invariant(change.next_state.revision === current.state.revision + 1, 'NEXT_REVISION')
  invariant(change.next_state.created_at === current.state.created_at, 'CREATED_AT')

  const artifacts = current.artifacts.map((artifact) => structuredClone(artifact))
  const artifactsById = new Map(artifacts.map((artifact) => [artifact.id, artifact]))
  const insertedIds = new Set<string>()
  const nextVersionByType = new Map<ArtifactType, number>()
  for (const artifact of artifacts) {
    nextVersionByType.set(
      artifact.type,
      Math.max(nextVersionByType.get(artifact.type) ?? 0, artifact.version),
    )
  }

  for (const updated of change.artifacts_to_update) {
    invariant(updated.role_session_id === change.role_session_id, 'UPDATED_ARTIFACT_ROLE')
    const existing = artifactsById.get(updated.id)
    invariant(existing, 'UPDATED_ARTIFACT_MISSING')
    invariant(immutableArtifactFieldsMatch(existing, updated), 'UPDATED_ARTIFACT_IDENTITY')
    const index = artifacts.findIndex((artifact) => artifact.id === updated.id)
    artifacts[index] = structuredClone(updated)
    artifactsById.set(updated.id, artifacts[index]!)
  }

  for (const inserted of change.artifacts_to_insert) {
    invariant(inserted.role_session_id === change.role_session_id, 'INSERTED_ARTIFACT_ROLE')
    invariant(!artifactsById.has(inserted.id) && !insertedIds.has(inserted.id), 'INSERTED_ARTIFACT_ID')
    const expectedVersion = (nextVersionByType.get(inserted.type) ?? 0) + 1
    invariant(inserted.version === expectedVersion, 'INSERTED_ARTIFACT_VERSION')
    nextVersionByType.set(inserted.type, inserted.version)
    insertedIds.add(inserted.id)
    const cloned = structuredClone(inserted)
    artifacts.push(cloned)
    artifactsById.set(cloned.id, cloned)
  }

  for (const decision of change.decisions) {
    invariant(decision.role_session_id === change.role_session_id, 'DECISION_ROLE')
  }
  validateLatestArtifacts(change.next_state, artifacts)

  return {
    ...structuredClone(current),
    state: structuredClone(change.next_state),
    artifacts,
  }
}
