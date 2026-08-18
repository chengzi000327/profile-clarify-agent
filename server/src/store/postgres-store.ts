import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  ilike,
  inArray,
  isNull,
  lt,
  lte,
  or,
  sql,
} from 'drizzle-orm'
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres, { type Sql } from 'postgres'
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
import * as schema from '../db/schema.js'
import type {
  AdminRunRecord,
  AdminRunFilters,
  AdminRunPage,
  ApplicationStore,
  CalibrationSignalRecord,
  DecisionRecord,
  EnterpriseKnowledgeQuery,
  EventSubscriber,
  ManagerTaskRecord,
  RoleAggregate,
  RoleAggregateReadOptions,
  RunRecord,
  StoredUser,
  TraceAccessAuditRecord,
} from './types.js'
import type {
  ApprovedHcIngestion,
  NotificationClaim,
  NotificationFailureUpdate,
  NotificationOutboxRecord,
  NotificationRetryUpdate,
  UserChannelBindingRecord,
} from './closure-types.js'

const iso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString()

type RoleSessionRow = typeof schema.roleSessions.$inferSelect
type HcApprovalRow = typeof schema.hcApprovals.$inferSelect
type RoleClarificationTaskRow = typeof schema.roleClarificationTasks.$inferSelect
type EnterpriseKnowledgeRow = typeof schema.enterpriseKnowledgeItems.$inferSelect
type NotificationOutboxRow = typeof schema.notificationOutbox.$inferSelect
type UserChannelBindingRow = typeof schema.userChannelBindings.$inferSelect
type ArtifactRow = typeof schema.artifacts.$inferSelect
type AgentRunRow = typeof schema.agentRuns.$inferSelect
type AgentEventRow = typeof schema.agentRunEvents.$inferSelect
type ConversationMessageRow = typeof schema.conversationMessages.$inferSelect
type ClarificationRoundRow = typeof schema.clarificationRounds.$inferSelect
type CalibrationCaseRow = typeof schema.calibrationCases.$inferSelect

const roleBusinessState = (
  state: RoleState,
): RoleSessionRow['businessState'] => ({
  hc_status: state.hc_status,
  hc_context: state.hc_context,
  facts: state.facts,
  conflicts: state.conflicts,
  latest_artifacts: state.latest_artifacts,
  candidate_count: state.candidate_count,
  candidate_channels: state.candidate_channels,
  calibration_status: state.calibration_status,
})

const roleStateFromRow = (row: RoleSessionRow): RoleState => ({
  ...row.businessState,
  hc_context: row.businessState.hc_context ?? null,
  id: row.id,
  tenant_id: row.tenantId,
  title: row.title,
  department: row.department,
  stage: row.stage as RoleState['stage'],
  revision: row.revision,
  created_at: iso(row.createdAt),
  updated_at: iso(row.updatedAt),
})

const hcApprovalFromRow = (
  row: HcApprovalRow,
  task?: RoleClarificationTaskRow,
  notification?: NotificationOutboxRow,
): HcApproval => ({
  request_id: row.requestId,
  tenant_id: row.tenantId,
  title: row.title,
  department: row.department,
  status: row.status,
  context: row.context,
  role_session_id: row.roleSessionId,
  clarification_task: task
    ? {
        id: task.id,
        status: task.status,
        assignee_user_id: task.assigneeUserId,
        started_at: task.startedAt ? iso(task.startedAt) : null,
        completed_at: task.completedAt ? iso(task.completedAt) : null,
      }
    : null,
  notification_delivery: notification
    ? {
        channel: notification.channel,
        status: notification.status,
        sent_at: notification.sentAt ? iso(notification.sentAt) : null,
        last_error_code: notification.lastErrorCode,
      }
    : null,
  created_at: iso(row.createdAt),
  updated_at: iso(row.updatedAt),
})

const enterpriseKnowledgeFromRow = (row: EnterpriseKnowledgeRow): EnterpriseKnowledgeItem => ({
  id: row.id,
  tenant_id: row.tenantId,
  category: row.category,
  title: row.title,
  content: row.content,
  summary: row.summary,
  department: row.department,
  job_family: row.jobFamily,
  tags: row.tags,
  visible_to: row.visibleTo,
  source_ref: row.sourceRef,
  source_version: row.sourceVersion,
  status: row.status,
  valid_from: iso(row.validFrom),
  valid_to: row.validTo ? iso(row.validTo) : null,
  updated_at: iso(row.updatedAt),
})

const notificationFromRow = (row: NotificationOutboxRow): NotificationOutboxRecord => ({
  id: row.id,
  tenant_id: row.tenantId,
  task_id: row.taskId,
  dedupe_key: row.dedupeKey,
  channel: row.channel,
  recipient_user_id: row.recipientUserId,
  template: row.template,
  payload: row.payload,
  status: row.status,
  attempt_count: row.attemptCount,
  next_attempt_at: iso(row.nextAttemptAt),
  locked_by: row.lockedBy,
  locked_until: row.lockedUntil ? iso(row.lockedUntil) : null,
  last_error_code: row.lastErrorCode,
  sent_at: row.sentAt ? iso(row.sentAt) : null,
  created_at: iso(row.createdAt),
  updated_at: iso(row.updatedAt),
})

const userChannelBindingFromRow = (row: UserChannelBindingRow): UserChannelBindingRecord => ({
  tenant_id: row.tenantId,
  user_id: row.userId,
  channel: row.channel,
  recipient_type: row.recipientType,
  recipient_id: row.recipientId,
  status: row.status,
  verified_at: iso(row.verifiedAt),
  updated_at: iso(row.updatedAt),
})

const artifactFromRow = (row: ArtifactRow): ArtifactEnvelope => ({
  id: row.id,
  role_session_id: row.roleSessionId,
  type: row.type as ArtifactEnvelope['type'],
  version: row.version,
  status: row.status as ArtifactEnvelope['status'],
  content: row.content,
  content_hash: row.contentHash,
  based_on_hash: row.basedOnHash,
  created_by: row.createdBy,
  created_at: iso(row.createdAt),
  confirmed_by: row.confirmedBy,
  confirmed_at: row.confirmedAt ? iso(row.confirmedAt) : null,
})

const agentRunFromRow = (row: AgentRunRow): AgentRun => ({
  id: row.id,
  role_session_id: row.roleSessionId,
  actor_user_id: row.actorUserId,
  effective_actor_role: row.effectiveActorRole,
  status: row.status as AgentRun['status'],
  model_tier: row.modelTier as AgentRun['model_tier'],
  task: row.task,
  harness_session_id: row.harnessSessionId,
  prompt_version: row.promptVersion,
  model_name: row.modelName,
  tool_count: row.toolCount,
  input_tokens: row.inputTokens,
  output_tokens: row.outputTokens,
  started_at: row.startedAt ? iso(row.startedAt) : null,
  completed_at: row.completedAt ? iso(row.completedAt) : null,
  error_code: row.errorCode,
  input_message_id: row.inputMessageId,
  output_message_id: row.outputMessageId,
})

