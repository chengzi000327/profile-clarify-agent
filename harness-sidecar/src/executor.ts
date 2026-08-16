import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  HARNESS_TASK_TOOL_POLICY,
  type AgentRouteRequest,
  type AgentRouteResult,
  type RoleAgentToolName,
} from '@role-clarifier/contracts'
import type { SidecarConfig } from './config.js'
import { buildContextSnapshot, buildRepairPrompt, buildTaskPrompt } from './prompts.js'
import { JsonRpcHarnessRuntime, type RuntimeTurn } from './protocol-client.js'
import {
  buildRoutePrompt,
  buildRouteRepairPrompt,
  parseAgentRouteResult,
} from './routing.js'
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

export interface SidecarRouteExecution {
  result: AgentRouteResult
  events: SidecarEvent[]
  trace: SidecarExecution['trace']
}

const HARNESS_COMMIT = '47f943859bef60e4160492346772ded9b24f765a'

export const maxTokensForTask = (task: HarnessTask, configuredMaximum: number): number => {
  if (task === 'CLARIFY_MESSAGE') return Math.min(configuredMaximum, 4_096)
  if (task === 'EXTRACT_CANDIDATES') return Math.min(configuredMaximum, 8_192)
  return configuredMaximum
}

export const assertTaskToolPolicy = (
  task: HarnessTask,
  calledTools: string[],
  successfulTools: string[],
): void => {
  const policy = HARNESS_TASK_TOOL_POLICY[task]
  const unexpected = [...new Set(calledTools.filter((name) =>
    !(policy.allowed as readonly RoleAgentToolName[]).includes(name as RoleAgentToolName)))]
  if (unexpected.length > 0) {
    throw new Error(`Harness called tools outside ${task} allowlist: ${unexpected.join(', ')}`)
  }
  for (const name of policy.required) {
    if (!successfulTools.includes(name)) {
      throw new Error(`Harness did not complete required tool: ${name}`)
    }
  }
}

const assertTaskResult = (task: HarnessTask, result: HarnessResult): void => {
  if (task === 'CLARIFY_MESSAGE' && result.kind !== 'CLARIFICATION') {
    throw new Error(`Task ${task} cannot return ${result.kind}`)
  }
  if (task === 'EXTRACT_CANDIDATES' && result.kind !== 'CANDIDATE_EVIDENCE') {
    throw new Error(`Task ${task} cannot return ${result.kind}`)
  }
  if (task === 'CALIBRATION_ADVICE' && result.kind !== 'CALIBRATION_ADVICE') {
    throw new Error(`Task ${task} cannot return ${result.kind}`)
  }
  if (task === 'VERSION_COMPARISON' && result.kind !== 'VERSION_COMPARISON') {
    throw new Error(`Task ${task} cannot return ${result.kind}`)
  }
  const artifactTypeByTask: Partial<Record<HarnessTask, string>> = {
    GENERATE_ROLE_PROFILE: 'ROLE_PROFILE',
    GENERATE_ASSESSMENT: 'ASSESSMENT_SCORECARD',
    GENERATE_JD: 'PUBLIC_JD',
    GENERATE_HR_BRIEF: 'HR_RECRUITING_BRIEF',
  }
  const expectedArtifact = artifactTypeByTask[task]
  if (expectedArtifact && (
    result.kind !== 'ARTIFACT' || result.artifact_type !== expectedArtifact
  )) {
    throw new Error(`Task ${task} must return ${expectedArtifact} artifact`)
  }
}

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

