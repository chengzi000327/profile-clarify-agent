import { beforeEach, describe, expect, it } from 'vitest'
import type { ActorContext } from '@role-clarifier/contracts'
import { MemoryStore } from '../store/memory-store.js'
import { seedMockHcApprovals } from '../store/mock-hc-fixtures.js'
import { ApprovedHcIntakeService } from './approved-hc-intake-service.js'
import { RoleService } from './role-service.js'

const manager: ActorContext = {
  tenant_id: 'tenant-demo',
  user_id: 'manager-demo',
  role: 'MANAGER',
  display_name: '用人经理 · 陈曦',
}

describe('approved HC intake', () => {
  let service: ApprovedHcIntakeService

  beforeEach(async () => {
    const store = new MemoryStore()
    await store.initialize()
    await seedMockHcApprovals(store)
    service = new ApprovedHcIntakeService(store, new RoleService(store))
  })

  it('lists only approved HCs that still need profile clarification', async () => {
    const options = await service.list(manager)
    expect(options).toHaveLength(6)
    expect(options.every((option) => option.status === 'APPROVED')).toBe(true)
    expect(options.map((option) => option.approval_id)).toContain('HC-2026-AIPM-002')
    expect(options.map((option) => option.approval_id)).not.toContain('HC-2026-FE-006')
  })

  it('starts a role conversation from the selected approved HC', async () => {
    const role = await service.start(manager, 'HC-2026-AIPM-002')
    expect(role.state).toMatchObject({
      title: 'AI 产品经理',
      department: 'AI 应用产品部',
      hc_status: 'APPROVED',
      stage: 'SUCCESS_CLARIFYING',
      hc_approval: { approval_id: 'HC-2026-AIPM-002' },
    })
    expect(role.state.facts).toContainEqual(expect.objectContaining({
      category: 'HIRING_REASON',
      status: 'CONFIRMED',
      evidence_refs: ['mock://hc/HC-2026-AIPM-002'],
    }))

    const options = await service.list(manager)
    expect(options.find((option) => option.approval_id === 'HC-2026-AIPM-002'))
      .toMatchObject({ clarification_status: 'IN_PROGRESS', role_session_id: role.state.id })
  })

  it('rejects pending or unknown HC selections', async () => {
    await expect(service.start(manager, 'HC-2026-FE-006'))
      .rejects.toMatchObject({ code: 'APPROVED_HC_NOT_FOUND', statusCode: 404 })
  })
})
