import {
  ASSESSMENT_GENERATION_PROMPT,
  CALIBRATION_ADVICE_GENERATION_PROMPT,
  CANDIDATE_EVIDENCE_EXTRACTION_PROMPT,
  FACT_CATEGORIES,
  HARNESS_DOMAIN_TASKS,
  HARNESS_TASK_TOOL_POLICY,
  HR_RECRUITING_BRIEF_GENERATION_PROMPT,
  ROLE_AGENT_TOOL_NAMES,
  ROLE_CLARIFIER_SYSTEM_PROMPT,
  ROLE_PROFILE_GENERATION_PROMPT,
  PUBLIC_JD_GENERATION_PROMPT,
  ROLE_ROUTER_SYSTEM_PROMPT,
  ROUTER_HANDOFF_TASKS,
  type FactCategory,
  type HarnessDomainTask,
  type RoleAgentToolName,
  type RouterHandoffTask,
} from '@role-clarifier/agent-spec'
import { z } from 'zod'

export {
  ASSESSMENT_GENERATION_PROMPT,
  CALIBRATION_ADVICE_GENERATION_PROMPT,
  CANDIDATE_EVIDENCE_EXTRACTION_PROMPT,
  HARNESS_DOMAIN_TASKS,
  HARNESS_TASK_TOOL_POLICY,
  HR_RECRUITING_BRIEF_GENERATION_PROMPT,
  ROLE_AGENT_TOOL_NAMES,
  ROLE_CLARIFIER_SYSTEM_PROMPT,
  ROLE_PROFILE_GENERATION_PROMPT,
  PUBLIC_JD_GENERATION_PROMPT,
  ROLE_ROUTER_SYSTEM_PROMPT,
  ROUTER_HANDOFF_TASKS,
  type FactCategory,
  type HarnessDomainTask,
  type RoleAgentToolName,
  type RouterHandoffTask,
}

export const ActorRoleSchema = z.enum(['MANAGER', 'HR', 'ADMIN'])
export type ActorRole = z.infer<typeof ActorRoleSchema>

export const ActorContextSchema = z.object({
  tenant_id: z.string().min(1),
  user_id: z.string().min(1),
  role: ActorRoleSchema,
  display_name: z.string().min(1),
})
export type ActorContext = z.infer<typeof ActorContextSchema>

export const RoleSessionStageSchema = z.enum([
  'CREATED',
  'CONTEXT_SYNCING',
  'REASON_CLARIFYING',
  'SUCCESS_CLARIFYING',
  'PROFILE_DRAFT',
  'PROFILE_CONFIRMED',
  'ASSESSMENT_DRAFT',
  'ASSESSMENT_CONFIRMED',
  'JD_DRAFT',
  'JD_CONFIRMED',
  'HR_BRIEF_DRAFT',
  'HR_BRIEF_CONFIRMED',
  'RECRUITING',
  'CALIBRATION_OBSERVING',
  'CALIBRATION_HR_REVIEW',
  'CALIBRATION_MANAGER_REVIEW',
  'READY_TO_PUBLISH',
  'ARCHIVED',
])
export type RoleSessionStage = z.infer<typeof RoleSessionStageSchema>

export const FactStatusSchema = z.enum(['DRAFT', 'CONFIRMED', 'CONFLICTED', 'STALE'])
export type FactStatus = z.infer<typeof FactStatusSchema>

export const FactCategorySchema = z.enum(FACT_CATEGORIES)

export const FactSchema = z.object({
  id: z.string(),
  category: FactCategorySchema,
  statement: z.string().min(1),
  source: z.string().min(1),
  status: FactStatusSchema,
  evidence_refs: z.array(z.string()).default([]),
  visible_to: z.enum(['ALL', 'HR_ONLY']).default('ALL'),
  updated_at: z.string().datetime(),
})
export type Fact = z.infer<typeof FactSchema>

export const ConflictSchema = z.object({
  id: z.string(),
  field: z.string(),
  left_value: z.string(),
  right_value: z.string(),
  source_refs: z.array(z.string()).min(2),
  status: z.enum(['OPEN', 'RESOLVED']),
  resolution: z.string().optional(),
})
export type Conflict = z.infer<typeof ConflictSchema>

const PublicJobShortTextSchema = z.string().trim().min(1).max(160)

export const PublicJobFieldSchema = z.object({
  value: PublicJobShortTextSchema,
  status: z.literal('CONFIRMED'),
  visibility: z.literal('PUBLIC'),
  source: z.enum(['MANAGER', 'HR', 'ADMIN', 'BUSINESS_SYSTEM']),
  confirmed_at: z.string().datetime(),
}).strict()
export type PublicJobField = z.infer<typeof PublicJobFieldSchema>

export const PublicJobBasicsSchema = z.object({
  location: PublicJobFieldSchema.optional(),
  employment_type: PublicJobFieldSchema.optional(),
  level: PublicJobFieldSchema.optional(),
  work_mode: PublicJobFieldSchema.optional(),
  reporting_line: PublicJobFieldSchema.optional(),
  compensation: PublicJobFieldSchema.optional(),
}).strict()
export type PublicJobBasics = z.infer<typeof PublicJobBasicsSchema>

export const PublicJobBasicsUpdateSchema = z.object({
  location: PublicJobShortTextSchema,
  employment_type: PublicJobShortTextSchema,
  level: PublicJobShortTextSchema.nullable().optional(),
  work_mode: PublicJobShortTextSchema.nullable().optional(),
  reporting_line: PublicJobShortTextSchema.nullable().optional(),
  compensation: PublicJobShortTextSchema.nullable().optional(),
  expected_revision: z.number().int().nonnegative(),
}).strict()
export type PublicJobBasicsUpdate = z.infer<typeof PublicJobBasicsUpdateSchema>

export const HCApprovalSchema = z.object({
  approval_id: z.string().trim().min(1).max(160),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']),
  role_title: z.string().trim().min(1).max(160),
  department: z.string().trim().min(1).max(160),
  request_type: z.enum(['NEW', 'REPLACEMENT', 'EXPANSION']),
  headcount: z.number().int().positive().max(100),
  hiring_reason: z.string().trim().min(1).max(2_000),
  business_goal: z.string().trim().min(1).max(2_000).nullable(),
  requested_by_role: z.string().trim().min(1).max(160),
  approved_by_role: z.string().trim().min(1).max(160).nullable(),
  requested_at: z.string().datetime(),
  approved_at: z.string().datetime().nullable(),
  source_system: z.string().trim().min(1).max(160),
  source_ref: z.string().trim().min(1).max(240),
  synthetic: z.boolean(),
}).strict()
export type HCApproval = z.infer<typeof HCApprovalSchema>

const HRSourceRefListSchema = z.array(z.string().trim().min(1).max(240)).max(20)

