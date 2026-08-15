import { randomUUID } from 'node:crypto'
import type {
  ActorContext,
  AgentEvent,
  AgentEventType,
  AgentRun,
  ArtifactType,
  ToolExecutionContext,
} from '@role-clarifier/contracts'
import { DomainError } from '@role-clarifier/domain'
import type { AppConfig } from '../config.js'
import { RoleService } from '../services/role-service.js'
import type { ApplicationStore } from '../store/index.js'
import type {
  CandidateImportItem,
  HarnessAdapter,
  HarnessRequest,
  HarnessResult,
  HarnessTask,
  HarnessTrace,
} from './harness-adapter.js'

interface PendingRun {
  run: AgentRun
  actor: ActorContext
  task: HarnessTask
  message?: string
  candidates?: CandidateImportItem[]
}

const taskModelTier = (task: HarnessTask): 'FLASH' | 'PRO' =>
  task === 'CLARIFY_MESSAGE' || task === 'EXTRACT_CANDIDATES' ? 'FLASH' : 'PRO'

const artifactTaskMap: Record<ArtifactType, HarnessTask> = {
  ROLE_PROFILE: 'GENERATE_ROLE_PROFILE',
  ASSESSMENT_SCORECARD: 'GENERATE_ASSESSMENT',
  PUBLIC_JD: 'GENERATE_JD',
  HR_RECRUITING_BRIEF: 'GENERATE_HR_BRIEF',
}

export class AgentRunner {
  private readonly pending: PendingRun[] = []
  private readonly activeRoleRuns = new Map<string, string>()
  private readonly controllers = new Map<string, AbortController>()
  private runningCount = 0

  constructor(
    private readonly store: ApplicationStore,
    private readonly roleService: RoleService,
    private readonly harness: HarnessAdapter,
    private readonly config: AppConfig,
  ) {}

  async submitMessage(
    roleSessionId: string,
    actor: ActorContext,
    message: string,
  ): Promise<AgentRun> {
    return this.enqueue(roleSessionId, actor, 'CLARIFY_MESSAGE', { message })
  }

  async submitArtifact(
    roleSessionId: string,
    actor: ActorContext,
    artifactType: ArtifactType,
  ): Promise<AgentRun> {
    if (artifactType === 'HR_RECRUITING_BRIEF' && actor.role !== 'HR') {
      throw new DomainError('FORBIDDEN', '仅 HR 可以生成内部招聘画像', 403)
    }
    return this.enqueue(roleSessionId, actor, artifactTaskMap[artifactType])
  }

  async submitCandidates(
    roleSessionId: string,
    actor: ActorContext,
    candidates: CandidateImportItem[],
  ): Promise<AgentRun> {
    if (actor.role !== 'HR') throw new DomainError('FORBIDDEN', '仅 HR 可以导入候选人', 403)
    for (const candidate of candidates) this.roleService.rejectCandidatePII(candidate.content)
    return this.enqueue(roleSessionId, actor, 'EXTRACT_CANDIDATES', { candidates })
  }

