import { beforeEach, describe, expect, it } from 'vitest'
import type { ActorContext } from '@role-clarifier/contracts'
import { MemoryStore } from '../store/memory-store.js'
import { mockHcRecords, seedMockHcApprovals } from '../store/mock-hc-fixtures.js'
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

  it('provides ten product, engineering, and algorithm HC fixtures', () => {
    expect(mockHcRecords).toHaveLength(10)
    expect(mockHcRecords.filter((record) => record.content.approval_status === 'APPROVED')).toHaveLength(6)
    expect(mockHcRecords.filter((record) => record.content.approval_status === 'PENDING')).toHaveLength(2)
    expect(mockHcRecords.filter((record) => record.content.approval_status === 'REJECTED')).toHaveLength(2)
    expect(mockHcRecords.every((record) =>
      /产品|研发|工程|算法/.test(`${record.role_title}${record.team_id}`),
    )).toBe(true)
    expect(mockHcRecords.every((record) =>
      typeof record.content.hiring_reason === 'string'
      && record.content.hiring_reason.length >= 20
      && typeof record.content.business_goal === 'string'
      && record.content.business_goal.length >= 15,
    )).toBe(true)
  })

  it('matches an approved HC after role identity is recognized', async () => {
    const intake = await service.createIntake(manager)
    expect(intake.state.hc_status).toBe('PENDING')
    const drafted = await service.saveFactDraft(
      intake.state.id,
      manager,
      '会话里推测的招聘原因，后续应由 HC 审批单覆盖。',
      'HIRING_REASON',
    )

    const state = await service.updateRoleIdentityDraft(drafted.id, manager, {
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
    expect(state.facts).toContainEqual(expect.objectContaining({
      statement: '会话里推测的招聘原因，后续应由 HC 审批单覆盖。',
      status: 'STALE',
    }))
    expect(state.facts.filter((fact) =>
      fact.category === 'HIRING_REASON' && fact.status === 'CONFIRMED',
    )).toHaveLength(1)
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

  it('exposes approved, pending, and rejected HC states correctly', async () => {
    const approvedIntake = await service.createIntake(manager)
    const approved = await service.updateRoleIdentityDraft(approvedIntake.state.id, manager, {
      title: 'AI 产品经理',
      department: 'AI 应用产品部',
    })
    expect(approved.hc_status).toBe('APPROVED')
    expect(approved.hc_approval?.approval_id).toBe('HC-2026-AIPM-002')
    expect(approved.facts.some((fact) =>
      fact.category === 'HIRING_REASON' && fact.status === 'CONFIRMED',
    )).toBe(true)

    const pendingIntake = await service.createIntake(manager)
    const pending = await service.updateRoleIdentityDraft(pendingIntake.state.id, manager, {
      title: '前端研发工程师',
      department: '用户体验研发部',
    })
    expect(pending.hc_status).toBe('PENDING')
    expect(pending.hc_approval?.approval_id).toBe('HC-2026-FE-006')
    expect(pending.facts.some((fact) => fact.category === 'HIRING_REASON')).toBe(false)

    const rejectedIntake = await service.createIntake(manager)
    const rejected = await service.updateRoleIdentityDraft(rejectedIntake.state.id, manager, {
      title: '后端研发工程师',
      department: '核心服务研发部',
    })
    expect(rejected.hc_status).toBe('REJECTED')
    expect(rejected.hc_approval?.approval_id).toBe('HC-2026-CS-003')
    expect(rejected.facts.some((fact) => fact.category === 'HIRING_REASON')).toBe(false)
  })
})
