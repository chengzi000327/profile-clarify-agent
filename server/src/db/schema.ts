import type {
  CandidateEvidence,
  RoleState,
} from '@role-clarifier/contracts'
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  displayName: text('display_name').notNull(),
  role: text('role', { enum: ['MANAGER', 'HR', 'ADMIN'] }).notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const externalEventReceipts = pgTable(
  'external_event_receipts',
  {
    channel: text('channel').notNull(),
    eventId: text('event_id').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.channel, table.eventId] })],
)

export const roleSessions = pgTable(
  'role_sessions',
  {
    id: uuid('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    title: text('title').notNull(),
    department: text('department').notNull(),
    stage: text('stage').notNull(),
    revision: integer('revision').notNull().default(0),
    businessState: jsonb('business_state')
      .$type<Omit<RoleState, 'id' | 'tenant_id' | 'title' | 'department' | 'stage' | 'revision' | 'created_at' | 'updated_at'>>()
      .notNull(),
    clarificationInitialBudget: integer('clarification_initial_budget').notNull().default(6),
    clarificationGrantedRounds: integer('clarification_granted_rounds').notNull().default(0),
    clarificationExtensionSize: integer('clarification_extension_size').notNull().default(2),
    clarificationCompletedRounds: integer('clarification_completed_rounds').notNull().default(0),
    clarificationOpenedRounds: integer('clarification_opened_rounds').notNull().default(0),
    clarificationOpenRoundId: uuid('clarification_open_round_id'),
    clarificationStatus: text('clarification_status').notNull().default('ACTIVE'),
    clarificationUpdatedBy: text('clarification_updated_by'),
    clarificationUpdatedAt: timestamp('clarification_updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('role_sessions_tenant_idx').on(table.tenantId),
    index('role_sessions_updated_idx').on(table.updatedAt),
  ],
)

export const roleMembers = pgTable(
  'role_members',
  {
    roleSessionId: uuid('role_session_id')
      .notNull()
      .references(() => roleSessions.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.roleSessionId, table.userId] })],
)

