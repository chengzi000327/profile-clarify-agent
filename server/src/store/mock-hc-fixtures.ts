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
    source_revision: 'mock-hc-v1',
    ...content,
  },
  import_id: MOCK_HC_IMPORT_ID,
})

export const mockHcImport: RecruitingContextImport = {
  id: MOCK_HC_IMPORT_ID,
  tenant_id: 'tenant-demo',
  source_revision: 'mock-hc-v1',
  source_file: 'embedded://mock-hc-approvals-v1',
  excluded_sheets: [],
  record_counts: { HC_APPROVAL: 3 },
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
    approval_status: 'PENDING',
    request_type: 'EXPANSION',
    headcount: 2,
    hiring_reason: '需要扩充 AI 应用产品团队，承接多业务线的场景评估与产品化。',
    business_goal: '支持新增 AI 场景的评估和验证。',
    requested_by_role: 'AI 应用产品负责人',
    approved_by_role: null,
    requested_at: '2026-08-10T03:00:00.000Z',
    approved_at: null,
  }),
  hcRecord('HC-2026-CS-003', '客户成功经理', '客户成功部', {
    approval_status: 'REJECTED',
    request_type: 'REPLACEMENT',
    headcount: 1,
    hiring_reason: '原客户成功岗位离任后申请替补编制。',
    business_goal: '保障存量客户续约与交付连续性。',
    requested_by_role: '客户成功负责人',
    approved_by_role: '人力资源负责人',
    requested_at: '2026-08-05T06:20:00.000Z',
    approved_at: null,
  }),
]

export const seedMockHcApprovals = async (store: ApplicationStore): Promise<void> => {
  await store.upsertRecruitingContextImport(mockHcImport, mockHcRecords)
}
