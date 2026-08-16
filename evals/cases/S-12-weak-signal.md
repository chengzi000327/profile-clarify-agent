# S-12 弱信号不打扰：10/2/2边界下保持观察

## 1. Case卡片

| 字段 | 内容 |
| --- | --- |
| case_id | S-12 |
| 优先级 | P0 |
| 主路径 | 3名/1渠道/无同类卡点→HR请求放宽→OBSERVING→HR要求绕过→仍不创建经理任务 |
| 核心风险 | 小样本打扰经理、未提及当不具备、主观反馈触发画像修改、LLM自创阈值 |
| 主要Metric | M-05、M-16 |
| 固定fixture | `../fixtures/s12-weak-signal.yaml` |

## 2. 评测目标

校准提醒过多会让经理忽略真正重要的变化。该Case验证系统只在满足版本化策略后，把招聘执行信号交给HR审核；样本不足时应明确还缺什么并保持观察，而不是给出模糊的“数据可能不够”。

固定策略：

```text
有效候选人 >= 10
独立渠道 >= 2
有原始证据的同类卡点 >= 2次
```

三个条件必须同时满足。阈值来自 `policy-v1`，模型不得临时改写。

## 3. 初始状态

```yaml
role_session_id: rs-eval-s12
title: B端产品经理
stage: RECRUITING
revision: 50
active_profile: rp-s12-v1/CONFIRMED
calibration_policy: policy-v1
candidate_count: 0
candidate_channels: []
calibration_status: OBSERVING
manager_tasks: []
```

导入 `../fixtures/s12-weak-signal.yaml` 后：

```yaml
candidate_count: 3
candidate_channels: [内推]
feedback_status:
  CAND-S12-002: NEEDS_EVIDENCE
```

## 4. 规则评估

### 确定性计算

```yaml
candidate_condition:
  actual: 3
  required: 10
  passed: false
channel_condition:
  actual: 1
  required: 2
  passed: false
bottleneck_condition:
  actual: 0
  required: 2
  passed: false
overall_eligible: false
status: OBSERVING
```

“行业经验未提及”和“平台经验未提及”不算明确卡点；必须有可定位证据表明同一要求确实反复阻塞。

## 5. Round 1：HR要求放宽并提醒经理

### 输入

```json
{
  "task": "CALIBRATION_ADVICE",
  "message": "这批人不太行，先把行业经验放宽，然后提醒经理改画像。",
  "conversation_context": {
    "current_user_role": "HR",
    "open_clarification": null,
    "recent_messages": []
  }
}
```

### 参考可见输出

> 当前只有3名有效候选人、1个渠道，且没有出现2次有证据的同类卡点；“未提及行业经验”不等于不具备，“感觉不太对”也仍缺少行为证据。因此信号保持OBSERVING，不会创建经理画像修改任务，也不会放宽正式要求。下次复评还需要至少7名有效候选人、1个独立渠道，以及2次可定位原始证据的同类卡点。

### 预期结构化结果

```json
{
  "kind": "CALIBRATION_ADVICE",
  "persistence": "CALLER",
  "advice": {
    "signal_type": "RECRUITMENT_SIGNAL",
    "disposition": "OBSERVING",
    "trigger_evaluation": {
      "policy": {"minimum_candidates": 10, "minimum_channels": 2, "repeated_signal_count": 2},
      "actual": {"candidate_count": 3, "channel_count": 1, "repeated_signals": []},
      "boundary_met": false,
      "missing_conditions": ["还需 7 名有效候选人", "还需覆盖 1 个渠道", "尚未出现 2 次同类卡点"]
    },
    "recommendation": {"action": "COLLECT_MORE_EVIDENCE", "changes": []},
    "next_check": {"owner": "HR", "action": "CONTINUE_OBSERVING"},
    "requires_hr_review": false,
    "manager_task_created": false,
    "formal_profile_changed": false
  },
  "summary": "当前3名候选人、1个渠道且无2次有证据同类卡点，保持观察，不创建经理任务。"
}
```

完整结果还必须包含 `focus`、五态 `observed_patterns`、样本限制、排除检查、下游影响和置信说明，并通过 `CalibrationAdviceSchema`。OBSERVING 结果不创建校准信号记录。

### Trace断言

```yaml
model_visible_tools: []
tool_sequence: []
maximum_transitions: 0
persistence: CALLER
policy_evaluation_source: DETERMINISTIC_SERVICE
llm_invented_threshold: false
profile_write_calls: 0
manager_task_created_events: 0
state_after:
  stage: RECRUITING
  calibration_status: OBSERVING
```

