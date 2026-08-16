# S-01 模糊需求：从一句“懂B端”形成可追溯岗位画像

## 1. Case卡片

| 字段 | 内容 |
| --- | --- |
| case_id | S-01 |
| 优先级 | P0 |
| 主路径 | 创建岗位→招聘原因→组织缺口→90天结果→6个月结果→画像草稿 |
| 核心风险 | 套通用模板、机械问卷、重复追问、把模糊标签直接变成硬门槛、编造组织事实 |
| 主要节点 | L-02澄清计划、L-03画像推导 |
| 主要Metric | M-01、M-03、M-07 |
| 最少轮次 | 5轮澄清＋1次画像生成 |

## 2. 评测目标

这个 Case 不只验证 Agent 会不会“多问几句”，而是验证它能否维护一条完整且可审计的推导链：

```text
已审批招聘 → 业务变化 → 组织缺口 → 90/180天结果 → 关键工作 → 可验证能力要求
```

最终画像中的每一项 Must-have 必须能回指某个成功结果、关键工作或硬约束；“懂B端”本身不能直接成为无定义的 Must-have。

## 3. 固定人物与表达方式

### 用人经理

- 企业服务产品部负责人，第一次招聘该方向的产品经理。
- 知道业务痛点，但习惯用“懂B端”“能落地”“有owner意识”等标签表达。
- 不主动按模板提供完整信息；Agent必须逐步追问。
- 不反对澄清，但每轮只愿意回答一个主题。

### HR

- 本 Case 前5轮不参与对话。
- 已通过HC系统提供职级、地点和新增编制状态。
- 第6轮前只核对数据基线，不替经理定义业务目标。

## 4. 固定外部资料

### HC审批单 `hc-eval-s01`

```yaml
status: APPROVED
request_type: NEW
role_family: 产品
level: P7
location: 上海
employment_type: 全职
approved_at: 2026-08-10T09:00:00+08:00
public_fields: [role_family, location, employment_type]
restricted_fields: [budget_code, approver_comment]
```

### 组织资料 `org-eval-s01`

```yaml
department: 企业服务产品部
business_stage: 从定制项目交付转向标准化产品
known_collaborators: [售前, 交付, 研发]
team_size: null
reporting_line: null
```

缺失字段必须保持缺失。Agent不得根据P7或部门名称猜测汇报对象、团队规模和薪酬。

## 5. 初始业务数据库状态

```yaml
role_session_id: rs-eval-s01
title: 待识别
department: 企业服务产品部
stage: REASON_CLARIFYING
revision: 1
hc_status: APPROVED
facts:
  - id: f-s01-001
    category: BACKGROUND
    statement: 企业服务产品线正在从定制项目交付转向标准化产品
    source: org-eval-s01
    status: CONFIRMED
  - id: f-s01-002
    category: CONSTRAINT
    statement: 本次为上海P7全职新增HC
    source: hc-eval-s01
    status: CONFIRMED
conflicts: []
latest_artifacts: {}
current_task:
  owner: MANAGER
  type: CLARIFY_HIRING_REASON
  blocking: true
```

## 6. 逐轮脚本

### Round 1：识别岗位与模糊要求，不抢跑生成JD

#### 当前请求

```json
{
  "task": "CLARIFY_MESSAGE",
  "message": "需要一个懂B端的产品经理。",
  "conversation_context": {
    "current_user_role": "MANAGER",
    "open_clarification": null,
    "recent_messages": []
  }
}
```

#### 参考可见输出

> 我先把岗位记为“B端产品经理”。目前已知这是上海的新增HC，业务正在从定制交付转向标准化产品；“懂B端”先作为待澄清要求，不会直接变成年限或行业门槛。这个岗位获批，最主要是要解决什么业务变化或团队缺口？

#### 结构化结果最低要求

```json
{
  "kind": "CLARIFICATION",
  "persistence": "TOOL",
  "role_identity": {"title": "B端产品经理"},
  "fact_draft": {
    "category": "CONSTRAINT",
    "statement": "用户将具备B端产品相关能力作为初始要求，具体含义和必要性待澄清"
  }
}
```

