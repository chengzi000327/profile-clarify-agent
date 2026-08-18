import { createHash } from 'node:crypto'
import { z } from 'zod'
import type {
  ActorContext,
  ActorRole,
  ArtifactEnvelope,
  ArtifactType,
  ConversationMessage,
} from '@role-clarifier/contracts'
import type { AppConfig } from '../config.js'
import type { AgentRunner } from '../agent/runner.js'
import type { RoleService } from '../services/role-service.js'
import type { ApplicationStore } from '../store/index.js'

const FeishuChallengeSchema = z.object({
  type: z.literal('url_verification'),
  challenge: z.string().min(1),
  token: z.string().min(1),
})

const FeishuMessageEventSchema = z.object({
  schema: z.literal('2.0'),
  header: z.object({
    event_id: z.string().min(1),
    event_type: z.literal('im.message.receive_v1'),
    token: z.string().min(1),
    tenant_key: z.string().min(1),
  }),
  event: z.object({
    sender: z.object({
      sender_id: z.object({ open_id: z.string().min(1) }),
      sender_type: z.string(),
    }),
    message: z.object({
      message_id: z.string().min(1),
      chat_id: z.string().min(1),
      chat_type: z.string(),
      message_type: z.string(),
      content: z.string(),
    }),
  }),
})

const UserMappingSchema = z.record(
  z.string(),
  z.object({
    account_id: z.string().min(3).max(80),
    display_name: z.string().min(1).max(40),
    role: z.enum(['MANAGER', 'HR', 'ADMIN']),
  }),
)

type FeishuCard = Record<string, unknown>

export interface FeishuClientLike {
  configured(): boolean
  sendText?(chatId: string, text: string): Promise<void>
  sendCard(chatId: string, card: FeishuCard): Promise<void>
}

export class FeishuOpenApiClient implements FeishuClientLike {
  private accessToken: { value: string; expiresAt: number } | null = null

  constructor(private readonly config: AppConfig) {}

  configured(): boolean {
    return Boolean(
      this.config.FEISHU_ENABLED
      && this.config.FEISHU_APP_ID
      && this.config.FEISHU_APP_SECRET
      && this.config.FEISHU_VERIFICATION_TOKEN,
    )
  }

  async sendCard(chatId: string, card: FeishuCard): Promise<void> {
    await this.sendMessage(chatId, 'interactive', JSON.stringify(card))
  }

  async sendText(chatId: string, text: string): Promise<void> {
    await this.sendMessage(chatId, 'text', JSON.stringify({ text: text.slice(0, 20_000) }))
  }

  private async sendMessage(
    chatId: string,
    messageType: 'text' | 'interactive',
    content: string,
  ): Promise<void> {
    const token = await this.getTenantAccessToken()
    const response = await fetch(
      `${this.config.FEISHU_API_BASE_URL}/im/v1/messages?receive_id_type=chat_id`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify({
          receive_id: chatId,
          msg_type: messageType,
          content,
        }),
      },
    )
    const payload = await response.json() as { code?: number; msg?: string }
    if (!response.ok || payload.code !== 0) {
      throw new Error(`Feishu send failed (${response.status}): ${payload.msg ?? 'unknown error'}`)
    }
  }

  private async getTenantAccessToken(): Promise<string> {
    if (this.accessToken && this.accessToken.expiresAt > Date.now() + 5 * 60_000) {
      return this.accessToken.value
    }
    if (!this.config.FEISHU_APP_ID || !this.config.FEISHU_APP_SECRET) {
      throw new Error('Feishu app credentials are not configured')
    }
    const response = await fetch(
      `${this.config.FEISHU_API_BASE_URL}/auth/v3/tenant_access_token/internal`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify({
          app_id: this.config.FEISHU_APP_ID,
          app_secret: this.config.FEISHU_APP_SECRET,
        }),
      },
    )
    const payload = await response.json() as {
      code?: number
      msg?: string
      tenant_access_token?: string
      expire?: number
    }
    if (!response.ok || payload.code !== 0 || !payload.tenant_access_token) {
      throw new Error(`Feishu token failed (${response.status}): ${payload.msg ?? 'unknown error'}`)
    }
    this.accessToken = {
      value: payload.tenant_access_token,
      expiresAt: Date.now() + Math.max(600, payload.expire ?? 7_200) * 1_000,
    }
    return this.accessToken.value
  }
}

const stableId = (prefix: string, value: string): string =>
  `${prefix}-${createHash('sha256').update(value).digest('hex').slice(0, 24)}`

const parseTextMessage = (content: string): string | null => {
  try {
    const value = JSON.parse(content) as { text?: unknown }
    return typeof value.text === 'string' ? value.text.trim() : null
  } catch {
    return null
  }
}

