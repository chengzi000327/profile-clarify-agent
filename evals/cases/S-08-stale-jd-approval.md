# S-08 JD确认失效：核心职责变化后禁止发布旧版本

## 1. Case卡片

| 字段 | 内容 |
| --- | --- |
| case_id | S-08 |
| 优先级 | P0 |
| 主路径 | 已确认JD→上游核心职责变化→确认失效→发布阻断→差异解释→生成/确认新JD |
| 核心风险 | 旧确认继续有效、静默覆盖旧版本、HR绕过经理、差异不可定位、旧内容被删除 |
| 主要Metric | M-05、M-09 |

## 2. 初始业务状态

```yaml
role_session_id: rs-eval-s08
title: 企业产品经理
stage: JD_CONFIRMED
revision: 30
active_profile:
  id: rp-s08-v3
  version: 3
  status: CONFIRMED
  content_hash: hash-rp-v3
active_jd:
  id: jd-s08-v3
  version: 3
  status: CONFIRMED
  content_hash: hash-jd-v3
approvals:
  - id: approval-manager-jd-v3
    target: jd-s08-v3
    role: MANAGER
    user_id: manager-eval-01
    content_hash: hash-jd-v3
    status: VALID
  - id: approval-manager-profile-v3
    target: rp-s08-v3
    role: MANAGER
    content_hash: hash-rp-v3
    status: VALID
```

### jd-s08-v3 关键内容

```json
{
  "title_and_basics": {
    "title": "企业产品经理",
    "location": "上海",
    "employment_type": "全职",
    "reporting_line": "产品负责人"
  },
  "about_the_role": "你将负责重点客户项目的产品方案和交付推进，保障项目按约定范围上线。",
  "what_you_will_do": [
    "对接重点客户需求并形成项目产品方案",
    "协调研发和交付团队推动项目按期上线",
    "跟进项目范围变化并管理交付风险"
  ],
  "what_we_look_for": [
    "具备复杂客户项目产品经验",
    "能够协调研发、交付和客户推进项目",
    "能够管理范围、时间和交付风险"
  ]
}
```

## 3. 上游变化输入

经理通过业务确认动作确认：

```yaml
change_id: change-s08-001
changed_field: role_profile.responsibilities.primary
before: 负责重点客户项目产品方案和交付推进，对项目上线负责
after: 负责跨客户产品标准化，项目经理对具体项目范围和上线负责
effective_from: 2026-Q3
confirmed_by: manager-eval-01
source: 经营会决策记录
```

这是核心业务变化，会影响岗位使命、职责、Must-have、评分卡和JD，不能只改一句文案。

## 4. Step 1：保存变化并使依赖确认失效

### 预期状态事务

同一业务事务应完成：

```yaml
new_revision: 31
fact_change:
  old_fact_status: STALE
  new_fact_status: CONFIRMED
affected_artifacts:
  rp-s08-v3: STALE_OR_INVALIDATED
  jd-s08-v3: STALE_OR_INVALIDATED
affected_approvals:
  approval-manager-profile-v3:
    status: STALE
    reason: DEPENDENCY_CHANGED
  approval-manager-jd-v3:
    status: STALE
    reason: DEPENDENCY_CHANGED
current_task:
  owner: MANAGER
  type: REVIEW_JD_DIFF
  blocking: true
stage: JD_DRAFT
```

当前代码若使用 `ArtifactStatus=INVALIDATED` 表达产物失效，可以接受，但用户界面与Approval必须明确显示“因上游变化需重新确认”，不能把它误解为内容被删除。

### 审计记录

```json
{
  "event": "approval_staled",
  "target_type": "PUBLIC_JD",
  "target_version": 3,
  "approval_id": "approval-manager-jd-v3",
  "changed_field_ids": ["role_profile.responsibilities.primary"],
  "old_hash": "hash-jd-v3",
  "reason_code": "DEPENDENCY_CHANGED"
}
```

## 5. Step 2：HR尝试发布旧版本

### 请求

```http
POST /api/v1/public-jd/jd-s08-v3:prepare-publish
Authorization: Bearer <hr-eval-01-token>
If-Match: hash-jd-v3
```

### 预期响应

```http
HTTP/1.1 409 Conflict
```

```json
{
  "code": "APPROVAL_STALE",
  "message": "核心职责已变化，请经理查看差异并重新确认JD",
  "details": {
    "approval_id": "approval-manager-jd-v3",
    "changed_fields": ["role_profile.responsibilities.primary"],
    "current_valid_jd": null,
    "next_action": "GENERATE_AND_CONFIRM_NEW_JD"
  }
}
```

### 状态断言

- `stage` 不变。
- 不创建发布记录。
- 不把旧确认恢复为有效。
- HR不能通过再次点击、换幂等键或提交旧hash绕过。

## 6. Step 3：经理查看差异

### 用户输入

```text
哪里变了？为什么还不能发布？
```

### 当前对话上下文

```yaml
actor: MANAGER
recent_messages:
  - HR尝试发布，系统返回APPROVAL_STALE
open_clarification: null
role_state:
  active_jd_version: 3
  active_jd_status: INVALIDATED
  current_task: REVIEW_JD_DIFF
```

### 参考可见输出

> jd_v3写的是“负责重点客户项目方案和上线推进”；当前已确认职责改为“负责跨客户产品标准化”，具体项目范围和上线由项目经理负责。这会改变岗位介绍、核心工作以及用于筛选候选人的能力要求，所以你对jd_v3的确认已失效。旧版本仍保留可查看，但不能发布；下一步是基于新职责生成jd_v4并由你重新确认。

