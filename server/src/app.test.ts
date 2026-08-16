import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import {
  ROLE_CLARIFIER_SYSTEM_PROMPT,
  type AgentRouteRequest,
  type AgentRouteResult,
  type ArtifactType,
  type CandidateEvidence,
  type AssessmentScorecard,
  type RoleProfile,
} from '@role-clarifier/contracts'
import { buildApp, visibleAgentEvent } from './app.js'
import type {
  HarnessAdapter,
  HarnessHooks,
  HarnessRequest,
  HarnessResult,
} from './agent/harness-adapter.js'
import { loadConfig } from './config.js'
import { MemoryStore } from './store/memory-store.js'
import { DEMO_ROLE_SESSION_ID } from './store/seed.js'

const config = loadConfig({
  NODE_ENV: 'test',
  SESSION_SECRET: 'test-session-secret-that-is-long-enough',
})

class TestHarnessStub implements HarnessAdapter {
  async route(
    request: AgentRouteRequest,
    hooks: HarnessHooks,
  ): Promise<AgentRouteResult> {
    await hooks.onStatus('测试替身执行无工具意图路由')
    await hooks.onModelRequest(JSON.stringify({ route_message: request.message }))
    const message = request.message.trim()
    let result: AgentRouteResult
    if (/你在吗|在不在|干啥|做什么|怎么用|帮助|^(你好|您好|嗨|hi|hello)/i.test(message)) {
      result = {
        action: 'RESPOND',
        answer: '我在，可以继续帮你澄清岗位和招聘问题。',
      }
    } else if (/进度|已有.*事实|现在.*画像/.test(message)) {
      result = {
        action: 'RESPOND',
        answer: `当前岗位是${request.role_state.title}，已有 ${request.role_state.facts.length} 条事实。`,
      }
    } else if (/生成.*(?:JD|岗位画像|评分表|招聘画像)/i.test(message)) {
      result = {
        action: 'HANDOFF',
        task: /JD/i.test(message)
          ? 'GENERATE_JD'
          : /评分表/.test(message)
            ? 'GENERATE_ASSESSMENT'
            : /招聘画像/.test(message)
              ? 'GENERATE_HR_BRIEF'
              : 'GENERATE_ROLE_PROFILE',
      }
    } else if (/校准/.test(message)) {
      result = { action: 'HANDOFF', task: 'CALIBRATION_ADVICE' }
    } else {
      result = { action: 'HANDOFF', task: 'CLARIFY_MESSAGE' }
    }
    await hooks.onModelResponse(JSON.stringify(result))
    if (result.action === 'RESPOND') await hooks.onDelta(result.answer)
    await hooks.onTrace({
      model: 'test-router-stub',
      provider: 'test-only',
      tool_count: 0,
      input_tokens: 1,
      output_tokens: 1,
      duration_ms: 1,
      repaired: false,
    })
    return result
  }

