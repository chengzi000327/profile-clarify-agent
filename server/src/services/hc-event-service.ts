import { randomUUID } from 'node:crypto'
import { DomainError } from '@role-clarifier/domain'
import {
  MockHrisHcApprovedEventSchema,
  type MockHrisHcApprovedEvent,
} from '../integrations/mock-hris.js'
import type { ApplicationStore } from '../store/types.js'

export class HcEventService {
  constructor(
    private readonly store: ApplicationStore,
    private readonly createId: () => string = randomUUID,
  ) {}

  async accept(rawEvent: MockHrisHcApprovedEvent | unknown) {
    const event = MockHrisHcApprovedEventSchema.parse(rawEvent)
    const [manager, assignedHr] = await Promise.all([
      this.store.getUser(event.hc.hiring_manager_user_id),
      this.store.getUser(event.hc.assigned_hr_user_id),
    ])
    if (
      !manager ||
      !manager.active ||
      manager.tenant_id !== event.tenant_id ||
      manager.role !== 'MANAGER' ||
      !assignedHr ||
      !assignedHr.active ||
      assignedHr.tenant_id !== event.tenant_id ||
      assignedHr.role !== 'HR'
    ) {
      throw new DomainError(
        'HC_EVENT_MEMBER_INVALID',
        'HC 审批中的用人经理或招聘伙伴无效',
        422,
      )
    }

    const timestamp = event.occurred_at
    const taskId = this.createId()
    const notificationId = this.createId()
    const { inserted } = await this.store.ingestApprovedHcClosure({
      external_event_channel: 'MOCK_HRIS',
      external_event_id: event.event_id,
      approval: {
        request_id: event.hc.request_id,
        tenant_id: event.tenant_id,
        title: event.hc.title,
        department: event.hc.department,
        status: 'APPROVED',
        context: event.hc.context,
        role_session_id: null,
        clarification_status: 'NOT_STARTED',
        role_stage: null,
        clarification_task: null,
        notification_delivery: null,
        created_at: timestamp,
        updated_at: timestamp,
      },
      task: {
        id: taskId,
        tenant_id: event.tenant_id,
        hc_request_id: event.hc.request_id,
        role_session_id: null,
        assignee_user_id: event.hc.hiring_manager_user_id,
        status: 'OPEN',
        due_at: null,
        started_at: null,
        completed_at: null,
        created_at: timestamp,
        updated_at: timestamp,
      },
      notification: {
        id: notificationId,
        tenant_id: event.tenant_id,
        dedupe_key: `HC_CLARIFICATION_ASSIGNED:${event.tenant_id}:${event.hc.request_id}:${event.hc.hiring_manager_user_id}`,
        channel: 'FEISHU',
        recipient_user_id: event.hc.hiring_manager_user_id,
        template: 'HC_CLARIFICATION_ASSIGNED',
        payload: {
          hc_request_id: event.hc.request_id,
          title: event.hc.title,
          department: event.hc.department,
          approved_reason: event.hc.context.approved_reason,
        },
        status: 'PENDING',
        attempt_count: 0,
        next_attempt_at: timestamp,
        locked_by: null,
        locked_until: null,
        last_error_code: null,
        sent_at: null,
        created_at: timestamp,
        updated_at: timestamp,
      },
    })
    return { accepted: true as const, duplicate: !inserted }
  }
}
