import type {
  ActorContext,
  HarnessDomainTask,
  RecruitingContextBundle,
  RecruitingContextFact,
  RoleState,
} from '@role-clarifier/contracts'
import { DomainError } from '@role-clarifier/domain'
import type {
  ApplicationStore,
  RecruitingContextRecord,
} from '../store/index.js'
import {
  StoreRecruitingContextProvider,
  type RecruitingContextProvider,
} from './recruiting-context-provider.js'

export const RECRUITING_CONTEXT_PROJECTIONS = [
  'HC_APPROVAL',
  'ORGANIZATION',
  'CLARIFICATION_HISTORY',
  'RECRUITING_FUNNEL',
  'MARKET_JD_REFERENCE',
] as const

export type RecruitingContextProjection = (typeof RECRUITING_CONTEXT_PROJECTIONS)[number]

export interface RecruitingContextReadInput {
  projection: RecruitingContextProjection
  team_id?: string | undefined
  role_title?: string | undefined
  session_type?: string | undefined
  topic?: string | undefined
  query?: string | undefined
  offset?: number | undefined
  limit?: number | undefined
}

type JsonRecord = Record<string, unknown>

const text = (value: unknown): string => typeof value === 'string' ? value : ''
const number = (value: unknown): number => typeof value === 'number' ? value : 0
const isRecord = (value: unknown): value is JsonRecord =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const recordArray = (value: unknown): JsonRecord[] =>
  Array.isArray(value) ? value.filter(isRecord) : []
const nullableText = (value: unknown): string | null => text(value).trim() || null
const boundedStatement = (value: string): string => value.trim().slice(0, 4_000)
const isSyntheticSystem = (system: string): boolean => /MOCK|SYNTHETIC|TEST/i.test(system)
const splitTags = (value: unknown): string[] => text(value)
  .split(/[；;、,，]/)
  .map((item) => item.trim())
  .filter(Boolean)

const normalizedRoleTitle = (value: string): string => value
  .replace(/[（(][^）)]*[）)]/g, '')
  .replace(/高级|资深|专家|负责人|工程师|经理/g, '')
  .replace(/\s+/g, '')
  .trim()

const roleFamily = (roleTitle: string): string => {
  if (/产品/.test(roleTitle)) return '产品'
  if (/算法|模型|RAG|搜索|推荐|多模态|后训练/.test(roleTitle)) return '算法'
  if (/测试|质量/.test(roleTitle)) return '研发/质量'
  if (/SRE|基础设施/.test(roleTitle)) return '研发/基础设施'
  return '研发'
}

const visibleRoleTitle = (state: RoleState, actor: ActorContext, requested?: string): string => {
  const current = state.title.trim()
  if (actor.role === 'MANAGER' && requested && requested !== current) {
    throw new DomainError(
      'RECRUITING_CONTEXT_ROLE_OUT_OF_SCOPE',
      '用人经理只能读取当前岗位对应的历史澄清和招聘数据',
      403,
    )
  }
  return requested?.trim() || current
}

const messageProjection = (record: RecruitingContextRecord): JsonRecord => ({
  message_id: record.external_id,
  conversation_id: record.conversation_id,
  session_no: number(record.content.session_no),
  session_type: text(record.content.session_type),
  turn_no: number(record.content.turn_no),
  sender_role: text(record.content.sender_role),
  content: text(record.content.content),
  created_at: text(record.content.created_at),
  clarification_topic: text(record.content.clarification_topic),
  decision_status: text(record.content.decision_status),
  decision_summary: text(record.content.decision_summary) || null,
  source: {
    system: record.source_system,
    synthetic: isSyntheticSystem(record.source_system),
  },
})

export class RecruitingContextService {
  private readonly provider: RecruitingContextProvider

  constructor(
    private readonly store: ApplicationStore,
    provider?: RecruitingContextProvider,
  ) {
    this.provider = provider ?? new StoreRecruitingContextProvider(store)
  }

