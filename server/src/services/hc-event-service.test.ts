import { describe, expect, it } from 'vitest'
import { MemoryStore } from '../store/memory-store.js'
import { createMockHcContext } from '../store/seed.js'
import type { MockHrisHcApprovedEvent } from '../integrations/mock-hris.js'
import { HcEventService } from './hc-event-service.js'

const approvedEvent = (): MockHrisHcApprovedEvent => {
  const context = createMockHcContext({
    hiringManagerUserId: 'manager-demo',
    assignedHrUserId: 'hr-demo',
    department: '企业服务产品部',
  })
  context.request_id = 'HC-NEW-001'
  context.approved_at = '2026-08-18T02:00:00.000Z'
  return {
    event_id: 'evt-hc-new-001',
    event_type: 'HC_APPROVED',
    occurred_at: '2026-08-18T02:00:00.000Z',
    tenant_id: 'tenant-demo',
    hc: {
      request_id: 'HC-NEW-001',
      title: '企业产品经理',
      department: '企业服务产品部',
      hiring_manager_user_id: 'manager-demo',
      assigned_hr_user_id: 'hr-demo',
      context,
    },
  }
}

const createService = async (store = new MemoryStore()) => {
  await store.initialize()
  let sequence = 0
  const service = new HcEventService(
    store,
    () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`,
  )
  return { store, service }
}

const invalidMemberCases: Array<readonly [
  string,
  { tenant?: string; manager?: string; hr?: string },
]> = [
  ['未知经理', { manager: 'manager-missing' }],
  ['跨租户经理', { tenant: 'tenant-other' }],
  ['非经理指派', { manager: 'hr-demo' }],
  ['未知招聘伙伴', { hr: 'hr-missing' }],
  ['非 HR 指派', { hr: 'manager-demo' }],
]

describe('HC 审批事件闭环', () => {
  it('第一次 HC_APPROVED 同时创建审批、任务和一条飞书 Outbox', async () => {
    const { store, service } = await createService()
    const first = await service.accept(approvedEvent())

    expect(first).toEqual({ accepted: true, duplicate: false })
    expect(await store.getClarificationTaskByHc('tenant-demo', 'HC-NEW-001')).toMatchObject({
      assignee_user_id: 'manager-demo',
      status: 'OPEN',
    })
    expect(await store.listNotificationsForTest()).toHaveLength(1)
    expect((await store.listNotificationsForTest())[0]).toMatchObject({
      channel: 'FEISHU',
      recipient_user_id: 'manager-demo',
      status: 'PENDING',
    })
  })

  it('同一 event_id 重放不重复建任务或通知', async () => {
    const { store, service } = await createService()
    await service.accept(approvedEvent())
    const replay = await service.accept(approvedEvent())

    expect(replay).toEqual({ accepted: true, duplicate: true })
    expect(await store.listNotificationsForTest()).toHaveLength(1)
  })

  it('不同 event_id 重复上报同一 HC 也不重复业务提醒', async () => {
    const { store, service } = await createService()
    await service.accept(approvedEvent())
    await service.accept({ ...approvedEvent(), event_id: 'evt-hc-retry-with-new-id' })

    expect(await store.listNotificationsForTest()).toHaveLength(1)
  })

  it.each(invalidMemberCases)('%s 不得写入事件回执或业务数据', async (_label, override) => {
    const { store, service } = await createService()
    const event = approvedEvent()
    if (override.tenant) event.tenant_id = override.tenant
    if (override.manager) {
      event.hc.hiring_manager_user_id = override.manager
      event.hc.context.hiring_manager_user_id = override.manager
    }
    if (override.hr) {
      event.hc.assigned_hr_user_id = override.hr
      event.hc.context.assigned_hr_user_id = override.hr
    }

    await expect(service.accept(event)).rejects.toMatchObject({ code: 'HC_EVENT_MEMBER_INVALID' })
    expect(await store.getClarificationTaskByHc(event.tenant_id, event.hc.request_id)).toBeNull()
    expect(await store.listNotificationsForTest()).toHaveLength(0)

    const corrected = approvedEvent()
    corrected.event_id = event.event_id
    await expect(service.accept(corrected)).resolves.toEqual({ accepted: true, duplicate: false })
  })

  it.each(['request_id', 'hiring_manager_user_id', 'assigned_hr_user_id'] as const)(
    'HC 与 context 的 %s 不一致时拒绝且不落库',
    async (field) => {
      const { store, service } = await createService()
      const event = approvedEvent()
      if (field === 'request_id') event.hc.context.request_id = 'HC-MISMATCH'
      if (field === 'hiring_manager_user_id') {
        event.hc.context.hiring_manager_user_id = 'manager-mismatch'
      }
      if (field === 'assigned_hr_user_id') event.hc.context.assigned_hr_user_id = 'hr-mismatch'

      await expect(service.accept(event)).rejects.toBeTruthy()
      expect(await store.getClarificationTaskByHc('tenant-demo', 'HC-NEW-001')).toBeNull()
      expect(await store.listNotificationsForTest()).toHaveLength(0)
    },
  )

  it('Outbox 写入前失败时审批和任务也全部回滚', async () => {
    class FailingMemoryStore extends MemoryStore {
      protected override beforeNotificationInsert(): void {
        throw new Error('TEST_OUTBOX_FAILURE')
      }
    }
    const { store, service } = await createService(new FailingMemoryStore())

    await expect(service.accept(approvedEvent())).rejects.toThrow('TEST_OUTBOX_FAILURE')
    expect(await store.getClarificationTaskByHc('tenant-demo', 'HC-NEW-001')).toBeNull()
    expect(await store.listNotificationsForTest()).toHaveLength(0)
    expect(await store.getHcApproval('HC-NEW-001', {
      tenant_id: 'tenant-demo',
      user_id: 'manager-demo',
      role: 'MANAGER',
      display_name: '用人经理',
    })).toBeNull()
  })
})