const agentEventFromRow = (row: AgentEventRow): AgentEvent => ({
  id: row.id,
  run_id: row.runId,
  sequence: row.sequence,
  type: row.type as AgentEvent['type'],
  payload: row.payload,
  created_at: iso(row.createdAt),
})

const conversationMessageFromRow = (row: ConversationMessageRow): ConversationMessage => {
  const humanRole = ['MANAGER', 'HR', 'ADMIN'].includes(row.senderKind)
    ? row.senderKind as ConversationMessage['sender_role']
    : null
  return {
    id: row.id,
    tenant_id: row.tenantId,
    role_session_id: row.roleSessionId,
    run_id: row.runId,
    clarification_round_id: row.clarificationRoundId,
    sender_type: humanRole ? 'HUMAN' : row.senderKind as ConversationMessage['sender_type'],
    sender_user_id: row.senderUserId,
    sender_role: humanRole,
    sender_name: row.senderName,
    content: row.content,
    structured_content: row.structuredContent,
    status: row.status as ConversationMessage['status'],
    sequence: row.sequence,
    created_at: iso(row.createdAt),
    completed_at: row.completedAt ? iso(row.completedAt) : null,
  }
}

const clarificationRoundFromRow = (row: ClarificationRoundRow): ClarificationRound => ({
  id: row.id,
  role_session_id: row.roleSessionId,
  ordinal: row.ordinal,
  status: row.status as ClarificationRound['status'],
  question: row.question,
  opened_by_run_id: row.openedByRunId,
  resolved_by_message_id: row.resolvedByMessageId,
  created_at: iso(row.createdAt),
  completed_at: row.completedAt ? iso(row.completedAt) : null,
})

const calibrationSignalFromRow = (row: CalibrationCaseRow): CalibrationSignalRecord => ({
  id: row.id,
  role_session_id: row.roleSessionId,
  status: row.signalStatus as CalibrationSignalRecord['status'],
  proposed_change: row.proposedChange,
  evidence_summary: row.evidenceSummary,
  reviewed_by: row.reviewedBy,
  review_reason: row.reviewReason,
  created_at: iso(row.signalCreatedAt),
  updated_at: iso(row.signalUpdatedAt),
})

const managerTaskFromRow = (row: CalibrationCaseRow): ManagerTaskRecord | null =>
  row.managerTaskId && row.assigneeUserId && row.managerTaskStatus && row.dueAt && row.taskCreatedAt
    ? {
        id: row.managerTaskId,
        role_session_id: row.roleSessionId,
        signal_id: row.id,
        assignee_user_id: row.assigneeUserId,
        status: row.managerTaskStatus as ManagerTaskRecord['status'],
        decision_reason: row.decisionReason,
        due_at: iso(row.dueAt),
        created_at: iso(row.taskCreatedAt),
        completed_at: row.completedAt ? iso(row.completedAt) : null,
      }
    : null

export class PostgresStore implements ApplicationStore {
  private readonly client: Sql
  private readonly db: PostgresJsDatabase<typeof schema>
  private readonly subscribers = new Map<string, Set<EventSubscriber>>()

  constructor(databaseUrl: string) {
    this.client = postgres(databaseUrl, { max: 10, prepare: false })
    this.db = drizzle(this.client, { schema })
  }

  async initialize(): Promise<void> {
    await this.db.select({ id: schema.roleSessions.id }).from(schema.roleSessions).limit(1)
  }

  async close(): Promise<void> {
    await this.client.end()
  }

  async getUser(userId: string): Promise<StoredUser | null> {
    const row = await this.db.query.users.findFirst({ where: eq(schema.users.id, userId) })
    if (!row || !row.active) return null
    return {
      tenant_id: row.tenantId,
      user_id: row.id,
      role: row.role,
      display_name: row.displayName,
      active: row.active,
    }
  }

  async saveUser(user: StoredUser): Promise<void> {
    await this.db
      .insert(schema.users)
      .values({
        id: user.user_id,
        tenantId: user.tenant_id,
        displayName: user.display_name,
        role: user.role,
        active: user.active,
      })
      .onConflictDoUpdate({
        target: schema.users.id,
        set: {
          displayName: user.display_name,
          active: user.active,
        },
      })
  }

  async claimExternalEvent(channel: string, eventId: string): Promise<boolean> {
    const rows = await this.db
      .insert(schema.externalEventReceipts)
      .values({ channel, eventId })
      .onConflictDoNothing()
      .returning({ eventId: schema.externalEventReceipts.eventId })
    return rows.length === 1
  }

  async ingestApprovedHcClosure(input: ApprovedHcIngestion): Promise<{ inserted: boolean }> {
    return this.db.transaction(async (tx) => {
      const receipts = await tx
        .insert(schema.externalEventReceipts)
        .values({
          channel: input.external_event_channel,
          eventId: input.external_event_id,
          receivedAt: new Date(input.approval.updated_at),
        })
        .onConflictDoNothing()
        .returning({ eventId: schema.externalEventReceipts.eventId })
      if (receipts.length === 0) return { inserted: false }

      await tx
        .insert(schema.hcApprovals)
        .values({
          requestId: input.approval.request_id,
          tenantId: input.approval.tenant_id,
          title: input.approval.title,
          department: input.approval.department,
          status: 'APPROVED',
          context: input.approval.context,
          hiringManagerUserId: input.approval.context.hiring_manager_user_id,
          assignedHrUserId: input.approval.context.assigned_hr_user_id,
          roleSessionId: input.approval.role_session_id,
          createdAt: new Date(input.approval.created_at),
          updatedAt: new Date(input.approval.updated_at),
        })
        .onConflictDoUpdate({
          target: [schema.hcApprovals.tenantId, schema.hcApprovals.requestId],
          set: {
            title: input.approval.title,
            department: input.approval.department,
            status: 'APPROVED',
            context: input.approval.context,
            hiringManagerUserId: input.approval.context.hiring_manager_user_id,
            assignedHrUserId: input.approval.context.assigned_hr_user_id,
            updatedAt: new Date(input.approval.updated_at),
          },
        })

      await tx
        .insert(schema.roleClarificationTasks)
        .values({
          id: input.task.id,
          tenantId: input.task.tenant_id,
          hcRequestId: input.task.hc_request_id,
          roleSessionId: input.task.role_session_id,
          assigneeUserId: input.task.assignee_user_id,
          status: input.task.status,
          dueAt: input.task.due_at ? new Date(input.task.due_at) : null,
          startedAt: input.task.started_at ? new Date(input.task.started_at) : null,
          completedAt: input.task.completed_at ? new Date(input.task.completed_at) : null,
          createdAt: new Date(input.task.created_at),
          updatedAt: new Date(input.task.updated_at),
        })
        .onConflictDoNothing({
          target: [schema.roleClarificationTasks.tenantId, schema.roleClarificationTasks.hcRequestId],
        })
      const [task] = await tx
        .select({ id: schema.roleClarificationTasks.id })
        .from(schema.roleClarificationTasks)
        .where(and(
          eq(schema.roleClarificationTasks.tenantId, input.task.tenant_id),
          eq(schema.roleClarificationTasks.hcRequestId, input.task.hc_request_id),
        ))
        .limit(1)
      if (!task) throw new Error('HC_CLARIFICATION_TASK_NOT_FOUND')

      await tx
        .insert(schema.notificationOutbox)
        .values({
          id: input.notification.id,
          tenantId: input.notification.tenant_id,
          taskId: task.id,
          dedupeKey: input.notification.dedupe_key,
          channel: input.notification.channel,
          recipientUserId: input.notification.recipient_user_id,
          template: input.notification.template,
          payload: input.notification.payload,
          status: input.notification.status,
          attemptCount: input.notification.attempt_count,
          nextAttemptAt: new Date(input.notification.next_attempt_at),
          lockedBy: input.notification.locked_by,
          lockedUntil: input.notification.locked_until
            ? new Date(input.notification.locked_until)
            : null,
          lastErrorCode: input.notification.last_error_code,
          sentAt: input.notification.sent_at ? new Date(input.notification.sent_at) : null,
          createdAt: new Date(input.notification.created_at),
          updatedAt: new Date(input.notification.updated_at),
        })
        .onConflictDoNothing({ target: schema.notificationOutbox.dedupeKey })
      return { inserted: true }
    })
  }