  async run(request: HarnessRequest, hooks: HarnessHooks): Promise<HarnessResult> {
    const { tenant_id: _tenantId, ...roleState } = request.role_state
    let toolCount = 0
    const tool = async (name: string, args: unknown, result: unknown): Promise<void> => {
      toolCount += 1
      await hooks.onToolStarted(name, args)
      await hooks.onToolCompleted(name, `${name} completed by test stub`, result)
    }
    const finish = async (result: HarnessResult, visible: string): Promise<HarnessResult> => {
      await hooks.onModelResponse(JSON.stringify(result))
      await hooks.onDelta(visible)
      await hooks.onTrace({
        model: 'test-harness-stub',
        provider: 'test-only',
        tool_count: toolCount,
        input_tokens: 1,
        output_tokens: 1,
        duration_ms: 1,
        repaired: false,
      })
      return result
    }

    await hooks.onContextSnapshot({
      system_prompt: {
        section_name: 'role-clarifier:guardrails',
        content: ROLE_CLARIFIER_SYSTEM_PROMPT,
        provenance: 'HARNESS_SYSTEM_PROMPT',
        harness_managed_base: {
          included: false,
          captured_as_text: false,
          description: '测试替身仅验证 API 编排，不代表可运行的 Harness 模式。',
        },
      },
      current_user_input: {
        content: request.message === undefined
          ? { candidate_data: request.candidates ?? [] }
          : { message: request.message },
        source: 'CURRENT_REQUEST',
      },
      short_term_memory: {
        source: 'RECENT_CONVERSATION',
        window_size: request.conversation_context?.recent_messages.length ?? 0,
        messages: request.conversation_context?.recent_messages ?? [],
      },
      long_term_memory: {
        source: 'BUSINESS_DATABASE',
        role_state: roleState,
        ...(request.recruiting_context
          ? { recruiting_context: request.recruiting_context }
          : {}),
      },
      task_state: {
        task: request.task,
        current_user_role: request.conversation_context?.current_user_role ?? null,
        open_clarification: request.conversation_context?.open_clarification ?? null,
        maximum_transitions: request.maximum_transitions,
      },
    })
    await hooks.onModelRequest(JSON.stringify({
      task: request.task,
      message: request.message,
      role_state: roleState,
      recruiting_context: request.recruiting_context,
    }))

    const message = request.message?.trim() ?? ''
    if (
      request.task === 'CLARIFY_MESSAGE'
      && /你在吗|在不在|干啥|做什么|怎么用|帮助|^(你好|您好|嗨|hi|hello)/i.test(message)
    ) {
      await hooks.onStatus('测试替身返回普通对话结果')
      const answer = '我在，可以继续帮你澄清岗位和招聘问题。'
      return finish({ kind: 'CONVERSATION', persistence: 'NONE', answer }, answer)
    }

    await hooks.onStatus('测试替身执行 Agent 任务')
    if (![
      'GENERATE_ROLE_PROFILE',
      'GENERATE_ASSESSMENT',
      'GENERATE_JD',
      'GENERATE_HR_BRIEF',
      'EXTRACT_CANDIDATES',
      'CALIBRATION_ADVICE',
    ].includes(request.task)) {
      await tool('read_role_state', {}, request.role_state)
    }

    if (request.task === 'CLARIFY_MESSAGE') {
      const category: 'HIRING_REASON' | 'SUCCESS_CRITERION' = request.role_state.facts.some(
        (fact) => fact.category === 'HIRING_REASON',
      )
        ? 'SUCCESS_CRITERION'
        : 'HIRING_REASON'
      const title = message.match(
        /(?:招聘|招|找)(?:一名|一个|一位|位|个|名)?\s*([^，。！？\n]{2,30}?(?:经理|负责人|工程师|设计师|运营|销售|顾问|专家|总监|主管|HR|人力资源))/,
      )?.[1]?.trim()
      if (title) await tool('update_role_identity_draft', { title }, { saved: true })
      const factDraft = { category, statement: message }
      await tool('save_fact_draft', factDraft, { saved: true })
      const answer = `已记录本轮${category === 'HIRING_REASON' ? '招聘原因' : '成功标准'}。`
      return finish({
        kind: 'CLARIFICATION',
        answer,
        question: category === 'HIRING_REASON'
          ? '如果半年后证明招聘成功，最重要的业务结果是什么？'
          : '这个结果由谁验收、如何判断达成？',
        ...(title ? { role_identity: { title } } : {}),
        fact_draft: factDraft,
      }, answer)
    }

    if (request.task === 'EXTRACT_CANDIDATES') {
      const profile = request.role_state.latest_artifacts.ROLE_PROFILE?.content as RoleProfile
      const assessment = request.role_state.latest_artifacts.ASSESSMENT_SCORECARD?.content as AssessmentScorecard
      const candidates: CandidateEvidence[] = (request.candidates ?? []).map((candidate) => {
        const text = typeof candidate.content === 'string'
          ? candidate.content
          : JSON.stringify(candidate.content)
        const businessGap = /业务判断/.test(text) && /不足|缺少|较弱|未体现/.test(text)
        const gapQuote = text.match(/[^。\n]*业务判断[^。\n]*(?:不足|缺少|较弱|未体现)[^。\n]*/)?.[0]
        return {
          candidate_ref: candidate.candidate_ref,
          channel: candidate.channel,
          source_format: candidate.format,
          evidence: profile.requirements.map((requirement, index) => {
            const needsVerification = businessGap && index === 0 && gapQuote
            return {
              requirement_ref: requirement.id,
              criterion: requirement.name,
              dimension_refs: assessment.dimensions
                .filter((dimension) => dimension.requirement_refs.includes(requirement.id))
                .map((dimension) => dimension.id),
              evidence_status: needsVerification ? 'INTERVIEW_NEEDED' as const : 'NOT_MENTIONED' as const,
              signal: needsVerification ? 'MIXED' as const : 'MISSING' as const,
              confidence: needsVerification ? 'MEDIUM' as const : 'HIGH' as const,
              quote_span: needsVerification
                ? { quote: gapQuote, locator: '候选人材料' }
                : null,
              rationale: needsVerification
                ? '材料明确提示该项证据仍不足，需要进一步核实。'
                : '当前材料没有提供足以判断该项要求的信息。',
              needs_interview: true,
              interview_question: `请补充说明与“${requirement.name}”相关的本人职责、行动和结果。`,
            }
          }),
          bottlenecks: businessGap && profile.requirements[0]
            ? [`${profile.requirements[0].id}:NEEDS_VERIFICATION`]
            : [],
        }
      })
      const summary = `已完成 ${candidates.length} 份候选人证据分析。`
      return finish({
        kind: 'CANDIDATE_EVIDENCE',
        persistence: 'CALLER',
        candidates,
        failed_candidates: [],
        summary,
      }, summary)
    }

    if (request.task === 'CALIBRATION_ADVICE') {
      const context = request.calibration_context
      if (!context) throw new Error('Missing calibration context')
      const evaluation = context.calibration_evaluation
      const eligible = evaluation.eligible
      const advice = {
        signal_type: 'RECRUITMENT_SIGNAL' as const,
        disposition: eligible ? 'HR_REVIEW_REQUIRED' as const : 'OBSERVING' as const,
        focus: {
          requirement_refs: context.candidate_summary.criteria.map((item) => item.requirement_ref),
          statement: eligible ? '当前重复证据达到 HR 复核边界。' : '当前证据尚不足以形成岗位画像调整信号。',
        },
        trigger_evaluation: {
          policy: context.calibration_policy,
          actual: {
            candidate_count: evaluation.candidate_count,
            channel_count: evaluation.channel_count,
            repeated_signals: evaluation.repeated_bottlenecks,
          },
          boundary_met: eligible,
          missing_conditions: evaluation.missing_conditions,
        },
        evidence_summary: {
          observed_patterns: context.candidate_summary.criteria.map((item) => ({
            requirement_ref: item.requirement_ref,
            criterion: item.criterion,
            statuses: item.evidence_statuses,
            interpretation: '只描述当前已导入候选人材料中的证据分布。',
          })),
          sample_limitations: ['当前数据只代表已导入候选人和当前渠道，不能代表完整人才市场。'],
        },
        exclusion_checks: {
          not_mentioned_separated: true as const,
          sensitive_attributes_excluded: true as const,
          recruitment_execution_verified: false,
        },
        recommendation: {
          action: eligible ? 'KEEP' as const : 'COLLECT_MORE_EVIDENCE' as const,
          target_requirement_refs: [],
          changes: [],
          rationale: eligible
            ? '先由 HR 复核检索、渠道和证据质量，当前正式画像保持不变。'
            : '继续补足服务端列出的样本、渠道和重复证据条件。',
          downstream_impact: {
            role_profile: 'NONE' as const,
            assessment_scorecard: 'NONE' as const,
            public_jd: 'NONE' as const,
            hr_recruiting_brief: 'NONE' as const,
          },
        },
        next_check: {
          owner: 'HR' as const,
          condition: eligible ? 'HR 复核当前招聘执行与证据质量。' : '补足缺失条件后重新评估。',
          action: eligible ? 'HR_REVIEW' as const : 'CONTINUE_OBSERVING' as const,
        },
        confidence_note: eligible
          ? '当前只形成待 HR 验证的招聘执行信号。'
          : '当前只形成低置信观察，不支持修改正式画像。',
        requires_hr_review: eligible,
        manager_task_created: false as const,
        formal_profile_changed: false as const,
      }
      const summary = eligible
        ? '当前证据达到校准边界，进入 HR 复核，正式画像保持不变。'
        : '当前证据未达到校准边界，继续观察，不修改岗位画像。'
      return finish({
        kind: 'CALIBRATION_ADVICE',
        persistence: 'CALLER',
        summary,
        advice,
      }, summary)
    }

    if (request.task === 'VERSION_COMPARISON') {
      const comparison = request.version_comparison
      if (!comparison) throw new Error('Missing version comparison')
      await tool('read_version_diff', comparison, { changes: [] })
      const summary = `已比较 ${comparison.artifact_type} v${comparison.from_version} 与 v${comparison.to_version}。`
      return finish({
        kind: 'VERSION_COMPARISON',
        persistence: 'NONE',
        summary,
        ...comparison,
      }, summary)
    }

    const artifactTypeByTask: Record<
      Exclude<
        HarnessRequest['task'],
        'CLARIFY_MESSAGE' | 'EXTRACT_CANDIDATES' | 'CALIBRATION_ADVICE' | 'VERSION_COMPARISON'
      >,
      ArtifactType
    > = {
      GENERATE_ROLE_PROFILE: 'ROLE_PROFILE',
      GENERATE_ASSESSMENT: 'ASSESSMENT_SCORECARD',
      GENERATE_JD: 'PUBLIC_JD',
      GENERATE_HR_BRIEF: 'HR_RECRUITING_BRIEF',
    }
    const artifactType = artifactTypeByTask[request.task]
    if (artifactType === 'ROLE_PROFILE') {
      const hiringReason = request.role_state.facts.find(
        (fact) => fact.status === 'CONFIRMED' && fact.category === 'HIRING_REASON',
      )
      const successCriterion = request.role_state.facts.find(
        (fact) => fact.status === 'CONFIRMED' && fact.category === 'SUCCESS_CRITERION',
      )
      if (!hiringReason || !successCriterion) throw new Error('Role profile preflight was skipped')
      const content = {
        mission: {
          statement: '围绕已确认业务目标形成关键路线并推动验证。',
          hiring_reason_fact_refs: [hiringReason.id],
          success_criterion_fact_refs: [successCriterion.id],
        },
        work: [{
          id: 'W-01',
          title: '形成关键业务路线',
          description: '将已确认目标转化为可执行路线并推动关键方案验证。',
          deliverables: ['业务路线图', '关键方案验证结论'],
          success_criterion_fact_refs: [successCriterion.id],
          other_fact_refs: [hiringReason.id],
        }],
        boundaries: {
          owns: [{
            statement: '负责关键业务路线与方案验证的推动。',
            fact_refs: [hiringReason.id],
            work_refs: ['W-01'],
          }],
          does_not_own: [],
          decision_rights: [],
          collaboration_and_resources: [],
        },
        requirements: [{
          id: 'R-01',
          priority: 'MUST_HAVE',
          name: '业务路线判断与验证',
          level: '能够独立完成',
          rationale: '直接支撑关键工作和成功标准。',
          strong_evidence: ['能够说明路线取舍、推动过程和验证结果'],
          acceptable_alternatives: ['在相似复杂业务中完成过同类闭环'],
          risk_signals: ['只有方案描述，没有验证结果'],
          work_refs: ['W-01'],
          success_criterion_fact_refs: [successCriterion.id],
          constraint_fact_refs: [],
        }],
        open_questions: [],
      }
      const summary = '岗位画像草稿已生成。'
      return finish({
        kind: 'ARTIFACT',
        persistence: 'CALLER',
        artifact_type: 'ROLE_PROFILE',
        content,
        summary,
      }, summary)
    }
    if (artifactType === 'ASSESSMENT_SCORECARD') {
      const profile = request.role_state.latest_artifacts.ROLE_PROFILE
      if (!profile || profile.status !== 'CONFIRMED') {
        throw new Error('Assessment preflight was skipped')
      }
      const content = {
        dimensions: [{
          id: 'D-01',
          name: '商业化路线判断与验证',
          criticality: 'CORE',
          weight: 100,
          requirement_refs: ['R-01'],
          work_refs: ['W-01'],
          method: {
            type: 'CASE_EXERCISE',
            instructions: '使用匿名商业化案例验证路线判断和方案验证能力。',
          },
          questions: [{
            prompt: '请分析案例并说明路线取舍、验证方法和判断依据。',
            probes: ['哪些约束会改变你的判断？'],
            evidence_to_collect: ['问题定义、取舍依据、验证设计和结果复盘'],
          }],
          evidence_criteria: {
            strong_evidence: ['能够比较方案并根据验证结果修正判断'],
            acceptable_evidence: ['能够形成基本路线并给出可执行验证方法'],
            risk_signals: ['只有方案描述，无法说明判断依据或验证方式'],
          },
          anchors: {
            score_1: '已有回答无法建立目标和方案之间的关系，也无法说明判断依据。',
            score_3: '能够完成基本问题拆解，形成可执行路线并说明验证方法。',
            score_5: '能够处理复杂约束、比较方案并根据验证结果迭代判断。',
          },
        }],
        interview_plan: [{
          id: 'S-01',
          name: '商业化案例评估',
          interviewer_role: '用人经理或业务面试官',
          duration_minutes: 60,
          dimension_refs: ['D-01'],
        }],
        scoring_rules: {
          scale: '1_3_5',
          weighted_total_formula: 'SUM(dimension_score / 5 * weight)',
          insufficient_evidence_action: 'DO_NOT_SCORE_AND_FOLLOW_UP',
          preferred_requirement_can_veto: false,
          final_decision: 'HUMAN_REQUIRED',
        },
        open_questions: [],
      }
      const summary = '评估方案草稿已生成。'
      return finish({
        kind: 'ARTIFACT',
        persistence: 'CALLER',
        artifact_type: 'ASSESSMENT_SCORECARD',
        content,
        summary,
      }, summary)
    }
    if (artifactType === 'PUBLIC_JD') {
      const basics = request.role_state.public_job_basics
      if (!basics?.location || !basics.employment_type) {
        throw new Error('Public JD preflight was skipped')
      }
      const content = {
        title_and_basics: {
          title: request.role_state.title,
          department: request.role_state.department,
          location: basics.location.value,
          employment_type: basics.employment_type.value,
          ...(basics.level ? { level: basics.level.value } : {}),
          ...(basics.work_mode ? { work_mode: basics.work_mode.value } : {}),
          ...(basics.reporting_line ? { reporting_line: basics.reporting_line.value } : {}),
          ...(basics.compensation ? { compensation: basics.compensation.value } : {}),
        },
        about_the_role: '你将围绕关键业务目标推动产品路线形成、方案验证和持续演进。',
        what_you_will_do: [
          '分析业务目标和用户问题，形成清晰的产品路线',
          '推动关键产品方案设计、验证和持续迭代',
          '协同业务、产品和交付团队建立目标与推进节奏',
          '沉淀关键决策和验证结论，支持后续产品演进',
        ],
        what_we_look_for: [
          '能够从复杂业务目标中识别关键问题并形成方案取舍',
          '能够通过用户、数据或实验结果验证产品判断',
          '能够在跨团队协作中建立承诺并持续推动闭环',
          '能够清晰说明本人在复杂项目中的职责、行动和结果',
        ],
      }
      const summary = '对外 JD 草稿已生成。'
      return finish({
        kind: 'ARTIFACT',
        persistence: 'CALLER',
        artifact_type: 'PUBLIC_JD',
        content,
        summary,
      }, summary)
    }
    if (artifactType === 'HR_RECRUITING_BRIEF') {
      const content = {
        target_candidate_summary: '能够形成商业化路线并亲自推动关键方案验证的产品人才。',
        target_types: [{
          label: '路线与验证型产品人才',
          fit_rationale: '能够覆盖路线取舍和方案验证。',
          requirement_refs: ['R-01'],
          work_refs: ['W-01'],
        }],
        search_strategy: {
          titles: ['商业化产品负责人', '增长产品负责人', '产品策略负责人'],
          keyword_groups: [
            { name: '路线判断', keywords: ['商业化路线', '方案取舍'], requirement_refs: ['R-01'] },
            { name: '验证闭环', keywords: ['方案验证', '迭代复盘'], requirement_refs: ['R-01'] },
          ],
          boolean_query: '(“商业化产品负责人” OR “增长产品负责人”) AND (“商业化路线” OR “方案验证”)',
          priority_channels: [],
        },
        resume_screen: {
          thirty_second_checks: [
            { criterion: '路线责任', requirement_refs: ['R-01'], evidence_to_find: ['本人路线取舍'], missing_action: 'VERIFY_NOT_REJECT' },
            { criterion: '方案验证', requirement_refs: ['R-01'], evidence_to_find: ['验证方法与结果'], missing_action: 'VERIFY_NOT_REJECT' },
            { criterion: '迭代复盘', requirement_refs: ['R-01'], evidence_to_find: ['根据结果修正判断'], missing_action: 'VERIFY_NOT_REJECT' },
          ],
          non_target_signals: [],
        },
        phone_questions: [
          { prompt: '你如何形成业务路线？', probes: ['关键取舍是什么？'], evidence_to_collect: ['本人责任与取舍'], requirement_refs: ['R-01'] },
          { prompt: '你如何推动方案验证？', probes: ['如何定义验证标准？'], evidence_to_collect: ['验证方法与结果'], requirement_refs: ['R-01'] },
          { prompt: '结果不符预期时你如何调整？', probes: ['哪些证据改变了判断？'], evidence_to_collect: ['判断修正与复盘'], requirement_refs: ['R-01'] },
        ],
        market_context: {
          status: request.role_state.hr_recruiting_context?.talent_pool_status ?? 'NOT_CONNECTED',
          note: '尚未接入真实人才库数据。',
          supply_observations: [],
          target_companies: [],
        },
        calibration_watchpoints: [{
          signal: '核心要求持续缺少可验证证据。',
          requirement_refs: ['R-01'],
          trigger_rule: { minimum_candidates: 10, minimum_channels: 2, repeated_signal_count: 2 },
          action: 'HR_REVIEW',
        }],
        open_questions: [],
      }
      const summary = 'HR 招聘画像草稿已生成。'
      return finish({
        kind: 'ARTIFACT',
        persistence: 'CALLER',
        artifact_type: 'HR_RECRUITING_BRIEF',
        content,
        summary,
      }, summary)
    }
    const content = { title: request.role_state.title, generated_for: artifactType }
    await tool('save_artifact_draft', { artifact_type: artifactType, content }, { saved: true })
    const summary = '产物草稿已生成。'
    return finish({ kind: 'ARTIFACT', artifact_type: artifactType, content, summary }, summary)
  }
}

