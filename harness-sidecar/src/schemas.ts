import {
  AssessmentScorecardSchema,
  ArtifactTypeSchema,
  CalibrationAdviceContextSchema,
  CalibrationAdviceSchema,
  CandidateEvidenceFailureSchema,
  CandidateEvidenceSchema,
  FactCategorySchema,
  HARNESS_DOMAIN_TASKS,
  HRRecruitingBriefSchema,
  PublicJDSchema,
  RecruitingContextBundleSchema,
  RoleProfileSchema,
  RoleStateSchema,
  ToolExecutionContextSchema,
  type HarnessDomainTask,
} from '@role-clarifier/contracts'
import { z } from 'zod'

export const HarnessTaskSchema = z.enum(HARNESS_DOMAIN_TASKS)

const CandidateImportItemSchema = z.object({
  candidate_ref: z.string().regex(/^CAND-[A-Z0-9-]{3,40}$/),
  channel: z.string().min(1).max(80),
  format: z.enum(['JSON', 'TEXT']),
  content: z.union([z.string(), z.record(z.string(), z.unknown())]),
}).strict()

export const HarnessRequestSchema = z.object({
  task: HarnessTaskSchema,
  role_state: RoleStateSchema,
  message: z.string().optional(),
  conversation_context: z.object({
    current_user_role: z.enum(['MANAGER', 'HR', 'ADMIN']),
    open_clarification: z.object({
      ordinal: z.number().int().positive(),
      question: z.string().min(1),
    }).nullable(),
    recent_messages: z.array(z.object({
      sender_type: z.enum(['HUMAN', 'AGENT']),
      sender_role: z.enum(['MANAGER', 'HR', 'ADMIN']).nullable(),
      content: z.string(),
    })).max(12),
  }).optional(),
  candidates: z.array(CandidateImportItemSchema).optional(),
  calibration_context: CalibrationAdviceContextSchema.optional(),
  recruiting_context: RecruitingContextBundleSchema.optional(),
  version_comparison: z.object({
    artifact_type: ArtifactTypeSchema,
    from_version: z.number().int().positive(),
    to_version: z.number().int().positive(),
  }).optional(),
  execution_context: ToolExecutionContextSchema,
  maximum_transitions: z.number().int().min(0).max(10),
  structured_output_repair_attempts: z.literal(1),
})

const ToolPersistenceSchema = z.literal('TOOL')
const ResultSummarySchema = z.preprocess(
  (value) => typeof value === 'string' && value.trim().length > 0
    ? value
    : 'Agent 已完成领域工具调用，草稿已保存。',
  z.string(),
)

