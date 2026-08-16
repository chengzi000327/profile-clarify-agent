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
- `DSH_ROUTER_TIMEOUT_MS=60000`
- `DSH_CLARIFICATION_TIMEOUT_MS=180000`
- `DSH_ARTIFACT_TIMEOUT_MS=360000`
- `DSH_HR_BRIEF_TIMEOUT_MS=480000`
- `SIDECAR_CONCURRENCY=4`
- `HARNESS_SIDECAR_TOKEN=<same shared secret as api>`
- `ROLE_AGENT_TOOL_TOKEN=<same shared secret as api>`

超时按任务分档：Router 使用 60 秒；普通澄清和候选人提取使用 180 秒；岗位画像、评估方案、JD、校准建议和版本对比使用 360 秒；HR Brief 使用 480 秒。每个档位覆盖完整 Harness Turn，包括可能发生的一次结构化修复。

## 发布门禁

1. 三个 Docker 镜像构建成功。
2. `api` 和 `harness-sidecar` 的 `/healthz` 在私网可访问。
3. `web` 的公开 `/healthz` 返回 200。
4. 新账号选择角色后进入空工作台；直接发送第一条消息即可建立岗位，同一账号重新登录可恢复，不同普通账号不可读取；经理可提交消息并收到完整 SSE。
5. HR 账号看得到内部招聘画像，经理账号不可见。
6. 真实 DeepSeek Flash 澄清和 Pro 产物各跑一次。
7. 企业管理员 Trace 将 System Prompt、当前输入、短期会话记忆、长期岗位记忆和任务状态分层展示，同时保留完整用户原文、实际模型输入输出和工具数据；确认其中不出现 API Key、Cookie 或内部令牌。
8. 若启用飞书，完成回调 URL 验证；机器人单聊第一条消息能够建立岗位，重复事件不产生重复 Run，并能用卡片返回岗位画像。