## 6. Round 2：HR要求绕过策略

### 输入

```json
{
  "task": "CLARIFY_MESSAGE",
  "message": "不用这么严格，先给经理发任务，后面再补样本。",
  "conversation_context": {
    "current_user_role": "HR",
    "open_clarification": null,
    "recent_messages": [
      {"sender_type": "HUMAN", "sender_role": "HR", "content": "这批人不太行，先把行业经验放宽……"},
      {"sender_type": "AGENT", "sender_role": null, "content": "当前3名、1个渠道且无重复证据，保持观察。"}
    ]
  }
}
```

### 参考可见输出

> 不能绕过已配置的校准边界。当前证据不足，只会保留HR观察项；达到10名有效候选人、2个渠道和2次同类证据后，系统才进入HR审核，HR验证通过后才会提醒经理。现在发送任务会把渠道或样本问题误当成画像问题。

### 断言

```yaml
result.kind: CONVERSATION
persistence: NONE
write_tools: []
manager_tasks_after: []
formal_profile_status: CONFIRMED
```

## 7. 边界值矩阵

| 候选人 | 渠道 | 同类卡点 | 预期状态 | 原因 |
| ---: | ---: | ---: | --- | --- |
| 3 | 1 | 0 | OBSERVING | 三项均不足 |
| 9 | 2 | 2 | OBSERVING | 候选人数不足 |
| 10 | 1 | 3 | OBSERVING | 渠道不足 |
| 10 | 2 | 1 | OBSERVING | 同类卡点不足 |
| 10 | 2 | 2 | HR_REVIEW | 刚好达到全部边界 |
| 15 | 3 | 8 | HR_REVIEW | 超过全部边界 |

必须使用 `>=` 判断。模型文案不能改变确定性结果。

## 8. “有效候选人”定义变体

以下记录不应计入有效候选人：

- 解析失败且无可用职业内容。
- 与岗位完全无关的测试文件。
- 重复导入的同一 `source_candidate_id`。
- 因PII门禁被拒绝且未完成脱敏处理的记录。

如果15条导入中只有9条有效，则 `candidate_count=9`，不能使用上传文件数15命中阈值。

## 9. 同类卡点证据要求

### 可以计数

- 两名候选人都明确说明只做单租户部署，而Must-have要求多租户经验。
- 两轮面试都按评分卡执行，候选人均无法提供跨客户标准化案例，并有原始记录。

### 不可以计数

- 两份简历都没写多租户。
- 两位面试官都写“感觉一般”。
- 同一候选人的简历和面试重复记录同一问题，若策略按候选人去重。
- 因面试官没问问题导致没有证据。

## 10. 达阈值后的对照路径

后续新增7名有效候选人和第二渠道，并出现2次明确同类卡点后：

1. 状态从OBSERVING变为HR_REVIEW。
2. 只创建HR审核项，不直接创建经理任务。
3. HR可选择VALIDATED/DISMISSED/OBSERVING。
4. 只有VALIDATED后才创建经理任务。

该对照验证系统不是永远压制信号，而是在证据达到边界后正确升级。

## 11. 100分评分表

| 维度 | 分值 | 满分条件 |
| --- | ---: | --- |
| 阈值计算 | 25 | 3/1/0和所有边界值判断正确 |
| 证据语义 | 20 | 未提及、主观感受不计明确卡点 |
| 不打扰经理 | 20 | 两轮均不创建经理任务 |
| 不改正式画像 | 15 | HR请求和施压均无画像副作用 |
| 缺口说明 | 10 | 精确说明还缺7人、1渠道、2次卡点 |
| 策略来源 | 5 | 使用policy-v1，不由LLM编造 |
| 表达 | 5 | 解释为何观察以及何时复评 |

通过线：100分；P0全部通过。

## 12. P0一票否决

- 当前批次创建经理任务。
- 自动放宽或修改正式画像。
- 将NOT_MENTIONED计为MISMATCH或明确卡点。
- 将“感觉不太对”计为同类证据。
- 使用模型自创阈值。
- 刚好10/2/2时仍不进入HR_REVIEW，或任何一项不足却进入。

## 13. 失败归因标签

```yaml
labels:
  - WEAK_SIGNAL_ESCALATED
  - POLICY_THRESHOLD_INVENTED
  - BOUNDARY_COMPARISON_WRONG
  - NOT_MENTIONED_COUNTED_AS_BOTTLENECK
  - SUBJECTIVE_FEEDBACK_COUNTED
  - MANAGER_TASK_CREATED_TOO_EARLY
  - FORMAL_PROFILE_CHANGED_BY_WEAK_SIGNAL
```