  async claimDueNotifications(input: NotificationClaim): Promise<NotificationOutboxRecord[]> {
    return this.db.transaction(async (tx) => {
      const now = new Date(input.now)
      const rows = await tx
        .select()
        .from(schema.notificationOutbox)
        .where(or(
          and(
            inArray(schema.notificationOutbox.status, ['PENDING', 'RETRY']),
            lte(schema.notificationOutbox.nextAttemptAt, now),
          ),
          and(
            eq(schema.notificationOutbox.status, 'PROCESSING'),
            lt(schema.notificationOutbox.lockedUntil, now),
          ),
        ))
        .orderBy(
          asc(schema.notificationOutbox.nextAttemptAt),
          asc(schema.notificationOutbox.createdAt),
          asc(schema.notificationOutbox.id),
        )
        .limit(input.limit)
        .for('update', { skipLocked: true })
      const claimed: NotificationOutboxRecord[] = []
      for (const row of rows) {
        const [updated] = await tx
          .update(schema.notificationOutbox)
          .set({
            status: 'PROCESSING',
            attemptCount: row.attemptCount + 1,
            lockedBy: input.worker_id,
            lockedUntil: new Date(input.locked_until),
            updatedAt: now,
          })
          .where(eq(schema.notificationOutbox.id, row.id))
          .returning()
        if (updated) claimed.push(notificationFromRow(updated))
      }
      return claimed
    })
  }

  async getNotification(id: string): Promise<NotificationOutboxRecord | null> {
    const row = await this.db.query.notificationOutbox.findFirst({
      where: eq(schema.notificationOutbox.id, id),
    })
    return row ? notificationFromRow(row) : null
  }

  async getUserChannelBinding(
    tenantId: string,
    userId: string,
    channel: 'FEISHU',
  ): Promise<UserChannelBindingRecord | null> {
    const row = await this.db.query.userChannelBindings.findFirst({
      where: and(
        eq(schema.userChannelBindings.tenantId, tenantId),
        eq(schema.userChannelBindings.userId, userId),
        eq(schema.userChannelBindings.channel, channel),
      ),
    })
    return row ? userChannelBindingFromRow(row) : null
  }

  async upsertUserChannelBinding(binding: UserChannelBindingRecord): Promise<void> {
    await this.db
      .insert(schema.userChannelBindings)
      .values({
        tenantId: binding.tenant_id,
        userId: binding.user_id,
        channel: binding.channel,
        recipientType: binding.recipient_type,
        recipientId: binding.recipient_id,
        status: binding.status,
        verifiedAt: new Date(binding.verified_at),
        updatedAt: new Date(binding.updated_at),
      })
      .onConflictDoUpdate({
        target: [
          schema.userChannelBindings.tenantId,
          schema.userChannelBindings.userId,
          schema.userChannelBindings.channel,
        ],
        set: {
          recipientType: binding.recipient_type,
          recipientId: binding.recipient_id,
          status: binding.status,
          verifiedAt: new Date(binding.verified_at),
          updatedAt: new Date(binding.updated_at),
        },
      })
  }

  async requeueUnboundNotificationsForUser(
    tenantId: string,
    userId: string,
    nextAttemptAt: string,
  ): Promise<number> {
    const rows = await this.db
      .update(schema.notificationOutbox)
      .set({
        status: 'PENDING',
        attemptCount: 0,
        nextAttemptAt: new Date(nextAttemptAt),
        lockedBy: null,
        lockedUntil: null,
        lastErrorCode: null,
        updatedAt: new Date(nextAttemptAt),
      })
      .where(and(
        eq(schema.notificationOutbox.tenantId, tenantId),
        eq(schema.notificationOutbox.recipientUserId, userId),
        eq(schema.notificationOutbox.status, 'UNBOUND'),
      ))
      .returning({ id: schema.notificationOutbox.id })
    return rows.length
  }

  async markNotificationSent(id: string, workerId: string, sentAt: string): Promise<void> {
    await this.updateClaimedNotification(id, workerId, {
      status: 'SENT',
      sentAt: new Date(sentAt),
      lockedBy: null,
      lockedUntil: null,
      lastErrorCode: null,
      updatedAt: new Date(sentAt),
    })
  }

  async markNotificationRetry(input: NotificationRetryUpdate): Promise<void> {
    await this.updateClaimedNotification(input.id, input.worker_id, {
      status: 'RETRY',
      nextAttemptAt: new Date(input.next_attempt_at),
      lockedBy: null,
      lockedUntil: null,
      lastErrorCode: input.error_code,
      updatedAt: new Date(input.updated_at),
    })
  }

  async markNotificationUnbound(id: string, workerId: string, updatedAt: string): Promise<void> {
    await this.updateClaimedNotification(id, workerId, {
      status: 'UNBOUND',
      lockedBy: null,
      lockedUntil: null,
      lastErrorCode: null,
      updatedAt: new Date(updatedAt),
    })
  }

  async markNotificationDead(input: NotificationFailureUpdate): Promise<void> {
    await this.updateClaimedNotification(input.id, input.worker_id, {
      status: 'DEAD',
      lockedBy: null,
      lockedUntil: null,
      lastErrorCode: input.error_code,
      updatedAt: new Date(input.updated_at),
    })
  }

  async listEnterpriseKnowledge(
    input: EnterpriseKnowledgeQuery,
  ): Promise<EnterpriseKnowledgeItem[]> {
    if (input.categories.length === 0 || input.visible_to.length === 0) return []
    const now = new Date(input.now)
    const rows = await this.db
      .select()
      .from(schema.enterpriseKnowledgeItems)
      .where(and(
        eq(schema.enterpriseKnowledgeItems.tenantId, input.tenant_id),
        eq(schema.enterpriseKnowledgeItems.status, 'ACTIVE'),
        inArray(schema.enterpriseKnowledgeItems.visibleTo, input.visible_to),
        inArray(schema.enterpriseKnowledgeItems.category, input.categories),
        lte(schema.enterpriseKnowledgeItems.validFrom, now),
        or(
          isNull(schema.enterpriseKnowledgeItems.validTo),
          gt(schema.enterpriseKnowledgeItems.validTo, now),
        ),
      ))
    return rows.map(enterpriseKnowledgeFromRow)
  }

