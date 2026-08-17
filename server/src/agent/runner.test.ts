import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  RoleProfileJobDescriptionContentSchema,
  RoleProfileTalentDraftContentSchema,
  type ActorContext,
  type AgentContextSnapshot,
} from '@role-clarifier/contracts'
import { loadConfig } from '../config.js'
import { RoleService } from '../services/role-service.js'
import { MemoryStore } from '../store/memory-store.js'
import { DEMO_ROLE_SESSION_ID } from '../store/seed.js'
import type {
  HarnessAdapter,
  HarnessHooks,
  HarnessRequest,
  HarnessResult,
} from './harness-adapter.js'
import { AgentRunner } from './runner.js'

const config = loadConfig({
  NODE_ENV: 'test',
  SESSION_SECRET: 'test-session-secret-that-is-long-enough',
  AGENT_CONCURRENCY: '1',
})

const manager: ActorContext = {
  tenant_id: 'tenant-demo',
  user_id: 'manager-demo',
  role: 'MANAGER',
  display_name: '用人经理 · 陈曦',
}

class CapturingHarness implements HarnessAdapter {
  readonly requests: HarnessRequest[] = []
  private waiter: ((request: HarnessRequest) => void) | null = null

  async run(request: HarnessRequest, _hooks: HarnessHooks): Promise<HarnessResult> {
    this.requests.push(request)
    this.waiter?.(request)
    this.waiter = null
    throw new Error('CapturingHarness stops after observing the real Runner request')
  }

  nextRequest(): Promise<HarnessRequest> {
    const existing = this.requests.at(-1)
    if (existing) return Promise.resolve(existing)
    return new Promise((resolve) => {
      this.waiter = resolve
    })
  }
}

describe('AgentRunner role profile context boundary', () => {
  let store: MemoryStore
  let roleService: RoleService
  let harness: CapturingHarness
  let runner: AgentRunner

  beforeEach(async () => {
    store = new MemoryStore()
    await store.initialize()
    roleService = new RoleService(store)
    harness = new CapturingHarness()
    runner = new AgentRunner(store, roleService, harness, config)
  })

  afterEach(async () => {
    await store.close()
  })

  const lockCurrentJobDescription = async () => {
    const initial = await roleService.get(DEMO_ROLE_SESSION_ID, manager)
    const existing = RoleProfileTalentDraftContentSchema.parse(
      initial.state.latest_artifacts.ROLE_PROFILE?.content,
    )
    const draft = await roleService.saveArtifactDraft(
      DEMO_ROLE_SESSION_ID,
      manager,
      'ROLE_PROFILE',
      { job_description: existing.job_description },
    )
    const afterDraft = await roleService.get(DEMO_ROLE_SESSION_ID, manager)
    return roleService.confirmArtifact(
      DEMO_ROLE_SESSION_ID,
      draft.id,
      manager,
      draft.content_hash,
      afterDraft.state.revision,
    )
  }

  it('sends only the locked job description projection to Harness for talent generation', async () => {
    const locked = await lockCurrentJobDescription()
    const lockedContent = RoleProfileJobDescriptionContentSchema.parse(locked.content)

    await runner.submitArtifact(DEMO_ROLE_SESSION_ID, manager, 'ROLE_PROFILE')
    const request = await harness.nextRequest()
    const serialized = JSON.stringify(request.role_state)

    expect(request.task).toBe('GENERATE_ROLE_PROFILE')
    expect(request.role_state).toMatchObject({
      projection: 'ROLE_PROFILE',
      task_context: {
        task: 'GENERATE_ROLE_PROFILE',
        role_profile_mode: 'TALENT_PROFILE',
        locked_job_description: {
          artifact_id: locked.id,
          version: locked.version,
          confirmed_by: 'manager-demo',
          content: lockedContent.job_description,
        },
      },
    })
    expect(request.role_state).not.toHaveProperty('tenant_id')
    expect(request.role_state).not.toHaveProperty('latest_artifacts')
    expect(request.role_state).not.toHaveProperty('hc_context')
    expect(request.role_state).not.toHaveProperty('role.hc_context')
    expect(request.role_state).toMatchObject({ facts: [], conflicts: [], artifact_refs: [] })
    expect(serialized).not.toContain('"request_id"')
    expect(serialized).not.toContain('年度新增编制预算内')
    expect(serialized).not.toContain('talent_profile')
    expect(serialized).not.toContain('ASSESSMENT_SCORECARD')
    expect(serialized).not.toContain('PUBLIC_JD')
    expect(serialized).not.toContain('HR_RECRUITING_BRIEF')
  })

  it('keeps HC facts and conflicts in the first-stage job description projection', async () => {
    await runner.submitArtifact(DEMO_ROLE_SESSION_ID, manager, 'ROLE_PROFILE')
    const request = await harness.nextRequest()

    expect(request.role_state).toMatchObject({
      projection: 'ROLE_PROFILE',
      role: {
        hc_context: expect.objectContaining({ request_id: 'HC-2026-EP-001' }),
      },
      task_context: {
        role_profile_mode: 'JOB_DESCRIPTION',
      },
    })
    expect((request.role_state as { facts: unknown[] }).facts.length).toBeGreaterThan(0)
  })

  it('keeps non-role-profile Harness tasks on the complete RoleState contract', async () => {
    await runner.submitMessage(DEMO_ROLE_SESSION_ID, manager, '请继续澄清成功标准。')
    const request = await harness.nextRequest()

    expect(request.task).toBe('CLARIFY_MESSAGE')
    expect(request.role_state).toMatchObject({
      tenant_id: 'tenant-demo',
      id: DEMO_ROLE_SESSION_ID,
      latest_artifacts: expect.any(Object),
    })
    expect(request.role_state).not.toHaveProperty('projection')
  })
})
