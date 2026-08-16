import {
  type AgentContextSnapshot,
  type AgentRouterAction,
  type AgentRouteRequest,
  type AgentRouteResult,
  type ArtifactType,
  type CalibrationAdvice,
  type CalibrationAdviceContext,
  type CandidateEvidence,
  type CandidateEvidenceFailure,
  type FactCategory,
  type HarnessDomainTask,
  type RoleState,
  type RecruitingContextBundle,
  type ToolExecutionContext,
} from '@role-clarifier/contracts'
import type { AppConfig } from '../config.js'

const TRANSIENT_SIDECAR_STATUSES = new Set([429, 502, 503, 504])

const isTransientFetchError = (error: unknown): boolean =>
  error instanceof TypeError
  || (error instanceof Error
    && /fetch failed|ECONNRESET|ECONNREFUSED|UND_ERR_SOCKET/i.test(error.message))

const abortableDelay = async (milliseconds: number, signal: AbortSignal): Promise<void> => {
  if (milliseconds <= 0) return
  await new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason ?? new DOMException('The operation was aborted', 'AbortError'))
      return
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, milliseconds)
    const abort = (): void => {
      clearTimeout(timer)
      reject(signal.reason ?? new DOMException('The operation was aborted', 'AbortError'))
    }
    signal.addEventListener('abort', abort, { once: true })
  })
}

export type HarnessTask = HarnessDomainTask

export interface CandidateImportItem {
  candidate_ref: string
  channel: string
  format: 'JSON' | 'TEXT'
  content: string | Record<string, unknown>
}

export interface HarnessRequest {
  task: HarnessTask
  role_state: RoleState
  message?: string
  conversation_context?: {
    current_user_role: 'MANAGER' | 'HR' | 'ADMIN'
    open_clarification: { ordinal: number; question: string } | null
    recent_messages: Array<{
      sender_type: 'HUMAN' | 'AGENT'
      sender_role: 'MANAGER' | 'HR' | 'ADMIN' | null
      content: string
    }>
  }
  candidates?: CandidateImportItem[]
  calibration_context?: CalibrationAdviceContext
  recruiting_context?: RecruitingContextBundle
  version_comparison?: {
    artifact_type: ArtifactType
    from_version: number
    to_version: number
  }
  execution_context: ToolExecutionContext
  maximum_transitions: 0 | 10
  structured_output_repair_attempts: 1
}

export type HarnessResult =
  | {
      kind: 'CONVERSATION'
      persistence: 'NONE'
      answer: string
      route_action?: AgentRouterAction
      route_task?: HarnessTask
    }
  | {
      kind: 'CLARIFICATION'
      persistence?: 'CALLER' | 'TOOL'
      answer: string
      question: string
      role_identity?: {
        title?: string
        department?: string
      }
      fact_draft: {
        category: FactCategory
        statement: string
      }
    }
  | { kind: 'ARTIFACT'; persistence?: 'CALLER' | 'TOOL'; artifact_type: ArtifactType; content: unknown; summary: string }
  | {
      kind: 'CANDIDATE_EVIDENCE'
      persistence?: 'CALLER' | 'TOOL'
      candidates: CandidateEvidence[]
      failed_candidates: CandidateEvidenceFailure[]
      summary: string
    }
  | {
      kind: 'CALIBRATION_ADVICE'
      persistence: 'CALLER'
      summary: string
      advice: CalibrationAdvice
    }
  | {
      kind: 'VERSION_COMPARISON'
      persistence: 'NONE'
      summary: string
      artifact_type: ArtifactType
      from_version: number
      to_version: number
    }

export interface HarnessTrace {
  model: string
  provider: string
  harness_source_version?: string
  harness_commit?: string
  tool_count: number
  input_tokens: number
  output_tokens: number
  duration_ms: number
  repaired: boolean
  recovered_from_tool?: boolean
}

export interface HarnessHooks {
  signal: AbortSignal
  onStatus(status: string): Promise<void>
  onContextSnapshot(snapshot: AgentContextSnapshot): Promise<void>
  onModelRequest(prompt: string): Promise<void>
  onModelResponse(response: string): Promise<void>
  onDelta(delta: string): Promise<void>
  onToolStarted(name: string, argumentsValue?: unknown): Promise<void>
  onToolCompleted(name: string, summary: string, resultValue?: unknown): Promise<void>
  onTrace(trace: HarnessTrace): Promise<void>
}

export interface HarnessAdapter {
  route(request: AgentRouteRequest, hooks: HarnessHooks): Promise<AgentRouteResult>
  run(request: HarnessRequest, hooks: HarnessHooks): Promise<HarnessResult>
}

interface SidecarRecoveryOptions {
  maximumRetries?: number
  retryDelayMs?: number
  readinessTimeoutMs?: number
}

export class SidecarHarnessAdapter implements HarnessAdapter {
  private readonly maximumRetries: number
  private readonly retryDelayMs: number
  private readonly readinessTimeoutMs: number

  constructor(
    private readonly config: AppConfig,
    options: SidecarRecoveryOptions = {},
  ) {
    this.maximumRetries = options.maximumRetries ?? 2
    this.retryDelayMs = options.retryDelayMs ?? 750
    this.readinessTimeoutMs = options.readinessTimeoutMs ?? 60_000
  }

