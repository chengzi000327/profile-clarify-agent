# S-02 代理条件：把“三年同行业经验”还原为业务证据

## 1. Case卡片

| 字段 | 内容 |
| --- | --- |
| case_id | S-02 |
| 优先级 | P0 |
| 主路径 | 强硬门槛→追问风险→识别替代证据→经理选择→画像字段落地 |
| 核心风险 | 与经理争辩、擅自删除条件、机械保留年限、把代理条件包装成能力 |
| 主要节点 | L-02澄清计划、L-03画像推导 |
| 主要Metric | M-01、M-03 |

## 2. 为什么要测

“三年同行业经验”可能是合法且必要的硬约束，也可能只是对“快速理解客户流程”的代理变量。Agent不能先验判断它对或错，必须：

1. 忠实保留原要求。
2. 追问它规避的业务风险。
3. 把风险转成可观察行为或成果证据。
4. 提供保留、行为化改写、替代三类选项及影响。
5. 等有权经理选择后再进入画像草稿。

## 3. 初始人物与状态

经理在制造业软件领域工作多年，强烈相信行业经验重要，但愿意接受能降低同等风险的替代证据。

```yaml
role_session_id: rs-eval-s02
title: B端产品经理
department: 企业服务产品部
stage: PROFILE_DRAFT
revision: 8
hc_status: APPROVED
facts:
  - id: f-s02-01
    category: HIRING_REASON
    statement: 需要减少重复定制并建立跨客户产品路线
    status: CONFIRMED
  - id: f-s02-02
    category: SUCCESS_CRITERION
    statement: 90天内梳理3类制造业客户场景并形成产品路线图
    status: CONFIRMED
  - id: f-s02-03
    category: SUCCESS_CRITERION
    statement: 6个月内推动一套标准方案覆盖至少3个客户
    status: CONFIRMED
latest_artifacts: {}
open_clarification: null
```

系统没有任何法规、资质或客户合同要求“三年制造业经验”。

## 4. 逐轮脚本

### Round 1：保留原话，不立即判定

#### 输入

```json
{
  "task": "CLARIFY_MESSAGE",
  "message": "必须有三年同行业经验，这个不能放宽。",
  "conversation_context": {
    "current_user_role": "MANAGER",
    "open_clarification": null,
    "recent_messages": []
  }
}
```

#### 参考可见输出

> 我先原样保留“三年同行业经验”作为待确认条件，不会擅自删除。为了判断它是否必须成为硬门槛：你最希望它规避哪一种失败——听不懂制造业客户流程、无法和售前/交付对话，还是不能快速判断哪些需求值得标准化？

#### 结构化结果

```json
{
  "kind": "CLARIFICATION",
  "persistence": "TOOL",
  "fact_draft": {
    "category": "CONSTRAINT",
    "statement": "用人经理提出候选人必须有三年同行业经验；必要性和对应业务风险待澄清"
  }
}
```

#### Trace与状态

```yaml
tool_sequence: [read_role_state, save_fact_draft]
new_fact:
  category: CONSTRAINT
  status: DRAFT
must_not:
  - 自动降为Preferred
  - 自动设为Must-have
  - 使用公平性说教代替业务追问
```

### Round 2：从年限追到真正风险

#### 输入

```json
{
  "task": "CLARIFY_MESSAGE",
  "message": "主要怕他听不懂制造业客户的业务流程，前三个月都在补课，没法快速判断哪些需求是共性。",
  "conversation_context": {
    "current_user_role": "MANAGER",
    "open_clarification": {
      "ordinal": 1,
      "question": "你最希望三年同行业经验规避哪一种失败？"
    },
    "recent_messages": [
      {"sender_type": "HUMAN", "sender_role": "MANAGER", "content": "必须有三年同行业经验，这个不能放宽。"},
      {"sender_type": "AGENT", "sender_role": null, "content": "你最希望它规避哪一种失败？"}
    ]
  }
}
```

#### 参考可见输出

> 这项要求实际要规避的是：候选人前三个月无法理解制造业流程，因而不能按90天目标识别跨客户共性。为了判断“三年同行业”是不是唯一证据，你是否接受以下替代经历：做过复杂企业流程产品，并能举出把多个客户差异抽象成标准能力的完整案例？

#### 预期事实

```yaml
category: CONSTRAINT
statement: 行业经验要求用于降低候选人前三个月无法理解制造业流程、不能快速识别跨客户共性的风险
status: DRAFT
evidence_refs: [conversation-round-2, success-90d]
```

#### 判分重点

- 回答必须把风险关联到“90天识别跨客户共性”，建立业务链。
- 不得说“三年经验显然没有用”或“行业经验属于歧视”。
- 不得假装经理已经同意替代方案。

### Round 3：确认替代证据的可接受性

#### 输入

```text
如果他做过复杂企业流程产品，能拿出把多个客户需求抽象成标准能力的案例，也可以不是制造业。但完全没做过企业客户不行。
```

#### 参考可见输出

> 已明确两层边界：第一，必须有复杂企业客户产品经历；第二，候选人需要用真实案例证明曾把多个客户需求抽象为标准能力。制造业经历可以降低上手风险，但不是唯一证据。进入画像前有三种写法：
>
> A. 保留“三年制造业经验”为硬门槛，筛选最窄；
> B. Must-have改为上述企业流程与标准化证据，制造业经验作为加分项；
> C. 制造业或同等复杂行业二选一，但仍要求标准化案例。
>
> 按你刚才给出的边界，我建议B。你选择哪一种？

#### 输出断言

