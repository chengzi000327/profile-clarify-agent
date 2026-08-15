import type {
  AgentEvent,
  AgentRun,
  ArtifactEnvelope,
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
  role: text('role', { enum: ['MANAGER', 'HR'] }).notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const roleSessions = pgTable(
  'role_sessions',
  {
    id: uuid('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    title: text('title').notNull(),
    department: text('department').notNull(),
    stage: text('stage').notNull(),
    revision: integer('revision').notNull().default(0),
    state: jsonb('state').$type<RoleState>().notNull(),
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
    envelope: jsonb('envelope').$type<ArtifactEnvelope>().notNull(),
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

export const calibrationSignals = pgTable(
  'calibration_signals',
  {
    id: uuid('id').primaryKey(),
    roleSessionId: uuid('role_session_id')
      .notNull()
      .references(() => roleSessions.id, { onDelete: 'cascade' }),
    status: text('status').notNull(),
    proposedChange: jsonb('proposed_change').$type<Record<string, unknown>>().notNull(),
    evidenceSummary: jsonb('evidence_summary').$type<Record<string, unknown>>().notNull(),
    reviewedBy: text('reviewed_by'),
    reviewReason: text('review_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('calibration_signals_role_idx').on(table.roleSessionId, table.createdAt)],
)

export const managerTasks = pgTable(
  'manager_tasks',
  {
    id: uuid('id').primaryKey(),
    roleSessionId: uuid('role_session_id')
      .notNull()
      .references(() => roleSessions.id, { onDelete: 'cascade' }),
    signalId: uuid('signal_id')
      .notNull()
      .references(() => calibrationSignals.id, { onDelete: 'cascade' }),
    assigneeUserId: text('assignee_user_id').notNull(),
    status: text('status').notNull(),
    decisionReason: text('decision_reason'),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [index('manager_tasks_assignee_idx').on(table.assigneeUserId, table.status)],
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
    run: jsonb('run').$type<AgentRun>().notNull(),
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
    event: jsonb('event').$type<AgentEvent>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('agent_run_events_sequence_uidx').on(table.runId, table.sequence),
    index('agent_run_events_run_idx').on(table.runId, table.sequence),
  ],
)

export const decisionLogs = pgTable(
  'decision_logs',
  {
    id: uuid('id').primaryKey(),
    roleSessionId: uuid('role_session_id')
      .notNull()
      .references(() => roleSessions.id, { onDelete: 'cascade' }),
    actorUserId: text('actor_user_id').notNull(),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('decision_logs_role_idx').on(table.roleSessionId, table.createdAt)],
)