export const HRRecruitingContextSchema = z.object({
  talent_pool_status: z.enum(['NOT_CONNECTED', 'DEMO', 'CONNECTED']),
  searchable_fields: z.array(z.string().trim().min(1).max(120)).max(30),
  approved_channels: z.array(z.object({
    channel: z.string().trim().min(1).max(120),
    source_refs: HRSourceRefListSchema.min(1),
  }).strict()).max(20),
  supply_observations: z.array(z.object({
    statement: z.string().trim().min(1).max(1_000),
    source_refs: HRSourceRefListSchema.min(1),
  }).strict()).max(20),
  target_companies: z.array(z.object({
    name: z.string().trim().min(1).max(160),
    rationale: z.string().trim().min(1).max(1_000),
    source_refs: HRSourceRefListSchema.min(1),
  }).strict()).max(30),
}).strict().superRefine((value, context) => {
  if (
    value.talent_pool_status === 'NOT_CONNECTED'
    && (value.supply_observations.length > 0 || value.target_companies.length > 0)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['talent_pool_status'],
      message: '人才库未接入时不得包含供给观察或目标公司',
    })
  }
})
export type HRRecruitingContext = z.infer<typeof HRRecruitingContextSchema>

export const JobHeaderSchema = z.object({
  title: PublicJobShortTextSchema,
  department: PublicJobShortTextSchema,
  location: PublicJobShortTextSchema,
  employment_type: PublicJobShortTextSchema,
  level: PublicJobShortTextSchema.optional(),
  work_mode: PublicJobShortTextSchema.optional(),
  reporting_line: PublicJobShortTextSchema.optional(),
  compensation: PublicJobShortTextSchema.optional(),
}).strict()
export type JobHeader = z.infer<typeof JobHeaderSchema>

export const PublicJDSchema = z
  .object({
    title_and_basics: JobHeaderSchema,
    about_the_role: z.string().trim().min(1).max(2_000),
    what_you_will_do: z.array(z.string().trim().min(1).max(500)).min(4).max(6),
    what_we_look_for: z.array(z.string().trim().min(1).max(500)).min(4).max(5),
  })
  .strict()
  .superRefine((value, context) => {
    const normalize = (text: string): string => text
      .toLocaleLowerCase('zh-CN')
      .replace(/[\s，。；、：,.!！?？;:（）()\-]/g, '')
    const checkDuplicates = (
      items: string[],
      path: 'what_you_will_do' | 'what_we_look_for',
    ): void => {
      const seen = new Set<string>()
      for (const [index, item] of items.entries()) {
        const normalized = normalize(item)
        if (seen.has(normalized)) {
          context.addIssue({
            code: 'custom',
            path: [path, index],
            message: `${path} 不得包含重复条目`,
          })
        }
        seen.add(normalized)
      }
    }
    checkDuplicates(value.what_you_will_do, 'what_you_will_do')
    checkDuplicates(value.what_we_look_for, 'what_we_look_for')
  })
export type PublicJD = z.infer<typeof PublicJDSchema>

const HRBriefTextSchema = z.string().trim().min(1).max(2_000)
const HRBriefShortTextSchema = z.string().trim().min(1).max(240)
const HRBriefRequirementRefsSchema = z.array(
  z.string().regex(/^R-\d{2}$/),
).min(1).max(16)
const HRBriefWorkRefsSchema = z.array(
  z.string().regex(/^W-\d{2}$/),
).min(1).max(16)
const HRBriefEvidenceListSchema = z.array(HRBriefShortTextSchema).min(1).max(8)

export const HRRecruitingBriefSchema = z.object({
  target_candidate_summary: HRBriefTextSchema,
  target_types: z.array(z.object({
    label: HRBriefShortTextSchema,
    fit_rationale: HRBriefTextSchema,
    requirement_refs: HRBriefRequirementRefsSchema,
    work_refs: HRBriefWorkRefsSchema,
  }).strict()).min(1).max(4),
  search_strategy: z.object({
    titles: z.array(HRBriefShortTextSchema).min(3).max(8),
    keyword_groups: z.array(z.object({
      name: HRBriefShortTextSchema,
      keywords: z.array(HRBriefShortTextSchema).min(2).max(10),
      requirement_refs: HRBriefRequirementRefsSchema,
    }).strict()).min(2).max(6),
    boolean_query: z.string().trim().min(1).max(2_000),
    priority_channels: z.array(z.object({
      channel: HRBriefShortTextSchema,
      rationale: HRBriefTextSchema,
      basis: z.enum(['CONFIRMED_DATA', 'SUGGESTED']),
      source_refs: HRSourceRefListSchema,
    }).strict().superRefine((value, context) => {
      if (value.basis === 'CONFIRMED_DATA' && value.source_refs.length === 0) {
        context.addIssue({
          code: 'custom',
          path: ['source_refs'],
          message: 'CONFIRMED_DATA 渠道必须带来源引用',
        })
      }
      if (value.basis === 'SUGGESTED' && value.source_refs.length > 0) {
        context.addIssue({
          code: 'custom',
          path: ['source_refs'],
          message: 'SUGGESTED 渠道不得伪装成有来源的数据',
        })
      }
    })).max(4),
  }).strict(),
  resume_screen: z.object({
    thirty_second_checks: z.array(z.object({
      criterion: HRBriefShortTextSchema,
      requirement_refs: HRBriefRequirementRefsSchema,
      evidence_to_find: HRBriefEvidenceListSchema,
      missing_action: z.literal('VERIFY_NOT_REJECT'),
    }).strict()).min(3).max(6),
    non_target_signals: z.array(z.object({
      signal: HRBriefTextSchema,
      reason: HRBriefTextSchema,
      requirement_refs: HRBriefRequirementRefsSchema,
      action: z.enum(['VERIFY', 'HR_REVIEW_BEFORE_DEPRIORITIZE']),
    }).strict()).max(5),
  }).strict(),
  phone_questions: z.array(z.object({
    prompt: HRBriefTextSchema,
    probes: z.array(HRBriefShortTextSchema).min(1).max(4),
    evidence_to_collect: HRBriefEvidenceListSchema,
    requirement_refs: HRBriefRequirementRefsSchema,
  }).strict()).min(3).max(6),
  market_context: z.object({
    status: z.enum(['NOT_CONNECTED', 'DEMO', 'CONNECTED']),
    note: HRBriefTextSchema,
    supply_observations: z.array(z.object({
      statement: HRBriefTextSchema,
      source_refs: HRSourceRefListSchema.min(1),
    }).strict()).max(20),
    target_companies: z.array(z.object({
      name: z.string().trim().min(1).max(160),
      rationale: HRBriefTextSchema,
      source_refs: HRSourceRefListSchema.min(1),
    }).strict()).max(30),
  }).strict(),
  calibration_watchpoints: z.array(z.object({
    signal: HRBriefTextSchema,
    requirement_refs: HRBriefRequirementRefsSchema,
    trigger_rule: z.object({
      minimum_candidates: z.literal(10),
      minimum_channels: z.literal(2),
      repeated_signal_count: z.literal(2),
    }).strict(),
    action: z.literal('HR_REVIEW'),
  }).strict()).min(1).max(5),
  open_questions: z.array(HRBriefTextSchema).max(5),
}).strict().superRefine((value, context) => {
  const normalizedSeen = (
    values: string[],
    path: (string | number)[],
  ): void => {
    const seen = new Set<string>()
    for (const [index, item] of values.entries()) {
      const normalized = item.toLocaleLowerCase('zh-CN').replace(/[\s，。；、：,.!！?？;:（）()\-]/g, '')
      if (seen.has(normalized)) {
        context.addIssue({ code: 'custom', path: [...path, index], message: '不得包含重复项' })
      }
      seen.add(normalized)
    }
  }
  normalizedSeen(value.target_types.map((item) => item.label), ['target_types'])
  normalizedSeen(value.search_strategy.titles, ['search_strategy', 'titles'])
  normalizedSeen(
    value.search_strategy.keyword_groups.map((item) => item.name),
    ['search_strategy', 'keyword_groups'],
  )
  normalizedSeen(
    value.resume_screen.thirty_second_checks.map((item) => item.criterion),
    ['resume_screen', 'thirty_second_checks'],
  )
  normalizedSeen(value.phone_questions.map((item) => item.prompt), ['phone_questions'])
  if (
    value.market_context.status === 'NOT_CONNECTED'
    && (value.market_context.supply_observations.length > 0
      || value.market_context.target_companies.length > 0)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['market_context', 'status'],
      message: '人才库未接入时不得生成供给观察或目标公司',
    })
  }
})
export type HRRecruitingBrief = z.infer<typeof HRRecruitingBriefSchema>

