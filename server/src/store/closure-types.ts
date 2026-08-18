import type {
  ArtifactEnvelope,
  HcApproval,
  RoleState,
} from '@role-clarifier/contracts'
import type { DecisionRecord } from './types.js'

export interface RoleClarificationTaskRecord {
  id: string
  tenant_id: string
  hc_request_id: string
  role_session_id: string | null
  assignee_user_id: string
  status: 'OPEN' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED'
  due_at: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

export interface NotificationOutboxRecord {
  id: string
  tenant_id: string
  task_id: string
  dedupe_key: string
  channel: 'FEISHU'
  recipient_user_id: string
  template: 'HC_CLARIFICATION_ASSIGNED'
  payload: Record<string, unknown>
  status: 'PENDING' | 'PROCESSING' | 'SENT' | 'RETRY' | 'UNBOUND' | 'DEAD'
  attempt_count: number
  next_attempt_at: string
  locked_by: string | null
  locked_until: string | null
  last_error_code: string | null
  sent_at: string | null
  created_at: string
  updated_at: string
}

export interface UserChannelBindingRecord {
  tenant_id: string
  user_id: string
  channel: 'FEISHU'
  recipient_type: 'OPEN_ID'
  recipient_id: string
  status: 'ACTIVE' | 'REVOKED'
  verified_at: string
  updated_at: string
}

export interface ApprovedHcIngestion {
  external_event_channel: 'MOCK_HRIS'
  external_event_id: string
  approval: HcApproval
  task: RoleClarificationTaskRecord
  notification: Omit<NotificationOutboxRecord, 'task_id'>
}

export interface NotificationClaim {
  worker_id: string
  now: string
  locked_until: string
  limit: number
}

export interface FactDecisionCommit {
  role_session_id: string
  tenant_id: string
  expected_revision: number
  state: RoleState
  artifacts: ArtifactEnvelope[]
  decisions: DecisionRecord[]
}