  async read(
    roleSessionId: string,
    actor: ActorContext,
    task: string,
    input: RecruitingContextReadInput,
  ): Promise<JsonRecord> {
    if (task !== 'CLARIFY_MESSAGE') {
      throw new DomainError(
        'RECRUITING_CONTEXT_TASK_NOT_ALLOWED',
        `当前任务 ${task} 不允许读取组织与招聘参考数据`,
        403,
      )
    }
    const aggregate = await this.store.getRoleAggregate(roleSessionId, actor, {
      members: false,
      artifacts: false,
      candidates: false,
      calibration_signals: false,
      manager_tasks: false,
    })
    if (!aggregate) throw new DomainError('ROLE_NOT_FOUND', '岗位不存在或无权访问', 404)

    const limit = Math.min(Math.max(input.limit ?? 20, 1), 30)
    const offset = Math.min(Math.max(input.offset ?? 0, 0), 1_000)
    if (input.projection === 'HC_APPROVAL') {
      return this.readHcApproval(actor, aggregate.state, offset, limit)
    }
    if (input.projection === 'ORGANIZATION') {
      return this.readOrganization(actor, aggregate.state, input.team_id, offset, limit)
    }
    if (input.projection === 'CLARIFICATION_HISTORY') {
      return this.readClarificationHistory(
        actor,
        visibleRoleTitle(aggregate.state, actor, input.role_title),
        input.session_type,
        input.topic,
        offset,
        limit,
      )
    }
    if (input.projection === 'RECRUITING_FUNNEL') {
      if (!['HR', 'ADMIN'].includes(actor.role)) {
        throw new DomainError(
          'RECRUITING_CONTEXT_HR_ONLY',
          '招聘漏斗仅允许 HR 或企业管理员读取',
          403,
        )
      }
      return this.readFunnel(
        actor,
        visibleRoleTitle(aggregate.state, actor, input.role_title),
        offset,
        limit,
      )
    }
    return this.readMarketReferences(
      actor,
      input.role_title?.trim() || aggregate.state.title,
      input.query,
      offset,
      Math.min(limit, 5),
    )
  }