const ProfileTextSchema = z.string().trim().min(1).max(2_000)
const ProfileTextListSchema = z.array(ProfileTextSchema).max(12)
const ProfileReferenceListSchema = z.array(z.string().trim().min(1).max(200)).max(24)

export const RoleProfileMissionSchema = z.object({
  statement: ProfileTextSchema,
  hiring_reason_fact_refs: ProfileReferenceListSchema.min(1),
  success_criterion_fact_refs: ProfileReferenceListSchema.min(1),
}).strict()

export const RoleProfileWorkSchema = z.object({
  id: z.string().regex(/^W-\d{2}$/),
  title: ProfileTextSchema,
  description: ProfileTextSchema,
  deliverables: ProfileTextListSchema.min(1),
  success_criterion_fact_refs: ProfileReferenceListSchema.min(1),
  other_fact_refs: ProfileReferenceListSchema,
}).strict()

export const RoleProfileBoundaryItemSchema = z.object({
  statement: ProfileTextSchema,
  fact_refs: ProfileReferenceListSchema,
  work_refs: ProfileReferenceListSchema,
}).strict().refine(
  (value) => value.fact_refs.length > 0 || value.work_refs.length > 0,
  { message: '岗位边界必须引用已确认事实或关键工作' },
)

export const RoleProfileRequirementSchema = z.object({
  id: z.string().regex(/^R-\d{2}$/),
  priority: z.enum(['MUST_HAVE', 'PREFERRED']),
  name: ProfileTextSchema,
  level: ProfileTextSchema,
  rationale: ProfileTextSchema,
  strong_evidence: ProfileTextListSchema.min(1),
  acceptable_alternatives: ProfileTextListSchema,
  risk_signals: ProfileTextListSchema.min(1),
  work_refs: ProfileReferenceListSchema,
  success_criterion_fact_refs: ProfileReferenceListSchema,
  constraint_fact_refs: ProfileReferenceListSchema,
}).strict().refine(
  (value) =>
    value.work_refs.length > 0
    || value.success_criterion_fact_refs.length > 0
    || value.constraint_fact_refs.length > 0,
  { message: '人才要求必须引用关键工作、成功标准或硬约束' },
)

export const RoleProfileOpenQuestionSchema = z.object({
  field_path: z.string().trim().min(1).max(240),
  reason: ProfileTextSchema,
  question: ProfileTextSchema,
}).strict()

export const RoleProfileSchema = z.object({
  mission: RoleProfileMissionSchema,
  work: z.array(RoleProfileWorkSchema).min(1).max(12),
  boundaries: z.object({
    owns: z.array(RoleProfileBoundaryItemSchema).max(12),
    does_not_own: z.array(RoleProfileBoundaryItemSchema).max(12),
    decision_rights: z.array(RoleProfileBoundaryItemSchema).max(12),
    collaboration_and_resources: z.array(RoleProfileBoundaryItemSchema).max(12),
  }).strict(),
  requirements: z.array(RoleProfileRequirementSchema).min(1).max(16),
  open_questions: z.array(RoleProfileOpenQuestionSchema).max(12),
}).strict().superRefine((value, context) => {
  const workIds = new Set<string>()
  for (const [index, work] of value.work.entries()) {
    if (workIds.has(work.id)) {
      context.addIssue({
        code: 'custom',
        path: ['work', index, 'id'],
        message: `关键工作 ID 重复：${work.id}`,
      })
    }
    workIds.add(work.id)
  }

  const requirementIds = new Set<string>()
  for (const [index, requirement] of value.requirements.entries()) {
    if (requirementIds.has(requirement.id)) {
      context.addIssue({
        code: 'custom',
        path: ['requirements', index, 'id'],
        message: `人才要求 ID 重复：${requirement.id}`,
      })
    }
    requirementIds.add(requirement.id)
  }

  const checkWorkRefs = (refs: string[], path: (string | number)[]): void => {
    for (const [index, ref] of refs.entries()) {
      if (!workIds.has(ref)) {
        context.addIssue({
          code: 'custom',
          path: [...path, index],
          message: `关键工作引用不存在：${ref}`,
        })
      }
    }
  }

  for (const [groupName, items] of Object.entries(value.boundaries)) {
    for (const [index, item] of items.entries()) {
      checkWorkRefs(item.work_refs, ['boundaries', groupName, index, 'work_refs'])
    }
  }
  for (const [index, requirement] of value.requirements.entries()) {
    checkWorkRefs(requirement.work_refs, ['requirements', index, 'work_refs'])
  }
})
export type RoleProfile = z.infer<typeof RoleProfileSchema>

const AssessmentReferenceListSchema = z.array(
  z.string().trim().min(1).max(200),
).max(24)

export const AssessmentMethodTypeSchema = z.enum([
  'STRUCTURED_BEHAVIORAL_INTERVIEW',
  'WORK_SAMPLE',
  'CASE_EXERCISE',
  'PORTFOLIO_REVIEW',
  'TECHNICAL_INTERVIEW',
  'ROLE_PLAY',
])

