import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { artifactTypeForTask } from '@role-clarifier/contracts'
import type { SidecarConfig } from './config.js'
import { buildContextSnapshot, buildRepairPrompt, buildTaskPrompt } from './prompts.js'
import { JsonRpcHarnessRuntime, type RuntimeTurn } from './protocol-client.js'
import {
  parseHarnessResult,
  requiredSaveTool,
  visibleResultText,
  type HarnessRequest,
  type HarnessResult,
  type HarnessTask,
} from './schemas.js'

export interface SidecarEvent {
  type: 'status' | 'context.snapshot' | 'model.request' | 'model.response' | 'delta' | 'tool.started' | 'tool.completed'
  value: string
  context?: import('@role-clarifier/contracts').AgentContextSnapshot
  summary?: string
  arguments?: unknown
  result?: unknown
  attempt?: 'initial' | 'repair'
}

export interface SidecarExecution {
  result: HarnessResult
  events: SidecarEvent[]
  trace: {
    model: string
    provider: 'deepseek-official'
    harness_source_version: '0.1.0-rc.5'
    harness_commit: string
    tool_count: number
    input_tokens: number
    output_tokens: number
    duration_ms: number
    repaired: boolean
    recovered_from_tool: boolean
  }
}

const HARNESS_COMMIT = '47f943859bef60e4160492346772ded9b24f765a'

export const maxTokensForTask = (task: HarnessTask, configuredMaximum: number): number => {
  if (task === 'CLARIFY_MESSAGE') return Math.min(configuredMaximum, 4_096)
  if (task === 'EXTRACT_CANDIDATES') return Math.min(configuredMaximum, 8_192)
  return configuredMaximum
}

export const timeoutMsForTask = (
  task: HarnessTask,
  configuredDefault: number,
  configuredRoleProfile: number,
): number => task === 'GENERATE_ROLE_PROFILE'
  ? configuredRoleProfile
  : configuredDefault

export const terminalToolForTask = (task: HarnessTask): string | undefined =>
  task === 'CLARIFY_MESSAGE' ? undefined : requiredSaveTool(task)

const combineTurns = (turns: RuntimeTurn[]) => ({
  tools: turns.flatMap((turn) => turn.toolNames),
  successfulTools: turns.flatMap((turn) => turn.successfulToolNames),
  successfulToolCalls: turns.flatMap((turn) => turn.successfulToolCalls),
  toolEvents: turns.flatMap((turn) => turn.toolEvents),
  inputTokens: turns.reduce((sum, turn) => sum + turn.inputTokens, 0),
  outputTokens: turns.reduce((sum, turn) => sum + turn.outputTokens, 0),
})

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const lastSuccessfulCall = (
  calls: Array<{ name: string; arguments: unknown }>,
  name: string,
): { name: string; arguments: unknown } | undefined => {
  for (let index = calls.length - 1; index >= 0; index -= 1) {
    if (calls[index]?.name === name) return calls[index]
  }
  return undefined
}

const isExpectedArtifactCall = (
  call: { name: string; arguments: unknown } | undefined,
  expectedArtifactType: string | undefined,
): boolean => call?.name === 'save_artifact_draft' && (
  expectedArtifactType === undefined
  || (isRecord(call.arguments) && call.arguments.artifact_type === expectedArtifactType)
)

