import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SidecarConfig } from './config.js'
import { buildRepairPrompt, buildTaskPrompt } from './prompts.js'
import { JsonRpcHarnessRuntime, type RuntimeTurn } from './protocol-client.js'
import {
  parseHarnessResult,
  requiredSaveTool,
  visibleResultText,
  type HarnessRequest,
  type HarnessResult,
} from './schemas.js'

export interface SidecarEvent {
  type: 'status' | 'delta' | 'tool.started' | 'tool.completed'
  value: string
  summary?: string
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
  const toolName = requiredSaveTool(request.task)
  const call = lastSuccessfulCall(calls, toolName)
  if (!call || !isRecord(call.arguments)) {
    throw new Error(`Cannot recover structured result from ${toolName}`)
  }
  const args = call.arguments
  if (request.task === 'CLARIFY_MESSAGE') {
    return parseHarnessResult(JSON.stringify({
      kind: 'CLARIFICATION',
      persistence: 'TOOL',
      answer: '事实草稿已通过领域工具保存，等待你的确认。',
      question: '这条事实是否准确？确认后我会继续生成岗位画像和评估方案。',
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
    const readiness = this.readiness()
    if (!readiness.runtime) {
      throw new Error('Harness runtime is not prepared; run corepack pnpm harness:prepare')
    }
    if (!readiness.credential) {
      throw new Error('DEEPSEEK_API_KEY is required for real Harness mode')
    }
    const startedAt = Date.now()
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
        DSH_SESSION_ROOT: sessionRoot,
      },
      model,
      provider: 'deepseek-official',
      maxTokens: this.config.DSH_MAX_TOKENS,
      requestTimeoutMs: this.config.DSH_RUN_TIMEOUT_MS,
    })
    const sessionId = `role-${request.execution_context.role_session_id}`
    const turns: RuntimeTurn[] = []
    let repaired = false
    let recoveredFromTool = false
    const runSignal = AbortSignal.any([
      signal,
      AbortSignal.timeout(this.config.DSH_RUN_TIMEOUT_MS),
    ])
    try {
      const initial = await runtime.runTurn(
        sessionId,
        buildTaskPrompt(request),
        runSignal,
        request.maximum_transitions,
      )
      turns.push(initial)
      if (initial.finishReason !== 'completed') {
        throw new Error(`Harness turn ended with ${initial.finishReason ?? 'unknown reason'}`)
      }
      let result: HarnessResult
      try {
        result = parseHarnessResult(initial.finalResponse)
      } catch (error) {
        repaired = true
        const repair = await runtime.runTurn(
          sessionId,
          buildRepairPrompt(error instanceof Error ? error.message : String(error)),
          runSignal,
          Math.max(0, request.maximum_transitions - initial.toolNames.length),
        )
        turns.push(repair)
        if (repair.finishReason !== 'completed') {
          throw new Error(`Harness repair turn ended with ${repair.finishReason ?? 'unknown reason'}`)
        }
        try {
          result = parseHarnessResult(repair.finalResponse)
        } catch {
          recoveredFromTool = true
          result = recoverResultFromTool(request, combineTurns(turns).successfulToolCalls)
        }
      }
      const combined = combineTurns(turns)
      if (combined.tools.length > request.maximum_transitions) {
        throw new Error(`Harness exceeded ${request.maximum_transitions} tool transitions`)
      }
      const required = ['read_role_state', requiredSaveTool(request.task)]
      for (const name of required) {
        if (!combined.successfulTools.includes(name)) {
          throw new Error(`Harness did not complete required tool: ${name}`)
        }
      }
      const events: SidecarEvent[] = [
        { type: 'status', value: `${model} 已完成真实 Harness 推理` },
        ...combined.toolEvents.map((event): SidecarEvent => event.type === 'tool.started'
          ? { type: event.type, value: event.value }
          : { type: event.type, value: event.value, summary: event.summary }),
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
