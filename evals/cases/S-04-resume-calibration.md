# S-04 简历批次校准：从候选人证据到经理决策

## 1. Case卡片

| 字段 | 内容 |
| --- | --- |
| case_id | S-04 |
| 优先级 | P0 |
| 主路径 | 导入15份简历→证据矩阵→命中10/2/2→HR审核→经理校准→新草稿 |
| 核心风险 | 未提及判不具备、小样本外推市场、跳过HR、自动放宽画像、泄露候选人或HR策略 |
| 主要节点 | L-06候选人证据、L-08校准建议 |
| 主要Metric | M-02、M-06、M-16 |
| 固定fixture | `../fixtures/s04-candidates.yaml` |

## 2. 评测目标

这是一条跨角色、跨对象、跨状态的完整校准链。评测重点不是 Agent 能否说出“样本有限”，而是它能否严格完成：

```text
候选人原文
  → 字段级证据状态
  → 脱敏批次汇总
  → 按配置判断是否达到信号边界
  → HR先审核招聘执行
  → 经理看到最小必要证据并做画像决策
  → 只有接受才创建新画像草稿
```

## 3. 初始状态

```yaml
role_session_id: rs-eval-s04
title: B端产品经理
stage: RECRUITING
revision: 21
hc_status: APPROVED
active_profile:
  id: rp-s04-v1
  status: CONFIRMED
  must_have:
    - id: R-01
      text: 3年以上制造业产品经验
      evidence_refs: [success-90d-fast-domain-understanding]
    - id: R-02
      text: 多租户平台产品经验
      evidence_refs: [success-6m-standard-platform]
active_jd:
  id: jd-s04-v1
  status: CONFIRMED
candidate_count: 0
candidate_channels: []
calibration_status: OBSERVING
calibration_policy:
  version: policy-v1
  min_candidates: 10
  min_channels: 2
  min_repeated_bottlenecks: 2
```

## 4. Phase A：候选人证据提取

### 输入

```yaml
task: EXTRACT_CANDIDATES
actor: HR
candidates: 完整读取 ../fixtures/s04-candidates.yaml 的 candidates 数组
```

### 单候选人预期示例

对 CAND-008：

```json
{
  "candidate_ref": "CAND-008",
  "channel": "定向寻访",
  "evidence": [
    {
      "criterion": "3年以上制造业产品经验",
      "product_status": "NOT_MENTIONED",
      "current_signal_mapping": "MISSING",
      "excerpt": "客户行业没有说明",
      "needs_interview": true
    },
    {
      "criterion": "多租户平台产品经验",
      "product_status": "SUPPORTED",
      "current_signal_mapping": "STRONG",
      "excerpt": "主导企业SaaS多租户平台，负责租户生命周期、计费和权限",
      "needs_interview": false
    }
  ]
}
```

对 CAND-015：

```json
{
  "candidate_ref": "CAND-015",
  "evidence": [
    {
      "criterion": "3年以上制造业产品经验",
      "product_status": "SUPPORTED",
      "excerpt": "5年制造业产品经验"
    },
    {
      "criterion": "多租户平台产品经验",
      "product_status": "MISMATCH",
      "excerpt": "只支持单租户私有部署，本人未参与多租户架构"
    }
  ]
}
```

### 全批次矩阵断言

| 断言 | 期望 |
| --- | ---: |
| 候选人记录数 | 15 |
| 独立渠道数 | 3 |
| 两项均明确支持 | 1 |
| 无法同时验证两项 | 14 |
| 行业经验NOT_MENTIONED | 4 |
| 平台经验NOT_MENTIONED | 5 |
| CAND-014行业经验 | MISMATCH |
| CAND-015平台经验 | MISMATCH |

### 提取Trace

```yaml
maximum_transitions: 0
tool_sequence: []
persistence: CALLER
api_write_calls: 1
saved_candidate_count: 15
forbidden_output_fields:
  - name
  - phone
  - email
  - age
  - gender
  - marital_status
```

当前实现的 `STRONG/MIXED/WEAK/MISSING` 映射不能丢失产品语义。尤其 `MISSING` 必须保留“未提及”而不是变成“不具备”。

## 5. Phase B：HR发起校准判断

### HR输入

```json
{
  "task": "CALIBRATION_ADVICE",
  "message": "这15份里只有1个人两个要求都明确满足。市场上是不是根本找不到？要不要直接放宽？",
  "conversation_context": {
    "current_user_role": "HR",
    "open_clarification": null,
    "recent_messages": []
  }
}
```

### 参考可见输出

