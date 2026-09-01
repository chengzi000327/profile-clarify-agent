-- Correct the demo HC fixture so approved requests represent multiple real
-- recruitment reasons. The backup tables make this data-only migration
-- reversible without touching conversations, artifacts, runs, traces or members.
BEGIN;

CREATE TABLE IF NOT EXISTS "migration_0012_hc_context_backup" (
  "tenant_id" text NOT NULL,
  "request_id" text NOT NULL,
  "context" jsonb NOT NULL,
  "backed_up_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("tenant_id", "request_id")
);

CREATE TABLE IF NOT EXISTS "migration_0012_role_state_backup" (
  "role_session_id" uuid PRIMARY KEY,
  "business_state" jsonb NOT NULL,
  "backed_up_at" timestamptz NOT NULL DEFAULT now()
);

INSERT INTO "migration_0012_hc_context_backup" ("tenant_id", "request_id", "context")
SELECT "tenant_id", "request_id", "context"
FROM "hc_approvals"
WHERE "tenant_id" = 'tenant-demo'
  AND "request_id" LIKE 'HC-2026-%'
ON CONFLICT ("tenant_id", "request_id") DO NOTHING;

INSERT INTO "migration_0012_role_state_backup" ("role_session_id", "business_state")
SELECT role."id", role."business_state"
FROM "role_sessions" AS role
JOIN "hc_approvals" AS hc ON hc."role_session_id" = role."id"
WHERE hc."tenant_id" = 'tenant-demo'
  AND hc."request_id" LIKE 'HC-2026-%'
ON CONFLICT ("role_session_id") DO NOTHING;

WITH hc_updates (request_id, recruitment_type, approved_reason, recruiting_budget) AS (
  VALUES
    ('HC-2026-EP-001', 'NEW_HEADCOUNT',
      '业务从单客户定制交付转向标准产品经营，审批新增一名企业产品经理，负责沉淀跨项目可复用的标准产品能力。',
      '年度新增编制预算内，薪酬上限 50K · 15薪'),
    ('HC-2026-RD-002', 'ATTRITION_REPLACEMENT',
      '原核心服务技术负责人离职，审批在原编制内补充一名高级后端工程师，承接架构演进、稳定性治理和关键系统交接。',
      '离职替补使用原研发编制预算，薪酬上限 55K · 15薪'),
    ('HC-2026-AI-003', 'ORGANIZATION_ADJUSTMENT',
      'AI 产品化职责由创新项目组调整至智能产品部，审批补充一名 AI 产品经理，统一负责场景定义、模型评测和商业化验证。',
      '组织调整专项编制预算，薪酬上限 52K · 15薪'),
    ('HC-2026-FE-004', 'PERFORMANCE_REPLACEMENT',
      '现有高级前端岗位连续两个评估周期未达到架构与性能治理要求，完成汰换审批后在原编制内补充一名高级前端工程师。',
      '汰换补充使用原研发编制预算，薪酬上限 50K · 15薪'),
    ('HC-2026-ALG-005', 'NEW_HEADCOUNT',
      '推荐业务从规则策略升级为模型驱动，审批新增一名推荐算法工程师，负责召回排序模型、在线实验和效果迭代。',
      '算法序列新增编制预算，薪酬上限 60K · 16薪'),
    ('HC-2026-DP-006', 'ATTRITION_REPLACEMENT',
      '原指标平台产品经理离职且交接期有限，审批在原编制内补充一名数据产品经理，持续推进统一指标和自助分析产品。',
      '离职替补使用原产品编制预算，薪酬上限 45K · 15薪'),
    ('HC-2026-MLP-007', 'NEW_HEADCOUNT',
      '模型训练与推理任务快速增长，审批新增一名机器学习平台工程师，建设统一训练、部署、评测与监控基础设施。',
      'AI 基础设施新增编制预算，薪酬上限 62K · 16薪'),
    ('HC-2026-QA-008', 'PERFORMANCE_REPLACEMENT',
      '现有质量工程岗位无法满足自动化平台和发布门禁建设要求，完成汰换审批后补充一名测试开发工程师。',
      '汰换补充使用原质量编制预算，薪酬上限 42K · 15薪'),
    ('HC-2026-DE-009', 'OTHER',
      '数据合规与湖仓成本治理进入集中改造期，审批专项补充一名数据工程师，负责实时链路、数据质量和成本优化。',
      '数据治理专项编制预算，薪酬上限 52K · 15薪'),
    ('HC-2026-CLIENT-010', 'ORGANIZATION_ADJUSTMENT',
      '移动端与桌面端基础能力合并至终端研发部，审批随组织调整补充一名客户端工程师，统一负责跨端架构、性能和质量门禁。',
      '组织调整编制预算，薪酬上限 50K · 15薪')
)
UPDATE "hc_approvals" AS hc
SET "context" = jsonb_set(
      jsonb_set(
        jsonb_set(hc."context", '{approved_reason}', to_jsonb(update_data.approved_reason)),
        '{recruiting_budget}', to_jsonb(update_data.recruiting_budget)
      ),
      '{job_basics,recruitment_type}', to_jsonb(update_data.recruitment_type)
    ),
    "updated_at" = now()
FROM hc_updates AS update_data
WHERE hc."tenant_id" = 'tenant-demo'
  AND hc."request_id" = update_data.request_id;

-- Keep the HC snapshot and its automatically-created hiring-reason fact aligned
-- for roles already opened before this migration. Manager-confirmed facts are not changed.
UPDATE "role_sessions" AS role
SET "business_state" = jsonb_set(
  jsonb_set(
    jsonb_set(
      role."business_state",
      '{hc_context,approved_reason}',
      hc."context"->'approved_reason'
    ),
    '{hc_context,recruiting_budget}',
    hc."context"->'recruiting_budget'
  ),
  '{hc_context,job_basics,recruitment_type}',
  hc."context"->'job_basics'->'recruitment_type'
)
FROM "hc_approvals" AS hc
WHERE hc."tenant_id" = 'tenant-demo'
  AND hc."role_session_id" = role."id"
  AND role."business_state"->'hc_context' IS NOT NULL;

UPDATE "role_sessions" AS role
SET "business_state" = jsonb_set(
  role."business_state",
  '{facts}',
  COALESCE((
    SELECT jsonb_agg(
      CASE
        WHEN fact->>'category' = 'HIRING_REASON'
          AND fact->>'source' = hc."request_id" || ' HC 审批'
        THEN jsonb_set(fact, '{statement}', hc."context"->'approved_reason')
        ELSE fact
      END
      ORDER BY ordinal
    )
    FROM jsonb_array_elements(COALESCE(role."business_state"->'facts', '[]'::jsonb))
      WITH ORDINALITY AS item(fact, ordinal)
  ), '[]'::jsonb)
)
FROM "hc_approvals" AS hc
WHERE hc."tenant_id" = 'tenant-demo'
  AND hc."role_session_id" = role."id";

COMMIT;
