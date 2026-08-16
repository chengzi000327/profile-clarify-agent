# 飞书岗位澄清接入

## 能力范围

- 用户在机器人单聊里直接描述招聘背景；第一条有效消息才建立岗位，不要求先填表。
- 飞书与 Web 共用 PostgreSQL 里的岗位、事实、消息、产物和 Agent Run，不维护第二份业务事实。
- 普通文字会进入同一澄清 Agent；`新岗位`、`新建岗位` 或 `/new` 开始一个新的岗位会话。
- 输入“生成岗位画像”“生成评估方案”“生成 JD”或“生成 HR 画像”，机器人会等待对应 Agent Run，并用飞书卡片返回结果。
- 当前 MVP 只处理机器人单聊和文字消息。群聊会提示用户转到单聊，避免把不同成员的权限和岗位上下文混在一起。
- 飞书事件以 `message_id` 去重，重复投递不会再次触发模型 Run。

## 飞书开放平台配置

1. 创建企业自建应用并启用机器人能力。
2. 为应用开通接收用户发给机器人的单聊消息，以及机器人发送消息所需权限。
3. 在事件订阅中添加 `im.message.receive_v1`。
4. 将请求地址设置为：

       https://<你的 Web 域名>/api/v1/integrations/feishu/events

   当前 Railway Demo 对应：

       https://web-production-a9f14.up.railway.app/api/v1/integrations/feishu/events

5. 把飞书后台的 Verification Token、App ID 和 App Secret 配置为 API 服务的 Railway Secret，然后发布应用版本。

官方参考：

- [接收消息事件](https://open.feishu.cn/document/server-docs/im-v1/message/events/receive?lang=zh-CN)
- [发送消息](https://open.feishu.cn/document/server-docs/im-v1/message/create?lang=zh-CN)
- [飞书卡片快速开始](https://open.feishu.cn/document/feishu-cards/quick-start/send-feishu-cards-with-app-bots?lang=zh-CN)
- [事件订阅与安全校验](https://open.feishu.cn/document/server-docs/event-subscription-guide/event-subscription-configure-/encrypt-key-encryption-configuration-case?lang=zh-CN)

## API 服务变量

```dotenv
FEISHU_ENABLED=true
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx
FEISHU_VERIFICATION_TOKEN=xxx
FEISHU_WORKSPACE_ID=demo-enterprise
FEISHU_API_BASE_URL=https://open.feishu.cn
FEISHU_USER_MAPPINGS_JSON={}
```

`FEISHU_WORKSPACE_ID` 必须与用户在 Web 登录页填写的企业空间 ID 一致，才能落入同一租户。

可用 `FEISHU_USER_MAPPINGS_JSON` 把飞书 `open_id` 映射到 Web 的账号、显示名和角色。例如：

```json
{
  "ou_xxx": {
    "account_id": "manager-001",
    "display_name": "王经理",
    "role": "MANAGER"
  },
  "ou_yyy": {
    "account_id": "hr-001",
    "display_name": "李 HR",
    "role": "HR"
  }
}
```

没有映射的飞书用户会获得稳定的独立账号，默认角色为 `MANAGER`；管理员应在正式试用前完成映射，避免默认角色不符合组织授权。

## 回调响应与安全边界

URL 验证会同步返回 `challenge`。消息事件在校验 Verification Token、完成 `message_id` 去重后立即返回，Agent 运行和卡片回复异步执行，以满足飞书回调时限。

当前 MVP 使用 Verification Token 的明文事件回调。正式生产启用 Encrypt Key 前，需要同时实现并验收请求签名和 AES 解密；在此之前不要把回调地址开放给测试企业之外的应用。

App Secret、Verification Token、模型密钥和内部服务令牌只放在 Railway Secret，不写入 Git、Trace 或浏览器。

## 验收清单

1. 飞书保存请求地址时通过 challenge 校验。
2. 新用户在机器人单聊发送招聘原因，收到 Agent 澄清卡片；Web 用映射账号登录后可以看到同一岗位与消息。
3. 同一 `message_id` 重放两次，只产生一次 Agent Run 和一次卡片回复。
4. 发送“生成岗位画像”，收到包含产物版本和 Web 链接的岗位画像卡片。
5. 群聊、非文字消息、无效 Verification Token 和未配置凭据均不会进入模型。