export const recoverResultFromTool = (
  request: HarnessRequest,
  calls: Array<{ name: string; arguments: unknown }>,
): HarnessResult => {
  if (request.task === 'VERSION_COMPARISON') {
    throw new Error('Cannot recover a model-generated version comparison')
  }
  const toolName = requiredSaveTool(request.task)
  const call = lastSuccessfulCall(calls, toolName)
  if (request.task === 'CLARIFY_MESSAGE' && (!call || !isRecord(call.arguments))) {
    throw new Error('Cannot recover a model-generated conversation without a valid model response')
  }
  if (!call || !isRecord(call.arguments)) {
    throw new Error(`Cannot recover structured result from ${toolName}`)
  }
  const args = call.arguments
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

  async route(request: AgentRouteRequest, signal: AbortSignal): Promise<SidecarRouteExecution> {
    const startedAt = Date.now()
    const readiness = this.readiness()
    if (!readiness.runtime) {
      throw new Error('Harness runtime is not prepared; run corepack pnpm harness:prepare')
    }
    if (!readiness.credential) {
      throw new Error('DEEPSEEK_API_KEY is required for real Harness mode')
    }
    const model = this.config.DEEPSEEK_FLASH_MODEL
    const sessionRoot = await mkdtemp(join(tmpdir(), 'role-router-dsh-'))
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
        ROLE_AGENT_ALLOWED_TOOLS: '[]',
        ROLE_AGENT_MODE: 'router',
        DSH_SESSION_ROOT: sessionRoot,
      },
      model,
      provider: 'deepseek-official',
      maxTokens: Math.min(this.config.DSH_MAX_TOKENS, 4_096),
      requestTimeoutMs: this.config.DSH_RUN_TIMEOUT_MS,
    })
    const sessionId = `route-${request.role_state.id}`
    const turns: RuntimeTurn[] = []
    const events: SidecarEvent[] = []
    let repaired = false
    const runSignal = AbortSignal.any([
      signal,
      AbortSignal.timeout(this.config.DSH_RUN_TIMEOUT_MS),
    ])
    try {
      const initialPrompt = buildRoutePrompt(request)
      events.push({ type: 'model.request', value: initialPrompt, attempt: 'initial' })
      const initial = await runtime.runTurn(sessionId, initialPrompt, runSignal, 0)
      turns.push(initial)
      events.push({ type: 'model.response', value: initial.finalResponse, attempt: 'initial' })
      if (initial.finishReason !== 'completed') {
        throw new Error(`Router turn ended with ${initial.finishReason ?? 'unknown reason'}`)
      }
      let result: AgentRouteResult
      try {
        result = parseAgentRouteResult(initial.finalResponse)
      } catch (error) {
        repaired = true
        const repairPrompt = buildRouteRepairPrompt(
          error instanceof Error ? error.message : String(error),
        )
        events.push({ type: 'model.request', value: repairPrompt, attempt: 'repair' })
        const repair = await runtime.runTurn(sessionId, repairPrompt, runSignal, 0)
        turns.push(repair)
        events.push({ type: 'model.response', value: repair.finalResponse, attempt: 'repair' })
        if (repair.finishReason !== 'completed') {
          throw new Error(`Router repair turn ended with ${repair.finishReason ?? 'unknown reason'}`)
        }
        result = parseAgentRouteResult(repair.finalResponse)
      }
      const combined = combineTurns(turns)
      if (combined.tools.length > 0) {
        throw new Error(`Router attempted forbidden tools: ${combined.tools.join(', ')}`)
      }
      const visibleText = result.action === 'ASK'
        ? result.question
        : result.action === 'RESPOND'
          ? result.answer
          : `已交接任务 ${result.task}`
      return {
        result,
        events: [
          { type: 'status', value: `${model} 已完成无工具意图路由` },
          ...events,
          ...(result.action === 'HANDOFF' ? [] : [{ type: 'delta' as const, value: visibleText }]),
        ],
        trace: {
          model,
          provider: 'deepseek-official',
          harness_source_version: '0.1.0-rc.5',
          harness_commit: HARNESS_COMMIT,
          tool_count: 0,
          input_tokens: combined.inputTokens,
          output_tokens: combined.outputTokens,
          duration_ms: Date.now() - startedAt,
          repaired,
          recovered_from_tool: false,
        },
      }
    } finally {
      await runtime.close()
      await rm(sessionRoot, { recursive: true, force: true })
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
        ROLE_AGENT_ALLOWED_TOOLS: JSON.stringify(HARNESS_TASK_TOOL_POLICY[request.task].allowed),
        ROLE_AGENT_MODE: 'domain',
        DSH_SESSION_ROOT: sessionRoot,
      },
      model,
      provider: 'deepseek-official',
      maxTokens: maxTokensForTask(request.task, this.config.DSH_MAX_TOKENS),
      requestTimeoutMs: this.config.DSH_RUN_TIMEOUT_MS,
    })
    const sessionId = `role-${request.execution_context.role_session_id}`
    const turns: RuntimeTurn[] = []
    const modelEvents: SidecarEvent[] = []
    let repaired = false
    let recoveredFromTool = false
    const runSignal = AbortSignal.any([
      signal,
      AbortSignal.timeout(this.config.DSH_RUN_TIMEOUT_MS),
    ])
    try {
      const initialPrompt = buildTaskPrompt(request)
      modelEvents.push({ type: 'model.request', value: initialPrompt, attempt: 'initial' })
      const initial = await runtime.runTurn(
        sessionId,
        initialPrompt,
        runSignal,
        request.maximum_transitions,
      )
      turns.push(initial)
      modelEvents.push({ type: 'model.response', value: initial.finalResponse, attempt: 'initial' })
      if (initial.finishReason !== 'completed') {
        throw new Error(`Harness turn ended with ${initial.finishReason ?? 'unknown reason'}`)
      }
      let result: HarnessResult
      try {
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
        )
        turns.push(repair)
        modelEvents.push({ type: 'model.response', value: repair.finalResponse, attempt: 'repair' })
        if (repair.finishReason !== 'completed') {
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
      if (request.task === 'VERSION_COMPARISON' && result.kind === 'VERSION_COMPARISON') {
        const expected = request.version_comparison
        if (
          !expected
          || result.artifact_type !== expected.artifact_type
          || result.from_version !== expected.from_version
          || result.to_version !== expected.to_version
        ) {
          throw new Error('VERSION_COMPARISON result does not match requested versions')
        }
        const diffCalls = combined.successfulToolCalls.filter((call) =>
          call.name === 'read_version_diff')
        if (
          diffCalls.length !== 1
          || !isRecord(diffCalls[0]?.arguments)
          || diffCalls[0].arguments.artifact_type !== expected.artifact_type
          || diffCalls[0].arguments.from_version !== expected.from_version
          || diffCalls[0].arguments.to_version !== expected.to_version
        ) {
          throw new Error('read_version_diff arguments do not match requested versions')
        }
      }
      assertTaskResult(request.task, result)
      assertTaskToolPolicy(request.task, combined.tools, combined.successfulTools)
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
