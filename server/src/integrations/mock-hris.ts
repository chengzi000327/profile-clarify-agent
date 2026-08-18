import { createHmac, timingSafeEqual } from 'node:crypto'
import { HcContextSchema } from '@role-clarifier/contracts'
import { canonicalJson, DomainError } from '@role-clarifier/domain'
import { z } from 'zod'

export const MockHrisHcApprovedEventSchema = z.object({
  event_id: z.string().min(1),
  event_type: z.literal('HC_APPROVED'),
  occurred_at: z.string().datetime(),
  tenant_id: z.string().min(1),
  hc: z.object({
    request_id: z.string().min(1),
    title: z.string().min(1),
    department: z.string().min(1),
    hiring_manager_user_id: z.string().min(1),
    assigned_hr_user_id: z.string().min(1),
    context: HcContextSchema,
  }).strict(),
}).strict().superRefine((event, context) => {
  const comparisons = [
    ['request_id', event.hc.request_id, event.hc.context.request_id],
    [
      'hiring_manager_user_id',
      event.hc.hiring_manager_user_id,
      event.hc.context.hiring_manager_user_id,
    ],
    [
      'assigned_hr_user_id',
      event.hc.assigned_hr_user_id,
      event.hc.context.assigned_hr_user_id,
    ],
  ] as const
  for (const [field, outer, inner] of comparisons) {
    if (outer !== inner) {
      context.addIssue({
        code: 'custom',
        path: ['hc', 'context', field],
        message: `${field} 与 HC 事件外层字段不一致`,
      })
    }
  }
  if (event.occurred_at !== event.hc.context.approved_at) {
    context.addIssue({
      code: 'custom',
      path: ['hc', 'context', 'approved_at'],
      message: 'approved_at 与事件发生时间不一致',
    })
  }
})

export type MockHrisHcApprovedEvent = z.infer<typeof MockHrisHcApprovedEventSchema>

export const signMockHrisEvent = (
  secret: string,
  timestamp: string,
  body: unknown,
): string => createHmac('sha256', secret)
  .update(`${timestamp}.${canonicalJson(body)}`)
  .digest('hex')

export const verifyMockHrisEvent = (input: {
  secret: string
  timestamp: string
  signature: string
  body: unknown
  nowMs: number
  maxSkewSeconds: number
}): MockHrisHcApprovedEvent => {
  const eventMs = Date.parse(input.timestamp)
  if (
    !Number.isFinite(eventMs) ||
    Math.abs(input.nowMs - eventMs) > input.maxSkewSeconds * 1_000
  ) {
    throw new DomainError('HC_EVENT_EXPIRED', 'HC 事件时间戳无效或已过期', 401)
  }
  const expected = signMockHrisEvent(input.secret, input.timestamp, input.body)
  if (
    expected.length !== input.signature.length ||
    !timingSafeEqual(Buffer.from(expected), Buffer.from(input.signature))
  ) {
    throw new DomainError('HC_EVENT_UNAUTHORIZED', 'HC 事件签名无效', 401)
  }
  return MockHrisHcApprovedEventSchema.parse(input.body)
}
