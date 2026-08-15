import type {
  ActorContext,
  AgentEvent,
  AgentRun,
  ArtifactEnvelope,
  CandidateEvidence,
  RoleState,
} from '@role-clarifier/contracts'
import type {
  ApplicationStore,
  CalibrationSignalRecord,
  DecisionRecord,
  EventSubscriber,
  ManagerTaskRecord,
  RoleAggregate,
  RunRecord,
  StoredUser,
} from './types.js'
import { createDemoAggregate, demoUsers } from './seed.js'

const clone = <T>(value: T): T => structuredClone(value)

export class MemoryStore implements ApplicationStore {
  private readonly users = new Map<string, StoredUser>()
  private readonly roles = new Map<string, RoleAggregate>()
  private readonly runs = new Map<string, RunRecord>()
  private readonly events = new Map<string, AgentEvent[]>()
  private readonly subscribers = new Map<string, Set<EventSubscriber>>()
  private readonly decisions: DecisionRecord[] = []

  async initialize(): Promise<void> {
    for (const user of demoUsers) this.users.set(user.user_id, clone(user))
    const aggregate = createDemoAggregate()
    this.roles.set(aggregate.state.id, aggregate)
  }

  async close(): Promise<void> {}

  async getUser(userId: string): Promise<StoredUser | null> {
    return clone(this.users.get(userId) ?? null)
  }

  async listRoleStates(actor: ActorContext): Promise<RoleState[]> {
    return [...this.roles.values()]
      .filter(
        ({ state, member_ids }) =>
          state.tenant_id === actor.tenant_id && member_ids.includes(actor.user_id),
      )
      .map(({ state }) => clone(state))
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
  }

  async getRoleAggregate(roleSessionId: string, actor: ActorContext): Promise<RoleAggregate | null> {
    const aggregate = this.roles.get(roleSessionId)
    if (
      !aggregate ||
      aggregate.state.tenant_id !== actor.tenant_id ||
      !aggregate.member_ids.includes(actor.user_id)
    ) {
      return null
    }
    return clone(aggregate)
  }

  async createRoleAggregate(aggregate: RoleAggregate): Promise<void> {
    this.roles.set(aggregate.state.id, clone(aggregate))
  }

  async saveRoleState(state: RoleState, expectedRevision: number): Promise<boolean> {
    const aggregate = this.roles.get(state.id)
    if (!aggregate || aggregate.state.revision !== expectedRevision) return false
    aggregate.state = clone(state)
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
}
