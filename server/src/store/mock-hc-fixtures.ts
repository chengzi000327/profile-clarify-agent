import type {
  ApplicationStore,
  RecruitingContextImport,
  RecruitingContextRecord,
} from './types.js'

const MOCK_HC_IMPORT_ID = 'tenant-demo-mock-hc-v1-20260816'
const MOCK_HC_IMPORTED_AT = '2026-08-16T00:00:00.000Z'

const hcRecord = (
  externalId: string,
  roleTitle: string,
  department: string,
  content: Record<string, unknown>,
): RecruitingContextRecord => ({
  tenant_id: 'tenant-demo',
  record_type: 'HC_APPROVAL',
  external_id: externalId,
  team_id: department,
  role_title: roleTitle,
  conversation_id: null,
  source_system: 'MOCK_HRIS_HC',
  data_classification: 'MINIMIZED_INTERNAL',
  effective_at: typeof content.approved_at === 'string'
    ? content.approved_at
    : typeof content.requested_at === 'string'
      ? content.requested_at
      : null,
  content: {
    approval_id: externalId,
    role_title: roleTitle,
    department,
    source_revision: 'mock-hc-v2',
    ...content,
  },
  import_id: MOCK_HC_IMPORT_ID,
})

export const mockHcImport: RecruitingContextImport = {
  id: MOCK_HC_IMPORT_ID,
  tenant_id: 'tenant-demo',
  source_revision: 'mock-hc-v2',
  source_file: 'embedded://mock-hc-approvals-v2',
  excluded_sheets: [],
  record_counts: { HC_APPROVAL: 10 },
  imported_at: MOCK_HC_IMPORTED_AT,
}

