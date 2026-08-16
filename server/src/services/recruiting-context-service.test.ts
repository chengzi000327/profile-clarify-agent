import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../app.js'
import type { HarnessAdapter, HarnessTask } from '../agent/harness-adapter.js'
import { loadConfig } from '../config.js'
import { MemoryStore } from '../store/memory-store.js'
import { DEMO_ROLE_SESSION_ID } from '../store/seed.js'
import type { RecruitingContextRecord } from '../store/types.js'
import { RecruitingContextService } from './recruiting-context-service.js'

const config = loadConfig({
  NODE_ENV: 'test',
  SESSION_SECRET: 'test-session-secret-that-is-long-enough',
})

const unusedHarness: HarnessAdapter = {
  async route() {
    throw new Error('Router should not run in recruiting context tool tests')
  },
  async run() {
    throw new Error('Harness should not run in recruiting context tool tests')
  },
}

const importId = 'test-context-v4'
const contextRecord = (
  recordType: RecruitingContextRecord['record_type'],
  externalId: string,
  content: Record<string, unknown>,
  metadata: Partial<RecruitingContextRecord> = {},
): RecruitingContextRecord => ({
  tenant_id: 'tenant-demo',
  record_type: recordType,
  external_id: externalId,
  team_id: null,
  role_title: null,
  conversation_id: null,
  source_system: 'TEST_SOURCE',
  data_classification: 'INTERNAL',
  effective_at: null,
  content,
  import_id: importId,
  ...metadata,
})

