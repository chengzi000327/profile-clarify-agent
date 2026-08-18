import { describe, expect, it } from 'vitest'
import { detectPII } from '@role-clarifier/domain'
import { demoEnterpriseKnowledge } from './enterprise-knowledge-seed.js'

describe('Mock 企业知识种子', () => {
  it('覆盖七类企业数据且不包含候选人个人信息', () => {
    const categories = new Set(demoEnterpriseKnowledge.map((item) => item.category))
    expect(categories).toEqual(new Set([
      'ORGANIZATION',
      'JOB_FAMILY',
      'LEVEL_FRAMEWORK',
      'HISTORICAL_JD',
      'ROLE_PROFILE_CASE',
      'RECRUITING_POLICY',
      'INTERVIEW_STANDARD',
    ]))

    for (const item of demoEnterpriseKnowledge) {
      expect(item.tenant_id).toBe('tenant-demo')
      expect(item.source_version).toBe('2026.08')
      expect(detectPII(`${item.title}\n${item.content}\n${item.summary}`)).toEqual([])
    }
  })

  it('产品岗位知识带有可用于确定性检索的部门、岗位族与标签', () => {
    const scopedItems = demoEnterpriseKnowledge.filter((item) => item.department !== null)
    expect(scopedItems.length).toBeGreaterThanOrEqual(5)
    for (const item of scopedItems) {
      expect(item.department).toBe('企业服务产品部')
      expect(item.job_family).toBe('产品')
      expect(item.tags.length).toBeGreaterThan(0)
    }
  })
})
