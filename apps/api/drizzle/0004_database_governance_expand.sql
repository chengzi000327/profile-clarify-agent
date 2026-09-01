BEGIN;

-- role_sessions becomes the single source of truth for role metadata, business state,
-- and the one-to-one clarification policy.
ALTER TABLE "role_sessions" ADD COLUMN IF NOT EXISTS "business_state" jsonb;
ALTER TABLE "role_sessions" ADD COLUMN IF NOT EXISTS "clarification_initial_budget" integer DEFAULT 6;
ALTER TABLE "role_sessions" ADD COLUMN IF NOT EXISTS "clarification_granted_rounds" integer DEFAULT 0;
ALTER TABLE "role_sessions" ADD COLUMN IF NOT EXISTS "clarification_extension_size" integer DEFAULT 2;
ALTER TABLE "role_sessions" ADD COLUMN IF NOT EXISTS "clarification_completed_rounds" integer DEFAULT 0;
ALTER TABLE "role_sessions" ADD COLUMN IF NOT EXISTS "clarification_opened_rounds" integer DEFAULT 0;
ALTER TABLE "role_sessions" ADD COLUMN IF NOT EXISTS "clarification_open_round_id" uuid;
ALTER TABLE "role_sessions" ADD COLUMN IF NOT EXISTS "clarification_status" text DEFAULT 'ACTIVE';
ALTER TABLE "role_sessions" ADD COLUMN IF NOT EXISTS "clarification_updated_by" text;
ALTER TABLE "role_sessions" ADD COLUMN IF NOT EXISTS "clarification_updated_at" timestamptz DEFAULT now();

UPDATE "role_sessions"
SET "business_state" = "state"
  - 'id' - 'tenant_id' - 'title' - 'department' - 'stage' - 'revision'
  - 'created_at' - 'updated_at'
WHERE "business_state" IS NULL;

UPDATE "role_sessions" AS role
SET
  "clarification_initial_budget" = policy."initial_budget",
  "clarification_granted_rounds" = policy."granted_rounds",
  "clarification_extension_size" = policy."extension_size",
  "clarification_completed_rounds" = policy."completed_rounds",
  "clarification_opened_rounds" = policy."opened_rounds",
  "clarification_open_round_id" = policy."open_round_id",
  "clarification_status" = policy."status",
  "clarification_updated_by" = policy."updated_by",
  "clarification_updated_at" = policy."updated_at"
FROM "clarification_policies" AS policy
WHERE policy."role_session_id" = role."id";

ALTER TABLE "role_sessions" ALTER COLUMN "business_state" SET NOT NULL;
ALTER TABLE "role_sessions" ALTER COLUMN "clarification_initial_budget" SET NOT NULL;
ALTER TABLE "role_sessions" ALTER COLUMN "clarification_granted_rounds" SET NOT NULL;
ALTER TABLE "role_sessions" ALTER COLUMN "clarification_extension_size" SET NOT NULL;
ALTER TABLE "role_sessions" ALTER COLUMN "clarification_completed_rounds" SET NOT NULL;
ALTER TABLE "role_sessions" ALTER COLUMN "clarification_opened_rounds" SET NOT NULL;
ALTER TABLE "role_sessions" ALTER COLUMN "clarification_status" SET NOT NULL;
ALTER TABLE "role_sessions" ALTER COLUMN "clarification_updated_at" SET NOT NULL;
ALTER TABLE "role_sessions" ALTER COLUMN "state" DROP NOT NULL;

-- Artifact envelope metadata is normalized; only the actual artifact content remains JSONB.
ALTER TABLE "artifacts" ADD COLUMN IF NOT EXISTS "content" jsonb;
ALTER TABLE "artifacts" ADD COLUMN IF NOT EXISTS "based_on_hash" text;
ALTER TABLE "artifacts" ADD COLUMN IF NOT EXISTS "created_by" text;
ALTER TABLE "artifacts" ADD COLUMN IF NOT EXISTS "confirmed_by" text;
ALTER TABLE "artifacts" ADD COLUMN IF NOT EXISTS "confirmed_at" timestamptz;

UPDATE "artifacts"
SET
  "content" = "envelope" -> 'content',
  "based_on_hash" = "envelope" ->> 'based_on_hash',
  "created_by" = "envelope" ->> 'created_by',
  "confirmed_by" = "envelope" ->> 'confirmed_by',
  "confirmed_at" = NULLIF("envelope" ->> 'confirmed_at', '')::timestamptz
WHERE "content" IS NULL;

