import {
  ArtifactTypeSchema,
  CandidateEvidenceSchema,
  EnterpriseContextBundleSchema,
  FactCategorySchema,
  RoleStateSchema,
  ToolExecutionContextSchema,
} from '@role-clarifier/contracts'
import { z } from 'zod'

export const HarnessTaskSchema = z.enum([
  'CLARIFY_MESSAGE',
  'GENERATE_ROLE_PROFILE',
  'GENERATE_ASSESSMENT',
  'GENERATE_JD',
  'GENERATE_HR_BRIEF',
  'EXTRACT_CANDIDATES',
  'CALIBRATION_ADVICE',
])

const CandidateImportItemSchema = z.object({
  candidate_ref: z.string().regex(/^CAND-[A-Z0-9-]{3,40}$/),
  channel: z.string().min(1).max(80),
  format: z.enum(['JSON', 'TEXT']),
  content: z.union([z.string(), z.record(z.string(), z.unknown())]),
})

export const HarnessRequestSchema = z.object({
  task: HarnessTaskSchema,
  role_state: RoleStateSchema,
  enterprise_context: EnterpriseContextBundleSchema,
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
  execution_context: ToolExecutionContextSchema,
  maximum_transitions: z.literal(10),
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
    persistence: ToolPersistenceSchema,
    artifact_type: ArtifactTypeSchema,
    content: z.unknown(),
    summary: ResultSummarySchema,
  }),
  z.object({
    kind: z.literal('CANDIDATE_EVIDENCE'),
    persistence: ToolPersistenceSchema,
    candidates: z.array(CandidateEvidenceSchema).min(1),
    summary: ResultSummarySchema,
  }),
  z.object({
    kind: z.literal('CALIBRATION_ADVICE'),
    persistence: ToolPersistenceSchema,
    summary: ResultSummarySchema,
    proposed_change: z.record(z.string(), z.unknown()),
  }),
])

export type HarnessTask = z.infer<typeof HarnessTaskSchema>
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
  if (task === 'CLARIFY_MESSAGE') return 'save_fact_draft'
  if (task === 'EXTRACT_CANDIDATES') return 'save_candidate_evidence'
  if (task === 'CALIBRATION_ADVICE') return 'propose_calibration_signal'
  return 'save_artifact_draft'
}

export const visibleResultText = (result: HarnessResult): string =>
  result.kind === 'CLARIFICATION' || result.kind === 'CONVERSATION'
    ? result.answer
    : result.summary
