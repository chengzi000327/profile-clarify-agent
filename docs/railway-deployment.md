# Railway 部署说明

## 服务拓扑

```text
Browser -> web (public HTTPS)
              |-- /api, /healthz -> api (Railway private network)
                                         |-- PostgreSQL
                                         `-- harness-sidecar
                                                   |-- DeepSeek API
                                                   `-- api internal tools
```

浏览器不直接访问 API 或 Harness，因此登录 Cookie、REST 和 SSE 保持同源。Web 服务使用 Caddy 代理并按 DNS TTL 重新解析 API 私网地址；API、Harness 和数据库只走 Railway 私网。

## 服务变量

### web

- `RAILWAY_DOCKERFILE_PATH=/frontend/Dockerfile`
- `PORT=80`
- `API_UPSTREAM=http://api.railway.internal:4100`

### api

- `RAILWAY_DOCKERFILE_PATH=/server/Dockerfile`
- `NODE_ENV=production`
- `HOST=::`
- `PORT=4100`
- `DATABASE_URL=${{Postgres.DATABASE_URL}}`
- `WEB_ORIGIN=https://<web service public domain>`
- `HARNESS_BASE_URL=http://harness-sidecar.railway.internal:4110`
- `DEEPSEEK_FLASH_MODEL=deepseek-v4-flash`
- `DEEPSEEK_PRO_MODEL=deepseek-v4-pro`
- `AGENT_CONCURRENCY=4`
- `TOOL_TIMEOUT_MS=5000`
- `SESSION_SECRET=<secret>`
- `HARNESS_SIDECAR_TOKEN=<shared secret>`
- `ROLE_AGENT_TOOL_TOKEN=<shared secret>`
- `ENTERPRISE_CONTEXT_RETRIEVAL_ENABLED=true`
- `HC_EVENT_SECRET=<至少 32 位的独立 secret>`
- `HC_EVENT_MAX_SKEW_SECONDS=300`
- `NOTIFICATION_DISPATCH_ENABLED=false`（完成飞书经理映射与回调验收后再改为 `true`）
- `NOTIFICATION_POLL_INTERVAL_MS=5000`
- `NOTIFICATION_BATCH_SIZE=20`
- `NOTIFICATION_LEASE_MS=30000`
- `FEISHU_ENABLED=false`（连接飞书时改为 `true`）
- `FEISHU_APP_ID=<Feishu App ID>`
- `FEISHU_APP_SECRET=<secret>`
- `FEISHU_VERIFICATION_TOKEN=<secret>`
- `FEISHU_WORKSPACE_ID=<与 Web 登录一致的企业空间 ID>`
- `FEISHU_USER_MAPPINGS_JSON=<可选，飞书 open_id 到 Web 账号的映射>`

`HC_EVENT_SECRET`、飞书凭据和完整用户映射只放 Railway Variables，不写入仓库、命令输出或 Trace。`HC_EVENT_URL` 只供外部演示发送脚本使用，不是 API 服务变量。生产启用 Dispatcher 的顺序固定为：飞书回调验证成功 → 有效用人经理映射 → 用测试 HC 验证卡片 → `NOTIFICATION_DISPATCH_ENABLED=true`。HR 只在站内查看进度，不配置为提醒兜底。

### Mock HRIS 演示事件

外部系统把审批完成事件发送到公开 Web 的同源代理地址：

```text
https://<web service public domain>/api/v1/integrations/mock-hris/hc-events
```

本地或受控运维终端可运行：

```bash
HC_EVENT_URL=https://<web service public domain>/api/v1/integrations/mock-hris/hc-events \
HC_EVENT_SECRET=<与 API 相同的密钥> corepack pnpm hc:demo:event
```

脚本每次生成唯一 HC 编号并映射到 `tenant-demo` 的 `manager-demo` 和 `hr-demo`。命令只输出 API 响应，不输出密钥或飞书映射；同一个 `event_id` 重放时应返回幂等结果，不得创建第二个任务或第二条通知。

## 三项闭环的运行边界

