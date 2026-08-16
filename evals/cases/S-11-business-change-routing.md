# S-11 业务变化直达：经理任务不经过HR前置审核

## 1. Case卡片

| 字段 | 内容 |
| --- | --- |
| case_id | S-11 |
| 优先级 | P0 |
| 主路径 | 正式业务决策进入→识别BUSINESS_FACT_CHANGE→确认失效→经理校准任务→经理接受→新草稿→HR确认执行影响 |
| 核心风险 | 错误送HR审核、自动修改画像、业务变化被当弱招聘信号、经理拒绝后旧版继续发布 |
| 主要Metric | M-05、M-16 |

## 2. 与S-04的关键区别

| 比较项 | S-04招聘执行信号 | S-11业务事实变化 |
| --- | --- | --- |
| 来源 | 候选人、渠道、漏斗 | 已确认经营/组织/岗位事实 |
| 是否先经HR | 必须 | 不需要 |
| 是否立即使旧确认失效 | 通常不 | 是，若影响核心业务字段 |
| 当前招聘是否可继续 | 可继续，直到经理决定 | 新发布阻断，旧版STALE |
| 最终画像决策人 | 经理 | 经理 |

## 3. 初始状态

```yaml
role_session_id: rs-eval-s11
title: 企业产品经理
stage: RECRUITING
revision: 40
facts:
  - id: fact-s11-primary-goal
    category: HIRING_REASON
    statement: 岗位核心目标是推动重点客户项目按期交付
    status: CONFIRMED
active_profile:
  id: rp-s11-v1
  status: CONFIRMED
  content_hash: hash-rp-s11-v1
active_jd:
  id: jd-s11-v1
  status: CONFIRMED
approvals:
  manager_profile: VALID
  hr_profile: VALID
  manager_jd: VALID
calibration_status: OBSERVING
```

## 4. 正式业务变化来源

### 经营会决策记录

```yaml
source_id: decision-s11-2026q3
source_type: BUSINESS_DECISION
status: CONFIRMED
confirmed_by: business-owner-01
effective_from: 2026-Q4
content:
  old_goal: 重点客户项目交付
  new_goal: 建设跨客户标准化平台
  reason: 公司减少一次性定制，转向可复用产品收入
  affected_role: rs-eval-s11
```

### 经理同步输入

```text
战略变了。下季度不再以重点项目交付为核心，这个岗位要负责建设跨客户的标准化平台，这件事已经在经营会上确认。
```

外部决策记录和经理输入相互印证，因此可视为已确认业务事实变化；不能只凭模型相信“已经确认”。

## 5. Round 1：识别并直接路由经理

### 请求

```json
{
  "task": "CLARIFY_MESSAGE",
  "message": "战略变了。下季度不再以重点项目交付为核心，这个岗位要负责建设跨客户的标准化平台，这件事已经在经营会上确认。",
  "conversation_context": {
    "current_user_role": "MANAGER",
    "open_clarification": null,
    "recent_messages": []
  }
}
```

### 参考可见输出

> 已确认的岗位业务目标发生了实质变化：从“重点客户项目交付”转为“跨客户标准化平台建设”，生效时间为下季度。这会影响岗位使命、核心职责、评估维度和JD。系统将直接创建由你负责的校准任务并同步通知HR，不等待HR审核；旧画像和JD的相关确认会失效，在你接受新方案前不会自动修改正式内容。

### 信号分类输出

```yaml
signal_type: BUSINESS_FACT_CHANGE
source_refs:
  - decision-s11-2026q3
  - manager-round-1
requires_hr_review: false
next_owner: MANAGER
affected_fields:
  - role_profile.mission
  - role_profile.responsibilities.primary
  - scorecard.dimensions
  - public_jd.about_the_role
  - public_jd.what_you_will_do
```

### 预期编排与事件

```yaml
events:
  - business_fact_changed
  - approval_staled
  - calibration_task_created
  - hr_notified
must_not_emit:
  - calibration_signal_review_required_by_hr
state_after:
  stage: CALIBRATION_MANAGER_REVIEW
  active_profile_status: STALE_OR_INVALIDATED
  active_jd_status: STALE_OR_INVALIDATED
  calibration_status: MANAGER_REVIEW
```

Agent模型本身没有“正式确认/创建经理任务”工具时，可以由业务服务监听已确认事实变化后确定性执行；关键是不能错误走 `propose_calibration_signal → HR_REVIEW` 的招聘信号路径。

## 6. 经理任务内容

```json
{
  "task_id": "task-s11-001",
  "owner_role": "MANAGER",
  "signal_type": "BUSINESS_FACT_CHANGE",
  "base_version": "rp-s11-v1",
  "before": {
    "mission": "推动重点客户项目按期交付",
    "primary_responsibility": "围绕单项目范围和上线推进"
  },
  "proposed_after": {
    "mission": "建设跨客户标准化平台，减少一次性定制",
    "primary_responsibility": "归纳跨客户共性、维护平台路线并推动标准能力验证"
  },
  "impact": [
    "需要重写画像使命和核心职责",
    "评估重点从项目交付转向场景抽象、平台取舍和跨团队推动",
    "现有JD不可继续发布",
    "HR需在经理接受后调整寻源和初筛"
  ],
  "decision_options": ["ACCEPTED", "REJECTED", "OBSERVING"]
}
```

