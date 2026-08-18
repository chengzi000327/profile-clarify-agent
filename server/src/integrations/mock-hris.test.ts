import { describe, expect, it } from 'vitest'
import { createMockHcContext } from '../store/seed.js'
import {
  signMockHrisEvent,
  verifyMockHrisEvent,
  type MockHrisHcApprovedEvent,
} from './mock-hris.js'

const secret = 'test-hc-event-secret-that-is-at-least-32-characters'
const nowMs = Date.parse('2026-08-18T02:00:00.000Z')

const event = (): MockHrisHcApprovedEvent => {
  const context = createMockHcContext({
    hiringManagerUserId: 'manager-demo',
    assignedHrUserId: 'hr-demo',
  })
  context.request_id = 'HC-SIGNED-001'
  context.approved_at = '2026-08-18T02:00:00.000Z'
  return {
    event_id: 'evt-signed-001',
    event_type: 'HC_APPROVED',
    occurred_at: '2026-08-18T02:00:00.000Z',
    tenant_id: 'tenant-demo',
    hc: {
      request_id: 'HC-SIGNED-001',
      title: '企业产品经理',
      department: '企业服务产品部',
      hiring_manager_user_id: 'manager-demo',
      assigned_hr_user_id: 'hr-demo',
      context,
    },
  }
}

describe('Mock HRIS HMAC', () => {
  it('对象键顺序不同仍生成同一签名并通过校验', () => {
    const body = event()
    const { hc, tenant_id: tenantId, ...rest } = body
    const reordered = { hc, tenant_id: tenantId, ...rest }
    const timestamp = '2026-08-18T02:00:00.000Z'
    const signature = signMockHrisEvent(secret, timestamp, body)

    expect(signMockHrisEvent(secret, timestamp, reordered)).toBe(signature)
    expect(verifyMockHrisEvent({
      secret,
      timestamp,
      signature,
      body,
      nowMs,
      maxSkewSeconds: 300,
    })).toMatchObject({ event_id: 'evt-signed-001' })
  })

  it('过期时间戳和错误签名均被拒绝', () => {
    const body = event()
    expect(() => verifyMockHrisEvent({
      secret,
      timestamp: '2026-08-18T01:00:00.000Z',
      signature: signMockHrisEvent(secret, '2026-08-18T01:00:00.000Z', body),
      body,
      nowMs,
      maxSkewSeconds: 300,
    })).toThrow(expect.objectContaining({ code: 'HC_EVENT_EXPIRED' }))

    expect(() => verifyMockHrisEvent({
      secret,
      timestamp: '2026-08-18T02:00:00.000Z',
      signature: 'bad',
      body,
      nowMs,
      maxSkewSeconds: 300,
    })).toThrow(expect.objectContaining({ code: 'HC_EVENT_UNAUTHORIZED' }))
  })
})
