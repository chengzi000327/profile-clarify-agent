import {
  FACT_CATEGORIES,
  ROLE_CLARIFIER_PROMPT_VERSION,
  ROLE_CLARIFIER_SYSTEM_PROMPT,
  promptForTask,
  taskPromptForTask,
  type FactCategory,
} from '@role-clarifier/agent-spec'
import { z } from 'zod'

export {
  ROLE_CLARIFIER_PROMPT_VERSION,
  ROLE_CLARIFIER_SYSTEM_PROMPT,
  promptForTask,
  taskPromptForTask,
  type FactCategory,
}

export const ActorRoleSchema = z.enum(['MANAGER', 'HR', 'ADMIN'])
export type ActorRole = z.infer<typeof ActorRoleSchema>

export const AdminTestRoleSchema = z.enum(['MANAGER', 'HR'])
export type AdminTestRole = z.infer<typeof AdminTestRoleSchema>

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
  source_message_id: z.string().nullable().default(null),
  source_run_id: z.string().nullable().default(null),
  proposed_by_user_id: z.string().nullable().default(null),
  confirmed_by_user_id: z.string().nullable().default(null),
  confirmed_at: z.string().datetime().nullable().default(null),
  supersedes_fact_id: z.string().nullable().default(null),
  decision_reason: z.string().nullable().default(null),
})
export type Fact = z.infer<typeof FactSchema>

export const FactDecisionRequestSchema = z.discriminatedUnion('decision', [
  z.object({
    decision: z.literal('CONFIRM'),
    expected_revision: z.number().int().nonnegative(),
    test_role: AdminTestRoleSchema.optional(),
  }).strict(),
  z.object({
    decision: z.literal('REJECT'),
    expected_revision: z.number().int().nonnegative(),
    reason: z.string().trim().min(3).max(500).optional(),
    test_role: AdminTestRoleSchema.optional(),
  }).strict(),
  z.object({
    decision: z.literal('REVISE'),
    expected_revision: z.number().int().nonnegative(),
    reason: z.string().trim().min(3).max(500).optional(),
    replacement: z.object({
      category: FactCategorySchema,
      statement: z.string().trim().min(1).max(2_000),
    }).strict(),
    test_role: AdminTestRoleSchema.optional(),
  }).strict(),
])
export type FactDecisionRequest = z.infer<typeof FactDecisionRequestSchema>

export const EnterpriseKnowledgeCategorySchema = z.enum([
  'ORGANIZATION',
  'JOB_FAMILY',
  'LEVEL_FRAMEWORK',
  'HISTORICAL_JD',
  'ROLE_PROFILE_CASE',
  'RECRUITING_POLICY',
  'INTERVIEW_STANDARD',
])
export type EnterpriseKnowledgeCategory = z.infer<typeof EnterpriseKnowledgeCategorySchema>

export const EnterpriseKnowledgeItemSchema = z.object({
  id: z.string().min(1),
  tenant_id: z.string().min(1),
  category: EnterpriseKnowledgeCategorySchema,
  title: z.string().min(1),
  content: z.string().min(1),
  summary: z.string().min(1),
  department: z.string().nullable(),
  job_family: z.string().nullable(),
  tags: z.array(z.string().min(1)),
  visible_to: z.enum(['ALL_ROLE_MEMBERS', 'HR_ONLY', 'ADMIN_ONLY']),
  source_ref: z.string().min(1),
  source_version: z.string().min(1),
  status: z.enum(['ACTIVE', 'ARCHIVED']),
  valid_from: z.string().datetime(),
  valid_to: z.string().datetime().nullable(),
  updated_at: z.string().datetime(),
})
export type EnterpriseKnowledgeItem = z.infer<typeof EnterpriseKnowledgeItemSchema>

export const EnterpriseContextHitSchema = z.object({
  knowledge_id: z.string().min(1),
  category: EnterpriseKnowledgeCategorySchema,
  title: z.string().min(1),
  summary: z.string().min(1),
  source_ref: z.string().min(1),
  source_version: z.string().min(1),
  relevance_score: z.number().nonnegative(),
  match_reasons: z.array(z.string().min(1)).min(1),
})
export type EnterpriseContextHit = z.infer<typeof EnterpriseContextHitSchema>