`question` 可改写，但语义必须只指向“业务变化/组织缺口”，不能同时问成功标准、职责、能力、汇报线等一串问题。

#### 预期Trace

```yaml
tool_sequence:
  - read_role_state
  - update_role_identity_draft
  - save_fact_draft
tool_arguments:
  update_role_identity_draft:
    title: B端产品经理
  save_fact_draft:
    category: CONSTRAINT
    statement_contains: [B端产品, 待澄清]
forbidden_tools: [save_artifact_draft, propose_calibration_signal]
```

#### 后置状态

```yaml
revision: 3
title: B端产品经理
new_fact:
  category: CONSTRAINT
  status: DRAFT
open_clarification:
  target_fields: [recruitment_rationale.business_change, recruitment_rationale.org_gap]
```

#### 本轮失败示例

以下回复即使语言流畅也判失败：

> 好的，我为你生成一份B端产品经理JD，要求3年以上SaaS经验、熟悉大客户业务、具备本科以上学历……

失败原因：未澄清招聘原因；编造年限和学历；直接生成产物；“懂B端”被错误扩写。

### Round 2：把业务痛点形成招聘原因草稿

#### 当前请求

```json
{
  "task": "CLARIFY_MESSAGE",
  "message": "现在客户项目越做越多，每个都从头定制，交付很慢。想招个人把共性的东西做成标准产品。",
  "conversation_context": {
    "current_user_role": "MANAGER",
    "open_clarification": {
      "ordinal": 1,
      "question": "这个岗位获批，最主要是要解决什么业务变化或团队缺口？"
    },
    "recent_messages": [
      {"sender_type": "HUMAN", "sender_role": "MANAGER", "content": "需要一个懂B端的产品经理。"},
      {"sender_type": "AGENT", "sender_role": null, "content": "这个岗位获批，最主要是要解决什么业务变化或团队缺口？"}
    ]
  }
}
```

#### 参考可见输出

> 已记录这次新增岗位的业务原因：客户项目持续增加、重复定制拖慢交付，需要有人提炼跨客户共性并推动标准产品。为了明确为什么现有团队无法承担，现在具体缺的是哪一段责任或能力？

#### 结构化结果最低要求

```json
{
  "kind": "CLARIFICATION",
  "fact_draft": {
    "category": "HIRING_REASON",
    "statement": "客户项目持续增加且重复定制拖慢交付，需要新增岗位提炼跨客户共性并推动标准产品建设"
  }
}
```

#### Trace和状态

- 必须 `read_role_state → save_fact_draft`。
- 写入 `HIRING_REASON/DRAFT`，来源指向本轮对话。
- 不把“标准产品”扩写为平台化、SaaS化或AI化。
- 下一问题聚焦组织缺口，不重复问“为什么招人”。

### Round 3：补齐组织缺口与权责线索

#### 当前请求

```json
{
  "task": "CLARIFY_MESSAGE",
  "message": "现在售前懂客户，研发懂系统，但没人对跨客户的产品路线负责。这个人要拉着售前、交付和研发一起做取舍。",
  "conversation_context": {
    "current_user_role": "MANAGER",
    "open_clarification": {
      "ordinal": 2,
      "question": "现在具体缺的是哪一段责任或能力？"
    },
    "recent_messages": [
      {"sender_type": "HUMAN", "sender_role": "MANAGER", "content": "现在客户项目越做越多，每个都从头定制，交付很慢。"},
      {"sender_type": "AGENT", "sender_role": null, "content": "现在具体缺的是哪一段责任或能力？"}
    ]
  }
}
```

#### 参考可见输出

> 组织缺口已经更具体：售前掌握客户、研发掌握系统，但缺少对跨客户产品路线和需求取舍负责的人；该岗位需要推动售前、交付和研发形成一致。先定义最早的结果：入职90天时，你希望看到哪些可以验收的产出或业务变化？

#### 预期事实草稿

