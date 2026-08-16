import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
    provider: 'deepseek-official' | 'local-intent-router'
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

export const quickConversationReply = (request: HarnessRequest): string | null => {
  if (request.task !== 'CLARIFY_MESSAGE') return null
  const message = request.message?.trim() ?? ''
  if (!message) return null
  if (/你在吗|在不在|你(可以|能|会).*(干啥|做什么|做些?什么)|你能干啥|有什么功能|怎么使用你|怎么用你|帮助/.test(message)) {
    return '我在。你可以把我当作这个岗位的招聘共创助手：我能回答岗位和招聘流程问题，梳理招聘原因与成功标准，生成岗位画像、评估方案和四段式 JD，也能基于脱敏候选人证据提出校准建议。普通提问我会直接回答；只有你补充岗位事实或实质回答当前澄清题时，我才会保存草稿并推进主动澄清轮次。'
  }
  if (/^(你好|您好|嗨|hi|hello)[!！。,.，\s]*$/i.test(message)) {
    return '你好，我在。你可以直接问我岗位或招聘相关问题，也可以补充招聘原因、成功标准或岗位约束；我会先判断你的意图，再决定是直接回答还是进入岗位澄清。'
  }
  if (/^(谢谢|感谢|收到|明白了|好的)[!！。,.，\s]*$/.test(message)) {
    return '不客气。你可以继续提问；如果要推进岗位澄清，也可以直接补充招聘原因、成功标准或当前问题的答案。'
  }
  return null
}

export const maxTokensForTask = (task: HarnessTask, configuredMaximum: number): number => {
  if (task === 'CLARIFY_MESSAGE') return Math.min(configuredMaximum, 4_096)
  if (task === 'EXTRACT_CANDIDATES') return Math.min(configuredMaximum, 8_192)
  return configuredMaximum
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
  const toolName = requiredSaveTool(request.task)
  const call = lastSuccessfulCall(calls, toolName)
  if (request.task === 'CLARIFY_MESSAGE' && (!call || !isRecord(call.arguments))) {
    return {
      kind: 'CONVERSATION',
      persistence: 'NONE',
      answer: quickConversationReply(request)
        ?? '我理解了你的消息，但这轮没有形成可可靠保存的岗位事实。你可以继续直接提问，或补充招聘原因、成功标准和岗位约束，我会明确说明是否进入岗位澄清。',
    }
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
    const quickReply = quickConversationReply(request)
    if (quickReply) {
      const localRouterContext = {
        ...contextSnapshot,
        system_prompt: {
          ...contextSnapshot.system_prompt,
          harness_managed_base: {
            included: false,
            captured_as_text: false,
            description: '本轮由本地意图路由直接回答，未调用 DeepSeek Harness 或模型。',
          },
        },
        task_state: {
          ...contextSnapshot.task_state,
          execution_path: 'LOCAL_INTENT_ROUTER',
        },
      } satisfies typeof contextSnapshot
      return {
        result: { kind: 'CONVERSATION', persistence: 'NONE', answer: quickReply },
        events: [
          { type: 'status', value: '普通问答意图已识别，不调用岗位写入工具' },
          { type: 'context.snapshot', value: '本轮上下文分层快照', context: localRouterContext },
          { type: 'delta', value: quickReply },
        ],
        trace: {
          model: 'intent-router-v1',
          provider: 'local-intent-router',
          harness_source_version: '0.1.0-rc.5',
          harness_commit: HARNESS_COMMIT,
          tool_count: 0,
          input_tokens: 0,
          output_tokens: 0,
          duration_ms: Date.now() - startedAt,
          repaired: false,
          recovered_from_tool: false,
        },
      }
    }
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
          recoveredFromTool = true
          result = recoverResultFromTool(request, combineTurns(turns).successfulToolCalls)
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
