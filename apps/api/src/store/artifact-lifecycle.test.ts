import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import postgres from 'postgres'
import { createArtifactEnvelope } from '@role-clarifier/domain'
import type { ActorContext, ArtifactEnvelope } from '@role-clarifier/contracts'
import { validateArtifactLifecycleCommit } from './artifact-lifecycle.js'
import { MemoryStore } from './memory-store.js'
import { PostgresStore } from './postgres-store.js'
import { createDemoAggregate, DEMO_ROLE_SESSION_ID } from './seed.js'
import { RoleService } from '../services/role-service.js'
import type {
  ApplicationStore,
  ArtifactLifecycleCommit,
  DecisionRecord,
  RoleAggregate,
} from './types.js'

const manager: ActorContext = {
  tenant_id: 'tenant-demo',
  user_id: 'manager-demo',
  role: 'MANAGER',
  display_name: '用人经理 · 陈曦',
}

interface StoreFixture {
  store: ApplicationStore
  actor: ActorContext
  roleSessionId: string
  decisions(): Promise<DecisionRecord[]>
  close(): Promise<void>
}

const currentAggregate = async (fixture: StoreFixture): Promise<RoleAggregate> => {
  const aggregate = await fixture.store.getRoleAggregate(fixture.roleSessionId, fixture.actor)
  if (!aggregate) throw new Error('Missing contract-test aggregate')
  return aggregate
}

const buildCommit = (
  aggregate: RoleAggregate,
  overrides: Partial<ArtifactLifecycleCommit> = {},
): ArtifactLifecycleCommit => {
  const currentPublicJd = aggregate.artifacts
    .filter((artifact) => artifact.type === 'PUBLIC_JD')
    .sort((left, right) => right.version - left.version)[0]
  if (!currentPublicJd) throw new Error('Missing seeded PUBLIC_JD')
  const invalidatedPublicJd: ArtifactEnvelope = {
    ...structuredClone(currentPublicJd),
    status: 'INVALIDATED',
  }
  const currentRoleProfileVersion = Math.max(
    0,
    ...aggregate.artifacts
      .filter((artifact) => artifact.type === 'ROLE_PROFILE')
      .map((artifact) => artifact.version),
  )
  const inserted = createArtifactEnvelope({
    roleSessionId: aggregate.state.id,
    type: 'ROLE_PROFILE',
    version: currentRoleProfileVersion + 1,
    content: { contract_test: true },
    createdBy: manager.user_id,
    basedOnHash: aggregate.state.latest_artifacts.ROLE_PROFILE?.content_hash ?? null,
  })
  const nextState = {
    ...structuredClone(aggregate.state),
    stage: 'PROFILE_DRAFT' as const,
    revision: aggregate.state.revision + 1,
    updated_at: new Date().toISOString(),
    latest_artifacts: {
      ...structuredClone(aggregate.state.latest_artifacts),
      ROLE_PROFILE: {
        id: inserted.id,
        version: inserted.version,
        status: inserted.status,
        content_hash: inserted.content_hash,
        content: inserted.content,
      },
      PUBLIC_JD: {
        ...aggregate.state.latest_artifacts.PUBLIC_JD!,
        status: 'INVALIDATED' as const,
      },
    },
  }
  const decision: DecisionRecord = {
    id: randomUUID(),
    role_session_id: aggregate.state.id,
    actor_user_id: manager.user_id,
    action: 'CONFIRM_ARTIFACT',
    target_type: 'ROLE_PROFILE',
    target_id: inserted.id,
    metadata: { contract_test: true },
    created_at: new Date().toISOString(),
  }
  return {
    role_session_id: aggregate.state.id,
    expected_revision: aggregate.state.revision,
    next_state: nextState,
    artifacts_to_insert: [inserted],
    artifacts_to_update: [invalidatedPublicJd],
    decisions: [decision],
    ...overrides,
  }
}