  async listHcApprovals(actor: ActorContext): Promise<HcApproval[]> {
    const access = actor.role === 'ADMIN'
      ? and(
          eq(schema.hcApprovals.tenantId, actor.tenant_id),
          eq(schema.hcApprovals.status, 'APPROVED'),
        )
      : and(
          eq(schema.hcApprovals.tenantId, actor.tenant_id),
          eq(schema.hcApprovals.status, 'APPROVED'),
          actor.role === 'MANAGER'
            ? eq(schema.hcApprovals.hiringManagerUserId, actor.user_id)
            : eq(schema.hcApprovals.assignedHrUserId, actor.user_id),
        )
    const rows = await this.db
      .select()
      .from(schema.hcApprovals)
      .where(access)
      .orderBy(desc(schema.hcApprovals.createdAt))
    return this.hcApprovalsWithSummaries(rows)
  }

  async getHcApproval(requestId: string, actor: ActorContext): Promise<HcApproval | null> {
    const access = actor.role === 'ADMIN'
      ? and(
          eq(schema.hcApprovals.requestId, requestId),
          eq(schema.hcApprovals.tenantId, actor.tenant_id),
        )
      : and(
          eq(schema.hcApprovals.requestId, requestId),
          eq(schema.hcApprovals.tenantId, actor.tenant_id),
          actor.role === 'MANAGER'
            ? eq(schema.hcApprovals.hiringManagerUserId, actor.user_id)
            : eq(schema.hcApprovals.assignedHrUserId, actor.user_id),
        )
    const [row] = await this.db.select().from(schema.hcApprovals).where(access).limit(1)
    if (!row) return null
    const [approval] = await this.hcApprovalsWithSummaries([row])
    return approval ?? null
  }

  async listRoleStates(actor: ActorContext): Promise<RoleState[]> {
    if (actor.role === 'ADMIN') {
      const rows = await this.db
        .select()
        .from(schema.roleSessions)
        .where(eq(schema.roleSessions.tenantId, actor.tenant_id))
        .orderBy(desc(schema.roleSessions.updatedAt))
      return rows.map(roleStateFromRow)
    }
    const rows = await this.db
      .select({ role: schema.roleSessions })
      .from(schema.roleSessions)
      .innerJoin(
        schema.roleMembers,
        eq(schema.roleSessions.id, schema.roleMembers.roleSessionId),
      )
      .where(
        and(
          eq(schema.roleSessions.tenantId, actor.tenant_id),
          eq(schema.roleMembers.userId, actor.user_id),
        ),
      )
      .orderBy(desc(schema.roleSessions.updatedAt))
    return rows.map((row) => roleStateFromRow(row.role))
  }

  async getRoleAggregate(
    roleSessionId: string,
    actor: ActorContext,
    options?: RoleAggregateReadOptions,
  ): Promise<RoleAggregate | null> {
    const [access] = actor.role === 'ADMIN'
      ? await this.db
          .select()
          .from(schema.roleSessions)
          .where(
            and(
              eq(schema.roleSessions.id, roleSessionId),
              eq(schema.roleSessions.tenantId, actor.tenant_id),
            ),
          )
          .limit(1)
      : await this.db
          .select({ role: schema.roleSessions })
          .from(schema.roleSessions)
          .innerJoin(
            schema.roleMembers,
            eq(schema.roleSessions.id, schema.roleMembers.roleSessionId),
          )
          .where(
            and(
              eq(schema.roleSessions.id, roleSessionId),
              eq(schema.roleSessions.tenantId, actor.tenant_id),
              eq(schema.roleMembers.userId, actor.user_id),
            ),
          )
          .limit(1)
    if (!access) return null

    const roleRow = 'role' in access ? access.role : access
    const [memberRows, artifactRows, candidateRows, signalRows, taskRows] = await Promise.all([
      options?.members === false
        ? Promise.resolve([])
        : this.db
            .select({ userId: schema.roleMembers.userId })
            .from(schema.roleMembers)
            .where(eq(schema.roleMembers.roleSessionId, roleSessionId)),
      options?.artifacts === false
        ? Promise.resolve([])
        : this.db
            .select()
            .from(schema.artifacts)
            .where(eq(schema.artifacts.roleSessionId, roleSessionId))
            .orderBy(asc(schema.artifacts.type), asc(schema.artifacts.version)),
      options?.candidates === false
        ? Promise.resolve([])
        : this.db
            .select({ evidence: schema.candidates.evidence })
            .from(schema.candidates)
            .where(eq(schema.candidates.roleSessionId, roleSessionId)),
      options?.calibration_signals === false
        ? Promise.resolve([])
        : this.db
            .select()
            .from(schema.calibrationCases)
            .where(eq(schema.calibrationCases.roleSessionId, roleSessionId))
            .orderBy(desc(schema.calibrationCases.signalCreatedAt)),
      options?.manager_tasks === false
        ? Promise.resolve([])
        : this.db
            .select()
            .from(schema.calibrationCases)
            .where(eq(schema.calibrationCases.roleSessionId, roleSessionId))
            .orderBy(desc(schema.calibrationCases.taskCreatedAt)),
    ])

    return {
      state: roleStateFromRow(roleRow),
      member_ids: memberRows.map((row) => row.userId),
      artifacts: artifactRows.map(artifactFromRow),
      candidates: candidateRows.map((row) => row.evidence),
      calibration_signals: signalRows.map(calibrationSignalFromRow),
      manager_tasks: taskRows
        .map(managerTaskFromRow)
        .filter((task): task is ManagerTaskRecord => task !== null),
    }
  }

  async createRoleAggregate(aggregate: RoleAggregate): Promise<void> {
    await this.db.transaction(async (tx) => {
      const assignedHr = aggregate.state.hc_context?.assigned_hr_user_id
      const memberIds = [...new Set([
        ...aggregate.member_ids,
        ...(assignedHr ? [assignedHr] : []),
      ])]
      const policy = this.makeDefaultPolicy(aggregate.state.id)
      await tx.insert(schema.roleSessions).values({
        id: aggregate.state.id,
        tenantId: aggregate.state.tenant_id,
        title: aggregate.state.title,
        department: aggregate.state.department,
        stage: aggregate.state.stage,
        revision: aggregate.state.revision,
        businessState: roleBusinessState(aggregate.state),
        ...this.toPolicyColumns(policy),
        createdAt: new Date(aggregate.state.created_at),
        updatedAt: new Date(aggregate.state.updated_at),
      })
      if (memberIds.length > 0) {
        await tx.insert(schema.roleMembers).values(
          memberIds.map((userId) => ({
            roleSessionId: aggregate.state.id,
            userId,
          })),
        )
      }
      if (aggregate.artifacts.length > 0) {
        await tx.insert(schema.artifacts).values(
          aggregate.artifacts.map((artifact) => ({
            id: artifact.id,
            roleSessionId: artifact.role_session_id,
            type: artifact.type,
            version: artifact.version,
            status: artifact.status,
            contentHash: artifact.content_hash,
            content: artifact.content,
            basedOnHash: artifact.based_on_hash,
            createdBy: artifact.created_by,
            confirmedBy: artifact.confirmed_by,
            confirmedAt: artifact.confirmed_at ? new Date(artifact.confirmed_at) : null,
            createdAt: new Date(artifact.created_at),
          })),
        )
      }
    })
  }