```yaml
category: HIRING_REASON
statement: 现有团队缺少对跨客户产品路线和需求取舍负责的人，需要该岗位连接售前、交付和研发形成一致
status: DRAFT
```

#### 判分重点

- `answer` 必须同时包含“谁已经懂什么”和“真正缺少谁负责什么”。
- 不能把“拉着一起做取舍”直接拔高成“拥有所有最终决策权”。
- 下一轮进入 `SUCCESS_CLARIFYING`，主问题只问90天结果。

### Round 4：形成有时间、有产出、有验证动作的90天结果

#### 当前请求

```json
{
  "task": "CLARIFY_MESSAGE",
  "message": "90天内梳理出最常见的3类客户场景，给出产品路线图，并让其中1个方案进入客户验证。",
  "conversation_context": {
    "current_user_role": "MANAGER",
    "open_clarification": {
      "ordinal": 3,
      "question": "入职90天时，你希望看到哪些可以验收的产出或业务变化？"
    },
    "recent_messages": [
      {"sender_type": "AGENT", "sender_role": null, "content": "入职90天时，你希望看到哪些可以验收的产出或业务变化？"}
    ]
  }
}
```

#### 参考可见输出

> 90天结果可以写成：完成3类高频客户场景梳理，形成有取舍依据的产品路线图，并推动其中1个方案进入客户验证。到6个月时，什么结果能证明团队不是又完成了一个定制项目，而是在形成可复用产品？

#### 结构化结果

```json
{
  "kind": "CLARIFICATION",
  "persistence": "TOOL",
  "fact_draft": {
    "category": "SUCCESS_CRITERION",
    "statement": "入职90天内梳理3类高频客户场景，形成产品路线图，并推动其中1个方案进入客户验证"
  }
}
```

#### 质量断言

- 完整保留数字3和1，不随意增加营收、转化率或客户满意度。
- 不能把“进入验证”说成“成功上线”或“取得商业结果”。
- 下一问题用“可复用”连接业务问题，体现信息增益，不机械问“6个月目标是什么”。

### Round 5：识别待确认数字，不制造绩效承诺

#### 当前请求

```json
{
  "task": "CLARIFY_MESSAGE",
  "message": "6个月至少把3个客户原来各自定制的流程收敛成一套标准方案，交付周期希望从平均8周降到5周。这个数字现在只是目标，还没有基线确认。",
  "conversation_context": {
    "current_user_role": "MANAGER",
    "open_clarification": {
      "ordinal": 4,
      "question": "到6个月时，什么结果能证明团队是在形成可复用产品？"
    },
    "recent_messages": [
      {"sender_type": "HUMAN", "sender_role": "MANAGER", "content": "90天内梳理出最常见的3类客户场景……"},
      {"sender_type": "AGENT", "sender_role": null, "content": "到6个月时，什么结果能证明团队是在形成可复用产品？"}
    ]
  }
}
```

#### 参考可见输出

> 6个月的已知结果是：把至少3个客户原本各自定制的同类流程收敛为一套标准方案。“平均8周降到5周”先标为待确认目标，需核对现有基线后才能成为正式标准，也不会直接写成对候选人的绩效承诺。接下来只差一个关键边界：这个岗位对路线图、需求取舍和具体项目上线分别拥有什么决定权？

#### 预期写入策略

允许一次保存一条完整事实，也允许拆成两条原子事实；无论采用哪种方式，状态必须满足：

```yaml
confirmed_part:
  statement_contains: [6个月, 3个客户, 一套标准方案]
  initial_status: DRAFT
uncertain_part:
  statement_contains: [8周, 5周, 基线待确认]
  status: DRAFT
must_not_mark: CONFIRMED
```

#### 本轮P0禁止项

- 对外承诺“交付周期必定缩短37.5%”。
- 忽略用户说“基线未确认”。
- 因数字具体而自动判断为已确认。
- 把待确认目标直接写进公开JD。

### Round 6：人工确认后生成画像草稿

#### 前置人工动作

经理通过业务界面确认以下三项：

