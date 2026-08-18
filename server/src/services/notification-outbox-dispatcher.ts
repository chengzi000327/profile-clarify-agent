import { randomUUID } from 'node:crypto'
import type { AppConfig } from '../config.js'
import type { FeishuCard, FeishuClientLike } from '../integrations/feishu.js'
import type { NotificationDeliveryErrorCode } from '../store/closure-types.js'
import type { ApplicationStore } from '../store/types.js'

const RETRY_DELAYS_MS = [60_000, 300_000, 1_800_000] as const
const deliveryErrorCodes = new Set<NotificationDeliveryErrorCode>([
  'FEISHU_RATE_LIMITED',
  'FEISHU_AUTH_FAILED',
  'FEISHU_UNAVAILABLE',
  'UNKNOWN_DELIVERY_ERROR',
])

export interface NotificationClock {
  now(): string
}

const stringField = (payload: Record<string, unknown>, key: string): string =>
  typeof payload[key] === 'string' ? payload[key].trim() : ''

export const buildHcClarificationCard = (
  payload: Record<string, unknown>,
  webOrigin: string,
): FeishuCard => {
  const title = stringField(payload, 'title')
  const department = stringField(payload, 'department')
  const requestId = stringField(payload, 'hc_request_id')
  const reason = stringField(payload, 'approved_reason').slice(0, 120)
  return {
    config: { wide_screen_mode: true },
    header: {
      template: 'blue',
      title: { tag: 'plain_text', content: 'HC 已审批，请完成岗位画像澄清' },
    },
    elements: [
      {
        tag: 'markdown',
        content: `**岗位**：${title}\n**部门**：${department}\n**HC 编号**：${requestId}\n**审批原因**：${reason}`,
      },
      {
        tag: 'action',
        actions: [{
          tag: 'button',
          text: { tag: 'plain_text', content: '进入岗位工作台' },
          type: 'primary',
          url: webOrigin,
        }],
      },
    ],
  }
}

export const deliveryErrorCode = (error: unknown): NotificationDeliveryErrorCode => {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = String((error as { code: unknown }).code) as NotificationDeliveryErrorCode
    if (deliveryErrorCodes.has(code)) return code
  }
  return 'UNKNOWN_DELIVERY_ERROR'
}

export class NotificationOutboxDispatcher {
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(
    private readonly store: ApplicationStore,
    private readonly sender: Pick<FeishuClientLike, 'sendCardToOpenId'>,
    private readonly config: AppConfig,
    private readonly clock: NotificationClock = { now: () => new Date().toISOString() },
    private readonly workerId = `notification-${randomUUID()}`,
  ) {}

  start(): void {
    if (this.timer || !this.config.NOTIFICATION_DISPATCH_ENABLED) return
    this.timer = setInterval(
      () => void this.dispatchOnce().catch(() => undefined),
      this.config.NOTIFICATION_POLL_INTERVAL_MS,
    )
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  async dispatchOnce(): Promise<void> {
    const now = this.clock.now()
    const lockedUntil = new Date(
      Date.parse(now) + this.config.NOTIFICATION_LEASE_MS,
    ).toISOString()
    const items = await this.store.claimDueNotifications({
      worker_id: this.workerId,
      now,
      locked_until: lockedUntil,
      limit: this.config.NOTIFICATION_BATCH_SIZE,
    })
    for (const item of items) {
      const binding = await this.store.getUserChannelBinding(
        item.tenant_id,
        item.recipient_user_id,
        'FEISHU',
      )
      if (!binding || binding.status !== 'ACTIVE') {
        await this.store.markNotificationUnbound(item.id, this.workerId, now)
        continue
      }
      try {
        await this.sender.sendCardToOpenId(
          binding.recipient_id,
          buildHcClarificationCard(item.payload, this.config.WEB_ORIGIN),
        )
        await this.store.markNotificationSent(item.id, this.workerId, now)
      } catch (error) {
        const errorCode = deliveryErrorCode(error)
        if (item.attempt_count >= 4) {
          await this.store.markNotificationDead({
            id: item.id,
            worker_id: this.workerId,
            error_code: errorCode,
            updated_at: now,
          })
        } else {
          const delay = RETRY_DELAYS_MS[item.attempt_count - 1]!
          await this.store.markNotificationRetry({
            id: item.id,
            worker_id: this.workerId,
            error_code: errorCode,
            next_attempt_at: new Date(Date.parse(now) + delay).toISOString(),
            updated_at: now,
          })
        }
      }
    }
  }
}
