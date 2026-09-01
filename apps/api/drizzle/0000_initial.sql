CREATE TABLE IF NOT EXISTS "users" (
  "id" text PRIMARY KEY,
  "tenant_id" text NOT NULL,
  "display_name" text NOT NULL,
  "role" text NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "role_sessions" (
  "id" uuid PRIMARY KEY,
  "tenant_id" text NOT NULL,
  "title" text NOT NULL,
  "department" text NOT NULL,
  "stage" text NOT NULL,
  "revision" integer DEFAULT 0 NOT NULL,
  "state" jsonb NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "role_sessions_tenant_idx" ON "role_sessions" ("tenant_id");
CREATE INDEX IF NOT EXISTS "role_sessions_updated_idx" ON "role_sessions" ("updated_at");

CREATE TABLE IF NOT EXISTS "role_members" (
  "role_session_id" uuid NOT NULL REFERENCES "role_sessions"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  PRIMARY KEY ("role_session_id", "user_id")
);

CREATE TABLE IF NOT EXISTS "artifacts" (
  "id" uuid PRIMARY KEY,
  "role_session_id" uuid NOT NULL REFERENCES "role_sessions"("id") ON DELETE CASCADE,
  "type" text NOT NULL,
  "version" integer NOT NULL,
  "status" text NOT NULL,
  "content_hash" text NOT NULL,
  "envelope" jsonb NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "artifacts_role_type_version_uidx" ON "artifacts" ("role_session_id", "type", "version");
CREATE INDEX IF NOT EXISTS "artifacts_latest_idx" ON "artifacts" ("role_session_id", "type", "version");

CREATE TABLE IF NOT EXISTS "candidates" (
  "id" uuid PRIMARY KEY,
  "role_session_id" uuid NOT NULL REFERENCES "role_sessions"("id") ON DELETE CASCADE,
  "candidate_ref" text NOT NULL,
  "channel" text NOT NULL,
  "evidence" jsonb NOT NULL,
  "imported_by" text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "candidates_role_ref_uidx" ON "candidates" ("role_session_id", "candidate_ref");
CREATE INDEX IF NOT EXISTS "candidates_role_channel_idx" ON "candidates" ("role_session_id", "channel");

CREATE TABLE IF NOT EXISTS "calibration_signals" (
  "id" uuid PRIMARY KEY,
  "role_session_id" uuid NOT NULL REFERENCES "role_sessions"("id") ON DELETE CASCADE,
  "status" text NOT NULL,
  "proposed_change" jsonb NOT NULL,
  "evidence_summary" jsonb NOT NULL,
  "reviewed_by" text,
  "review_reason" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "calibration_signals_role_idx" ON "calibration_signals" ("role_session_id", "created_at");

CREATE TABLE IF NOT EXISTS "manager_tasks" (
  "id" uuid PRIMARY KEY,
  "role_session_id" uuid NOT NULL REFERENCES "role_sessions"("id") ON DELETE CASCADE,
  "signal_id" uuid NOT NULL REFERENCES "calibration_signals"("id") ON DELETE CASCADE,
  "assignee_user_id" text NOT NULL,
  "status" text NOT NULL,
  "decision_reason" text,
  "due_at" timestamptz NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "completed_at" timestamptz
);
CREATE INDEX IF NOT EXISTS "manager_tasks_assignee_idx" ON "manager_tasks" ("assignee_user_id", "status");

CREATE TABLE IF NOT EXISTS "agent_runs" (
  "id" uuid PRIMARY KEY,
  "role_session_id" uuid NOT NULL REFERENCES "role_sessions"("id") ON DELETE CASCADE,
  "actor_user_id" text NOT NULL,
  "status" text NOT NULL,
  "run" jsonb NOT NULL,
  "cancel_requested" boolean DEFAULT false NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "agent_runs_role_status_idx" ON "agent_runs" ("role_session_id", "status");
CREATE INDEX IF NOT EXISTS "agent_runs_actor_idx" ON "agent_runs" ("actor_user_id", "created_at");

CREATE TABLE IF NOT EXISTS "agent_run_events" (
  "id" uuid PRIMARY KEY,
  "run_id" uuid NOT NULL REFERENCES "agent_runs"("id") ON DELETE CASCADE,
  "sequence" bigint NOT NULL,
  "type" text NOT NULL,
  "event" jsonb NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "agent_run_events_sequence_uidx" ON "agent_run_events" ("run_id", "sequence");
CREATE INDEX IF NOT EXISTS "agent_run_events_run_idx" ON "agent_run_events" ("run_id", "sequence");

CREATE TABLE IF NOT EXISTS "decision_logs" (
  "id" uuid PRIMARY KEY,
  "role_session_id" uuid NOT NULL REFERENCES "role_sessions"("id") ON DELETE CASCADE,
  "actor_user_id" text NOT NULL,
  "action" text NOT NULL,
  "target_type" text NOT NULL,
  "target_id" text NOT NULL,
  "metadata" jsonb NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "decision_logs_role_idx" ON "decision_logs" ("role_session_id", "created_at");