export const EnterpriseContextBundleSchema = z.object({
  query: z.object({
    role_session_id: z.string().uuid(),
    task: z.enum([
      'CLARIFY_MESSAGE',
      'GENERATE_ROLE_PROFILE',
      'GENERATE_ASSESSMENT',
      'GENERATE_JD',
      'GENERATE_HR_BRIEF',
      'EXTRACT_CANDIDATES',
      'CALIBRATION_ADVICE',
    ]),
    department: z.string().min(1),
    job_family: z.string().nullable(),
    query_terms: z.array(z.string().min(2).max(24)).max(20),
  }),
  hits: z.array(EnterpriseContextHitSchema).max(6),
  truncated: z.boolean(),
})
export type EnterpriseContextBundle = z.infer<typeof EnterpriseContextBundleSchema>

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

export const JobHeaderSchema = z.object({
  title: z.string().min(1),
  location: z.string().min(1),
  employment_type: z.string().min(1),
  reporting_line: z.string().min(1),
})
export type JobHeader = z.infer<typeof JobHeaderSchema>

export const JobBasicsSchema = z.object({
  recruitment_type: z.enum([
    'NEW_HEADCOUNT',
    'REPLACEMENT',
    'ATTRITION_REPLACEMENT',
    'PERFORMANCE_REPLACEMENT',
    'ORGANIZATION_ADJUSTMENT',
    'OTHER',
  ]),
  headcount: z.number().int().positive(),
  level: z.string().min(1),
  reporting_line: z.string().min(1),
  locations: z.array(z.string().min(1)).min(1),
  employment_type: z.string().min(1),
  salary_range: z.string().min(1),
  target_onboard: z.string().min(1),
})
export type JobBasics = z.infer<typeof JobBasicsSchema>

export const HcContextSchema = z.object({
  request_id: z.string().min(1),
  status: z.literal('APPROVED'),
  approved_at: z.string().datetime(),
  business_change: z.string().min(1),
  organization_gap: z.string().min(1),
  approved_reason: z.string().min(1),
  initial_responsibilities: z.array(z.string().min(1)).min(1),
  recruiting_budget: z.string().min(1),
  recruiting_constraints: z.array(z.string().min(1)).default([]),
  hiring_manager_user_id: z.string().min(1),
  assigned_hr_user_id: z.string().min(1).nullable(),
  job_basics: JobBasicsSchema,
})
export type HcContext = z.infer<typeof HcContextSchema>

export const RoleClarificationTaskSummarySchema = z.object({
  id: z.string().min(1),
  status: z.enum(['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']),
  assignee_user_id: z.string().min(1),
  started_at: z.string().datetime().nullable(),
  completed_at: z.string().datetime().nullable(),
})
export type RoleClarificationTaskSummary = z.infer<typeof RoleClarificationTaskSummarySchema>

export const NotificationDeliverySummarySchema = z.object({
  channel: z.literal('FEISHU'),
  status: z.enum(['PENDING', 'PROCESSING', 'SENT', 'RETRY', 'UNBOUND', 'DEAD']),
  sent_at: z.string().datetime().nullable(),
  last_error_code: z.string().nullable(),
})
export type NotificationDeliverySummary = z.infer<typeof NotificationDeliverySummarySchema>

export const HcApprovalSchema = z.object({
  request_id: z.string().min(1),
  tenant_id: z.string().min(1),
  title: z.string().min(1),
  department: z.string().min(1),
  status: z.literal('APPROVED'),
  context: HcContextSchema,
  role_session_id: z.string().uuid().nullable(),
  clarification_status: z.enum(['NOT_STARTED', 'IN_PROGRESS', 'PROFILE_READY']).optional(),
  role_stage: RoleSessionStageSchema.nullable().optional(),
  clarification_task: RoleClarificationTaskSummarySchema.nullable().default(null),
  notification_delivery: NotificationDeliverySummarySchema.nullable().default(null),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
})
export type HcApproval = z.infer<typeof HcApprovalSchema>

