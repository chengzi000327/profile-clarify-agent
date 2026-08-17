import type { RoleState } from '@role-clarifier/contracts'
import { describe, expect, it } from 'vitest'
import { buildSidecarApp, type ExecutorLike } from './app.js'
import { loadSidecarConfig } from './config.js'
import {
  HarnessExecutor,
  maxTokensForTask,
  recoverResultFromTool,
  timeoutMsForTask,
} from './executor.js'
import { buildContextSnapshot, buildTaskPrompt } from './prompts.js'
import { parseHarnessResult, type HarnessRequest } from './schemas.js'

const state: RoleState = {
  id: '11111111-1111-4111-8111-111111111111',
  tenant_id: 'tenant-demo',
  title: '商业化产品负责人',
  department: '产品与商业化',
  stage: 'SUCCESS_CLARIFYING',
  revision: 1,
  hc_status: 'APPROVED',
  hc_context: null,
  facts: [],
  conflicts: [],
  latest_artifacts: {},
  candidate_count: 0,
  candidate_channels: [],
  calibration_status: 'OBSERVING',
  created_at: '2026-08-15T00:00:00.000Z',
  updated_at: '2026-08-15T00:00:00.000Z',
}

const request: HarnessRequest = {
  task: 'CLARIFY_MESSAGE',
  role_state: state,
  message: '半年内完成三个客户场景的标准化。',
  conversation_context: {
    current_user_role: 'MANAGER',
    open_clarification: { ordinal: 1, question: '半年后的验收结果是什么？' },
    recent_messages: [
      { sender_type: 'AGENT', sender_role: null, content: '请说明半年后的验收结果。' },
    ],
  },
  execution_context: {
    tenant_id: 'tenant-demo',
    actor_user_id: 'manager-demo',
    actor_role: 'MANAGER',
    role_session_id: state.id,
    agent_run_id: 'run-demo',
    trace_id: 'trace-demo',
  },
  maximum_transitions: 10,
  structured_output_repair_attempts: 1,
}

const config = loadSidecarConfig({
  NODE_ENV: 'test',
  HARNESS_SIDECAR_TOKEN: 'test-sidecar-token-at-least-24-chars',
})

