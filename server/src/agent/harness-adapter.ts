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

export class SidecarHarnessAdapter implements HarnessAdapter {
  constructor(private readonly config: AppConfig) {}

  async route(request: AgentRouteRequest, hooks: HarnessHooks): Promise<AgentRouteResult> {
    await hooks.onStatus('DeepSeek Harness Sidecar 正在识别意图')
    const response = await fetch(`${this.config.HARNESS_BASE_URL}/v1/role-clarifier/routes`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.config.HARNESS_SIDECAR_TOKEN}`,
      },
      body: JSON.stringify(request),
      signal: hooks.signal,
    })
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
    const response = await fetch(`${this.config.HARNESS_BASE_URL}/v1/role-clarifier/runs`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.config.HARNESS_SIDECAR_TOKEN}`,
      },
      body: JSON.stringify(request),
      signal: hooks.signal,
    })
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
