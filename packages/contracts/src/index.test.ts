import { describe, expect, it } from 'vitest'
import { ROLE_CLARIFIER_SYSTEM_PROMPT as SHARED_SYSTEM_PROMPT } from '@role-clarifier/agent-spec'
import {
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