describe('Harness sidecar', () => {
  it('does not expose actor identity fields to the model prompt', () => {
    const prompt = buildTaskPrompt(request)
    expect(prompt).not.toContain('actor_user_id')
    expect(prompt).not.toContain('manager-demo')
    expect(prompt).not.toContain('tenant-demo')
    expect(prompt).not.toContain('tenant_id')
    expect(prompt).toContain('半年内完成三个客户场景的标准化。')
    expect(prompt).toContain('半年后的验收结果是什么？')
    expect(prompt).toContain('CONVERSATION')
  })

  it('separates system prompt, current input, short-term memory, long-term memory and task state', () => {
    const context = buildContextSnapshot(request)
    expect(context.system_prompt.content).toContain('岗位画像澄清 Agent')
    expect(context.current_user_input.content).toEqual({
      message: '半年内完成三个客户场景的标准化。',
    })
    expect(context.short_term_memory.messages).toHaveLength(1)
    expect(context.long_term_memory.role_state).toMatchObject({
      role: { title: '商业化产品负责人' },
      state_revision: 1,
    })
    expect(context.task_state).toMatchObject({
      task: 'CLARIFY_MESSAGE',
      current_user_role: 'MANAGER',
    })
  })

  it('loads only the core and current task prompt', () => {
    const clarification = buildContextSnapshot(request)
    expect(clarification.system_prompt.content).toContain('<P-01')
    expect(clarification.system_prompt.content).not.toContain('<P-02')
    expect(clarification.task_state.orchestration_instructions).toContain('<P-02')
    expect(clarification.task_state.orchestration_instructions).not.toContain('<P-03')

    const jd = buildContextSnapshot({
      ...request,
      task: 'GENERATE_JD',
      message: undefined,
      conversation_context: undefined,
    })
    expect(jd.system_prompt.content).toContain('<P-01')
    expect(jd.task_state.orchestration_instructions).toContain('<P-05')
    expect(jd.task_state.orchestration_instructions).not.toContain('<P-07')
  })

  it('repairs fenced model JSON into the typed result', () => {
    const result = parseHarnessResult(`\`\`\`json
      {"kind":"CLARIFICATION","persistence":"TOOL","answer":"已记录","question":"如何验收？","fact_draft":{"category":"SUCCESS_CRITERION","statement":"完成标准化"}}
    \`\`\``)
    expect(result.kind).toBe('CLARIFICATION')
  })

  it.each(['BACKGROUND', 'CONSTRAINT'] as const)(
    'accepts %s clarification facts supported by save_fact_draft',
    (category) => {
      const result = parseHarnessResult(JSON.stringify({
        kind: 'CLARIFICATION',
        persistence: 'TOOL',
        answer: '已记录',
        question: '接下来最需要澄清什么？',
        fact_draft: { category, statement: '这是一条待确认的岗位事实。' },
      }))
      expect(result).toMatchObject({
        kind: 'CLARIFICATION',
        fact_draft: { category },
      })
    },
  )

  it('accepts a direct conversation result without a write tool', () => {
    const result = parseHarnessResult(
      '{"kind":"CONVERSATION","persistence":"NONE","answer":"我在，可以帮你澄清岗位。"}',
    )
    expect(result).toMatchObject({ kind: 'CONVERSATION', persistence: 'NONE' })
  })

  it('sends greetings and capability questions through the model prompt', () => {
    const prompt = buildTaskPrompt({ ...request, message: '你好，你可以做什么？' })
    expect(prompt).toContain('你好，你可以做什么？')
    expect(prompt).toContain('<P-02')
    expect(prompt).not.toContain('<P-03')
    expect(prompt).toContain('CONVERSATION 不调用工具')
    expect(prompt).toContain('"kind":"CONVERSATION"')
  })

  it('puts an explicit user reply constraint ahead of contextual capability guidance', () => {
    const prompt = buildTaskPrompt({
      ...request,
      message: '请只回复：我可以协助澄清岗位。',
    })

    expect(prompt).toContain('请只回复：我可以协助澄清岗位。')
    expect(prompt).toContain('必须严格遵守该输出约束')
    expect(prompt).toContain('不得补充岗位名称、当前状态、历史事实、下一步建议或寒暄')
    expect(prompt).toContain('指定了输出格式时，以用户的格式要求为准')
  })

  it('keeps artifact content out of the initial model prompt and only exposes references', () => {
    const prompt = buildTaskPrompt({
      ...request,
      role_state: {
        ...state,
        latest_artifacts: {
          ROLE_PROFILE: {
            id: 'artifact-profile-v1',
            version: 1,
            status: 'CONFIRMED',
            content_hash: '1234567890abcdef',
            content: { secret_marker: 'FULL_ARTIFACT_CONTENT_MUST_NOT_BE_IN_PROMPT' },
          },
        },
      },
    })

    expect(prompt).toContain('artifact-profile-v1')
    expect(prompt).toContain('1234567890abcdef')
    expect(prompt).not.toContain('FULL_ARTIFACT_CONTENT_MUST_NOT_BE_IN_PROMPT')
  })

  it('caps Flash token budgets without shrinking Pro artifact generation', () => {
    expect(maxTokensForTask('CLARIFY_MESSAGE', 16_384)).toBe(4_096)
    expect(maxTokensForTask('EXTRACT_CANDIDATES', 16_384)).toBe(8_192)
    expect(maxTokensForTask('GENERATE_JD', 16_384)).toBe(16_384)
  })

  it('extends only role profile generation beyond the default run timeout', () => {
    expect(timeoutMsForTask('GENERATE_ROLE_PROFILE', 90_000, 240_000)).toBe(240_000)
    expect(timeoutMsForTask('CLARIFY_MESSAGE', 90_000, 240_000)).toBe(90_000)
    expect(timeoutMsForTask('GENERATE_JD', 90_000, 240_000)).toBe(90_000)
  })

  it('does not fabricate a canned conversation when model output is invalid', () => {
    expect(() => recoverResultFromTool({ ...request, message: '你能做什么？' }, []))
      .toThrow('Cannot recover a model-generated conversation')
  })

  it('recovers a relevant clarification answer from exact saved tool arguments', () => {
    const result = recoverResultFromTool(request, [
      {
        name: 'update_role_identity_draft',
        arguments: { title: '企业产品经理', department: '企业服务产品部' },
      },
      {
        name: 'save_fact_draft',
        arguments: {
          category: 'SUCCESS_CRITERION',
          statement: '半年内完成三个客户场景的标准化',
        },
      },
    ])
    expect(result.kind).toBe('CLARIFICATION')
    if (result.kind !== 'CLARIFICATION') throw new Error('Expected clarification')
    expect(result.answer).toContain('半年内完成三个客户场景的标准化')
    expect(result.question).not.toContain('这条事实是否准确')
    expect(result.role_identity).toEqual({
      title: '企业产品经理',
      department: '企业服务产品部',
    })
  })

  it('normalizes a missing display-only summary after tools already persisted the artifact', () => {
    const result = parseHarnessResult(JSON.stringify({
      kind: 'ARTIFACT',
      persistence: 'TOOL',
      artifact_type: 'PUBLIC_JD',
      content: {},
    }))
    expect(result.kind).toBe('ARTIFACT')
    if (result.kind !== 'ARTIFACT') throw new Error('Expected artifact result')
    expect(result.summary).toContain('草稿已保存')
  })

  it('recovers the result envelope from a successful authoritative write tool', () => {
    const result = recoverResultFromTool(
      { ...request, task: 'GENERATE_JD', message: undefined },
      [{
        name: 'save_artifact_draft',
        arguments: {
          artifact_type: 'PUBLIC_JD',
          content: {
            title_and_basics: {},
            about_the_role: '岗位说明',
            what_you_will_do: [],
            what_we_look_for: [],
          },
        },
      }],
    )
    expect(result.kind).toBe('ARTIFACT')
  })

  it('protects the run endpoint and returns executor output', async () => {
    const executor: ExecutorLike = {
      readiness: () => ({ runtime: true, credential: true }),
      execute: async () => ({
        result: {
          kind: 'CLARIFICATION',
          persistence: 'TOOL',
          answer: '已记录',
          question: '如何验收？',
          fact_draft: { category: 'SUCCESS_CRITERION', statement: '完成标准化' },
        },
        events: [],
        trace: {
          model: 'deepseek-v4-flash',
          provider: 'deepseek-official',
          harness_source_version: '0.1.0-rc.5',
          harness_commit: '47f943859bef60e4160492346772ded9b24f765a',
          tool_count: 2,
          input_tokens: 10,
          output_tokens: 5,
          duration_ms: 10,
          repaired: false,
          recovered_from_tool: false,
        },
      }),
    }
    const app = buildSidecarApp(config, executor)
    const denied = await app.inject({ method: 'POST', url: '/v1/role-clarifier/runs', payload: request })
    expect(denied.statusCode).toBe(401)
    const accepted = await app.inject({
      method: 'POST',
      url: '/v1/role-clarifier/runs',
      headers: { authorization: `Bearer ${config.HARNESS_SIDECAR_TOKEN}` },
      payload: request,
    })
    expect(accepted.statusCode).toBe(200)
    expect(accepted.json().result.persistence).toBe('TOOL')
    await app.close()
  })
})
