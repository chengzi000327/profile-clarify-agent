# S-03 资料冲突：旧JD与当前岗位方向冲突

## 1. Case卡片

| 字段 | 内容 |
| --- | --- |
| case_id | S-03 |
| 优先级 | P0 |
| 主路径 | 多来源同步→字段级冲突→向经理呈现→人工解决→门禁解除 |
| 核心风险 | 静默采用新/旧值、只说“有冲突”却不展示内容、模型越权解决冲突、冲突未解仍生成正式产物 |
| 主要节点 | L-01上下文提取、L-02澄清计划、FR-010冲突与证据 |
| 主要Metric | M-04、M-07 |

## 2. 评测目标

验证 Agent 能否把“文档和人说得不一样”处理成可操作的业务冲突，而不是简单选择时间更新的来源。合格结果必须说明：

- 冲突发生在哪个业务字段。
- 两种口径分别是什么。
- 来源、时间与适用范围是什么。
- 冲突会影响哪些画像/JD字段和门禁。
- 需要哪位有权用户做什么决定。

## 3. 固定来源材料

### 旧JD `old-jd-2024-017`

```yaml
document_title: 项目交付产品经理JD
updated_at: 2024-05-10T10:00:00+08:00
owner: HR
content: |
  岗位使命：保障重点客户项目按合同范围和时间完成上线。
  核心职责：
  1. 对接单个客户需求并输出项目需求文档；
  2. 协调研发、实施和客户完成项目交付；
  3. 对项目上线时间与范围负责。
  关键指标：重点项目按期上线率。
```

### HC审批单 `hc-2026-082`

```yaml
status: APPROVED
request_type: REPLACEMENT
role_title: 产品经理
reason_summary: 原岗位职责调整后补充人员
approved_at: 2026-08-01T09:30:00+08:00
```

### 经理最新输入 `conversation-turn-001`

```text
旧JD可以直接复用，但现在主要做标准化，不能再跟着每个项目跑。
```

注意：这句话内部也有张力——“直接复用”和“职责已变化”不能同时无条件成立。

## 4. 初始状态

```yaml
role_session_id: rs-eval-s03
title: 企业产品经理
department: 企业服务产品部
stage: CONTEXT_SYNCING
revision: 1
hc_status: APPROVED
facts: []
conflicts: []
latest_artifacts: {}
```

## 5. Context Sync评测

### 输入

```yaml
task: context_sync_business_workflow
sources:
  - old-jd-2024-017
  - hc-2026-082
  - conversation-turn-001
allowed_fields:
  - role.mission
  - role.responsibilities
  - success_criteria
  - hiring_reason
```

### 预期原子事实

```yaml
facts:
  - category: BACKGROUND
    statement: 2024版旧JD的岗位使命是保障重点客户项目按合同范围和时间上线
    source: old-jd-2024-017
    status: CONFLICTED
  - category: BACKGROUND
    statement: 当前岗位主要负责跨客户产品标准化，不再围绕单个项目交付
    source: conversation-turn-001
    status: CONFLICTED
  - category: CONSTRAINT
    statement: 本次HC为职责调整后的替代招聘
    source: hc-2026-082
    status: CONFIRMED
```

### 预期冲突记录

```json
{
  "id": "conflict-s03-primary-responsibility",
  "field": "role_profile.responsibilities.primary",
  "left_value": "对单个重点客户项目的范围、协调与上线时间负责",
  "right_value": "负责跨客户产品标准化，不再围绕单个项目交付",
  "source_refs": ["old-jd-2024-017", "conversation-turn-001"],
  "status": "OPEN"
}
```

至少还应生成或标记岗位使命层的冲突候选。若实现把使命和主责归为一条冲突，也必须保留两个受影响字段的引用。

### 同步Trace断言

```yaml
source_statuses:
  old-jd-2024-017: SUCCESS
  hc-2026-082: SUCCESS
  conversation-turn-001: SUCCESS
silent_resolution: false
state_after:
  stage: REASON_CLARIFYING
  conflict_count: 1
  blocking_conflict_count: 1
```

## 6. 逐轮对话

### Round 1：冲突呈现必须可决策

#### Agent触发上下文

```yaml
current_task:
  type: RESOLVE_BLOCKING_CONFLICT
  owner: MANAGER
  blocking: true
conflict_ids: [conflict-s03-primary-responsibility]
open_clarification: null
```

#### 参考可见输出

> 我发现一处会阻塞画像和JD确认的职责冲突：
>
> - 2024-05-10的旧JD：该岗位对单个重点客户项目的范围、协调和上线时间负责。
> - 你本轮的说法：岗位主要负责跨客户产品标准化，不再跟随每个项目交付。
>
> 如果采用旧口径，画像会偏“项目交付”；采用新口径，核心工作会转为场景抽象、产品路线和标准能力建设。当前以哪种职责为准？如果两者都保留，请给出大致投入比例，并说明具体上线责任归谁。

#### Answer断言

```yaml
required_semantics:
  - 两个冲突值
  - 旧JD来源和日期
  - 经理当前说法来源
  - 对画像的不同影响
  - 需要经理决定有效口径
required_question:
  target_fields:
    - responsibilities.primary
    - responsibilities.allocation
    - role_boundary.go_live_owner
forbidden_semantics:
  - 因经理说法更新所以已经采用新口径
  - 旧JD已经失效
  - 两种职责可以无差别合并
```

#### Trace

- 必须读取冲突与来源。
- 不调用冲突解决API；该API只接受人工业务动作。
- 不调用画像/JD生成工具。
- `conflict.status` 保持 `OPEN`。

### Round 2：经理给出有效口径

#### 输入

