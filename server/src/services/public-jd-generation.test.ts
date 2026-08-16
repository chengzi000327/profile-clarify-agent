import { describe, expect, it } from 'vitest'
import type { ActorContext, PublicJD, RoleState } from '@role-clarifier/contracts'
import { MemoryStore } from '../store/memory-store.js'
import { DEMO_ROLE_SESSION_ID } from '../store/seed.js'
import {
  RoleService,
  evaluatePublicJDGenerationReadiness,
} from './role-service.js'

const actor: ActorContext = {
  tenant_id: 'tenant-demo',
  user_id: 'manager-demo',
  role: 'MANAGER',
  display_name: '用人经理',
}

const publicJD = (): PublicJD => ({
  title_and_basics: {
    title: '商业化产品负责人',
    department: '产品与商业化',
    location: '上海',
    employment_type: '全职',
  },
  about_the_role: '你将围绕关键业务目标推动商业化路线形成、方案验证和持续演进。',
  what_you_will_do: [
    '分析业务目标和用户问题，形成清晰的商业化产品路线',
    '推动关键产品方案设计、验证和持续迭代',
    '协同业务、产品和交付团队建立目标与推进节奏',
    '沉淀关键决策和验证结论，支持后续产品演进',
  ],
  what_we_look_for: [
    '能够从复杂业务目标中识别关键问题并形成方案取舍',
    '能够通过用户、数据或实验结果验证产品判断',
    '能够在跨团队协作中建立承诺并持续推动闭环',
    '能够清晰说明本人在复杂项目中的职责、行动和结果',
  ],
})

const baseState = (): RoleState => ({
  id: 'role-test',
  tenant_id: 'tenant-demo',
  title: '增长负责人',
  department: '增长团队',
  stage: 'ASSESSMENT_CONFIRMED',
  revision: 1,
  hc_status: 'APPROVED',
  facts: [],
  conflicts: [],
  public_job_basics: {},
  latest_artifacts: {},
  candidate_count: 0,
  candidate_channels: [],
  calibration_status: 'OBSERVING',
  created_at: '2026-08-16T00:00:00.000Z',
  updated_at: '2026-08-16T00:00:00.000Z',
})

describe('对外 JD 生成门禁与公开内容校验', () => {
  it('缺少已确认岗位画像时在模型前稳定阻断', () => {
    expect(evaluatePublicJDGenerationReadiness(baseState())).toMatchObject({
      allowed: false,
      code: 'ROLE_PROFILE_CONFIRMATION_REQUIRED',
    })
  })

  it('公开地点或雇佣类型缺失时稳定阻断', async () => {
    const store = new MemoryStore()
    await store.initialize()
    const service = new RoleService(store)
    const view = await service.get(DEMO_ROLE_SESSION_ID, actor)
    const state = {
      ...view.state,
      public_job_basics: {},
    }
    expect(evaluatePublicJDGenerationReadiness(state)).toMatchObject({
      allowed: false,
      code: 'PUBLIC_JOB_BASICS_REQUIRED',
    })
  })

  it('拒绝与人工确认值不一致的地点或薪资', async () => {
    const store = new MemoryStore()
    await store.initialize()
    const service = new RoleService(store)
    const content = publicJD()
    content.title_and_basics.location = '北京'
    content.title_and_basics.compensation = '40–70K·16薪'

    await expect(service.saveArtifactDraft(
      DEMO_ROLE_SESSION_ID,
      actor,
      'PUBLIC_JD',
      content,
    )).rejects.toMatchObject({
      code: 'PUBLIC_JD_BASIC_FIELD_MISMATCH',
      statusCode: 422,
    })
  })

  it('拒绝画像没有依据的学历代理条件', async () => {
    const store = new MemoryStore()
    await store.initialize()
    const service = new RoleService(store)
    const content = publicJD()
    content.what_we_look_for[0] = '硕士及以上学历，计算机相关专业'

    await expect(service.saveArtifactDraft(
      DEMO_ROLE_SESSION_ID,
      actor,
      'PUBLIC_JD',
      content,
    )).rejects.toMatchObject({
      code: 'PUBLIC_JD_UNSUPPORTED_PROXY_REQUIREMENT',
      statusCode: 422,
    })
  })

  it('拒绝内部画像 ID 和评分卡信息泄露', async () => {
    const store = new MemoryStore()
    await store.initialize()
    const service = new RoleService(store)
    const content = publicJD()
    content.what_you_will_do[0] = '负责 W-01，并按照评分卡维度权重推进工作'

    await expect(service.saveArtifactDraft(
      DEMO_ROLE_SESSION_ID,
      actor,
      'PUBLIC_JD',
      content,
    )).rejects.toMatchObject({
      code: 'PUBLIC_JD_FORBIDDEN_CONTENT',
      statusCode: 422,
    })
  })
})
