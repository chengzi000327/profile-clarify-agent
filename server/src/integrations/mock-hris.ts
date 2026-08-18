import { HcContextSchema } from '@role-clarifier/contracts'
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
})

export type MockHrisHcApprovedEvent = z.infer<typeof MockHrisHcApprovedEventSchema>
