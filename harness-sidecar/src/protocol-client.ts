import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'

interface PendingRequest {
  resolve(value: unknown): void
  reject(error: Error): void
  timeout: NodeJS.Timeout
}

interface JsonRpcFrame {
  jsonrpc?: string
  id?: number
  method?: string
  params?: Record<string, unknown>
  result?: unknown
  error?: { code?: number; message?: string; data?: unknown }
}

export interface RuntimeLaunch {
  runtimeBin: string
  cordisConfig: string
  cwd: string
  env: NodeJS.ProcessEnv
  model: string
  provider: string
  maxTokens: number
  requestTimeoutMs: number
}

export interface RuntimeTurn {
  finalResponse: string
  toolNames: string[]
  successfulToolNames: string[]
  successfulToolCalls: Array<{ name: string; arguments: unknown }>
  toolEvents: Array<
    | { type: 'tool.started'; value: string; arguments: unknown }
    | { type: 'tool.completed'; value: string; summary: string; result: unknown }
  >
  inputTokens: number
  outputTokens: number
  finishReason: string | null
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const eventOf = (frame: JsonRpcFrame): Record<string, unknown> | undefined => {
  if (frame.method !== 'session.event' || !isRecord(frame.params)) return undefined
  return isRecord(frame.params.event) ? frame.params.event : undefined
}

const sessionOf = (frame: JsonRpcFrame): string | undefined =>
  isRecord(frame.params) && typeof frame.params.sessionId === 'string'
    ? frame.params.sessionId
    : undefined

const eventData = (event: Record<string, unknown>): Record<string, unknown> =>
  isRecord(event.data) ? event.data : {}

const isReceipt = (event: Record<string, unknown>, messageId: string): boolean => {
  if (event.type !== 'agent/inbox/spliced') return false
  const inserted = eventData(event).inserted
  return Array.isArray(inserted) && inserted.some((item) => isRecord(item) && item.id === messageId)
}

const assistantText = (event: Record<string, unknown>): string => {
  if (event.type !== 'assistant/message') return ''
  const message = eventData(event).message
  const content = isRecord(message) ? message.content : undefined
  if (!Array.isArray(content)) return ''
  return content
    .filter((block) => isRecord(block) && block.type === 'text' && typeof block.text === 'string')
    .map((block) => String(block.text))
    .join('')
}

const usageOf = (event: Record<string, unknown>): { input: number; output: number } => {
  if (event.type !== 'assistant/message') return { input: 0, output: 0 }
  const usage = eventData(event).usage
  if (!isRecord(usage)) return { input: 0, output: 0 }
  return {
    input: typeof usage.inputTokens === 'number' ? usage.inputTokens : 0,
    output: typeof usage.outputTokens === 'number' ? usage.outputTokens : 0,
  }
}

const toolResultSummary = (event: Record<string, unknown>): string =>
  toolResultSucceeded(event) ? '领域工具执行成功' : '领域工具执行失败'

const toolResultPayload = (event: Record<string, unknown>): unknown => {
  const message = eventData(event).message
  const content = isRecord(message) ? message.content : undefined
  return Array.isArray(content) ? content : content ?? null
}

const toolResultSucceeded = (event: Record<string, unknown>): boolean => {
  const message = eventData(event).message
  const content = isRecord(message) ? message.content : undefined
  if (!Array.isArray(content)) return false
  return content.some((block) => isRecord(block) && block.type === 'tool-result' && block.isError !== true)
}

export class JsonRpcHarnessRuntime {
  private child: ChildProcessWithoutNullStreams | undefined
  private serial = 0
  private readonly pending = new Map<number, PendingRequest>()
  private readonly stderrTail: string[] = []
  private notificationHandler: ((frame: JsonRpcFrame) => void) | undefined
  private activeTurnReject: ((error: Error) => void) | undefined
  private exited = false

  constructor(private readonly launch: RuntimeLaunch) {}

  async start(): Promise<void> {
    if (this.child) return
    const child = spawn(process.execPath, [this.launch.runtimeBin, this.launch.cordisConfig], {
      cwd: this.launch.cwd,
      env: this.launch.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.child = child
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      this.stderrTail.push(...chunk.split('\n').filter(Boolean))
      if (this.stderrTail.length > 80) this.stderrTail.splice(0, this.stderrTail.length - 80)
    })
    child.once('error', (error) => this.failAll(error))
    child.once('exit', (code) => {
      this.exited = true
      const error = new Error(
        `Harness runtime exited (${code ?? 'signal'}): ${this.stderrTail.join('\n').slice(-4000)}`,
      )
      this.failAll(error)
      this.activeTurnReject?.(error)
    })
    const lines = createInterface({ input: child.stdout })
    lines.on('line', (line) => this.receive(line))
    await this.request('initialize', {
      cwd: this.launch.cwd,
      provider: this.launch.provider,
      model: this.launch.model,
      maxTokens: this.launch.maxTokens,
    })
  }