export const mockHcRecords: RecruitingContextRecord[] = [
  hcRecord('HC-2026-EP-001', '企业产品经理', '企业服务产品部', {
    approval_status: 'APPROVED',
    request_type: 'NEW',
    headcount: 1,
    hiring_reason: '企业服务产品线正从定制化项目交付转向标准化产品，需要新增企业产品经理，补齐共性需求提炼、产品方案标准化和客户验证能力。该编制不是人员替补，用于推动新产品能力从 0 到 1 并在后续规模化复用。',
    business_goal: '形成可复用的企业产品方案并完成核心客户验证。',
    requested_by_role: '企业服务产品负责人',
    approved_by_role: '产品事业部负责人',
    requested_at: '2026-07-28T02:30:00.000Z',
    approved_at: '2026-08-01T09:00:00.000Z',
  }),
  hcRecord('HC-2026-AIPM-002', 'AI 产品经理', 'AI 应用产品部', {
    approval_status: 'APPROVED',
    request_type: 'EXPANSION',
    headcount: 2,
    hiring_reason: '需要扩充 AI 应用产品团队，承接多业务线的场景评估与产品化。',
    business_goal: '支持新增 AI 场景的评估和验证。',
    requested_by_role: 'AI 应用产品负责人',
    approved_by_role: 'AI 产品平台主管',
    requested_at: '2026-08-10T03:00:00.000Z',
    approved_at: '2026-08-13T07:30:00.000Z',
  }),
  hcRecord('HC-2026-CS-003', '后端研发工程师', '核心服务研发部', {
    approval_status: 'REJECTED',
    request_type: 'EXPANSION',
    headcount: 1,
    hiring_reason: '核心服务调用量增长，申请增加后端研发编制以推进服务拆分和稳定性治理。',
    business_goal: '降低核心链路故障率并提升服务扩展能力。',
    requested_by_role: '核心服务研发负责人',
    approved_by_role: '技术委员会',
    requested_at: '2026-08-05T06:20:00.000Z',
    approved_at: null,
  }),
  hcRecord('HC-2026-PP-004', '平台产品经理', '技术平台产品部', {
    approval_status: 'APPROVED',
    request_type: 'NEW',
    headcount: 1,
    hiring_reason: '内部技术能力缺少统一的平台化规划，需要新增平台产品经理负责能力抽象、产品路线和内部客户验证。',
    business_goal: '形成统一技术平台产品路线，并推动至少三个业务团队接入。',
    requested_by_role: '技术平台负责人',
    approved_by_role: '技术副总裁',
    requested_at: '2026-07-22T05:10:00.000Z',
    approved_at: '2026-07-26T08:40:00.000Z',
  }),
  hcRecord('HC-2026-DP-005', '数据产品经理', '数据智能产品部', {
    approval_status: 'APPROVED',
    request_type: 'EXPANSION',
    headcount: 1,
    hiring_reason: '数据资产和指标口径持续增加，需要扩充数据产品能力，统一指标体系并提升业务自助分析效率。',
    business_goal: '完成核心经营指标标准化并上线自助分析产品。',
    requested_by_role: '数据智能产品负责人',
    approved_by_role: '数据平台主管',
    requested_at: '2026-07-25T01:50:00.000Z',
    approved_at: '2026-07-30T07:15:00.000Z',
  }),
  hcRecord('HC-2026-FE-006', '前端研发工程师', '用户体验研发部', {
    approval_status: 'PENDING',
    request_type: 'EXPANSION',
    headcount: 2,
    hiring_reason: '多端产品并行建设导致前端交付压力上升，需要补充工程化和复杂交互开发能力。',
    business_goal: '提升核心页面交付效率并完成前端工程体系升级。',
    requested_by_role: '用户体验研发负责人',
    approved_by_role: null,
    requested_at: '2026-08-12T02:10:00.000Z',
    approved_at: null,
  }),
  hcRecord('HC-2026-QE-007', '测试开发工程师', '质量工程部', {
    approval_status: 'APPROVED',
    request_type: 'REPLACEMENT',
    headcount: 1,
    hiring_reason: '原测试开发岗位转岗后出现自动化测试能力缺口，需要补充关键链路质量保障能力。',
    business_goal: '提高核心链路自动化覆盖率并降低版本回归缺陷。',
    requested_by_role: '质量工程负责人',
    approved_by_role: '研发平台主管',
    requested_at: '2026-07-18T06:00:00.000Z',
    approved_at: '2026-07-21T03:30:00.000Z',
  }),
  hcRecord('HC-2026-REC-008', '推荐算法工程师', '推荐算法部', {
    approval_status: 'APPROVED',
    request_type: 'EXPANSION',
    headcount: 2,
    hiring_reason: '推荐场景从单一排序扩展到多目标优化，需要扩充召回、排序和在线实验能力。',
    business_goal: '提升核心推荐场景的转化效率并建立稳定实验体系。',
    requested_by_role: '推荐算法负责人',
    approved_by_role: '算法平台主管',
    requested_at: '2026-07-20T04:25:00.000Z',
    approved_at: '2026-07-24T10:00:00.000Z',
  }),
  hcRecord('HC-2026-LLM-009', '大模型算法工程师', '大模型应用部', {
    approval_status: 'PENDING',
    request_type: 'NEW',
    headcount: 3,
    hiring_reason: '公司计划建设面向企业场景的大模型应用能力，需要新增模型训练、评测和推理优化编制。',
    business_goal: '完成企业场景模型评测体系并交付首个可上线模型方案。',
    requested_by_role: '大模型应用负责人',
    approved_by_role: null,
    requested_at: '2026-08-14T08:30:00.000Z',
    approved_at: null,
  }),
  hcRecord('HC-2026-CV-010', '计算机视觉算法工程师', '视觉算法部', {
    approval_status: 'REJECTED',
    request_type: 'EXPANSION',
    headcount: 1,
    hiring_reason: '申请增加视觉算法编制，用于推进新一代图像理解能力研发。',
    business_goal: '在目标业务场景达到可上线的识别准确率和推理性能。',
    requested_by_role: '视觉算法负责人',
    approved_by_role: '技术委员会',
    requested_at: '2026-08-06T09:40:00.000Z',
    approved_at: null,
  }),
]

export const seedMockHcApprovals = async (store: ApplicationStore): Promise<void> => {
  await store.upsertRecruitingContextImport(mockHcImport, mockHcRecords)
}
