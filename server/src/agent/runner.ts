import { randomUUID } from 'node:crypto'
import type {
  ActorContext,
  AgentEvent,
  AgentEventType,
  AgentRouteRequest,
  AgentRouteResult,
  AgentRun,
  ArtifactType,
  ClarificationRound,
  ConversationMessage,
  ToolExecutionContext,
} from '@role-clarifier/contracts'
import { DomainError } from '@role-clarifier/domain'
import type { AppConfig } from '../config.js'
import {
  RoleService,
  evaluateAssessmentGenerationReadiness,
  evaluateCandidateEvidenceExtractionReadiness,
  evaluateHRBriefGenerationReadiness,
  evaluatePublicJDGenerationReadiness,
  evaluateRoleProfileGenerationReadiness,
} from '../services/role-service.js'
import { RecruitingContextService } from '../services/recruiting-context-service.js'
import type { ApplicationStore } from '../store/index.js'
import type {
  CandidateImportItem,
  HarnessAdapter,
  HarnessHooks,
  HarnessRequest,
  HarnessResult,
  HarnessTask,
  HarnessTrace,
} from './harness-adapter.js'

interface PendingRun {
  run: AgentRun
  actor: ActorContext
  task: HarnessTask | 'ROUTE_MESSAGE'
  message?: string
  candidates?: CandidateImportItem[]
  versionComparison?: {
    artifact_type: ArtifactType
    from_version: number
    to_version: number
  }
  inputMessage?: ConversationMessage
  answeredRound?: ClarificationRound
}

const taskModelTier = (task: HarnessTask): 'FLASH' | 'PRO' =>
  task === 'CLARIFY_MESSAGE' || task === 'EXTRACT_CANDIDATES' ? 'FLASH' : 'PRO'

const CANDIDATE_MODEL_BATCH_MAX_ITEMS = 10
const CANDIDATE_MODEL_BATCH_MAX_EVIDENCE_ITEMS = 48
const CANDIDATE_MODEL_BATCH_MAX_CHARACTERS = 60_000
const CANDIDATE_MODEL_BATCH_CONCURRENCY = 3

export const partitionCandidateImports = (
  candidates: CandidateImportItem[],
  requirementCount = 1,
): CandidateImportItem[][] => {
  const maximumItems = Math.min(
    CANDIDATE_MODEL_BATCH_MAX_ITEMS,
    Math.max(1, Math.floor(CANDIDATE_MODEL_BATCH_MAX_EVIDENCE_ITEMS / Math.max(1, requirementCount))),
  )
  const batches: CandidateImportItem[][] = []
  let current: CandidateImportItem[] = []
  let currentCharacters = 0
  for (const candidate of candidates) {
    const candidateCharacters = JSON.stringify(candidate).length
    if (
      current.length > 0
      && (current.length >= maximumItems
        || currentCharacters + candidateCharacters > CANDIDATE_MODEL_BATCH_MAX_CHARACTERS)
    ) {
      batches.push(current)
      current = []
      currentCharacters = 0
    }
    current.push(candidate)
    currentCharacters += candidateCharacters
  }
  if (current.length > 0) batches.push(current)
  return batches
}

const artifactTaskMap: Record<ArtifactType, HarnessTask> = {
  ROLE_PROFILE: 'GENERATE_ROLE_PROFILE',
  ASSESSMENT_SCORECARD: 'GENERATE_ASSESSMENT',
  PUBLIC_JD: 'GENERATE_JD',
  HR_RECRUITING_BRIEF: 'GENERATE_HR_BRIEF',
}

const handoffTask = (route: AgentRouteResult): HarnessTask | null => {
  if (route.action !== 'HANDOFF') return null
  return route.task
}

export class AgentRunner {
  private readonly pending: PendingRun[] = []
  private readonly activeRoleRuns = new Map<string, string>()
  private readonly controllers = new Map<string, AbortController>()
  private readonly recruitingContextService: RecruitingContextService
  private runningCount = 0

