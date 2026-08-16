import { beforeEach, describe, expect, it } from 'vitest'
import type { ActorContext } from '@role-clarifier/contracts'
import { MemoryStore } from '../store/memory-store.js'
import { seedMockHcApprovals } from '../store/mock-hc-fixtures.js'
import { RoleService, evaluateRoleProfileGenerationReadiness } from './role-service.js'

const manager: ActorContext = {
  tenant_id: 'tenant-demo',
  user_id: 'manager-demo',
  role: 'MANAGER',
  display_name: '用人经理 · 陈曦',
}

describe('HC approval synchronization', () => {
  let store: MemoryStore
  let service: RoleService

  beforeEach(async () => {
    store = new MemoryStore()
    await store.initialize()
    await seedMockHcApprovals(store)
    service = new RoleService(store)
  })

  it('matches an approved HC after role identity is recognized', async () => {
    const intake = await service.createIntake(manager)
    expect(intake.state.hc_status).toBe('PENDING')

    const state = await service.updateRoleIdentityDraft(intake.state.id, manager, {
      title: '企业产品经理',
      department: '企业服务产品部',
    })

    expect(state.hc_status).toBe('APPROVED')
    expect(state.hc_approval?.approval_id).toBe('HC-2026-EP-001')
    expect(state.stage).toBe('SUCCESS_CLARIFYING')
    expect(state.facts).toContainEqual(expect.objectContaining({
      category: 'HIRING_REASON',
      status: 'CONFIRMED',
      source: 'Mock HC 审批单 HC-2026-EP-001',
      evidence_refs: ['mock://hc/HC-2026-EP-001'],
    }))
    expect(evaluateRoleProfileGenerationReadiness(state)).toMatchObject({
      allowed: false,
      code: 'SUCCESS_CRITERION_REQUIRED',
    })
  })

  it('keeps an unmatched role pending while still allowing fact drafts', async () => {
    const intake = await service.createIntake(manager)
    const state = await service.updateRoleIdentityDraft(intake.state.id, manager, {
      title: '未配置的新岗位',
      department: '新业务部',
    })

    expect(state.hc_status).toBe('PENDING')
    expect(state.hc_approval).toBeUndefined()
    const drafted = await service.saveFactDraft(
      state.id,
      manager,
      '当前正在识别岗位与 HC 申请的匹配关系。',
      'BACKGROUND',
    )
    expect(drafted.facts.at(-1)?.status).toBe('DRAFT')
  })

  it('exposes pending and rejected HC states without confirming their reasons', async () => {
    const pendingIntake = await service.createIntake(manager)
    const pending = await service.updateRoleIdentityDraft(pendingIntake.state.id, manager, {
      title: 'AI 产品经理',
      department: 'AI 应用产品部',
    })
    expect(pending.hc_status).toBe('PENDING')
    expect(pending.hc_approval?.approval_id).toBe('HC-2026-AIPM-002')
    expect(pending.facts.some((fact) => fact.category === 'HIRING_REASON')).toBe(false)

    const rejectedIntake = await service.createIntake(manager)
    const rejected = await service.updateRoleIdentityDraft(rejectedIntake.state.id, manager, {
      title: '客户成功经理',
      department: '客户成功部',
    })
    expect(rejected.hc_status).toBe('REJECTED')
    expect(rejected.hc_approval?.approval_id).toBe('HC-2026-CS-003')
    expect(rejected.facts.some((fact) => fact.category === 'HIRING_REASON')).toBe(false)
  })
})