ALTER TABLE "artifacts" ALTER COLUMN "content" SET NOT NULL;
ALTER TABLE "artifacts" ALTER COLUMN "created_by" SET NOT NULL;
ALTER TABLE "artifacts" ALTER COLUMN "envelope" DROP NOT NULL;

-- Agent runs are queryable columns instead of a mirrored full-row JSON object.
ALTER TABLE "agent_runs" ADD COLUMN IF NOT EXISTS "model_tier" text;
ALTER TABLE "agent_runs" ADD COLUMN IF NOT EXISTS "task" text;
ALTER TABLE "agent_runs" ADD COLUMN IF NOT EXISTS "harness_session_id" text;
ALTER TABLE "agent_runs" ADD COLUMN IF NOT EXISTS "prompt_version" text;
ALTER TABLE "agent_runs" ADD COLUMN IF NOT EXISTS "model_name" text;
ALTER TABLE "agent_runs" ADD COLUMN IF NOT EXISTS "tool_count" integer DEFAULT 0;
ALTER TABLE "agent_runs" ADD COLUMN IF NOT EXISTS "input_tokens" integer DEFAULT 0;
ALTER TABLE "agent_runs" ADD COLUMN IF NOT EXISTS "output_tokens" integer DEFAULT 0;
ALTER TABLE "agent_runs" ADD COLUMN IF NOT EXISTS "started_at" timestamptz;
ALTER TABLE "agent_runs" ADD COLUMN IF NOT EXISTS "completed_at" timestamptz;
ALTER TABLE "agent_runs" ADD COLUMN IF NOT EXISTS "error_code" text;
ALTER TABLE "agent_runs" ADD COLUMN IF NOT EXISTS "input_message_id" uuid;
ALTER TABLE "agent_runs" ADD COLUMN IF NOT EXISTS "output_message_id" uuid;

UPDATE "agent_runs"
SET
  "model_tier" = "run" ->> 'model_tier',
  "task" = "run" ->> 'task',
  "harness_session_id" = "run" ->> 'harness_session_id',
  "prompt_version" = "run" ->> 'prompt_version',
  "model_name" = "run" ->> 'model_name',
  "tool_count" = COALESCE(("run" ->> 'tool_count')::integer, 0),
  "input_tokens" = COALESCE(("run" ->> 'input_tokens')::integer, 0),
  "output_tokens" = COALESCE(("run" ->> 'output_tokens')::integer, 0),
  "started_at" = NULLIF("run" ->> 'started_at', '')::timestamptz,
  "completed_at" = NULLIF("run" ->> 'completed_at', '')::timestamptz,
  "error_code" = "run" ->> 'error_code',
  "input_message_id" = NULLIF("run" ->> 'input_message_id', '')::uuid,
  "output_message_id" = NULLIF("run" ->> 'output_message_id', '')::uuid
WHERE "model_tier" IS NULL;

ALTER TABLE "agent_runs" ALTER COLUMN "model_tier" SET NOT NULL;
ALTER TABLE "agent_runs" ALTER COLUMN "task" SET NOT NULL;
ALTER TABLE "agent_runs" ALTER COLUMN "prompt_version" SET NOT NULL;
ALTER TABLE "agent_runs" ALTER COLUMN "model_name" SET NOT NULL;
ALTER TABLE "agent_runs" ALTER COLUMN "tool_count" SET NOT NULL;
ALTER TABLE "agent_runs" ALTER COLUMN "input_tokens" SET NOT NULL;
ALTER TABLE "agent_runs" ALTER COLUMN "output_tokens" SET NOT NULL;
ALTER TABLE "agent_runs" ALTER COLUMN "run" DROP NOT NULL;

-- Trace rows retain only the event-specific payload JSON.
ALTER TABLE "agent_run_events" ADD COLUMN IF NOT EXISTS "payload" jsonb;
UPDATE "agent_run_events" SET "payload" = "event" -> 'payload' WHERE "payload" IS NULL;
ALTER TABLE "agent_run_events" ALTER COLUMN "payload" SET NOT NULL;
ALTER TABLE "agent_run_events" ALTER COLUMN "event" DROP NOT NULL;

-- A single sender kind replaces sender_type + nullable sender_role.
ALTER TABLE "conversation_messages" ADD COLUMN IF NOT EXISTS "sender_kind" text;
UPDATE "conversation_messages"
SET "sender_kind" = CASE
  WHEN "sender_type" = 'HUMAN' THEN COALESCE("sender_role", 'HUMAN')
  ELSE "sender_type"