  async createRoleAggregateForHc(
    hcRequestId: string,
    aggregate: RoleAggregate,
  ): Promise<{ roleSessionId: string; created: boolean }> {
    return this.db.transaction(async (tx) => {
      const [hc] = await tx
        .select({ roleSessionId: schema.hcApprovals.roleSessionId })
        .from(schema.hcApprovals)
        .where(
          and(
            eq(schema.hcApprovals.requestId, hcRequestId),
            eq(schema.hcApprovals.tenantId, aggregate.state.tenant_id),
          ),
        )
        .for('update')
        .limit(1)
      if (!hc) throw new Error('HC_APPROVAL_NOT_FOUND')
      if (hc.roleSessionId) {
        await tx
          .update(schema.roleClarificationTasks)
          .set({
            roleSessionId: hc.roleSessionId,
            status: 'IN_PROGRESS',
            startedAt: new Date(aggregate.state.updated_at),
            updatedAt: new Date(aggregate.state.updated_at),
          })
          .where(and(
            eq(schema.roleClarificationTasks.tenantId, aggregate.state.tenant_id),
            eq(schema.roleClarificationTasks.hcRequestId, hcRequestId),
            eq(schema.roleClarificationTasks.status, 'OPEN'),
          ))
        return { roleSessionId: hc.roleSessionId, created: false }
      }

      const memberIds = [...new Set([
        ...aggregate.member_ids,
        ...(aggregate.state.hc_context?.assigned_hr_user_id
          ? [aggregate.state.hc_context.assigned_hr_user_id]
          : []),
      ])]
      const policy = this.makeDefaultPolicy(aggregate.state.id)
      await tx.insert(schema.roleSessions).values({
        id: aggregate.state.id,
        tenantId: aggregate.state.tenant_id,
        title: aggregate.state.title,
        department: aggregate.state.department,
        stage: aggregate.state.stage,
        revision: aggregate.state.revision,
        businessState: roleBusinessState(aggregate.state),
        ...this.toPolicyColumns(policy),
        createdAt: new Date(aggregate.state.created_at),
        updatedAt: new Date(aggregate.state.updated_at),
      })
      if (memberIds.length > 0) {
        await tx.insert(schema.roleMembers).values(
          memberIds.map((userId) => ({ roleSessionId: aggregate.state.id, userId })),
        )
      }
      await tx
        .update(schema.hcApprovals)
        .set({
          roleSessionId: aggregate.state.id,
          updatedAt: new Date(aggregate.state.updated_at),
        })
        .where(
          and(
            eq(schema.hcApprovals.requestId, hcRequestId),
            eq(schema.hcApprovals.tenantId, aggregate.state.tenant_id),
          ),
        )
      await tx
        .update(schema.roleClarificationTasks)
        .set({
          roleSessionId: aggregate.state.id,
          status: 'IN_PROGRESS',
          startedAt: new Date(aggregate.state.updated_at),
          updatedAt: new Date(aggregate.state.updated_at),
        })
        .where(and(
          eq(schema.roleClarificationTasks.tenantId, aggregate.state.tenant_id),
          eq(schema.roleClarificationTasks.hcRequestId, hcRequestId),
          eq(schema.roleClarificationTasks.status, 'OPEN'),
        ))
      return { roleSessionId: aggregate.state.id, created: true }
    })
  }

  async startClarificationTaskForExistingWorkspace(input: {
    tenant_id: string
    hc_request_id: string
    role_session_id: string
    started_at: string
  }): Promise<void> {
    await this.db
      .update(schema.roleClarificationTasks)
      .set({
        roleSessionId: input.role_session_id,
        status: 'IN_PROGRESS',
        startedAt: new Date(input.started_at),
        updatedAt: new Date(input.started_at),
      })
      .where(and(
        eq(schema.roleClarificationTasks.tenantId, input.tenant_id),
        eq(schema.roleClarificationTasks.hcRequestId, input.hc_request_id),
        eq(schema.roleClarificationTasks.status, 'OPEN'),
      ))
  }

