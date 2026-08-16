import {
  HCApprovalSchema,
  type ActorContext,
  type HCApproval,
} from '@role-clarifier/contracts'
import { DomainError } from '@role-clarifier/domain'
import type {
  ApplicationStore,
  RecruitingContextRecord,
} from '../store/index.js'
import { RoleService, type RoleView } from './role-service.js'

export interface ApprovedHcIntakeOption extends HCApproval {
  clarification_status: 'NOT_STARTED' | 'IN_PROGRESS'
  role_session_id: string | null
}

const approvalFromRecord = (record: RecruitingContextRecord): HCApproval | null => {
  const parsed = HCApprovalSchema.safeParse({
    approval_id: record.external_id,
    status: record.content.approval_status,
    role_title: record.role_title ?? record.content.role_title,
    department: record.content.department,
    request_type: record.content.request_type,
    headcount: record.content.headcount,
    hiring_reason: record.content.hiring_reason,
    business_goal: record.content.business_goal ?? null,
    requested_by_role: record.content.requested_by_role,
    approved_by_role: record.content.approved_by_role ?? null,
    requested_at: record.content.requested_at,
    approved_at: record.content.approved_at ?? null,
    source_system: record.source_system,
    source_ref: `${/MOCK|SYNTHETIC|TEST/i.test(record.source_system) ? 'mock' : 'hris'}://hc/${record.external_id}`,
    synthetic: /MOCK|SYNTHETIC|TEST/i.test(record.source_system),
  })
  return parsed.success ? parsed.data : null
}

export class ApprovedHcIntakeService {
  constructor(
    private readonly store: ApplicationStore,
    private readonly roleService: RoleService,
  ) {}

  private async approved(actor: ActorContext): Promise<HCApproval[]> {
    const records = await this.store.listRecruitingContextRecords(actor, {
      record_types: ['HC_APPROVAL'],
      limit: 1_000,
    })
    return records
      .map(approvalFromRecord)
      .filter((approval): approval is HCApproval => approval?.status === 'APPROVED')
      .sort((left, right) =>
        (right.approved_at ?? '').localeCompare(left.approved_at ?? '')
        || left.approval_id.localeCompare(right.approval_id),
      )
  }

  async list(actor: ActorContext): Promise<ApprovedHcIntakeOption[]> {
    const [approvals, states] = await Promise.all([
      this.approved(actor),
      this.roleService.list(actor),
    ])
    return approvals.flatMap((approval) => {
      const state = states.find((candidate) =>
        candidate.hc_approval?.approval_id === approval.approval_id,
      )
      if (state?.latest_artifacts?.ROLE_PROFILE?.status === 'CONFIRMED') return []
      return [{
        ...approval,
        clarification_status: state ? 'IN_PROGRESS' as const : 'NOT_STARTED' as const,
        role_session_id: state?.id ?? null,
      }]
    })
  }

  async start(actor: ActorContext, approvalId: string): Promise<RoleView> {
    const approval = (await this.approved(actor))
      .find((candidate) => candidate.approval_id === approvalId)
    if (!approval) {
      throw new DomainError(
        'APPROVED_HC_NOT_FOUND',
        '未找到可开始澄清的已审批 HC',
        404,
      )
    }

    const existing = (await this.roleService.list(actor)).find((state) =>
      state.hc_approval?.approval_id === approval.approval_id
      && state.latest_artifacts?.ROLE_PROFILE?.status !== 'CONFIRMED',
    )
    if (existing) return this.roleService.get(existing.id, actor)

    const intake = await this.roleService.createIntake(actor)
    await this.roleService.updateRoleIdentityDraft(intake.state.id, actor, {
      title: approval.role_title,
      department: approval.department,
    })
    return this.roleService.get(intake.state.id, actor)
  }
}