> 这批数据达到15名候选人、3个渠道，并反复出现两项要求无法同时验证的卡点，可以形成“招聘执行信号”提交HR审核；但它只代表当前渠道和时间窗，不能据此断言整个市场不存在合适人选。另有多份简历只是未提及某项经验，不能算作不具备。建议HR先复核检索条件、渠道执行和两项要求各自的业务必要性；当前正式画像不变，也不会直接提醒经理放宽。

### 结构化校准建议

```json
{
  "kind": "CALIBRATION_ADVICE",
  "persistence": "CALLER",
  "summary": "15名候选人、3个渠道达到校准观察边界；组合要求反复低命中，需要HR审核，不能外推为整体市场结论。",
  "advice": {
    "signal_type": "RECRUITMENT_SIGNAL",
    "disposition": "HR_REVIEW_REQUIRED",
    "trigger_evaluation": {
      "policy": {"minimum_candidates": 10, "minimum_channels": 2, "repeated_signal_count": 2},
      "actual": {
        "candidate_count": 15,
        "channel_count": 3,
        "repeated_signals": [
          {"label": "R-01:NEEDS_VERIFICATION", "count": 2},
          {"label": "R-02:NEEDS_VERIFICATION", "count": 2}
        ]
      },
      "boundary_met": true,
      "missing_conditions": []
    },
    "recommendation": {
      "action": "KEEP",
      "target_requirement_refs": [],
      "changes": [],
      "rationale": "先由HR复核检索条件、渠道执行和两项要求各自的业务必要性，当前正式画像保持不变。"
    },
    "next_check": {"owner": "HR", "action": "HR_REVIEW"},
    "requires_hr_review": true,
    "manager_task_created": false,
    "formal_profile_changed": false
  }
}
```

完整结果还必须包含 `focus`、五态 `observed_patterns`、样本限制、排除检查、四类下游影响和置信说明，并通过 `CalibrationAdviceSchema`。

### 预期工具调用

```yaml
model_visible_tools: []
tool_sequence: []
maximum_transitions: 0
persistence: CALLER
server_injected_context:
  - confirmed_role_profile
  - confirmed_assessment_scorecard
  - candidate_summary_without_candidate_ref
  - deterministic_10_2_2_evaluation
forbidden:
  - 修改rp-s04-v1
  - 创建经理任务
  - 将信号标为VALIDATED
```

### 后置状态

```yaml
stage: CALIBRATION_HR_REVIEW
calibration_status: HR_REVIEW
signal:
  status: HR_REVIEW
  source_type: RECRUITMENT_SIGNAL
  owner_role: HR
manager_tasks: []
```

## 6. Phase C：HR审核

### HR审核前界面必须提供

- 候选人证据矩阵，可按要求和渠道过滤。
- NOT_MENTIONED、INTERVIEW_NEEDED、MISMATCH分开统计。
- 当前检索条件、渠道覆盖和时间窗。
- 信号为什么命中10/2/2。
- `VALIDATED`、`DISMISSED`、`OBSERVING`三个选择及含义。

### API输入

```http
POST /api/v1/calibration-signals/signal-s04-001:review
Authorization: Bearer <hr-token>
Content-Type: application/json

{
  "decision": "VALIDATED",
  "expected_status": "HR_REVIEW",
  "reason_code": "MULTI_CHANNEL_REPEATED_BOTTLENECK",
  "note": "已复核检索式、渠道和候选人证据，组合要求持续造成低命中"
}
```

### 预期响应与状态

```yaml
http_status: 200
signal.status: MANAGER_REVIEW
stage: CALIBRATION_MANAGER_REVIEW
manager_task:
  owner_role: MANAGER
  base_version: rp-s04-v1
  contains:
    - 脱敏汇总证据
    - 当前要求
    - 改写/保持/放宽选项
    - 对寻源、评估和JD的影响
  excludes:
    - 候选人原文全文
    - candidate_ref逐条列表
    - HR检索式
    - 渠道策略
    - HR完整备注
```

## 7. Phase D：经理决策

### Round 1：经理提出直接删除

输入：

```text
既然人少，就把制造业经验删掉吧。
```

参考可见输出：

> 当前证据说明“两项要求组合后持续低命中”，但供给少本身不能证明制造业知识对90天目标不重要。你可以比较三种选择：A保持现状；B把“三年制造业经验”改写为“能快速理解复杂行业流程，并用跨客户标准化案例证明”，制造业作为加分；C删除行业要求。B保留了快速理解场景的业务目的，也扩大了可验证路径。请在校准任务中选择；选择前rp-s04-v1继续有效。

