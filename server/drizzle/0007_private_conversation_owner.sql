ALTER TABLE "conversation_messages"
  ADD COLUMN IF NOT EXISTS "conversation_user_id" text;

UPDATE "conversation_messages" AS message
SET "conversation_user_id" = message."sender_user_id"
WHERE message."conversation_user_id" IS NULL
  AND message."sender_user_id" IS NOT NULL;

UPDATE "conversation_messages" AS message
SET "conversation_user_id" = run."actor_user_id"
FROM "agent_runs" AS run
WHERE message."conversation_user_id" IS NULL
  AND message."run_id" = run."id";

CREATE INDEX IF NOT EXISTS "conversation_messages_user_idx"
  ON "conversation_messages" ("role_session_id", "conversation_user_id", "sequence");
