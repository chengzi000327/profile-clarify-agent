# MVP 实现状态

## 已完成

- pnpm Workspace、Node 24、TypeScript、Fastify、Zod、Drizzle/PostgreSQL。
- users、role_sessions、成员、会话消息、澄清策略/轮次、产物、候选人、校准信号、经理任务、Agent Run/Event 和决策日志。
- 内存/PostgreSQL 双 Store；Docker 测试环境使用 PostgreSQL。
- 动态 Demo 账号：用户填写企业空间、账号和姓名并选择经理/HR/企业管理员；新账号为空、同账号恢复历史，角色首次绑定后不可在登录时切换；管理员拥有企业空间内最高权限。
- 消息 202 + run_id、固定事件 SSE、取消、企业管理员完整执行 Trace。
- 单岗位 Run 串行、全局默认并发 4、最多 10 次工具转换、结构化输出修复预算 1。
- Flash/Pro 任务路由和确定性 CI 模型。
- 四段式 JD Schema、版本、哈希确认、乐观锁和下游失效。
- HR 内部字段服务端过滤；经理不可通过参数或 URL 读取。
- JSON/文本候选人导入、PII 预检、10/2/2 校准、HR 审核、经理任务与决策。
- React 登录、持久化多角色对话、澄清轮次扩展、Agent SSE、动态公开 JD 和权限文案。
- 企业管理员完整 Trace 控制台：全岗位筛选、System Prompt/当前输入/短期会话记忆/长期岗位记忆/任务状态分层、实际模型 Prompt/最终输出、工具入参/返回、Token/延迟、访问审计和租户澄清策略。
- 单元/接口安全测试、Docker Compose、环境样例和 Harness Profile 门禁。
- 官方 Harness `0.1.0-rc.5` 精确源码提交锁、本地构建器和 JSON-RPC Sidecar。
- 真实 `deepseek-v4-flash` / `deepseek-v4-pro` 路由、工具回调、一次结构修复和真实 Token/延迟 Trace 回传。
- Sidecar/API 双 Token 边界，模型不可提供 actor、tenant 或 user 身份。

## 明确不在首期

- 真实 ATS/HC/组织连接器、企业 SSO。
- PDF、DOCX 和图片简历解析。
- 外部招聘渠道发布；当前只到 READY_TO_PUBLISH。
- 生产通知服务；当前只存站内经理任务。
- 未脱敏的真实候选人数据。

## 仍需外部环境完成

- 在本地 `.env` 配置有效 `DEEPSEEK_API_KEY`，执行一次 Flash 澄清和一次 Pro JD 的付费 Smoke Test；代码库不保存密钥。
- 用 Playwright 把 PRD S-01 至 S-12 固化为浏览器端 E2E；当前 P0 权限与 Run 流程在 API 集成测试覆盖。
- 在目标环境执行 50 并发读取、Flash 首事件和 Pro 产物 P95 压测。
- 法务确认真实候选人数据的保留、删除、跨境与审计策略后，才能关闭合成数据门禁。
