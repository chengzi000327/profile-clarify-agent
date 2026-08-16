import type {
  ActorContext,
  AgentEvent,
  AgentRun,
  ArtifactEnvelope,
  CandidateEvidence,
  ClarificationPolicy,
  ClarificationRound,
  ConversationMessage,
  RoleState,
} from '@role-clarifier/contracts'

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

export interface TraceAccessAuditRecord {
  id: string
  tenant_id: string
  actor_user_id: string
  run_id: string
  action: 'VIEW' | 'EXPORT'
  reason: string | null
  created_at: string
}

export const RECRUITING_CONTEXT_RECORD_TYPES = [
  'ORGANIZATION_UNIT',
  'EMPLOYEE',
  'PARTICIPANT_PERSONA',
  'HISTORICAL_ROLE_SESSION',
  'CLARIFICATION_MESSAGE',
  'RECRUITING_FUNNEL',
  'MARKET_JD_REFERENCE',
  'DATA_DICTIONARY',
  'SOURCE_METADATA',
] as const

export type RecruitingContextRecordType = (typeof RECRUITING_CONTEXT_RECORD_TYPES)[number]

export interface RecruitingContextImport {
  id: string
  tenant_id: string
  source_revision: string
  source_file: string
  excluded_sheets: string[]
  record_counts: Record<string, number>
  imported_at: string
}

export interface RecruitingContextRecord {
  tenant_id: string
  record_type: RecruitingContextRecordType
  external_id: string
  team_id: string | null
  role_title: string | null
  conversation_id: string | null
  source_system: string
  data_classification: string
  effective_at: string | null
  content: Record<string, unknown>
  import_id: string
}

export interface RecruitingContextQuery {
  record_types: RecruitingContextRecordType[]
  team_id?: string
  role_title?: string
  limit?: number
}

export type EventSubscriber = (event: AgentEvent) => void

export interface ApplicationStore {
  initialize(): Promise<void>
  close(): Promise<void>
  getUser(userId: string): Promise<StoredUser | null>
  saveUser(user: StoredUser): Promise<void>
  claimExternalEvent(channel: string, eventId: string): Promise<boolean>
  listRoleStates(actor: ActorContext): Promise<RoleState[]>
  listTenantRoleStates(tenantId: string): Promise<RoleState[]>
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
  listConversationMessagesForActor(
    roleSessionId: string,
    actorUserId: string,
    afterSequence?: number,
  ): Promise<ConversationMessage[]>
  appendConversationMessage(message: ConversationMessage): Promise<void>
  updateConversationMessage(message: ConversationMessage): Promise<void>
  getClarificationPolicy(roleSessionId: string): Promise<ClarificationPolicy>
  saveClarificationPolicy(policy: ClarificationPolicy): Promise<void>
  getOpenClarificationRound(
    roleSessionId: string,
    actorUserId: string,
  ): Promise<ClarificationRound | null>
  insertClarificationRound(round: ClarificationRound): Promise<void>
  updateClarificationRound(round: ClarificationRound): Promise<void>
  listRunsForTenant(tenantId: string): Promise<AdminRunRecord[]>
  appendTraceAccessAudit(record: TraceAccessAuditRecord): Promise<void>
  listTraceAccessAudits(tenantId: string): Promise<TraceAccessAuditRecord[]>
  upsertRecruitingContextImport(
    batch: RecruitingContextImport,
    records: RecruitingContextRecord[],
  ): Promise<void>
  listRecruitingContextRecords(
    actor: ActorContext,
    query: RecruitingContextQuery,
  ): Promise<RecruitingContextRecord[]>
}