export const recoverResultFromTool = (
  request: HarnessRequest,
  calls: Array<{ name: string; arguments: unknown }>,
): HarnessResult => {
  const toolName = requiredSaveTool(request.task)
  const call = lastSuccessfulCall(calls, toolName)
  if (request.task === 'CLARIFY_MESSAGE' && (!call || !isRecord(call.arguments))) {
    throw new Error('Cannot recover a model-generated conversation without a valid model response')
  }
  if (!call || !isRecord(call.arguments)) {
    throw new Error(`Cannot recover structured result from ${toolName}`)
  }
  const args = call.arguments
  const expectedArtifactType = artifactTypeForTask(request.task)
  if (expectedArtifactType && args.artifact_type !== expectedArtifactType) {
    throw new Error(`Saved artifact type ${String(args.artifact_type)} does not match ${request.task}`)
  }
  if (request.task === 'CLARIFY_MESSAGE') {
    const identityCall = lastSuccessfulCall(calls, 'update_role_identity_draft')
    const roleIdentity = identityCall && isRecord(identityCall.arguments)
      ? {
          ...(typeof identityCall.arguments.title === 'string'
            ? { title: identityCall.arguments.title }
            : {}),
          ...(typeof identityCall.arguments.department === 'string'
            ? { department: identityCall.arguments.department }
            : {}),
        }
      : undefined
    return parseHarnessResult(JSON.stringify({
      kind: 'CLARIFICATION',
      persistence: 'TOOL',
      answer: `我已记录这项${args.category === 'HIRING_REASON' ? '招聘原因' : '成功标准'}：${String(args.statement)}`,
      question: args.category === 'HIRING_REASON'
        ? '如果半年后证明这次招聘成功，最重要的一个可观察业务结果是什么？'
        : '这项结果由谁验收，最关键的量化或可观察指标是什么？',
      ...(roleIdentity && Object.keys(roleIdentity).length > 0
        ? { role_identity: roleIdentity }
        : {}),
      fact_draft: { category: args.category, statement: args.statement },
    }))
  }
  if (request.task === 'EXTRACT_CANDIDATES') {
    return parseHarnessResult(JSON.stringify({
      kind: 'CANDIDATE_EVIDENCE',
      persistence: 'TOOL',
      candidates: args.candidates,
    }))
  }
  if (request.task === 'CALIBRATION_ADVICE') {
    return parseHarnessResult(JSON.stringify({
      kind: 'CALIBRATION_ADVICE',
      persistence: 'TOOL',
      proposed_change: args.proposed_change,
    }))
  }
  return parseHarnessResult(JSON.stringify({
    kind: 'ARTIFACT',
    persistence: 'TOOL',
    artifact_type: args.artifact_type,
    content: args.content,
  }))
}

export class HarnessExecutor {
  constructor(private readonly config: SidecarConfig) {}

  readiness(): { runtime: boolean; credential: boolean } {
    return {
      runtime: existsSync(this.config.DSH_RUNTIME_BIN) && existsSync(this.config.DSH_CORDIS_CONFIG),
      credential: Boolean(this.config.DEEPSEEK_API_KEY),
    }
  }

