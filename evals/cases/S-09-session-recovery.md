# S-09 会话恢复：运行时丢失后从业务State继续

## 1. Case卡片

| 字段 | 内容 |
| --- | --- |
| case_id | S-09 |
| 优先级 | P0 |
| 故障模型 | 浏览器关闭＋Harness Session不可恢复＋服务重启 |
| 主路径 | 中断前持久化→重新打开→业务层恢复→重绑运行时→概括进度→回答待办 |
| 核心风险 | 依赖Harness Memory、重复提问、跨岗位串数据、恢复摘要误写事实、丢版本/审批/待办 |
| 主要Metric | M-08 |

## 2. 评测目标

验证“岗位项目”是可持续业务对象，而不是单次聊天。恢复正确性包括：

- 正式事实和草稿状态。
- 当前阶段与下一动作。
- 活跃画像/JD版本。
- 待解决冲突和待确认项。
- 已完成的人工确认。
- 对话中尚未落正式事实的最近上下文。

Harness Session是运行时引用，丢失时不能导致业务对象丢失或从零开始。

## 3. 中断前完整状态

### 业务数据库

```yaml
role_session_id: rs-eval-s09
title: B端产品经理
department: 企业服务产品部
stage: SUCCESS_CLARIFYING
revision: 14
hc_status: APPROVED
facts:
  - id: f-s09-01
    category: HIRING_REASON
    statement: 客户项目重复定制拖慢交付，需要建立跨客户标准产品路线
    status: CONFIRMED
    evidence_refs: [conversation://s09/turn/2]
  - id: f-s09-02
    category: SUCCESS_CRITERION
    statement: 90天内形成路线图并推动1个方案进入客户验证
    status: CONFIRMED
    evidence_refs: [conversation://s09/turn/4]
  - id: f-s09-03
    category: SUCCESS_CRITERION
    statement: 6个月内让标准方案覆盖至少3个同类客户项目
    status: DRAFT
    evidence_refs: [conversation://s09/turn/6]
conflicts: []
latest_artifacts:
  ROLE_PROFILE: null
  ASSESSMENT_SCORECARD: null
  PUBLIC_JD: null
approvals:
  - target: recruitment_rationale
    role: MANAGER
    status: VALID
current_task:
  type: COMPLETE_SUCCESS_CRITERION
  title: 补充6个月成功标准的验收口径
  owner: MANAGER
  blocking: true
open_clarification:
  ordinal: 4
  question: 6个月时如何判断标准方案已经产生效果？
last_persisted_event_id: event-s09-144
```

### 中断前最近对话

```yaml
recent_messages:
  - sender_type: AGENT
    content: 6个月时如何判断标准方案已经产生效果？可以用交付周期、复用率或其他结果说明。
  - sender_type: HUMAN
    sender_role: MANAGER
    content: 我晚点补，先关掉。
```

### 运行时状态

```yaml
harness_session_id: harness-s09-old
harness_session_status: LOST
last_agent_run:
  id: run-s09-006
  status: COMPLETED
browser_connection: CLOSED
```

## 4. 故障注入

测试环境执行以下任一等价故障：

1. 删除/失效 `harness-s09-old`，保留业务数据库。
2. 重启Sidecar使内存Session不可恢复。
3. 模拟运行时返回 `SESSION_NOT_FOUND`。

不得删除 `RoleSession`、Facts、Approvals、DecisionLog和对话持久化记录。

## 5. Round 1：用户重新打开并说“继续”

### 页面加载请求

```http
GET /api/v1/role-sessions/rs-eval-s09
Authorization: Bearer <manager-token>
```

预期页面首屏在模型回复前就能显示：

```yaml
stage: 成功标准澄清
current_task: 补充6个月成功标准的验收口径
owner: 用人经理
confirmed_summary:
  - 招聘原因已确认
  - 90天结果已确认
pending_summary:
  - 6个月结果效果口径待补充
```

### 用户消息请求

```json
{
  "task": "CLARIFY_MESSAGE",
  "message": "继续当前岗位。",
  "conversation_context": {
    "current_user_role": "MANAGER",
    "open_clarification": {
      "ordinal": 4,
      "question": "6个月时如何判断标准方案已经产生效果？"
    },
    "recent_messages": [
      {"sender_type": "AGENT", "sender_role": null, "content": "6个月时如何判断标准方案已经产生效果？可以用交付周期、复用率或其他结果说明。"},
      {"sender_type": "HUMAN", "sender_role": "MANAGER", "content": "我晚点补，先关掉。"}
    ]
  }
}
```

### 预期恢复编排

```yaml
1_read_business_state: SUCCESS
2_try_old_harness_session: SESSION_NOT_FOUND
3_create_or_bind_new_harness_session: SUCCESS
new_harness_session_id: harness-s09-rebound-01
business_state_mutated: false
runtime_reference_updated: true
```

### 参考可见输出

> 当前在“成功标准澄清”阶段。已确认：招聘是为了解决重复定制，90天要形成路线图并推动1个方案进入客户验证。待确认：你提出6个月内让标准方案覆盖至少3个同类客户项目，但还缺如何判断它真正产生效果。请补充：你更看交付周期、方案复用率，还是其他业务结果？

### 结构化结果