END
WHERE "sender_kind" IS NULL;
ALTER TABLE "conversation_messages" ALTER COLUMN "sender_kind" SET NOT NULL;
ALTER TABLE "conversation_messages" ALTER COLUMN "sender_type" DROP NOT NULL;
ALTER TABLE "conversation_messages" ALTER COLUMN "message" DROP NOT NULL;

-- Clarification round scalar columns are already complete; the mirrored JSON can become optional.
ALTER TABLE "clarification_rounds" ALTER COLUMN "round" DROP NOT NULL;
ALTER TABLE "clarification_policies" ALTER COLUMN "policy" DROP NOT NULL;

-- HR review and manager review are one calibration workflow.
CREATE TABLE IF NOT EXISTS "calibration_cases" (
  "id" uuid PRIMARY KEY,
  "role_session_id" uuid NOT NULL REFERENCES "role_sessions"("id") ON DELETE CASCADE,
  "signal_status" text NOT NULL,
  "proposed_change" jsonb NOT NULL,
  "evidence_summary" jsonb NOT NULL,
  "reviewed_by" text,
  "review_reason" text,
  "manager_task_id" uuid UNIQUE,
  "assignee_user_id" text,
  "manager_task_status" text,
  "decision_reason" text,
  "due_at" timestamptz,
  "signal_created_at" timestamptz NOT NULL DEFAULT now(),
  "signal_updated_at" timestamptz NOT NULL DEFAULT now(),
  "task_created_at" timestamptz,
  "completed_at" timestamptz
);
CREATE INDEX IF NOT EXISTS "calibration_cases_role_idx" ON "calibration_cases" ("role_session_id", "signal_created_at");
CREATE INDEX IF NOT EXISTS "calibration_cases_assignee_idx" ON "calibration_cases" ("assignee_user_id", "manager_task_status");

INSERT INTO "calibration_cases" (
  "id", "role_session_id", "signal_status", "proposed_change", "evidence_summary",
  "reviewed_by", "review_reason", "manager_task_id", "assignee_user_id",
  "manager_task_status", "decision_reason", "due_at", "signal_created_at",
  "signal_updated_at", "task_created_at", "completed_at"
)
SELECT
  signal."id", signal."role_session_id", signal."status", signal."proposed_change",
  signal."evidence_summary", signal."reviewed_by", signal."review_reason",
  task."id", task."assignee_user_id", task."status", task."decision_reason",
  task."due_at", signal."created_at", signal."updated_at", task."created_at",
  task."completed_at"
FROM "calibration_signals" AS signal
LEFT JOIN LATERAL (
  SELECT manager.*
  FROM "manager_tasks" AS manager
  WHERE manager."signal_id" = signal."id"
  ORDER BY manager."created_at" DESC
  LIMIT 1
) AS task ON true
ON CONFLICT ("id") DO NOTHING;

-- All human and trace access decisions share one audit stream.
CREATE TABLE IF NOT EXISTS "audit_logs" (
  "id" uuid PRIMARY KEY,
  "tenant_id" text NOT NULL,
  "role_session_id" uuid REFERENCES "role_sessions"("id") ON DELETE CASCADE,
  "actor_user_id" text NOT NULL,
  "action" text NOT NULL,
  "target_type" text NOT NULL,
  "target_id" text NOT NULL,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "audit_logs_tenant_idx" ON "audit_logs" ("tenant_id", "created_at");
CREATE INDEX IF NOT EXISTS "audit_logs_role_idx" ON "audit_logs" ("role_session_id", "created_at");
CREATE INDEX IF NOT EXISTS "audit_logs_target_idx" ON "audit_logs" ("target_type", "target_id");

INSERT INTO "audit_logs" (
  "id", "tenant_id", "role_session_id", "actor_user_id", "action",
  "target_type", "target_id", "metadata", "created_at"
)
SELECT
  decision."id", role."tenant_id", decision."role_session_id", decision."actor_user_id",
  decision."action", decision."target_type", decision."target_id", decision."metadata",
  decision."created_at"
FROM "decision_logs" AS decision
JOIN "role_sessions" AS role ON role."id" = decision."role_session_id"
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "audit_logs" (
  "id", "tenant_id", "role_session_id", "actor_user_id", "action",
  "target_type", "target_id", "metadata", "created_at"
)
SELECT
  trace."id", trace."tenant_id", run."role_session_id", trace."actor_user_id",
  trace."action", 'AGENT_RUN', trace."run_id"::text,
  jsonb_build_object('reason', trace."reason", 'audit_kind', 'TRACE_ACCESS'),
  trace."created_at"
FROM "trace_access_audits" AS trace
JOIN "agent_runs" AS run ON run."id" = trace."run_id"
ON CONFLICT ("id") DO NOTHING;

COMMIT;
