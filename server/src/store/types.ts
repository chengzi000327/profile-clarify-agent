import type {
  ActorContext,
  AgentEvent,
  AgentRun,
  ArtifactEnvelope,
  CandidateEvidence,
  ClarificationPolicy,
  ClarificationRound,
  ConversationMessage,
  EnterpriseKnowledgeItem,
  HcApproval,
  RoleState,
} from '@role-clarifier/contracts'
import type {
  ApprovedHcIngestion,
  NotificationClaim,
  NotificationFailureUpdate,
  NotificationOutboxRecord,
  NotificationRetryUpdate,
  UserChannelBindingRecord,
} from './closure-types.js'

export interface StoredUser extends ActorContext {
  active: boolean
}

export interface CalibrationSignalRecord {
  id: string
  role_session_id: string
  status: 'HR_REVIEW' | 'DISMISSED' | 'MANAGER_REVIEW' | 'ACCEPTED' | 'REJECTED'
  proposed_change: Record<string, unknown>
  evidence_summary: Record<string, unknown>
  reviewed_by: string | null
  review_reason: string | null
  created_at: string
  updated_at: string
}

export interface ManagerTaskRecord {
  id: string
  role_session_id: string
  signal_id: string
  assignee_user_id: string
  status: 'OPEN' | 'ACCEPTED' | 'REJECTED'
  decision_reason: string | null
  due_at: string
  created_at: string
  completed_at: string | null
}

export interface DecisionRecord {
  id: string
  role_session_id: string
  actor_user_id: string
  action: string
  target_type: string
  target_id: string
  metadata: Record<string, unknown>
  created_at: string
}

export interface RoleAggregate {
  state: RoleState
  member_ids: string[]
  artifacts: ArtifactEnvelope[]
  candidates: CandidateEvidence[]
  calibration_signals: CalibrationSignalRecord[]
  manager_tasks: ManagerTaskRecord[]
}

export interface RoleAggregateReadOptions {
  members?: boolean
  artifacts?: boolean
  candidates?: boolean
  calibration_signals?: boolean
  manager_tasks?: boolean
}

export interface RunRecord {
  run: AgentRun
  cancel_requested: boolean
}

export interface AdminRunRecord extends RunRecord {
  role_title: string
  actor_display_name: string
  actor_role: ActorContext['role']
}

export interface AdminRunFilters {
  status?: AgentRun['status']
  model_tier?: AgentRun['model_tier']
  role_session_id?: string
  query?: string
  page: number
  page_size: number
}

export interface AdminRunPage {
  items: AdminRunRecord[]
  total: number
  page: number
  page_size: number
}

export interface TraceAccessAuditRecord {
  id: string
  tenant_id: string
  actor_user_id: string
  run_id: string
  action: 'VIEW' | 'EXPORT'
  reason: string | null
  created_at: string
}

export interface EnterpriseKnowledgeQuery {
  tenant_id: string
  visible_to: EnterpriseKnowledgeItem['visible_to'][]
  categories: EnterpriseKnowledgeItem['category'][]
  now: string
}

export type EventSubscriber = (event: AgentEvent) => void

export interface ApplicationStore {
  initialize(): Promise<void>
  close(): Promise<void>
  getUser(userId: string): Promise<StoredUser | null>
  saveUser(user: StoredUser): Promise<void>
  claimExternalEvent(channel: string, eventId: string): Promise<boolean>
  ingestApprovedHcClosure(input: ApprovedHcIngestion): Promise<{ inserted: boolean }>
  claimDueNotifications(input: NotificationClaim): Promise<NotificationOutboxRecord[]>
  getNotification(id: string): Promise<NotificationOutboxRecord | null>
  getUserChannelBinding(
    tenantId: string,
    userId: string,
    channel: 'FEISHU',
  ): Promise<UserChannelBindingRecord | null>
  upsertUserChannelBinding(binding: UserChannelBindingRecord): Promise<void>
  requeueUnboundNotificationsForUser(
    tenantId: string,
    userId: string,
    nextAttemptAt: string,
  ): Promise<number>
  markNotificationSent(id: string, workerId: string, sentAt: string): Promise<void>
  markNotificationRetry(input: NotificationRetryUpdate): Promise<void>
  markNotificationUnbound(id: string, workerId: string, updatedAt: string): Promise<void>
  markNotificationDead(input: NotificationFailureUpdate): Promise<void>
  listEnterpriseKnowledge(input: EnterpriseKnowledgeQuery): Promise<EnterpriseKnowledgeItem[]>
  listHcApprovals(actor: ActorContext): Promise<HcApproval[]>
  getHcApproval(requestId: string, actor: ActorContext): Promise<HcApproval | null>
  createRoleAggregateForHc(hcRequestId: string, aggregate: RoleAggregate): Promise<string>
  listRoleStates(actor: ActorContext): Promise<RoleState[]>
  getRoleAggregate(
    roleSessionId: string,
    actor: ActorContext,
    options?: RoleAggregateReadOptions,
  ): Promise<RoleAggregate | null>
  createRoleAggregate(aggregate: RoleAggregate): Promise<void>
  saveRoleState(state: RoleState, expectedRevision: number): Promise<boolean>
  insertArtifact(artifact: ArtifactEnvelope): Promise<void>
  updateArtifact(artifact: ArtifactEnvelope): Promise<void>
  insertCandidates(
    roleSessionId: string,
    candidates: CandidateEvidence[],
    actorUserId: string,
  ): Promise<void>
  insertCalibrationSignal(signal: CalibrationSignalRecord): Promise<void>
  updateCalibrationSignal(signal: CalibrationSignalRecord): Promise<void>
  insertManagerTask(task: ManagerTaskRecord): Promise<void>
  updateManagerTask(task: ManagerTaskRecord): Promise<void>
  appendDecision(record: DecisionRecord): Promise<void>
  createRun(run: AgentRun): Promise<void>
  getRun(runId: string): Promise<RunRecord | null>
  listActiveRuns(): Promise<RunRecord[]>
  findActiveRunByRole(roleSessionId: string): Promise<RunRecord | null>
  updateRun(run: AgentRun): Promise<void>
  requestRunCancel(runId: string): Promise<boolean>
  appendRunEvent(event: AgentEvent): Promise<void>
  listRunEvents(runId: string, afterSequence?: number): Promise<AgentEvent[]>
  subscribeToRun(runId: string, subscriber: EventSubscriber): () => void
  listConversationMessages(roleSessionId: string, afterSequence?: number): Promise<ConversationMessage[]>
  appendConversationMessage(message: ConversationMessage): Promise<void>
  appendConversationMessageIfAbsent(message: ConversationMessage): Promise<boolean>
  updateConversationMessage(message: ConversationMessage): Promise<void>
  getClarificationPolicy(roleSessionId: string): Promise<ClarificationPolicy>
  saveClarificationPolicy(policy: ClarificationPolicy): Promise<void>
  getOpenClarificationRound(roleSessionId: string): Promise<ClarificationRound | null>
  insertClarificationRound(round: ClarificationRound): Promise<void>
  updateClarificationRound(round: ClarificationRound): Promise<void>
  listRunsForTenant(tenantId: string, filters: AdminRunFilters): Promise<AdminRunPage>
  appendTraceAccessAudit(record: TraceAccessAuditRecord): Promise<void>
  listTraceAccessAudits(tenantId: string): Promise<TraceAccessAuditRecord[]>
}
