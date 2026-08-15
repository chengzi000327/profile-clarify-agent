import type { RoleState } from '@role-clarifier/contracts'
import { describe, expect, it } from 'vitest'
import { buildSidecarApp, type ExecutorLike } from './app.js'
import { loadSidecarConfig } from './config.js'
import { recoverResultFromTool } from './executor.js'
import { buildTaskPrompt } from './prompts.js'
import { parseHarnessResult, type HarnessRequest } from './schemas.js'

const state: RoleState = {
  id: '11111111-1111-4111-8111-111111111111',
  tenant_id: 'tenant-demo',
  title: '商业化产品负责人',
  department: '产品与商业化',
  stage: 'SUCCESS_CLARIFYING',
  revision: 1,
  hc_status: 'APPROVED',
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
  })

  it('repairs fenced model JSON into the typed result', () => {
    const result = parseHarnessResult(`\`\`\`json
      {"kind":"CLARIFICATION","persistence":"TOOL","answer":"已记录","question":"如何验收？","fact_draft":{"category":"SUCCESS_CRITERION","statement":"完成标准化"}}
    \`\`\``)
    expect(result.kind).toBe('CLARIFICATION')
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