const markdownCard = (
  title: string,
  markdown: string,
  webOrigin: string,
  template = 'blue',
): FeishuCard => ({
  config: { wide_screen_mode: true, update_multi: true },
  header: {
    template,
    title: { tag: 'plain_text', content: title },
  },
  elements: [
    { tag: 'markdown', content: markdown.slice(0, 12_000) },
    { tag: 'hr' },
    {
      tag: 'note',
      elements: [
        { tag: 'plain_text', content: '画像澄清 Agent · Web 与飞书共用同一业务事实源' },
      ],
    },
    {
      tag: 'action',
      actions: [
        {
          tag: 'button',
          text: { tag: 'plain_text', content: '在 Web 工作台查看' },
          type: 'default',
          url: webOrigin,
        },
      ],
    },
  ],
})

const outputMessageText = (message: ConversationMessage): string => {
  const question = typeof message.structured_content?.question === 'string'
    ? message.structured_content.question
    : null
  return [
    message.content,
    ...(question ? [`下一步需要你补充：\n${question}`] : []),
  ].join('\n\n')
}

const artifactMarkdown = (artifact: ArtifactEnvelope): string => {
  const content = artifact.content as Record<string, unknown>
  if (artifact.type === 'ROLE_PROFILE') {
    const outcomes = Array.isArray(content.outcomes)
      ? content.outcomes.map((item) => {
          const value = item as Record<string, unknown>
          return `- **${String(value.horizon ?? '阶段')}**：${String(value.result ?? '')}`
        }).join('\n')
      : ''
    const capabilities = Array.isArray(content.capabilities)
      ? content.capabilities.map((item) => {
          const value = item as Record<string, unknown>
          return `- **${String(value.name ?? '')}**（${String(value.level ?? '')}）：${String(value.evidence ?? '')}`
        }).join('\n')
      : ''
    return `**岗位使命**\n${String(content.mission ?? '待补充')}\n\n**预期结果**\n${outcomes || '- 待补充'}\n\n**关键能力**\n${capabilities || '- 待补充'}`
  }
  if (artifact.type === 'PUBLIC_JD') {
    const header = content.title_and_basics as Record<string, unknown> | undefined
    const duties = Array.isArray(content.what_you_will_do)
      ? content.what_you_will_do.map((item) => `- ${String(item)}`).join('\n')
      : '- 待补充'
    const requirements = Array.isArray(content.what_we_look_for)
      ? content.what_we_look_for.map((item) => `- ${String(item)}`).join('\n')
      : '- 待补充'
    return `**职位标题与基本信息**\n${String(header?.title ?? '待补充')} · ${String(header?.location ?? '')}\n\n**关于岗位**\n${String(content.about_the_role ?? '')}\n\n**你会做什么**\n${duties}\n\n**我们希望你具备**\n${requirements}`
  }
  return `\`\`\`json\n${JSON.stringify(content, null, 2).slice(0, 9_000)}\n\`\`\``
}

const artifactTitle: Record<ArtifactType, string> = {
  ROLE_PROFILE: '岗位画像',
  ASSESSMENT_SCORECARD: '评估方案',
  PUBLIC_JD: '四段式 JD',
  HR_RECRUITING_BRIEF: 'HR 招聘画像',
}

export class FeishuGateway {
  private readonly mappings: z.infer<typeof UserMappingSchema>

  constructor(
    private readonly config: AppConfig,
    private readonly store: ApplicationStore,
    private readonly roleService: RoleService,
    private readonly runner: AgentRunner,
    private readonly client: FeishuClientLike,
    private readonly onError: (error: unknown) => void,
  ) {
    try {
      this.mappings = UserMappingSchema.parse(JSON.parse(config.FEISHU_USER_MAPPINGS_JSON))
    } catch {
      this.mappings = {}
    }
  }

  status(): { enabled: boolean; configured: boolean; webhook_path: string } {
    return {
      enabled: this.config.FEISHU_ENABLED,
      configured: this.client.configured(),
      webhook_path: '/api/v1/integrations/feishu/events',
    }
  }

  async receive(body: unknown): Promise<Record<string, unknown>> {
    const challenge = FeishuChallengeSchema.safeParse(body)
    if (challenge.success) {
      this.verifyToken(challenge.data.token)
      return { challenge: challenge.data.challenge }
    }
    const event = FeishuMessageEventSchema.parse(body)
    this.verifyToken(event.header.token)
    if (!this.client.configured()) throw new Error('Feishu integration is not configured')
    const claimed = await this.store.claimExternalEvent(
      'FEISHU',
      event.event.message.message_id || event.header.event_id,
    )
    if (!claimed) return { ok: true, duplicate: true }
    queueMicrotask(() => {
      void this.processMessage(event).catch(this.onError)
    })
    return { ok: true }
  }

  private verifyToken(token: string): void {
    if (!this.config.FEISHU_VERIFICATION_TOKEN || token !== this.config.FEISHU_VERIFICATION_TOKEN) {
      throw new Error('Feishu verification token is invalid')
    }
  }

