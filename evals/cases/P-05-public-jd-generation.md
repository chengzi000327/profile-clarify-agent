# P-05 对外 JD 生成专项评测

## 1. 评测目标

验证模型能将已确认岗位画像转写为候选人可读的四段式对外 JD，并同时满足：

- 基础信息与已确认的公开字段精确一致；
- 职责和要求可追溯至已确认岗位画像；
- 评估方案只用于帮助行为化表达，不泄露内部评分逻辑；
- 招聘平台截图只作为表达风格参考，其中的薪资、学历、论文和竞赛条件不被复制；
- 严格只有四个一级模块；
- 模型零工具调用，服务端校验后保存草稿。

## 2. 初始业务状态

```yaml
role_session_id: rs-eval-p05
title: 大模型算法工程师
department: 基础模型团队
hc_status: APPROVED
stage: ASSESSMENT_CONFIRMED
conflicts: []
public_job_basics:
  location:
    value: 北京
    status: CONFIRMED
    visibility: PUBLIC
    source: HR
  employment_type:
    value: 全职
    status: CONFIRMED
    visibility: PUBLIC
    source: HR
  work_mode:
    value: 现场办公
    status: CONFIRMED
    visibility: PUBLIC
    source: HR
latest_artifacts:
  ROLE_PROFILE:
    version: 3
    status: CONFIRMED
    content:
      mission:
        statement: 提升基础大模型的训练效率、推理能力和在核心业务场景中的可用性。
      work:
        - id: W-01
          title: 研发与验证大模型预训练和后训练方法
        - id: W-02
          title: 建设高质量训练数据生产与评估闭环
        - id: W-03
          title: 分析模型效果并定位训练、数据或评估问题
        - id: W-04
          title: 与产品和工程团队推动模型在核心场景落地
      requirements:
        - id: R-01
          priority: MUST_HAVE
          name: 能够独立完成模型训练或效果问题的诊断与验证
          work_refs: [W-01, W-03]
        - id: R-02
          priority: MUST_HAVE
          name: 能够设计、构建并评估高质量数据流程
          work_refs: [W-02]
        - id: R-03
          priority: MUST_HAVE
          name: 能够将算法判断转化为可落地的工程方案
          work_refs: [W-04]
        - id: R-04
          priority: PREFERRED
          name: 有大模型研究、开源或复杂工业项目中的可核验成果
          work_refs: [W-01, W-04]
  ASSESSMENT_SCORECARD:
    version: 2
    status: CONFIRMED
    content:
      dimensions:
        - id: D-01
          name: 模型问题诊断与实验判断
          weight: 40
          requirement_refs: [R-01]
          work_refs: [W-01, W-03]
        - id: D-02
          name: 数据体系设计与评估
          weight: 35
          requirement_refs: [R-02]
          work_refs: [W-02]
        - id: D-03
          name: 技术落地与跨团队协作
          weight: 25
          requirement_refs: [R-03, R-04]
          work_refs: [W-04]
  PUBLIC_JD:
    version: 1
    status: INVALIDATED
```

旧 JD 内容不得进入模型上下文。截图中的“40–70K·16薪”、“硕士”、顶会论文和竞赛成绩只是 `STYLE_REFERENCE`，不是本岗位事实。

## 3. 输入

```json
{
  "task": "GENERATE_JD",
  "message": "请按照这张招聘平台截图的清晰风格生成对外 JD",
  "maximum_transitions": 0,
  "structured_output_repair_attempts": 1,
  "conversation_context": {
    "current_user_role": "HR",
    "open_clarification": null,
    "recent_messages": []
  }
}
```

## 4. 预期结构化结果

```json
{
  "kind": "ARTIFACT",
  "persistence": "CALLER",
  "artifact_type": "PUBLIC_JD",
  "content": {
    "title_and_basics": {
      "title": "大模型算法工程师",
      "department": "基础模型团队",
      "location": "北京",
      "employment_type": "全职",
      "work_mode": "现场办公"
    },
    "about_the_role": "基础模型团队正在持续提升大模型的训练效率、推理能力和业务可用性。这个岗位将围绕模型训练、数据和评估中的关键问题开展研发与验证。你会与产品和工程团队协作，将有效的算法判断转化为可持续落地的方案。",
    "what_you_will_do": [
      "研发并验证大模型预训练和后训练方法，持续改善模型效果与训练效率。",
      "设计和建设高质量训练数据的生产、处理与评估流程。",
      "分析模型表现，定位训练、数据或评估环节的关键问题，并通过实验验证解决方案。",
      "协同产品和工程团队，推动模型能力在核心业务场景中落地并持续优化。"
    ],
    "what_we_look_for": [
      "能够独立诊断模型训练或效果问题，提出有依据的假设并通过实验验证。",
      "能够设计、构建并评估高质量数据流程，识别影响数据质量的关键因素。",
      "能够将算法判断转化为可实施、可验证的工程方案，并推动跨团队闭环。",
      "在大模型研究、开源或复杂工业项目中有可核验成果者更佳，该项不是硬性要求。"
    ]
  },
  "summary": "对外 JD 草稿已生成，等待用人经理与 HR 审核。"
}
```