  async runTurn(
    sessionId: string,
    prompt: string,
    signal: AbortSignal,
    maximumToolCalls = 10,
  ): Promise<RuntimeTurn> {
    await this.start()
    const frames: JsonRpcFrame[] = []
    let expectedMessageId: string | undefined
    let receiptSeen = false
    let settled = false
    let resolveIdle!: () => void
    let rejectIdle!: (error: Error) => void
    const idle = new Promise<void>((resolve, reject) => {
      resolveIdle = resolve
      rejectIdle = reject
    })
    const inspect = (frame: JsonRpcFrame): void => {
      if (sessionOf(frame) !== sessionId) return
      frames.push(frame)
      const event = eventOf(frame)
      if (event?.type === 'tool/call') {
        const toolCallCount = frames.reduce((count, candidate) =>
          count + (eventOf(candidate)?.type === 'tool/call' ? 1 : 0), 0)
        if (toolCallCount > maximumToolCalls && !settled) {
          settled = true
          const error = new Error(`Harness exceeded ${maximumToolCalls} tool transitions`)
          rejectIdle(error)
          this.child?.kill('SIGTERM')
          return
        }
      }
      if (!receiptSeen && expectedMessageId && event && isReceipt(event, expectedMessageId)) {
        receiptSeen = true
      }
      if (receiptSeen && frame.method === 'session.status' && frame.params?.status === 'idle' && !settled) {
        settled = true
        resolveIdle()
      }
    }
    this.notificationHandler = inspect
    this.activeTurnReject = (error): void => {
      if (settled) return
      settled = true
      rejectIdle(error)
    }
    const abort = (): void => {
      if (settled) return
      settled = true
      rejectIdle(new DOMException('Harness run cancelled', 'AbortError'))
      this.child?.kill('SIGTERM')
    }
    signal.addEventListener('abort', abort, { once: true })
    try {
      const response = await this.request('session/prompt', {
        sessionId,
        contentBlocks: [{ type: 'text', text: prompt }],
      })
      if (!isRecord(response) || typeof response.messageId !== 'string') {
        throw new Error('Harness session/prompt returned no messageId')
      }
      expectedMessageId = response.messageId
      receiptSeen = frames.some((frame) => {
        const event = eventOf(frame)
        return event ? isReceipt(event, expectedMessageId!) : false
      })
      if (receiptSeen) {
        const idleSeen = frames.some((frame) =>
          frame.method === 'session.status' && frame.params?.status === 'idle')
        if (idleSeen && !settled) {
          settled = true
          resolveIdle()
        }
      }
      await idle
    } finally {
      signal.removeEventListener('abort', abort)
      this.notificationHandler = undefined
      this.activeTurnReject = undefined
    }

    let finalResponse = ''
    let inputTokens = 0
    let outputTokens = 0
    let finishReason: string | null = null
    const calls = new Map<string, { name: string; arguments: unknown }>()
    const toolNames: string[] = []
    const successfulToolNames: string[] = []
    const successfulToolCalls: RuntimeTurn['successfulToolCalls'] = []
    const toolEvents: RuntimeTurn['toolEvents'] = []
    for (const frame of frames) {
      const event = eventOf(frame)
      if (!event) continue
      const text = assistantText(event)
      if (text) finalResponse = text
      const usage = usageOf(event)
      inputTokens += usage.input
      outputTokens += usage.output
      const data = eventData(event)
      if (event.type === 'tool/call' && typeof data.name === 'string') {
        const callId = typeof data.callId === 'string' ? data.callId : `${toolNames.length}`
        let parsedArguments: unknown = data.arguments
        if (typeof data.arguments === 'string') {
          try {
            parsedArguments = JSON.parse(data.arguments)
          } catch {
            // Keep the raw argument string; recovery will reject it if structure is required.
          }
        }
        calls.set(callId, { name: data.name, arguments: parsedArguments })
        toolNames.push(data.name)
        toolEvents.push({ type: 'tool.started', value: data.name, arguments: parsedArguments })
      }
      if (event.type === 'tool/result') {
        const message = data.message
        const source = isRecord(message) ? message.source : undefined
        const callId = isRecord(source) && typeof source.callId === 'string' ? source.callId : ''
        const call = calls.get(callId) ?? { name: 'unknown-tool', arguments: undefined }
        const name = call.name
        if (toolResultSucceeded(event)) {
          successfulToolNames.push(name)
          successfulToolCalls.push(call)
        }
        toolEvents.push({
          type: 'tool.completed',
          value: name,
          summary: toolResultSummary(event),
          result: toolResultPayload(event),
        })
      }
      if (event.type === 'turn/end') {
        const reason = data.reason
        finishReason = isRecord(reason) && typeof reason.kind === 'string' ? reason.kind : null
      }
    }
    return {
      finalResponse,
      toolNames,
      successfulToolNames,
      successfulToolCalls,
      toolEvents,
      inputTokens,
      outputTokens,
      finishReason,
    }
  }

  async close(): Promise<void> {
    if (!this.child || this.exited) return
    try {
      await this.request('shutdown', undefined, 1_000)
    } catch {
      // Shutdown is best-effort; the owned child is terminated below.
    }
    if (!this.exited) this.child.kill('SIGTERM')
  }

  private request(method: string, params: unknown, timeoutMs = this.launch.requestTimeoutMs): Promise<unknown> {
    if (!this.child || this.exited) return Promise.reject(new Error('Harness runtime is not running'))
    this.serial += 1
    const id = this.serial
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Harness JSON-RPC ${method} timed out`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timeout })
      this.child!.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    })
  }

  private receive(line: string): void {
    let frame: JsonRpcFrame
    try {
      frame = JSON.parse(line) as JsonRpcFrame
    } catch {
      return
    }
    if (typeof frame.id === 'number') {
      const pending = this.pending.get(frame.id)
      if (!pending) return
      this.pending.delete(frame.id)
      clearTimeout(pending.timeout)
      if (frame.error) pending.reject(new Error(`Harness JSON-RPC error: ${frame.error.message ?? frame.error.code ?? 'unknown'}`))
      else pending.resolve(frame.result)
      return
    }
    if (frame.method) this.notificationHandler?.(frame)
  }

  private failAll(error: Error): void {
    for (const request of this.pending.values()) {
      clearTimeout(request.timeout)
      request.reject(error)
    }
    this.pending.clear()
  }
}