const ArtifactTextSchema = z.string().trim().min(1).max(4_000)
const ArtifactEvidenceRefsSchema = z.array(z.string().trim().min(1).max(120)).max(20).default([])

export const RoleProfileContentSchema = z
  .object({
    hiring_reason: z
      .object({
        conclusion: ArtifactTextSchema,
        business_change: ArtifactTextSchema,
        organization_gap: ArtifactTextSchema,
        no_hire_impact: ArtifactTextSchema,
        evidence_refs: ArtifactEvidenceRefsSchema,
      })
      .strict(),
    mission: ArtifactTextSchema,
    success_outcomes: z.array(z
      .object({
        id: z.string().trim().min(1).max(40),
        horizon: z.string().trim().min(1).max(80),
        title: z.string().trim().min(1).max(200),
        definition: ArtifactTextSchema,
        measures: z.array(ArtifactTextSchema).min(1).max(8),
        status: z.string().trim().min(1).max(80),
        evidence_refs: ArtifactEvidenceRefsSchema,
      })
      .strict()).min(1).max(6),
    work_scenarios: z.array(z
      .object({
        id: z.string().trim().min(1).max(40),
        title: z.string().trim().min(1).max(200),
        frequency: z.string().trim().min(1).max(120),
        trigger: ArtifactTextSchema,
        actions: ArtifactTextSchema,
        output: ArtifactTextSchema,
        challenge: ArtifactTextSchema,
        stakeholders: ArtifactTextSchema,
        outcome_refs: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
        evidence_refs: ArtifactEvidenceRefsSchema,
      })
      .strict()).min(1).max(8),
    requirements: z.array(z
      .object({
        id: z.string().trim().min(1).max(40),
        priority: z.enum(['Must-have', 'Preferred']),
        name: z.string().trim().min(1).max(200),
        level: z.string().trim().min(1).max(120),
        rationale: ArtifactTextSchema,
        maps_to: z.array(z.string().trim().min(1).max(40)).min(1).max(12),
        strong_evidence: z.array(ArtifactTextSchema).min(1).max(8),
        substitute_evidence: z.array(ArtifactTextSchema).max(8).default([]),
        risk_signals: z.array(ArtifactTextSchema).max(8).default([]),
        assessment_method: ArtifactTextSchema,
        evidence_refs: ArtifactEvidenceRefsSchema,
      })
      .strict()).min(1).max(12),
    boundaries: z
      .object({
        owns: z.array(ArtifactTextSchema).min(1).max(12),
        does_not_own: z.array(ArtifactTextSchema).min(1).max(12),
        decision_rights: ArtifactTextSchema,
        collaboration_and_resources: ArtifactTextSchema,
        evidence_refs: ArtifactEvidenceRefsSchema,
      })
      .strict(),
  })
  .strict()
export type RoleProfileContent = z.infer<typeof RoleProfileContentSchema>

export const AssessmentScorecardSchema = z
  .object({
    dimensions: z.array(z
      .object({
        id: z.string().trim().min(1).max(40),
        name: z.string().trim().min(1).max(200),
        weight: z.number().min(0).max(100),
        method: ArtifactTextSchema,
        owner: ArtifactTextSchema,
        question: ArtifactTextSchema,
        evidence: ArtifactTextSchema,
        anchors: z
          .object({
            1: ArtifactTextSchema,
            3: ArtifactTextSchema,
            5: ArtifactTextSchema,
          })
          .strict(),
      })
      .strict()).min(1).max(12),
    decision_rule: z
      .object({
        status: z.string().trim().min(1).max(120),
        summary: ArtifactTextSchema,
        scoring: ArtifactTextSchema,
        pass_thresholds: ArtifactTextSchema,
        calibration: ArtifactTextSchema,
      })
      .strict(),
  })
  .strict()
  .refine(
    (value) => Math.abs(value.dimensions.reduce((sum, item) => sum + item.weight, 0) - 100) < 0.001,
    { message: '评估维度权重之和必须等于 100', path: ['dimensions'] },
  )