  async cancel(runId: string, actor: ActorContext): Promise<void> {
    const record = await this.store.getRun(runId)
    if (!record || record.run.actor_user_id !== actor.user_id) {
      throw new DomainError('AGENT_RUN_NOT_FOUND', 'Agent Run 不存在', 404)
    }
    if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(record.run.status)) return
    await this.store.requestRunCancel(runId)
    this.controllers.get(runId)?.abort()
    const queuedIndex = this.pending.findIndex((item) => item.run.id === runId)
    if (queuedIndex >= 0) {
      const [pending] = this.pending.splice(queuedIndex, 1)
      if (pending) {
        this.activeRoleRuns.delete(pending.run.role_session_id)
        const cancelled = {
          ...pending.run,
          status: 'CANCELLED' as const,
          completed_at: new Date().toISOString(),
        }
        await this.store.updateRun(cancelled)
      }
    }
  }

  private async enqueue(
    roleSessionId: string,
    actor: ActorContext,
    task: HarnessTask,
    input: { message?: string; candidates?: CandidateImportItem[] } = {},
  ): Promise<AgentRun> {
    await this.roleService.get(roleSessionId, actor)
    if (this.activeRoleRuns.has(roleSessionId)) {
      throw new DomainError(
        'ROLE_AGENT_RUN_ACTIVE',
        '该岗位已有一个 Agent Run 正在执行，请完成或取消后重试',
        409,
      )
    }
    const modelTier = taskModelTier(task)
    const run: AgentRun = {
      id: randomUUID(),
      role_session_id: roleSessionId,
      actor_user_id: actor.user_id,
      status: 'QUEUED',
      model_tier: modelTier,
      task,
      harness_session_id: null,
      prompt_version: 'role-clarifier-v1',
      model_name:
        modelTier === 'FLASH'
          ? this.config.DEEPSEEK_FLASH_MODEL
          : this.config.DEEPSEEK_PRO_MODEL,
      tool_count: 0,
      input_tokens: 0,
      output_tokens: 0,
      started_at: null,
      completed_at: null,
      error_code: null,
    }
    await this.store.createRun(run)
    this.activeRoleRuns.set(roleSessionId, run.id)
    this.pending.push({
      run,
      actor,
      task,
      ...(input.message !== undefined ? { message: input.message } : {}),
      ...(input.candidates !== undefined ? { candidates: input.candidates } : {}),
    })
    queueMicrotask(() => void this.drain())
    return run
  }

  private async drain(): Promise<void> {
    while (this.runningCount < this.config.AGENT_CONCURRENCY && this.pending.length > 0) {
      const pending = this.pending.shift()
      if (!pending) return
      this.runningCount += 1
      void this.execute(pending).finally(() => {
        this.runningCount -= 1
        this.activeRoleRuns.delete(pending.run.role_session_id)
        void this.drain()
      })
    }
  }

  private async execute(pending: PendingRun): Promise<void> {
    const controller = new AbortController()
    this.controllers.set(pending.run.id, controller)
    let sequence = 0
    let toolCount = 0
    let outputCharacters = 0
    let harnessTrace: HarnessTrace | undefined
    const emit = async (
      type: AgentEventType,
      payload: Record<string, unknown>,
    ): Promise<void> => {
      sequence += 1
      const event: AgentEvent = {
        id: randomUUID(),
        run_id: pending.run.id,
        sequence,
        type,
        payload,
        created_at: new Date().toISOString(),
      }
      await this.store.appendRunEvent(event)
    }
    const startedAt = new Date().toISOString()
    let run: AgentRun = {
      ...pending.run,
      status: 'RUNNING',
      started_at: startedAt,
      harness_session_id: `role-${pending.run.role_session_id}`,
    }
    await this.store.updateRun(run)
    await emit('run.started', {
      run_id: run.id,
      model_tier: run.model_tier,
      task: run.task,
    })

    try {
      const view = await this.roleService.get(run.role_session_id, pending.actor)
      const executionContext: ToolExecutionContext = {
        tenant_id: pending.actor.tenant_id,
        actor_user_id: pending.actor.user_id,
        actor_role: pending.actor.role,
        role_session_id: run.role_session_id,
        agent_run_id: run.id,
        trace_id: randomUUID(),
      }
      const request: HarnessRequest = {
        task: pending.task,
        role_state: view.state,
        execution_context: executionContext,
        maximum_transitions: 10,
        structured_output_repair_attempts: 1,
        ...(pending.message !== undefined ? { message: pending.message } : {}),
        ...(pending.candidates !== undefined ? { candidates: pending.candidates } : {}),
      }
      const result = await this.harness.run(request, {
        signal: controller.signal,
        onStatus: async (status) => emit('agent.status', { status }),
        onDelta: async (delta) => {
          outputCharacters += delta.length
          await emit('assistant.delta', { delta })
        },
        onToolStarted: async (name) => {
          toolCount += 1
          if (toolCount > 10) throw new Error('Maximum tool transitions exceeded')
          await emit('tool.started', { name })
        },
        onToolCompleted: async (name, summary) =>
          emit('tool.completed', { name, summary }),
        onTrace: async (trace) => {
          harnessTrace = trace
        },
      })
      await this.persistHarnessResult(run, pending.actor, result, emit)
      run = {
        ...run,
        status: 'COMPLETED',
        model_name: harnessTrace?.model ?? run.model_name,
        tool_count: harnessTrace?.tool_count ?? toolCount,
        input_tokens:
          harnessTrace?.input_tokens ?? Math.ceil((pending.message?.length ?? 0) / 2),
        output_tokens: harnessTrace?.output_tokens ?? Math.ceil(outputCharacters / 2),
        completed_at: new Date().toISOString(),
      }
      await this.store.updateRun(run)
      await emit('run.completed', {
        run_id: run.id,
        tool_count: run.tool_count,
        model: run.model_name,
        input_tokens: run.input_tokens,
        output_tokens: run.output_tokens,
        ...(harnessTrace
          ? {
              provider: harnessTrace.provider,
              harness_source_version: harnessTrace.harness_source_version,
              harness_commit: harnessTrace.harness_commit,
              duration_ms: harnessTrace.duration_ms,
              repaired: harnessTrace.repaired,
              recovered_from_tool: harnessTrace.recovered_from_tool ?? false,
            }
          : {}),
      })
    } catch (error) {
      const cancelled = error instanceof DOMException && error.name === 'AbortError'
      run = {
        ...run,
        status: cancelled ? 'CANCELLED' : 'FAILED',
        tool_count: toolCount,
        completed_at: new Date().toISOString(),
        error_code: cancelled ? 'RUN_CANCELLED' : 'HARNESS_EXECUTION_FAILED',
      }
      await this.store.updateRun(run)
      if (!cancelled) {
        await emit('run.failed', {
          code: run.error_code,
          message: error instanceof Error ? error.message : 'Harness execution failed',
        })
      }
    } finally {
      this.controllers.delete(run.id)
    }
  }

  private async persistHarnessResult(
    run: AgentRun,
    actor: ActorContext,
    result: HarnessResult,
    emit: (type: AgentEventType, payload: Record<string, unknown>) => Promise<void>,
  ): Promise<void> {
    if (result.kind === 'CLARIFICATION') {
      if (result.persistence !== 'TOOL') {
        await this.roleService.saveFactDraft(
          run.role_session_id,
          actor,
          result.fact_draft.statement,
          result.fact_draft.category,
        )
      }
      await emit('question.ready', { question: result.question })
      return
    }
    if (result.kind === 'ARTIFACT') {
      if (result.persistence === 'TOOL') {
        await emit('artifact.updated', {
          artifact_type: result.artifact_type,
          source: 'harness-tool',
        })
        return
      }
      const artifact = await this.roleService.saveArtifactDraft(
        run.role_session_id,
        actor,
        result.artifact_type,
        result.content,
      )
      await emit('artifact.updated', {
        artifact_id: artifact.id,
        artifact_type: artifact.type,
        version: artifact.version,
        content_hash: artifact.content_hash,
      })
      return
    }
    if (result.kind === 'CANDIDATE_EVIDENCE') {
      if (result.persistence === 'TOOL') {
        await emit('artifact.updated', {
          artifact_type: 'CANDIDATE_EVIDENCE',
          candidate_count: result.candidates.length,
          source: 'harness-tool',
        })
        return
      }
      const outcome = await this.roleService.importCandidateEvidence(
        run.role_session_id,
        actor,
        result.candidates,
      )
      await emit('artifact.updated', {
        artifact_type: 'CANDIDATE_EVIDENCE',
        candidate_count: outcome.state.candidate_count,
        calibration_status: outcome.evaluation.status,
      })
    }
  }
}