export const AssessmentQuestionSchema = z.object({
  prompt: ProfileTextSchema,
  probes: ProfileTextListSchema,
  evidence_to_collect: ProfileTextListSchema.min(1),
}).strict()

export const AssessmentDimensionSchema = z.object({
  id: z.string().regex(/^D-\d{2}$/),
  name: ProfileTextSchema,
  criticality: z.enum(['CORE', 'SUPPORTING']),
  weight: z.number().int().min(1).max(100),
  requirement_refs: AssessmentReferenceListSchema.min(1),
  work_refs: AssessmentReferenceListSchema,
  method: z.object({
    type: AssessmentMethodTypeSchema,
    instructions: ProfileTextSchema,
  }).strict(),
  questions: z.array(AssessmentQuestionSchema).min(1).max(8),
  evidence_criteria: z.object({
    strong_evidence: ProfileTextListSchema.min(1),
    acceptable_evidence: ProfileTextListSchema.min(1),
    risk_signals: ProfileTextListSchema.min(1),
  }).strict(),
  anchors: z.object({
    score_1: ProfileTextSchema,
    score_3: ProfileTextSchema,
    score_5: ProfileTextSchema,
  }).strict(),
}).strict()

export const AssessmentInterviewStageSchema = z.object({
  id: z.string().regex(/^S-\d{2}$/),
  name: ProfileTextSchema,
  interviewer_role: ProfileTextSchema,
  duration_minutes: z.number().int().min(15).max(240),
  dimension_refs: AssessmentReferenceListSchema.min(1),
}).strict()

export const AssessmentScorecardSchema = z.object({
  dimensions: z.array(AssessmentDimensionSchema).min(1).max(16),
  interview_plan: z.array(AssessmentInterviewStageSchema).min(1).max(12),
  scoring_rules: z.object({
    scale: z.literal('1_3_5'),
    weighted_total_formula: z.literal('SUM(dimension_score / 5 * weight)'),
    insufficient_evidence_action: z.literal('DO_NOT_SCORE_AND_FOLLOW_UP'),
    preferred_requirement_can_veto: z.literal(false),
    final_decision: z.literal('HUMAN_REQUIRED'),
  }).strict(),
  open_questions: z.array(RoleProfileOpenQuestionSchema).max(12),
}).strict().superRefine((value, context) => {
  const dimensionIds = new Set<string>()
  let totalWeight = 0
  for (const [index, dimension] of value.dimensions.entries()) {
    if (dimensionIds.has(dimension.id)) {
      context.addIssue({
        code: 'custom',
        path: ['dimensions', index, 'id'],
        message: `评估维度 ID 重复：${dimension.id}`,
      })
    }
    dimensionIds.add(dimension.id)
    totalWeight += dimension.weight
  }
  if (totalWeight !== 100) {
    context.addIssue({
      code: 'custom',
      path: ['dimensions'],
      message: `评估维度权重合计必须为 100，当前为 ${totalWeight}`,
    })
  }

  const coveredDimensions = new Set<string>()
  const stageIds = new Set<string>()
  for (const [stageIndex, stage] of value.interview_plan.entries()) {
    if (stageIds.has(stage.id)) {
      context.addIssue({
        code: 'custom',
        path: ['interview_plan', stageIndex, 'id'],
        message: `面试环节 ID 重复：${stage.id}`,
      })
    }
    stageIds.add(stage.id)
    for (const [refIndex, ref] of stage.dimension_refs.entries()) {
      if (!dimensionIds.has(ref)) {
        context.addIssue({
          code: 'custom',
          path: ['interview_plan', stageIndex, 'dimension_refs', refIndex],
          message: `评估维度引用不存在：${ref}`,
        })
      } else {
        coveredDimensions.add(ref)
      }
    }
  }
  for (const [index, dimension] of value.dimensions.entries()) {
    if (!coveredDimensions.has(dimension.id)) {
      context.addIssue({
        code: 'custom',
        path: ['dimensions', index, 'id'],
        message: `评估维度未被面试计划覆盖：${dimension.id}`,
      })
    }
  }
})
export type AssessmentScorecard = z.infer<typeof AssessmentScorecardSchema>

export const ArtifactTypeSchema = z.enum([
  'ROLE_PROFILE',
  'ASSESSMENT_SCORECARD',
  'PUBLIC_JD',
  'HR_RECRUITING_BRIEF',
])
export type ArtifactType = z.infer<typeof ArtifactTypeSchema>

export const ArtifactStatusSchema = z.enum(['DRAFT', 'CONFIRMED', 'INVALIDATED'])
export type ArtifactStatus = z.infer<typeof ArtifactStatusSchema>

export const ArtifactEnvelopeSchema = <T extends z.ZodTypeAny>(content: T) =>
  z.object({
    id: z.string(),
    role_session_id: z.string(),
    type: ArtifactTypeSchema,
    version: z.number().int().positive(),
    status: ArtifactStatusSchema,
    content,
    content_hash: z.string().min(16),
    based_on_hash: z.string().nullable(),
    created_by: z.string(),
    created_at: z.string().datetime(),
    confirmed_by: z.string().nullable(),
    confirmed_at: z.string().datetime().nullable(),
  })

export interface ArtifactEnvelope<T = unknown> {
  id: string
  role_session_id: string
  type: ArtifactType
  version: number
  status: ArtifactStatus
  content: T
  content_hash: string
  based_on_hash: string | null
  created_by: string
  created_at: string
  confirmed_by: string | null
  confirmed_at: string | null
}

export const CalibrationStatusSchema = z.enum([
  'OBSERVING',
  'HR_REVIEW',
  'DISMISSED',
  'MANAGER_REVIEW',
  'ACCEPTED',
  'REJECTED',
])
export type CalibrationStatus = z.infer<typeof CalibrationStatusSchema>

export const CandidateEvidenceStatusSchema = z.enum([
  'SUPPORTED',
  'POSSIBLE_SUPPORT',
  'NOT_MENTIONED',
  'MISMATCH',
  'INTERVIEW_NEEDED',
])
export type CandidateEvidenceStatus = z.infer<typeof CandidateEvidenceStatusSchema>

