import { describe, expect, it } from 'vitest'
import type { ActorContext, EnterpriseKnowledgeItem } from '@role-clarifier/contracts'
import { MemoryStore } from '../store/memory-store.js'
import { demoEnterpriseKnowledge } from '../store/enterprise-knowledge-seed.js'
import { createDemoAggregate } from '../store/seed.js'
import { EnterpriseContextRetriever } from './enterprise-context-retriever.js'

const managerActor: ActorContext = {
  tenant_id: 'tenant-demo',
  user_id: 'manager-demo',
  role: 'MANAGER',
  display_name: '用人经理',
}

const extraItem = (
  id: string,
  overrides: Partial<EnterpriseKnowledgeItem>,
): EnterpriseKnowledgeItem => ({
  ...demoEnterpriseKnowledge[0]!,
  id,
  source_ref: `mock://test/${id}`,
  visible_to: 'ALL_ROLE_MEMBERS',
  ...overrides,
})

const createRetriever = async () => {
  const store = new MemoryStore([
    ...demoEnterpriseKnowledge,
    extraItem('EK-HR-POLICY-PRIVATE', {
      category: 'RECRUITING_POLICY',
      visible_to: 'HR_ONLY',
      title: '招聘伙伴内部规则',
      summary: '仅供招聘伙伴查看。',
      content: '仅供招聘伙伴查看的内部协作规则。',
    }),
    extraItem('EK-ADMIN-PRIVATE', {
      category: 'ORGANIZATION',
      visible_to: 'ADMIN_ONLY',
      title: '管理员内部规则',
      summary: '仅供管理员查看。',
      content: '仅供管理员查看的组织治理规则。',
    }),
    extraItem('EK-OTHER-TENANT', { tenant_id: 'tenant-other' }),
    extraItem('EK-EXPIRED', { valid_to: '2026-08-17T00:00:00.000Z' }),
  ])
  await store.initialize()
  return new EnterpriseContextRetriever(store)
}

describe('企业上下文检索', () => {
  it('经理先经过租户和角色过滤，再按任务与岗位排序', async () => {
    const retriever = await createRetriever()
    const result = await retriever.retrieve({
      actor: managerActor,
      effective_role: 'MANAGER',
      task: 'GENERATE_ROLE_PROFILE',
      role: createDemoAggregate().state,
      message: null,
    })

    expect(result.hits[0]).toMatchObject({
      knowledge_id: 'EK-ROLE-PM-001',
      match_reasons: expect.arrayContaining(['任务类别匹配', '部门一致', '岗位族一致']),
    })
    expect(result.hits.map((hit) => hit.knowledge_id)).not.toContain('EK-HR-POLICY-PRIVATE')
    expect(result.hits.map((hit) => hit.knowledge_id)).not.toContain('EK-ADMIN-PRIVATE')
    expect(result.hits.length).toBeLessThanOrEqual(6)
  })

  it('跨租户和过期知识在评分前被排除', async () => {
    const retriever = await createRetriever()
    const result = await retriever.retrieve({
      actor: managerActor,
      effective_role: 'MANAGER',
      task: 'CLARIFY_MESSAGE',
      role: createDemoAggregate().state,
      message: '请结合职级和成功标准继续澄清',
    })

    expect(result.hits.map((item) => item.knowledge_id)).not.toContain('EK-OTHER-TENANT')
    expect(result.hits.map((item) => item.knowledge_id)).not.toContain('EK-EXPIRED')
  })

  it('管理员测试经理视角时仍只获得经理可见知识', async () => {
    const retriever = await createRetriever()
    const result = await retriever.retrieve({
      actor: { ...managerActor, user_id: 'admin-demo', role: 'ADMIN' },
      effective_role: 'MANAGER',
      task: 'CLARIFY_MESSAGE',
      role: createDemoAggregate().state,
      message: null,
    })

    expect(result.hits.map((item) => item.knowledge_id)).not.toContain('EK-ADMIN-PRIVATE')
    expect(result.hits.map((item) => item.knowledge_id)).not.toContain('EK-HR-POLICY-PRIVATE')
  })
})