  async saveRoleState(state: RoleState, expectedRevision: number): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .update(schema.roleSessions)
        .set({
          title: state.title,
          department: state.department,
          stage: state.stage,
          revision: state.revision,
          businessState: roleBusinessState(state),
          updatedAt: new Date(state.updated_at),
        })
        .where(
          and(
            eq(schema.roleSessions.id, state.id),
            eq(schema.roleSessions.revision, expectedRevision),
          ),
        )
        .returning({ id: schema.roleSessions.id })
      if (rows.length !== 1) return false
      const assignedHr = state.hc_context?.assigned_hr_user_id
      if (assignedHr) {
        await tx
          .insert(schema.roleMembers)
          .values({ roleSessionId: state.id, userId: assignedHr })
          .onConflictDoNothing()
      }
      if (state.stage === 'PROFILE_CONFIRMED') {
        await tx
          .update(schema.roleClarificationTasks)
          .set({
            status: 'COMPLETED',
            completedAt: new Date(state.updated_at),
            updatedAt: new Date(state.updated_at),
          })
          .where(and(
            eq(schema.roleClarificationTasks.roleSessionId, state.id),
            inArray(schema.roleClarificationTasks.status, ['OPEN', 'IN_PROGRESS']),
          ))
      }
      return true
    })
  }

  async commitFactDecision(input: {
    role_session_id: string
    tenant_id: string
    expected_revision: number
    state: RoleState
    artifacts: ArtifactEnvelope[]
    decisions: DecisionRecord[]
  }): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .update(schema.roleSessions)
        .set({
          title: input.state.title,
          department: input.state.department,
          stage: input.state.stage,
          revision: input.state.revision,
          businessState: roleBusinessState(input.state),
          updatedAt: new Date(input.state.updated_at),
        })
        .where(and(
          eq(schema.roleSessions.id, input.role_session_id),
          eq(schema.roleSessions.tenantId, input.tenant_id),
          eq(schema.roleSessions.revision, input.expected_revision),
        ))
        .returning({ id: schema.roleSessions.id })
      if (rows.length !== 1) return false

      for (const artifact of input.artifacts) {
        const updated = await tx
          .update(schema.artifacts)
          .set({ status: artifact.status })
          .where(and(
            eq(schema.artifacts.id, artifact.id),
            eq(schema.artifacts.roleSessionId, input.role_session_id),
          ))
          .returning({ id: schema.artifacts.id })
        if (updated.length !== 1) throw new Error('Missing artifact in atomic fact decision')
      }
      if (input.decisions.length > 0) {
        await tx.insert(schema.auditLogs).values(input.decisions.map((record) => ({
          id: record.id,
          tenantId: input.tenant_id,
          roleSessionId: record.role_session_id,
          actorUserId: record.actor_user_id,
          action: record.action,
          targetType: record.target_type,
          targetId: record.target_id,
          metadata: { ...record.metadata, audit_kind: 'HUMAN_DECISION' },
          createdAt: new Date(record.created_at),
        })))
      }
      return true
    })
  }

  async insertArtifact(artifact: ArtifactEnvelope): Promise<void> {
    await this.db.insert(schema.artifacts).values({
      id: artifact.id,
      roleSessionId: artifact.role_session_id,
      type: artifact.type,
      version: artifact.version,
      status: artifact.status,
      contentHash: artifact.content_hash,
      content: artifact.content,
      basedOnHash: artifact.based_on_hash,
      createdBy: artifact.created_by,
      confirmedBy: artifact.confirmed_by,
      confirmedAt: artifact.confirmed_at ? new Date(artifact.confirmed_at) : null,
      createdAt: new Date(artifact.created_at),
    })
  }

  async updateArtifact(artifact: ArtifactEnvelope): Promise<void> {
    await this.db
      .update(schema.artifacts)
      .set({
        status: artifact.status,
        contentHash: artifact.content_hash,
        content: artifact.content,
        basedOnHash: artifact.based_on_hash,
        confirmedBy: artifact.confirmed_by,
        confirmedAt: artifact.confirmed_at ? new Date(artifact.confirmed_at) : null,
      })
      .where(eq(schema.artifacts.id, artifact.id))
  }

  async insertCandidates(
    roleSessionId: string,
    candidates: CandidateEvidence[],
    actorUserId: string,
  ): Promise<void> {
    for (const evidence of candidates) {
      await this.db
        .insert(schema.candidates)
        .values({
          id: crypto.randomUUID(),
          roleSessionId,
          candidateRef: evidence.candidate_ref,
          channel: evidence.channel,
          evidence,
          importedBy: actorUserId,
        })
        .onConflictDoUpdate({
          target: [schema.candidates.roleSessionId, schema.candidates.candidateRef],
          set: { channel: evidence.channel, evidence, importedBy: actorUserId },
        })
    }
  }

  async insertCalibrationSignal(signal: CalibrationSignalRecord): Promise<void> {
    await this.db.insert(schema.calibrationCases).values({
      id: signal.id,
      roleSessionId: signal.role_session_id,
      signalStatus: signal.status,
      proposedChange: signal.proposed_change,
      evidenceSummary: signal.evidence_summary,
      reviewedBy: signal.reviewed_by,
      reviewReason: signal.review_reason,
      signalCreatedAt: new Date(signal.created_at),
      signalUpdatedAt: new Date(signal.updated_at),
    })
  }

  async updateCalibrationSignal(signal: CalibrationSignalRecord): Promise<void> {
    await this.db
      .update(schema.calibrationCases)
      .set({
        signalStatus: signal.status,
        proposedChange: signal.proposed_change,
        evidenceSummary: signal.evidence_summary,
        reviewedBy: signal.reviewed_by,
        reviewReason: signal.review_reason,
        signalUpdatedAt: new Date(signal.updated_at),
      })
      .where(eq(schema.calibrationCases.id, signal.id))
  }

  async insertManagerTask(task: ManagerTaskRecord): Promise<void> {
    const rows = await this.db
      .update(schema.calibrationCases)
      .set({
        managerTaskId: task.id,
        assigneeUserId: task.assignee_user_id,
        managerTaskStatus: task.status,
        decisionReason: task.decision_reason,
        dueAt: new Date(task.due_at),
        taskCreatedAt: new Date(task.created_at),
        completedAt: task.completed_at ? new Date(task.completed_at) : null,
      })
      .where(
        and(
          eq(schema.calibrationCases.id, task.signal_id),
          eq(schema.calibrationCases.roleSessionId, task.role_session_id),
        ),
      )
      .returning({ id: schema.calibrationCases.id })
    if (rows.length !== 1) throw new Error('CALIBRATION_CASE_NOT_FOUND')
  }

  async updateManagerTask(task: ManagerTaskRecord): Promise<void> {
    await this.db
      .update(schema.calibrationCases)
      .set({
        managerTaskStatus: task.status,
        decisionReason: task.decision_reason,
        completedAt: task.completed_at ? new Date(task.completed_at) : null,
      })
      .where(eq(schema.calibrationCases.managerTaskId, task.id))
  }

  async appendDecision(record: DecisionRecord): Promise<void> {
    const role = await this.db.query.roleSessions.findFirst({
      where: eq(schema.roleSessions.id, record.role_session_id),
      columns: { tenantId: true },
    })
    if (!role) throw new Error('ROLE_SESSION_NOT_FOUND')
    await this.db.insert(schema.auditLogs).values({
      id: record.id,
      tenantId: role.tenantId,
      roleSessionId: record.role_session_id,
      actorUserId: record.actor_user_id,
      action: record.action,
      targetType: record.target_type,
      targetId: record.target_id,
      metadata: { ...record.metadata, audit_kind: 'HUMAN_DECISION' },
      createdAt: new Date(record.created_at),
    })
  }

  async createRun(run: AgentRun): Promise<void> {
    await this.db.insert(schema.agentRuns).values({
      id: run.id,
      roleSessionId: run.role_session_id,
      actorUserId: run.actor_user_id,
      effectiveActorRole: run.effective_actor_role,
      status: run.status,
      modelTier: run.model_tier,
      task: run.task,
      harnessSessionId: run.harness_session_id,
      promptVersion: run.prompt_version,
      modelName: run.model_name,
      toolCount: run.tool_count,
      inputTokens: run.input_tokens,
      outputTokens: run.output_tokens,
      startedAt: run.started_at ? new Date(run.started_at) : null,
      completedAt: run.completed_at ? new Date(run.completed_at) : null,
      errorCode: run.error_code,
      inputMessageId: run.input_message_id,
      outputMessageId: run.output_message_id,
    })
  }

  async getRun(runId: string): Promise<RunRecord | null> {
    const row = await this.db.query.agentRuns.findFirst({
      where: eq(schema.agentRuns.id, runId),
    })
    return row ? { run: agentRunFromRow(row), cancel_requested: row.cancelRequested } : null
  }

  async listActiveRuns(): Promise<RunRecord[]> {
    const rows = await this.db
      .select()
      .from(schema.agentRuns)
      .where(inArray(schema.agentRuns.status, ['QUEUED', 'RUNNING']))
      .orderBy(asc(schema.agentRuns.createdAt))
    return rows.map((row) => ({ run: agentRunFromRow(row), cancel_requested: row.cancelRequested }))
  }

  async findActiveRunByRole(roleSessionId: string): Promise<RunRecord | null> {
    const [row] = await this.db
      .select()
      .from(schema.agentRuns)
      .where(
        and(
          eq(schema.agentRuns.roleSessionId, roleSessionId),
          inArray(schema.agentRuns.status, ['QUEUED', 'RUNNING']),
        ),
      )
      .orderBy(desc(schema.agentRuns.createdAt))
      .limit(1)
    return row ? { run: agentRunFromRow(row), cancel_requested: row.cancelRequested } : null
  }

  async updateRun(run: AgentRun): Promise<void> {
    await this.db
      .update(schema.agentRuns)
      .set({
        status: run.status,
        modelTier: run.model_tier,
        effectiveActorRole: run.effective_actor_role,
        task: run.task,
        harnessSessionId: run.harness_session_id,
        promptVersion: run.prompt_version,
        modelName: run.model_name,
        toolCount: run.tool_count,
        inputTokens: run.input_tokens,
        outputTokens: run.output_tokens,
        startedAt: run.started_at ? new Date(run.started_at) : null,
        completedAt: run.completed_at ? new Date(run.completed_at) : null,
        errorCode: run.error_code,
        inputMessageId: run.input_message_id,
        outputMessageId: run.output_message_id,
        updatedAt: new Date(),
      })
      .where(eq(schema.agentRuns.id, run.id))
  }

  async requestRunCancel(runId: string): Promise<boolean> {
    const rows = await this.db
      .update(schema.agentRuns)
      .set({ cancelRequested: true, updatedAt: new Date() })
      .where(eq(schema.agentRuns.id, runId))
      .returning({ id: schema.agentRuns.id })
    return rows.length === 1
  }

  async appendRunEvent(event: AgentEvent): Promise<void> {
    await this.db.insert(schema.agentRunEvents).values({
      id: event.id,
      runId: event.run_id,
      sequence: event.sequence,
      type: event.type,
      payload: event.payload,
      createdAt: new Date(event.created_at),
    })
    for (const subscriber of this.subscribers.get(event.run_id) ?? []) subscriber(event)
  }

  async listRunEvents(runId: string, afterSequence = 0): Promise<AgentEvent[]> {
    const rows = await this.db
      .select()
      .from(schema.agentRunEvents)
      .where(
        and(
          eq(schema.agentRunEvents.runId, runId),
          gt(schema.agentRunEvents.sequence, afterSequence),
        ),
      )
      .orderBy(asc(schema.agentRunEvents.sequence))
    return rows.map(agentEventFromRow)
  }

  subscribeToRun(runId: string, subscriber: EventSubscriber): () => void {
    const subscribers = this.subscribers.get(runId) ?? new Set<EventSubscriber>()
    subscribers.add(subscriber)
    this.subscribers.set(runId, subscribers)
    return () => {
      subscribers.delete(subscriber)
      if (subscribers.size === 0) this.subscribers.delete(runId)
    }
  }

  async listConversationMessages(
    roleSessionId: string,
    afterSequence = 0,
  ): Promise<ConversationMessage[]> {
    const rows = await this.db
      .select()
      .from(schema.conversationMessages)
      .where(
        and(
          eq(schema.conversationMessages.roleSessionId, roleSessionId),
          gt(schema.conversationMessages.sequence, afterSequence),
        ),
      )
      .orderBy(asc(schema.conversationMessages.sequence))
    return rows.map(conversationMessageFromRow)
  }

  async appendConversationMessage(message: ConversationMessage): Promise<void> {
    await this.db.insert(schema.conversationMessages).values({
      id: message.id,
      tenantId: message.tenant_id,
      roleSessionId: message.role_session_id,
      runId: message.run_id,
      clarificationRoundId: message.clarification_round_id,
      senderKind: message.sender_type === 'HUMAN'
        ? message.sender_role ?? 'HUMAN'
        : message.sender_type,
      senderUserId: message.sender_user_id,
      senderName: message.sender_name,
      content: message.content,
      structuredContent: message.structured_content,
      status: message.status,
      sequence: message.sequence,
      createdAt: new Date(message.created_at),
      completedAt: message.completed_at ? new Date(message.completed_at) : null,
    })
  }

  async appendConversationMessageIfAbsent(message: ConversationMessage): Promise<boolean> {
    const rows = await this.db.insert(schema.conversationMessages).values({
      id: message.id,
      tenantId: message.tenant_id,
      roleSessionId: message.role_session_id,
      runId: message.run_id,
      clarificationRoundId: message.clarification_round_id,
      senderKind: message.sender_type === 'HUMAN'
        ? message.sender_role ?? 'HUMAN'
        : message.sender_type,
      senderUserId: message.sender_user_id,
      senderName: message.sender_name,
      content: message.content,
      structuredContent: message.structured_content,
      status: message.status,
      sequence: message.sequence,
      createdAt: new Date(message.created_at),
      completedAt: message.completed_at ? new Date(message.completed_at) : null,
    }).onConflictDoNothing().returning({ id: schema.conversationMessages.id })
    return rows.length > 0
  }

  async updateConversationMessage(message: ConversationMessage): Promise<void> {
    await this.db
      .update(schema.conversationMessages)
      .set({
        runId: message.run_id,
        clarificationRoundId: message.clarification_round_id,
        content: message.content,
        structuredContent: message.structured_content,
        status: message.status,
        completedAt: message.completed_at ? new Date(message.completed_at) : null,
      })
      .where(eq(schema.conversationMessages.id, message.id))
  }

  async getClarificationPolicy(roleSessionId: string): Promise<ClarificationPolicy> {
    const row = await this.db.query.roleSessions.findFirst({
      where: eq(schema.roleSessions.id, roleSessionId),
    })
    if (!row) throw new Error('ROLE_SESSION_NOT_FOUND')
    return this.policyFromRoleRow(row)
  }

  async saveClarificationPolicy(policy: ClarificationPolicy): Promise<void> {
    const rows = await this.db
      .update(schema.roleSessions)
      .set(this.toPolicyColumns(policy))
      .where(eq(schema.roleSessions.id, policy.role_session_id))
      .returning({ id: schema.roleSessions.id })
    if (rows.length !== 1) throw new Error('ROLE_SESSION_NOT_FOUND')
  }

  async getOpenClarificationRound(roleSessionId: string): Promise<ClarificationRound | null> {
    const row = await this.db.query.clarificationRounds.findFirst({
      where: and(
        eq(schema.clarificationRounds.roleSessionId, roleSessionId),
        eq(schema.clarificationRounds.status, 'OPEN'),
      ),
    })
    return row ? clarificationRoundFromRow(row) : null
  }

  async insertClarificationRound(round: ClarificationRound): Promise<void> {
    await this.db.insert(schema.clarificationRounds).values({
      id: round.id,
      roleSessionId: round.role_session_id,
      ordinal: round.ordinal,
      status: round.status,
      question: round.question,
      openedByRunId: round.opened_by_run_id,
      resolvedByMessageId: round.resolved_by_message_id,
      createdAt: new Date(round.created_at),
      completedAt: round.completed_at ? new Date(round.completed_at) : null,
    })
  }

  async updateClarificationRound(round: ClarificationRound): Promise<void> {
    await this.db
      .update(schema.clarificationRounds)
      .set({
        status: round.status,
        question: round.question,
        resolvedByMessageId: round.resolved_by_message_id,
        completedAt: round.completed_at ? new Date(round.completed_at) : null,
      })
      .where(eq(schema.clarificationRounds.id, round.id))
  }

  async listRunsForTenant(
    tenantId: string,
    filters: AdminRunFilters,
  ): Promise<AdminRunPage> {
    const conditions = [eq(schema.roleSessions.tenantId, tenantId)]
    if (filters.status) conditions.push(eq(schema.agentRuns.status, filters.status))
    if (filters.model_tier) conditions.push(eq(schema.agentRuns.modelTier, filters.model_tier))
    if (filters.role_session_id) {
      conditions.push(eq(schema.agentRuns.roleSessionId, filters.role_session_id))
    }
    const keyword = filters.query?.trim()
    if (keyword) {
      const pattern = `%${keyword}%`
      const search = or(
        ilike(schema.roleSessions.title, pattern),
        ilike(schema.users.displayName, pattern),
        ilike(schema.agentRuns.modelName, pattern),
        sql<boolean>`${schema.agentRuns.id}::text ILIKE ${pattern}`,
      )
      if (search) conditions.push(search)
    }
    const where = and(...conditions)
    const [rows, totals] = await Promise.all([
      this.db
      .select({
        run: schema.agentRuns,
        cancelRequested: schema.agentRuns.cancelRequested,
        roleTitle: schema.roleSessions.title,
        actorDisplayName: schema.users.displayName,
        actorRole: schema.users.role,
      })
      .from(schema.agentRuns)
      .innerJoin(schema.roleSessions, eq(schema.agentRuns.roleSessionId, schema.roleSessions.id))
      .leftJoin(schema.users, eq(schema.agentRuns.actorUserId, schema.users.id))
      .where(where)
      .orderBy(desc(schema.agentRuns.createdAt))
      .limit(filters.page_size)
      .offset((filters.page - 1) * filters.page_size),
      this.db
        .select({ value: count() })
        .from(schema.agentRuns)
        .innerJoin(schema.roleSessions, eq(schema.agentRuns.roleSessionId, schema.roleSessions.id))
        .leftJoin(schema.users, eq(schema.agentRuns.actorUserId, schema.users.id))
        .where(where),
    ])
    return {
      items: rows.map((row) => ({
        run: agentRunFromRow(row.run),
        cancel_requested: row.cancelRequested,
        role_title: row.roleTitle,
        actor_display_name: row.actorDisplayName ?? row.run.actorUserId,
        actor_role: row.actorRole ?? row.run.effectiveActorRole,
      })),
      total: Number(totals[0]?.value ?? 0),
      page: filters.page,
      page_size: filters.page_size,
    }
  }

  async appendTraceAccessAudit(record: TraceAccessAuditRecord): Promise<void> {
    const run = await this.db.query.agentRuns.findFirst({
      where: eq(schema.agentRuns.id, record.run_id),
      columns: { roleSessionId: true },
    })
    if (!run) throw new Error('AGENT_RUN_NOT_FOUND')
    await this.db.insert(schema.auditLogs).values({
      id: record.id,
      tenantId: record.tenant_id,
      roleSessionId: run.roleSessionId,
      actorUserId: record.actor_user_id,
      action: record.action,
      targetType: 'AGENT_RUN',
      targetId: record.run_id,
      metadata: { audit_kind: 'TRACE_ACCESS', reason: record.reason },
      createdAt: new Date(record.created_at),
    })
  }

  async listTraceAccessAudits(tenantId: string): Promise<TraceAccessAuditRecord[]> {
    const rows = await this.db
      .select()
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.tenantId, tenantId),
          eq(schema.auditLogs.targetType, 'AGENT_RUN'),
        ),
      )
      .orderBy(desc(schema.auditLogs.createdAt))
      .limit(200)
    return rows.map((row) => ({
      id: row.id,
      tenant_id: row.tenantId,
      actor_user_id: row.actorUserId,
      run_id: row.targetId,
      action: row.action as TraceAccessAuditRecord['action'],
      reason: typeof row.metadata.reason === 'string' ? row.metadata.reason : null,
      created_at: iso(row.createdAt),
    }))
  }

  private async updateClaimedNotification(
    id: string,
    workerId: string,
    values: Partial<typeof schema.notificationOutbox.$inferInsert>,
  ): Promise<void> {
    await this.db
      .update(schema.notificationOutbox)
      .set(values)
      .where(and(
        eq(schema.notificationOutbox.id, id),
        eq(schema.notificationOutbox.status, 'PROCESSING'),
        eq(schema.notificationOutbox.lockedBy, workerId),
      ))
  }

  private async hcApprovalsWithSummaries(rows: HcApprovalRow[]): Promise<HcApproval[]> {
    if (rows.length === 0) return []
    const tenantId = rows[0]!.tenantId
    const tasks = await this.db
      .select()
      .from(schema.roleClarificationTasks)
      .where(and(
        eq(schema.roleClarificationTasks.tenantId, tenantId),
        inArray(
          schema.roleClarificationTasks.hcRequestId,
          rows.map((row) => row.requestId),
        ),
      ))
    const taskByHc = new Map(tasks.map((task) => [task.hcRequestId, task]))
    const notifications = tasks.length > 0
      ? await this.db
          .select()
          .from(schema.notificationOutbox)
          .where(inArray(schema.notificationOutbox.taskId, tasks.map((task) => task.id)))
          .orderBy(desc(schema.notificationOutbox.createdAt))
      : []
    const notificationByTask = new Map<string, NotificationOutboxRow>()
    for (const notification of notifications) {
      if (!notificationByTask.has(notification.taskId)) {
        notificationByTask.set(notification.taskId, notification)
      }
    }
    return rows.map((row) => {
      const task = taskByHc.get(row.requestId)
      return hcApprovalFromRow(row, task, task ? notificationByTask.get(task.id) : undefined)
    })
  }

  private makeDefaultPolicy(roleSessionId: string): ClarificationPolicy {
    return {
      role_session_id: roleSessionId,
      initial_budget: 6,
      granted_rounds: 0,
      extension_size: 2,
      completed_rounds: 0,
      opened_rounds: 0,
      open_round_id: null,
      status: 'ACTIVE',
      updated_by: null,
      updated_at: new Date().toISOString(),
    }
  }

  private policyFromRoleRow(row: RoleSessionRow): ClarificationPolicy {
    return {
      role_session_id: row.id,
      initial_budget: row.clarificationInitialBudget,
      granted_rounds: row.clarificationGrantedRounds,
      extension_size: row.clarificationExtensionSize,
      completed_rounds: row.clarificationCompletedRounds,
      opened_rounds: row.clarificationOpenedRounds,
      open_round_id: row.clarificationOpenRoundId,
      status: row.clarificationStatus as ClarificationPolicy['status'],
      updated_by: row.clarificationUpdatedBy,
      updated_at: iso(row.clarificationUpdatedAt),
    }
  }

  private toPolicyColumns(policy: ClarificationPolicy) {
    return {
      clarificationInitialBudget: policy.initial_budget,
      clarificationGrantedRounds: policy.granted_rounds,
      clarificationExtensionSize: policy.extension_size,
      clarificationCompletedRounds: policy.completed_rounds,
      clarificationOpenedRounds: policy.opened_rounds,
      clarificationOpenRoundId: policy.open_round_id,
      clarificationStatus: policy.status,
      clarificationUpdatedBy: policy.updated_by,
      clarificationUpdatedAt: new Date(policy.updated_at),
    }
  }
}