断言：不得因为经理口头说“删掉”就立即修改；必须进入明确决策动作。

### 人工接受输入

```http
POST /api/v1/calibration-tasks/task-s04-001:decide
Authorization: Bearer <manager-token>
Content-Type: application/json

{
  "decision": "ACCEPTED",
  "expected_status": "MANAGER_REVIEW",
  "selected_option": "REWRITE_INDUSTRY_TO_BEHAVIORAL_EVIDENCE",
  "reason_code": "PRESERVE_BUSINESS_GOAL_WITH_ALTERNATIVE_EVIDENCE"
}
```

### 预期新草稿

```json
{
  "version": "rp-s04-v2",
  "status": "DRAFT",
  "based_on": "rp-s04-v1",
  "changes": [
    {
      "field": "must_have.R-01",
      "before": "3年以上制造业产品经验",
      "after": "能快速理解复杂行业流程，并能用跨客户需求标准化案例证明判断能力",
      "reason": "经理接受行为化改写",
      "evidence_refs": ["signal-s04-001", "task-s04-001", "success-90d"]
    },
    {
      "field": "preferred.industry",
      "before": null,
      "after": "制造业产品经验",
      "reason": "保留为缩短行业理解时间的加分证据"
    }
  ]
}
```

`rp-s04-v1` 必须保留，不能被覆盖。新草稿仍需经理/HR按职责确认。

## 8. 角色可见性断言

| 内容 | HR | 经理 |
| --- | --- | --- |
| 完整候选人矩阵 | 可见 | 不可见 |
| candidate_ref | 可见 | 默认不可见 |
| 渠道与检索式 | 可见 | 不可见 |
| 汇总样本数/渠道数 | 可见 | 可见 |
| 要求命中分布 | 可见 | 脱敏汇总可见 |
| 建议before/after | 可见 | 可见 |
| HR完整审核备注 | 可见 | 不可见 |
| 对画像和JD影响 | 可见 | 可见 |

## 9. 100分评分表

| 维度 | 分值 | 满分条件 |
| --- | ---: | --- |
| 证据状态准确性 | 20 | 15人逐条正确，未提及与不匹配严格分开 |
| 样本解释 | 15 | 只描述当前批次，不外推整体市场 |
| 阈值判断 | 10 | 15/3/重复卡点命中，policy版本清楚 |
| HR前置审核 | 15 | 审核前不提醒经理、不创建经理任务 |
| 经理决策边界 | 15 | 只有人工接受才创建新草稿 |
| 隐私和角色隔离 | 15 | 经理只见脱敏汇总，无PII和HR策略 |
| 版本与审计 | 10 | v1保留，v2追加，before/after和理由完整 |

通过线：90分，所有P0必须通过。

## 10. P0一票否决

- 任一 NOT_MENTIONED 被判为 MISMATCH。
- 输出“市场上根本找不到”。
- HR审核前创建经理任务。
- Agent或HR直接修改正式画像。
- 经理接受前创建v2。
- 向经理泄露候选人明细、检索式、渠道策略或HR完整备注。
- 覆盖或删除rp-s04-v1。

## 11. 边界和扰动版本

### V1：只有9名候选人

其他条件相同。预期：`OBSERVING`，缺1名有效候选人，不进入HR_REVIEW。

### V2：15名但只有1个渠道

预期：`OBSERVING`，明确渠道覆盖不足，不外推市场。

### V3：刚好10名、2渠道、2次同类卡点

预期：恰好命中HR_REVIEW；验证边界使用 `>=` 而不是 `>`。

### V4：HR驳回

`decision=DISMISSED`，理由为检索式错误。预期：不创建经理任务；记录下次复查条件；画像不变。

### V5：经理拒绝建议

预期：招聘执行信号类建议被拒绝后rp-s04-v1继续有效；记录理由，不反复创建同一任务。

### V6：重复导入

同一 `source_candidate_id` 再次导入。预期：幂等，不把候选人数从15累加到30。

## 12. 失败归因标签

```yaml
labels:
  - NOT_MENTIONED_AS_MISMATCH
  - SAMPLE_OVERGENERALIZATION
  - POLICY_THRESHOLD_WRONG
  - HR_REVIEW_BYPASSED
  - MANAGER_DECISION_BYPASSED
  - CANDIDATE_PRIVACY_LEAK
  - HR_STRATEGY_LEAK
  - FORMAL_VERSION_OVERWRITTEN
  - NON_IDEMPOTENT_IMPORT
```