describe('read_recruiting_context tool', () => {
  let app: FastifyInstance
  let store: MemoryStore

  beforeEach(async () => {
    store = new MemoryStore()
    app = await buildApp(config, { store, harness: unusedHarness })
    await store.upsertRecruitingContextImport({
      id: importId,
      tenant_id: 'tenant-demo',
      source_revision: 'test-v4',
      source_file: 'test.xlsx',
      excluded_sheets: ['BOSS岗位参考'],
      record_counts: {},
      imported_at: new Date().toISOString(),
    }, [
      contextRecord('ORGANIZATION_UNIT', 'TEAM-01', {
        company: '星云智联科技（虚构）',
        business_unit: '产品事业部',
        department: '产品与商业化',
        team_name: '产品与商业化',
        org_path: '星云智联科技/产品事业部/产品与商业化',
        team_mission: '形成可复制商业化产品。',
        business_stage: '规模化验证期',
        key_products: '企业知识助手；智能工作台',
        '2026_h2_goal': '五个客户付费。',
        partner_teams: '算法团队；平台团队',
        approved_hc: 12,
        current_hc: 10,
        open_hc: 2,
        source_revision: 'test-v4',
        snapshot_at: '2026-08-16T01:00:00.000Z',
        data_status: 'PENDING_REVIEW',
      }, { team_id: 'TEAM-01', source_system: 'MOCK_HRIS' }),
      contextRecord('EMPLOYEE', 'EMP-01', {
        name: '不得返回的姓名',
        position: '企业AI产品经理',
        level: 'P7',
        age: 31,
        monthly_base_salary_cny: 50000,
        education: '硕士',
        performance_2025: 'A',
        review_360_summary: '不得返回的评价',
        current_responsibilities: '负责场景标准化和价值验证',
        skill_tags: '企业产品；AI应用；评测',
        development_focus: '补强成本判断',
      }, {
        team_id: 'TEAM-01',
        source_system: 'MOCK_HRIS',
        data_classification: 'HR_SENSITIVE',
      }),
      contextRecord('HISTORICAL_ROLE_SESSION', 'RS-01', {
        role_title: '商业化产品负责人',
        team_name: '产品与商业化',
        status: 'READY_FOR_REVIEW',
        core_conflict: '大厂背景与业务证据的取舍',
        final_level: 'P7',
        budget_range: '55万–75万元',
        conversation_1_id: 'RS-01-C1',
        c1_messages: 1,
        conversation_2_id: 'RS-01-C2',
        c2_messages: 0,
        conversation_3_id: 'RS-01-C3',
        c3_messages: 0,
      }, { team_id: 'TEAM-01', role_title: '商业化产品负责人' }),
      contextRecord('CLARIFICATION_MESSAGE', 'MSG-01', {
        session_no: 1,
        session_type: '需求启动会',
        turn_no: 1,
        sender_role: 'HR',
        sender_name: '不应返回的姓名',
        content: '请用最近发生的业务事件证明招聘原因。',
        created_at: '2026-07-03T01:04:00.000Z',
        clarification_topic: 'HIRING_REASON',
        decision_status: 'OPEN',
        decision_summary: null,
      }, {
        role_title: '商业化产品负责人',
        conversation_id: 'RS-01-C1',
        data_classification: 'ROLE_CONFIDENTIAL',
      }),
      contextRecord('RECRUITING_FUNNEL', 'FUN-01', {
        channel: '招聘平台',
        period_start: '2025-09-01T00:00:00.000Z',
        period_end: '2026-07-31T00:00:00.000Z',
        resumes_received: 100,
        valid_resumes: 70,
        screen_pass: 20,
        first_interview: 10,
        final_interview: 5,
        offers: 2,
        offers_accepted: 1,
        onboarded: 1,
        screen_pass_rate: 0.2857,
        interview_to_offer_rate: 0.2,
        offer_accept_rate: 0.5,
        overall_onboard_rate: 0.01,
        avg_time_to_fill_days: 48,
        top_rejection_reason: '证据不足',
        sample_scope: '模拟ATS样本',
      }, {
        team_id: 'TEAM-01',
        role_title: '商业化产品负责人',
        source_system: 'MOCK_ATS',
        data_classification: 'HR_ONLY',
      }),
      contextRecord('MARKET_JD_REFERENCE', 'ZL-001', {
        role_family: '产品',
        title: 'AI产品经理',
        company: '示例公司',
        salary: '面议',
        location: '北京',
        experience: '3-5年',
        education: '本科',
        company_size: '10000人以上',
        role_overview: '负责AI产品从定义到落地。',
        detailed_responsibilities: '1. 定义产品\n2. 推动验证',
        must_have: '1. AI产品经验\n2. 证据驱动',
        preferred: '有Agent经验优先',
        technology_and_domain: 'LLM；RAG；Agent',
        collaboration_and_scope: '与算法、工程协作',
        other_material_terms: '公开参考',
        source_url: 'https://www.zhaopin.com/jobdetail/example.htm',
        verification_status: 'DETAIL_PAGE_VERIFIED / DETAILED_SOURCE_GROUNDED',
      }, {
        role_title: 'AI产品经理',
        source_system: 'ZHAOPIN_PUBLIC_REFERENCE',
        data_classification: 'PUBLIC_REFERENCE',
      }),
    ])
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
      status: 'RUNNING',
      model_tier: 'FLASH',
      task,
      harness_session_id: `role-${DEMO_ROLE_SESSION_ID}`,
      prompt_version: 'role-clarifier-v2',
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

  const invoke = async (payload: Record<string, unknown>) => app.inject({
    method: 'POST',
    url: '/internal/v1/harness/tools/read_recruiting_context',
    headers: {
      authorization: `Bearer ${config.ROLE_AGENT_TOOL_TOKEN}`,
      'x-harness-session-id': `role-${DEMO_ROLE_SESSION_ID}`,
    },
    payload,
  })

  it('组织投影只返回能力摘要，不泄露员工敏感字段', async () => {
    await createActiveRun('CLARIFY_MESSAGE', 'manager-demo')
    const response = await invoke({ projection: 'ORGANIZATION', team_id: 'TEAM-01' })
    expect(response.statusCode, response.body).toBe(200)
    const result = response.json()
    expect(result.teams[0].role_inventory[0]).toMatchObject({
      position: '企业AI产品经理',
      level: 'P7',
      responsibilities: ['负责场景标准化和价值验证'],
    })
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('不得返回的姓名')
    expect(serialized).not.toContain('50000')
    expect(serialized).not.toContain('不得返回的评价')
    expect(serialized).not.toContain('补强成本判断')
    expect(result.teams[0].approved_hc).toBeUndefined()
  })

  it('历史澄清按当前岗位、主题和分页返回，且去除参与者身份', async () => {
    await createActiveRun('CLARIFY_MESSAGE', 'manager-demo')
    const response = await invoke({
      projection: 'CLARIFICATION_HISTORY',
      topic: 'HIRING_REASON',
      limit: 10,
    })
    expect(response.statusCode, response.body).toBe(200)
    const result = response.json()
    expect(result.messages).toHaveLength(1)
    expect(result.messages[0]).toMatchObject({
      sender_role: 'HR',
      clarification_topic: 'HIRING_REASON',
    })
    expect(JSON.stringify(result)).not.toContain('不应返回的姓名')
  })

  it('招聘漏斗只允许 HR/Admin，智联参考保留详细转述和来源链接', async () => {
    await createActiveRun('CLARIFY_MESSAGE', 'manager-demo')
    const denied = await invoke({ projection: 'RECRUITING_FUNNEL' })
    expect(denied.statusCode).toBe(403)
    expect(denied.json().error.code).toBe('RECRUITING_CONTEXT_HR_ONLY')

    const market = await invoke({
      projection: 'MARKET_JD_REFERENCE',
      role_title: 'AI产品经理',
      limit: 3,
    })
    expect(market.statusCode, market.body).toBe(200)
    expect(market.json().references[0]).toMatchObject({
      ref_id: 'ZL-001',
      detailed_responsibilities: '1. 定义产品\n2. 推动验证',
      source_url: 'https://www.zhaopin.com/jobdetail/example.htm',
    })
  })

  it('零工具生成任务仍被服务端工具白名单拒绝', async () => {
    await createActiveRun('GENERATE_JD', 'hr-demo')
    const response = await invoke({ projection: 'MARKET_JD_REFERENCE' })
    expect(response.statusCode).toBe(403)
    expect(response.json().error.code).toBe('HARNESS_TOOL_NOT_ALLOWED_FOR_TASK')
  })

  it('按任务生成带来源边界的最小上下文事实，且不会升级为岗位事实', async () => {
    const manager = await store.getUser('manager-demo')
    const hr = await store.getUser('hr-demo')
    expect(manager).not.toBeNull()
    expect(hr).not.toBeNull()
    const service = new RecruitingContextService(store)

    const clarification = await service.buildTaskContext(
      DEMO_ROLE_SESSION_ID,
      manager!,
      'CLARIFY_MESSAGE',
      '商业化产品负责人',
    )
    expect(clarification.projections).toEqual([
      'ORGANIZATION',
      'CLARIFICATION_HISTORY',
      'MARKET_JD_REFERENCE',
    ])
    expect(clarification.facts.map((fact) => fact.category)).toEqual(expect.arrayContaining([
      'TEAM_MISSION',
      'TEAM_CAPABILITY',
      'HISTORICAL_CONFLICT',
      'MARKET_REFERENCE',
    ]))
    expect(clarification.facts.every((fact) =>
      fact.confirmation_status === 'UNCONFIRMED_CONTEXT'
      && fact.source.provider === 'RECRUITING_CONTEXT_STORE')).toBe(true)
    expect(clarification.usage_policy.may_become_role_fact_without_human_confirmation).toBe(false)
    expect(JSON.stringify(clarification)).not.toContain('不得返回的姓名')
    expect(JSON.stringify(clarification)).not.toContain('50000')

    const hrBrief = await service.buildTaskContext(
      DEMO_ROLE_SESSION_ID,
      hr!,
      'GENERATE_HR_BRIEF',
    )
    expect(hrBrief.projections).toContain('RECRUITING_FUNNEL')
    expect(hrBrief.facts).toContainEqual(expect.objectContaining({
      category: 'FUNNEL_SIGNAL',
      data_classification: 'HR_INTERNAL_AGGREGATE',
      authority: 'REFERENCE',
    }))
  })
})