export type AssessmentScorecard = z.infer<typeof AssessmentScorecardSchema>

export const PublicJDSchema = z
  .object({
    title_and_basics: JobHeaderSchema,
    about_the_role: z.string().min(1),
    what_you_will_do: z.array(z.string().min(1)).min(1).max(8),
    what_we_look_for: z.array(z.string().min(1)).min(1).max(8),
  })
  .strict()
export type PublicJD = z.infer<typeof PublicJDSchema>

export const ArtifactTypeSchema = z.enum([
  'ROLE_PROFILE',
  'ASSESSMENT_SCORECARD',
  'PUBLIC_JD',
  'HR_RECRUITING_BRIEF',
])
export type ArtifactType = z.infer<typeof ArtifactTypeSchema>

export const generatedArtifactContentSchema = (
  type: ArtifactType,
): typeof RoleProfileContentSchema | typeof AssessmentScorecardSchema | typeof PublicJDSchema | null => {
  if (type === 'ROLE_PROFILE') return RoleProfileContentSchema
  if (type === 'ASSESSMENT_SCORECARD') return AssessmentScorecardSchema
  if (type === 'PUBLIC_JD') return PublicJDSchema
  return null
}

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

export const CandidateEvidenceSchema = z.object({
  candidate_ref: z.string().regex(/^CAND-[A-Z0-9-]{3,40}$/),
  channel: z.string().min(1),
  source_format: z.enum(['JSON', 'TEXT']),
  evidence: z.array(
    z.object({
      criterion: z.string().min(1),
      signal: z.enum(['STRONG', 'MIXED', 'WEAK', 'MISSING']),
      excerpt: z.string().max(500),
    }),
  ),
  bottlenecks: z.array(z.string()).default([]),
})
export type CandidateEvidence = z.infer<typeof CandidateEvidenceSchema>

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
  effective_actor_role: ActorRoleSchema,
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
  'agent.status',
  'message.accepted',
  'context.snapshot',
  'context.retrieval_failed',
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

export const AgentContextSnapshotSchema = z.object({
  system_prompt: z.object({
    section_name: z.string().min(1),
    content: z.string(),
    provenance: z.literal('HARNESS_SYSTEM_PROMPT'),
    harness_managed_base: z.object({
      included: z.boolean(),
      captured_as_text: z.boolean(),
      description: z.string(),
    }),
  }),
  current_user_input: z.object({
    content: z.unknown(),
    source: z.literal('CURRENT_REQUEST'),
  }),
  short_term_memory: z.object({
    source: z.literal('RECENT_CONVERSATION'),
    window_size: z.number().int().nonnegative(),
    messages: z.array(z.unknown()),
  }),
  long_term_memory: z.object({
    source: z.literal('BUSINESS_DATABASE'),
    role_state: z.unknown(),
    enterprise_context: EnterpriseContextBundleSchema.nullable().default(null),
  }),
  task_state: z.record(z.string(), z.unknown()),
})
export type AgentContextSnapshot = z.infer<typeof AgentContextSnapshotSchema>

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

export const RoleStateSchema = z.object({
  id: z.string(),
  tenant_id: z.string(),
  title: z.string(),
  department: z.string(),
  stage: RoleSessionStageSchema,
  revision: z.number().int().nonnegative(),
  hc_status: z.enum(['PENDING', 'APPROVED', 'REJECTED']),
  hc_context: HcContextSchema.nullable(),
  facts: z.array(FactSchema),
  conflicts: z.array(ConflictSchema),
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
  test_role: AdminTestRoleSchema.optional(),
})

export const ArtifactGenerateRequestSchema = z.object({
  test_role: AdminTestRoleSchema.optional(),
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
      channel: z.string().min(1).max(80),
      format: z.enum(['JSON', 'TEXT']),
      content: z.union([z.string().max(30_000), z.record(z.string(), z.unknown())]),
    }),
  ).min(1).max(100),
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