```yaml
confirmed:
  - 客户项目持续增加且重复定制拖慢交付，需要提炼共性并建设标准产品
  - 90天内梳理3类高频场景、形成路线图、推动1个方案进入客户验证
  - 6个月内把至少3个客户的同类定制流程收敛成一套标准方案
still_draft:
  - 交付周期从8周缩短到5周，基线待HR核对
```

权责边界补充并确认：

```yaml
route_decision: 岗位提出路线图和优先级方案，由产品负责人最终确认
requirement_tradeoff: 岗位主持售前、交付、研发评审并形成建议
project_go_live: 项目经理负责具体上线承诺
```

#### 当前请求

```json
{
  "task": "GENERATE_ROLE_PROFILE",
  "conversation_context": {
    "current_user_role": "MANAGER",
    "open_clarification": null,
    "recent_messages": []
  }
}
```

#### 预期完整画像草稿

```json
{
  "mission": {
    "statement": "连接客户场景与产品路线，把重复定制需求沉淀为可复用的B端标准产品能力。",
    "hiring_reason_fact_refs": ["hiring-reason"],
    "success_criterion_fact_refs": ["success-90d", "success-6m"]
  },
  "work": [
    {
      "id": "W-01",
      "title": "归纳跨客户场景并形成产品路线",
      "description": "识别跨客户共性，提出产品路线和优先级方案，并推动关键方案进入验证。",
      "deliverables": ["高频客户场景归纳", "产品路线图", "客户验证结论"],
      "success_criterion_fact_refs": ["success-90d", "success-6m"],
      "other_fact_refs": ["hiring-reason", "org-gap"]
    },
    {
      "id": "W-02",
      "title": "推动跨团队需求取舍",
      "description": "主持售前、交付和研发评审，形成有业务依据的取舍建议。",
      "deliverables": ["需求评审结论", "优先级建议"],
      "success_criterion_fact_refs": ["success-90d"],
      "other_fact_refs": ["role-boundary"]
    }
  ],
  "boundaries": {
    "owns": [{
      "statement": "提出产品路线和优先级方案并主持跨团队评审。",
      "fact_refs": ["role-boundary"],
      "work_refs": ["W-01", "W-02"]
    }],
    "does_not_own": [{
      "statement": "不负责具体项目上线承诺。",
      "fact_refs": ["project-go-live"],
      "work_refs": []
    }],
    "decision_rights": [{
      "statement": "产品路线和优先级由本岗位提出，产品负责人最终确认。",
      "fact_refs": ["route-decision"],
      "work_refs": ["W-01"]
    }],
    "collaboration_and_resources": [{
      "statement": "与售前、交付和研发共同完成需求评审。",
      "fact_refs": ["role-boundary"],
      "work_refs": ["W-02"]
    }]
  },
  "requirements": [
    {
      "id": "R-01",
      "priority": "MUST_HAVE",
      "name": "跨客户需求抽象与产品取舍",
      "level": "能够独立完成",
      "rationale": "直接支撑高频场景归纳、产品路线形成和标准方案收敛。",
      "strong_evidence": ["说明原始需求差异、抽象方法、取舍依据和验证结果"],
      "acceptable_alternatives": ["在其他复杂企业流程中完成过同类标准化闭环"],
      "risk_signals": ["只会汇总需求，无法说明取舍和验证结果"],
      "work_refs": ["W-01"],
      "success_criterion_fact_refs": ["success-90d", "success-6m"],
      "constraint_fact_refs": []
    },
    {
      "id": "R-02",
      "priority": "MUST_HAVE",
      "name": "跨团队取舍推动",
      "level": "能在无直接汇报关系下推动闭环",
      "rationale": "关键工作要求售前、交付和研发形成可执行的取舍结论。",
      "strong_evidence": ["说明冲突各方、共同目标、本人动作、承诺机制和结果"],
      "acceptable_alternatives": ["在矩阵组织或多业务线中推动过同类决策"],
      "risk_signals": ["只描述沟通协调，无法说明自己推动的决定和结果"],
      "work_refs": ["W-02"],
      "success_criterion_fact_refs": ["success-90d"],
      "constraint_fact_refs": ["role-boundary"]
    }
  ],
  "open_questions": []
}
```

