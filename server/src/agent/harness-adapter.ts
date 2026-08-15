import type {
  ArtifactType,
  CandidateEvidence,
  RoleState,
  ToolExecutionContext,
} from '@role-clarifier/contracts'
import type { AppConfig } from '../config.js'

export type HarnessTask =
  | 'CLARIFY_MESSAGE'
  | 'GENERATE_ROLE_PROFILE'
  | 'GENERATE_ASSESSMENT'
  | 'GENERATE_JD'
  | 'GENERATE_HR_BRIEF'
  | 'EXTRACT_CANDIDATES'
  | 'CALIBRATION_ADVICE'

export interface CandidateImportItem {
  candidate_ref: string
  channel: string
  format: 'JSON' | 'TEXT'
  content: string | Record<string, unknown>
}

export interface HarnessRequest {
  task: HarnessTask
  role_state: RoleState
  message?: string
  candidates?: CandidateImportItem[]
  execution_context: ToolExecutionContext
  maximum_transitions: 10
  structured_output_repair_attempts: 1
}

export type HarnessResult =
  | {
      kind: 'CLARIFICATION'
      persistence?: 'CALLER' | 'TOOL'
      answer: string
      question: string
      fact_draft: {
        category: 'HIRING_REASON' | 'SUCCESS_CRITERION'
        statement: string
      }
    }
  | { kind: 'ARTIFACT'; persistence?: 'CALLER' | 'TOOL'; artifact_type: ArtifactType; content: unknown; summary: string }
  | { kind: 'CANDIDATE_EVIDENCE'; persistence?: 'CALLER' | 'TOOL'; candidates: CandidateEvidence[]; summary: string }
  | {
      kind: 'CALIBRATION_ADVICE'
      persistence?: 'CALLER' | 'TOOL'
      summary: string
      proposed_change: Record<string, unknown>
    }

export interface HarnessTrace {
  model: string
  provider: string
  harness_source_version?: string
  harness_commit?: string
  tool_count: number
  input_tokens: number
  output_tokens: number
  duration_ms: number
  repaired: boolean
  recovered_from_tool?: boolean
}

export interface HarnessHooks {
  signal: AbortSignal
  onStatus(status: string): Promise<void>
  onDelta(delta: string): Promise<void>
  onToolStarted(name: string): Promise<void>
  onToolCompleted(name: string, summary: string): Promise<void>
  onTrace(trace: HarnessTrace): Promise<void>
}

export interface HarnessAdapter {
  run(request: HarnessRequest, hooks: HarnessHooks): Promise<HarnessResult>
}

const abortablePause = async (signal: AbortSignal, milliseconds = 25): Promise<void> => {
  if (signal.aborted) throw new DOMException('Run cancelled', 'AbortError')
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(resolve, milliseconds)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timeout)
        reject(new DOMException('Run cancelled', 'AbortError'))
      },
      { once: true },
    )
  })
}

const artifactTypeByTask: Partial<Record<HarnessTask, ArtifactType>> = {
  GENERATE_ROLE_PROFILE: 'ROLE_PROFILE',
  GENERATE_ASSESSMENT: 'ASSESSMENT_SCORECARD',
  GENERATE_JD: 'PUBLIC_JD',
  GENERATE_HR_BRIEF: 'HR_RECRUITING_BRIEF',
}

const textOf = (value: unknown): string =>
  typeof value === 'string' ? value : JSON.stringify(value)

const extractCandidate = (item: CandidateImportItem): CandidateEvidence => {
  const text = textOf(item.content)
  const bottlenecks: string[] = []
  if (/商业|业务判断|取舍/.test(text) && /不足|缺少|较弱|未体现/.test(text)) {
    bottlenecks.push('商业判断证据不足')
  }
  if (/跨团队|协作|推动/.test(text) && /不足|缺少|较弱|未体现/.test(text)) {
    bottlenecks.push('跨团队推动证据不足')
  }
  if (/抽象|结构化|拆解/.test(text) && /不足|缺少|较弱|未体现/.test(text)) {
    bottlenecks.push('复杂问题抽象证据不足')
  }
  return {
    candidate_ref: item.candidate_ref,
    channel: item.channel,
    source_format: item.format,
    evidence: [
      {
        criterion: '业务判断',
        signal: /商业|增长|业务/.test(text) ? 'MIXED' : 'MISSING',
        excerpt: /商业|增长|业务/.test(text)
          ? '资料包含业务或增长相关经历，仍需面试验证本人判断。'
          : '资料中未发现可验证的业务判断证据。',
      },
      {
        criterion: '跨团队推动',
        signal: /跨团队|协作|推动/.test(text) ? 'MIXED' : 'MISSING',
        excerpt: /跨团队|协作|推动/.test(text)
          ? '资料提到协作或推动经历，需要进一步确认责任边界。'
          : '资料中未发现跨团队推动证据。',
      },
    ],
    bottlenecks,
  }
}

