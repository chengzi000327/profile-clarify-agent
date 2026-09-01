BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM role_sessions WHERE business_state IS NULL) THEN
    RAISE EXCEPTION 'role_sessions.business_state backfill is incomplete';
  END IF;
  IF EXISTS (SELECT 1 FROM artifacts WHERE content IS NULL OR created_by IS NULL) THEN
    RAISE EXCEPTION 'artifacts normalized fields are incomplete';
  END IF;
  IF EXISTS (
    SELECT 1 FROM agent_runs
    WHERE model_tier IS NULL OR task IS NULL OR prompt_version IS NULL OR model_name IS NULL
  ) THEN
    RAISE EXCEPTION 'agent_runs normalized fields are incomplete';
  END IF;
  IF EXISTS (SELECT 1 FROM agent_run_events WHERE payload IS NULL) THEN
    RAISE EXCEPTION 'agent_run_events.payload backfill is incomplete';
  END IF;
  IF EXISTS (SELECT 1 FROM conversation_messages WHERE sender_kind IS NULL) THEN
    RAISE EXCEPTION 'conversation_messages.sender_kind backfill is incomplete';
  END IF;
  IF EXISTS (
    SELECT 1 FROM calibration_signals legacy
    WHERE NOT EXISTS (SELECT 1 FROM calibration_cases current WHERE current.id = legacy.id)
  ) THEN
    RAISE EXCEPTION 'calibration case backfill is incomplete';
  END IF;
  IF EXISTS (
    SELECT 1 FROM manager_tasks legacy
    WHERE NOT EXISTS (
      SELECT 1 FROM calibration_cases current WHERE current.manager_task_id = legacy.id
    )
  ) THEN
    RAISE EXCEPTION 'manager task backfill is incomplete';
  END IF;
  IF EXISTS (
    SELECT 1 FROM decision_logs legacy
    WHERE NOT EXISTS (SELECT 1 FROM audit_logs current WHERE current.id = legacy.id)
  ) THEN
    RAISE EXCEPTION 'decision audit backfill is incomplete';
  END IF;
  IF EXISTS (
    SELECT 1 FROM trace_access_audits legacy
    WHERE NOT EXISTS (SELECT 1 FROM audit_logs current WHERE current.id = legacy.id)
  ) THEN
    RAISE EXCEPTION 'trace audit backfill is incomplete';
  END IF;
END $$;

DROP TABLE IF EXISTS "manager_tasks";
DROP TABLE IF EXISTS "calibration_signals";
DROP TABLE IF EXISTS "clarification_policies";
DROP TABLE IF EXISTS "trace_access_audits";
DROP TABLE IF EXISTS "decision_logs";

ALTER TABLE "role_sessions" DROP COLUMN IF EXISTS "state";
ALTER TABLE "artifacts" DROP COLUMN IF EXISTS "envelope";
ALTER TABLE "agent_runs" DROP COLUMN IF EXISTS "run";
ALTER TABLE "agent_run_events" DROP COLUMN IF EXISTS "event";
ALTER TABLE "conversation_messages" DROP COLUMN IF EXISTS "sender_type";
ALTER TABLE "conversation_messages" DROP COLUMN IF EXISTS "sender_role";
ALTER TABLE "conversation_messages" DROP COLUMN IF EXISTS "message";
ALTER TABLE "clarification_rounds" DROP COLUMN IF EXISTS "round";

COMMIT;
