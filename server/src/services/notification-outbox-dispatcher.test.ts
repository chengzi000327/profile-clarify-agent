import { describe, expect, it } from 'vitest'
import { loadConfig } from '../config.js'
import type { FeishuClientLike } from '../integrations/feishu.js'
import { HcEventService } from './hc-event-service.js'
import { MemoryStore } from '../store/memory-store.js'
import { createMockHcContext } from '../store/seed.js'
import { NotificationOutboxDispatcher } from './notification-outbox-dispatcher.js'

const taskId = '10000000-0000-4000-8000-000000000001'
const notificationId = '10000000-0000-4000-8000-000000000002'

class FakeClock {
  constructor(private value = '2026-08-18T02:00:00.000Z') {}

  now = (): string => this.value

  advance(milliseconds: number): void {
    this.value = new Date(Date.parse(this.value) + milliseconds).toISOString()
  }
}

class FakeFeishuSender implements FeishuClientLike {
  readonly cards: Array<{ openId: string; card: Record<string, unknown> }> = []
  errorCode: string | null = null

  configured(): boolean { return true }
  async sendText(): Promise<void> {}
  async sendCard(): Promise<void> {}
  async sendCardToOpenId(openId: string, card: Record<string, unknown>): Promise<void> {
    if (this.errorCode) throw Object.assign(new Error('delivery failed'), { code: this.errorCode })
    this.cards.push({ openId, card })
  }
}

const config = loadConfig({
  NODE_ENV: 'test',
  SESSION_SECRET: 'test-session-secret-that-is-long-enough',
  WEB_ORIGIN: 'https://roles.example.test',
  NOTIFICATION_DISPATCH_ENABLED: 'false',
  NOTIFICATION_BATCH_SIZE: '20',
  NOTIFICATION_LEASE_MS: '30000',
})

const createStoreWithNotification = async () => {
  const store = new MemoryStore()
  await store.initialize()
  const context = createMockHcContext({
    hiringManagerUserId: 'manager-demo',
    assignedHrUserId: 'hr-demo',
  })
  context.request_id = 'HC-NOTIFY-001'
  context.approved_at = '2026-08-18T02:00:00.000Z'
  const ids = [taskId, notificationId]
  await new HcEventService(store, () => ids.shift()!).accept({
    event_id: 'evt-notify-001',
    event_type: 'HC_APPROVED',
    occurred_at: context.approved_at,
    tenant_id: 'tenant-demo',
    hc: {
      request_id: context.request_id,
      title: '企业产品经理',
      department: '企业服务产品部',
      hiring_manager_user_id: 'manager-demo',
      assigned_hr_user_id: 'hr-demo',
      context,
    },
  })
  return store
}

const activeBinding = {
  tenant_id: 'tenant-demo',
  user_id: 'manager-demo',
  channel: 'FEISHU' as const,
  recipient_type: 'OPEN_ID' as const,
  recipient_id: 'ou_manager_demo',
  status: 'ACTIVE' as const,
  verified_at: '2026-08-18T02:00:00.000Z',
  updated_at: '2026-08-18T02:00:00.000Z',
}

describe('飞书主动提醒 Outbox', () => {
  it('有绑定时按 open_id 发送一次并标记 SENT', async () => {
    const store = await createStoreWithNotification()
    await store.upsertUserChannelBinding(activeBinding)
    const sender = new FakeFeishuSender()
    const clock = new FakeClock()
    const dispatcher = new NotificationOutboxDispatcher(store, sender, config, clock, 'worker-a')

    await dispatcher.dispatchOnce()

    expect(sender.cards).toHaveLength(1)
    expect(sender.cards[0]?.openId).toBe('ou_manager_demo')
    expect(JSON.stringify(sender.cards[0]?.card)).toContain('企业产品经理')
    expect(JSON.stringify(sender.cards[0]?.card)).toContain('https://roles.example.test')
    expect((await store.getNotification(notificationId))?.status).toBe('SENT')
  })

  it('无绑定标记 UNBOUND，绑定后按 1/5/30 分钟技术重试并最终 DEAD', async () => {
    const store = await createStoreWithNotification()
    const sender = new FakeFeishuSender()
    const clock = new FakeClock()
    const dispatcher = new NotificationOutboxDispatcher(store, sender, config, clock, 'worker-a')

    await dispatcher.dispatchOnce()
    expect((await store.getNotification(notificationId))?.status).toBe('UNBOUND')

    await store.upsertUserChannelBinding(activeBinding)
    expect(await store.requeueUnboundNotificationsForUser(
      'tenant-demo',
      'manager-demo',
      clock.now(),
    )).toBe(1)
    sender.errorCode = 'FEISHU_RATE_LIMITED'

    const delays = [60_000, 300_000, 1_800_000]
    for (const delay of delays) {
      const before = clock.now()
      await dispatcher.dispatchOnce()
      const notification = await store.getNotification(notificationId)
      expect(notification).toMatchObject({ status: 'RETRY', last_error_code: 'FEISHU_RATE_LIMITED' })
      expect(Date.parse(notification!.next_attempt_at) - Date.parse(before)).toBe(delay)
      clock.advance(delay)
    }
    await dispatcher.dispatchOnce()
    expect(await store.getNotification(notificationId)).toMatchObject({
      status: 'DEAD',
      attempt_count: 4,
      last_error_code: 'FEISHU_RATE_LIMITED',
    })
  })

  it('租约阻止并发重复发送，过期后允许其他 worker 接管', async () => {
    const store = await createStoreWithNotification()
    const clock = new FakeClock()
    const first = await store.claimDueNotifications({
      worker_id: 'worker-a',
      now: clock.now(),
      locked_until: '2026-08-18T02:00:30.000Z',
      limit: 20,
    })
    const blocked = await store.claimDueNotifications({
      worker_id: 'worker-b',
      now: clock.now(),
      locked_until: '2026-08-18T02:00:30.000Z',
      limit: 20,
    })
    clock.advance(31_000)
    const reclaimed = await store.claimDueNotifications({
      worker_id: 'worker-b',
      now: clock.now(),
      locked_until: '2026-08-18T02:01:01.000Z',
      limit: 20,
    })

    expect(first).toHaveLength(1)
    expect(blocked).toEqual([])
    expect(reclaimed).toHaveLength(1)
    expect(reclaimed[0]?.attempt_count).toBe(2)
  })
})