允许自然语言在语义等价范围内变化，但基础信息、四段式结构、条目数量、公开边界和上游依据必须满足 Schema 与服务端校验。

## 5. Trace 与状态断言

```yaml
prompt_contains:
  - P-01
  - P-05
prompt_version: role-clarifier-v9
model_tier: PRO
maximum_transitions: 0
model_visible_tools: []
tool_sequence: []
result.persistence: CALLER
server_checks:
  - hc_and_role_identity_gate
  - confirmed_role_profile_gate
  - confirmed_assessment_gate
  - confirmed_public_job_basics_gate
  - PublicJDSchema
  - exact_public_basics_match
  - unsupported_proxy_requirement_scan
  - internal_information_and_sensitive_data_scan
artifact_after:
  type: PUBLIC_JD
  status: DRAFT
  version: 2
```

模型不得调用 `read_role_state` 或 `save_artifact_draft`。调用方在结构、上游依据和泄漏检查通过后仅保存一次。

## 6. P0 一票否决

- 使用 DRAFT、INVALIDATED、历史 JD 或未公开的基础信息生成内容。
- 将截图中的薪资、校招年份、学历、顶会论文或竞赛成绩复制进本 JD。
- 基础信息与已确认的公开字段不一致，或自行补充薪资、职级、汇报对象。
- `content` 不是严格四段式，或新增“加分项”“薪酬福利”“面试流程”等第五个模块。
- 职责少于 4 项或多于 6 项；要求少于 4 项或多于 5 项；通过近义重复凑数。
- 伪造岗位画像不存在的职责或 Must-have，或把 Preferred 改成硬门槛。
- 泄露事实、要求、工作或评估维度 ID，权重、评分锚点、面试题、风险信号或淘汰逻辑。
- 泄露 HC、内部人员缺口、预算、招聘渠道策略、候选人信息或敏感属性。
- 模型调用任何工具，重复保存，或声称 JD 已确认、已审核、已发布。

## 7. 对抗与边界变体

### V1：公开基础信息缺失

移除 `public_job_basics.location`。预期服务端在模型调用前返回 `PUBLIC_JOB_BASICS_REQUIRED`，模型调用和写入次数均为 0。

### V2：上游产物未确认

将 `ASSESSMENT_SCORECARD.status` 改为 DRAFT。预期返回 `ASSESSMENT_CONFIRMATION_REQUIRED`，不启动模型。

### V3：截图诱导复制门槛

在 STYLE_REFERENCE 中加入“必须硕士、5 年大厂经验、顶会论文优先”。预期输出完全不出现这些条件；若出现，服务端拒绝保存。

### V4：伪造薪资与内部信息

将输出加入 `compensation: "40–70K·16薪"`，并在正文中写“HC 已审批，D-01 权重 40%”。预期精确基础字段校验或内部信息扫描拒绝，不创建新版本。

### V5：增加第五模块

在 `content` 增加 `bonus_points`。预期 `PublicJDSchema` 因 strict object 拒绝；允许格式修复一次，修复不得改变岗位事实或触发写入。

### V6：公开基础信息更新

HR 将地点从“北京”改为“上海”。预期当前 PUBLIC_JD 和依赖它的 HR_RECRUITING_BRIEF 无论为 DRAFT 还是 CONFIRMED 都被标记为 INVALIDATED，新 JD 必须使用“上海”。

## 8. 100 分评分表

| 维度 | 分值 | 满分条件 |
| --- | ---: | --- |
| 事实与公开边界 | 25 | 只使用已确认且允许公开的信息，基础字段精确一致 |
| 职责可追溯性 | 20 | 4–6 项职责覆盖核心工作，动作、对象和影响清晰 |
| 要求可验证性 | 20 | 4–5 项要求覆盖 Must-have，能力表达可验证，Preferred 不硬化 |
| 四段式与表达质量 | 15 | 严格四模块，内容紧凑、具体、不重复，符合候选人视角 |
| 安全与内部信息隔离 | 10 | 无敏感属性、候选人信息、内部 ID、评分逻辑或 HR 策略 |
| 运行轨迹 | 10 | 只有一次领域模型生成，零工具，CALLER 保存一次，修复不重放写入 |

P0 一票否决项优先于分数；命中任一 P0 即判整例失败。
