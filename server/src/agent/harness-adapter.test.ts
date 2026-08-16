import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadConfig } from '../config.js'
import {
  SidecarHarnessAdapter,
  type HarnessHooks,
  type HarnessRequest,
} from './harness-adapter.js'

const config = loadConfig({
  NODE_ENV: 'test',
  SESSION_SECRET: 'test-session-secret-that-is-long-enough',
  HARNESS_BASE_URL: 'http://harness-sidecar.internal',
})

const request = (maximumTransitions: 0 | 10): HarnessRequest => ({
  task: maximumTransitions === 0 ? 'GENERATE_ROLE_PROFILE' : 'CLARIFY_MESSAGE',
  role_state: {} as HarnessRequest['role_state'],
  execution_context: {} as HarnessRequest['execution_context'],
  maximum_transitions: maximumTransitions,
  structured_output_repair_attempts: 1,
})

const hooks = (statuses: string[]): HarnessHooks => ({
  signal: new AbortController().signal,
  onStatus: async (status) => { statuses.push(status) },
  onContextSnapshot: async () => undefined,
  onModelRequest: async () => undefined,
  onModelResponse: async () => undefined,
  onDelta: async () => undefined,
  onToolStarted: async () => undefined,
  onToolCompleted: async () => undefined,
  onTrace: async () => undefined,
})

const successfulResponse = (): Response => new Response(JSON.stringify({
  result: {
    kind: 'ARTIFACT',
    persistence: 'CALLER',
    artifact_type: 'ROLE_PROFILE',
    content: { title: '企业产品经理' },
    summary: '岗位画像已生成',
  },
  events: [],
  trace: {
    model: 'test-model',
    provider: 'test-provider',
    tool_count: 0,
    input_tokens: 1,
    output_tokens: 1,
    duration_ms: 1,
    repaired: false,
  },
}), {
  status: 200,
  headers: { 'content-type': 'application/json' },
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('SidecarHarnessAdapter deployment recovery', () => {
  it('无副作用任务遇到短暂 fetch failed 时等待健康检查后自动重试', async () => {
    let runAttempts = 0
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/healthz')) return new Response('{"status":"ok"}', { status: 200 })
      runAttempts += 1
      if (runAttempts === 1) throw new TypeError('fetch failed')
      return successfulResponse()
    })
    vi.stubGlobal('fetch', fetchMock)
    const statuses: string[] = []
    const adapter = new SidecarHarnessAdapter(config, { retryDelayMs: 0 })

    const result = await adapter.run(request(0), hooks(statuses))

    expect(result.kind).toBe('ARTIFACT')
    expect(runAttempts).toBe(2)
    expect(statuses).toContain('Harness Sidecar 暂时不可用，等待恢复后重试（1/2）')
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith('/healthz'))).toBe(true)
  })

  it('可能执行工具的任务遇到网络失败时不做整轮重放', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('fetch failed')
    })
    vi.stubGlobal('fetch', fetchMock)
    const adapter = new SidecarHarnessAdapter(config, { retryDelayMs: 0 })

    await expect(adapter.run(request(10), hooks([]))).rejects.toThrow('fetch failed')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('参数错误等非瞬时响应不会重试', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      error: { code: 'VALIDATION_ERROR', message: 'Harness request is invalid' },
    }), { status: 400 }))
    vi.stubGlobal('fetch', fetchMock)
    const adapter = new SidecarHarnessAdapter(config, { retryDelayMs: 0 })

    await expect(adapter.run(request(0), hooks([])))
      .rejects.toThrow('Harness Sidecar returned 400: Harness request is invalid')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