  constructor(
    private readonly store: ApplicationStore,
    private readonly roleService: RoleService,
    private readonly harness: HarnessAdapter,
    private readonly config: AppConfig,
    recruitingContextService?: RecruitingContextService,
  ) {
    this.recruitingContextService = recruitingContextService
      ?? new RecruitingContextService(store)
  }

  async submitMessage(
    roleSessionId: string,
    actor: ActorContext,
    message: string,
  ): Promise<{ run: AgentRun; message: ConversationMessage }> {
    const answeredRound = await this.store.getOpenClarificationRound(roleSessionId, actor.user_id)
    const run = await this.enqueue(roleSessionId, actor, 'ROUTE_MESSAGE', {
      message,
      ...(answeredRound ? { answeredRound } : {}),
    })
    const messages = await this.store.listConversationMessages(roleSessionId)
    const stored = messages.find((item) => item.id === run.input_message_id)
    if (!stored) throw new Error('Conversation input message was not persisted')
    return { run, message: stored }
  }

  async submitArtifact(
    roleSessionId: string,
    actor: ActorContext,
    artifactType: ArtifactType,
  ): Promise<AgentRun> {
    if (artifactType === 'HR_RECRUITING_BRIEF' && !['HR', 'ADMIN'].includes(actor.role)) {
      throw new DomainError('FORBIDDEN', '仅 HR 可以生成内部招聘画像', 403)
    }
    if (artifactType === 'ROLE_PROFILE') {
      const view = await this.roleService.get(roleSessionId, actor)
      const readiness = evaluateRoleProfileGenerationReadiness(view.state)
      if (!readiness.allowed) {
        throw new DomainError(readiness.code, readiness.reason, 409)
      }
    }
    if (artifactType === 'ASSESSMENT_SCORECARD') {
      const view = await this.roleService.get(roleSessionId, actor)
      const readiness = evaluateAssessmentGenerationReadiness(view.state)
      if (!readiness.allowed) {
        throw new DomainError(readiness.code, readiness.reason, 409)
      }
    }
    if (artifactType === 'PUBLIC_JD') {
      const view = await this.roleService.get(roleSessionId, actor)
      const readiness = evaluatePublicJDGenerationReadiness(view.state)
      if (!readiness.allowed) {
        throw new DomainError(readiness.code, readiness.reason, 409)
      }
    }
    if (artifactType === 'HR_RECRUITING_BRIEF') {
      const view = await this.roleService.get(roleSessionId, actor)
      const readiness = evaluateHRBriefGenerationReadiness(view.state)
      if (!readiness.allowed) {
        throw new DomainError(readiness.code, readiness.reason, 409)
      }
    }
    return this.enqueue(roleSessionId, actor, artifactTaskMap[artifactType])
  }

  async submitCandidates(
    roleSessionId: string,
    actor: ActorContext,
    candidates: CandidateImportItem[],
  ): Promise<AgentRun> {
    if (!['HR', 'ADMIN'].includes(actor.role)) throw new DomainError('FORBIDDEN', '仅 HR 或企业管理员可以导入候选人', 403)
    for (const candidate of candidates) this.roleService.rejectCandidatePII(candidate.content)
    const view = await this.roleService.get(roleSessionId, actor)
    const readiness = evaluateCandidateEvidenceExtractionReadiness(view.state)
    if (!readiness.allowed) {
      throw new DomainError(readiness.code, readiness.reason, 409)
    }
    return this.enqueue(roleSessionId, actor, 'EXTRACT_CANDIDATES', { candidates })
  }