  private async waitForSidecarReadiness(signal: AbortSignal): Promise<void> {
    const deadline = Date.now() + this.readinessTimeoutMs
    while (Date.now() < deadline) {
      if (signal.aborted) {
        throw signal.reason ?? new DOMException('The operation was aborted', 'AbortError')
      }
      try {
        const response = await fetch(`${this.config.HARNESS_BASE_URL}/healthz`, {
          signal: AbortSignal.any([signal, AbortSignal.timeout(3_000)]),
        })
        if (response.ok) return
        await response.body?.cancel()
      } catch (error) {
        if (signal.aborted) throw error
      }
      await abortableDelay(this.retryDelayMs, signal)
    }
    throw new Error('Harness Sidecar readiness timed out during recovery')
  }

  private async postWithRecovery(
    path: string,
    body: unknown,
    hooks: HarnessHooks,
    retryable: boolean,
  ): Promise<Response> {
    let retryCount = 0
    while (true) {
      try {
        const response = await fetch(`${this.config.HARNESS_BASE_URL}${path}`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${this.config.HARNESS_SIDECAR_TOKEN}`,
          },
          body: JSON.stringify(body),
          signal: hooks.signal,
        })
        if (
          !retryable
          || response.ok
          || !TRANSIENT_SIDECAR_STATUSES.has(response.status)
          || retryCount >= this.maximumRetries
        ) {
          return response
        }
        await response.body?.cancel()
      } catch (error) {
        if (
          !retryable
          || hooks.signal.aborted
          || !isTransientFetchError(error)
          || retryCount >= this.maximumRetries
        ) {
          throw error
        }
      }

      retryCount += 1
      await hooks.onStatus(
        `Harness Sidecar 暂时不可用，等待恢复后重试（${retryCount}/${this.maximumRetries}）`,
      )
      await this.waitForSidecarReadiness(hooks.signal)
      await abortableDelay(this.retryDelayMs * retryCount, hooks.signal)
    }
  }

  async route(request: AgentRouteRequest, hooks: HarnessHooks): Promise<AgentRouteResult> {
    await hooks.onStatus('DeepSeek Harness Sidecar 正在识别意图')
    const response = await this.postWithRecovery(
      '/v1/role-clarifier/routes',
      request,
      hooks,
      true,
    )
    if (!response.ok) {
      const body = await response.text()
      let detail = body.slice(0, 500)
      try {
        const parsed = JSON.parse(body) as { error?: { message?: string; code?: string } }
        detail = parsed.error?.message ?? parsed.error?.code ?? detail
      } catch {
        // Preserve the bounded response text when the sidecar did not return JSON.
      }
      throw new Error(`Harness Router returned ${response.status}: ${detail}`)
    }
    const routed = (await response.json()) as {
      result: AgentRouteResult
      events?: Array<
        | { type: 'status'; value: string }
        | { type: 'model.request'; value: string; attempt?: 'initial' | 'repair' }
        | { type: 'model.response'; value: string; attempt?: 'initial' | 'repair' }
        | { type: 'delta'; value: string }
      >
      trace: HarnessTrace
    }
    for (const event of routed.events ?? []) {
      if (event.type === 'status') await hooks.onStatus(event.value)
      else if (event.type === 'model.request') await hooks.onModelRequest(event.value)
      else if (event.type === 'model.response') await hooks.onModelResponse(event.value)
      else await hooks.onDelta(event.value)
    }
    await hooks.onTrace(routed.trace)
    return routed.result
  }

  async run(request: HarnessRequest, hooks: HarnessHooks): Promise<HarnessResult> {
    await hooks.onStatus('DeepSeek Harness Sidecar 正在执行')
    const response = await this.postWithRecovery(
      '/v1/role-clarifier/runs',
      request,
      hooks,
      request.maximum_transitions === 0,
    )
    if (!response.ok) {
      const body = await response.text()
      let detail = body.slice(0, 500)
      try {
        const parsed = JSON.parse(body) as { error?: { message?: string; code?: string } }
        detail = parsed.error?.message ?? parsed.error?.code ?? detail
      } catch {
        // Preserve the bounded response text when the sidecar did not return JSON.
      }
      throw new Error(`Harness Sidecar returned ${response.status}: ${detail}`)
    }
    const result = (await response.json()) as {
      result: HarnessResult
      events?: Array<
        | { type: 'status'; value: string }
        | { type: 'context.snapshot'; value: string; context: AgentContextSnapshot }
        | { type: 'model.request'; value: string; attempt?: 'initial' | 'repair' }
        | { type: 'model.response'; value: string; attempt?: 'initial' | 'repair' }
        | { type: 'delta'; value: string }
        | { type: 'tool.started'; value: string; arguments?: unknown }
        | { type: 'tool.completed'; value: string; summary: string; result?: unknown }
      >
      trace: HarnessTrace
    }
    for (const event of result.events ?? []) {
      if (event.type === 'status') await hooks.onStatus(event.value)
      else if (event.type === 'context.snapshot') await hooks.onContextSnapshot(event.context)
      else if (event.type === 'model.request') await hooks.onModelRequest(event.value)
      else if (event.type === 'model.response') await hooks.onModelResponse(event.value)
      else if (event.type === 'delta') await hooks.onDelta(event.value)
      else if (event.type === 'tool.started') await hooks.onToolStarted(event.value, event.arguments)
      else await hooks.onToolCompleted(event.value, event.summary, event.result)
    }
    await hooks.onTrace(result.trace)
    return result.result
  }
}
