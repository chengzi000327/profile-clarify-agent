import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { JsonRpcHarnessRuntime } from '../harness-sidecar/dist/protocol-client.js'
import { ROLE_CLARIFIER_SYSTEM_PROMPT } from '../packages/agent-spec/dist/index.js'

const root = resolve(import.meta.dirname, '..')
const sessionRoot = await mkdtemp(resolve(tmpdir(), 'role-clarifier-runtime-smoke-'))
const requests = []
const toolRequests = []
const writeSse = (response, payload) => {
  response.write(`data: ${JSON.stringify(payload)}\n\n`)
}
const modelServer = createServer((request, response) => {
  let body = ''
  request.setEncoding('utf8')
  request.on('data', chunk => { body += chunk })
  request.on('end', () => {
    requests.push(JSON.parse(body))
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    writeSse(response, {
      choices: [{ delta: { role: 'assistant', content: null, reasoning_content: '' } }],
    })
    const turn = requests.length
    if (turn <= 2) {
      const name = turn === 1 ? 'read_role_state' : 'save_fact_draft'
      const args = turn === 1
        ? '{}'
        : JSON.stringify({ category: 'HIRING_REASON', statement: '本地 smoke 事实' })
      writeSse(response, {
        choices: [{
          delta: {
            tool_calls: [{
              index: 0,
              id: `smoke-call-${turn}`,
              type: 'function',
              function: { name, arguments: args },
            }],
          },
        }],
      })
      writeSse(response, {
        choices: [{ delta: {}, finish_reason: 'tool_calls' }],
        usage: { prompt_tokens: 3, completion_tokens: 1 },
      })
    } else {
      writeSse(response, { choices: [{ delta: { content: 'runtime-smoke-ok' } }] })
      writeSse(response, {
        choices: [{ delta: { content: '' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 3, completion_tokens: 1 },
      })
    }
    response.end('data: [DONE]\n\n')
  })
})
await new Promise(resolve => modelServer.listen(0, '127.0.0.1', resolve))
const address = modelServer.address()
if (address === null || typeof address === 'string') throw new Error('Stub model server has no port')
const businessServer = createServer((request, response) => {
  let body = ''
  request.setEncoding('utf8')
  request.on('data', chunk => { body += chunk })
  request.on('end', () => {
    toolRequests.push({
      url: request.url,
      authorization: request.headers.authorization,
      sessionId: request.headers['x-harness-session-id'],
      body: JSON.parse(body),
    })
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ ok: true }))
  })
})
await new Promise(resolve => businessServer.listen(0, '127.0.0.1', resolve))
const businessAddress = businessServer.address()
if (businessAddress === null || typeof businessAddress === 'string') {
  throw new Error('Mock business server has no port')
}
const runtime = new JsonRpcHarnessRuntime({
  runtimeBin: resolve(
    root,
    '.harness/deepseek-harness/packages/examples/jsonrpc-demo/lib/bin.js',
  ),
  cordisConfig: resolve(
    root,
    '.harness/deepseek-harness/packages/external/role-clarifier/cordis.yml',
  ),
  cwd: root,
  env: {
    ...process.env,
    DEEPSEEK_API_KEY: 'runtime-local-smoke-key',
    DEEPSEEK_BASE_URL: `http://127.0.0.1:${address.port}`,
    ROLE_AGENT_INTERNAL_URL: `http://127.0.0.1:${businessAddress.port}`,
    ROLE_AGENT_TOOL_TOKEN: 'runtime-smoke-internal-tool-token',
    DSH_SESSION_ROOT: sessionRoot,
  },
  provider: 'deepseek-official',
  model: 'deepseek-v4-flash',
  maxTokens: 128,
  requestTimeoutMs: 15_000,
})

try {
  await runtime.start()
  const turn = await runtime.runTurn(
    'runtime-smoke',
    'Call read_role_state, then save one hiring-reason fact draft.',
    AbortSignal.timeout(15_000),
    2,
  )
  if (turn.finalResponse !== 'runtime-smoke-ok' || turn.finishReason !== 'completed') {
    throw new Error(`Unexpected Harness turn result: ${JSON.stringify(turn)}`)
  }
  if (JSON.stringify(turn.successfulToolNames) !== JSON.stringify([
    'read_role_state',
    'save_fact_draft',
  ])) {
    throw new Error(`Unexpected successful tools: ${JSON.stringify(turn.successfulToolNames)}`)
  }
  const modelRequest = requests[0]
  const systemPrompt = Array.isArray(modelRequest?.messages)
    ? modelRequest.messages
        .filter(message => message?.role === 'system')
        .map(message => message?.content)
        .filter(content => typeof content === 'string')
        .join('\n')
    : ''
  const sharedPromptOccurrences = systemPrompt.split(ROLE_CLARIFIER_SYSTEM_PROMPT).length - 1
  if (sharedPromptOccurrences !== 1) {
    throw new Error(`Expected shared system prompt exactly once, got ${sharedPromptOccurrences}`)
  }
  const toolNames = Array.isArray(modelRequest?.tools)
    ? modelRequest.tools.map(tool => tool?.function?.name).filter(Boolean)
    : []
  const expected = [
    'read_role_state',
    'update_role_identity_draft',
    'save_fact_draft',
    'save_artifact_draft',
    'save_candidate_evidence',
    'propose_calibration_signal',
    'read_version_diff',
  ]
  if (JSON.stringify(toolNames) !== JSON.stringify(expected)) {
    throw new Error(`Unexpected model-visible tools: ${JSON.stringify(toolNames)}`)
  }
  if (
    toolRequests.length !== 2
    || toolRequests.some(request => request.authorization !== 'Bearer runtime-smoke-internal-tool-token')
    || toolRequests.some(request => request.sessionId !== 'runtime-smoke')
  ) {
    throw new Error(`Unexpected business tool requests: ${JSON.stringify(toolRequests)}`)
  }
  console.info(
    'DeepSeek Harness JSON-RPC turn passed against local model stub; model-visible tools: '
      + toolNames.join(', '),
  )
} finally {
  await runtime.close()
  await new Promise(resolve => modelServer.close(resolve))
  await new Promise(resolve => businessServer.close(resolve))
  await rm(sessionRoot, { recursive: true, force: true })
}