  async cancel(runId: string, actor: ActorContext): Promise<void> {
    const record = await this.store.getRun(runId)
    if (!record) {
      throw new DomainError('AGENT_RUN_NOT_FOUND', 'Agent Run 不存在', 404)
    }
    await this.roleService.get(record.run.role_session_id, actor)
    if (record.run.actor_user_id !== actor.user_id && actor.role !== 'ADMIN') {
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
    task: HarnessTask | 'ROUTE_MESSAGE',
    input: {
      message?: string
      candidates?: CandidateImportItem[]
      answeredRound?: ClarificationRound
    } = {},
  ): Promise<AgentRun> {
    await this.roleService.get(roleSessionId, actor)
    if (this.activeRoleRuns.has(roleSessionId)) {
      throw new DomainError(
        'ROLE_AGENT_RUN_ACTIVE',
        '该岗位已有一个 Agent Run 正在执行，请完成或取消后重试',
        409,
      )
    }
    const modelTier = task === 'ROUTE_MESSAGE' ? 'FLASH' : taskModelTier(task)
    const inputMessageId = input.message !== undefined ? randomUUID() : null
    const run: AgentRun = {
      id: randomUUID(),
      role_session_id: roleSessionId,
      actor_user_id: actor.user_id,
      status: 'QUEUED',
      model_tier: modelTier,
      task,
      harness_session_id: null,
      prompt_version: task === 'ROUTE_MESSAGE' ? 'role-router-v2' : 'role-clarifier-v9',
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
      input_message_id: inputMessageId,
      output_message_id: null,
    }
    await this.store.createRun(run)
    let inputMessage: ConversationMessage | undefined
    if (input.message !== undefined && inputMessageId) {
      inputMessage = await this.createMessage({
        id: inputMessageId,
        roleSessionId,
        actor,
        runId: run.id,
        clarificationRoundId: input.answeredRound?.id ?? null,
        senderType: 'HUMAN',
        content: input.message,
        structuredContent: null,
        status: 'COMPLETED',
      })
    }
    this.activeRoleRuns.set(roleSessionId, run.id)
    this.pending.push({
      run,
      actor,
      task,
      ...(input.message !== undefined ? { message: input.message } : {}),
      ...(input.candidates !== undefined ? { candidates: input.candidates } : {}),
      ...(inputMessage ? { inputMessage } : {}),
      ...(input.answeredRound ? { answeredRound: input.answeredRound } : {}),
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
    if (pending.inputMessage) {
      await emit('message.accepted', {
        message_id: pending.inputMessage.id,
        sequence: pending.inputMessage.sequence,
        sender_role: pending.inputMessage.sender_role,
        sender_name: pending.inputMessage.sender_name,
        content: pending.inputMessage.content,
      })
    }

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
      const conversationMessages = pending.message !== undefined
        ? await this.store.listConversationMessagesForActor(
            run.role_session_id,
            pending.actor.user_id,
          )
        : []
      const conversationContext: AgentRouteRequest['conversation_context'] = {
        current_user_role: pending.actor.role,
        open_clarification: pending.answeredRound
          ? {
              ordinal: pending.answeredRound.ordinal,
              question: pending.answeredRound.question,
            }
          : null,
        recent_messages: conversationMessages
          .filter((message) =>
            message.id !== pending.inputMessage?.id
            && message.status === 'COMPLETED'
            && (message.sender_type === 'HUMAN' || message.sender_type === 'AGENT'),
          )
          .slice(-8)
          .map((message) => ({
            sender_type: message.sender_type as 'HUMAN' | 'AGENT',
            sender_role: message.sender_role,
            content: message.content,
          })),
      }
      const hooks: HarnessHooks = {
        signal: controller.signal,
        onStatus: async (status) => emit('agent.status', { status }),
        onContextSnapshot: async (snapshot) => emit(
          'context.snapshot',
          snapshot as unknown as Record<string, unknown>,
        ),
        onModelRequest: async (prompt) => emit('model.request', { prompt }),
        onModelResponse: async (response) => emit('model.response', { response }),
        onDelta: async (delta) => {
          outputCharacters += delta.length
          await emit('assistant.delta', { delta })
        },
        onToolStarted: async (name, argumentsValue) => {
          toolCount += 1
          if (toolCount > 10) throw new Error('Maximum tool transitions exceeded')
          await emit('tool.started', { name, arguments: argumentsValue ?? null })
        },
        onToolCompleted: async (name, summary, resultValue) =>
          emit('tool.completed', { name, summary, result: resultValue ?? null }),
        onTrace: async (trace) => {
          harnessTrace = harnessTrace
            ? {
                ...trace,
                tool_count: harnessTrace.tool_count + trace.tool_count,
                input_tokens: harnessTrace.input_tokens + trace.input_tokens,
                output_tokens: harnessTrace.output_tokens + trace.output_tokens,
                duration_ms: harnessTrace.duration_ms + trace.duration_ms,
                repaired: harnessTrace.repaired || trace.repaired,
                recovered_from_tool:
                  Boolean(harnessTrace.recovered_from_tool) || Boolean(trace.recovered_from_tool),
              }
            : trace
        },
      }

      let result: HarnessResult | undefined
      let domainTask: HarnessTask | null = pending.task === 'ROUTE_MESSAGE' ? null : pending.task
      if (pending.task === 'ROUTE_MESSAGE') {
        if (pending.message === undefined) throw new Error('ROUTE_MESSAGE requires message input')
        const route = await this.harness.route({
          message: pending.message,
          role_state: view.state,
          conversation_context: conversationContext,
        }, hooks)
        if (route.action !== 'HANDOFF') {
          const answer = route.action === 'ASK' ? route.question : route.answer
          run = {
            ...run,
            task: route.action === 'ASK' ? 'ROUTER_ASK' : 'ROUTER_RESPOND',
            prompt_version: 'role-router-v2',
          }
          await this.store.updateRun(run)
          result = {
            kind: 'CONVERSATION',
            persistence: 'NONE',
            answer,
            route_action: route.action,
          }
        } else {
          let denialReason: string | null = null
          if (
            (route.task === 'GENERATE_HR_BRIEF'
              || (route.task === 'VERSION_COMPARISON'
                && route.artifact_type === 'HR_RECRUITING_BRIEF'))
            && !['HR', 'ADMIN'].includes(pending.actor.role)
          ) {
            denialReason = '只有 HR 或企业管理员可以访问 HR 招聘画像。'
          }
          if (route.task === 'CALIBRATION_ADVICE') {
            const readiness = await this.roleService.calibrationAdviceReadiness(
              run.role_session_id,
              pending.actor,
            )
            if (!readiness.allowed) denialReason = readiness.reason
          }
          if (route.task === 'GENERATE_ROLE_PROFILE') {
            const readiness = evaluateRoleProfileGenerationReadiness(view.state)
            if (!readiness.allowed) denialReason = readiness.reason
          }
          if (route.task === 'GENERATE_ASSESSMENT') {
            const readiness = evaluateAssessmentGenerationReadiness(view.state)
            if (!readiness.allowed) denialReason = readiness.reason
          }
          if (route.task === 'GENERATE_JD') {
            const readiness = evaluatePublicJDGenerationReadiness(view.state)
            if (!readiness.allowed) denialReason = readiness.reason
          }
          if (route.task === 'GENERATE_HR_BRIEF' && !denialReason) {
            const readiness = evaluateHRBriefGenerationReadiness(view.state)
            if (!readiness.allowed) denialReason = readiness.reason
          }
          if (denialReason) {
            domainTask = null
            run = {
              ...run,
              task: route.task,
              prompt_version: 'role-router-v2',
            }
            if (pending.inputMessage?.clarification_round_id) {
              pending.inputMessage = {
                ...pending.inputMessage,
                clarification_round_id: null,
              }
              await this.store.updateConversationMessage(pending.inputMessage)
            }
            delete pending.answeredRound
            await this.store.updateRun(run)
            outputCharacters += denialReason.length
            await emit('assistant.delta', { delta: denialReason })
            result = {
              kind: 'CONVERSATION',
              persistence: 'NONE',
              answer: denialReason,
              route_action: route.action,
              route_task: route.task,
            }
          } else {
            domainTask = handoffTask(route)
            if (!domainTask) throw new Error('Router HANDOFF did not provide a domain task')
            pending.task = domainTask
            if (route.task === 'VERSION_COMPARISON') {
              pending.versionComparison = {
                artifact_type: route.artifact_type,
                from_version: route.from_version,
                to_version: route.to_version,
              }
            }
            if (route.task !== 'CLARIFY_MESSAGE') {
              if (pending.inputMessage?.clarification_round_id) {
                pending.inputMessage = {
                  ...pending.inputMessage,
                  clarification_round_id: null,
                }
                await this.store.updateConversationMessage(pending.inputMessage)
              }
              delete pending.answeredRound
            }
            const modelTier = taskModelTier(domainTask)
            run = {
              ...run,
              task: domainTask,
              model_tier: modelTier,
              model_name: modelTier === 'FLASH'
                ? this.config.DEEPSEEK_FLASH_MODEL
                : this.config.DEEPSEEK_PRO_MODEL,
              prompt_version: 'role-router-v2+role-clarifier-v10',
            }
            await this.store.updateRun(run)
            await emit('agent.status', {
              status: `Router 已交接领域任务 ${domainTask}`,
            })
          }
        }
      }

      if (domainTask) {
        const calibrationProjection = domainTask === 'CALIBRATION_ADVICE'
          ? await this.roleService.readStateForTask(
              run.role_session_id,
              pending.actor,
              domainTask,
            )
          : null
        const calibrationContext = calibrationProjection
          ? {
              calibration_policy: calibrationProjection.task_context.calibration_policy!,
              candidate_summary: calibrationProjection.task_context.candidate_summary!,
              calibration_evaluation: calibrationProjection.task_context.calibration_evaluation!,
            }
          : undefined
        const recruitingContext = await this.recruitingContextService.buildTaskContext(
          run.role_session_id,
          pending.actor,
          domainTask,
          pending.message,
        )
        const request: HarnessRequest = {
          task: domainTask,
          role_state: view.state,
          execution_context: executionContext,
          maximum_transitions: [
            'GENERATE_ROLE_PROFILE',
            'GENERATE_ASSESSMENT',
            'GENERATE_JD',
            'GENERATE_HR_BRIEF',
            'EXTRACT_CANDIDATES',
            'CALIBRATION_ADVICE',
          ].includes(domainTask) ? 0 : 10,
          structured_output_repair_attempts: 1,
          conversation_context: domainTask === 'CLARIFY_MESSAGE'
            ? conversationContext
            : {
                current_user_role: pending.actor.role,
                open_clarification: null,
                recent_messages: [],
              },
          ...(pending.message !== undefined ? { message: pending.message } : {}),
          ...(pending.candidates !== undefined ? { candidates: pending.candidates } : {}),
          ...(calibrationContext ? { calibration_context: calibrationContext } : {}),
          ...(recruitingContext.projections.length > 0
            ? { recruiting_context: recruitingContext }
            : {}),
          ...(pending.versionComparison !== undefined
            ? { version_comparison: pending.versionComparison }
            : {}),
        }
        if (domainTask === 'EXTRACT_CANDIDATES' && pending.candidates) {
          const profileContent = view.state.latest_artifacts.ROLE_PROFILE?.content
          const requirementCount = profileContent
            && typeof profileContent === 'object'
            && 'requirements' in profileContent
            && Array.isArray(profileContent.requirements)
            ? profileContent.requirements.length
            : 1
          const batches = partitionCandidateImports(pending.candidates, requirementCount)
          const batchResults: Array<Extract<HarnessResult, { kind: 'CANDIDATE_EVIDENCE' }>> =
            new Array(batches.length)
          let nextBatchIndex = 0
          const worker = async (): Promise<void> => {
            while (nextBatchIndex < batches.length) {
              const batchIndex = nextBatchIndex
              nextBatchIndex += 1
              const batch = batches[batchIndex]!
              const batchResult = await this.harness.run({
                ...request,
                candidates: batch,
              }, {
                ...hooks,
                onStatus: async (status) => hooks.onStatus(
                  batches.length === 1
                    ? status
                    : `候选人批次 ${batchIndex + 1}/${batches.length}：${status}`,
                ),
                onDelta: async () => undefined,
              })
              if (batchResult.kind !== 'CANDIDATE_EVIDENCE') {
                throw new Error('EXTRACT_CANDIDATES returned an unexpected result kind')
              }
              batchResults[batchIndex] = batchResult
            }
          }
          await Promise.all(
            Array.from(
              { length: Math.min(CANDIDATE_MODEL_BATCH_CONCURRENCY, batches.length) },
              () => worker(),
            ),
          )
          const extractedCandidates = batchResults.flatMap((item) => item.candidates)
          const failedCandidates = batchResults.flatMap((item) => item.failed_candidates)
          const summary = failedCandidates.length === 0
            ? `已完成 ${extractedCandidates.length} 份候选人材料的证据提取；结果仅供 HR 复核，不代表录用或淘汰结论。`
            : `已完成 ${extractedCandidates.length} 份候选人材料的证据提取，另有 ${failedCandidates.length} 份未能提取；结果仅供 HR 复核，不代表录用或淘汰结论。`
          await hooks.onDelta(summary)
          result = {
            kind: 'CANDIDATE_EVIDENCE',
            persistence: 'CALLER',
            candidates: extractedCandidates,
            failed_candidates: failedCandidates,
            summary,
          }
        } else {
          result = await this.harness.run(request, hooks)
        }
      }
      if (!result) throw new Error('Agent routing produced no executable result')
      const outputMessage = await this.persistHarnessResult(run, pending, result, emit)
      run = {
        ...run,
        status: 'COMPLETED',
        model_name: harnessTrace?.model ?? run.model_name,
        tool_count: harnessTrace?.tool_count ?? toolCount,
        input_tokens:
          harnessTrace?.input_tokens ?? Math.ceil((pending.message?.length ?? 0) / 2),
        output_tokens: harnessTrace?.output_tokens ?? Math.ceil(outputCharacters / 2),
        completed_at: new Date().toISOString(),
        output_message_id: outputMessage?.id ?? null,
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
          message: 'Agent 本轮没有完成，原消息已经保留，请稍后重试。',
          internal_message: error instanceof Error ? error.message : 'Harness execution failed',
        })
        const failedMessage = await this.createMessage({
          roleSessionId: run.role_session_id,
          actor: pending.actor,
          runId: run.id,
          clarificationRoundId: pending.answeredRound?.id ?? null,
          senderType: 'SYSTEM',
          content: '本次 Agent 运行失败，消息已经保留。你可以稍后重试。',
          structuredContent: { error_code: run.error_code },
          status: 'FAILED',
        })
        await emit('assistant.completed', {
          message_id: failedMessage.id,
          status: failedMessage.status,
        })
      }
    } finally {
      this.controllers.delete(run.id)
    }
  }