const defineArtifactLifecycleStoreContract = (
  name: string,
  createFixture: () => Promise<StoreFixture>,
): void => {
  describe(`${name} artifact lifecycle contract`, () => {
    it('commits artifact, downstream invalidation, state and decision together', async () => {
      const fixture = await createFixture()
      try {
        const before = await currentAggregate(fixture)
        const change = buildCommit(before)
        await expect(fixture.store.commitArtifactLifecycle(change)).resolves.toBe(true)

        const after = await currentAggregate(fixture)
        expect(after.state.revision).toBe(before.state.revision + 1)
        expect(after.state.latest_artifacts.ROLE_PROFILE?.id)
          .toBe(change.artifacts_to_insert[0]?.id)
        expect(after.artifacts.find((item) => item.id === change.artifacts_to_insert[0]?.id))
          .toBeDefined()
        expect(after.artifacts.find((item) => item.type === 'PUBLIC_JD')?.status)
          .toBe('INVALIDATED')
        expect(await fixture.decisions()).toContainEqual(change.decisions[0])
      } finally {
        await fixture.close()
      }
    })

    it('rejects a stale competing commit without partial writes', async () => {
      const fixture = await createFixture()
      try {
        const before = await currentAggregate(fixture)
        const first = buildCommit(before)
        const second = buildCommit(before)
        const results = await Promise.all([
          fixture.store.commitArtifactLifecycle(first),
          fixture.store.commitArtifactLifecycle(second),
        ])
        expect(results.sort()).toEqual([false, true])

        const after = await currentAggregate(fixture)
        expect(after.state.revision).toBe(before.state.revision + 1)
        expect(after.artifacts.filter((artifact) =>
          first.artifacts_to_insert.some((item) => item.id === artifact.id)
          || second.artifacts_to_insert.some((item) => item.id === artifact.id),
        )).toHaveLength(1)
        expect(await fixture.decisions()).toHaveLength(1)
      } finally {
        await fixture.close()
      }
    })

    it('rolls back when an artifact update is invalid', async () => {
      const fixture = await createFixture()
      try {
        const before = await currentAggregate(fixture)
        const change = buildCommit(before)
        change.artifacts_to_update = [{
          ...change.artifacts_to_update[0]!,
          id: randomUUID(),
        }]
        await expect(fixture.store.commitArtifactLifecycle(change))
          .rejects.toThrow('UPDATED_ARTIFACT_MISSING')
        expect(await currentAggregate(fixture)).toEqual(before)
        expect(await fixture.decisions()).toEqual([])
      } finally {
        await fixture.close()
      }
    })
  })
}

defineArtifactLifecycleStoreContract('MemoryStore', async () => {
  const store = new MemoryStore()
  await store.initialize()
  return {
    store,
    actor: manager,
    roleSessionId: DEMO_ROLE_SESSION_ID,
    decisions: async () => structuredClone(
      (store as unknown as { decisions: DecisionRecord[] }).decisions,
    ),
    close: () => store.close(),
  }
})

const testDatabaseUrl = process.env.TEST_DATABASE_URL
const productionDatabaseUrl = process.env.DATABASE_URL
const isolatedPostgresUrl = testDatabaseUrl && testDatabaseUrl !== productionDatabaseUrl
  ? testDatabaseUrl
  : null

it('refuses to use DATABASE_URL as the PostgreSQL contract database', () => {
  if (!testDatabaseUrl || !productionDatabaseUrl) return
  expect(testDatabaseUrl).not.toBe(productionDatabaseUrl)
})

const describePostgresContract = isolatedPostgresUrl ? defineArtifactLifecycleStoreContract : null
describePostgresContract?.('PostgresStore', async () => {
  const sql = postgres(isolatedPostgresUrl!, { max: 1, prepare: false })
  const store = new PostgresStore(isolatedPostgresUrl!)
  const roleSessionId = randomUUID()
  const tenantId = `artifact-contract-${randomUUID()}`
  const actor: ActorContext = {
    tenant_id: tenantId,
    user_id: `manager-${randomUUID()}`,
    role: 'MANAGER',
    display_name: 'Artifact contract manager',
  }
  await store.initialize()
  await store.saveUser({ ...actor, active: true })
  const source = createDemoAggregate()
  const artifactIds = new Map(source.artifacts.map((artifact) => [artifact.id, randomUUID()]))
  const artifacts = source.artifacts.map((artifact) => ({
    ...structuredClone(artifact),
    id: artifactIds.get(artifact.id)!,
    role_session_id: roleSessionId,
    created_by: actor.user_id,
    confirmed_by: artifact.confirmed_by ? actor.user_id : null,
    content: artifact.content,
  }))
  const latestArtifacts = Object.fromEntries(
    Object.entries(source.state.latest_artifacts).map(([type, latest]) => [
      type,
      latest
        ? { ...structuredClone(latest), id: artifactIds.get(latest.id)! }
        : latest,
    ]),
  ) as typeof source.state.latest_artifacts
  await store.createRoleAggregate({
    state: {
      ...structuredClone(source.state),
      id: roleSessionId,
      tenant_id: tenantId,
      hc_context: source.state.hc_context
        ? {
            ...structuredClone(source.state.hc_context),
            hiring_manager_user_id: actor.user_id,
            assigned_hr_user_id: null,
          }
        : null,
      latest_artifacts: latestArtifacts,
    },
    member_ids: [actor.user_id],
    artifacts,
    candidates: [],
    calibration_signals: [],
    manager_tasks: [],
  })
  return {
    store,
    actor,
    roleSessionId,
    decisions: async () => {
      const rows = await sql<DecisionRecord[]>`
        SELECT
          id,
          role_session_id,
          actor_user_id,
          action,
          target_type,
          target_id,
          metadata - 'audit_kind' AS metadata,
          created_at::text
        FROM audit_logs
        WHERE role_session_id = ${roleSessionId}
        ORDER BY created_at
      `
      return rows.map((row) => ({
        ...row,
        created_at: new Date(row.created_at).toISOString(),
      }))
    },
    close: async () => {
      await sql`DELETE FROM role_sessions WHERE id = ${roleSessionId}`
      await sql`DELETE FROM users WHERE id = ${actor.user_id}`
      await store.close()
      await sql.end()
    },
  }
})

