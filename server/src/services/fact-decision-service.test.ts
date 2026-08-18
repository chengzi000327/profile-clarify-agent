import { beforeEach, describe, expect, it } from 'vitest'
import type { ActorContext } from '@role-clarifier/contracts'
import { MemoryStore } from '../store/memory-store.js'
import { DEMO_ROLE_SESSION_ID } from '../store/seed.js'
import { FactDecisionService } from './fact-decision-service.js'
import { RoleService } from './role-service.js'

const manager: ActorContext = {
  tenant_id: 'tenant-demo',
  user_id: 'manager-demo',
  role: 'MANAGER',
  display_name: '用人经理 · 陈曦',
}
const hr: ActorContext = {
  tenant_id: 'tenant-demo',
  user_id: 'hr-demo',
  role: 'HR',
  display_name: 'HR · 林夏',
}
const otherTenantManager: ActorContext = {
  ...manager,
  tenant_id: 'tenant-other',
  user_id: 'manager-other',
}

describe('FactDecisionService', () => {
  let store: MemoryStore
  let roleService: RoleService
  let service: FactDecisionService
  let factId: string
  let revision: number

  beforeEach(async () => {
    store = new MemoryStore()
    await store.initialize()
    roleService = new RoleService(store)
    const saved = await roleService.saveFactDraft(DEMO_ROLE_SESSION_ID, manager, {
      category: 'SUCCESS_CRITERION',
      statement: '入职 90 天完成产品路线图',
      source_message_id: 'message-test',
      source_run_id: 'run-test',
      proposed_by_user_id: manager.user_id,
    })
    factId = saved.fact.id
    revision = saved.state.revision
    service = new FactDecisionService(store, roleService)
  })

  it('经理确认事实并在一个提交中更新事实、产物和审计', async () => {
    const result = await service.decide(
      DEMO_ROLE_SESSION_ID,
      factId,
      manager,
      manager,
      { decision: 'CONFIRM', expected_revision: revision },
    )

    expect(result.state.facts.find((fact) => fact.id === factId)).toMatchObject({
      status: 'CONFIRMED',
      confirmed_by_user_id: manager.user_id,
    })
    expect(result.state.latest_artifacts.ROLE_PROFILE?.status).toBe('INVALIDATED')
    expect(result.state.latest_artifacts.ASSESSMENT_SCORECARD?.status).toBe('INVALIDATED')
    expect(result.invalidated_artifact_ids).toHaveLength(2)
    expect(store.listDecisionsForTest()).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'FACT_CONFIRMED', target_id: factId }),
      expect.objectContaining({ action: 'ARTIFACTS_INVALIDATED_BY_FACT', target_id: factId }),
    ]))
  })

  it('HR、跨租户和旧 Revision 不能改变事实', async () => {
    const request = { decision: 'CONFIRM' as const, expected_revision: revision }
    await expect(service.decide(DEMO_ROLE_SESSION_ID, factId, hr, hr, request))
      .rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(service.decide(
      DEMO_ROLE_SESSION_ID,
      factId,
      otherTenantManager,
      otherTenantManager,
      request,
    )).rejects.toMatchObject({ code: 'ROLE_SESSION_NOT_FOUND' })
    await expect(service.decide(
      DEMO_ROLE_SESSION_ID,
      factId,
      manager,
      manager,
      { ...request, expected_revision: revision - 1 },
    )).rejects.toMatchObject({ code: 'REVISION_CONFLICT' })
    expect(store.listDecisionsForTest()).toEqual([])
  })

  it('重复提交同一确认决定保持幂等，不重复增加 Revision 或审计', async () => {
    const request = { decision: 'CONFIRM' as const, expected_revision: revision }
    const first = await service.decide(DEMO_ROLE_SESSION_ID, factId, manager, manager, request)
    const auditCount = store.listDecisionsForTest().length
    const repeated = await service.decide(DEMO_ROLE_SESSION_ID, factId, manager, manager, request)

    expect(repeated.state.revision).toBe(first.state.revision)
    expect(store.listDecisionsForTest()).toHaveLength(auditCount)
  })

  it('旧批量接口先校验全部事实，只增加一次 Revision 且不会部分写入', async () => {
    const second = await roleService.saveFactDraft(DEMO_ROLE_SESSION_ID, manager, {
      category: 'CONSTRAINT',
      statement: '8 周内到岗',
      source_message_id: 'message-second',
      source_run_id: 'run-second',
      proposed_by_user_id: manager.user_id,
    })
    const before = second.state

    await expect(service.confirmBatch(
      DEMO_ROLE_SESSION_ID,
      [factId, 'missing-fact'],
      manager,
      manager,
      before.revision,
    )).rejects.toMatchObject({ code: 'FACT_NOT_FOUND' })
    const afterFailure = await roleService.get(DEMO_ROLE_SESSION_ID, manager)
    expect(afterFailure.state.revision).toBe(before.revision)
    expect(afterFailure.state.facts.find((fact) => fact.id === factId)?.status).toBe('DRAFT')

    const confirmed = await service.confirmBatch(
      DEMO_ROLE_SESSION_ID,
      [factId, second.fact.id],
      manager,
      manager,
      before.revision,
    )
    expect(confirmed.state.revision).toBe(before.revision + 1)
    expect(confirmed.state.facts.filter((fact) => [factId, second.fact.id].includes(fact.id)))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ id: factId, status: 'CONFIRMED' }),
        expect.objectContaining({ id: second.fact.id, status: 'CONFIRMED' }),
      ]))
  })
})
