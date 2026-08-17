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
import { createDemoAggregate, demoUsers } from './seed.js'

const clone = <T>(value: T): T => structuredClone(value)

export class MemoryStore implements ApplicationStore {
  private readonly users = new Map<string, StoredUser>()
  private readonly roles = new Map<string, RoleAggregate>()
  private readonly runs = new Map<string, RunRecord>()
  private readonly events = new Map<string, AgentEvent[]>()
  private readonly messages = new Map<string, ConversationMessage[]>()
  private readonly policies = new Map<string, ClarificationPolicy>()
  private readonly rounds = new Map<string, ClarificationRound[]>()
  private readonly subscribers = new Map<string, Set<EventSubscriber>>()
  private readonly decisions: DecisionRecord[] = []
  private readonly traceAudits: TraceAccessAuditRecord[] = []
  private readonly externalEvents = new Set<string>()

  async initialize(): Promise<void> {
    for (const user of demoUsers) this.users.set(user.user_id, clone(user))
    const aggregate = createDemoAggregate()
    this.roles.set(aggregate.state.id, aggregate)
    this.policies.set(aggregate.state.id, this.makeDefaultPolicy(aggregate.state.id))
  }

  async close(): Promise<void> {}

  async getUser(userId: string): Promise<StoredUser | null> {
    return clone(this.users.get(userId) ?? null)
  }

  async saveUser(user: StoredUser): Promise<void> {
    this.users.set(user.user_id, clone(user))
  }

  async claimExternalEvent(channel: string, eventId: string): Promise<boolean> {
    const key = `${channel}:${eventId}`
    if (this.externalEvents.has(key)) return false
    this.externalEvents.add(key)
    return true
  }

  async listRoleStates(actor: ActorContext): Promise<RoleState[]> {
    return [...this.roles.values()]
      .filter(
        ({ state, member_ids }) =>
          state.tenant_id === actor.tenant_id &&
          (
            actor.role === 'ADMIN' ||
            member_ids.includes(actor.user_id)
          ),
      )
      .map(({ state }) => clone(state))
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
  }

  async getRoleAggregate(
    roleSessionId: string,
    actor: ActorContext,
    options?: RoleAggregateReadOptions,
  ): Promise<RoleAggregate | null> {
    const aggregate = this.roles.get(roleSessionId)
    if (
      !aggregate ||
      aggregate.state.tenant_id !== actor.tenant_id ||
      (
        actor.role !== 'ADMIN' &&
        !aggregate.member_ids.includes(actor.user_id)
      )
    ) {
      return null
    }
    const selected = clone(aggregate)
    if (options?.members === false) selected.member_ids = []
    if (options?.artifacts === false) selected.artifacts = []
    if (options?.candidates === false) selected.candidates = []
    if (options?.calibration_signals === false) selected.calibration_signals = []
    if (options?.manager_tasks === false) selected.manager_tasks = []
    return selected
  }

  async createRoleAggregate(aggregate: RoleAggregate): Promise<void> {
    const assignedHr = aggregate.state.hc_context?.assigned_hr_user_id
    const memberIds = [...new Set([
      ...aggregate.member_ids,
      ...(assignedHr ? [assignedHr] : []),
    ])]
    this.roles.set(aggregate.state.id, clone({ ...aggregate, member_ids: memberIds }))
    this.policies.set(aggregate.state.id, this.makeDefaultPolicy(aggregate.state.id))
  }

  async saveRoleState(state: RoleState, expectedRevision: number): Promise<boolean> {
    const aggregate = this.roles.get(state.id)
    if (!aggregate || aggregate.state.revision !== expectedRevision) return false
    aggregate.state = clone(state)
    const assignedHr = state.hc_context?.assigned_hr_user_id
    if (assignedHr && !aggregate.member_ids.includes(assignedHr)) aggregate.member_ids.push(assignedHr)
    return true
  }

  async insertArtifact(artifact: ArtifactEnvelope): Promise<void> {
    const aggregate = this.roles.get(artifact.role_session_id)
    if (!aggregate) throw new Error('Missing role aggregate')
    aggregate.artifacts.push(clone(artifact))
  }

  async updateArtifact(artifact: ArtifactEnvelope): Promise<void> {
    const aggregate = this.roles.get(artifact.role_session_id)
    if (!aggregate) throw new Error('Missing role aggregate')
    const index = aggregate.artifacts.findIndex((item) => item.id === artifact.id)
    if (index < 0) throw new Error('Missing artifact')
    aggregate.artifacts[index] = clone(artifact)
  }

  async insertCandidates(
    roleSessionId: string,
    candidates: CandidateEvidence[],
    _actorUserId: string,
  ): Promise<void> {
    const aggregate = this.roles.get(roleSessionId)
    if (!aggregate) throw new Error('Missing role aggregate')
    for (const candidate of candidates) {
      const index = aggregate.candidates.findIndex(
        (item) => item.candidate_ref === candidate.candidate_ref,
      )
      if (index >= 0) aggregate.candidates[index] = clone(candidate)
      else aggregate.candidates.push(clone(candidate))
    }
  }

  async insertCalibrationSignal(signal: CalibrationSignalRecord): Promise<void> {
    const aggregate = this.roles.get(signal.role_session_id)
    if (!aggregate) throw new Error('Missing role aggregate')
    aggregate.calibration_signals.push(clone(signal))
  }

  async updateCalibrationSignal(signal: CalibrationSignalRecord): Promise<void> {
    const aggregate = this.roles.get(signal.role_session_id)
    if (!aggregate) throw new Error('Missing role aggregate')
    const index = aggregate.calibration_signals.findIndex((item) => item.id === signal.id)
    if (index < 0) throw new Error('Missing calibration signal')
    aggregate.calibration_signals[index] = clone(signal)
  }

