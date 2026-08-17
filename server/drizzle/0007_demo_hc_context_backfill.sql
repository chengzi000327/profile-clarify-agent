-- Backfill the persisted production demo role created before HC context became
-- part of RoleState. New role sessions receive these values from seed.ts; this
-- migration keeps the long-lived Railway demo database on the same contract.
UPDATE "role_sessions"
SET
  "department" = '企业服务产品部',
  "business_state" = jsonb_set(
    jsonb_set(
      COALESCE("business_state", '{}'::jsonb),
      '{hc_status}',
      '"APPROVED"'::jsonb,
      true
    ),
    '{hc_context}',
    jsonb_build_object(
      'request_id', 'HC-2026-001',
      'status', 'APPROVED',
      'approved_at', to_jsonb('2026-08-17T00:00:00.000Z'::text),
      'business_change', '企业服务业务正从单客户定制交付转向标准产品经营，需要建立跨项目的产品化责任主体。',
      'organization_gap', '现有团队缺少持续负责产品边界、共性能力沉淀和多客户验证的岗位负责人。',
      'approved_reason', '新增一名企业产品经理，负责把重复建设的客户需求转化为可规模复用的标准产品能力。',
      'initial_responsibilities', jsonb_build_array(
        '识别多个客户项目中的共性需求并定义产品边界',
        '规划标准产品路线图，推动研发和交付团队形成复用能力',
        '组织核心客户验证并用结果迭代产品方案'
      ),
      'recruiting_budget', '年度新增编制预算内，薪酬上限 50K · 15薪',
      'recruiting_constraints', jsonb_build_array(
        '8 周内到岗',
        '北京或上海办公',
        '优先具备企业 SaaS 或平台产品经验'
      ),
      'hiring_manager_user_id', 'manager-demo',
      'assigned_hr_user_id', 'hr-demo',
      'job_basics', jsonb_build_object(
        'recruitment_type', 'NEW_HEADCOUNT',
        'headcount', 1,
        'level', '3-2 至 4-1',
        'reporting_line', '产品负责人',
        'locations', jsonb_build_array('北京', '上海'),
        'employment_type', '全职',
        'salary_range', '35K-50K·15薪',
        'target_onboard', '8 周内'
      )
    ),
    true
  ),
  "updated_at" = now()
WHERE "id" = '11111111-1111-4111-8111-111111111111'
  AND "tenant_id" = 'tenant-demo';

INSERT INTO "role_members" ("role_session_id", "user_id")
SELECT
  '11111111-1111-4111-8111-111111111111'::uuid,
  member."user_id"
FROM (VALUES ('manager-demo'), ('hr-demo')) AS member("user_id")
WHERE EXISTS (
  SELECT 1
  FROM "role_sessions"
  WHERE "id" = '11111111-1111-4111-8111-111111111111'
    AND "tenant_id" = 'tenant-demo'
)
AND EXISTS (
  SELECT 1
  FROM "users"
  WHERE "id" = member."user_id"
)
ON CONFLICT ("role_session_id", "user_id") DO NOTHING;