export class DeterministicHarnessAdapter implements HarnessAdapter {
  async run(request: HarnessRequest, hooks: HarnessHooks): Promise<HarnessResult> {
    await hooks.onStatus(
      request.task === 'CLARIFY_MESSAGE' || request.task === 'EXTRACT_CANDIDATES'
        ? 'Flash 正在提取事实与证据'
        : 'Pro 正在生成正式产物草稿',
    )
    await abortablePause(hooks.signal)
    await hooks.onToolStarted('read_role_state')
    await abortablePause(hooks.signal)
    await hooks.onToolCompleted(
      'read_role_state',
      `已读取岗位状态 rev.${request.role_state.revision}`,
    )

    if (request.task === 'CLARIFY_MESSAGE') {
      const message = request.message?.trim() ?? ''
      const category =
        request.role_state.facts.some((fact) => fact.category === 'HIRING_REASON')
          ? 'SUCCESS_CRITERION'
          : 'HIRING_REASON'
      const answer =
        category === 'HIRING_REASON'
          ? '我已把这段信息整理为招聘原因草稿，正式进入画像前需要你确认它是否准确。'
          : '我已把成功标准整理为可验证的事实草稿，接下来会用它约束岗位画像和评估方案。'
      const question =
        category === 'HIRING_REASON'
          ? '如果这个岗位半年后招聘成功，最重要的一个可观察业务结果是什么？'
          : '这个结果由谁验收、用什么指标判断达成？'
      await hooks.onToolStarted('save_fact_draft')
      await abortablePause(hooks.signal)
      await hooks.onToolCompleted('save_fact_draft', '事实草稿已通过领域校验')
      await hooks.onDelta(answer)
      return {
        kind: 'CLARIFICATION',
        answer,
        question,
        fact_draft: {
          category,
          statement: message,
        },
      }
    }

    if (request.task === 'EXTRACT_CANDIDATES') {
      const evidence = (request.candidates ?? []).map(extractCandidate)
      await hooks.onToolStarted('save_candidate_evidence')
      await abortablePause(hooks.signal)
      await hooks.onToolCompleted(
        'save_candidate_evidence',
        `已结构化 ${evidence.length} 份脱敏候选人证据`,
      )
      const summary = `已完成 ${evidence.length} 份候选人证据分析，并按统一标准标注卡点。`
      await hooks.onDelta(summary)
      return { kind: 'CANDIDATE_EVIDENCE', candidates: evidence, summary }
    }

    if (request.task === 'CALIBRATION_ADVICE') {
      const summary = '建议用候选人证据复核画像中的能力锚点，不直接改变正式画像。'
      await hooks.onDelta(summary)
      return {
        kind: 'CALIBRATION_ADVICE',
        summary,
        proposed_change: { action: 'REVIEW_CAPABILITY_ANCHORS' },
      }
    }

    const type = artifactTypeByTask[request.task]
    if (!type) throw new Error(`Unsupported Harness task: ${request.task}`)
    const content = this.makeArtifact(type, request.role_state)
    await hooks.onToolStarted('save_artifact_draft')
    await abortablePause(hooks.signal)
    await hooks.onToolCompleted('save_artifact_draft', `${type} 草稿已通过 Schema 校验`)
    const summary = '草稿已生成。它只基于已同步事实，仍需对应角色确认后才能成为正式版本。'
    await hooks.onDelta(summary)
    return { kind: 'ARTIFACT', artifact_type: type, content, summary }
  }

