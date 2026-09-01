-- Separate approved headcount requests from role conversations. This migration is
-- additive: existing roles, messages, artifacts, runs, events and audits are not
-- rewritten or deleted. The one canonical production role is linked when found;
-- the remaining approved requests start without a workspace.
BEGIN;

CREATE TABLE IF NOT EXISTS "hc_approvals" (
  "request_id" text NOT NULL,
  "tenant_id" text NOT NULL,
  "title" text NOT NULL,
  "department" text NOT NULL,
  "status" text NOT NULL CHECK ("status" = 'APPROVED'),
  "context" jsonb NOT NULL,
  "hiring_manager_user_id" text NOT NULL,
  "assigned_hr_user_id" text,
  "role_session_id" uuid REFERENCES "role_sessions"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("tenant_id", "request_id")
);

CREATE INDEX IF NOT EXISTS "hc_approvals_tenant_status_idx"
  ON "hc_approvals" ("tenant_id", "status");
CREATE INDEX IF NOT EXISTS "hc_approvals_manager_idx"
  ON "hc_approvals" ("tenant_id", "hiring_manager_user_id");
CREATE INDEX IF NOT EXISTS "hc_approvals_hr_idx"
  ON "hc_approvals" ("tenant_id", "assigned_hr_user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "hc_approvals_role_session_uidx"
  ON "hc_approvals" ("role_session_id") WHERE "role_session_id" IS NOT NULL;

INSERT INTO "users" ("id", "tenant_id", "display_name", "role", "active") VALUES
  ('manager-demo', 'tenant-demo', '用人经理 · 陈曦', 'MANAGER', true),
  ('hr-demo', 'tenant-demo', 'HR · 林夏', 'HR', true),
  ('admin-demo', 'tenant-demo', '企业管理员 · 周宁', 'ADMIN', true)
ON CONFLICT ("id") DO NOTHING;

WITH approved_hc (
  request_id, approved_at, title, department, business_change,
  organization_gap, approved_reason, responsibilities, recruiting_budget,
  recruitment_type, headcount, level, reporting_line, locations,
  salary_range, target_onboard
) AS (
  VALUES
    (
      'HC-2026-EP-001', '2026-08-01T01:00:00.000Z'::timestamptz,
      '企业产品经理', '企业服务产品部',
      '企业服务业务正从单客户定制交付转向标准产品经营，需要建立跨项目的产品化责任主体。',
      '现有团队缺少持续负责产品边界、共性能力沉淀和多客户验证的岗位负责人。',
      '新增一名企业产品经理，负责把重复建设的客户需求转化为可规模复用的标准产品能力。',
      ARRAY['识别多个客户项目中的共性需求并定义产品边界','规划标准产品路线图并推动研发交付形成复用能力','组织核心客户验证并根据结果迭代方案'],
      '年度新增编制预算内，薪酬上限 50K · 15薪', 'NEW_HEADCOUNT', 1,
      '3-2 至 4-1', '产品负责人', ARRAY['北京','上海'], '35K-50K·15薪', '8 周内'
    ),
    (
      'HC-2026-RD-002', '2026-08-02T01:00:00.000Z'::timestamptz,
      '高级后端工程师', '平台研发部',
      '核心交易链路进入规模化阶段，现有服务需要完成稳定性和可扩展性升级。',
      '团队缺少能够主导高并发架构演进并建立工程治理标准的高级工程师。',
      '新增一名高级后端工程师，负责核心服务架构、稳定性治理和工程效率提升。',
      ARRAY['负责核心服务架构设计与关键模块交付','建立可观测性、容量和故障演练机制','推动代码质量与研发效能标准落地'],
      '研发序列新增编制预算，薪酬上限 55K · 15薪', 'NEW_HEADCOUNT', 1,
      'P7-P8', '研发总监', ARRAY['北京'], '40K-55K·15薪', '10 周内'
    ),
    (
      'HC-2026-AI-003', '2026-08-03T01:00:00.000Z'::timestamptz,
      'AI 产品经理', '智能产品部',
      '公司计划把大模型能力从内部试验转为可销售的标准产品功能。',
      '团队缺少同时理解模型能力、业务场景和产品商业化的负责人。',
      '新增一名 AI 产品经理，负责场景定义、模型评测和产品商业化闭环。',
      ARRAY['识别高价值 AI 场景并定义产品方案','建立模型效果与用户价值评测体系','协调算法研发完成产品化和客户验证'],
      '创新产品专项预算，薪酬上限 52K · 15薪', 'NEW_HEADCOUNT', 1,
      '3-2 至 4-1', '智能产品负责人', ARRAY['北京','深圳'], '38K-52K·15薪', '8 周内'
    ),
    (
      'HC-2026-FE-004', '2026-08-04T01:00:00.000Z'::timestamptz,
      '高级前端工程师', '平台研发部',
      '产品工作台进入复杂交互和多端协同阶段，需要系统提升前端架构与体验质量。',
      '团队缺少能够主导大型前端工程、性能治理和组件平台建设的高级工程师。',
      '新增一名高级前端工程师，负责工作台架构、性能和工程体系建设。',
      ARRAY['主导核心工作台前端架构与关键模块交付','建设组件库、监控和性能治理体系','推动前端工程规范和研发效率提升'],
      '研发序列新增编制预算，薪酬上限 50K · 15薪', 'NEW_HEADCOUNT', 1,
      'P7-P8', '前端负责人', ARRAY['北京','上海'], '35K-50K·15薪', '8 周内'
    ),
    (
      'HC-2026-ALG-005', '2026-08-05T01:00:00.000Z'::timestamptz,
      '推荐算法工程师', '算法工程部',
      '内容和商品规模快速增长，现有规则策略难以支撑个性化分发和持续优化。',
      '算法团队缺少负责推荐建模、在线实验和效果迭代的核心工程师。',
      '新增一名推荐算法工程师，负责召回排序模型和在线实验体系。',
      ARRAY['研发推荐召回与排序模型','建设特征、样本和离线评测流程','推动在线实验并对核心业务指标负责'],
      '算法序列新增编制预算，薪酬上限 60K · 16薪', 'NEW_HEADCOUNT', 1,
      'P7-P8', '算法负责人', ARRAY['北京','深圳'], '42K-60K·16薪', '10 周内'
    ),
    (
      'HC-2026-DP-006', '2026-08-06T01:00:00.000Z'::timestamptz,
      '数据产品经理', '数据产品部',
      '企业数据资产持续增长，需要把分散的数据能力沉淀为统一产品。',
      '团队缺少同时负责指标口径、数据产品体验和业务落地的产品负责人。',
      '新增一名数据产品经理，负责指标平台和自助分析产品建设。',
      ARRAY['规划指标与自助分析产品路线图','协调数据研发建立统一数据口径','推动业务团队使用并持续评估产品价值'],
      '产品序列新增编制预算，薪酬上限 45K · 15薪', 'NEW_HEADCOUNT', 1,
      'P7', '数据产品负责人', ARRAY['北京','上海'], '32K-45K·15薪', '8 周内'
    ),
    (
      'HC-2026-MLP-007', '2026-08-07T01:00:00.000Z'::timestamptz,
      '机器学习平台工程师', 'AI 基础设施部',
      '模型数量和训练任务增长，需要统一训练、评测、部署与监控基础设施。',
      '算法团队缺少能够建设稳定机器学习平台并提升模型迭代效率的工程角色。',
      '新增一名机器学习平台工程师，负责训练推理平台和 MLOps 工程体系。',
      ARRAY['建设训练调度、模型管理和部署平台','优化 GPU 资源利用与推理稳定性','建立模型版本、评测和监控工程规范'],
      'AI 基础设施新增编制预算，薪酬上限 62K · 16薪', 'NEW_HEADCOUNT', 1,
      'P7-P8', 'AI 基础设施负责人', ARRAY['北京','深圳'], '45K-62K·16薪', '12 周内'
    ),
    (
      'HC-2026-QA-008', '2026-08-08T01:00:00.000Z'::timestamptz,
      '测试开发工程师', '质量工程部',
      '产品发布频率提升，现有人工回归无法覆盖复杂链路和多环境发布。',
      '团队缺少能够建设自动化测试平台并推动质量左移的测试开发岗位。',
      '新增一名测试开发工程师，负责自动化测试、质量平台和发布门禁。',
      ARRAY['建设接口、端到端和性能自动化测试','开发质量数据平台与发布门禁','推动研发过程质量改进和缺陷复盘'],
      '研发序列新增编制预算，薪酬上限 42K · 15薪', 'NEW_HEADCOUNT', 1,
      'P6-P7', '质量工程负责人', ARRAY['北京','上海'], '30K-42K·15薪', '8 周内'
    ),
    (
      'HC-2026-DE-009', '2026-08-09T01:00:00.000Z'::timestamptz,
      '数据工程师', '数据平台部',
      '实时和离线数据规模扩大，需要提升数据链路稳定性、时效和成本效率。',
      '团队缺少能够主导湖仓架构和数据工程治理的高级工程师。',
      '新增一名数据工程师，负责湖仓平台、实时链路和数据质量建设。',
      ARRAY['建设批流一体的数据处理链路','推进湖仓架构和计算存储优化','建立数据质量、血缘和任务稳定性治理'],
      '研发序列新增编制预算，薪酬上限 52K · 15薪', 'NEW_HEADCOUNT', 1,
      'P7-P8', '数据平台负责人', ARRAY['北京','上海'], '38K-52K·15薪', '10 周内'
    ),
    (
      'HC-2026-CLIENT-010', '2026-08-10T01:00:00.000Z'::timestamptz,
      '客户端工程师', '终端研发部',
      '移动端和桌面端业务快速增长，需要统一客户端架构和跨端体验标准。',
      '团队缺少能够负责客户端基础架构、性能和稳定性的高级工程师。',
      '新增一名客户端工程师，负责移动端架构、性能优化和工程质量。',
      ARRAY['负责客户端核心架构和关键模块交付','建设崩溃、性能和发布监控体系','推动跨端组件复用与工程效率提升'],
      '研发序列新增编制预算，薪酬上限 50K · 15薪', 'NEW_HEADCOUNT', 1,
      'P7-P8', '终端研发负责人', ARRAY['北京','上海'], '35K-50K·15薪', '10 周内'
    )
)
INSERT INTO "hc_approvals" (
  "request_id", "tenant_id", "title", "department", "status", "context",
  "hiring_manager_user_id", "assigned_hr_user_id", "role_session_id",
  "created_at", "updated_at"
)
SELECT
  hc.request_id,
  'tenant-demo',
  hc.title,
  hc.department,
  'APPROVED',
  jsonb_build_object(
    'request_id', hc.request_id,
    'status', 'APPROVED',
    'approved_at', to_char(hc.approved_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'business_change', hc.business_change,
    'organization_gap', hc.organization_gap,
    'approved_reason', hc.approved_reason,
    'initial_responsibilities', to_jsonb(hc.responsibilities),
    'recruiting_budget', hc.recruiting_budget,
    'recruiting_constraints', jsonb_build_array('须通过岗位画像与评估方案确认后启动招聘','候选人资料必须脱敏后进入系统'),
    'hiring_manager_user_id', 'manager-demo',
    'assigned_hr_user_id', 'hr-demo',
    'job_basics', jsonb_build_object(
      'recruitment_type', hc.recruitment_type,
      'headcount', hc.headcount,
      'level', hc.level,
      'reporting_line', hc.reporting_line,
      'locations', to_jsonb(hc.locations),
      'employment_type', '全职',
      'salary_range', hc.salary_range,
      'target_onboard', hc.target_onboard
    )
  ),
  'manager-demo',
  'hr-demo',
  CASE WHEN hc.request_id = 'HC-2026-EP-001' THEN (
    SELECT role."id"
    FROM "role_sessions" AS role
    WHERE role."tenant_id" = 'tenant-demo'
      AND role."business_state"->'hc_context'->>'request_id' = 'HC-2026-EP-001'
    ORDER BY role."updated_at" DESC
    LIMIT 1
  ) ELSE NULL END,
  hc.approved_at,
  hc.approved_at
FROM approved_hc AS hc
ON CONFLICT ("tenant_id", "request_id") DO NOTHING;

INSERT INTO "role_members" ("role_session_id", "user_id")
SELECT hc."role_session_id", member."user_id"
FROM "hc_approvals" AS hc
CROSS JOIN (VALUES ('manager-demo'), ('hr-demo')) AS member("user_id")
WHERE hc."tenant_id" = 'tenant-demo'
  AND hc."role_session_id" IS NOT NULL
  AND EXISTS (SELECT 1 FROM "users" WHERE "id" = member."user_id")
ON CONFLICT ("role_session_id", "user_id") DO NOTHING;

COMMIT;
