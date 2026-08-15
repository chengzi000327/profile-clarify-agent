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
  RunRecord,
  StoredUser,
  TraceAccessAuditRecord,
} from './types.js'
import { createDemoAggregate, demoUsers } from './seed.js'

const iso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString()

export class PostgresStore implements ApplicationStore {
  private readonly client: Sql
  private readonly db: PostgresJsDatabase<typeof schema>
  private readonly subscribers = new Map<string, Set<EventSubscriber>>()

  constructor(databaseUrl: string) {
    this.client = postgres(databaseUrl, { max: 10, prepare: false })
    this.db = drizzle(this.client, { schema })
  }

  async initialize(): Promise<void> {
    for (const user of demoUsers) {
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
            tenantId: user.tenant_id,
            displayName: user.display_name,
            role: user.role,
            active: user.active,
          },
        })
    }

    const [existing] = await this.db
      .select({ id: schema.roleSessions.id })
      .from(schema.roleSessions)
      .limit(1)
    if (!existing) await this.createRoleAggregate(createDemoAggregate())

    const roleRows = await this.db.select({ id: schema.roleSessions.id }).from(schema.roleSessions)
    for (const role of roleRows) {
      const policy = this.makeDefaultPolicy(role.id)
      await this.db
        .insert(schema.clarificationPolicies)
        .values(this.toPolicyRow(policy))
        .onConflictDoNothing()
    }
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

  async listRoleStates(actor: ActorContext): Promise<RoleState[]> {
    if (actor.role === 'ADMIN') {
      const rows = await this.db
        .select({ state: schema.roleSessions.state })
        .from(schema.roleSessions)
        .where(eq(schema.roleSessions.tenantId, actor.tenant_id))
        .orderBy(desc(schema.roleSessions.updatedAt))
      return rows.map((row) => row.state)
    }
    const rows = await this.db
      .select({ state: schema.roleSessions.state })
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
    return rows.map((row) => row.state)
  }

  async getRoleAggregate(roleSessionId: string, actor: ActorContext): Promise<RoleAggregate | null> {
    const [access] = actor.role === 'ADMIN'
      ? await this.db
          .select({ state: schema.roleSessions.state })
          .from(schema.roleSessions)
          .where(
            and(
              eq(schema.roleSessions.id, roleSessionId),
              eq(schema.roleSessions.tenantId, actor.tenant_id),
            ),
          )
          .limit(1)
      : await this.db
          .select({ state: schema.roleSessions.state })
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

    const [memberRows, artifactRows, candidateRows, signalRows, taskRows] = await Promise.all([
      this.db
        .select({ userId: schema.roleMembers.userId })
        .from(schema.roleMembers)
        .where(eq(schema.roleMembers.roleSessionId, roleSessionId)),
      this.db
        .select({ envelope: schema.artifacts.envelope })
        .from(schema.artifacts)
        .where(eq(schema.artifacts.roleSessionId, roleSessionId))
        .orderBy(asc(schema.artifacts.type), asc(schema.artifacts.version)),
      this.db
        .select({ evidence: schema.candidates.evidence })
        .from(schema.candidates)
        .where(eq(schema.candidates.roleSessionId, roleSessionId)),
      this.db
        .select()
        .from(schema.calibrationSignals)
        .where(eq(schema.calibrationSignals.roleSessionId, roleSessionId))
        .orderBy(desc(schema.calibrationSignals.createdAt)),
      this.db
        .select()
        .from(schema.managerTasks)
        .where(eq(schema.managerTasks.roleSessionId, roleSessionId))
        .orderBy(desc(schema.managerTasks.createdAt)),
    ])

    return {
      state: access.state,
      member_ids: memberRows.map((row) => row.userId),
      artifacts: artifactRows.map((row) => row.envelope),
      candidates: candidateRows.map((row) => row.evidence),
      calibration_signals: signalRows.map((row) => ({
        id: row.id,
        role_session_id: row.roleSessionId,
        status: row.status as CalibrationSignalRecord['status'],
        proposed_change: row.proposedChange,
        evidence_summary: row.evidenceSummary,
        reviewed_by: row.reviewedBy,
        review_reason: row.reviewReason,
        created_at: iso(row.createdAt),
        updated_at: iso(row.updatedAt),
      })),
      manager_tasks: taskRows.map((row) => ({
        id: row.id,
        role_session_id: row.roleSessionId,
        signal_id: row.signalId,
        assignee_user_id: row.assigneeUserId,
        status: row.status as ManagerTaskRecord['status'],
        decision_reason: row.decisionReason,
        due_at: iso(row.dueAt),
        created_at: iso(row.createdAt),
        completed_at: row.completedAt ? iso(row.completedAt) : null,
      })),
    }
  }

  async createRoleAggregate(aggregate: RoleAggregate): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.insert(schema.roleSessions).values({
        id: aggregate.state.id,
        tenantId: aggregate.state.tenant_id,
        title: aggregate.state.title,
        department: aggregate.state.department,
        stage: aggregate.state.stage,
        revision: aggregate.state.revision,
        state: aggregate.state,
        createdAt: new Date(aggregate.state.created_at),
        updatedAt: new Date(aggregate.state.updated_at),
      })
      const policy = this.makeDefaultPolicy(aggregate.state.id)
      await tx.insert(schema.clarificationPolicies).values(this.toPolicyRow(policy))
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
            envelope: artifact,
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
        state,
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
      envelope: artifact,
      createdAt: new Date(artifact.created_at),
    })
  }

  async updateArtifact(artifact: ArtifactEnvelope): Promise<void> {
    await this.db
      .update(schema.artifacts)
      .set({
        status: artifact.status,
        contentHash: artifact.content_hash,
        envelope: artifact,
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
    await this.db.insert(schema.calibrationSignals).values({
      id: signal.id,
      roleSessionId: signal.role_session_id,
      status: signal.status,
      proposedChange: signal.proposed_change,
      evidenceSummary: signal.evidence_summary,
      reviewedBy: signal.reviewed_by,
      reviewReason: signal.review_reason,
      createdAt: new Date(signal.created_at),
      updatedAt: new Date(signal.updated_at),
    })
  }

  async updateCalibrationSignal(signal: CalibrationSignalRecord): Promise<void> {
    await this.db
      .update(schema.calibrationSignals)
      .set({
        status: signal.status,
        proposedChange: signal.proposed_change,
        evidenceSummary: signal.evidence_summary,
        reviewedBy: signal.reviewed_by,
        reviewReason: signal.review_reason,
        updatedAt: new Date(signal.updated_at),
      })
      .where(eq(schema.calibrationSignals.id, signal.id))
  }

  async insertManagerTask(task: ManagerTaskRecord): Promise<void> {
    await this.db.insert(schema.managerTasks).values({
      id: task.id,
      roleSessionId: task.role_session_id,
      signalId: task.signal_id,
      assigneeUserId: task.assignee_user_id,
      status: task.status,
      decisionReason: task.decision_reason,
      dueAt: new Date(task.due_at),
      createdAt: new Date(task.created_at),
      completedAt: task.completed_at ? new Date(task.completed_at) : null,
    })
  }

  async updateManagerTask(task: ManagerTaskRecord): Promise<void> {
    await this.db
      .update(schema.managerTasks)
      .set({
        status: task.status,
        decisionReason: task.decision_reason,
        completedAt: task.completed_at ? new Date(task.completed_at) : null,
      })
      .where(eq(schema.managerTasks.id, task.id))
  }

  async appendDecision(record: DecisionRecord): Promise<void> {
    await this.db.insert(schema.decisionLogs).values({
      id: record.id,
      roleSessionId: record.role_session_id,
      actorUserId: record.actor_user_id,
      action: record.action,
      targetType: record.target_type,
      targetId: record.target_id,
      metadata: record.metadata,
      createdAt: new Date(record.created_at),
    })
  }

  async createRun(run: AgentRun): Promise<void> {
    await this.db.insert(schema.agentRuns).values({
      id: run.id,
      roleSessionId: run.role_session_id,
      actorUserId: run.actor_user_id,
      status: run.status,
      run,
    })
  }

  async getRun(runId: string): Promise<RunRecord | null> {
    const row = await this.db.query.agentRuns.findFirst({
      where: eq(schema.agentRuns.id, runId),
    })
    return row ? { run: row.run, cancel_requested: row.cancelRequested } : null
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
    return row ? { run: row.run, cancel_requested: row.cancelRequested } : null
  }

  async updateRun(run: AgentRun): Promise<void> {
    await this.db
      .update(schema.agentRuns)
      .set({ status: run.status, run, updatedAt: new Date() })
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
      event,
      createdAt: new Date(event.created_at),
    })
    for (const subscriber of this.subscribers.get(event.run_id) ?? []) subscriber(event)
  }

  async listRunEvents(runId: string, afterSequence = 0): Promise<AgentEvent[]> {
    const rows = await this.db
      .select({ event: schema.agentRunEvents.event })
      .from(schema.agentRunEvents)
      .where(
        and(
          eq(schema.agentRunEvents.runId, runId),
          gt(schema.agentRunEvents.sequence, afterSequence),
        ),
      )
      .orderBy(asc(schema.agentRunEvents.sequence))
    return rows.map((row) => row.event)
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
      .select({ message: schema.conversationMessages.message })
      .from(schema.conversationMessages)
      .where(
        and(
          eq(schema.conversationMessages.roleSessionId, roleSessionId),
          gt(schema.conversationMessages.sequence, afterSequence),
        ),
      )
      .orderBy(asc(schema.conversationMessages.sequence))
    return rows.map((row) => row.message)
  }

  async appendConversationMessage(message: ConversationMessage): Promise<void> {
    await this.db.insert(schema.conversationMessages).values({
      id: message.id,
      tenantId: message.tenant_id,
      roleSessionId: message.role_session_id,
      runId: message.run_id,
      clarificationRoundId: message.clarification_round_id,
      senderType: message.sender_type,
      senderUserId: message.sender_user_id,
      senderRole: message.sender_role,
      senderName: message.sender_name,
      content: message.content,
      structuredContent: message.structured_content,
      status: message.status,
      sequence: message.sequence,
      message,
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
        message,
        completedAt: message.completed_at ? new Date(message.completed_at) : null,
      })
      .where(eq(schema.conversationMessages.id, message.id))
  }

  async getClarificationPolicy(roleSessionId: string): Promise<ClarificationPolicy> {
    const row = await this.db.query.clarificationPolicies.findFirst({
      where: eq(schema.clarificationPolicies.roleSessionId, roleSessionId),
    })
    if (row) return row.policy
    const policy = this.makeDefaultPolicy(roleSessionId)
    await this.db.insert(schema.clarificationPolicies).values(this.toPolicyRow(policy))
    return policy
  }

  async saveClarificationPolicy(policy: ClarificationPolicy): Promise<void> {
    await this.db
      .insert(schema.clarificationPolicies)
      .values(this.toPolicyRow(policy))
      .onConflictDoUpdate({
        target: schema.clarificationPolicies.roleSessionId,
        set: this.toPolicyRow(policy),
      })
  }

  async getOpenClarificationRound(roleSessionId: string): Promise<ClarificationRound | null> {
    const row = await this.db.query.clarificationRounds.findFirst({
      where: and(
        eq(schema.clarificationRounds.roleSessionId, roleSessionId),
        eq(schema.clarificationRounds.status, 'OPEN'),
      ),
    })
    return row?.round ?? null
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
      round,
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
        round,
        completedAt: round.completed_at ? new Date(round.completed_at) : null,
      })
      .where(eq(schema.clarificationRounds.id, round.id))
  }

  async listRunsForTenant(tenantId: string): Promise<AdminRunRecord[]> {
    const rows = await this.db
      .select({
        run: schema.agentRuns.run,
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
      run: row.run,
      cancel_requested: row.cancelRequested,
      role_title: row.roleTitle,
      actor_display_name: row.actorDisplayName,
      actor_role: row.actorRole,
    }))
  }

  async appendTraceAccessAudit(record: TraceAccessAuditRecord): Promise<void> {
    await this.db.insert(schema.traceAccessAudits).values({
      id: record.id,
      tenantId: record.tenant_id,
      actorUserId: record.actor_user_id,
      runId: record.run_id,
      action: record.action,
      reason: record.reason,
      createdAt: new Date(record.created_at),
    })
  }

  async listTraceAccessAudits(tenantId: string): Promise<TraceAccessAuditRecord[]> {
    const rows = await this.db
      .select()
      .from(schema.traceAccessAudits)
      .where(eq(schema.traceAccessAudits.tenantId, tenantId))
      .orderBy(desc(schema.traceAccessAudits.createdAt))
      .limit(200)
    return rows.map((row) => ({
      id: row.id,
      tenant_id: row.tenantId,
      actor_user_id: row.actorUserId,
      run_id: row.runId,
      action: row.action as TraceAccessAuditRecord['action'],
      reason: row.reason,
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

  private toPolicyRow(policy: ClarificationPolicy) {
    return {
      roleSessionId: policy.role_session_id,
      initialBudget: policy.initial_budget,
      grantedRounds: policy.granted_rounds,
      extensionSize: policy.extension_size,
      completedRounds: policy.completed_rounds,
      openedRounds: policy.opened_rounds,
      openRoundId: policy.open_round_id,
      status: policy.status,
      updatedBy: policy.updated_by,
      policy,
      updatedAt: new Date(policy.updated_at),
    }
  }
}