  async execute(request: HarnessRequest, signal: AbortSignal): Promise<SidecarExecution> {
    const startedAt = Date.now()
    const contextSnapshot = buildContextSnapshot(request)
    const readiness = this.readiness()
    if (!readiness.runtime) {
      throw new Error('Harness runtime is not prepared; run corepack pnpm harness:prepare')
    }
    if (!readiness.credential) {
      throw new Error('DEEPSEEK_API_KEY is required for real Harness mode')
    }
    const model = request.task === 'CLARIFY_MESSAGE' || request.task === 'EXTRACT_CANDIDATES'
      ? this.config.DEEPSEEK_FLASH_MODEL
      : this.config.DEEPSEEK_PRO_MODEL
    const timeoutMs = timeoutMsForTask(
      request.task,
      this.config.DSH_RUN_TIMEOUT_MS,
      this.config.DSH_ROLE_PROFILE_TIMEOUT_MS,
    )
    const sessionRoot = await mkdtemp(join(tmpdir(), 'role-clarifier-dsh-'))
    const runtime = new JsonRpcHarnessRuntime({
      runtimeBin: this.config.DSH_RUNTIME_BIN,
      cordisConfig: this.config.DSH_CORDIS_CONFIG,
      cwd: process.cwd(),
      env: {
        ...process.env,
        DEEPSEEK_API_KEY: this.config.DEEPSEEK_API_KEY,
        ...(this.config.DEEPSEEK_BASE_URL ? { DEEPSEEK_BASE_URL: this.config.DEEPSEEK_BASE_URL } : {}),
        ROLE_AGENT_INTERNAL_URL: this.config.ROLE_AGENT_INTERNAL_URL,
        ROLE_AGENT_TOOL_TOKEN: this.config.ROLE_AGENT_TOOL_TOKEN,
        DSH_SESSION_ROOT: sessionRoot,
      },
      model,
      provider: 'deepseek-official',
      maxTokens: maxTokensForTask(request.task, this.config.DSH_MAX_TOKENS),
      requestTimeoutMs: timeoutMs,
    })
    const sessionId = `role-${request.execution_context.role_session_id}`
    const turns: RuntimeTurn[] = []
    const modelEvents: SidecarEvent[] = []
    let repaired = false
    let recoveredFromTool = false
    const runSignal = AbortSignal.any([
      signal,
      AbortSignal.timeout(timeoutMs),
    ])
    try {
      const initialPrompt = buildTaskPrompt(request)
      modelEvents.push({ type: 'model.request', value: initialPrompt, attempt: 'initial' })
      const terminalTool = terminalToolForTask(request.task)
      const terminalArtifactType = artifactTypeForTask(request.task)
      const initial = await runtime.runTurn(
        sessionId,
        initialPrompt,
        runSignal,
        request.maximum_transitions,
        terminalTool,
        terminalArtifactType,
      )
      turns.push(initial)
      modelEvents.push({ type: 'model.response', value: initial.finalResponse, attempt: 'initial' })
      let result: HarnessResult
      const initialPersisted = terminalTool !== undefined
        && (terminalArtifactType === undefined
          ? initial.successfulToolNames.includes(terminalTool)
          : initial.successfulToolCalls.some((call) => isExpectedArtifactCall(call, terminalArtifactType)))
      if (initial.finishReason !== 'completed') {
        if (!initialPersisted) {
          throw new Error(`Harness turn ended with ${initial.finishReason ?? 'unknown reason'}`)
        }
        result = recoverResultFromTool(request, initial.successfulToolCalls)
        recoveredFromTool = true
      } else try {
        result = parseHarnessResult(initial.finalResponse)
      } catch (error) {
        repaired = true
        const repairPrompt = buildRepairPrompt(
          request,
          error instanceof Error ? error.message : String(error),
        )
        modelEvents.push({ type: 'model.request', value: repairPrompt, attempt: 'repair' })
        const repair = await runtime.runTurn(
          sessionId,
          repairPrompt,
          runSignal,
          Math.max(0, request.maximum_transitions - initial.toolNames.length),
          terminalTool,
          terminalArtifactType,
        )
        turns.push(repair)
        modelEvents.push({ type: 'model.response', value: repair.finalResponse, attempt: 'repair' })
        const repairPersisted = terminalTool !== undefined
          && (terminalArtifactType === undefined
            ? repair.successfulToolNames.includes(terminalTool)
            : repair.successfulToolCalls.some((call) => isExpectedArtifactCall(call, terminalArtifactType)))
        if (repair.finishReason !== 'completed' && !repairPersisted) {
          throw new Error(`Harness repair turn ended with ${repair.finishReason ?? 'unknown reason'}`)
        }
        try {
          result = parseHarnessResult(repair.finalResponse)
        } catch {
          result = recoverResultFromTool(request, combineTurns(turns).successfulToolCalls)
          recoveredFromTool = true
        }
      }
      const combined = combineTurns(turns)
      if (combined.tools.length > request.maximum_transitions) {
        throw new Error(`Harness exceeded ${request.maximum_transitions} tool transitions`)
      }
      const required = result.kind === 'CONVERSATION'
        ? []
        : ['read_role_state', requiredSaveTool(request.task)]
      for (const name of required) {
        if (!combined.successfulTools.includes(name)) {
          throw new Error(`Harness did not complete required tool: ${name}`)
        }
      }
      const events: SidecarEvent[] = [
        { type: 'status', value: `${model} 已完成真实 Harness 推理` },
        { type: 'context.snapshot', value: '本轮上下文分层快照', context: contextSnapshot },
        ...modelEvents.filter((event) => event.type === 'model.request' && event.attempt === 'initial'),
        ...combined.toolEvents.map((event): SidecarEvent => event.type === 'tool.started'
          ? { type: event.type, value: event.value, arguments: event.arguments }
          : {
              type: event.type,
              value: event.value,
              summary: event.summary,
              result: event.result,
            }),
        ...modelEvents.filter((event) => event.type === 'model.response' && event.attempt === 'initial'),
        ...modelEvents.filter((event) => event.attempt === 'repair'),
        { type: 'delta', value: visibleResultText(result) },
      ]
      return {
        result,
        events,
        trace: {
          model,
          provider: 'deepseek-official',
          harness_source_version: '0.1.0-rc.5',
          harness_commit: HARNESS_COMMIT,
          tool_count: combined.tools.length,
          input_tokens: combined.inputTokens,
          output_tokens: combined.outputTokens,
          duration_ms: Date.now() - startedAt,
          repaired,
          recovered_from_tool: recoveredFromTool,
        },
      }
    } finally {
      await runtime.close()
      await rm(sessionRoot, { recursive: true, force: true })
    }
  }
}