export const CandidateEvidenceItemSchema = z.object({
  requirement_ref: z.string().regex(/^R-\d{2}$/),
  criterion: z.string().trim().min(1).max(2_000),
  dimension_refs: z.array(z.string().regex(/^D-\d{2}$/)).max(16),
  evidence_status: CandidateEvidenceStatusSchema,
  signal: z.enum(['STRONG', 'MIXED', 'WEAK', 'MISSING']),
  confidence: z.enum(['HIGH', 'MEDIUM', 'LOW']),
  quote_span: z.object({
    quote: z.string().min(1).max(500),
    locator: z.string().trim().min(1).max(240),
  }).strict().nullable(),
  rationale: z.string().trim().min(1).max(1_000),
  needs_interview: z.boolean(),
  interview_question: z.string().trim().min(1).max(1_000).nullable(),
}).strict().superRefine((value, context) => {
  const signalByStatus = {
    SUPPORTED: 'STRONG',
    POSSIBLE_SUPPORT: 'MIXED',
    NOT_MENTIONED: 'MISSING',
    MISMATCH: 'WEAK',
    INTERVIEW_NEEDED: 'MIXED',
  } as const
  if (value.signal !== signalByStatus[value.evidence_status]) {
    context.addIssue({
      code: 'custom',
      path: ['signal'],
      message: `${value.evidence_status} 必须映射为 ${signalByStatus[value.evidence_status]}`,
    })
  }
  const needsInterview = [
    'POSSIBLE_SUPPORT',
    'NOT_MENTIONED',
    'INTERVIEW_NEEDED',
  ].includes(value.evidence_status)
  if (value.needs_interview !== needsInterview) {
    context.addIssue({
      code: 'custom',
      path: ['needs_interview'],
      message: `${value.evidence_status} 的 needs_interview 必须为 ${needsInterview}`,
    })
  }
  if (needsInterview !== Boolean(value.interview_question)) {
    context.addIssue({
      code: 'custom',
      path: ['interview_question'],
      message: needsInterview ? '需要面试验证时必须提供具体问题' : '无需面试验证时问题必须为 null',
    })
  }
  if (value.evidence_status === 'NOT_MENTIONED' && value.quote_span !== null) {
    context.addIssue({
      code: 'custom',
      path: ['quote_span'],
      message: 'NOT_MENTIONED 不得伪造原文定位，quote_span 必须为 null',
    })
  }
  if (value.evidence_status !== 'NOT_MENTIONED' && value.quote_span === null) {
    context.addIssue({
      code: 'custom',
      path: ['quote_span'],
      message: `${value.evidence_status} 必须提供原文定位`,
    })
  }
})
export type CandidateEvidenceItem = z.infer<typeof CandidateEvidenceItemSchema>

export const CandidateEvidenceSchema = z.object({
  candidate_ref: z.string().regex(/^CAND-[A-Z0-9-]{3,40}$/),
  channel: z.string().trim().min(1).max(80),
  source_format: z.enum(['JSON', 'TEXT']),
  evidence: z.array(CandidateEvidenceItemSchema).min(1).max(16),
  bottlenecks: z.array(
    z.string().regex(/^R-\d{2}:(?:MISMATCH|NEEDS_VERIFICATION)$/),
  ).max(16).default([]),
}).strict().superRefine((value, context) => {
  const requirementRefs = new Set<string>()
  for (const [index, evidence] of value.evidence.entries()) {
    if (requirementRefs.has(evidence.requirement_ref)) {
      context.addIssue({
        code: 'custom',
        path: ['evidence', index, 'requirement_ref'],
        message: `同一候选人的 requirement_ref 不得重复：${evidence.requirement_ref}`,
      })
    }
    requirementRefs.add(evidence.requirement_ref)
  }
  if (new Set(value.bottlenecks).size !== value.bottlenecks.length) {
    context.addIssue({
      code: 'custom',
      path: ['bottlenecks'],
      message: 'bottlenecks 不得包含重复项',
    })
  }
})
export type CandidateEvidence = z.infer<typeof CandidateEvidenceSchema>

export const CandidateEvidenceFailureSchema = z.object({
  candidate_ref: z.string().regex(/^CAND-[A-Z0-9-]{3,40}$/),
  code: z.enum(['EMPTY_CONTENT', 'UNPARSABLE_CONTENT', 'UNSAFE_CONTENT']),
  message: z.string().trim().min(1).max(500),
}).strict()
export type CandidateEvidenceFailure = z.infer<typeof CandidateEvidenceFailureSchema>

export const CandidateEvidenceStatusCountsSchema = z.object({
  SUPPORTED: z.number().int().nonnegative(),
  POSSIBLE_SUPPORT: z.number().int().nonnegative(),
  NOT_MENTIONED: z.number().int().nonnegative(),
  MISMATCH: z.number().int().nonnegative(),
  INTERVIEW_NEEDED: z.number().int().nonnegative(),
}).strict()

export const CalibrationCandidateSummarySchema = z.object({
  total_candidates: z.number().int().nonnegative(),
  channels: z.array(z.string().trim().min(1).max(80)).max(20),
  omitted_channel_count: z.number().int().nonnegative(),
  criteria: z.array(z.object({
    requirement_ref: z.string().regex(/^R-\d{2}$/),
    criterion: z.string().trim().min(1).max(2_000),
    evidence_count: z.number().int().nonnegative(),
    signals: z.object({
      STRONG: z.number().int().nonnegative(),
      MIXED: z.number().int().nonnegative(),
      WEAK: z.number().int().nonnegative(),
      MISSING: z.number().int().nonnegative(),
    }).strict(),
    evidence_statuses: CandidateEvidenceStatusCountsSchema,
  }).strict()).max(20),
  omitted_criterion_count: z.number().int().nonnegative(),
  top_bottlenecks: z.array(z.object({
    label: z.string().trim().min(1).max(240),
    count: z.number().int().positive(),
  }).strict()).max(20),
  omitted_bottleneck_count: z.number().int().nonnegative(),
}).strict()
export type CalibrationCandidateSummary = z.infer<typeof CalibrationCandidateSummarySchema>

export const CalibrationBoundaryEvaluationSchema = z.object({
  status: z.enum(['OBSERVING', 'HR_REVIEW']),
  eligible: z.boolean(),
  candidate_count: z.number().int().nonnegative(),
  channel_count: z.number().int().nonnegative(),
  repeated_bottlenecks: z.array(z.object({
    label: z.string().trim().min(1).max(240),
    count: z.number().int().positive(),
  }).strict()).max(100),
  missing_conditions: z.array(z.string().trim().min(1).max(500)).max(10),
}).strict()
export type CalibrationBoundaryEvaluation = z.infer<typeof CalibrationBoundaryEvaluationSchema>

export const CalibrationAdviceContextSchema = z.object({
  calibration_policy: z.object({
    minimum_candidates: z.literal(10),
    minimum_channels: z.literal(2),
    repeated_signal_count: z.literal(2),
  }).strict(),
  candidate_summary: CalibrationCandidateSummarySchema,
  calibration_evaluation: CalibrationBoundaryEvaluationSchema,
}).strict()
export type CalibrationAdviceContext = z.infer<typeof CalibrationAdviceContextSchema>

const CalibrationTextSchema = z.string().trim().min(1).max(2_000)
const CalibrationRequirementRefsSchema = z.array(
  z.string().regex(/^R-\d{2}$/),
).max(16)
const CalibrationImpactSchema = z.enum(['NONE', 'REVIEW_REQUIRED'])

