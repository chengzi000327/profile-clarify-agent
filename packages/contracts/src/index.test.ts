import { describe, expect, it } from 'vitest'
import { ROLE_CLARIFIER_SYSTEM_PROMPT as SHARED_SYSTEM_PROMPT } from '@role-clarifier/agent-spec'
import {
  AssessmentScorecardSchema,
  FactCategorySchema,
  PublicJDSchema,
  ROLE_CLARIFIER_SYSTEM_PROMPT,
} from './index.js'

describe('共享 Agent 规范', () => {
  it('从单一事实源导出 System Prompt', () => {
    expect(ROLE_CLARIFIER_SYSTEM_PROMPT).toBe(SHARED_SYSTEM_PROMPT)
  })

  it('统一支持四类岗位事实', () => {
    expect(FactCategorySchema.options).toEqual([
      'BACKGROUND',
      'HIRING_REASON',
      'SUCCESS_CRITERION',
      'CONSTRAINT',
    ])
  })
})

describe('AssessmentScorecardSchema', () => {
  it('接受模型生成的结构化录用规则和对象评分锚点', () => {
    const result = AssessmentScorecardSchema.safeParse({
      role_id: 'role-001',
      dimensions: [{
        name: '业务判断',
        weight: 35,
        method: '结构化案例面试',
        owner: '用人经理',
        question: '请说明一次关键业务取舍。',
        evidence: '能够说明约束、取舍和结果。',
        anchors: { 1: '无法说明取舍', 3: '能完成基本判断', 5: '能验证复杂取舍' },
      }],
      decision_rule: {
        status: '待确认',
        scoring: '各维度按 1-5 分评分',
        pass_thresholds: '加权总分不低于 3.5',
        calibration: '由 HR 和用人经理校准',
      },
    })

    expect(result.success).toBe(true)
  })

  it('拒绝无法渲染的嵌套录用规则字段', () => {
    const result = AssessmentScorecardSchema.safeParse({
      dimensions: [{
        name: '业务判断',
        weight: 35,
        method: '案例面试',
        anchors: { 3: '能完成基本判断' },
      }],
      decision_rule: { scoring: { unexpected: true } },
    })

    expect(result.success).toBe(false)
  })
})

describe('PublicJDSchema', () => {
  it('只接受四段式公开 JD', () => {
    const result = PublicJDSchema.safeParse({
      title_and_basics: {
        title: '商业化产品经理',
        location: '上海',
        employment_type: '全职',
        reporting_line: '产品负责人',
      },
      about_the_role: '负责商业化产品从策略到落地。',
      what_you_will_do: ['定义路线图并推动跨团队交付'],
      what_we_look_for: ['具备复杂业务抽象能力'],
      hidden_hr_note: '不得进入公开 JD',
    })

    expect(result.success).toBe(false)
  })
})