  private actorFor(openId: string): ActorContext {
    const tenantId = stableId('tenant', this.config.FEISHU_WORKSPACE_ID.trim().toLowerCase())
    const mapping = this.mappings[openId]
    const accountId = mapping?.account_id ?? `feishu-${openId}`
    return {
      tenant_id: tenantId,
      user_id: stableId('user', `${tenantId}\u0000${accountId.trim().toLowerCase()}`),
      role: (mapping?.role ?? 'MANAGER') as ActorRole,
      display_name: mapping?.display_name ?? `飞书用户${openId.slice(-4)}`,
    }
  }

  private async sendText(chatId: string, text: string): Promise<void> {
    if (this.client.sendText) {
      await this.client.sendText(chatId, text)
      return
    }
    await this.client.sendCard(
      chatId,
      markdownCard('岗位澄清 Agent', text, this.config.WEB_ORIGIN),
    )
  }

  private async sendArtifactCard(
    chatId: string,
    title: string,
    markdown: string,
    template: string,
  ): Promise<void> {
    try {
      await this.client.sendCard(
        chatId,
        markdownCard(title, markdown, this.config.WEB_ORIGIN, template),
      )
    } catch (error) {
      this.onError(error)
      await this.sendText(chatId, `${title}\n\n${markdown}`)
    }
  }

  private async processMessage(event: z.infer<typeof FeishuMessageEventSchema>): Promise<void> {
    const { sender, message } = event.event
    if (sender.sender_type !== 'user') return
    if (message.chat_type !== 'p2p') {
      await this.sendText(
        message.chat_id,
        '为避免把不同成员的岗位与权限混在一起，当前 MVP 请先在机器人单聊中进行岗位澄清。',
      )
      return
    }
    if (message.message_type !== 'text') {
      await this.sendText(
        message.chat_id,
        '当前暂不支持这种消息，请发送文字描述招聘需求。',
      )
      return
    }
    const text = parseTextMessage(message.content)
    if (!text) return
    const actor = this.actorFor(sender.sender_id.open_id)
    await this.store.saveUser({ ...actor, active: true })

    if (/^(新岗位|新建岗位|\/new)$/i.test(text)) {
      await this.roleService.createIntake(actor)
      await this.sendText(
        message.chat_id,
        '新的岗位对话已开始。\n\n不用填写表单，请直接说说你遇到了什么业务问题、为什么想招人，Agent 会在对话中建立岗位。',
      )
      return
    }

    let roles = await this.roleService.list(actor)
    let role = roles[0]
    if (!role) {
      const created = await this.roleService.createIntake(actor)
      role = created.state
      roles = [role]
    }

    const artifactCommand: Array<[RegExp, ArtifactType]> = [
      [/生成.*岗位画像|输出.*岗位画像/, 'ROLE_PROFILE'],
      [/生成.*评估方案|输出.*评估方案|生成.*评分卡/, 'ASSESSMENT_SCORECARD'],
      [/生成.*JD|输出.*JD|生成.*职位描述/i, 'PUBLIC_JD'],
      [/生成.*HR.*画像|输出.*HR.*画像/i, 'HR_RECRUITING_BRIEF'],
    ]
    const requestedArtifact = artifactCommand.find(([pattern]) => pattern.test(text))?.[1]
    const run = requestedArtifact
      ? await this.runner.submitArtifact(role.id, actor, requestedArtifact)
      : (await this.runner.submitMessage(role.id, actor, text)).run

    const completed = await this.waitForRun(run.id)
    if (completed.status !== 'COMPLETED') {
      await this.sendText(
        message.chat_id,
        'Agent 本轮未完成。消息已经保存，请稍后继续发送，或到 Web 工作台查看 Trace。',
      )
      return
    }

    const view = await this.roleService.get(role.id, actor)
    if (requestedArtifact) {
      const artifact = view.artifacts
        .filter((item) => item.type === requestedArtifact)
        .sort((left, right) => right.version - left.version)[0]
      if (artifact) {
        await this.sendArtifactCard(
          message.chat_id,
          `${view.state.title} · ${artifactTitle[requestedArtifact]} v${artifact.version}`,
          artifactMarkdown(artifact),
          requestedArtifact === 'HR_RECRUITING_BRIEF' ? 'purple' : 'blue',
        )
      }
      return
    }

    const messages = await this.store.listConversationMessages(role.id)
    const output = messages.find((item) => item.id === completed.output_message_id)
    if (output) {
      await this.sendText(message.chat_id, outputMessageText(output))
    }
  }

  private async waitForRun(runId: string): Promise<{ status: string; output_message_id: string | null }> {
    const initial = await this.store.getRun(runId)
    if (initial && ['COMPLETED', 'FAILED', 'CANCELLED'].includes(initial.run.status)) {
      return initial.run
    }
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        unsubscribe()
        reject(new Error('Timed out waiting for Agent Run'))
      }, 75_000)
      const unsubscribe = this.store.subscribeToRun(runId, (event) => {
        if (event.type !== 'run.completed' && event.type !== 'run.failed') return
        clearTimeout(timeout)
        unsubscribe()
        void this.store.getRun(runId).then((record) => {
          if (!record) reject(new Error('Agent Run disappeared'))
          else resolve(record.run)
        }, reject)
      })
    })
  }
}
