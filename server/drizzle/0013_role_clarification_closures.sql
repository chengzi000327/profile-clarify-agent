-- Add the persistence needed for enterprise-context retrieval, role clarification
-- tasks and Feishu notification delivery. This migration is additive and does
-- not rewrite existing roles, HC approvals, conversations, artifacts or traces.
BEGIN;

CREATE TABLE IF NOT EXISTS "enterprise_knowledge_items" (
  "id" text PRIMARY KEY,
  "tenant_id" text NOT NULL,
  "category" text NOT NULL,
  "title" text NOT NULL,
  "content" text NOT NULL,
  "summary" text NOT NULL,
  "department" text,
  "job_family" text,
  "tags" text[] NOT NULL DEFAULT '{}',
  "visible_to" text NOT NULL,
  "source_ref" text NOT NULL,
  "source_version" text NOT NULL,
  "status" text NOT NULL,
  "valid_from" timestamptz NOT NULL,
  "valid_to" timestamptz,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "enterprise_knowledge_items_source_uidx"
    UNIQUE ("tenant_id", "source_ref", "source_version"),
  CONSTRAINT "enterprise_knowledge_items_category_check"
    CHECK ("category" IN (
      'ORGANIZATION', 'JOB_FAMILY', 'LEVEL_FRAMEWORK', 'HISTORICAL_JD',
      'ROLE_PROFILE_CASE', 'RECRUITING_POLICY', 'INTERVIEW_STANDARD'
    )),
  CONSTRAINT "enterprise_knowledge_items_visibility_check"
    CHECK ("visible_to" IN ('ALL_ROLE_MEMBERS', 'HR_ONLY', 'ADMIN_ONLY')),
  CONSTRAINT "enterprise_knowledge_items_status_check"
    CHECK ("status" IN ('ACTIVE', 'ARCHIVED'))
);

CREATE INDEX IF NOT EXISTS "enterprise_knowledge_items_tenant_status_category_idx"
  ON "enterprise_knowledge_items" ("tenant_id", "status", "category");
CREATE INDEX IF NOT EXISTS "enterprise_knowledge_items_department_idx"
  ON "enterprise_knowledge_items" ("tenant_id", "department");
CREATE INDEX IF NOT EXISTS "enterprise_knowledge_items_job_family_idx"
  ON "enterprise_knowledge_items" ("tenant_id", "job_family");
CREATE INDEX IF NOT EXISTS "enterprise_knowledge_items_tags_gin_idx"
  ON "enterprise_knowledge_items" USING GIN ("tags");

CREATE TABLE IF NOT EXISTS "role_clarification_tasks" (
  "id" uuid PRIMARY KEY,
  "tenant_id" text NOT NULL,
  "hc_request_id" text NOT NULL,
  "role_session_id" uuid REFERENCES "role_sessions"("id") ON DELETE SET NULL,
  "assignee_user_id" text NOT NULL REFERENCES "users"("id"),
  "status" text NOT NULL,
  "due_at" timestamptz,
  "started_at" timestamptz,
  "completed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "role_clarification_tasks_hc_uidx" UNIQUE ("tenant_id", "hc_request_id"),
  CONSTRAINT "role_clarification_tasks_status_check"
    CHECK ("status" IN ('OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'))
);

CREATE INDEX IF NOT EXISTS "role_clarification_tasks_assignee_status_idx"
  ON "role_clarification_tasks" ("assignee_user_id", "status");

