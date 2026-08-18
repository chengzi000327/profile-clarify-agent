import type {
  CandidateEvidence,
  EnterpriseKnowledgeItem,
  HcContext,
  RoleState,
} from '@role-clarifier/contracts'
import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
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

export const hcApprovals = pgTable(
  'hc_approvals',
  {
    requestId: text('request_id').notNull(),
    tenantId: text('tenant_id').notNull(),
    title: text('title').notNull(),
    department: text('department').notNull(),
    status: text('status', { enum: ['APPROVED'] }).notNull(),
    context: jsonb('context').$type<HcContext>().notNull(),
    hiringManagerUserId: text('hiring_manager_user_id').notNull(),
    assignedHrUserId: text('assigned_hr_user_id'),
    roleSessionId: uuid('role_session_id')
      .references(() => roleSessions.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.requestId] }),
    index('hc_approvals_tenant_status_idx').on(table.tenantId, table.status),
    index('hc_approvals_manager_idx').on(table.tenantId, table.hiringManagerUserId),
    index('hc_approvals_hr_idx').on(table.tenantId, table.assignedHrUserId),
    uniqueIndex('hc_approvals_role_session_uidx').on(table.roleSessionId),
  ],
)

export const enterpriseKnowledgeItems = pgTable(
  'enterprise_knowledge_items',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    category: text('category').$type<EnterpriseKnowledgeItem['category']>().notNull(),
    title: text('title').notNull(),
    content: text('content').notNull(),
    summary: text('summary').notNull(),
    department: text('department'),
    jobFamily: text('job_family'),
    tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
    visibleTo: text('visible_to').$type<EnterpriseKnowledgeItem['visible_to']>().notNull(),
    sourceRef: text('source_ref').notNull(),
    sourceVersion: text('source_version').notNull(),
    status: text('status').$type<EnterpriseKnowledgeItem['status']>().notNull(),
    validFrom: timestamp('valid_from', { withTimezone: true }).notNull(),
    validTo: timestamp('valid_to', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('enterprise_knowledge_items_category_check', sql`${table.category} IN ('ORGANIZATION', 'JOB_FAMILY', 'LEVEL_FRAMEWORK', 'HISTORICAL_JD', 'ROLE_PROFILE_CASE', 'RECRUITING_POLICY', 'INTERVIEW_STANDARD')`),
    check('enterprise_knowledge_items_visibility_check', sql`${table.visibleTo} IN ('ALL_ROLE_MEMBERS', 'HR_ONLY', 'ADMIN_ONLY')`),
    check('enterprise_knowledge_items_status_check', sql`${table.status} IN ('ACTIVE', 'ARCHIVED')`),
    uniqueIndex('enterprise_knowledge_items_source_uidx').on(
      table.tenantId,
      table.sourceRef,
      table.sourceVersion,
    ),
    index('enterprise_knowledge_items_tenant_status_category_idx').on(
      table.tenantId,
      table.status,
      table.category,
    ),
    index('enterprise_knowledge_items_department_idx').on(table.tenantId, table.department),
    index('enterprise_knowledge_items_job_family_idx').on(table.tenantId, table.jobFamily),
    index('enterprise_knowledge_items_tags_gin_idx').using('gin', table.tags),
  ],
)

export const roleClarificationTasks = pgTable(
  'role_clarification_tasks',
  {
    id: uuid('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    hcRequestId: text('hc_request_id').notNull(),
    roleSessionId: uuid('role_session_id').references(() => roleSessions.id, { onDelete: 'set null' }),
    assigneeUserId: text('assignee_user_id')
      .notNull()
      .references(() => users.id),
    status: text('status', { enum: ['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] }).notNull(),
    dueAt: timestamp('due_at', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('role_clarification_tasks_status_check', sql`${table.status} IN ('OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')`),
    uniqueIndex('role_clarification_tasks_hc_uidx').on(table.tenantId, table.hcRequestId),
    index('role_clarification_tasks_assignee_status_idx').on(table.assigneeUserId, table.status),
  ],
)

export const userChannelBindings = pgTable(
  'user_channel_bindings',
  {
    tenantId: text('tenant_id').notNull(),
    userId: text('user_id').notNull().references(() => users.id),
    channel: text('channel', { enum: ['FEISHU'] }).notNull(),
    recipientType: text('recipient_type', { enum: ['OPEN_ID'] }).notNull(),
    recipientId: text('recipient_id').notNull(),
    status: text('status', { enum: ['ACTIVE', 'REVOKED'] }).notNull(),
    verifiedAt: timestamp('verified_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.userId, table.channel] }),
    check('user_channel_bindings_channel_check', sql`${table.channel} IN ('FEISHU')`),
    check('user_channel_bindings_recipient_type_check', sql`${table.recipientType} IN ('OPEN_ID')`),
    check('user_channel_bindings_status_check', sql`${table.status} IN ('ACTIVE', 'REVOKED')`),
    uniqueIndex('user_channel_bindings_active_recipient_idx')
      .on(table.tenantId, table.channel, table.recipientId)
      .where(sql`${table.status} = 'ACTIVE'`),
  ],
)

export const notificationOutbox = pgTable(
  'notification_outbox',
  {
    id: uuid('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => roleClarificationTasks.id, { onDelete: 'cascade' }),
    dedupeKey: text('dedupe_key').notNull(),
    channel: text('channel', { enum: ['FEISHU'] }).notNull(),
    recipientUserId: text('recipient_user_id').notNull().references(() => users.id),
    template: text('template', { enum: ['HC_CLARIFICATION_ASSIGNED'] }).notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    status: text('status', { enum: ['PENDING', 'PROCESSING', 'SENT', 'RETRY', 'UNBOUND', 'DEAD'] }).notNull(),
    attemptCount: integer('attempt_count').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull(),
    lockedBy: text('locked_by'),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    lastErrorCode: text('last_error_code'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('notification_outbox_channel_check', sql`${table.channel} IN ('FEISHU')`),
    check('notification_outbox_template_check', sql`${table.template} IN ('HC_CLARIFICATION_ASSIGNED')`),
    check('notification_outbox_status_check', sql`${table.status} IN ('PENDING', 'PROCESSING', 'SENT', 'RETRY', 'UNBOUND', 'DEAD')`),
    check('notification_outbox_attempt_count_check', sql`${table.attemptCount} >= 0`),
    uniqueIndex('notification_outbox_dedupe_uidx').on(table.dedupeKey),
    index('notification_outbox_due_idx').on(table.status, table.nextAttemptAt),
    index('notification_outbox_recipient_idx').on(table.recipientUserId, table.status),
  ],
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
    effectiveActorRole: text('effective_actor_role', { enum: ['MANAGER', 'HR', 'ADMIN'] })
      .notNull()
      .default('MANAGER'),
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