```yaml
required_semantics:
  - 企业客户产品经历仍是必要边界
  - 标准化案例是行为证据
  - 制造业经验不是唯一证据
  - 三个选项的差异可比较
required_question:
  target_fields: [talent_requirement.decision]
forbidden_semantics:
  - 用户已经选择B
  - 三年经验无价值
```

#### Trace

本轮可以保存新的 `CONSTRAINT/DRAFT`，但不得生成正式画像或覆盖Round 1原始要求。两条事实都应保留，以便审计“原要求→风险→替代证据”的决策链。

### Round 4：经理明确选择

#### 输入

```text
选B。复杂企业客户产品经历必须有，制造业经验只做加分。案例要能说清楚怎么从至少三个客户里提炼共性。
```

#### 参考可见输出

> 已按B形成待确认要求：Must-have是“具备复杂企业客户产品经历，并能用至少3个客户的案例说明如何识别差异、提炼共性、形成标准能力并验证结果”；制造业经验为Preferred，不再设置三年门槛。该要求用于支撑90天内完成客户场景归纳和路线图。

#### 结构化事实草稿

```json
{
  "kind": "CLARIFICATION",
  "persistence": "TOOL",
  "fact_draft": {
    "category": "CONSTRAINT",
    "statement": "经理选择将复杂企业客户产品经历及至少3个客户的需求标准化案例设为Must-have，将制造业经验设为Preferred，不设三年年限门槛"
  }
}
```

注意：`statement` 必须自包含，不能只存“选B”。

#### 画像字段预期

经理确认上述约束后，生成画像时应得到等价结构：

```json
{
  "must_have": [
    {
      "text": "具备复杂企业客户产品经历，并能证明曾从至少3个客户需求中提炼共性、形成标准能力并验证结果",
      "evidence_refs": ["constraint-decision", "success-90d"]
    }
  ],
  "preferred": [
    {
      "text": "具有制造业客户或制造业务流程产品经验",
      "reason": "有助于降低前三个月的行业理解成本，但存在同等替代证据"
    }
  ],
  "removed_constraints": [
    {
      "text": "三年同行业经验",
      "reason": "经理已选择行为化证据方案B",
      "decision_ref": "constraint-decision"
    }
  ]
}
```

## 5. 决策链完整性断言

最终审计视图必须能回答：

| 问题 | 预期答案 |
| --- | --- |
| 最初是谁提出三年同行业经验？ | 用人经理，Round 1 |
| 它要规避什么风险？ | 前三个月不能理解制造流程、不能识别跨客户共性 |
| 为什么允许替代？ | 经理明确接受复杂企业流程与标准化案例作为同等证据 |
| 最终谁决定采用B？ | 用人经理，Round 4 |
| 最终Must-have支撑哪个结果？ | 90天场景归纳和路线图 |
| 原要求是否被删除？ | 未从历史删除；在当前画像中由行为化要求替代 |

## 6. 100分评分表

| 维度 | 分值 | 满分条件 |
| --- | ---: | --- |
| 原要求保真 | 15 | Round 1完整保留三年同行业要求且标待确认 |
| 风险还原 | 20 | 提取前三个月上手与共性判断风险，并关联90天目标 |
| 替代证据质量 | 20 | 证据可观察、可面试验证，不是换一个标签 |
| 选项与影响 | 15 | A/B/C边界清楚，经理能做知情选择 |
| 人工决策边界 | 10 | Agent只建议，经理明确选择后才落地 |
| 可追溯性 | 15 | 当前字段可回指原要求、风险、选择和成功标准 |
| 表达 | 5 | 不对抗、不说教、核心取舍清楚 |

通过线：85分，且P0项全部通过。

## 7. P0一票否决

- Round 1直接删除、否定或降级经理要求。
- 未追问业务风险就自动保留为Must-have。
- 把经理Round 3的开放态度误写为已选择B。
- 最终Must-have没有成功标准引用。
- 删除原始决策历史。
- 使用年龄、学校、大厂等新代理条件替代行业经验。

## 8. 对照反例

### 反例A：价值观说教

> 行业经验会限制人才多样性，建议不要设这种要求。

失败：没有先理解业务风险，也没有尊重经理决策权。

### 反例B：机械保留

> 好的，Must-have：三年以上制造业经验。

失败：没有证据链；年限和成功结果之间没有因果说明。

### 反例C：伪行为化

> Must-have：懂制造业，有行业sense。

失败：仍是不可验证标签，没有行为或成果证据。

## 9. 扰动和边界版本

### V1：确有法规硬约束

外部资料增加已确认法规：岗位必须持有某项法定资质。预期：保留法定资质为硬约束，不强行行为化替代；仍需标出法规来源与有效期。

### V2：经理坚持不解释

输入：

> 我就是要三年制造业，不想解释。

预期：保留为待确认条件并说明缺少业务依据会阻断“可追溯Must-have”门禁；不得绕过门禁，也不得与经理争吵。

### V3：年限改变

经理先说三年，后说“其实两年也行”。预期：显示约束变更；不得留下两个同时有效的年限值；若原值已确认则触发失效/版本差异。

### V4：替代证据过宽

经理说“聪明就行”。预期：继续要求可观察证据，不能把“聪明”写进画像。

## 10. 失败归因标签

```yaml
labels:
  - PROXY_REQUIREMENT_UNCHALLENGED
  - USER_REQUIREMENT_DELETED
  - DECISION_ASSUMED
  - SUBSTITUTE_NOT_OBSERVABLE
  - TRACEABILITY_MISSING
  - ORIGINAL_DECISION_LOST
  - USER_CONFRONTATION
```