const testHarness = new TestHarnessStub()

const cookieFrom = (response: {
  headers: Record<string, string | string[] | number | undefined>
}): string => {
  const header = response.headers['set-cookie']
  const value = Array.isArray(header) ? header[0] : header
  if (!value) throw new Error('Missing session cookie')
  return String(value).split(';')[0] ?? ''
}

const login = async (
  app: FastifyInstance,
  userId: 'manager-demo' | 'hr-demo' | 'admin-demo',
): Promise<string> => {
  const profile = {
    'manager-demo': { display_name: '用人经理 · 陈曦', role: 'MANAGER' },
    'hr-demo': { display_name: 'HR · 林夏', role: 'HR' },
    'admin-demo': { display_name: '企业管理员 · 周宁', role: 'ADMIN' },
  }[userId] as { display_name: string; role: 'MANAGER' | 'HR' | 'ADMIN' }
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: {
      workspace_id: 'legacy-demo',
      account_id: userId,
      display_name: profile.display_name,
      role: profile.role,
    },
  })
  expect(response.statusCode).toBe(200)
  return cookieFrom(response)
}

describe('Role Clarifier API', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    app = await buildApp(config, { store: new MemoryStore(), harness: testHarness })
  })

  it('普通成员的 SSE 不暴露内部错误，企业管理员 Trace 保留诊断信息', () => {
    const event = {
      id: 'event-failed',
      run_id: 'run-failed',
      sequence: 1,
      type: 'run.failed' as const,
      payload: {
        code: 'HARNESS_EXECUTION_FAILED',
        message: 'Agent 本轮没有完成，原消息已经保留，请稍后重试。',
        internal_message: 'runtime stack for administrator',
      },
      created_at: '2026-08-16T00:00:00.000Z',
    }
    const managerEvent = visibleAgentEvent(event, {
      tenant_id: 'tenant-demo',
      user_id: 'manager-demo',
      role: 'MANAGER',
      display_name: '用人经理',
    })
    const adminEvent = visibleAgentEvent(event, {
      tenant_id: 'tenant-demo',
      user_id: 'admin-demo',
      role: 'ADMIN',
      display_name: '企业管理员',
    })
    expect(managerEvent.payload.internal_message).toBeUndefined()
    expect(managerEvent.payload.message).toBe('Agent 本轮没有完成，原消息已经保留，请稍后重试。')
    expect(adminEvent.payload.internal_message).toBe('runtime stack for administrator')
  })

  it('动态账号选择角色：新账号为空，同一账号恢复岗位，不同账号互相隔离', async () => {
    const loginDynamic = async (accountId: string, displayName: string, role = 'MANAGER') => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          workspace_id: 'acme-demo',
          account_id: accountId,
          display_name: displayName,
          role,
        },
      })
      return { response, cookie: response.statusCode === 200 ? cookieFrom(response) : '' }
    }

    const first = await loginDynamic('zhangsan', '张三')
    expect(first.response.statusCode).toBe(200)
    expect(first.response.json()).toMatchObject({
      is_new_account: true,
      actor: { display_name: '张三', role: 'MANAGER' },
    })
    const initiallyEmpty = await app.inject({
      method: 'GET',
      url: '/api/v1/role-sessions',
      headers: { cookie: first.cookie },
    })
    expect(initiallyEmpty.json().items).toEqual([])

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/role-sessions',
      headers: { cookie: first.cookie },
      payload: { title: '增长负责人', department: '增长团队' },
    })
    expect(created.statusCode).toBe(201)

    const sameAccount = await loginDynamic('zhangsan', '张三')
    expect(sameAccount.response.json().is_new_account).toBe(false)
    const restored = await app.inject({
      method: 'GET',
      url: '/api/v1/role-sessions',
      headers: { cookie: sameAccount.cookie },
    })
    expect(restored.json().items).toHaveLength(1)

    const second = await loginDynamic('lisi', '李四')
    const isolated = await app.inject({
      method: 'GET',
      url: '/api/v1/role-sessions',
      headers: { cookie: second.cookie },
    })
    expect(isolated.json().items).toEqual([])

    const roleMismatch = await loginDynamic('zhangsan', '张三', 'HR')
    expect(roleMismatch.response.statusCode).toBe(409)
    expect(roleMismatch.response.json().error.code).toBe('ACCOUNT_ROLE_MISMATCH')
  })

  it('空账号发送第一条消息后自动建立岗位并由 Agent 识别岗位名称', async () => {
    const loginResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        workspace_id: 'conversation-first-demo',
        account_id: 'manager-one',
        display_name: '对话经理',
        role: 'MANAGER',
      },
    })
    const cookie = cookieFrom(loginResponse)
    const intake = await app.inject({
      method: 'POST',
      url: '/api/v1/intake/messages',
      headers: { cookie },
      payload: { content: '我想招聘一位企业产品经理，请从招聘原因开始帮我澄清。' },
    })
    expect(intake.statusCode, intake.body).toBe(202)
    expect(intake.json().role.state).toMatchObject({
      title: '待识别岗位',
      department: '待确认团队',
      stage: 'REASON_CLARIFYING',
    })

    const runId = intake.json().run_id
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const status = await app.inject({
        method: 'GET',
        url: `/api/v1/agent-runs/${runId}`,
        headers: { cookie },
      })
      if (status.json().run.status === 'COMPLETED') break
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    const roles = await app.inject({
      method: 'GET',
      url: '/api/v1/role-sessions',
      headers: { cookie },
    })
    expect(roles.json().items).toHaveLength(1)
    expect(roles.json().items[0].title).toBe('企业产品经理')
    const messages = await app.inject({
      method: 'GET',
      url: `/api/v1/role-sessions/${intake.json().role.state.id}/messages`,
      headers: { cookie },
    })
    expect(messages.json().items.map((item: { sender_type: string }) => item.sender_type))
      .toEqual(['HUMAN', 'AGENT'])
  })

  it('飞书事件可开启同一岗位澄清链路并在画像门禁不足时返回原因', async () => {
    const cards: Array<{ chatId: string; card: Record<string, unknown> }> = []
    const texts: Array<{ chatId: string; text: string }> = []
    const feishuConfig = loadConfig({
      NODE_ENV: 'test',
      SESSION_SECRET: 'test-session-secret-that-is-long-enough',
      FEISHU_ENABLED: 'true',
      FEISHU_APP_ID: 'cli_test',
      FEISHU_APP_SECRET: 'test-secret',
      FEISHU_VERIFICATION_TOKEN: 'verification-token',
      FEISHU_WORKSPACE_ID: 'conversation-first-demo',
    })
    const feishuApp = await buildApp(feishuConfig, {
      store: new MemoryStore(),
      harness: testHarness,
      feishuClient: {
        configured: () => true,
        sendText: async (chatId, text) => {
          texts.push({ chatId, text })
        },
        sendCard: async (chatId, card) => {
          cards.push({ chatId, card })
        },
      },
    })
    const challenge = await feishuApp.inject({
      method: 'POST',
      url: '/api/v1/integrations/feishu/events',
      payload: {
        type: 'url_verification',
        challenge: 'challenge-code',
        token: 'verification-token',
      },
    })
    expect(challenge.statusCode).toBe(200)
    expect(challenge.json()).toEqual({ challenge: 'challenge-code' })

    const event = (messageId: string, text: string) => ({
      schema: '2.0',
      header: {
        event_id: `event-${messageId}`,
        event_type: 'im.message.receive_v1',
        token: 'verification-token',
        tenant_key: 'tenant-key',
      },
      event: {
        sender: {
          sender_id: { open_id: 'ou_manager_one' },
          sender_type: 'user',
        },
        message: {
          message_id: messageId,
          chat_id: 'oc_p2p_chat',
          chat_type: 'p2p',
          message_type: 'text',
          content: JSON.stringify({ text }),
        },
      },
    })
    const first = await feishuApp.inject({
      method: 'POST',
      url: '/api/v1/integrations/feishu/events',
      payload: event('om_001', '我想招聘一位企业产品经理，请从招聘原因开始帮我澄清。'),
    })
    expect(first.statusCode, first.body).toBe(200)
    for (let attempt = 0; attempt < 60 && texts.length < 1; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    expect(texts).toHaveLength(1)
    expect(texts[0]?.text).toContain('下一步需要你补充')
    expect(cards).toHaveLength(0)

    await feishuApp.inject({
      method: 'POST',
      url: '/api/v1/integrations/feishu/events',
      payload: event('om_002', '生成岗位画像'),
    })
    for (let attempt = 0; attempt < 60 && texts.length < 2; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    expect(cards).toHaveLength(0)
    expect(texts).toHaveLength(2)
    expect(texts[1]?.text).toContain('岗位名称或所属团队')

    const duplicate = await feishuApp.inject({
      method: 'POST',
      url: '/api/v1/integrations/feishu/events',
      payload: event('om_002', '生成岗位画像'),
    })
    expect(duplicate.json()).toMatchObject({ ok: true, duplicate: true })
    await feishuApp.close()
  })

  afterEach(async () => {
    await app.close()
  })

  it('权限由后端 Session 决定，经理响应中不存在 HR 内部数据', async () => {
    const managerCookie = await login(app, 'manager-demo')
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}`,
      headers: { cookie: managerCookie },
    })
    expect(response.statusCode).toBe(200)
    const payload = response.json()
    expect(payload.candidates).toBeUndefined()
    expect(payload.calibration_signals).toBeUndefined()
    expect(payload.artifacts.some((item: { type: string }) => item.type === 'HR_RECRUITING_BRIEF')).toBe(false)
    expect(payload.state.latest_artifacts.HR_RECRUITING_BRIEF).toBeUndefined()
    expect(payload.state.hr_recruiting_context).toBeUndefined()
  })

  it('HR 可以读取内部招聘画像，但经理不能让 Agent 生成该产物', async () => {
    const managerCookie = await login(app, 'manager-demo')
    const forbidden = await app.inject({
      method: 'POST',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}/artifacts/HR_RECRUITING_BRIEF/generate`,
      headers: { cookie: managerCookie },
    })
    expect(forbidden.statusCode).toBe(403)

    const hrCookie = await login(app, 'hr-demo')
    const allowed = await app.inject({
      method: 'GET',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}`,
      headers: { cookie: hrCookie },
    })
    expect(allowed.statusCode).toBe(200)
    expect(
      allowed.json().artifacts.some(
        (item: { type: string }) => item.type === 'HR_RECRUITING_BRIEF',
      ),
    ).toBe(true)

    const generate = await app.inject({
      method: 'POST',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}/artifacts/HR_RECRUITING_BRIEF/generate`,
      headers: { cookie: hrCookie },
    })
    expect(generate.statusCode, generate.body).toBe(202)
    const runId = generate.json().run_id
    let run
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const status = await app.inject({
        method: 'GET',
        url: `/api/v1/agent-runs/${runId}`,
        headers: { cookie: hrCookie },
      })
      run = status.json().run
      if (run.status === 'COMPLETED') break
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    expect(run).toMatchObject({
      task: 'GENERATE_HR_BRIEF',
      tool_count: 0,
      prompt_version: 'role-clarifier-v9',
    })
    const versions = await app.inject({
      method: 'GET',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}/artifacts/HR_RECRUITING_BRIEF/versions`,
      headers: { cookie: hrCookie },
    })
    expect(versions.statusCode).toBe(200)
    expect(versions.json().items[0]).toMatchObject({
      version: 2,
      status: 'DRAFT',
      content: {
        market_context: { status: 'NOT_CONNECTED', target_companies: [] },
      },
    })
  })

  it('消息接口立即落库并返回 202，企业管理员可读取完整执行 Trace', async () => {
    const cookie = await login(app, 'manager-demo')
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}/messages`,
      headers: { cookie },
      payload: { content: '半年内要建立一套可复用的商业化产品机制' },
    })
    expect(response.statusCode).toBe(202)
    const { run_id: runId } = response.json()
    expect(response.json().message.content).toBe('半年内要建立一套可复用的商业化产品机制')
    const managerTrace = await app.inject({
      method: 'GET',
      url: `/api/v1/agent-runs/${runId}/trace`,
      headers: { cookie },
    })
    expect(managerTrace.statusCode).toBe(403)

    const adminCookie = await login(app, 'admin-demo')
    let trace
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const traceResponse = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/agent-runs/${runId}/trace`,
        headers: { cookie: adminCookie },
      })
      trace = traceResponse.json()
      if (trace.run.status === 'COMPLETED') break
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    expect(trace.run.status).toBe('COMPLETED')
    expect(trace.events.map((event: { type: string }) => event.type)).toContain('question.ready')
    expect(trace.visibility).toEqual({
      mode: 'FULL_ADMIN',
      raw_user_message_logged: true,
      model_prompt_logged: true,
      model_response_logged: true,
      tool_arguments_logged: true,
      tool_results_logged: true,
      pii_screened_candidate_content_logged: true,
      secrets_exposed: false,
      hidden_reasoning_exposed: false,
    })
    expect(JSON.stringify(trace)).toContain('半年内要建立')
    expect(trace.events.map((event: { type: string }) => event.type)).toContain('context.snapshot')
    const contextEvent = trace.events.find(
      (event: { type: string }) => event.type === 'context.snapshot',
    )
    expect(contextEvent.payload.system_prompt.content).toContain('岗位画像澄清 Agent')
    expect(contextEvent.payload.current_user_input.content.message).toContain('半年内要建立')
    expect(contextEvent.payload.short_term_memory.source).toBe('RECENT_CONVERSATION')
    expect(contextEvent.payload.long_term_memory.source).toBe('BUSINESS_DATABASE')
    expect(trace.events.map((event: { type: string }) => event.type)).toContain('model.request')
    expect(trace.events.map((event: { type: string }) => event.type)).toContain('model.response')
    expect(trace.events.find((event: { type: string }) => event.type === 'tool.started').payload)
      .toHaveProperty('arguments')

    const messages = await app.inject({
      method: 'GET',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}/messages`,
      headers: { cookie },
    })
    expect(messages.statusCode).toBe(200)
    expect(messages.json().items.map((item: { sender_type: string }) => item.sender_type)).toEqual([
      'HUMAN',
      'AGENT',
    ])
    expect(messages.json().policy.opened_rounds).toBe(1)
  })

  it('普通问答会直接回应，不保存岗位事实也不消耗主动澄清轮次', async () => {
    const cookie = await login(app, 'manager-demo')
    const before = (
      await app.inject({
        method: 'GET',
        url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}`,
        headers: { cookie },
      })
    ).json()
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}/messages`,
      headers: { cookie },
      payload: { content: '你在吗？你可以干啥？' },
    })
    expect(response.statusCode).toBe(202)
    const runId = response.json().run_id
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const status = await app.inject({
        method: 'GET',
        url: `/api/v1/agent-runs/${runId}`,
        headers: { cookie },
      })
      if (status.json().run.status === 'COMPLETED') break
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    const completedRun = await app.inject({
      method: 'GET',
      url: `/api/v1/agent-runs/${runId}`,
      headers: { cookie },
    })
    expect(completedRun.json().run).toMatchObject({
      task: 'ROUTER_RESPOND',
      tool_count: 0,
      prompt_version: 'role-router-v2',
    })
    const conversation = (
      await app.inject({
        method: 'GET',
        url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}/messages`,
        headers: { cookie },
      })
    ).json()
    const after = (
      await app.inject({
        method: 'GET',
        url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}`,
        headers: { cookie },
      })
    ).json()

    expect(conversation.items.at(-1).content).toContain('我在')
    expect(conversation.items.at(-1).structured_content.kind).toBe('CONVERSATION')
    expect(conversation.policy.opened_rounds).toBe(0)
    expect(after.state.facts).toHaveLength(before.state.facts.length)
  })

  it('岗位状态查询由无工具 Router 基于只读摘要直接回答', async () => {
    const cookie = await login(app, 'manager-demo')
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}/messages`,
      headers: { cookie },
      payload: { content: '现在岗位画像有哪些事实，进度怎么样？' },
    })
    const runId = response.json().run_id
    let run
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const status = await app.inject({
        method: 'GET',
        url: `/api/v1/agent-runs/${runId}`,
        headers: { cookie },
      })
      run = status.json().run
      if (run.status === 'COMPLETED') break
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    expect(run).toMatchObject({ task: 'ROUTER_RESPOND', tool_count: 0 })
    const conversation = await app.inject({
      method: 'GET',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}/messages`,
      headers: { cookie },
    })
    expect(conversation.json().items.at(-1).structured_content).toMatchObject({
      kind: 'CONVERSATION',
      route_action: 'RESPOND',
    })
  })

  it('自由文本 JD 请求经 Router 分流后使用零工具领域模型', async () => {
    const cookie = await login(app, 'manager-demo')
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}/messages`,
      headers: { cookie },
      payload: { content: '请根据现有事实生成一份 JD' },
    })
    const runId = response.json().run_id
    let run
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const status = await app.inject({
        method: 'GET',
        url: `/api/v1/agent-runs/${runId}`,
        headers: { cookie },
      })
      run = status.json().run
      if (run.status === 'COMPLETED') break
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    expect(run).toMatchObject({ task: 'GENERATE_JD', tool_count: 0 })
    expect(run.prompt_version).toBe('role-router-v2+role-clarifier-v10')
    const versions = await app.inject({
      method: 'GET',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}/artifacts/PUBLIC_JD/versions`,
      headers: { cookie },
    })
    expect(versions.statusCode).toBe(200)
    expect(versions.json().items[0]).toMatchObject({
      version: 2,
      status: 'DRAFT',
      content: {
        title_and_basics: {
          title: '商业化产品负责人',
          department: '产品与商业化',
          location: '上海',
          employment_type: '全职',
        },
      },
    })
  })

  it('岗位画像由单次无工具领域模型生成并由服务端校验保存', async () => {
    const cookie = await login(app, 'manager-demo')
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}/artifacts/ROLE_PROFILE/generate`,
      headers: { cookie },
    })
    expect(response.statusCode, response.body).toBe(202)
    const runId = response.json().run_id
    let run
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const status = await app.inject({
        method: 'GET',
        url: `/api/v1/agent-runs/${runId}`,
        headers: { cookie },
      })
      run = status.json().run
      if (run.status === 'COMPLETED') break
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    expect(run).toMatchObject({
      task: 'GENERATE_ROLE_PROFILE',
      tool_count: 0,
      prompt_version: 'role-clarifier-v9',
    })

    const versions = await app.inject({
      method: 'GET',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}/artifacts/ROLE_PROFILE/versions`,
      headers: { cookie },
    })
    expect(versions.statusCode).toBe(200)
    expect(versions.json().items[0]).toMatchObject({
      version: 2,
      status: 'DRAFT',
      content: {
        mission: {
          hiring_reason_fact_refs: ['fact-02'],
          success_criterion_fact_refs: ['fact-03'],
        },
        work: [{ id: 'W-01' }],
        requirements: [{ id: 'R-01', priority: 'MUST_HAVE' }],
      },
    })
  })

  it('评估方案由单次无工具领域模型生成并由服务端校验保存', async () => {
    const cookie = await login(app, 'manager-demo')
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}/artifacts/ASSESSMENT_SCORECARD/generate`,
      headers: { cookie },
    })
    expect(response.statusCode, response.body).toBe(202)
    const runId = response.json().run_id
    let run
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const status = await app.inject({
        method: 'GET',
        url: `/api/v1/agent-runs/${runId}`,
        headers: { cookie },
      })
      run = status.json().run
      if (run.status === 'COMPLETED') break
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    expect(run).toMatchObject({
      task: 'GENERATE_ASSESSMENT',
      tool_count: 0,
      prompt_version: 'role-clarifier-v9',
    })

    const versions = await app.inject({
      method: 'GET',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}/artifacts/ASSESSMENT_SCORECARD/versions`,
      headers: { cookie },
    })
    expect(versions.statusCode).toBe(200)
    expect(versions.json().items[0]).toMatchObject({
      version: 2,
      status: 'DRAFT',
      content: {
        dimensions: [{
          id: 'D-01',
          criticality: 'CORE',
          weight: 100,
          requirement_refs: ['R-01'],
          work_refs: ['W-01'],
        }],
        scoring_rules: {
          scale: '1_3_5',
          preferred_requirement_can_veto: false,
          final_decision: 'HUMAN_REQUIRED',
        },
      },
    })
  })

  it('授权人类更新公开基础字段并使旧 JD 失效', async () => {
    const cookie = await login(app, 'hr-demo')
    const before = await app.inject({
      method: 'GET',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}`,
      headers: { cookie },
    })
    const response = await app.inject({
      method: 'PUT',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}/public-job-basics`,
      headers: { cookie },
      payload: {
        location: '北京',
        employment_type: '校园招聘·全职',
        compensation: '40–70K·16薪',
        expected_revision: before.json().state.revision,
      },
    })
    expect(response.statusCode, response.body).toBe(200)
    expect(response.json().state).toMatchObject({
      public_job_basics: {
        location: { value: '北京', status: 'CONFIRMED', visibility: 'PUBLIC', source: 'HR' },
        employment_type: {
          value: '校园招聘·全职',
          status: 'CONFIRMED',
          visibility: 'PUBLIC',
          source: 'HR',
        },
        compensation: {
          value: '40–70K·16薪',
          status: 'CONFIRMED',
          visibility: 'PUBLIC',
          source: 'HR',
        },
      },
      latest_artifacts: {
        PUBLIC_JD: { status: 'INVALIDATED' },
      },
    })
  })

  it('岗位画像前置条件不满足时由服务端直接阻断，不启动领域模型', async () => {
    const loginResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        workspace_id: 'profile-gate-demo',
        account_id: 'profile-manager',
        display_name: '画像经理',
        role: 'MANAGER',
      },
    })
    const cookie = cookieFrom(loginResponse)
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/role-sessions',
      headers: { cookie },
      payload: { title: '增长负责人', department: '增长团队' },
    })
    const roleId = created.json().state.id
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/role-sessions/${roleId}/artifacts/ROLE_PROFILE/generate`,
      headers: { cookie },
    })
    expect(response.statusCode).toBe(409)
    expect(response.json().error).toMatchObject({
      code: 'HC_APPROVAL_REQUIRED',
    })
  })

  it('存在待回答澄清题时，普通问答不会误完成当前轮或开启下一轮', async () => {
    const cookie = await login(app, 'manager-demo')
    const factResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}/messages`,
      headers: { cookie },
      payload: { content: '这个岗位半年内要完成一个真实客户验证' },
    })
    const factRunId = factResponse.json().run_id
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const status = await app.inject({
        method: 'GET',
        url: `/api/v1/agent-runs/${factRunId}`,
        headers: { cookie },
      })
      if (status.json().run.status === 'COMPLETED') break
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    const beforeQuestion = (
      await app.inject({
        method: 'GET',
        url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}/messages`,
        headers: { cookie },
      })
    ).json()
    expect(beforeQuestion.policy.opened_rounds).toBe(1)
    expect(beforeQuestion.policy.completed_rounds).toBe(0)

    const chatResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}/messages`,
      headers: { cookie },
      payload: { content: '你在吗？你可以干啥？' },
    })
    const chatRunId = chatResponse.json().run_id
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const status = await app.inject({
        method: 'GET',
        url: `/api/v1/agent-runs/${chatRunId}`,
        headers: { cookie },
      })
      if (status.json().run.status === 'COMPLETED') break
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    const afterQuestion = (
      await app.inject({
        method: 'GET',
        url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}/messages`,
        headers: { cookie },
      })
    ).json()

    expect(afterQuestion.policy.opened_rounds).toBe(1)
    expect(afterQuestion.policy.completed_rounds).toBe(0)
    expect(afterQuestion.policy.open_round_id).toBe(beforeQuestion.policy.open_round_id)
    expect(afterQuestion.items.at(-2).clarification_round_id).toBeNull()
    expect(afterQuestion.items.at(-1).structured_content.kind).toBe('CONVERSATION')
  })

  it('每个用户的对话页只返回本人和 Agent 的消息，管理员通过 Trace 审计其他人', async () => {
    const runIds = new Map<string, string>()
    for (const userId of ['manager-demo', 'hr-demo', 'admin-demo'] as const) {
      const cookie = await login(app, userId)
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}/messages`,
        headers: { cookie },
        payload: { content: `${userId} 补充岗位信息` },
      })
      expect(response.statusCode, response.body).toBe(202)
      const runId = response.json().run_id
      runIds.set(userId, runId)
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const status = await app.inject({
          method: 'GET',
          url: `/api/v1/agent-runs/${runId}`,
          headers: { cookie },
        })
        if (status.json().run.status === 'COMPLETED') break
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      const conversation = (
        await app.inject({
          method: 'GET',
          url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}/messages`,
          headers: { cookie },
        })
      ).json().items
      expect(conversation.filter((item: { sender_type: string }) => item.sender_type === 'HUMAN'))
        .toMatchObject([{ sender_user_id: userId }])
      expect(conversation.every((item: { run_id: string | null; sender_user_id: string | null }) =>
        item.run_id === runId || item.sender_user_id === userId,
      )).toBe(true)
    }
    const adminCookie = await login(app, 'admin-demo')
    const adminMessages = (
      await app.inject({
        method: 'GET',
        url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}/messages`,
        headers: { cookie: adminCookie },
      })
    ).json().items
    expect(JSON.stringify(adminMessages)).not.toContain('manager-demo 补充岗位信息')
    expect(JSON.stringify(adminMessages)).not.toContain('hr-demo 补充岗位信息')
    expect(JSON.stringify(adminMessages)).toContain('admin-demo 补充岗位信息')

    const traceRuns = (
      await app.inject({
        method: 'GET',
        url: '/api/v1/admin/agent-runs',
        headers: { cookie: adminCookie },
      })
    ).json().items
    const createdRuns = traceRuns.filter(
      (item: { run: { id: string } }) => [...runIds.values()].includes(item.run.id),
    )
    expect(new Set(createdRuns.map((item: { actor_role: string }) => item.actor_role)))
      .toEqual(new Set(['MANAGER', 'HR', 'ADMIN']))

    const managerTrace = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/agent-runs/${runIds.get('manager-demo')}/trace`,
      headers: { cookie: adminCookie },
    })
    expect(JSON.stringify(managerTrace.json())).toContain('manager-demo 补充岗位信息')

    const adminTrace = (
      await app.inject({
        method: 'GET',
        url: `/api/v1/admin/agent-runs/${runIds.get('admin-demo')}/trace`,
        headers: { cookie: adminCookie },
      })
    ).json()
    const adminContext = adminTrace.events.find(
      (event: { type: string }) => event.type === 'context.snapshot',
    )
    expect(JSON.stringify(adminContext?.payload.short_term_memory?.messages ?? []))
      .not.toContain('manager-demo')
    expect(adminContext?.payload.task_state?.open_clarification ?? null).toBeNull()
  })

  it('企业澄清策略更新后立即返回 10 轮，并由新岗位继承', async () => {
    const adminCookie = await login(app, 'admin-demo')
    const updated = await app.inject({
      method: 'PUT',
      url: '/api/v1/admin/agent-policy',
      headers: { cookie: adminCookie },
      payload: { initial_budget: 10, extension_size: 3 },
    })
    expect(updated.statusCode).toBe(200)
    expect(updated.json()).toEqual({ initial_budget: 10, extension_size: 3 })

    const currentConversation = await app.inject({
      method: 'GET',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}/messages`,
      headers: { cookie: adminCookie },
    })
    expect(currentConversation.json().policy).toMatchObject({
      initial_budget: 10,
      extension_size: 3,
    })

    const configured = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/agent-policy',
      headers: { cookie: adminCookie },
    })
    expect(configured.json()).toEqual({ initial_budget: 10, extension_size: 3 })

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/role-sessions',
      headers: { cookie: adminCookie },
      payload: { title: '新岗位', department: '新团队' },
    })
    expect(created.statusCode, created.body).toBe(201)
    const inherited = await app.inject({
      method: 'GET',
      url: `/api/v1/role-sessions/${created.json().state.id}/messages`,
      headers: { cookie: adminCookie },
    })
    expect(inherited.json().policy).toMatchObject({
      initial_budget: 10,
      extension_size: 3,
    })
  })

  it('主动澄清预算由企业策略控制，达到上限后可审计地增加轮数', async () => {
    const adminCookie = await login(app, 'admin-demo')
    const policyUpdate = await app.inject({
      method: 'PUT',
      url: '/api/v1/admin/agent-policy',
      headers: { cookie: adminCookie },
      payload: { initial_budget: 1, extension_size: 2 },
    })
    expect(policyUpdate.statusCode).toBe(200)

    const managerCookie = await login(app, 'manager-demo')
    const first = await app.inject({
      method: 'POST',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}/messages`,
      headers: { cookie: managerCookie },
      payload: { content: '先确认这个岗位的招聘原因' },
    })
    const firstRunId = first.json().run_id
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const status = await app.inject({
        method: 'GET',
        url: `/api/v1/agent-runs/${firstRunId}`,
        headers: { cookie: managerCookie },
      })
      if (status.json().run.status === 'COMPLETED') break
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    const second = await app.inject({
      method: 'POST',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}/messages`,
      headers: { cookie: managerCookie },
      payload: { content: '半年内形成可复用的方法并完成一次验证' },
    })
    const secondRunId = second.json().run_id
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const status = await app.inject({
        method: 'GET',
        url: `/api/v1/agent-runs/${secondRunId}`,
        headers: { cookie: managerCookie },
      })
      if (status.json().run.status === 'COMPLETED') break
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    const beforeExtend = (
      await app.inject({
        method: 'GET',
        url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}/messages`,
        headers: { cookie: managerCookie },
      })
    ).json().policy
    expect(beforeExtend).toMatchObject({
      initial_budget: 1,
      completed_rounds: 1,
      status: 'LIMIT_REACHED',
    })

    const extended = await app.inject({
      method: 'POST',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}/clarification:extend`,
      headers: { cookie: managerCookie },
      payload: { reason: '仍需确认结果验收口径' },
    })
    expect(extended.statusCode).toBe(200)
    expect(extended.json().policy).toMatchObject({ granted_rounds: 2, status: 'ACTIVE' })
  })

  it('候选人资料发现手机号时在进入模型前拒绝', async () => {
    const cookie = await login(app, 'hr-demo')
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}/candidates:import`,
      headers: { cookie },
      payload: {
        candidates: [
          {
            candidate_ref: 'CAND-001',
            channel: '内推',
            format: 'TEXT',
            content: '负责增长产品，手机号 13812345678',
          },
        ],
      },
    })
    expect(response.statusCode).toBe(422)
    expect(response.json().error.code).toBe('CANDIDATE_PII_DETECTED')
  })

  it('候选人资料发现显式年龄和性别字段时在进入模型前拒绝', async () => {
    const cookie = await login(app, 'hr-demo')
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}/candidates:import`,
      headers: { cookie },
      payload: {
        candidates: [{
          candidate_ref: 'CAND-002',
          channel: '内推',
          format: 'TEXT',
          content: '年龄：31，性别：女，负责增长产品。',
        }],
      },
    })
    expect(response.statusCode).toBe(422)
    expect(response.json().error.code).toBe('CANDIDATE_PII_DETECTED')
  })

  it('按 content_hash 确认四段式 JD', async () => {
    const cookie = await login(app, 'manager-demo')
    const detailResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}`,
      headers: { cookie },
    })
    const detail = detailResponse.json()
    const jd = detail.state.latest_artifacts.PUBLIC_JD
    const confirmResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}/artifacts/${jd.id}:confirm`,
      headers: { cookie },
      payload: {
        content_hash: jd.content_hash,
        expected_revision: detail.state.revision,
      },
    })
    expect(confirmResponse.statusCode, confirmResponse.body).toBe(200)
    expect(confirmResponse.json().artifact.status).toBe('CONFIRMED')
  })

  it('校准证据未达到 10/2/2 时以零工具任务继续观察且不创建审核信号', async () => {
    const hrCookie = await login(app, 'hr-demo')
    const before = (
      await app.inject({
        method: 'GET',
        url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}`,
        headers: { cookie: hrCookie },
      })
    ).json()
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}/messages`,
      headers: { cookie: hrCookie },
      payload: { content: '请给出当前岗位画像校准建议' },
    })
    expect(response.statusCode, response.body).toBe(202)
    const runId = response.json().run_id
    let run
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const status = await app.inject({
        method: 'GET',
        url: `/api/v1/agent-runs/${runId}`,
        headers: { cookie: hrCookie },
      })
      run = status.json().run
      if (run.status === 'COMPLETED') break
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    expect(run).toMatchObject({
      task: 'CALIBRATION_ADVICE',
      status: 'COMPLETED',
      tool_count: 0,
      prompt_version: 'role-router-v2+role-clarifier-v10',
    })

    const after = (
      await app.inject({
        method: 'GET',
        url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}`,
        headers: { cookie: hrCookie },
      })
    ).json()
    expect(after.state).toMatchObject({
      calibration_status: 'OBSERVING',
      revision: before.state.revision,
    })
    expect(after.calibration_signals).toEqual([])
    expect(after.manager_tasks).toEqual([])

    const messages = (
      await app.inject({
        method: 'GET',
        url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}/messages`,
        headers: { cookie: hrCookie },
      })
    ).json().items
    expect(messages.at(-1).structured_content).toMatchObject({
      kind: 'CALIBRATION_ADVICE',
      disposition: 'OBSERVING',
      signal_id: null,
      manager_task_created: false,
      formal_profile_changed: false,
    })
  })

  it('10/2/2 边界命中后必须先经 HR 审核，再创建经理校准任务', async () => {
    const hrCookie = await login(app, 'hr-demo')
    const candidates = Array.from({ length: 10 }, (_, index) => ({
      candidate_ref: `CAND-${String(index + 1).padStart(3, '0')}`,
      channel: index % 2 === 0 ? '内推' : '招聘网站',
      format: 'TEXT',
      content:
        index < 2
          ? '参与商业产品项目，但业务判断证据不足，需要面试验证'
          : '负责业务产品与跨团队协作，完成方案验证',
    }))
    const importResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}/candidates:import`,
      headers: { cookie: hrCookie },
      payload: { candidates },
    })
    expect(importResponse.statusCode).toBe(202)
    const runId = importResponse.json().run_id
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const traceResponse = await app.inject({
        method: 'GET',
        url: `/api/v1/agent-runs/${runId}`,
        headers: { cookie: hrCookie },
      })
      if (traceResponse.json().run.status === 'COMPLETED') break
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    const completedRunResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/agent-runs/${runId}`,
      headers: { cookie: hrCookie },
    })
    expect(completedRunResponse.json().run).toMatchObject({
      task: 'EXTRACT_CANDIDATES',
      status: 'COMPLETED',
      tool_count: 0,
      prompt_version: 'role-clarifier-v9',
    })
    const hrDetailResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}`,
      headers: { cookie: hrCookie },
    })
    let hrDetail = hrDetailResponse.json()
    expect(hrDetail.state.calibration_status).toBe('HR_REVIEW')
    expect(hrDetail.state.candidate_count).toBe(10)

    const adviceResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}/messages`,
      headers: { cookie: hrCookie },
      payload: { content: '请给出当前岗位画像校准建议' },
    })
    expect(adviceResponse.statusCode, adviceResponse.body).toBe(202)
    const adviceRunId = adviceResponse.json().run_id
    let adviceRun
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const status = await app.inject({
        method: 'GET',
        url: `/api/v1/agent-runs/${adviceRunId}`,
        headers: { cookie: hrCookie },
      })
      adviceRun = status.json().run
      if (adviceRun.status === 'COMPLETED') break
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    expect(adviceRun).toMatchObject({
      task: 'CALIBRATION_ADVICE',
      status: 'COMPLETED',
      tool_count: 0,
      prompt_version: 'role-router-v2+role-clarifier-v10',
    })

    hrDetail = (
      await app.inject({
        method: 'GET',
        url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}`,
        headers: { cookie: hrCookie },
      })
    ).json()
    const signal = hrDetail.calibration_signals[0]
    expect(signal.proposed_change).toMatchObject({
      signal_type: 'RECRUITMENT_SIGNAL',
      disposition: 'HR_REVIEW_REQUIRED',
      manager_task_created: false,
      formal_profile_changed: false,
    })
    const reviewResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}/calibration-signals/${signal.id}:review`,
      headers: { cookie: hrCookie },
      payload: {
        decision: 'APPROVE',
        reason: '两个渠道均重复出现相同能力证据卡点',
        expected_revision: hrDetail.state.revision,
      },
    })
    expect(reviewResponse.statusCode, reviewResponse.body).toBe(200)
    expect(reviewResponse.json().task.status).toBe('OPEN')

    const managerCookie = await login(app, 'manager-demo')
    const managerDetail = (
      await app.inject({
        method: 'GET',
        url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}`,
        headers: { cookie: managerCookie },
      })
    ).json()
    expect(managerDetail.calibration_signals).toBeUndefined()
    expect(managerDetail.manager_tasks).toHaveLength(1)
    const task = managerDetail.manager_tasks[0]
    const decisionResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}/manager-tasks/${task.id}:decide`,
      headers: { cookie: managerCookie },
      payload: {
        decision: 'APPROVE',
        reason: '同意重开岗位画像草稿，优先校准业务判断锚点',
        expected_revision: managerDetail.state.revision,
      },
    })
    expect(decisionResponse.statusCode, decisionResponse.body).toBe(200)
    expect(decisionResponse.json().task.status).toBe('ACCEPTED')
  })

  it('未登录请求不能通过请求参数伪造角色', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/role-sessions/${DEMO_ROLE_SESSION_ID}?actor_role=HR&tenant_id=tenant-demo`,
    })
    expect(response.statusCode).toBe(401)
  })

  it('服务重启后会关闭中断的 Run，并在对话中保留可重试提示', async () => {
    const store = new MemoryStore()
    await store.initialize()
    const createdAt = new Date().toISOString()
    await store.createRun({
      id: '22222222-2222-4222-8222-222222222222',
      role_session_id: DEMO_ROLE_SESSION_ID,
      actor_user_id: 'hr-demo',
      status: 'RUNNING',
      model_tier: 'FLASH',
      task: 'CLARIFY_MESSAGE',
      harness_session_id: `role-${DEMO_ROLE_SESSION_ID}`,
      prompt_version: 'role-clarifier-v1',
      model_name: 'deepseek-v4-flash',
      tool_count: 0,
      input_tokens: 0,
      output_tokens: 0,
      started_at: createdAt,
      completed_at: null,
      error_code: null,
      input_message_id: '33333333-3333-4333-8333-333333333333',
      output_message_id: null,
    })
    await store.appendConversationMessage({
      id: '33333333-3333-4333-8333-333333333333',
      tenant_id: 'tenant-demo',
      role_session_id: DEMO_ROLE_SESSION_ID,
      run_id: '22222222-2222-4222-8222-222222222222',
      clarification_round_id: null,
      sender_type: 'HUMAN',
      sender_user_id: 'hr-demo',
      sender_role: 'HR',
      sender_name: 'HR · 林夏',
      content: '这条消息在部署切换时仍在执行',
      structured_content: null,
      status: 'COMPLETED',
      sequence: 1,
      created_at: createdAt,
      completed_at: createdAt,
    })

    const recoveringApp = await buildApp(config, { store, harness: testHarness })
    const recovered = await store.getRun('22222222-2222-4222-8222-222222222222')
    const messages = await store.listConversationMessages(DEMO_ROLE_SESSION_ID)
    const events = await store.listRunEvents('22222222-2222-4222-8222-222222222222')

    expect(recovered?.run.status).toBe('FAILED')
    expect(recovered?.run.error_code).toBe('RUN_INTERRUPTED')
    expect(messages.at(-1)?.sender_type).toBe('SYSTEM')
    expect(messages.at(-1)?.content).toContain('原消息已保留')
    expect(events.map((event) => event.type)).toEqual(['run.failed', 'assistant.completed'])
    await recoveringApp.close()
  })
})
