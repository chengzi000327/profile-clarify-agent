# DeepSeek Harness Spike 记录

日期：2026-08-15

## 已验证

1. 官方架构使用 Cordis Profile/Bundle；自定义工具通过 ctx.tools.register(defineTool(...)) 注册。
2. 官方仓库根版本为 0.1.0-rc.5，要求 Node 22.19 或 24 以上。
3. 领域 Bundle 能以 Profile 最后一层覆盖 dsh-base，将工具展示模式固定为 native。
4. Bundle 的七个工具使用闭合 Schema，身份字段不在模型参数中。
5. 静态 Profile 门禁会检查精确版本、危险工具禁用和领域工具完整性。
6. API 通过 HarnessAdapter 隔离运行时，并固定使用 Sidecar 执行真实 Harness；测试替身只通过测试依赖注入使用。
7. Harness 故障不会影响业务库中的正式产物读取；新 Run 会重新读取 RoleState。
8. 官方 TypeScript SDK 通过 stdio JSON-RPC 驱动 Session；Sidecar 已完成 `initialize` 启动验收。
9. Flash/Pro 已映射为官方 `deepseek-v4-flash` / `deepseek-v4-pro`，两者都支持工具调用。

## 上游发布阻塞

2026-08-15 实际查询 npm：

- @deepseek-ai/dsh：有 0.0.1-rc.5，无 0.1.0-rc.5
- @deepseek-ai/dsh-tools：有 0.0.1-rc.5，无 0.1.0-rc.5
- @deepseek-ai/dsh-base：有 0.0.1-rc.5，无 0.1.0-rc.5
- @deepseek-ai/dsh-headless：有 0.0.1-rc.5，无 0.1.0-rc.5
- 上述包的 next 已指向 0.1.0-rc.6

因此不能同时满足“精确锁定 0.1.0-rc.5”和“只从 npm 安装组合包”。当前实现不改变批准版本，也不自动升级 rc.6；改为锁定官方仓库完整提交：

    47f943859bef60e4160492346772ded9b24f765a

`corepack pnpm harness:prepare` 会浅拉取该提交，验证根版本为 `0.1.0-rc.5`，构建官方库与 JSON-RPC Runtime，再编译领域 Cordis 插件。已有提交对象时不会重复联网。

## 已完成的无密钥 Smoke Test

    corepack pnpm harness:verify
    corepack pnpm harness:smoke:runtime

结果：官方 rc.5 JSON-RPC Runtime 能加载模型适配器、Agent Spine、JSONL Session 和七个领域工具，并通过本地 OpenAI 兼容模型桩完成一次完整 Turn。测试断言发送给模型的工具恰好是七个领域工具，不访问外网、不产生模型费用。

## 有效密钥后的模型 Smoke Test

在 `.env` 填写 `DEEPSEEK_API_KEY` 后运行 `corepack pnpm dev`，通过工作台分别发送澄清消息和生成 JD。

验收：

1. 模型可见工具恰好是七个领域工具；Runtime 配置没有加载 Shell、文件、Web、Skill 或子 Agent 包。
2. Flash 澄清能调用读取状态和保存事实草稿。
3. Pro JD 只能产出四段结构并通过业务 Schema。
4. Sidecar 中断后重启，使用业务 RoleState 重建摘要并绑定 role-{role_session_id} Session。
5. 企业管理员完整 Trace 包含用户原文、模型 Prompt/最终输出、工具入参/返回、Token 与延迟；不采集密钥、会话凭证或内部令牌。