export const CalibrationAdviceSchema = z.object({
  signal_type: z.literal('RECRUITMENT_SIGNAL'),
  disposition: z.enum(['OBSERVING', 'HR_REVIEW_REQUIRED']),
  focus: z.object({
    requirement_refs: CalibrationRequirementRefsSchema,
    statement: CalibrationTextSchema,
  }).strict(),
  trigger_evaluation: z.object({
    policy: z.object({
      minimum_candidates: z.literal(10),
      minimum_channels: z.literal(2),
      repeated_signal_count: z.literal(2),
    }).strict(),
    actual: z.object({
      candidate_count: z.number().int().nonnegative(),
      channel_count: z.number().int().nonnegative(),
      repeated_signals: z.array(z.object({
        label: z.string().trim().min(1).max(240),
        count: z.number().int().positive(),
      }).strict()).max(100),
    }).strict(),
    boundary_met: z.boolean(),
    missing_conditions: z.array(CalibrationTextSchema).max(10),
  }).strict(),
  evidence_summary: z.object({
    observed_patterns: z.array(z.object({
      requirement_ref: z.string().regex(/^R-\d{2}$/),
      criterion: CalibrationTextSchema,
      statuses: CandidateEvidenceStatusCountsSchema,
      interpretation: CalibrationTextSchema,
    }).strict()).max(20),
    sample_limitations: z.array(CalibrationTextSchema).min(1).max(6),
  }).strict(),
  exclusion_checks: z.object({
    not_mentioned_separated: z.literal(true),
    sensitive_attributes_excluded: z.literal(true),
    recruitment_execution_verified: z.boolean(),
  }).strict(),
  recommendation: z.object({
    action: z.enum(['KEEP', 'REWRITE', 'RELAX', 'DELETE', 'COLLECT_MORE_EVIDENCE']),
    target_requirement_refs: CalibrationRequirementRefsSchema,
    changes: z.array(z.object({
      requirement_ref: z.string().regex(/^R-\d{2}$/),
      before: CalibrationTextSchema,
      after: CalibrationTextSchema.nullable(),
    }).strict()).max(16),
    rationale: CalibrationTextSchema,
    downstream_impact: z.object({
      role_profile: CalibrationImpactSchema,
      assessment_scorecard: CalibrationImpactSchema,
      public_jd: CalibrationImpactSchema,
      hr_recruiting_brief: CalibrationImpactSchema,
    }).strict(),
  }).strict(),
  next_check: z.object({
    owner: z.literal('HR'),
    condition: CalibrationTextSchema,
    action: z.enum(['CONTINUE_OBSERVING', 'HR_REVIEW']),
  }).strict(),
  confidence_note: CalibrationTextSchema,
  requires_hr_review: z.boolean(),
  manager_task_created: z.literal(false),
  formal_profile_changed: z.literal(false),
}).strict().superRefine((value, context) => {
  const boundaryMet = value.trigger_evaluation.boundary_met
  const shouldReview = value.disposition === 'HR_REVIEW_REQUIRED'
  if (boundaryMet !== shouldReview || value.requires_hr_review !== shouldReview) {
    context.addIssue({
      code: 'custom',
      path: ['disposition'],
      message: 'disposition、boundary_met 和 requires_hr_review 必须保持一致',
    })
  }
  if (value.next_check.action !== (shouldReview ? 'HR_REVIEW' : 'CONTINUE_OBSERVING')) {
    context.addIssue({
      code: 'custom',
      path: ['next_check', 'action'],
      message: 'next_check.action 必须与 disposition 一致',
    })
  }
  const changesProfile = ['REWRITE', 'RELAX', 'DELETE'].includes(value.recommendation.action)
  if (changesProfile !== (value.recommendation.changes.length > 0)) {
    context.addIssue({
      code: 'custom',
      path: ['recommendation', 'changes'],
      message: '画像变更动作必须包含 changes；KEEP 和 COLLECT_MORE_EVIDENCE 不得包含 changes',
    })
  }
  if (changesProfile) {
    const targetRefs = value.recommendation.target_requirement_refs
    const changeRefs = value.recommendation.changes.map((change) => change.requirement_ref)
    if (
      targetRefs.length !== changeRefs.length
      || new Set(targetRefs).size !== targetRefs.length
      || new Set(changeRefs).size !== changeRefs.length
      || targetRefs.some((ref, index) => ref !== changeRefs[index])
    ) {
      context.addIssue({
        code: 'custom',
        path: ['recommendation', 'target_requirement_refs'],
        message: '画像变更动作的 target_requirement_refs 必须与 changes 中的 requirement_ref 完全一致且不重复',
      })
    }
  }
  if (!shouldReview && !['KEEP', 'COLLECT_MORE_EVIDENCE'].includes(value.recommendation.action)) {
    context.addIssue({
      code: 'custom',
      path: ['recommendation', 'action'],
      message: 'OBSERVING 阶段不得建议改写、放宽或删除正式要求',
    })
  }
  const expectedImpact = changesProfile ? 'REVIEW_REQUIRED' : 'NONE'
  for (const [field, impact] of Object.entries(value.recommendation.downstream_impact)) {
    if (impact !== expectedImpact) {
      context.addIssue({
        code: 'custom',
        path: ['recommendation', 'downstream_impact', field],
        message: `当前动作的下游影响必须为 ${expectedImpact}`,
      })
    }
  }
  for (const [index, change] of value.recommendation.changes.entries()) {
    if (value.recommendation.action === 'DELETE' && change.after !== null) {
      context.addIssue({
        code: 'custom',
        path: ['recommendation', 'changes', index, 'after'],
        message: 'DELETE 的 after 必须为 null',
      })
    }
    if (value.recommendation.action !== 'DELETE' && change.after === null) {
      context.addIssue({
        code: 'custom',
        path: ['recommendation', 'changes', index, 'after'],
        message: 'REWRITE 或 RELAX 必须提供 after',
      })
    }
  }
})
export type CalibrationAdvice = z.infer<typeof CalibrationAdviceSchema>

export const AgentRunStatusSchema = z.enum([
  'QUEUED',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
])
export type AgentRunStatus = z.infer<typeof AgentRunStatusSchema>

export const AgentRunSchema = z.object({
  id: z.string(),
  role_session_id: z.string(),
  actor_user_id: z.string(),
  status: AgentRunStatusSchema,
  model_tier: z.enum(['FLASH', 'PRO']),
  task: z.string(),
  harness_session_id: z.string().nullable(),
  prompt_version: z.string(),
  model_name: z.string(),
  tool_count: z.number().int().nonnegative(),
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  started_at: z.string().datetime().nullable(),
  completed_at: z.string().datetime().nullable(),
  error_code: z.string().nullable(),
  input_message_id: z.string().nullable().default(null),
  output_message_id: z.string().nullable().default(null),
})
export type AgentRun = z.infer<typeof AgentRunSchema>