  private async persistHarnessResult(
    run: AgentRun,
    pending: PendingRun,
    result: HarnessResult,
    emit: (type: AgentEventType, payload: Record<string, unknown>) => Promise<void>,
  ): Promise<ConversationMessage | null> {
    const actor = pending.actor
    if (result.kind === 'CONVERSATION') {
      if (pending.inputMessage?.clarification_round_id) {
        pending.inputMessage = {
          ...pending.inputMessage,
          clarification_round_id: null,
        }
        await this.store.updateConversationMessage(pending.inputMessage)
      }
      const message = await this.createAgentSummary(run, actor, result.answer, {
        kind: 'CONVERSATION',
        ...(result.route_action ? { route_action: result.route_action } : {}),
        ...(result.route_task ? { route_task: result.route_task } : {}),
      })
      await emit('assistant.completed', {
        message_id: message.id,
        sequence: message.sequence,
      })
      return message
    }
    if (result.kind === 'CLARIFICATION') {
      if (result.role_identity && result.persistence !== 'TOOL') {
        await this.roleService.updateRoleIdentityDraft(
          run.role_session_id,
          actor,
          result.role_identity,
        )
      }
      if (result.persistence !== 'TOOL') {
        await this.roleService.saveFactDraft(
          run.role_session_id,
          actor,
          result.fact_draft.statement,
          result.fact_draft.category,
        )
      }
      const timestamp = new Date().toISOString()
      const policy = await this.store.getClarificationPolicy(run.role_session_id)
      if (pending.answeredRound) {
        const completedRound: ClarificationRound = {
          ...pending.answeredRound,
          status: 'COMPLETED',
          resolved_by_message_id: pending.inputMessage?.id ?? null,
          completed_at: timestamp,
        }
        await this.store.updateClarificationRound(completedRound)
        policy.completed_rounds += 1
        policy.open_round_id = null
        await emit('clarification.round.completed', {
          round_id: completedRound.id,
          ordinal: completedRound.ordinal,
        })
      }

      const budget = policy.initial_budget + policy.granted_rounds
      const canOpenRound = policy.opened_rounds < budget
      let openedRound: ClarificationRound | null = null
      let content = result.answer
      let structuredContent: Record<string, unknown>
      if (canOpenRound) {
        openedRound = {
          id: randomUUID(),
          role_session_id: run.role_session_id,
          ordinal: policy.opened_rounds + 1,
          status: 'OPEN',
          question: result.question,
          opened_by_run_id: run.id,
          resolved_by_message_id: null,
          created_at: timestamp,
          completed_at: null,
        }
        await this.store.insertClarificationRound(openedRound)
        policy.opened_rounds = openedRound.ordinal
        policy.open_round_id = openedRound.id
        policy.status = 'ACTIVE'
        structuredContent = {
          kind: 'CLARIFICATION',
          question: result.question,
          round_ordinal: openedRound.ordinal,
          budget,
        }
      } else {
        policy.status = 'LIMIT_REACHED'
        content = `${result.answer}\n\n本轮主动澄清预算已经用完。我已保留当前结论，请选择按现有信息生成岗位画像，或由经理、HR、企业管理员增加澄清轮数。`
        structuredContent = {
          kind: 'CLARIFICATION_LIMIT',
          completed_rounds: policy.completed_rounds,
          budget,
        }
      }
      policy.updated_by = actor.user_id
      policy.updated_at = timestamp
      await this.store.saveClarificationPolicy(policy)

      const message = await this.createMessage({
        roleSessionId: run.role_session_id,
        actor,
        runId: run.id,
        clarificationRoundId: openedRound?.id ?? null,
        senderType: 'AGENT',
        content,
        structuredContent,
        status: 'COMPLETED',
      })
      await emit('assistant.completed', {
        message_id: message.id,
        sequence: message.sequence,
      })
      if (openedRound) {
        await emit('question.ready', {
          question: result.question,
          message_id: message.id,
          round_id: openedRound.id,
          ordinal: openedRound.ordinal,
          budget,
        })
        await emit('clarification.round.opened', {
          round_id: openedRound.id,
          ordinal: openedRound.ordinal,
          budget,
        })
      } else {
        await emit('clarification.limit.reached', {
          completed_rounds: policy.completed_rounds,
          budget,
        })
      }
      return message
    }
    if (result.kind === 'ARTIFACT') {
      if (result.persistence === 'TOOL') {
        await emit('artifact.updated', {
          artifact_type: result.artifact_type,
          source: 'harness-tool',
        })
        const message = await this.createAgentSummary(run, actor, result.summary, {
          kind: 'ARTIFACT',
          artifact_type: result.artifact_type,
        })
        await emit('assistant.completed', { message_id: message.id, sequence: message.sequence })
        return message
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
      const message = await this.createAgentSummary(run, actor, result.summary, {
        kind: 'ARTIFACT',
        artifact_type: result.artifact_type,
        version: artifact.version,
      })
      await emit('assistant.completed', { message_id: message.id, sequence: message.sequence })
      return message
    }
    if (result.kind === 'CANDIDATE_EVIDENCE') {
      if (result.persistence === 'TOOL') {
        await emit('artifact.updated', {
          artifact_type: 'CANDIDATE_EVIDENCE',
          candidate_count: result.candidates.length,
          source: 'harness-tool',
        })
        const message = await this.createAgentSummary(run, actor, result.summary, {
          kind: 'CANDIDATE_EVIDENCE',
          candidate_count: result.candidates.length,
        })
        await emit('assistant.completed', { message_id: message.id, sequence: message.sequence })
        return message
      }
      const outcome = await this.roleService.importCandidateEvidence(
        run.role_session_id,
        actor,
        result.candidates,
        pending.candidates ?? [],
        result.failed_candidates,
        result.summary,
      )
      await emit('artifact.updated', {
        artifact_type: 'CANDIDATE_EVIDENCE',
        candidate_count: outcome.state.candidate_count,
        calibration_status: outcome.evaluation.status,
      })
      const message = await this.createAgentSummary(run, actor, result.summary, {
        kind: 'CANDIDATE_EVIDENCE',
        candidate_count: result.candidates.length,
        failed_candidate_count: result.failed_candidates.length,
      })
      await emit('assistant.completed', { message_id: message.id, sequence: message.sequence })
      return message
    }
    if (result.kind === 'VERSION_COMPARISON') {
      const message = await this.createAgentSummary(run, actor, result.summary, {
        kind: 'VERSION_COMPARISON',
        artifact_type: result.artifact_type,
        from_version: result.from_version,
        to_version: result.to_version,
      })
      await emit('assistant.completed', { message_id: message.id, sequence: message.sequence })
      return message
    }
    if (result.kind === 'CALIBRATION_ADVICE') {
      const outcome = await this.roleService.saveCalibrationAdvice(
        run.role_session_id,
        actor,
        result.advice,
      )
      await emit('artifact.updated', {
        artifact_type: 'CALIBRATION_ADVICE',
        disposition: result.advice.disposition,
        calibration_status: outcome.evaluation.status,
        signal_id: outcome.signal?.id ?? null,
      })
      const message = await this.createAgentSummary(run, actor, result.summary, {
        kind: 'CALIBRATION_ADVICE',
        disposition: result.advice.disposition,
        action: result.advice.recommendation.action,
        signal_id: outcome.signal?.id ?? null,
        manager_task_created: false,
        formal_profile_changed: false,
      })
      await emit('assistant.completed', { message_id: message.id, sequence: message.sequence })
      return message
    }
    throw new DomainError('HARNESS_RESULT_KIND_UNSUPPORTED', 'Harness returned an unsupported result kind', 500)
  }

  private async createAgentSummary(
    run: AgentRun,
    actor: ActorContext,
    content: string,
    structuredContent: Record<string, unknown>,
  ): Promise<ConversationMessage> {
    return this.createMessage({
      roleSessionId: run.role_session_id,
      actor,
      runId: run.id,
      clarificationRoundId: null,
      senderType: 'AGENT',
      content,
      structuredContent,
      status: 'COMPLETED',
    })
  }

  private async createMessage(input: {
    id?: string
    roleSessionId: string
    actor: ActorContext
    runId: string | null
    clarificationRoundId: string | null
    senderType: 'HUMAN' | 'AGENT' | 'SYSTEM'
    content: string
    structuredContent: Record<string, unknown> | null
    status: ConversationMessage['status']
  }): Promise<ConversationMessage> {
    const existing = await this.store.listConversationMessages(input.roleSessionId)
    const timestamp = new Date().toISOString()
    const senderName = input.senderType === 'AGENT'
      ? '画像澄清 Agent'
      : input.senderType === 'SYSTEM'
        ? '系统'
        : input.actor.display_name
    const message: ConversationMessage = {
      id: input.id ?? randomUUID(),
      tenant_id: input.actor.tenant_id,
      role_session_id: input.roleSessionId,
      conversation_user_id: input.actor.user_id,
      run_id: input.runId,
      clarification_round_id: input.clarificationRoundId,
      sender_type: input.senderType,
      sender_user_id: input.senderType === 'HUMAN' ? input.actor.user_id : null,
      sender_role: input.senderType === 'HUMAN' ? input.actor.role : null,
      sender_name: senderName,
      content: input.content,
      structured_content: input.structuredContent,
      status: input.status,
      sequence: (existing.at(-1)?.sequence ?? 0) + 1,
      created_at: timestamp,
      completed_at: ['COMPLETED', 'FAILED', 'CANCELLED'].includes(input.status)
        ? timestamp
        : null,
    }
    await this.store.appendConversationMessage(message)
    return message
  }
}
