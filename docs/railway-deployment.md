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
- `FEISHU_ENABLED=false`（连接飞书时改为 `true`）
- `FEISHU_APP_ID=<Feishu App ID>`
- `FEISHU_APP_SECRET=<secret>`
- `FEISHU_VERIFICATION_TOKEN=<secret>`
- `FEISHU_WORKSPACE_ID=<与 Web 登录一致的企业空间 ID>`
- `FEISHU_USER_MAPPINGS_JSON=<可选，飞书 open_id 到 Web 账号的映射>`

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
