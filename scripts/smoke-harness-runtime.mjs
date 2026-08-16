import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { JsonRpcHarnessRuntime } from '../harness-sidecar/dist/protocol-client.js'
import {
  ASSESSMENT_GENERATION_PROMPT,
  HR_RECRUITING_BRIEF_GENERATION_PROMPT,
  PUBLIC_JD_GENERATION_PROMPT,
  ROLE_CLARIFIER_SYSTEM_PROMPT,
  ROLE_PROFILE_GENERATION_PROMPT,
  ROLE_ROUTER_SYSTEM_PROMPT,
} from '../packages/agent-spec/dist/index.js'

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
    ROLE_AGENT_ALLOWED_TOOLS: JSON.stringify([
      'read_role_state',
      'read_recruiting_context',
      'update_role_identity_draft',
      'save_fact_draft',
    ]),
    ROLE_AGENT_MODE: 'domain',
    DSH_SESSION_ROOT: sessionRoot,
  },
  provider: 'deepseek-official',
  model: 'deepseek-v4-flash',
  maxTokens: 128,
  requestTimeoutMs: 15_000,
})
const routerRuntime = new JsonRpcHarnessRuntime({
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
    ROLE_AGENT_ALLOWED_TOOLS: '[]',
    ROLE_AGENT_MODE: 'router',
    DSH_SESSION_ROOT: sessionRoot,
  },
  provider: 'deepseek-official',
  model: 'deepseek-v4-flash',
  maxTokens: 128,
  requestTimeoutMs: 15_000,
})
const roleProfileRuntime = new JsonRpcHarnessRuntime({
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
    ROLE_AGENT_ALLOWED_TOOLS: '[]',
    ROLE_AGENT_MODE: 'domain',
    DSH_SESSION_ROOT: sessionRoot,
  },
  provider: 'deepseek-official',
  model: 'deepseek-v4-pro',
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
    'read_recruiting_context',
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
  const routerTurn = await routerRuntime.runTurn(
    'router-smoke',
    'Return a normal greeting response without tools.',
    AbortSignal.timeout(15_000),
    0,
  )
  if (routerTurn.toolNames.length !== 0 || routerTurn.finishReason !== 'completed') {
    throw new Error(`Unexpected router turn result: ${JSON.stringify(routerTurn)}`)
  }
  const routerRequest = requests.at(-1)
  const routerToolNames = Array.isArray(routerRequest?.tools)
    ? routerRequest.tools.map(tool => tool?.function?.name).filter(Boolean)
    : []
  if (routerToolNames.length !== 0) {
    throw new Error(`Router must receive zero tools, got: ${JSON.stringify(routerToolNames)}`)
  }
  const routerSystemPrompt = Array.isArray(routerRequest?.messages)
    ? routerRequest.messages
        .filter(message => message?.role === 'system')
        .map(message => message?.content)
        .filter(content => typeof content === 'string')
        .join('\n')
    : ''
  if (
    !routerSystemPrompt.includes(ROLE_ROUTER_SYSTEM_PROMPT)
    || routerSystemPrompt.includes(ROLE_CLARIFIER_SYSTEM_PROMPT)
  ) {
    throw new Error('Router runtime did not receive the isolated Router System Prompt')
  }
  const roleProfileTurn = await roleProfileRuntime.runTurn(
    'role-profile-smoke',
    ROLE_PROFILE_GENERATION_PROMPT,
    AbortSignal.timeout(15_000),
    0,
  )
  if (roleProfileTurn.toolNames.length !== 0 || roleProfileTurn.finishReason !== 'completed') {
    throw new Error(`Unexpected role-profile turn result: ${JSON.stringify(roleProfileTurn)}`)
  }
  const roleProfileRequest = requests.at(-1)
  const roleProfileToolNames = Array.isArray(roleProfileRequest?.tools)
    ? roleProfileRequest.tools.map(tool => tool?.function?.name).filter(Boolean)
    : []
  if (roleProfileToolNames.length !== 0) {
    throw new Error(
      `Role-profile generation must receive zero tools, got: ${JSON.stringify(roleProfileToolNames)}`,
    )
  }
  const roleProfileMessages = Array.isArray(roleProfileRequest?.messages)
    ? roleProfileRequest.messages
    : []
  const roleProfileSystemPrompt = roleProfileMessages
    .filter(message => message?.role === 'system')
    .map(message => message?.content)
    .filter(content => typeof content === 'string')
    .join('\n')
  const roleProfileUserPrompt = roleProfileMessages
    .filter(message => message?.role === 'user')
    .map(message => message?.content)
    .filter(content => typeof content === 'string')
    .join('\n')
  if (
    !roleProfileSystemPrompt.includes(ROLE_CLARIFIER_SYSTEM_PROMPT)
    || !roleProfileUserPrompt.includes(ROLE_PROFILE_GENERATION_PROMPT)
  ) {
    throw new Error('Role-profile runtime did not receive P-01 and P-03 in their intended layers')
  }
  const assessmentTurn = await roleProfileRuntime.runTurn(
    'assessment-smoke',
    ASSESSMENT_GENERATION_PROMPT,
    AbortSignal.timeout(15_000),
    0,
  )
  if (assessmentTurn.toolNames.length !== 0 || assessmentTurn.finishReason !== 'completed') {
    throw new Error(`Unexpected assessment turn result: ${JSON.stringify(assessmentTurn)}`)
  }
  const assessmentRequest = requests.at(-1)
  const assessmentToolNames = Array.isArray(assessmentRequest?.tools)
    ? assessmentRequest.tools.map(tool => tool?.function?.name).filter(Boolean)
    : []
  if (assessmentToolNames.length !== 0) {
    throw new Error(
      `Assessment generation must receive zero tools, got: ${JSON.stringify(assessmentToolNames)}`,
    )
  }
  const assessmentMessages = Array.isArray(assessmentRequest?.messages)
    ? assessmentRequest.messages
    : []
  const assessmentSystemPrompt = assessmentMessages
    .filter(message => message?.role === 'system')
    .map(message => message?.content)
    .filter(content => typeof content === 'string')
    .join('\n')
  const assessmentUserPrompt = assessmentMessages
    .filter(message => message?.role === 'user')
    .map(message => message?.content)
    .filter(content => typeof content === 'string')
    .join('\n')
  if (
    !assessmentSystemPrompt.includes(ROLE_CLARIFIER_SYSTEM_PROMPT)
    || !assessmentUserPrompt.includes(ASSESSMENT_GENERATION_PROMPT)
  ) {
    throw new Error('Assessment runtime did not receive P-01 and P-04 in their intended layers')
  }
  const publicJDTurn = await roleProfileRuntime.runTurn(
    'public-jd-smoke',
    PUBLIC_JD_GENERATION_PROMPT,
    AbortSignal.timeout(15_000),
    0,
  )
  if (publicJDTurn.toolNames.length !== 0 || publicJDTurn.finishReason !== 'completed') {
    throw new Error(`Unexpected public-JD turn result: ${JSON.stringify(publicJDTurn)}`)
  }
  const publicJDRequest = requests.at(-1)
  const publicJDToolNames = Array.isArray(publicJDRequest?.tools)
    ? publicJDRequest.tools.map(tool => tool?.function?.name).filter(Boolean)
    : []
  if (publicJDToolNames.length !== 0) {
    throw new Error(
      `Public-JD generation must receive zero tools, got: ${JSON.stringify(publicJDToolNames)}`,
    )
  }
  const publicJDMessages = Array.isArray(publicJDRequest?.messages)
    ? publicJDRequest.messages
    : []
  const publicJDSystemPrompt = publicJDMessages
    .filter(message => message?.role === 'system')
    .map(message => message?.content)
    .filter(content => typeof content === 'string')
    .join('\n')
  const publicJDUserPrompt = publicJDMessages
    .filter(message => message?.role === 'user')
    .map(message => message?.content)
    .filter(content => typeof content === 'string')
    .join('\n')
  if (
    !publicJDSystemPrompt.includes(ROLE_CLARIFIER_SYSTEM_PROMPT)
    || !publicJDUserPrompt.includes(PUBLIC_JD_GENERATION_PROMPT)
  ) {
    throw new Error('Public-JD runtime did not receive P-01 and P-05 in their intended layers')
  }
  const hrBriefTurn = await roleProfileRuntime.runTurn(
    'hr-brief-smoke',
    HR_RECRUITING_BRIEF_GENERATION_PROMPT,
    AbortSignal.timeout(15_000),
    0,
  )
  if (hrBriefTurn.toolNames.length !== 0 || hrBriefTurn.finishReason !== 'completed') {
    throw new Error(`Unexpected HR-brief turn result: ${JSON.stringify(hrBriefTurn)}`)
  }
  const hrBriefRequest = requests.at(-1)
  const hrBriefToolNames = Array.isArray(hrBriefRequest?.tools)
    ? hrBriefRequest.tools.map(tool => tool?.function?.name).filter(Boolean)
    : []
  if (hrBriefToolNames.length !== 0) {
    throw new Error(
      `HR-brief generation must receive zero tools, got: ${JSON.stringify(hrBriefToolNames)}`,
    )
  }
  const hrBriefMessages = Array.isArray(hrBriefRequest?.messages)
    ? hrBriefRequest.messages
    : []
  const hrBriefSystemPrompt = hrBriefMessages
    .filter(message => message?.role === 'system')
    .map(message => message?.content)
    .filter(content => typeof content === 'string')
    .join('\n')
  const hrBriefUserPrompt = hrBriefMessages
    .filter(message => message?.role === 'user')
    .map(message => message?.content)
    .filter(content => typeof content === 'string')
    .join('\n')
  if (
    !hrBriefSystemPrompt.includes(ROLE_CLARIFIER_SYSTEM_PROMPT)
    || !hrBriefUserPrompt.includes(HR_RECRUITING_BRIEF_GENERATION_PROMPT)
  ) {
    throw new Error('HR-brief runtime did not receive P-01 and P-06 in their intended layers')
  }
  console.info(
    'DeepSeek Harness JSON-RPC turn passed against local model stub; model-visible tools: '
      + toolNames.join(', ')
      + '; router-visible tools: none; role-profile-visible tools: none; assessment-visible tools: none; public-JD-visible tools: none; HR-brief-visible tools: none',
  )
} finally {
  await runtime.close()
  await routerRuntime.close()
  await roleProfileRuntime.close()
  await new Promise(resolve => modelServer.close(resolve))
  await new Promise(resolve => businessServer.close(resolve))
  await rm(sessionRoot, { recursive: true, force: true })
}