```json
{
  "kind": "CONVERSATION",
  "persistence": "NONE",
  "answer": "<包含阶段、已确认、待确认和下一问题的恢复摘要>"
}
```

“继续当前岗位”不是新事实，不能为了满足 `CLARIFICATION` Schema而调用 `save_fact_draft`。

### Trace断言

```yaml
read_source_of_truth: BUSINESS_DATABASE
save_fact_draft_calls: 0
save_artifact_draft_calls: 0
runtime_rebound: true
restored_fields:
  - stage
  - current_task
  - confirmed_fact_ids
  - pending_fact_ids
  - approvals
forbidden:
  - 从零询问岗位名称
  - 重复询问招聘原因
  - 将compact_summary覆盖正式Facts
```

## 6. Round 2：回答中断前待办

### 输入

```json
{
  "task": "CLARIFY_MESSAGE",
  "message": "看交付周期。标准方案覆盖后，同类项目从平均8周缩短到5周；先作为待确认目标，HR还要核基线。",
  "conversation_context": {
    "current_user_role": "MANAGER",
    "open_clarification": {
      "ordinal": 4,
      "question": "6个月时如何判断标准方案已经产生效果？"
    },
    "recent_messages": [
      {"sender_type": "HUMAN", "sender_role": "MANAGER", "content": "继续当前岗位。"},
      {"sender_type": "AGENT", "sender_role": null, "content": "当前在成功标准澄清阶段……请补充效果口径。"}
    ]
  }
}
```

### 参考可见输出

> 已补充6个月效果口径：标准方案覆盖至少3个同类客户项目；交付周期从约8周缩短到5周暂标为待确认目标，等待HR核对基线。下一步需要明确该岗位对产品路线、需求取舍和具体项目上线分别拥有什么决策权。

### 预期结构化输出

```json
{
  "kind": "CLARIFICATION",
  "persistence": "TOOL",
  "fact_draft": {
    "category": "SUCCESS_CRITERION",
    "statement": "6个月内标准方案覆盖至少3个同类客户项目；交付周期从约8周缩短到5周为待确认目标，需HR核对基线"
  }
}
```

### 后置状态

```yaml
revision: 15
new_fact_status: DRAFT
stage: SUCCESS_CLARIFYING
current_task:
  type: CLARIFY_ROLE_BOUNDARY
  owner: MANAGER
harness_session_id: harness-s09-rebound-01
```

## 7. 正式产物只读恢复变体

将初始状态改为：

```yaml
stage: JD_CONFIRMED
active_profile: rp-s09-v2/CONFIRMED
active_jd: jd-s09-v2/CONFIRMED
harness_runtime: UNAVAILABLE
```

预期：

- 页面仍能从业务数据库查看画像、评分卡、JD和决策记录。
- 写操作返回 `RUNTIME_UNAVAILABLE`，提示稍后重试。
- 不因运行时故障把已确认产物变为草稿或失效。
- 运行时恢复后重新绑定，不迁移或重建业务对象。

## 8. SSE中断恢复变体

### 场景

Agent Run执行到 `event-s09-200` 后网络断开，客户端带 `Last-Event-ID: event-s09-197` 重连。

### 预期

- 服务端只补发198—200，事件不重复导致二次写入。
- 若写工具已成功但最终文本未送达，恢复结果必须基于权威工具参数，不再次调用写工具。
- 相同 `client_message_id` 重试不得生成第二条事实。

## 9. 跨岗位隔离变体

同一经理拥有 `rs-eval-s09` 和另一个销售岗位会话。恢复S-09时：

- 不得出现销售岗位的事实、对话或待办。
- Harness Session绑定必须校验 `role_session_id`。
- 最近消息窗口只来自当前岗位。

## 10. 100分评分表

| 维度 | 分值 | 满分条件 |
| --- | ---: | --- |
| 业务State恢复 | 25 | 阶段、事实、版本、审批、待办全部正确 |
| 运行时重绑 | 15 | Session丢失可重绑，业务对象不迁移 |
| 恢复摘要 | 15 | 已确认/待确认/下一动作准确且简洁 |
| 不重复追问 | 15 | 从Round 4继续，不问岗位名和招聘原因 |
| 无错误写入 | 10 | “继续”不写事实，摘要不成为正式事实 |
| 回答落库 | 10 | Round 2正确保存DRAFT且保留待确认口径 |
| 幂等与隔离 | 10 | SSE重连不重复写，跨岗位不串数据 |

通过线：95分，P0全部通过。

## 11. P0一票否决

- Harness Session丢失导致正式业务数据丢失。
- 从头重复询问已确认事项。
- 把恢复摘要写为新事实。
- 跨岗位串数据。
- SSE重试产生重复事实或重复版本。
- 运行时故障使已确认产物失效。

## 12. 失败归因标签

```yaml
labels:
  - BUSINESS_STATE_NOT_RESTORED
  - HARNESS_MEMORY_AS_SOURCE_OF_TRUTH
  - CONFIRMED_FACT_REASKED
  - RESUME_SUMMARY_PERSISTED
  - CROSS_ROLE_SESSION_CONTAMINATION
  - SSE_DUPLICATE_WRITE
  - RUNTIME_FAILURE_CORRUPTED_ARTIFACT
```