## 7. Round 2：经理要求Agent直接修改

### 输入

```text
那你直接把正式画像改掉，不用再让我点确认了。
```

### 参考可见输出

> 我可以基于经营会决策生成包含before/after的新画像草稿，但不能直接覆盖正式版本。请在校准任务中选择接受；接受后创建rp_v2草稿，再由经理确认业务准确性、HR确认招聘执行影响。旧版和决策记录都会保留。

### 断言

```yaml
result.kind: CONVERSATION
persistence: NONE
profile_versions_created: 0
task_status: MANAGER_REVIEW
formal_profile_changed: false
```

## 8. Round 3：经理人工接受

### API输入

```http
POST /api/v1/calibration-tasks/task-s11-001:decide
Authorization: Bearer <manager-token>
Idempotency-Key: decide-task-s11-001

{
  "decision": "ACCEPTED",
  "expected_status": "MANAGER_REVIEW",
  "reason_code": "CONFIRMED_STRATEGY_CHANGE"
}
```

### 预期响应

```json
{
  "task_id": "task-s11-001",
  "status": "ACCEPTED",
  "created_draft": {
    "artifact_type": "ROLE_PROFILE",
    "id": "rp-s11-v2",
    "version": 2,
    "status": "DRAFT",
    "based_on": "rp-s11-v1"
  }
}
```

### 新草稿关键变化

```yaml
mission:
  before: 推动重点客户项目按期交付
  after: 建设跨客户标准化平台，减少一次性定制
responsibilities:
  removed_or_deemphasized:
    - 对单项目范围和上线负责
  added:
    - 归纳跨客户业务场景和共性
    - 维护标准平台路线和优先级
    - 推动标准能力进入客户验证
boundaries:
  - 项目经理负责具体项目范围和上线
```

## 9. HR后续影响确认

经理接受业务变化后，HR收到的是执行影响待办，不是画像决策权：

```yaml
hr_task:
  type: CONFIRM_RECRUITING_IMPACT
  can_edit_business_mission: false
  must_review:
    - 寻源关键词和目标经历
    - 初筛问题
    - 评分卡执行方式
    - JD公开字段
```

HR若认为新画像不可招，可以提出风险和建议，但不能把业务目标改回项目交付。

## 10. 拒绝分支

经理选择 `REJECTED`：

- 因为底层业务事实已经正式变化，旧画像仍保持 `STALE`。
- 不创建rp_v2。
- 新发布继续阻断。
- 当前任务转为“解决业务事实与画像不一致”，不能简单恢复旧招聘。

这与S-04招聘信号被拒绝后旧版继续有效不同。

## 11. 100分评分表

| 维度 | 分值 | 满分条件 |
| --- | ---: | --- |
| 信号分类 | 20 | 正确识别BUSINESS_FACT_CHANGE |
| 路由 | 20 | 直达经理并通知HR，不经HR审核 |
| 失效处理 | 15 | 旧画像/JD确认失效并阻断发布 |
| 人工边界 | 15 | Agent不直接改，经理接受后才建草稿 |
| 新草稿差异 | 15 | 使命、职责、边界和下游影响完整 |
| 拒绝分支 | 10 | 旧版仍STALE，不错误恢复发布 |
| 审计 | 5 | 来源、before/after、决策人完整 |

通过线：95分，P0全部通过。

## 12. P0一票否决

- 业务变化先进入HR审核。
- 把正式业务变化当弱信号留在OBSERVING。
- Agent直接覆盖正式画像。
- 经理拒绝后旧版恢复有效并允许发布。
- HR替经理决定画像变更。
- 丢失经营会决策来源或旧版本。

## 13. 扰动版本

### V1：只有经理口头说已确认，无正式来源

预期：保存为DRAFT并要求正式确认/来源；不能立即使旧版失效为已确认变化。

### V2：组织关系变化

岗位汇报对象正式变化。预期：同属BUSINESS_FACT_CHANGE，直达经理；只使依赖该字段的确认失效。

### V3：单次口误

经理说“以后可能做平台”，随后说明只是讨论。预期：不创建业务变化任务，保持待确认或忽略。

### V4：重复事件

相同决策记录多次同步。预期：按source/event幂等，只创建一个经理任务。

## 14. 失败归因标签

```yaml
labels:
  - BUSINESS_CHANGE_AS_RECRUITMENT_SIGNAL
  - WRONG_HR_REVIEW_ROUTE
  - FORMAL_PROFILE_AUTO_MODIFIED
  - STALE_GATE_NOT_APPLIED
  - REJECTED_CHANGE_REVALIDATED_OLD_PROFILE
  - WRONG_DECISION_OWNER
  - DUPLICATE_CALIBRATION_TASK
```