describe('artifact lifecycle invariant validation', () => {
  const setup = async () => {
    const store = new MemoryStore()
    await store.initialize()
    const aggregate = await store.getRoleAggregate(DEMO_ROLE_SESSION_ID, manager)
    if (!aggregate) throw new Error('Missing demo aggregate')
    return { store, aggregate, change: buildCommit(aggregate) }
  }

  it('rejects cross-role artifacts', async () => {
    const { aggregate, change } = await setup()
    change.artifacts_to_insert[0]!.role_session_id = randomUUID()
    expect(() => validateArtifactLifecycleCommit(aggregate, change))
      .toThrow('INSERTED_ARTIFACT_ROLE')
  })

  it('rejects tenant changes', async () => {
    const { aggregate, change } = await setup()
    change.next_state.tenant_id = 'another-tenant'
    expect(() => validateArtifactLifecycleCommit(aggregate, change)).toThrow('TENANT')
  })

  it('rejects non-sequential revisions', async () => {
    const { aggregate, change } = await setup()
    change.next_state.revision += 1
    expect(() => validateArtifactLifecycleCommit(aggregate, change)).toThrow('NEXT_REVISION')
  })

  it('rejects an update for a missing artifact', async () => {
    const { aggregate, change } = await setup()
    change.artifacts_to_update[0]!.id = randomUUID()
    expect(() => validateArtifactLifecycleCommit(aggregate, change))
      .toThrow('UPDATED_ARTIFACT_MISSING')
  })
})

describe('RoleService artifact lifecycle integration', () => {
  const setup = async () => {
    const store = new MemoryStore()
    await store.initialize()
    const service = new RoleService(store)
    const before = await store.getRoleAggregate(DEMO_ROLE_SESSION_ID, manager)
    if (!before) throw new Error('Missing demo aggregate')
    const publicJd = before.artifacts
      .filter((artifact) => artifact.type === 'PUBLIC_JD')
      .sort((left, right) => right.version - left.version)[0]
    if (!publicJd) throw new Error('Missing demo PUBLIC_JD')
    return { store, service, before, publicJd }
  }

  it('does not expose draft or invalidation writes when the lifecycle commit fails', async () => {
    const { store, service, before, publicJd } = await setup()
    vi.spyOn(store, 'commitArtifactLifecycle').mockRejectedValueOnce(new Error('forced commit failure'))
    await expect(service.saveArtifactDraft(
      DEMO_ROLE_SESSION_ID,
      manager,
      'PUBLIC_JD',
      publicJd.content,
    )).rejects.toThrow('forced commit failure')
    expect(await store.getRoleAggregate(DEMO_ROLE_SESSION_ID, manager)).toEqual(before)
  })

  it('does not confirm the artifact or append its decision when the lifecycle commit fails', async () => {
    const { store, service, before, publicJd } = await setup()
    vi.spyOn(store, 'commitArtifactLifecycle').mockRejectedValueOnce(new Error('forced commit failure'))
    await expect(service.confirmArtifact(
      DEMO_ROLE_SESSION_ID,
      publicJd.id,
      manager,
      publicJd.content_hash,
      before.state.revision,
    )).rejects.toThrow('forced commit failure')
    expect(await store.getRoleAggregate(DEMO_ROLE_SESSION_ID, manager)).toEqual(before)
    expect((store as unknown as { decisions: DecisionRecord[] }).decisions).toEqual([])
  })

  it('accepts only one of two competing draft versions', async () => {
    const { store, service, before, publicJd } = await setup()
    const results = await Promise.allSettled([
      service.saveArtifactDraft(DEMO_ROLE_SESSION_ID, manager, 'PUBLIC_JD', publicJd.content),
      service.saveArtifactDraft(DEMO_ROLE_SESSION_ID, manager, 'PUBLIC_JD', publicJd.content),
    ])
    expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected'])
    const rejection = results.find((result) => result.status === 'rejected')
    expect(rejection).toMatchObject({ reason: { code: 'REVISION_CONFLICT', statusCode: 409 } })
    const after = await store.getRoleAggregate(DEMO_ROLE_SESSION_ID, manager)
    expect(after?.state.revision).toBe(before.state.revision + 1)
    expect(after?.artifacts.filter((artifact) => artifact.type === 'PUBLIC_JD'))
      .toHaveLength(before.artifacts.filter((artifact) => artifact.type === 'PUBLIC_JD').length + 1)
  })
})