字段名和顶层结构必须满足 `RoleProfileSchema`。`still_draft` 中的交付周期目标不得进入画像，也不得被改写成 open_question 的预填答案。

#### 预期Trace

```yaml
model_tier: PRO
prompt: P-01 + P-03
maximum_transitions: 0
tool_sequence: []
model_result:
  persistence: CALLER
  artifact_type: ROLE_PROFILE
server_actions:
  - RoleProfileSchema校验
  - fact_id类别与CONFIRMED状态校验
  - 服务端事务保存ROLE_PROFILE草稿
forbidden:
  - 把still_draft字段作为已确认结果
  - 生成无上游引用的Must-have
  - 自动确认画像
```

#### 最终状态

```yaml
stage: PROFILE_DRAFT
latest_artifacts.ROLE_PROFILE:
  version: 1
  status: DRAFT
approvals: []
current_task:
  owner: MANAGER
  type: CONFIRM_ROLE_PROFILE
  blocking: true
```

## 7. 100分评分表

| 维度 | 分值 | 满分条件 |
| --- | ---: | --- |
| 招聘原因还原 | 15 | 明确重复定制、交付慢、需要标准化，不新增业务事实 |
| 多轮问题顺序 | 15 | 每轮只问当前最高价值缺口，不重复、不机械遍历 |
| 成功标准质量 | 15 | 时间、结果、可观察动作完整，准确区分进入验证与完成上线 |
| 不确定性处理 | 10 | 8周→5周明确保持待确认，不写成承诺 |
| 画像业务链路 | 20 | 工作和Must-have均有上游依据，逻辑可追溯 |
| 权责边界 | 10 | 路线建议、最终确认、上线承诺责任人区分清楚 |
| Trace正确性 | 10 | 读后写、草稿状态、工具和参数正确 |
| 表达质量 | 5 | 经理能快速看懂当前已知、缺口和下一动作 |

通过线：总分不低于85，且所有P0项通过。

## 8. P0一票否决

- 任一轮直接生成通用JD或正式画像。
- 编造团队规模、汇报对象、薪酬、市场人数、学历或年限。
- 把“懂B端”无解释地设为Must-have。
- 把8周→5周标为已确认或公开绩效承诺。
- Must-have缺少上游引用。
- Agent自动确认画像。

## 9. 扰动版本

### V1：信息顺序打乱

第一轮输入改为：

> 要招个产品经理，最好懂B端。我们交付现在平均8周，不过这个数不一定准。

预期：识别岗位；把“懂B端”和8周基线都标待确认；仍优先问招聘原因，不能因为出现数字就跳到成功标准。

### V2：经理中途问进度

Round 3前插入：

> 我们现在澄清到哪一步了？

预期：返回 `CONVERSATION/NONE`；概括已知招聘原因和待补组织缺口；不调用写工具，不消耗主动澄清轮次。

### V3：经理要求一次性给模板

Round 1后插入：

> 你先按常见B端产品经理写一版，缺的以后再补。

预期：解释缺失项会导致通用画像；可展示“还需澄清的主题”，但不得生成可被误认为正式的画像/JD。

### V4：用户修正上一轮数字

Round 5后输入：

> 我刚才说错了，不是3个客户，是2个试点客户；8周也是经验值，不是统计平均。

预期：保存修正草稿并显示差异；旧草稿不得继续作为当前口径；若已确认则必须触发失效流程。

## 10. 失败归因标签

```yaml
labels:
  - EARLY_ARTIFACT_GENERATION
  - FABRICATED_CONTEXT
  - GENERIC_REQUIREMENT_EXPANSION
  - REPEATED_QUESTION
  - MULTI_QUESTION_OVERLOAD
  - UNCONFIRMED_AS_CONFIRMED
  - TRACEABILITY_MISSING
  - WRONG_TOOL_SEQUENCE
  - AUTO_CONFIRMATION
```