CREATE TABLE IF NOT EXISTS "user_channel_bindings" (
  "tenant_id" text NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id"),
  "channel" text NOT NULL,
  "recipient_type" text NOT NULL,
  "recipient_id" text NOT NULL,
  "status" text NOT NULL,
  "verified_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("tenant_id", "user_id", "channel"),
  CONSTRAINT "user_channel_bindings_channel_check" CHECK ("channel" IN ('FEISHU')),
  CONSTRAINT "user_channel_bindings_recipient_type_check" CHECK ("recipient_type" IN ('OPEN_ID')),
  CONSTRAINT "user_channel_bindings_status_check" CHECK ("status" IN ('ACTIVE', 'REVOKED'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "user_channel_bindings_active_recipient_idx"
  ON "user_channel_bindings" ("tenant_id", "channel", "recipient_id")
  WHERE "status" = 'ACTIVE';

CREATE TABLE IF NOT EXISTS "notification_outbox" (
  "id" uuid PRIMARY KEY,
  "tenant_id" text NOT NULL,
  "task_id" uuid NOT NULL REFERENCES "role_clarification_tasks"("id") ON DELETE CASCADE,
  "dedupe_key" text NOT NULL,
  "channel" text NOT NULL,
  "recipient_user_id" text NOT NULL REFERENCES "users"("id"),
  "template" text NOT NULL,
  "payload" jsonb NOT NULL,
  "status" text NOT NULL,
  "attempt_count" integer NOT NULL DEFAULT 0,
  "next_attempt_at" timestamptz NOT NULL,
  "locked_by" text,
  "locked_until" timestamptz,
  "last_error_code" text,
  "sent_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "notification_outbox_dedupe_uidx" UNIQUE ("dedupe_key"),
  CONSTRAINT "notification_outbox_channel_check" CHECK ("channel" IN ('FEISHU')),
  CONSTRAINT "notification_outbox_template_check"
    CHECK ("template" IN ('HC_CLARIFICATION_ASSIGNED')),
  CONSTRAINT "notification_outbox_status_check"
    CHECK ("status" IN ('PENDING', 'PROCESSING', 'SENT', 'RETRY', 'UNBOUND', 'DEAD')),
  CONSTRAINT "notification_outbox_attempt_count_check" CHECK ("attempt_count" >= 0)
);

CREATE INDEX IF NOT EXISTS "notification_outbox_due_idx"
  ON "notification_outbox" ("status", "next_attempt_at");
CREATE INDEX IF NOT EXISTS "notification_outbox_recipient_idx"
  ON "notification_outbox" ("recipient_user_id", "status");

INSERT INTO "enterprise_knowledge_items" (
  "id", "tenant_id", "category", "title", "content", "summary",
  "department", "job_family", "tags", "visible_to", "source_ref",
  "source_version", "status", "valid_from", "valid_to", "updated_at"
) VALUES
  (
    'EK-ORG-PRODUCT-001', 'tenant-demo', 'ORGANIZATION', '企业服务产品部职责',
    '来源：模拟公司组织职责说明。企业服务产品部负责把客户项目中反复出现的需求沉淀为标准产品能力，建立产品边界、路线图和跨客户验证机制；与销售、交付、研发共同判断需求优先级，但不承担单一客户项目的定制交付管理。',
    '企业服务产品部面向标准产品经营，负责共性需求识别、产品边界、路线图和跨客户验证。',
    '企业服务产品部', '产品',
    ARRAY['企业服务产品部','组织职责','产品边界','跨客户验证','岗位使命'],
    'ALL_ROLE_MEMBERS', 'mock://organization/product-division', '2026.08',
    'ACTIVE', '2026-08-01T00:00:00.000Z'::timestamptz, NULL, '2026-08-18T00:00:00.000Z'::timestamptz
  ),
  (
    'EK-JOB-PRODUCT-001', 'tenant-demo', 'JOB_FAMILY', '产品岗位族能力框架',
    '来源：模拟公司产品岗位族能力框架。产品岗位从业务洞察、问题定义、方案判断、数据验证和跨团队推动五个维度建立能力要求。岗位画像应把能力落到真实工作场景、可观察行为和结果证据，避免只写抽象素质词。',
    '产品岗位族以业务洞察、问题定义、方案判断、数据验证和跨团队推动为核心能力维度。',
    '企业服务产品部', '产品',
    ARRAY['产品','岗位族','能力框架','业务洞察','跨团队推动','评估维度'],
    'ALL_ROLE_MEMBERS', 'mock://job-family/product', '2026.08',
    'ACTIVE', '2026-08-01T00:00:00.000Z'::timestamptz, NULL, '2026-08-18T00:00:00.000Z'::timestamptz
  ),
  (
    'EK-LEVEL-34-001', 'tenant-demo', 'LEVEL_FRAMEWORK', '3-2 至 4-1 职级要求',
    '来源：模拟公司产品序列职级标准。3-2 需要独立负责一个复杂产品方向，能够定义目标、协调多角色并用数据复盘；4-1 还需要处理跨部门取舍、沉淀可复用机制并对中长期业务结果负责。澄清时应结合岗位授权范围确定实际职级，不以工作年限直接替代能力证据。',
    '3-2 强调独立负责复杂方向，4-1 增加跨部门取舍、机制沉淀和中长期结果责任。',
    '企业服务产品部', '产品',
    ARRAY['职级','3-2','4-1','授权范围','结果责任','能力证据'],
    'ALL_ROLE_MEMBERS', 'mock://level/product-3-2-4-1', '2026.08',
    'ACTIVE', '2026-08-01T00:00:00.000Z'::timestamptz, NULL, '2026-08-18T00:00:00.000Z'::timestamptz
  ),
  (
    'EK-JD-PM-001', 'tenant-demo', 'HISTORICAL_JD', '企业产品经理历史岗位说明',
    '来源：模拟公司已归档岗位说明。该岗位面向企业客户的共性场景，负责识别可规模化的问题、规划标准产品路线、协调研发与交付，并通过多客户验证衡量产品价值。对外岗位说明应突出真实使命、关键工作和可验证要求，不披露内部预算与审批信息。',
    '历史岗位说明强调共性场景识别、标准产品路线、跨团队交付和多客户价值验证。',
    '企业服务产品部', '产品',
    ARRAY['历史JD','企业产品经理','岗位职责','标准产品','公开JD'],
    'ALL_ROLE_MEMBERS', 'mock://historical-jd/enterprise-pm', '2026.08',
    'ACTIVE', '2026-08-01T00:00:00.000Z'::timestamptz, NULL, '2026-08-18T00:00:00.000Z'::timestamptz
  ),
  (
    'EK-ROLE-PM-001', 'tenant-demo', 'ROLE_PROFILE_CASE', '企业产品经理成功画像案例',
    '来源：模拟公司岗位画像案例库。成功案例把招聘原因写成业务变化与组织缺口，把岗位使命写成需要承担的结果，并用九十天路线图、跨客户验证和复用率等结果描述成功标准；能力要求逐项映射工作场景、强证据和面试方法。',
    '成功画像案例用业务变化、组织缺口、岗位使命、阶段结果和证据化能力要求形成完整判断链。',
    '企业服务产品部', '产品',
    ARRAY['岗位画像','成功标准','招聘原因','工作场景','证据链','企业产品经理'],
    'ALL_ROLE_MEMBERS', 'mock://role-profile/enterprise-pm', '2026.08',
    'ACTIVE', '2026-08-01T00:00:00.000Z'::timestamptz, NULL, '2026-08-18T00:00:00.000Z'::timestamptz
  ),
  (
    'EK-RECRUIT-POLICY-001', 'tenant-demo', 'RECRUITING_POLICY', '招聘审批与筛选协作规范',
    '来源：模拟公司招聘管理规范。编制审批完成后由系统向用人经理创建岗位澄清任务；用人经理确认岗位事实和画像，招聘伙伴在站内查看进度，并依据已确认画像筛选简历。岗位画像、评估方案和公开岗位说明完成确认后才进入正式招聘执行。',
    '审批后由用人经理完成画像澄清，招聘伙伴跟踪进度并依据确认结果筛选，正式产物确认后启动招聘。',
    NULL, NULL,
    ARRAY['HC审批','招聘协作','用人经理','HR','筛选标准','任务进度'],
    'HR_ONLY', 'mock://recruiting-policy/approved-role', '2026.08',
    'ACTIVE', '2026-08-01T00:00:00.000Z'::timestamptz, NULL, '2026-08-18T00:00:00.000Z'::timestamptz
  ),
  (
    'EK-INTERVIEW-PM-001', 'tenant-demo', 'INTERVIEW_STANDARD', '产品岗位结构化面试标准',
    '来源：模拟公司产品岗位面试规范。面试维度必须来自已确认岗位画像，围绕业务判断、问题拆解、方案取舍、数据验证和协作推动设置问题；每个维度要写明可观察证据、评分锚点和责任面试官，并在面试后按同一标准校准。',
    '结构化面试从岗位画像生成维度，为每项能力定义问题、证据、评分锚点和面试责任人。',
    '企业服务产品部', '产品',
    ARRAY['结构化面试','面试标准','评分锚点','能力证据','岗位画像','校准'],
    'ALL_ROLE_MEMBERS', 'mock://interview-standard/product', '2026.08',
    'ACTIVE', '2026-08-01T00:00:00.000Z'::timestamptz, NULL, '2026-08-18T00:00:00.000Z'::timestamptz
  )
ON CONFLICT ("tenant_id", "source_ref", "source_version") DO NOTHING;

COMMIT;