export const AgentEventTypeSchema = z.enum([
  'run.started',
  'channel.received',
  'channel.response.sent',
  'channel.response.failed',
  'agent.status',
  'message.accepted',
  'context.snapshot',
  'model.request',
  'model.response',
  'assistant.delta',
  'assistant.completed',
  'tool.started',
  'tool.completed',
  'question.ready',
  'clarification.round.opened',
  'clarification.round.completed',
  'clarification.limit.reached',
  'artifact.updated',
  'run.completed',
  'run.failed',
])
export type AgentEventType = z.infer<typeof AgentEventTypeSchema>

export const AgentEventSchema = z.object({
  id: z.string(),
  run_id: z.string(),
  sequence: z.number().int().positive(),
  type: AgentEventTypeSchema,
  payload: z.record(z.string(), z.unknown()),
  created_at: z.string().datetime(),
})
export type AgentEvent = z.infer<typeof AgentEventSchema>

export const RecruitingContextProjectionSchema = z.enum([
  'HC_APPROVAL',
  'ORGANIZATION',
  'CLARIFICATION_HISTORY',
  'RECRUITING_FUNNEL',
  'MARKET_JD_REFERENCE',
])
export type RecruitingContextProjection = z.infer<typeof RecruitingContextProjectionSchema>

export const RecruitingContextFactCategorySchema = z.enum([
  'HC_APPROVAL',
  'TEAM_MISSION',
  'TEAM_CAPABILITY',
  'HISTORICAL_CONFLICT',
  'HISTORICAL_DECISION',
  'FUNNEL_SIGNAL',
  'MARKET_REFERENCE',
])
export type RecruitingContextFactCategory = z.infer<
  typeof RecruitingContextFactCategorySchema
>

export const RecruitingContextFactSchema = z.object({
  fact_id: z.string().trim().min(1).max(240),
  category: RecruitingContextFactCategorySchema,
  statement: z.string().trim().min(1).max(4_000),
  authority: z.enum(['AUTHORITATIVE', 'CORROBORATING', 'REFERENCE']),
  confirmation_status: z.literal('UNCONFIRMED_CONTEXT'),
  data_classification: z.enum([
    'PUBLIC_REFERENCE',
    'MINIMIZED_INTERNAL',
    'HR_INTERNAL_AGGREGATE',
  ]),
  scope: z.object({
    team_id: z.string().trim().min(1).max(240).nullable(),
    role_title: z.string().trim().min(1).max(240).nullable(),
  }).strict(),
  source: z.object({
    provider: z.string().trim().min(1).max(160),
    system: z.string().trim().min(1).max(160),
    record_type: z.string().trim().min(1).max(160),
    record_id: z.string().trim().min(1).max(240),
    observed_at: z.string().trim().min(1).max(160).nullable(),
    synthetic: z.boolean(),
    verification_status: z.string().trim().min(1).max(240).nullable(),
  }).strict(),
}).strict()
export type RecruitingContextFact = z.infer<typeof RecruitingContextFactSchema>

export const RecruitingContextBundleSchema = z.object({
  purpose: z.enum(HARNESS_DOMAIN_TASKS),
  generated_at: z.string().datetime(),
  projections: z.array(RecruitingContextProjectionSchema).max(4),
  facts: z.array(RecruitingContextFactSchema).max(24),
  warnings: z.array(z.string().trim().min(1).max(1_000)).max(8),
  usage_policy: z.object({
    may_support_clarification: z.literal(true),
    may_guide_draft_style: z.literal(true),
    may_become_role_fact_without_human_confirmation: z.literal(false),
  }).strict(),
}).strict()
export type RecruitingContextBundle = z.infer<typeof RecruitingContextBundleSchema>

export interface AgentContextSnapshot {
  system_prompt: {
    section_name: string
    content: string
    provenance: 'HARNESS_SYSTEM_PROMPT'
    harness_managed_base: {
      included: boolean
      captured_as_text: boolean
      description: string
    }
  }
  current_user_input: {
    content: unknown
    source: 'CURRENT_REQUEST'
  }
  short_term_memory: {
    source: 'RECENT_CONVERSATION'
    window_size: number
    messages: unknown[]
  }
  long_term_memory: {
    source: 'BUSINESS_DATABASE'
    role_state: unknown
    recruiting_context?: RecruitingContextBundle
  }
  task_state: Record<string, unknown>
}

export const ConversationMessageStatusSchema = z.enum([
  'PENDING',
  'STREAMING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
])
export type ConversationMessageStatus = z.infer<typeof ConversationMessageStatusSchema>

export const ConversationMessageSchema = z.object({
  id: z.string(),
  tenant_id: z.string(),
  role_session_id: z.string(),
  conversation_user_id: z.string().nullable(),
  run_id: z.string().nullable(),
  clarification_round_id: z.string().nullable(),
  sender_type: z.enum(['HUMAN', 'AGENT', 'SYSTEM']),
  sender_user_id: z.string().nullable(),
  sender_role: ActorRoleSchema.nullable(),
  sender_name: z.string().min(1),
  content: z.string(),
  structured_content: z.record(z.string(), z.unknown()).nullable(),
  status: ConversationMessageStatusSchema,
  sequence: z.number().int().positive(),
  created_at: z.string().datetime(),
  completed_at: z.string().datetime().nullable(),
})
export type ConversationMessage = z.infer<typeof ConversationMessageSchema>

export const ClarificationPolicySchema = z.object({
  role_session_id: z.string(),
  initial_budget: z.number().int().positive(),
  granted_rounds: z.number().int().nonnegative(),
  extension_size: z.number().int().positive(),
  completed_rounds: z.number().int().nonnegative(),
  opened_rounds: z.number().int().nonnegative(),
  open_round_id: z.string().nullable(),
  status: z.enum(['ACTIVE', 'LIMIT_REACHED']),
  updated_by: z.string().nullable(),
  updated_at: z.string().datetime(),
})
export type ClarificationPolicy = z.infer<typeof ClarificationPolicySchema>

export const ClarificationRoundSchema = z.object({
  id: z.string(),
  role_session_id: z.string(),
  ordinal: z.number().int().positive(),
  status: z.enum(['OPEN', 'COMPLETED', 'ABANDONED']),
  question: z.string().min(1),
  opened_by_run_id: z.string(),
  resolved_by_message_id: z.string().nullable(),
  created_at: z.string().datetime(),
  completed_at: z.string().datetime().nullable(),
})
export type ClarificationRound = z.infer<typeof ClarificationRoundSchema>

export const ProfileReviewAdviceSchema = z.object({
  recommendation: z.enum(['APPROVE', 'REQUEST_CHANGES']),
  summary: z.string().trim().min(1).max(2_000),
  checks: z.array(z.object({
    label: z.string().trim().min(1).max(160),
    status: z.enum(['PASS', 'WARNING']),
    detail: z.string().trim().min(1).max(1_000),
  }).strict()).min(1).max(12),
  concerns: z.array(z.string().trim().min(1).max(1_000)).max(12),
  generated_at: z.string().datetime(),
}).strict()
export type ProfileReviewAdvice = z.infer<typeof ProfileReviewAdviceSchema>

