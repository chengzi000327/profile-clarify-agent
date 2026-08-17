import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../app.js'
import type { HarnessAdapter, HarnessTask } from '../agent/harness-adapter.js'
import { loadConfig } from '../config.js'
import { MemoryStore } from '../store/memory-store.js'
import { DEMO_ROLE_SESSION_ID } from '../store/seed.js'

const config = loadConfig({
  NODE_ENV: 'test',
  SESSION_SECRET: 'test-session-secret-that-is-long-enough',
})

const unusedHarness: HarnessAdapter = {
  async run() {
    throw new Error('Harness should not run in read_role_state projection tests')
  },
}

const candidate = (
  candidateRef: string,
  channel: string,
  signal: 'STRONG' | 'MIXED' | 'WEAK' | 'MISSING',
  bottlenecks: string[],
) => ({
  candidate_ref: candidateRef,
  channel,
  source_format: 'TEXT' as const,
  evidence: [{
    criterion: '业务判断',
    signal,
    excerpt: `不得返回给模型的原始摘录-${candidateRef}`,
  }],
  bottlenecks,
})

describe('read_role_state task projection', () => {
  let app: FastifyInstance
  let store: MemoryStore

  beforeEach(async () => {
    store = new MemoryStore()
    app = await buildApp(config, { store, harness: unusedHarness })
  })

  afterEach(async () => {
    await app.close()
  })

  const createActiveRun = async (task: HarnessTask, actorUserId: string): Promise<void> => {
    const timestamp = new Date().toISOString()
    await store.createRun({
      id: randomUUID(),
      role_session_id: DEMO_ROLE_SESSION_ID,
      actor_user_id: actorUserId,
      effective_actor_role: actorUserId === 'hr-demo' ? 'HR' : 'MANAGER',
      status: 'RUNNING',
      model_tier: task === 'CLARIFY_MESSAGE' || task === 'EXTRACT_CANDIDATES' ? 'FLASH' : 'PRO',
      task,
      harness_session_id: `role-${DEMO_ROLE_SESSION_ID}`,
      prompt_version: 'role-clarifier-v11-layered',
      model_name: 'test-model',
      tool_count: 0,
      input_tokens: 0,
      output_tokens: 0,
      started_at: timestamp,
      completed_at: null,
      error_code: null,
      input_message_id: null,
      output_message_id: null,
    })
  }

  const readRoleState = async (): Promise<Record<string, any>> => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/v1/harness/tools/read_role_state',
      headers: {
        authorization: `Bearer ${config.ROLE_AGENT_TOOL_TOKEN}`,
        'x-harness-session-id': `role-${DEMO_ROLE_SESSION_ID}`,
      },
      payload: {},
    })
    expect(response.statusCode, response.body).toBe(200)
    return response.json()
  }

  it('澄清任务只返回岗位、事实、冲突和无内容的产物引用', async () => {
    const getAggregate = vi.spyOn(store, 'getRoleAggregate')
    await createActiveRun('CLARIFY_MESSAGE', 'manager-demo')

    const result = await readRoleState()

    expect(result.projection).toBe('CLARIFICATION')
    expect(result.role).toMatchObject({
      id: DEMO_ROLE_SESSION_ID,
      title: '企业产品经理',
      department: '企业服务产品部',
      stage: 'JD_DRAFT',
      hc_status: 'APPROVED',
      hc_context: expect.objectContaining({
        request_id: 'HC-2026-EP-001',
        job_basics: expect.objectContaining({
          level: '3-2 至 4-1',
          reporting_line: '产品负责人',
        }),
      }),
    })
    expect(result.state_revision).toBe(4)
    expect(result.state).toBeUndefined()
    expect(result.artifacts).toBeUndefined()
    expect(result.candidates).toBeUndefined()
    expect(result.calibration_signals).toBeUndefined()
    expect(result.manager_tasks).toBeUndefined()
    expect(result.task_context.artifacts).toEqual([])
    expect(result.artifact_refs.map((item: { type: string }) => item.type)).not.toContain(
      'HR_RECRUITING_BRIEF',
    )
    expect(result.artifact_refs[0]).not.toHaveProperty('content')
    expect(result.facts[0]).not.toHaveProperty('id')
    expect(result.facts[0]).not.toHaveProperty('updated_at')
    expect(result.facts[0]).not.toHaveProperty('visible_to')
    expect(JSON.stringify(result)).not.toContain('连接商业目标、产品方案与跨团队交付')
    expect(getAggregate).toHaveBeenCalledWith(
      DEMO_ROLE_SESSION_ID,
      expect.objectContaining({ user_id: 'manager-demo', role: 'MANAGER' }),
      {
        members: false,
        artifacts: false,
        candidates: false,
        calibration_signals: false,
        manager_tasks: false,
      },
    )
  })

  it('生成 JD 只注入已确认的岗位画像和评分卡一次', async () => {
    await createActiveRun('GENERATE_JD', 'hr-demo')

    const result = await readRoleState()

    expect(result.projection).toBe('JD')
    expect(result.task_context.artifacts.map((item: { type: string }) => item.type)).toEqual([
      'ROLE_PROFILE',
      'ASSESSMENT_SCORECARD',
    ])
    expect(result.task_context.artifacts.every(
      (item: { status: string }) => item.status === 'CONFIRMED',
    )).toBe(true)
    expect(result.task_context.artifacts.map((item: { type: string }) => item.type)).not.toContain(
      'PUBLIC_JD',
    )
    expect(result.artifact_refs.every(
      (item: Record<string, unknown>) => !Object.hasOwn(item, 'content'),
    )).toBe(true)
    expect(result.facts.every((fact: { status: string }) => fact.status === 'CONFIRMED')).toBe(true)
  })

  it('校准任务只返回有上限的候选人聚合，不返回候选人引用和原始摘录', async () => {
    await store.insertCandidates(
      DEMO_ROLE_SESSION_ID,
      [
        candidate('CAND-001', '内推', 'STRONG', []),
        candidate('CAND-002', '猎头', 'WEAK', ['业务判断证据不足']),
        candidate('CAND-003', '猎头', 'MISSING', ['业务判断证据不足']),
      ],
      'hr-demo',
    )
    await createActiveRun('CALIBRATION_ADVICE', 'hr-demo')

    const result = await readRoleState()
    const serialized = JSON.stringify(result)

    expect(result.projection).toBe('CALIBRATION')
    expect(result.task_context.candidate_summary).toMatchObject({
      total_candidates: 3,
      channels: ['猎头', '内推'],
      criteria: [{
        criterion: '业务判断',
        evidence_count: 3,
        signals: { STRONG: 1, MIXED: 0, WEAK: 1, MISSING: 1 },
      }],
      top_bottlenecks: [{ label: '业务判断证据不足', count: 2 }],
    })
    expect(result.candidates).toBeUndefined()
    expect(serialized).not.toContain('CAND-001')
    expect(serialized).not.toContain('不得返回给模型的原始摘录')
  })
})