export const HarnessResultSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('CONVERSATION'),
    persistence: z.literal('NONE'),
    answer: z.string().min(1),
  }),
  z.object({
    kind: z.literal('CLARIFICATION'),
    persistence: ToolPersistenceSchema,
    answer: z.string().min(1),
    question: z.string().min(1),
    role_identity: z.object({
      title: z.string().min(1).max(120).optional(),
      department: z.string().min(1).max(120).optional(),
    }).refine((value) => Boolean(value.title || value.department)).optional(),
    fact_draft: z.object({
      category: FactCategorySchema,
      statement: z.string().min(1),
    }),
  }),
  z.object({
    kind: z.literal('ARTIFACT'),
    persistence: z.enum(['CALLER', 'TOOL']),
    artifact_type: ArtifactTypeSchema,
    content: z.unknown(),
    summary: ResultSummarySchema,
  }).superRefine((value, context) => {
    if (value.artifact_type === 'ROLE_PROFILE') {
      if (value.persistence !== 'CALLER') {
        context.addIssue({
          code: 'custom',
          path: ['persistence'],
          message: 'ROLE_PROFILE must use CALLER persistence',
        })
      }
      const parsed = RoleProfileSchema.safeParse(value.content)
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          context.addIssue({
            code: 'custom',
            path: ['content', ...issue.path],
            message: issue.message,
          })
        }
      }
    } else if (value.artifact_type === 'ASSESSMENT_SCORECARD') {
      if (value.persistence !== 'CALLER') {
        context.addIssue({
          code: 'custom',
          path: ['persistence'],
          message: 'ASSESSMENT_SCORECARD must use CALLER persistence',
        })
      }
      const parsed = AssessmentScorecardSchema.safeParse(value.content)
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          context.addIssue({
            code: 'custom',
            path: ['content', ...issue.path],
            message: issue.message,
          })
        }
      }
    } else if (value.artifact_type === 'PUBLIC_JD') {
      if (value.persistence !== 'CALLER') {
        context.addIssue({
          code: 'custom',
          path: ['persistence'],
          message: 'PUBLIC_JD must use CALLER persistence',
        })
      }
      const parsed = PublicJDSchema.safeParse(value.content)
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          context.addIssue({
            code: 'custom',
            path: ['content', ...issue.path],
            message: issue.message,
          })
        }
      }
    } else if (value.artifact_type === 'HR_RECRUITING_BRIEF') {
      if (value.persistence !== 'CALLER') {
        context.addIssue({
          code: 'custom',
          path: ['persistence'],
          message: 'HR_RECRUITING_BRIEF must use CALLER persistence',
        })
      }
      const parsed = HRRecruitingBriefSchema.safeParse(value.content)
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          context.addIssue({
            code: 'custom',
            path: ['content', ...issue.path],
            message: issue.message,
          })
        }
      }
    } else if (value.persistence !== 'TOOL') {
      context.addIssue({
        code: 'custom',
        path: ['persistence'],
        message: `${value.artifact_type} must use TOOL persistence`,
      })
    }
  }),
  z.object({
    kind: z.literal('CANDIDATE_EVIDENCE'),
    persistence: z.literal('CALLER'),
    candidates: z.array(CandidateEvidenceSchema).max(100),
    failed_candidates: z.array(CandidateEvidenceFailureSchema).max(100),
    summary: ResultSummarySchema,
  }).superRefine((value, context) => {
    if (value.candidates.length + value.failed_candidates.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['candidates'],
        message: '候选人证据结果不能为空',
      })
    }
    const refs = new Set<string>()
    for (const [index, candidate] of value.candidates.entries()) {
      if (refs.has(candidate.candidate_ref)) {
        context.addIssue({
          code: 'custom',
          path: ['candidates', index, 'candidate_ref'],
          message: `candidate_ref 重复：${candidate.candidate_ref}`,
        })
      }
      refs.add(candidate.candidate_ref)
    }
    for (const [index, failure] of value.failed_candidates.entries()) {
      if (refs.has(failure.candidate_ref)) {
        context.addIssue({
          code: 'custom',
          path: ['failed_candidates', index, 'candidate_ref'],
          message: `candidate_ref 重复或同时出现在成功与失败数组：${failure.candidate_ref}`,
        })
      }
      refs.add(failure.candidate_ref)
    }
  }),
  z.object({
    kind: z.literal('CALIBRATION_ADVICE'),
    persistence: z.literal('CALLER'),
    summary: ResultSummarySchema,
    advice: CalibrationAdviceSchema,
  }),
  z.object({
    kind: z.literal('VERSION_COMPARISON'),
    persistence: z.literal('NONE'),
    summary: z.string().min(1),
    artifact_type: ArtifactTypeSchema,
    from_version: z.number().int().positive(),
    to_version: z.number().int().positive(),
  }),
])

export type HarnessTask = HarnessDomainTask
export type HarnessRequest = z.infer<typeof HarnessRequestSchema>
export type HarnessResult = z.infer<typeof HarnessResultSchema>

export const parseHarnessResult = (text: string): HarnessResult => {
  const withoutFence = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
  const start = withoutFence.indexOf('{')
  const end = withoutFence.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('Model response did not contain a JSON object')
  return HarnessResultSchema.parse(JSON.parse(withoutFence.slice(start, end + 1)))
}

export const requiredSaveTool = (task: HarnessTask): string => {
  if (
    task === 'GENERATE_ROLE_PROFILE'
    || task === 'GENERATE_ASSESSMENT'
    || task === 'GENERATE_JD'
    || task === 'GENERATE_HR_BRIEF'
    || task === 'EXTRACT_CANDIDATES'
    || task === 'CALIBRATION_ADVICE'
  ) {
    throw new Error(`${task} is persisted by the caller and has no save tool`)
  }
  if (task === 'CLARIFY_MESSAGE') return 'save_fact_draft'
  if (task === 'VERSION_COMPARISON') return 'read_version_diff'
  return 'save_artifact_draft'
}

export const visibleResultText = (result: HarnessResult): string =>
  result.kind === 'CLARIFICATION' || result.kind === 'CONVERSATION'
    ? result.answer
    : result.summary