export const artifacts = pgTable(
  'artifacts',
  {
    id: uuid('id').primaryKey(),
    roleSessionId: uuid('role_session_id')
      .notNull()
      .references(() => roleSessions.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    version: integer('version').notNull(),
    status: text('status').notNull(),
    contentHash: text('content_hash').notNull(),
    content: jsonb('content').$type<unknown>().notNull(),
    basedOnHash: text('based_on_hash'),
    createdBy: text('created_by').notNull(),
    confirmedBy: text('confirmed_by'),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('artifacts_role_type_version_uidx').on(
      table.roleSessionId,
      table.type,
      table.version,
    ),
    index('artifacts_latest_idx').on(table.roleSessionId, table.type, table.version),
  ],
)

export const candidates = pgTable(
  'candidates',
  {
    id: uuid('id').primaryKey(),
    roleSessionId: uuid('role_session_id')
      .notNull()
      .references(() => roleSessions.id, { onDelete: 'cascade' }),
    candidateRef: text('candidate_ref').notNull(),
    channel: text('channel').notNull(),
    evidence: jsonb('evidence').$type<CandidateEvidence>().notNull(),
    importedBy: text('imported_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('candidates_role_ref_uidx').on(table.roleSessionId, table.candidateRef),
    index('candidates_role_channel_idx').on(table.roleSessionId, table.channel),
  ],
)

export const calibrationCases = pgTable(
  'calibration_cases',
  {
    id: uuid('id').primaryKey(),
    roleSessionId: uuid('role_session_id')
      .notNull()
      .references(() => roleSessions.id, { onDelete: 'cascade' }),
    signalStatus: text('signal_status').notNull(),
    proposedChange: jsonb('proposed_change').$type<Record<string, unknown>>().notNull(),
    evidenceSummary: jsonb('evidence_summary').$type<Record<string, unknown>>().notNull(),
    reviewedBy: text('reviewed_by'),
    reviewReason: text('review_reason'),
    managerTaskId: uuid('manager_task_id').unique(),
    assigneeUserId: text('assignee_user_id'),
    managerTaskStatus: text('manager_task_status'),
    decisionReason: text('decision_reason'),
    dueAt: timestamp('due_at', { withTimezone: true }),
    signalCreatedAt: timestamp('signal_created_at', { withTimezone: true }).notNull().defaultNow(),
    signalUpdatedAt: timestamp('signal_updated_at', { withTimezone: true }).notNull().defaultNow(),
    taskCreatedAt: timestamp('task_created_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    index('calibration_cases_role_idx').on(table.roleSessionId, table.signalCreatedAt),
    index('calibration_cases_assignee_idx').on(table.assigneeUserId, table.managerTaskStatus),
  ],
)

export const agentRuns = pgTable(
  'agent_runs',
  {
    id: uuid('id').primaryKey(),
    roleSessionId: uuid('role_session_id')
      .notNull()
      .references(() => roleSessions.id, { onDelete: 'cascade' }),
    actorUserId: text('actor_user_id').notNull(),
    status: text('status').notNull(),
    modelTier: text('model_tier').notNull(),
    task: text('task').notNull(),
    harnessSessionId: text('harness_session_id'),
    promptVersion: text('prompt_version').notNull(),
    modelName: text('model_name').notNull(),
    toolCount: integer('tool_count').notNull().default(0),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    errorCode: text('error_code'),
    inputMessageId: uuid('input_message_id'),
    outputMessageId: uuid('output_message_id'),
    cancelRequested: boolean('cancel_requested').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('agent_runs_role_status_idx').on(table.roleSessionId, table.status),
    index('agent_runs_actor_idx').on(table.actorUserId, table.createdAt),
  ],
)

export const agentRunEvents = pgTable(
  'agent_run_events',
  {
    id: uuid('id').primaryKey(),
    runId: uuid('run_id')
      .notNull()
      .references(() => agentRuns.id, { onDelete: 'cascade' }),
    sequence: bigint('sequence', { mode: 'number' }).notNull(),
    type: text('type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('agent_run_events_sequence_uidx').on(table.runId, table.sequence),
    index('agent_run_events_run_idx').on(table.runId, table.sequence),
  ],
)

export const conversationMessages = pgTable(
  'conversation_messages',
  {
    id: uuid('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    roleSessionId: uuid('role_session_id')
      .notNull()
      .references(() => roleSessions.id, { onDelete: 'cascade' }),
    runId: uuid('run_id').references(() => agentRuns.id, { onDelete: 'set null' }),
    clarificationRoundId: uuid('clarification_round_id'),
    senderKind: text('sender_kind').notNull(),
    senderUserId: text('sender_user_id'),
    senderName: text('sender_name').notNull(),
    content: text('content').notNull(),
    structuredContent: jsonb('structured_content').$type<Record<string, unknown> | null>(),
    status: text('status').notNull(),
    sequence: bigint('sequence', { mode: 'number' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('conversation_messages_sequence_uidx').on(table.roleSessionId, table.sequence),
    index('conversation_messages_role_idx').on(table.roleSessionId, table.sequence),
    index('conversation_messages_run_idx').on(table.runId),
  ],
)

export const clarificationRounds = pgTable(
  'clarification_rounds',
  {
    id: uuid('id').primaryKey(),
    roleSessionId: uuid('role_session_id')
      .notNull()
      .references(() => roleSessions.id, { onDelete: 'cascade' }),
    ordinal: integer('ordinal').notNull(),
    status: text('status').notNull(),
    question: text('question').notNull(),
    openedByRunId: uuid('opened_by_run_id')
      .notNull()
      .references(() => agentRuns.id, { onDelete: 'cascade' }),
    resolvedByMessageId: uuid('resolved_by_message_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('clarification_rounds_ordinal_uidx').on(table.roleSessionId, table.ordinal),
    index('clarification_rounds_role_idx').on(table.roleSessionId, table.ordinal),
  ],
)

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    roleSessionId: uuid('role_session_id').references(() => roleSessions.id, { onDelete: 'cascade' }),
    actorUserId: text('actor_user_id').notNull(),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('audit_logs_tenant_idx').on(table.tenantId, table.createdAt),
    index('audit_logs_role_idx').on(table.roleSessionId, table.createdAt),
    index('audit_logs_target_idx').on(table.targetType, table.targetId),
  ],
)

export const recruitingContextImports = pgTable(
  'recruiting_context_imports',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    sourceRevision: text('source_revision').notNull(),
    sourceFile: text('source_file').notNull(),
    excludedSheets: jsonb('excluded_sheets').$type<string[]>().notNull().default([]),
    recordCounts: jsonb('record_counts').$type<Record<string, number>>().notNull().default({}),
    importedAt: timestamp('imported_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('recruiting_context_imports_tenant_idx').on(table.tenantId, table.importedAt)],
)

export const recruitingContextRecords = pgTable(
  'recruiting_context_records',
  {
    tenantId: text('tenant_id').notNull(),
    recordType: text('record_type').notNull(),
    externalId: text('external_id').notNull(),
    teamId: text('team_id'),
    roleTitle: text('role_title'),
    conversationId: text('conversation_id'),
    sourceSystem: text('source_system').notNull(),
    dataClassification: text('data_classification').notNull(),
    effectiveAt: timestamp('effective_at', { withTimezone: true }),
    content: jsonb('content').$type<Record<string, unknown>>().notNull(),
    importId: text('import_id')
      .notNull()
      .references(() => recruitingContextImports.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.recordType, table.externalId] }),
    index('recruiting_context_records_type_idx').on(table.tenantId, table.recordType),
    index('recruiting_context_records_team_idx').on(
      table.tenantId,
      table.teamId,
      table.recordType,
    ),
    index('recruiting_context_records_role_idx').on(
      table.tenantId,
      table.roleTitle,
      table.recordType,
    ),
    index('recruiting_context_records_conversation_idx').on(
      table.tenantId,
      table.conversationId,
      table.recordType,
    ),
  ],
)