  private makeArtifact(type: ArtifactType, state: RoleState): unknown {
    if (type === 'ROLE_PROFILE') {
      return {
        mission: `在${state.department}连接业务目标、产品方案与跨团队交付，并对可验证结果负责。`,
        outcomes: [
          { horizon: '30 天', result: '完成业务、用户与协作方访谈，形成问题和机会地图' },
          { horizon: '90 天', result: '形成岗位路线图并推动一个关键方案进入验证' },
          { horizon: '180 天', result: '建立可复用的策略、协作与结果复盘机制' },
        ],
        capabilities: [
          { name: '业务判断', level: '高级', evidence: '能说明关键取舍、证据和风险' },
          { name: '复杂问题抽象', level: '高级', evidence: '能把模糊目标拆成可验证假设' },
          { name: '跨团队推动', level: '高级', evidence: '能在复杂协作关系中形成承诺并闭环' },
        ],
        boundaries: ['负责岗位路线图和关键方案；HC、预算与薪酬由授权角色决策'],
      }
    }
    if (type === 'ASSESSMENT_SCORECARD') {
      return {
        dimensions: [
          {
            name: '业务判断',
            weight: 35,
            method: '结构化案例访谈',
            anchors: ['识别核心约束', '说明取舍与风险', '用结果验证判断'],
          },
          {
            name: '复杂问题抽象',
            weight: 35,
            method: '现场 Case',
            anchors: ['定义问题边界', '拆解关键假设', '形成可执行路径'],
          },
          {
            name: '跨团队推动',
            weight: 30,
            method: '行为访谈',
            anchors: ['建立共同目标', '处理冲突', '持续闭环'],
          },
        ],
        decision_rule: '任一核心维度低于 3/5 不建议录用；总分相同优先业务判断。',
      }
    }
    if (type === 'PUBLIC_JD') {
      return {
        title_and_basics: {
          title: state.title,
          location: '上海 / 可协商',
          employment_type: '全职',
          reporting_line: `${state.department}负责人`,
        },
        about_the_role: `你将加入${state.department}，围绕关键业务目标定义问题、推动方案落地，并对可验证的结果负责。`,
        what_you_will_do: [
          '与业务、产品和交付团队澄清目标，将复杂问题拆成可执行路线图',
          '建立结果指标和复盘机制，持续推动跨团队协作与交付质量',
          '基于用户和业务反馈迭代方案，对关键取舍给出清晰判断',
        ],
        what_we_look_for: [
          '具备复杂问题抽象、结构化分析和端到端推动能力',
          '能用事实与结果沟通，并在信息不完整时做出高质量判断',
          '认同协作透明、责任清晰、持续复盘的工作方式',
        ],
      }
    }
    return {
      sourcing: {
        priority_channels: ['行业社群与定向寻访', '内部推荐'],
        search_titles: [state.title, `${state.title}负责人`, '产品策略负责人'],
      },
      calibration_notes: [
        '不要用品牌背景替代真实能力证据',
        '重点验证候选人是否亲自完成关键取舍',
      ],
      screening_questions: [
        '请讲一个你在信息不完整时做出业务取舍并验证结果的案例。',
        '请讲一个没有直接汇报关系但需要你推动多方交付的案例。',
      ],
    }
  }
}

export class SidecarHarnessAdapter implements HarnessAdapter {
  constructor(private readonly config: AppConfig) {}

  async run(request: HarnessRequest, hooks: HarnessHooks): Promise<HarnessResult> {
    await hooks.onStatus('DeepSeek Harness Sidecar 正在执行')
    const response = await fetch(`${this.config.HARNESS_BASE_URL}/v1/role-clarifier/runs`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.config.HARNESS_SIDECAR_TOKEN}`,
      },
      body: JSON.stringify(request),
      signal: hooks.signal,
    })
    if (!response.ok) {
      const body = await response.text()
      let detail = body.slice(0, 500)
      try {
        const parsed = JSON.parse(body) as { error?: { message?: string; code?: string } }
        detail = parsed.error?.message ?? parsed.error?.code ?? detail
      } catch {
        // Preserve the bounded response text when the sidecar did not return JSON.
      }
      throw new Error(`Harness Sidecar returned ${response.status}: ${detail}`)
    }
    const result = (await response.json()) as {
      result: HarnessResult
      events?: Array<
        | { type: 'status'; value: string }
        | { type: 'delta'; value: string }
        | { type: 'tool.started'; value: string }
        | { type: 'tool.completed'; value: string; summary: string }
      >
      trace: HarnessTrace
    }
    for (const event of result.events ?? []) {
      if (event.type === 'status') await hooks.onStatus(event.value)
      else if (event.type === 'delta') await hooks.onDelta(event.value)
      else if (event.type === 'tool.started') await hooks.onToolStarted(event.value)
      else await hooks.onToolCompleted(event.value, event.summary)
    }
    await hooks.onTrace(result.trace)
    return result.result
  }
}

export const createHarnessAdapter = (config: AppConfig): HarnessAdapter =>
  config.HARNESS_MODE === 'sidecar'
    ? new SidecarHarnessAdapter(config)
    : new DeterministicHarnessAdapter()