export const ProfileReviewSchema = z.object({
  status: z.enum(['NOT_SUBMITTED', 'PENDING', 'APPROVED', 'CHANGES_REQUESTED']),
  artifact_id: z.string().nullable(),
  artifact_version: z.number().int().positive().nullable(),
  submitted_by: z.string().nullable(),
  submitted_by_name: z.string().nullable(),
  submitted_at: z.string().datetime().nullable(),
  reviewed_by: z.string().nullable(),
  reviewed_at: z.string().datetime().nullable(),
  review_comment: z.string().nullable(),
  agent_advice: ProfileReviewAdviceSchema.nullable(),
}).strict()
export type ProfileReview = z.infer<typeof ProfileReviewSchema>

export const RoleStateSchema = z.object({
  id: z.string(),
  tenant_id: z.string(),
  title: z.string(),
  department: z.string(),
  stage: RoleSessionStageSchema,
  revision: z.number().int().nonnegative(),
  hc_status: z.enum(['PENDING', 'APPROVED', 'REJECTED']),
  hc_approval: HCApprovalSchema.optional(),
  facts: z.array(FactSchema),
  conflicts: z.array(ConflictSchema),
  public_job_basics: PublicJobBasicsSchema.optional(),
  hr_recruiting_context: HRRecruitingContextSchema.optional(),
  profile_review: ProfileReviewSchema.optional(),
  latest_artifacts: z.partialRecord(
    ArtifactTypeSchema,
    z.object({
      id: z.string(),
      version: z.number().int().positive(),
      status: ArtifactStatusSchema,
      content_hash: z.string(),
      content: z.unknown(),
    }),
  ),
  candidate_count: z.number().int().nonnegative(),
  candidate_channels: z.array(z.string()),
  calibration_status: CalibrationStatusSchema,
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
})
export type RoleState = z.infer<typeof RoleStateSchema>

export const ToolExecutionContextSchema = z.object({
  tenant_id: z.string(),
  actor_user_id: z.string(),
  actor_role: ActorRoleSchema,
  role_session_id: z.string(),
  agent_run_id: z.string(),
  trace_id: z.string(),
})
export type ToolExecutionContext = z.infer<typeof ToolExecutionContextSchema>

export const AgentRouterActionSchema = z.enum(['RESPOND', 'ASK', 'HANDOFF'])
export type AgentRouterAction = z.infer<typeof AgentRouterActionSchema>

export const RouterHandoffTaskSchema = z.enum(ROUTER_HANDOFF_TASKS)

export const AgentRouteRequestSchema = z.object({
  message: z.string().min(1).max(8_000),
  role_state: RoleStateSchema,
  conversation_context: z.object({
    current_user_role: ActorRoleSchema,
    open_clarification: z.object({
      ordinal: z.number().int().positive(),
      question: z.string().min(1),
    }).nullable(),
    recent_messages: z.array(z.object({
      sender_type: z.enum(['HUMAN', 'AGENT']),
      sender_role: ActorRoleSchema.nullable(),
      content: z.string(),
    })).max(12),
  }),
})
export type AgentRouteRequest = z.infer<typeof AgentRouteRequestSchema>

const SimpleRouterHandoffTaskSchema = z.enum([
  'CLARIFY_MESSAGE',
  'GENERATE_ROLE_PROFILE',
  'GENERATE_ASSESSMENT',
  'GENERATE_JD',
  'GENERATE_HR_BRIEF',
  'CALIBRATION_ADVICE',
])

export const AgentRouteResultSchema = z.union([
  z.object({
    action: z.literal('RESPOND'),
    answer: z.string().min(1),
  }).strict(),
  z.object({
    action: z.literal('ASK'),
    question: z.string().min(1),
  }).strict(),
  z.object({
    action: z.literal('HANDOFF'),
    task: SimpleRouterHandoffTaskSchema,
  }).strict(),
  z.object({
    action: z.literal('HANDOFF'),
    task: z.literal('VERSION_COMPARISON'),
    artifact_type: ArtifactTypeSchema,
    from_version: z.number().int().positive(),
    to_version: z.number().int().positive(),
  }).strict(),
])
export type AgentRouteResult = z.infer<typeof AgentRouteResultSchema>

export const LoginRequestSchema = z.object({
  workspace_id: z
    .string()
    .trim()
    .min(3)
    .max(64)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, '企业空间 ID 只能包含字母、数字、点、下划线和连字符'),
  account_id: z
    .string()
    .trim()
    .min(3)
    .max(80)
    .regex(/^[A-Za-z0-9][A-Za-z0-9@._-]*$/, '账号只能包含字母、数字、@、点、下划线和连字符'),
  display_name: z.string().trim().min(1).max(40),
  role: ActorRoleSchema,
})
export const MessageRequestSchema = z.object({
  content: z.string().trim().min(1).max(8_000),
  expected_revision: z.number().int().nonnegative().optional(),
})

export const ClarificationExtendRequestSchema = z.object({
  reason: z.string().trim().min(3).max(2_000),
})
export const CreateRoleSessionSchema = z.object({
  title: z.string().trim().min(1).max(120),
  department: z.string().trim().min(1).max(120),
})
export const CandidateImportSchema = z.object({
  candidates: z.array(
    z.object({
      candidate_ref: z.string().regex(/^CAND-[A-Z0-9-]{3,40}$/),
      channel: z.string().trim().min(1).max(80),
      format: z.enum(['JSON', 'TEXT']),
      content: z.union([z.string().max(30_000), z.record(z.string(), z.unknown())]),
    }).strict(),
  ).min(1).max(100),
}).strict().superRefine((value, context) => {
  const refs = new Set<string>()
  for (const [index, candidate] of value.candidates.entries()) {
    if (refs.has(candidate.candidate_ref)) {
      context.addIssue({
        code: 'custom',
        path: ['candidates', index, 'candidate_ref'],
        message: `同一批次的 candidate_ref 不得重复：${candidate.candidate_ref}`,
      })
    }
    refs.add(candidate.candidate_ref)
  }
})

export const HumanDecisionSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
  reason: z.string().trim().min(3).max(2_000),
  expected_revision: z.number().int().nonnegative(),
})

export const ARTIFACT_VISIBILITY: Record<ArtifactType, 'ALL' | 'HR_ONLY'> = {
  ROLE_PROFILE: 'ALL',
  ASSESSMENT_SCORECARD: 'ALL',
  PUBLIC_JD: 'ALL',
  HR_RECRUITING_BRIEF: 'HR_ONLY',
}

export const CALIBRATION_BOUNDARY = {
  minimumCandidates: 10,
  minimumChannels: 2,
  repeatedBottleneckCount: 2,
} as const