  async buildTaskContext(
    roleSessionId: string,
    actor: ActorContext,
    task: HarnessDomainTask,
    query?: string,
  ): Promise<RecruitingContextBundle> {
    const aggregate = await this.store.getRoleAggregate(roleSessionId, actor, {
      members: false,
      artifacts: false,
      candidates: false,
      calibration_signals: false,
      manager_tasks: false,
    })
    if (!aggregate) throw new DomainError('ROLE_NOT_FOUND', '岗位不存在或无权访问', 404)

    const plan: RecruitingContextProjection[] = task === 'CLARIFY_MESSAGE'
      ? [
          'HC_APPROVAL',
          'ORGANIZATION',
          'CLARIFICATION_HISTORY',
          ...(actor.role === 'MANAGER' ? [] : ['RECRUITING_FUNNEL'] as const),
        ]
      : task === 'GENERATE_ROLE_PROFILE'
        ? ['HC_APPROVAL', 'ORGANIZATION', 'CLARIFICATION_HISTORY']
        : task === 'GENERATE_ASSESSMENT'
          ? ['CLARIFICATION_HISTORY']
          : task === 'GENERATE_JD'
            ? ['ORGANIZATION', 'MARKET_JD_REFERENCE']
            : task === 'GENERATE_HR_BRIEF'
              ? ['ORGANIZATION', 'CLARIFICATION_HISTORY', 'RECRUITING_FUNNEL', 'MARKET_JD_REFERENCE']
              : []
    const facts: RecruitingContextFact[] = []
    const warnings: string[] = []
    const seen = new Set<string>()
    const addFact = (fact: RecruitingContextFact): void => {
      const normalized = fact.statement.replace(/\s+/g, '')
      if (!normalized || seen.has(normalized)) return
      seen.add(normalized)
      facts.push(fact)
    }
    const makeFact = (input: {
      fact_id: string
      category: RecruitingContextFact['category']
      statement: string
      authority: RecruitingContextFact['authority']
      data_classification: RecruitingContextFact['data_classification']
      team_id?: string | null
      role_title?: string | null
      system: string
      record_type: string
      record_id: string
      observed_at?: string | null
      synthetic: boolean
      verification_status?: string | null
    }): RecruitingContextFact => ({
      fact_id: input.fact_id,
      category: input.category,
      statement: boundedStatement(input.statement),
      authority: input.authority,
      confirmation_status: 'UNCONFIRMED_CONTEXT',
      data_classification: input.data_classification,
      scope: {
        team_id: input.team_id ?? null,
        role_title: input.role_title ?? null,
      },
      source: {
        provider: this.provider.providerId,
        system: input.system,
        record_type: input.record_type,
        record_id: input.record_id,
        observed_at: input.observed_at ?? null,
        synthetic: input.synthetic,
        verification_status: input.verification_status ?? null,
      },
    })
    const roleTitle = aggregate.state.title.trim()
    const hasRecognizedTitle = Boolean(roleTitle && !/待识别|待确认/.test(roleTitle))

    for (const projection of plan) {
      try {
        if (projection === 'HC_APPROVAL') {
          const result = await this.readHcApproval(actor, aggregate.state, 0, 3)
          for (const approval of recordArray(result.approvals)) {
            const approvalId = text(approval.approval_id)
            const source = isRecord(approval.source) ? approval.source : {}
            const status = text(approval.status)
            addFact(makeFact({
              fact_id: `CTX-HC-${approvalId}`,
              category: 'HC_APPROVAL',
              statement: `HC ${approvalId} 状态为${status}；申请类型：${text(approval.request_type)}；批准编制：${number(approval.headcount)}；招聘原因：${text(approval.hiring_reason)}${text(approval.business_goal) ? `；业务目标：${text(approval.business_goal)}` : ''}`,
              authority: 'AUTHORITATIVE',
              data_classification: 'MINIMIZED_INTERNAL',
              team_id: nullableText(approval.department),
              role_title: nullableText(approval.role_title),
              system: text(source.system) || 'HRIS_HC',
              record_type: 'HC_APPROVAL',
              record_id: approvalId,
              observed_at: nullableText(approval.approved_at) ?? nullableText(approval.requested_at),
              synthetic: Boolean(source.synthetic),
              verification_status: status,
            }))
          }
          continue
        }
        if (projection === 'ORGANIZATION') {
          const result = await this.readOrganization(actor, aggregate.state, undefined, 0, 3)
          const team = recordArray(result.teams)[0]
          if (!team) continue
          const teamId = text(team.team_id)
          const source = isRecord(team.source) ? team.source : {}
          const synthetic = Boolean(source.synthetic)
          const authority: RecruitingContextFact['authority'] = synthetic
            ? 'REFERENCE'
            : 'AUTHORITATIVE'
          const mission = text(team.mission)
          if (mission) {
            addFact(makeFact({
              fact_id: `CTX-ORG-${teamId}-MISSION`,
              category: 'TEAM_MISSION',
              statement: `${text(team.team_name)}的团队使命：${mission}`,
              authority,
              data_classification: 'MINIMIZED_INTERNAL',
              team_id: teamId,
              role_title: roleTitle,
              system: text(source.system) || 'ORGANIZATION_SYSTEM',
              record_type: 'ORGANIZATION_UNIT',
              record_id: teamId,
              observed_at: nullableText(source.snapshot_at),
              synthetic,
              verification_status: nullableText(source.data_status),
            }))
          }
          const inventory = recordArray(team.role_inventory).map((item) => {
            const responsibilities = Array.isArray(item.responsibilities)
              ? item.responsibilities.map(text).filter(Boolean).slice(0, 3)
              : []
            const skills = Array.isArray(item.skills)
              ? item.skills.map(text).filter(Boolean).slice(0, 8)
              : []
            return `${text(item.position)} ${text(item.level)} × ${number(item.count)}`
              + `${responsibilities.length ? `；职责：${responsibilities.join('、')}` : ''}`
              + `${skills.length ? `；能力：${skills.join('、')}` : ''}`
          }).filter(Boolean)
          if (inventory.length > 0) {
            addFact(makeFact({
              fact_id: `CTX-ORG-${teamId}-CAPABILITY`,
              category: 'TEAM_CAPABILITY',
              statement: `${text(team.team_name)}的匿名聚合角色与能力结构：${inventory.join('；')}`,
              authority,
              data_classification: 'MINIMIZED_INTERNAL',
              team_id: teamId,
              role_title: roleTitle,
              system: text(source.system) || 'ORGANIZATION_SYSTEM',
              record_type: 'EMPLOYEE_AGGREGATE',
              record_id: teamId,
              observed_at: nullableText(source.snapshot_at),
              synthetic,
              verification_status: nullableText(source.data_status),
            }))
          }
          continue
        }

        if (!hasRecognizedTitle) {
          warnings.push(`${projection} 已跳过：岗位名称尚未明确，无法安全匹配同岗位上下文。`)
          continue
        }
        if (projection === 'CLARIFICATION_HISTORY') {
          const result = await this.readClarificationHistory(actor, roleTitle, undefined, undefined, 0, 1_000)
          for (const session of recordArray(result.sessions).slice(0, 2)) {
            const conflict = text(session.core_conflict)
            if (!conflict) continue
            const recordId = text(session.role_session_ref)
            const source = isRecord(session.source) ? session.source : {}
            const synthetic = Boolean(source.synthetic)
            addFact(makeFact({
              fact_id: `CTX-HISTORY-${recordId}-CONFLICT`,
              category: 'HISTORICAL_CONFLICT',
              statement: `同岗位历史澄清的核心分歧：${conflict}`,
              authority: synthetic ? 'REFERENCE' : 'CORROBORATING',
              data_classification: 'MINIMIZED_INTERNAL',
              team_id: nullableText(session.team_id),
              role_title: roleTitle,
              system: text(source.system) || 'CLARIFICATION_ARCHIVE',
              record_type: 'HISTORICAL_ROLE_SESSION',
              record_id: recordId,
              observed_at: nullableText(source.observed_at),
              synthetic,
            }))
          }
          const preferredTopics = task === 'GENERATE_ASSESSMENT'
            ? new Set(['SCORING_ANCHOR', 'INTERVIEW_EVIDENCE', 'CASE_DESIGN', 'RED_FLAG'])
            : task === 'GENERATE_HR_BRIEF'
              ? new Set(['TALENT_SUPPLY', 'ATS_HISTORY', 'MUST_HAVE', 'PROXY_CONFLICT'])
              : new Set([
                  'HIRING_REASON',
                  'RESPONSIBILITY_BOUNDARY',
                  'SUCCESS_90D',
                  'SUCCESS_1Y',
                  'MUST_HAVE',
                  'ROLE_IDENTITY',
                  'FINAL_CONFIRMATION',
                ])
          const messages = recordArray(result.messages)
            .filter((message) => text(message.decision_summary))
          const preferred = messages.filter((message) => preferredTopics.has(text(message.clarification_topic)))
          const selected = (preferred.length > 0 ? preferred : messages).slice(0, 8)
          for (const message of selected) {
            const messageId = text(message.message_id)
            const source = isRecord(message.source) ? message.source : {}
            const synthetic = Boolean(source.synthetic)
            addFact(makeFact({
              fact_id: `CTX-HISTORY-${messageId}-DECISION`,
              category: 'HISTORICAL_DECISION',
              statement: `同岗位历史澄清在“${text(message.clarification_topic)}”主题下形成的参考结论：${text(message.decision_summary)}`,
              authority: synthetic ? 'REFERENCE' : 'CORROBORATING',
              data_classification: 'MINIMIZED_INTERNAL',
              role_title: roleTitle,
              system: text(source.system) || 'CLARIFICATION_ARCHIVE',
              record_type: 'CLARIFICATION_MESSAGE',
              record_id: messageId,
              observed_at: nullableText(message.created_at),
              synthetic,
            }))
          }
          continue
        }
        if (projection === 'RECRUITING_FUNNEL') {
          if (actor.role === 'MANAGER') continue
          const result = await this.readFunnel(actor, roleTitle, 0, 4)
          for (const funnel of recordArray(result.funnels)) {
            const counts = isRecord(funnel.counts) ? funnel.counts : {}
            const rates = isRecord(funnel.rates) ? funnel.rates : {}
            const source = isRecord(funnel.source) ? funnel.source : {}
            const recordId = text(funnel.funnel_id)
            const synthetic = Boolean(source.synthetic)
            addFact(makeFact({
              fact_id: `CTX-FUNNEL-${recordId}`,
              category: 'FUNNEL_SIGNAL',
              statement: `${text(funnel.channel)}在${text(funnel.period_start)}至${text(funnel.period_end)}的聚合漏斗：收到简历${number(counts.resumes_received)}份、有效${number(counts.valid_resumes)}份、初面${number(counts.first_interview)}人、Offer ${number(counts.offers)}人、入职${number(counts.onboarded)}人；筛选通过率${number(rates.screen_pass_rate)}，平均招聘周期${number(funnel.average_time_to_fill_days)}天，主要拒绝原因：${text(funnel.top_rejection_reason)}。样本范围：${text(funnel.sample_scope)}`,
              authority: synthetic ? 'REFERENCE' : 'CORROBORATING',
              data_classification: 'HR_INTERNAL_AGGREGATE',
              team_id: nullableText(funnel.team_id),
              role_title: roleTitle,
              system: text(source.system) || 'ATS',
              record_type: 'RECRUITING_FUNNEL',
              record_id: recordId,
              observed_at: nullableText(funnel.period_end),
              synthetic,
            }))
          }
          continue
        }
        const result = await this.readMarketReferences(actor, roleTitle, query, 0, 3)
        for (const reference of recordArray(result.references)) {
          const recordId = text(reference.ref_id)
          const source = isRecord(reference.source) ? reference.source : {}
          addFact(makeFact({
            fact_id: `CTX-MARKET-${recordId}`,
            category: 'MARKET_REFERENCE',
            statement: `${text(reference.company)}“${text(reference.title)}”公开岗位的详细转述。岗位概述：${text(reference.role_overview)}；职责：${text(reference.detailed_responsibilities)}；必要条件：${text(reference.must_have)}；加分项：${text(reference.preferred)}；技术与领域：${text(reference.technology_and_domain)}；协作范围：${text(reference.collaboration_and_scope)}；其他条款：${text(reference.other_material_terms)}；来源：${text(reference.source_url)}`,
            authority: 'REFERENCE',
            data_classification: 'PUBLIC_REFERENCE',
            role_title: roleTitle,
            system: text(source.system) || 'PUBLIC_JOB_REFERENCE',
            record_type: 'MARKET_JD_REFERENCE',
            record_id: recordId,
            observed_at: nullableText(source.observed_at),
            synthetic: Boolean(source.synthetic),
            verification_status: nullableText(reference.verification_status),
          }))
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        warnings.push(`${projection} 上下文读取失败：${reason.slice(0, 300)}`)
      }
    }

    return {
      purpose: task,
      generated_at: new Date().toISOString(),
      projections: plan,
      facts: facts.slice(0, 24),
      warnings: warnings.slice(0, 8),
      usage_policy: {
        may_support_clarification: true,
        may_guide_draft_style: true,
        may_become_role_fact_without_human_confirmation: false,
      },
    }
  }

  private async readHcApproval(
    actor: ActorContext,
    state: RoleState,
    offset: number,
    limit: number,
  ): Promise<JsonRecord> {
    const roleTitle = state.title.trim()
    if (!roleTitle || /待识别|待确认/.test(roleTitle)) {
      return {
        projection: 'HC_APPROVAL',
        data_classification: 'MINIMIZED_INTERNAL',
        approvals: [],
        match_status: 'ROLE_IDENTITY_REQUIRED',
        pagination: { offset, limit, returned: 0, total: 0, next_offset: null },
      }
    }
    const rows = await this.provider.list(actor, {
      record_types: ['HC_APPROVAL'],
      role_title: roleTitle,
      limit: 100,
    })
    const matched = rows.filter((record) =>
      !state.department.trim()
      || /待识别|待确认/.test(state.department)
      || text(record.content.department) === state.department.trim(),
    )
    const approvals = matched.slice(offset, offset + limit).map((record) => ({
      approval_id: record.external_id,
      status: text(record.content.approval_status),
      role_title: record.role_title,
      department: text(record.content.department),
      request_type: text(record.content.request_type),
      headcount: number(record.content.headcount),
      hiring_reason: text(record.content.hiring_reason),
      business_goal: nullableText(record.content.business_goal),
      requested_by_role: text(record.content.requested_by_role),
      approved_by_role: nullableText(record.content.approved_by_role),
      requested_at: text(record.content.requested_at),
      approved_at: nullableText(record.content.approved_at),
      source: {
        system: record.source_system,
        record_id: record.external_id,
        synthetic: isSyntheticSystem(record.source_system),
      },
    }))
    return {
      projection: 'HC_APPROVAL',
      data_classification: 'MINIMIZED_INTERNAL',
      approvals,
      match_status: approvals.length > 0 ? 'MATCHED' : 'NOT_FOUND',
      pagination: {
        offset,
        limit,
        returned: approvals.length,
        total: matched.length,
        next_offset: offset + approvals.length < matched.length ? offset + approvals.length : null,
      },
    }
  }

  private async readOrganization(
    actor: ActorContext,
    state: RoleState,
    teamId: string | undefined,
    offset: number,
    limit: number,
  ): Promise<JsonRecord> {
    const allUnits = await this.provider.list(actor, {
      record_types: ['ORGANIZATION_UNIT'],
      limit: 100,
    })
    const relevance = (unit: RecruitingContextRecord): number => {
      const department = state.department.trim()
      const roleTitle = state.title.trim()
      const family = roleFamily(roleTitle)
      const organizationText = [
        text(unit.content.department),
        text(unit.content.team_name),
        text(unit.content.team_mission),
        text(unit.content.key_products),
      ].join(' ')
      let score = 0
      if (department && [text(unit.content.department), text(unit.content.team_name)].includes(department)) {
        score += 100
      } else if (
        department
        && (organizationText.includes(department) || department.includes(text(unit.content.team_name)))
      ) {
        score += 60
      }
      if (family === '产品' && /产品|应用|商业/.test(organizationText)) score += 30
      if (family === '算法' && /算法|模型|评测|搜索|推荐|多模态/.test(organizationText)) score += 30
      if (family.startsWith('研发') && /工程|平台|可靠性|基础设施/.test(organizationText)) score += 30
      return score
    }
    const rankedUnits = [...allUnits].sort((left, right) =>
      relevance(right) - relevance(left) || left.external_id.localeCompare(right.external_id),
    )
    let units: RecruitingContextRecord[]
    if (actor.role === 'MANAGER') {
      const best = rankedUnits[0]
      const visible = best && relevance(best) > 0 ? [best] : []
      if (teamId && !visible.some((unit) => unit.external_id === teamId)) {
        throw new DomainError(
          'RECRUITING_CONTEXT_TEAM_OUT_OF_SCOPE',
          '用人经理只能读取当前岗位所属团队的最小组织上下文',
          403,
        )
      }
      units = teamId ? visible.filter((unit) => unit.external_id === teamId) : visible
    } else {
      units = teamId
        ? rankedUnits.filter((unit) => unit.external_id === teamId)
        : rankedUnits
    }
    const pagedUnits = units.slice(offset, offset + limit)
    const employeeGroups = await Promise.all(pagedUnits.map((unit) => this.provider.list(actor, {
      record_types: ['EMPLOYEE'],
      team_id: unit.external_id,
      limit: 100,
    })))
    const employees = employeeGroups.flat()
    const teams = pagedUnits.map((unit) => {
      const members = employees.filter((record) => record.team_id === unit.team_id)
      const roleInventory = new Map<string, {
        position: string
        level: string
        count: number
        responsibilities: Set<string>
        skills: Set<string>
      }>()
      const skillCounts = new Map<string, number>()
      for (const member of members) {
        const key = `${text(member.content.position)}\u0000${text(member.content.level)}`
        const item = roleInventory.get(key) ?? {
          position: text(member.content.position),
          level: text(member.content.level),
          count: 0,
          responsibilities: new Set<string>(),
          skills: new Set<string>(),
        }
        item.count += 1
        if (text(member.content.current_responsibilities)) {
          item.responsibilities.add(text(member.content.current_responsibilities))
        }
        for (const skill of splitTags(member.content.skill_tags)) {
          item.skills.add(skill)
          skillCounts.set(skill, (skillCounts.get(skill) ?? 0) + 1)
        }
        roleInventory.set(key, item)
      }
      const synthetic = isSyntheticSystem(unit.source_system)
      const minimumAggregateSize = synthetic ? 1 : 3
      const visibleInventory = [...roleInventory.values()]
        .filter((item) => item.count >= minimumAggregateSize)
      return {
        team_id: unit.external_id,
        company: text(unit.content.company),
        business_unit: text(unit.content.business_unit),
        department: text(unit.content.department),
        team_name: text(unit.content.team_name),
        org_path: text(unit.content.org_path),
        mission: text(unit.content.team_mission),
        business_stage: text(unit.content.business_stage),
        key_products: splitTags(unit.content.key_products),
        goal: text(unit.content['2026_h2_goal']),
        partner_teams: splitTags(unit.content.partner_teams),
        team_headcount: members.length,
        ...(['HR', 'ADMIN'].includes(actor.role)
          ? {
              approved_hc: number(unit.content.approved_hc),
              current_hc: number(unit.content.current_hc),
              open_hc: number(unit.content.open_hc),
            }
          : {}),
        role_inventory: visibleInventory.map((item) => ({
          position: item.position,
          level: item.level,
          count: item.count,
          responsibilities: [...item.responsibilities],
          skills: [...item.skills],
        })),
        skill_distribution: [...skillCounts.entries()]
          .filter(([, count]) => count >= minimumAggregateSize)
          .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
          .map(([skill, count]) => ({ skill, count })),
        aggregation_policy: {
          minimum_group_size: minimumAggregateSize,
          suppressed_role_groups: roleInventory.size - visibleInventory.length,
        },
        source: {
          system: unit.source_system,
          revision: text(unit.content.source_revision),
          snapshot_at: text(unit.content.snapshot_at),
          data_status: text(unit.content.data_status),
          synthetic,
        },
      }
    })
    return {
      projection: 'ORGANIZATION',
      data_classification: 'MINIMIZED_INTERNAL',
      omitted_sensitive_fields: [
        'employee identity',
        'age',
        'salary',
        'education',
        'prior employers and internship',
        'performance',
        'promotion history',
        '360 review',
        'individual development focus',
      ],
      teams,
      pagination: {
        offset,
        limit,
        returned: teams.length,
        total: units.length,
        next_offset: offset + teams.length < units.length ? offset + teams.length : null,
      },
    }
  }

  private async readClarificationHistory(
    actor: ActorContext,
    roleTitle: string,
    sessionType: string | undefined,
    topic: string | undefined,
    offset: number,
    limit: number,
  ): Promise<JsonRecord> {
    const rows = await this.provider.list(actor, {
      record_types: ['HISTORICAL_ROLE_SESSION', 'CLARIFICATION_MESSAGE'],
      role_title: roleTitle,
      limit: 1_000,
    })
    const sessions = rows
      .filter((record) => record.record_type === 'HISTORICAL_ROLE_SESSION')
      .map((record) => ({
        role_session_ref: record.external_id,
        role_title: text(record.content.role_title),
        team_id: record.team_id,
        team_name: text(record.content.team_name),
        status: text(record.content.status),
        core_conflict: text(record.content.core_conflict),
        final_level: text(record.content.final_level),
        budget_range: text(record.content.budget_range),
        conversations: [1, 2, 3].map((index) => ({
          conversation_id: text(record.content[`conversation_${index}_id`]),
          message_count: number(record.content[`c${index}_messages`]),
        })),
        source: {
          system: record.source_system,
          observed_at: record.effective_at,
          synthetic: isSyntheticSystem(record.source_system),
        },
      }))
    const filtered = rows
      .filter((record) => record.record_type === 'CLARIFICATION_MESSAGE')
      .filter((record) => !sessionType || text(record.content.session_type) === sessionType)
      .filter((record) => !topic || text(record.content.clarification_topic) === topic)
      .sort((left, right) =>
        text(left.content.created_at).localeCompare(text(right.content.created_at))
        || number(left.content.turn_no) - number(right.content.turn_no),
      )
    const messages = filtered.slice(offset, offset + limit).map(messageProjection)
    return {
      projection: 'CLARIFICATION_HISTORY',
      role_title: roleTitle,
      source_notice: 'SYNTHETIC_DUAL_PERSONA：用于产品与权限测试的模拟 HR/用人经理对话，不是真实员工沟通记录。',
      sessions,
      messages,
      pagination: {
        offset,
        limit,
        returned: messages.length,
        total: filtered.length,
        next_offset: offset + messages.length < filtered.length ? offset + messages.length : null,
      },
    }
  }

  private async readFunnel(
    actor: ActorContext,
    roleTitle: string,
    offset: number,
    limit: number,
  ): Promise<JsonRecord> {
    const rows = await this.provider.list(actor, {
      record_types: ['RECRUITING_FUNNEL'],
      role_title: roleTitle,
      limit: 100,
    })
    const selected = rows.slice(offset, offset + limit).map((record) => ({
      funnel_id: record.external_id,
      team_id: record.team_id,
      role_title: record.role_title,
      channel: text(record.content.channel),
      period_start: text(record.content.period_start),
      period_end: text(record.content.period_end),
      counts: {
        resumes_received: number(record.content.resumes_received),
        valid_resumes: number(record.content.valid_resumes),
        screen_pass: number(record.content.screen_pass),
        first_interview: number(record.content.first_interview),
        final_interview: number(record.content.final_interview),
        offers: number(record.content.offers),
        offers_accepted: number(record.content.offers_accepted),
        onboarded: number(record.content.onboarded),
      },
      rates: {
        screen_pass_rate: number(record.content.screen_pass_rate),
        interview_to_offer_rate: number(record.content.interview_to_offer_rate),
        offer_accept_rate: number(record.content.offer_accept_rate),
        overall_onboard_rate: number(record.content.overall_onboard_rate),
      },
      average_time_to_fill_days: number(record.content.avg_time_to_fill_days),
      top_rejection_reason: text(record.content.top_rejection_reason),
      sample_scope: text(record.content.sample_scope),
      source: {
        system: record.source_system,
        synthetic: isSyntheticSystem(record.source_system),
      },
    }))
    return {
      projection: 'RECRUITING_FUNNEL',
      role_title: roleTitle,
      source_notice: 'MOCK_ATS：按岗位、周期和渠道聚合的模拟样本，不代表真实人才市场。',
      funnels: selected,
      pagination: {
        offset,
        limit,
        returned: selected.length,
        total: rows.length,
        next_offset: offset + selected.length < rows.length ? offset + selected.length : null,
      },
    }
  }

  private async readMarketReferences(
    actor: ActorContext,
    roleTitle: string,
    query: string | undefined,
    offset: number,
    limit: number,
  ): Promise<JsonRecord> {
    const rows = await this.provider.list(actor, {
      record_types: ['MARKET_JD_REFERENCE'],
      limit: 1_000,
    })
    const target = normalizedRoleTitle(roleTitle)
    const expectedFamily = roleFamily(roleTitle)
    const terms = `${roleTitle} ${query ?? ''}`
      .split(/[\s/、，,；;（）()·-]+/)
      .map((item) => item.trim())
      .filter((item) => item.length >= 2)
    const scored = rows.map((record) => {
      const title = text(record.content.title)
      const normalized = normalizedRoleTitle(title)
      const haystack = [
        title,
        text(record.content.role_family),
        text(record.content.role_overview),
        text(record.content.technology_and_domain),
      ].join(' ')
      let score = 0
      if (normalized === target) score += 100
      else if (normalized.includes(target) || target.includes(normalized)) score += 50
      if (text(record.content.role_family).includes(expectedFamily)) score += 20
      score += terms.filter((term) => haystack.includes(term)).length * 5
      return { record, score }
    }).sort((left, right) =>
      right.score - left.score || left.record.external_id.localeCompare(right.record.external_id),
    )
    const selected = scored.slice(offset, offset + limit).map(({ record, score }) => ({
      ref_id: record.external_id,
      relevance_score: score,
      role_family: text(record.content.role_family),
      title: text(record.content.title),
      company: text(record.content.company),
      salary: text(record.content.salary),
      location: text(record.content.location),
      experience: text(record.content.experience),
      education: text(record.content.education),
      company_size: text(record.content.company_size),
      role_overview: text(record.content.role_overview),
      detailed_responsibilities: text(record.content.detailed_responsibilities),
      must_have: text(record.content.must_have),
      preferred: text(record.content.preferred),
      technology_and_domain: text(record.content.technology_and_domain),
      collaboration_and_scope: text(record.content.collaboration_and_scope),
      other_material_terms: text(record.content.other_material_terms),
      source_url: text(record.content.source_url),
      verification_status: text(record.content.verification_status),
      source: {
        system: record.source_system,
        observed_at: record.effective_at,
        synthetic: isSyntheticSystem(record.source_system),
      },
    }))
    return {
      projection: 'MARKET_JD_REFERENCE',
      role_title: roleTitle,
      source_notice: '智联详情页逐条核验后的详细转述；不是平台原文，使用时必须保留 source_url 并做人工复核。',
      references: selected,
      pagination: {
        offset,
        limit,
        returned: selected.length,
        total: scored.length,
        next_offset: offset + selected.length < scored.length ? offset + selected.length : null,
      },
    }
  }
}