  async insertManagerTask(task: ManagerTaskRecord): Promise<void> {
    const aggregate = this.roles.get(task.role_session_id)
    if (!aggregate) throw new Error('Missing role aggregate')
    aggregate.manager_tasks.push(clone(task))
  }

  async updateManagerTask(task: ManagerTaskRecord): Promise<void> {
    const aggregate = this.roles.get(task.role_session_id)
    if (!aggregate) throw new Error('Missing role aggregate')
    const index = aggregate.manager_tasks.findIndex((item) => item.id === task.id)
    if (index < 0) throw new Error('Missing manager task')
    aggregate.manager_tasks[index] = clone(task)
  }

  async appendDecision(record: DecisionRecord): Promise<void> {
    this.decisions.push(clone(record))
  }

  async createRun(run: AgentRun): Promise<void> {
    this.runs.set(run.id, { run: clone(run), cancel_requested: false })
  }

  async getRun(runId: string): Promise<RunRecord | null> {
    return clone(this.runs.get(runId) ?? null)
  }

  async listActiveRuns(): Promise<RunRecord[]> {
    return clone(
      [...this.runs.values()].filter(({ run }) =>
        ['QUEUED', 'RUNNING'].includes(run.status),
      ),
    )
  }

  async findActiveRunByRole(roleSessionId: string): Promise<RunRecord | null> {
    const record = [...this.runs.values()].find(
      ({ run }) =>
        run.role_session_id === roleSessionId && ['QUEUED', 'RUNNING'].includes(run.status),
    )
    return clone(record ?? null)
  }

  async updateRun(run: AgentRun): Promise<void> {
    const stored = this.runs.get(run.id)
    if (!stored) throw new Error('Missing agent run')
    stored.run = clone(run)
  }

  async requestRunCancel(runId: string): Promise<boolean> {
    const stored = this.runs.get(runId)
    if (!stored) return false
    stored.cancel_requested = true
    return true
  }

  async appendRunEvent(event: AgentEvent): Promise<void> {
    const events = this.events.get(event.run_id) ?? []
    events.push(clone(event))
    this.events.set(event.run_id, events)
    for (const subscriber of this.subscribers.get(event.run_id) ?? []) subscriber(clone(event))
  }

  async listRunEvents(runId: string, afterSequence = 0): Promise<AgentEvent[]> {
    return clone(
      (this.events.get(runId) ?? []).filter((event) => event.sequence > afterSequence),
    )
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
    return clone(
      (this.messages.get(roleSessionId) ?? []).filter(
        (message) => message.sequence > afterSequence,
      ),
    )
  }

  async appendConversationMessage(message: ConversationMessage): Promise<void> {
    const messages = this.messages.get(message.role_session_id) ?? []
    messages.push(clone(message))
    messages.sort((left, right) => left.sequence - right.sequence)
    this.messages.set(message.role_session_id, messages)
  }

  async updateConversationMessage(message: ConversationMessage): Promise<void> {
    const messages = this.messages.get(message.role_session_id) ?? []
    const index = messages.findIndex((item) => item.id === message.id)
    if (index < 0) throw new Error('Missing conversation message')
    messages[index] = clone(message)
  }

  async getClarificationPolicy(roleSessionId: string): Promise<ClarificationPolicy> {
    const policy = this.policies.get(roleSessionId) ?? this.makeDefaultPolicy(roleSessionId)
    this.policies.set(roleSessionId, clone(policy))
    return clone(policy)
  }

  async saveClarificationPolicy(policy: ClarificationPolicy): Promise<void> {
    this.policies.set(policy.role_session_id, clone(policy))
  }

  async getOpenClarificationRound(roleSessionId: string): Promise<ClarificationRound | null> {
    const round = (this.rounds.get(roleSessionId) ?? []).find((item) => item.status === 'OPEN')
    return clone(round ?? null)
  }

  async insertClarificationRound(round: ClarificationRound): Promise<void> {
    const rounds = this.rounds.get(round.role_session_id) ?? []
    rounds.push(clone(round))
    this.rounds.set(round.role_session_id, rounds)
  }

  async updateClarificationRound(round: ClarificationRound): Promise<void> {
    const rounds = this.rounds.get(round.role_session_id) ?? []
    const index = rounds.findIndex((item) => item.id === round.id)
    if (index < 0) throw new Error('Missing clarification round')
    rounds[index] = clone(round)
  }

  async listRunsForTenant(tenantId: string): Promise<AdminRunRecord[]> {
    return [...this.runs.values()]
      .filter(({ run }) => this.roles.get(run.role_session_id)?.state.tenant_id === tenantId)
      .map((record) => {
        const actor = this.users.get(record.run.actor_user_id)
        const role = this.roles.get(record.run.role_session_id)
        return {
          ...clone(record),
          role_title: role?.state.title ?? '未知岗位',
          actor_display_name: actor?.display_name ?? record.run.actor_user_id,
          actor_role: actor?.role ?? 'MANAGER',
        }
      })
      .sort((left, right) =>
        (right.run.started_at ?? '').localeCompare(left.run.started_at ?? ''),
      )
  }

  async appendTraceAccessAudit(record: TraceAccessAuditRecord): Promise<void> {
    this.traceAudits.push(clone(record))
  }

  async listTraceAccessAudits(tenantId: string): Promise<TraceAccessAuditRecord[]> {
    return clone(
      this.traceAudits
        .filter((record) => record.tenant_id === tenantId)
        .sort((left, right) => right.created_at.localeCompare(left.created_at)),
    )
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
}
