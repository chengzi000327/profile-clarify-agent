import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import { defineTool, type JsonValue } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { FACT_CATEGORIES, ROLE_CLARIFIER_SYSTEM_PROMPT } from '@role-clarifier/agent-spec'

export interface Config {
  apiBaseUrl?: string
  toolToken?: string
  timeoutMs?: number
}

export const inject = ['tools', 'systemPrompt'] as const

const allowedToolNames = [
  'read_role_state',
  'update_role_identity_draft',
  'save_fact_draft',
  'save_artifact_draft',
  'save_candidate_evidence',
  'propose_calibration_signal',
  'read_version_diff',
] as const

export const ROLE_CLARIFIER_TOOL_ALLOWLIST = new Set<string>(allowedToolNames)

const toolOutput = {
  schema: { type: 'json' as const },
  render: (_args: unknown, value: unknown) => [
    {
      type: 'text' as const,
      text: typeof value === 'string' ? value : JSON.stringify(value),
    },
  ],
}

const callBusinessTool = async (
  config: Required<Config>,
  name: string,
  args: unknown,
  signal: AbortSignal,
  harnessSessionId: string,
): Promise<JsonValue> => {
  if (!ROLE_CLARIFIER_TOOL_ALLOWLIST.has(name)) throw new Error('Tool is not allowlisted')
  if (!config.toolToken) throw new Error('ROLE_AGENT_TOOL_TOKEN is required')
  const response = await fetch(`${config.apiBaseUrl}/internal/v1/harness/tools/${name}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${config.toolToken}`,
      'x-harness-session-id': harnessSessionId,
    },
    body: JSON.stringify(args),
    signal,
  })
  if (!response.ok) {
    const message = await response.text()
    throw new Error(`Business tool ${name} failed (${response.status}): ${message.slice(0, 200)}`)
  }
  return response.json() as Promise<JsonValue>
}

export const apply = (ctx: Context, input: Config = {}): void => {
  const config: Required<Config> = {
    apiBaseUrl: input.apiBaseUrl ?? 'http://api:4100',
    toolToken: input.toolToken ?? '',
    timeoutMs: input.timeoutMs ?? 5_000,
  }

  ctx.systemPrompt.section({
    name: 'role-clarifier:guardrails',
    order: 20,
    text: ROLE_CLARIFIER_SYSTEM_PROMPT,
  })

  ctx.tools.register(
    defineTool({
      name: 'read_role_state',
      description: '按当前 Agent Task 读取已授权、按角色过滤的最小岗位上下文；不会返回无关候选人或完整历史产物。',
      parameters: {},
      output: toolOutput,
      timeoutMs: config.timeoutMs,
      async execute(args, exec) {
        return callBusinessTool(
          config,
          'read_role_state',
          args,
          exec.signal,
          String(exec.agent?.session.id ?? ''),
        )
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'update_role_identity_draft',
      description: '从对话中保存待确认的岗位名称或所属团队草稿；未明确提及的字段不得猜测。',
      parameters: {
        title: { type: 'string' },
        department: { type: 'string' },
      },
      output: toolOutput,
      timeoutMs: config.timeoutMs,
      async execute(args, exec) {
        return callBusinessTool(
          config,
          'update_role_identity_draft',
          args,
          exec.signal,
          String(exec.agent?.session.id ?? ''),
        )
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'save_fact_draft',
      description: '保存待人工确认的岗位事实草稿；不能把事实直接标为已确认。',
      parameters: {
        category: {
          type: 'string',
          required: true,
          enum: [...FACT_CATEGORIES],
        },
        statement: { type: 'string', required: true },
        source_refs: { type: 'array', items: { type: 'string' } },
      },
      output: toolOutput,
      timeoutMs: config.timeoutMs,
      async execute(args, exec) {
        return callBusinessTool(
          config,
          'save_fact_draft',
          args,
          exec.signal,
          String(exec.agent?.session.id ?? ''),
        )
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'save_artifact_draft',
      description: '保存岗位画像、评分卡、四段式 JD 或 HR 招聘画像草稿。',
      parameters: {
        artifact_type: {
          type: 'string',
          required: true,
          enum: [
            'ROLE_PROFILE',
            'ASSESSMENT_SCORECARD',
            'PUBLIC_JD',
            'HR_RECRUITING_BRIEF',
          ],
        },
        content: { type: 'json', required: true },
        based_on_hash: { type: 'string' },
      },
      output: toolOutput,
      timeoutMs: config.timeoutMs,
      async execute(args, exec) {
        return callBusinessTool(
          config,
          'save_artifact_draft',
          args,
          exec.signal,
          String(exec.agent?.session.id ?? ''),
        )
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'save_candidate_evidence',
      description: '批量保存由脱敏 candidate_ref 标识的结构化候选人证据。',
      parameters: {
        candidates: {
          type: 'array',
          required: true,
          items: {
            type: 'object',
            properties: {
              candidate_ref: { type: 'string', required: true },
              channel: { type: 'string', required: true },
              source_format: { type: 'string', required: true, enum: ['JSON', 'TEXT'] },
              evidence: {
                type: 'array',
                required: true,
                items: {
                  type: 'object',
                  properties: {
                    criterion: { type: 'string', required: true },
                    signal: {
                      type: 'string',
                      required: true,
                      enum: ['STRONG', 'MIXED', 'WEAK', 'MISSING'],
                    },
                    excerpt: { type: 'string', required: true },
                  },
                  additionalProperties: false,
                },
              },
              bottlenecks: { type: 'array', items: { type: 'string' } },
            },
            additionalProperties: false,
          },
        },
      },
      output: toolOutput,
      timeoutMs: config.timeoutMs,
      async execute(args, exec) {
        return callBusinessTool(
          config,
          'save_candidate_evidence',
          args,
          exec.signal,
          String(exec.agent?.session.id ?? ''),
        )
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'propose_calibration_signal',
      description: '提出待 HR 审核的画像校准信号；不能创建经理任务或作出审核决定。',
      parameters: {
        focus: { type: 'string', required: true },
        evidence_summary: { type: 'json', required: true },
        proposed_change: { type: 'json', required: true },
      },
      output: toolOutput,
      timeoutMs: config.timeoutMs,
      async execute(args, exec) {
        return callBusinessTool(
          config,
          'propose_calibration_signal',
          args,
          exec.signal,
          String(exec.agent?.session.id ?? ''),
        )
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'read_version_diff',
      description: '读取两个正式产物版本之间已授权、脱敏的结构化差异。',
      parameters: {
        artifact_type: {
          type: 'string',
          required: true,
          enum: [
            'ROLE_PROFILE',
            'ASSESSMENT_SCORECARD',
            'PUBLIC_JD',
            'HR_RECRUITING_BRIEF',
          ],
        },
        from_version: { type: 'integer', required: true },
        to_version: { type: 'integer', required: true },
      },
      output: toolOutput,
      timeoutMs: config.timeoutMs,
      async execute(args, exec) {
        return callBusinessTool(
          config,
          'read_version_diff',
          args,
          exec.signal,
          String(exec.agent?.session.id ?? ''),
        )
      },
    }),
  )
}
