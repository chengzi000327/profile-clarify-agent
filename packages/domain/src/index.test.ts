import { describe, expect, it } from 'vitest'
import {
  contentHash,
  detectPII,
  evaluateCalibrationBoundary,
  invalidateDownstreamArtifacts,
} from './index.js'
import type { ArtifactEnvelope, CandidateEvidence } from '@role-clarifier/contracts'

const candidate = (index: number, bottlenecks: string[] = []): CandidateEvidence => ({
  candidate_ref: `CAND-${String(index).padStart(3, '0')}`,
  channel: index % 2 === 0 ? '内推' : '招聘网站',
  source_format: 'TEXT',
  evidence: [],
  bottlenecks,
})

describe('domain rules', () => {
  it('规范化对象键顺序后计算稳定内容哈希', () => {
    expect(contentHash({ b: 2, a: 1 })).toBe(contentHash({ a: 1, b: 2 }))
  })

  it('确认上游变化后让已确认的下游产物失效', () => {
    const artifacts = [
      { id: '1', type: 'ROLE_PROFILE', status: 'CONFIRMED' },
      { id: '2', type: 'ASSESSMENT_SCORECARD', status: 'CONFIRMED' },
      { id: '3', type: 'PUBLIC_JD', status: 'DRAFT' },
    ] as ArtifactEnvelope[]
    const result = invalidateDownstreamArtifacts(artifacts, 'ROLE_PROFILE')
    expect(result[1]?.status).toBe('INVALIDATED')
    expect(result[2]?.status).toBe('DRAFT')
  })

  it('满足 10 名、2 渠道、2 次同类卡点后才进入 HR 审核', () => {
    const candidates = Array.from({ length: 10 }, (_, index) =>
      candidate(index, index < 2 ? ['商业判断证据不足'] : []),
    )
    expect(evaluateCalibrationBoundary(candidates)).toMatchObject({
      eligible: true,
      status: 'HR_REVIEW',
      candidate_count: 10,
      channel_count: 2,
    })
  })

  it('候选人资料发现联系方式和显式姓名时拒绝', () => {
    expect(detectPII('姓名：张三，邮箱 zhangsan@example.com，电话 13812345678')).toEqual([
      'PHONE',
      'EMAIL',
      'NAME',
    ])
  })
})
