import type {
  ActorContext,
  EnterpriseContextBundle,
  EnterpriseKnowledgeItem,
  RoleState,
} from '@role-clarifier/contracts'
import type { HarnessTask } from '../agent/harness-adapter.js'
import type { ApplicationStore } from '../store/types.js'

export interface EnterpriseContextRetrievalInput {
  actor: ActorContext
  effective_role: ActorContext['role']
  task: HarnessTask
  role: RoleState
  message: string | null
}

const categoriesByTask: Record<HarnessTask, EnterpriseKnowledgeItem['category'][]> = {
  CLARIFY_MESSAGE: [
    'ORGANIZATION',
    'JOB_FAMILY',
    'LEVEL_FRAMEWORK',
    'HISTORICAL_JD',
    'ROLE_PROFILE_CASE',
    'RECRUITING_POLICY',
    'INTERVIEW_STANDARD',
  ],
  GENERATE_ROLE_PROFILE: ['ROLE_PROFILE_CASE', 'ORGANIZATION', 'JOB_FAMILY', 'LEVEL_FRAMEWORK'],
  GENERATE_ASSESSMENT: ['INTERVIEW_STANDARD', 'ROLE_PROFILE_CASE', 'JOB_FAMILY', 'LEVEL_FRAMEWORK'],
  GENERATE_JD: ['HISTORICAL_JD', 'ROLE_PROFILE_CASE', 'ORGANIZATION'],
  GENERATE_HR_BRIEF: ['RECRUITING_POLICY', 'ROLE_PROFILE_CASE', 'JOB_FAMILY', 'LEVEL_FRAMEWORK'],
  EXTRACT_CANDIDATES: ['JOB_FAMILY', 'ROLE_PROFILE_CASE', 'INTERVIEW_STANDARD', 'RECRUITING_POLICY'],
  CALIBRATION_ADVICE: ['INTERVIEW_STANDARD', 'ROLE_PROFILE_CASE', 'RECRUITING_POLICY'],
}

const termsByTask: Record<HarnessTask, string[]> = {
  CLARIFY_MESSAGE: ['岗位画像', '招聘原因', '成功标准', '职级'],
  GENERATE_ROLE_PROFILE: ['岗位画像', '成功标准', '招聘原因', '工作场景'],
  GENERATE_ASSESSMENT: ['面试标准', '评分锚点', '能力证据', '评估维度'],
  GENERATE_JD: ['历史JD', '公开JD', '岗位职责', '招聘要求'],
  GENERATE_HR_BRIEF: ['招聘协作', '筛选标准', '能力证据', '任务进度'],
  EXTRACT_CANDIDATES: ['筛选标准', '能力证据', '岗位画像'],
  CALIBRATION_ADVICE: ['面试标准', '评分锚点', '校准', '岗位画像'],
}

const visibilityFor = (
  role: ActorContext['role'],
): EnterpriseKnowledgeItem['visible_to'][] => {
  if (role === 'ADMIN') return ['ALL_ROLE_MEMBERS', 'HR_ONLY', 'ADMIN_ONLY']
  if (role === 'HR') return ['ALL_ROLE_MEMBERS', 'HR_ONLY']
  return ['ALL_ROLE_MEMBERS']
}

const inferJobFamily = (title: string): string | null => {
  if (title.includes('产品')) return '产品'
  if (title.includes('算法')) return '算法'
  if (title.includes('工程师') || title.includes('研发')) return '研发'
  return null
}

const buildQueryTerms = (input: EnterpriseContextRetrievalInput, jobFamily: string | null) => {
  const messageTerms = input.message
    ? [input.message.trim(), ...input.message.split(/[，。；、\s]+/u)]
    : []
  return [...new Set([
    input.role.title,
    input.role.department,
    ...(jobFamily ? [jobFamily] : []),
    ...termsByTask[input.task],
    ...messageTerms,
  ])]
    .map((term) => term.trim())
    .filter((term) => term.length >= 2 && term.length <= 24)
    .slice(0, 20)
}

const scoreItem = (
  item: EnterpriseKnowledgeItem,
  input: EnterpriseContextRetrievalInput,
  jobFamily: string | null,
  queryTerms: string[],
) => {
  let score = 0
  const reasons: string[] = []
  if (categoriesByTask[input.task].includes(item.category)) {
    score += 30
    reasons.push('任务类别匹配')
  }
  if (item.department && item.department === input.role.department) {
    score += 25
    reasons.push('部门一致')
  }
  if (item.job_family && item.job_family === jobFamily) {
    score += 20
    reasons.push('岗位族一致')
  }
  const tagHits = item.tags.filter((tag) =>
    queryTerms.some((term) => tag.includes(term) || term.includes(tag)),
  ).length
  if (tagHits > 0) {
    score += Math.min(30, tagHits * 10)
    reasons.push(`标签命中 ${tagHits} 项`)
  }
  const haystack = `${item.title}\n${item.summary}\n${item.content}`
  const textHits = queryTerms.filter((term) => haystack.includes(term)).length
  if (textHits > 0) {
    score += Math.min(20, textHits * 5)
    reasons.push(`关键词命中 ${textHits} 项`)
  }
  return { score, reasons }
}

export class EnterpriseContextRetriever {
  constructor(
    private readonly store: Pick<ApplicationStore, 'listEnterpriseKnowledge'>,
  ) {}

  async retrieve(input: EnterpriseContextRetrievalInput): Promise<EnterpriseContextBundle> {
    const jobFamily = inferJobFamily(input.role.title)
    const queryTerms = buildQueryTerms(input, jobFamily)
    const items = await this.store.listEnterpriseKnowledge({
      tenant_id: input.actor.tenant_id,
      visible_to: visibilityFor(input.effective_role),
      categories: categoriesByTask[input.task],
      now: new Date().toISOString(),
    })
    const ranked = items
      .map((item) => ({ item, ...scoreItem(item, input, jobFamily, queryTerms) }))
      .filter(({ score }) => score > 0)
      .sort((left, right) =>
        right.score - left.score ||
        right.item.updated_at.localeCompare(left.item.updated_at) ||
        left.item.id.localeCompare(right.item.id),
      )

    let summaryLength = 0
    const hits: EnterpriseContextBundle['hits'] = []
    for (const candidate of ranked) {
      if (hits.length >= 6 || summaryLength + candidate.item.summary.length > 4_000) break
      summaryLength += candidate.item.summary.length
      hits.push({
        knowledge_id: candidate.item.id,
        category: candidate.item.category,
        title: candidate.item.title,
        summary: candidate.item.summary,
        source_ref: candidate.item.source_ref,
        source_version: candidate.item.source_version,
        relevance_score: candidate.score,
        match_reasons: candidate.reasons,
      })
    }

    return {
      query: {
        role_session_id: input.role.id,
        task: input.task,
        department: input.role.department,
        job_family: jobFamily,
        query_terms: queryTerms,
      },
      hits,
      truncated: hits.length < ranked.length,
    }
  }
}