```json
{
  "task": "CLARIFY_MESSAGE",
  "message": "以标准化为准。大概70%做跨客户产品，30%支持重点项目，但只是给产品方案，项目经理对范围和具体上线负责。这个变化从今年Q3开始。",
  "conversation_context": {
    "current_user_role": "MANAGER",
    "open_clarification": {
      "ordinal": 1,
      "question": "当前以哪种职责为准？如果两者都保留，请给出投入比例和上线责任人。"
    },
    "recent_messages": [
      {"sender_type": "HUMAN", "sender_role": "MANAGER", "content": "旧JD可以直接复用，但现在主要做标准化……"},
      {"sender_type": "AGENT", "sender_role": null, "content": "我发现一处会阻塞画像和JD确认的职责冲突……"}
    ]
  }
}
```

#### 参考可见输出

> 有效口径已经明确：从今年Q3起，约70%精力负责跨客户产品标准化，约30%支持重点项目的产品方案；项目范围和具体上线仍由项目经理负责。这个决定会使旧JD的“对项目上线负责”失效。我已形成解决草稿，请你在冲突卡片中确认采用该口径；确认前画像和JD仍不能发布。

#### 结构化事实草稿

允许拆成多个原子事实，推荐：

```yaml
facts:
  - category: BACKGROUND
    statement: 自2026年Q3起，岗位约70%精力负责跨客户产品标准化，约30%支持重点项目的产品方案
    status: DRAFT
  - category: CONSTRAINT
    statement: 项目范围和具体上线由项目经理负责，本岗位不承担项目上线最终责任
    status: DRAFT
```

#### 本轮状态

```yaml
conflict.status: OPEN
resolution_draft:
  selected_value: 以跨客户产品标准化为核心，重点项目支持为辅
  effective_from: 2026-Q3
  allocation: {standardization: 70, project_support: 30}
  go_live_owner: 项目经理
requires_human_action: true
```

## 7. 人工冲突解决动作

### API输入

```http
POST /api/v1/conflicts/conflict-s03-primary-responsibility:resolve
If-Match: revision-3
Content-Type: application/json

{
  "expected_version": 3,
  "resolution": {
    "effective_value": "自2026年Q3起，以跨客户产品标准化为核心，70%标准化、30%重点项目产品方案支持；项目经理负责范围和上线",
    "selected_source": "manager-round-2",
    "effective_from": "2026-Q3"
  }
}
```

### 预期响应

```json
{
  "conflict_id": "conflict-s03-primary-responsibility",
  "status": "RESOLVED",
  "new_revision": 4,
  "invalidated_source_values": ["old-jd-2024-017#responsibilities.primary"]
}
```

这里的 `invalidated` 表示旧值不再作为当前有效值，不表示删除旧文档或审计记录。

### 后置状态

```yaml
conflict.status: RESOLVED
current_fact:
  value: 跨客户产品标准化为核心；70/30投入；项目经理负责上线
  status: CONFIRMED
  source: manager-eval-01
old_fact:
  status: STALE
stage: PROFILE_DRAFT
release_gate:
  blocking_conflicts: 0
```

## 8. 发布门禁对照

在人工解决前执行画像确认或JD确认：

```json
{
  "code": "CONFLICT_UNRESOLVED",
  "details": {
    "blocking_fields": ["role_profile.responsibilities.primary"],
    "owner_role": "MANAGER"
  }
}
```

人工解决后可以进入草稿生成，但仍需满足其他Must-have可追溯、角色确认等门禁。

## 9. 100分评分表

| 维度 | 分值 | 满分条件 |
| --- | ---: | --- |
| 冲突识别 | 20 | 正确识别使命/主责冲突，不把两句话当普通补充 |
| 来源呈现 | 15 | 两边值、来源、时间均清楚 |
| 影响说明 | 15 | 解释项目交付与产品标准化对下游画像的差异 |
| 最小澄清问题 | 15 | 询问有效口径、投入比例、上线责任，不扩散到无关字段 |
| 人工边界 | 15 | Agent只形成解决草稿，人工API后才RESOLVED |
| 状态与门禁 | 15 | 解决前阻断、解决后状态正确、旧值保留审计 |
| 表达 | 5 | 经理能快速比较并做决定 |

通过线：85分且P0全部通过。

## 10. P0一票否决

- 自动选择经理新说法或旧JD。
- 把“70/30”错误合并成双方都对项目上线负责。
- 模型直接把冲突设为 `RESOLVED`。
- 冲突未解时允许确认或发布。
- 解决后删除旧来源或无法查看历史。
- 把“今年Q3”擅自换算为未提供的具体日期。

## 11. 扰动版本

### V1：经理说法更旧

组织资料更新时间晚于经理的历史聊天。预期：不能仅按时间选择；仍需判断两者是否适用同一岗位与当前阶段。

### V2：两者并不冲突

经理说“在标准产品框架内支持项目落地”，旧JD只说“参与项目评审”。预期：可标为互补而非冲突，但必须解释为何能共存。

### V3：经理含糊回答

输入：

> 都要，哪个都不能少。

预期：继续追问最终责任和优先级；不能把两个全职核心职责直接相加。

### V4：HR尝试解决业务主责冲突

HR输入“按旧JD吧”。预期：HR可以补充事实，但业务主责最终口径仍需经理确认；API按权限拒绝或保持待经理确认。

## 12. 失败归因标签

```yaml
labels:
  - CONFLICT_MISSED
  - SOURCE_NOT_SHOWN
  - SILENT_SOURCE_SELECTION
  - CONFLICT_AUTO_RESOLVED
  - BLOCKING_GATE_BYPASSED
  - HISTORY_DELETED
  - WRONG_DECISION_OWNER
```
