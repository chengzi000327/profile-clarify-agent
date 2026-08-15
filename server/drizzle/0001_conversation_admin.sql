CREATE TABLE IF NOT EXISTS "conversation_messages" (
  "id" uuid PRIMARY KEY,
  "tenant_id" text NOT NULL,
  "role_session_id" uuid NOT NULL REFERENCES "role_sessions"("id") ON DELETE CASCADE,
  "run_id" uuid REFERENCES "agent_runs"("id") ON DELETE SET NULL,
  "clarification_round_id" uuid,
  "sender_type" text NOT NULL,
  "sender_user_id" text,
  "sender_role" text,
  "sender_name" text NOT NULL,
  "content" text NOT NULL,
  "structured_content" jsonb,
  "status" text NOT NULL,
  "sequence" bigint NOT NULL,
  "message" jsonb NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "completed_at" timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "conversation_messages_sequence_uidx" ON "conversation_messages" ("role_session_id", "sequence");
CREATE INDEX IF NOT EXISTS "conversation_messages_role_idx" ON "conversation_messages" ("role_session_id", "sequence");
CREATE INDEX IF NOT EXISTS "conversation_messages_run_idx" ON "conversation_messages" ("run_id");

CREATE TABLE IF NOT EXISTS "clarification_policies" (
  "role_session_id" uuid PRIMARY KEY REFERENCES "role_sessions"("id") ON DELETE CASCADE,
  "initial_budget" integer DEFAULT 6 NOT NULL,
  "granted_rounds" integer DEFAULT 0 NOT NULL,
  "extension_size" integer DEFAULT 2 NOT NULL,
  "completed_rounds" integer DEFAULT 0 NOT NULL,
  "opened_rounds" integer DEFAULT 0 NOT NULL,
  "open_round_id" uuid,
  "status" text DEFAULT 'ACTIVE' NOT NULL,
  "updated_by" text,
  "policy" jsonb NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "clarification_rounds" (
  "id" uuid PRIMARY KEY,
  "role_session_id" uuid NOT NULL REFERENCES "role_sessions"("id") ON DELETE CASCADE,
  "ordinal" integer NOT NULL,
  "status" text NOT NULL,
  "question" text NOT NULL,
  "opened_by_run_id" uuid NOT NULL REFERENCES "agent_runs"("id") ON DELETE CASCADE,
  "resolved_by_message_id" uuid,
  "round" jsonb NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "completed_at" timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "clarification_rounds_ordinal_uidx" ON "clarification_rounds" ("role_session_id", "ordinal");
CREATE INDEX IF NOT EXISTS "clarification_rounds_role_idx" ON "clarification_rounds" ("role_session_id", "ordinal");

CREATE TABLE IF NOT EXISTS "trace_access_audits" (
  "id" uuid PRIMARY KEY,
  "tenant_id" text NOT NULL,
  "actor_user_id" text NOT NULL,
  "run_id" uuid NOT NULL REFERENCES "agent_runs"("id") ON DELETE CASCADE,
  "action" text NOT NULL,
  "reason" text,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "trace_access_audits_tenant_idx" ON "trace_access_audits" ("tenant_id", "created_at");