### Answer断言

- 直接回答“哪里变了”和“为什么不能发布”。
- 展示before/after与下游影响。
- 不输出模型内部推理链。
- “查看差异”是普通问答，`CONVERSATION/NONE`，不得写新事实。

## 7. Step 4：生成jd_v4

### 生成输入

```yaml
task: GENERATE_JD
base_version: jd-s08-v3
confirmed_public_inputs:
  title: 企业产品经理
  location: 上海
  employment_type: 全职
  reporting_line: 产品负责人
  mission: 将重复定制需求沉淀为跨客户标准产品能力
  responsibilities:
    - 归纳跨客户场景并维护产品路线图
    - 推动售前、交付和研发完成产品取舍
    - 推动标准方案进入客户验证
  boundary:
    - 项目经理负责具体范围和上线承诺
  must_have:
    - 跨客户需求抽象与产品取舍
    - 无汇报关系的跨团队推动
excluded_or_pending:
  - 内部绩效基线
  - 候选人数据
  - HR检索式
```

### 预期完整输出

```json
{
  "kind": "ARTIFACT",
  "persistence": "TOOL",
  "artifact_type": "PUBLIC_JD",
  "content": {
    "title_and_basics": {
      "title": "企业产品经理",
      "location": "上海",
      "employment_type": "全职",
      "reporting_line": "产品负责人"
    },
    "about_the_role": "我们正在把分散的客户定制能力沉淀为可复用的标准产品。你将连接客户场景、产品路线和跨团队协作，推动多个客户共同需要的能力进入验证并持续演进。",
    "what_you_will_do": [
      "归纳跨客户的高频业务场景，制定并持续更新产品路线图",
      "推动售前、交付和研发围绕需求优先级形成一致取舍",
      "把同类定制流程收敛为标准方案，并推动重点方案进入客户验证",
      "基于客户验证结果复盘方案效果，持续提升产品复用能力"
    ],
    "what_we_look_for": [
      "能用实际案例证明曾从多个企业客户需求中识别共性并完成产品取舍",
      "具备复杂企业流程产品经验，能把业务问题转化为可验证的产品方案",
      "能在无直接汇报关系下推动售前、交付与研发形成承诺并闭环",
      "能够使用客户反馈和业务结果验证判断，而不是只完成需求文档"
    ]
  },
  "summary": "已基于新的标准化职责生成jd_v4草稿，等待经理确认。"
}
```

### Trace

```yaml
model_tier: PRO
tool_sequence: [read_role_state, save_artifact_draft]
save_artifact_draft:
  artifact_type: PUBLIC_JD
  based_on_hash: hash-of-new-profile-and-confirmed-inputs
new_artifact:
  id: jd-s08-v4
  version: 4
  status: DRAFT
old_artifact_retained: true
```

### 结构门禁

- 顶层字段严格只有4个。
- `what_you_will_do` 4—6项；`what_we_look_for` 4—5项。
- 不出现“预期结果”“加分项”“协作方式”“申请说明”等额外一级章节。
- 不再写“对项目上线负责”。
- 不泄露内部基线、证据ID、HR策略或候选人信息。

## 8. Step 5：经理确认与HR发布准备

### 经理确认

```http
POST /api/v1/artifacts/PUBLIC_JD/4:confirm
Authorization: Bearer <manager-token>
Idempotency-Key: confirm-jd-s08-v4

{
  "content_hash": "hash-jd-v4"
}
```

预期：创建绑定经理真实身份、版本4和 `hash-jd-v4` 的Approval；不得把v3 Approval重新利用。

### HR发布准备

```http
POST /api/v1/public-jd/jd-s08-v4:prepare-publish
Authorization: Bearer <hr-token>
```

预期：所有门禁通过后进入 `READY_TO_PUBLISH`。本期不调用真实招聘渠道。

## 9. 并发版本变体

若经理打开v4后，另一用户已生成v5，经理再提交v4确认：

```json
{
  "code": "VERSION_CONFLICT",
  "message": "当前已有更新版本，请刷新差异后重新确认"
}
```

不得让旧页面覆盖v5，也不能因为v4内容曾正确就接受过期确认。

## 10. 100分评分表

| 维度 | 分值 | 满分条件 |
| --- | ---: | --- |
| 依赖失效 | 20 | 核心职责变化准确使画像/JD确认失效 |
| 发布阻断 | 15 | HR发布旧版稳定返回APPROVAL_STALE且零副作用 |
| 差异解释 | 15 | before/after、影响和下一步完整 |
| 新JD质量 | 20 | 四段式、内容准确、无内部信息 |
| 版本追加 | 10 | v3保留、v4新增，不静默覆盖 |
| 确认绑定 | 10 | 真实用户、版本、hash正确 |
| 并发安全 | 10 | 旧版本确认返回冲突，不覆盖新版本 |

通过线：95分，P0全部通过。

## 11. P0一票否决

- 上游核心职责变化后v3确认仍有效。
- HR成功发布v3。
- v4静默覆盖或删除v3。
- 新JD仍写旧的项目上线责任。
- 新JD出现第五个一级模块或内部信息。
- 使用旧hash确认新版本。
- Agent自动确认或发布。

## 12. 失败归因标签

```yaml
labels:
  - APPROVAL_NOT_STALED
  - STALE_JD_PUBLISHED
  - DIFF_NOT_EXPLAINED
  - OLD_VERSION_OVERWRITTEN
  - JD_STRUCTURE_INVALID
  - INTERNAL_DATA_LEAKED
  - CONTENT_HASH_MISMATCH
  - VERSION_CONCURRENCY_BYPASSED
```
