import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
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
  RoleState,
} from '@role-clarifier/contracts'
import * as schema from '../db/schema.js'
import type {
  AdminRunRecord,
  ApplicationStore,
  CalibrationSignalRecord,
  DecisionRecord,
  EventSubscriber,
  ManagerTaskRecord,
  RoleAggregate,
  RoleAggregateReadOptions,
  RunRecord,
  StoredUser,
  TraceAccessAuditRecord,
} from './types.js'

const iso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString()

type RoleSessionRow = typeof schema.roleSessions.$inferSelect
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
  facts: state.facts,
  conflicts: state.conflicts,
  latest_artifacts: state.latest_artifacts,
  candidate_count: state.candidate_count,
  candidate_channels: state.candidate_channels,
  calibration_status: state.calibration_status,
})

const roleStateFromRow = (row: RoleSessionRow): RoleState => ({
  ...row.businessState,
  id: row.id,
  tenant_id: row.tenantId,
  title: row.title,
  department: row.department,
  stage: row.stage as RoleState['stage'],
  revision: row.revision,
  created_at: iso(row.createdAt),
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
      if (aggregate.member_ids.length > 0) {
        await tx.insert(schema.roleMembers).values(
          aggregate.member_ids.map((userId) => ({
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

  async saveRoleState(state: RoleState, expectedRevision: number): Promise<boolean> {
    const rows = await this.db
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
    return rows.length === 1
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

  async listRunsForTenant(tenantId: string): Promise<AdminRunRecord[]> {
    const rows = await this.db
      .select({
        run: schema.agentRuns,
        cancelRequested: schema.agentRuns.cancelRequested,
        roleTitle: schema.roleSessions.title,
        actorDisplayName: schema.users.displayName,
        actorRole: schema.users.role,
      })
      .from(schema.agentRuns)
      .innerJoin(schema.roleSessions, eq(schema.agentRuns.roleSessionId, schema.roleSessions.id))
      .innerJoin(schema.users, eq(schema.agentRuns.actorUserId, schema.users.id))
      .where(eq(schema.roleSessions.tenantId, tenantId))
      .orderBy(desc(schema.agentRuns.createdAt))
      .limit(200)
    return rows.map((row) => ({
      run: agentRunFromRow(row.run),
      cancel_requested: row.cancelRequested,
      role_title: row.roleTitle,
      actor_display_name: row.actorDisplayName,
      actor_role: row.actorRole,
    }))
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