- **事实确认**：Agent 只写草稿。用人经理在原对话内确认、修订或驳回；仍有待确认事实时正式画像生成返回业务冲突并引导回到对话。事实变化会让引用旧事实的已确认产物失效，Decision Log 和 Trace 保留操作者、来源消息与 Run。
- **企业知识检索**：只检索当前租户内有效、当前角色可见且与任务匹配的模拟组织、岗位族、职级、历史 JD、画像案例、招聘规范和面试标准；最多返回六条摘要及来源版本。候选人提取和校准任务不执行该检索，候选人隐私不会混入岗位澄清上下文。
- **HC 主动任务**：签名与时间窗校验通过后，HC、经理任务和通知 Outbox 原子落库；重复事件幂等。提醒只发用人经理一次，HR 站内查看进度；未绑定、重试和最终失败都有明确状态。
- **前端范围**：仅增加 HC 小状态、原消息内事实确认卡、岗位页待处理数量；不改导航、总体布局、岗位画像正文、HR 共享工作区和 Trace 位置。

### harness-sidecar

- `RAILWAY_DOCKERFILE_PATH=/harness-sidecar/Dockerfile`
- `NODE_ENV=production`
- `HOST=::`
- `SIDECAR_PORT=4110`
- `ROLE_AGENT_INTERNAL_URL=http://api.railway.internal:4100`
- `DEEPSEEK_API_KEY=<secret>`
- `DEEPSEEK_BASE_URL=https://api.deepseek.com`
- `DEEPSEEK_FLASH_MODEL=deepseek-v4-flash`
- `DEEPSEEK_PRO_MODEL=deepseek-v4-pro`
- `DSH_MAX_TOKENS=16384`
- `DSH_RUN_TIMEOUT_MS=90000`
- `DSH_ROLE_PROFILE_TIMEOUT_MS=240000`
- `SIDECAR_CONCURRENCY=4`
- `HARNESS_SIDECAR_TOKEN=<same shared secret as api>`
- `ROLE_AGENT_TOOL_TOKEN=<same shared secret as api>`

## 发布门禁

1. 三个 Docker 镜像构建成功。
2. `api` 和 `harness-sidecar` 的 `/healthz` 在私网可访问。
3. `web` 的公开 `/healthz` 返回 200。
4. 三个固定账号登录后进入岗位澄清会话，默认内容区显示 10 条产研/算法已审批 HC，招聘类型覆盖新增、离职补充、汰换补充、组织调整和其他补充；进入岗位后左侧只显示当前会话，岗位画像入口保持可见。
5. 首次选择 HC 后由 Agent 结合审批原因和组织缺口主动发出首问；重复选择同一 HC 返回原会话且不生成重复会话或首问，选择页按真实岗位阶段显示待开始、澄清中或画像状态。
6. HR 账号看得到内部招聘画像，经理账号不可见。
7. 真实 DeepSeek Flash 澄清和 Pro 产物各跑一次。
8. 企业管理员 Trace 分页覆盖租户内全部 Run，并保留完整事件；确认其中不出现 API Key、Cookie 或内部令牌。
9. 若启用飞书，完成回调 URL 验证；机器人单聊第一条消息能够建立岗位，重复事件不产生重复 Run，并能用卡片返回岗位画像。
10. 用签名演示脚本提交一个新 HC：仅用人经理收到一次提醒，HR 站内看到进度；重复提交同一事件不新增任务或通知，缺少映射时为 `UNBOUND`。
11. 经理在对话内确认、修订和驳回事实；并发旧版本返回 409 后刷新，待确认事实阻止正式画像生成，全部处理后生成恢复。
12. Agent Trace 中能看到企业知识检索来源和版本；经理看不到 HR-only 知识，候选人提取/校准 Run 的企业知识命中为空。

## 数据迁移与回滚

发布前先运行仓库的只读生产备份脚本并记录文件 SHA-256，再执行迁移。`0013_role_clarification_closures.sql` 只新增企业知识、HC 澄清任务、通知 Outbox、渠道绑定，以及事实来源/决定字段；不得删除或覆盖既有岗位、HC、消息、产物、候选人和审计记录。迁移需可重复执行，第二次运行不得重复建表或改写业务数据。

若应用 Smoke Test 失败，先把 `NOTIFICATION_DISPATCH_ENABLED` 改回 `false` 阻止新通知投递，再回滚 `web`、`api` 和 `harness-sidecar` 到发布前记录的成功部署。新增表和字段保留，避免破坏已写入的任务和审计数据；修复后以新提交重新部署，不对生产库做手工删除。
