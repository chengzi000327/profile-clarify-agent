ALTER TABLE "agent_runs" ADD COLUMN IF NOT EXISTS "effective_actor_role" text;

UPDATE "agent_runs" AS run
SET "effective_actor_role" = COALESCE(
  (SELECT "role" FROM "users" WHERE "users"."id" = run."actor_user_id"),
  'MANAGER'
)
WHERE run."effective_actor_role" IS NULL;

ALTER TABLE "agent_runs" ALTER COLUMN "effective_actor_role" SET DEFAULT 'MANAGER';
ALTER TABLE "agent_runs" ALTER COLUMN "effective_actor_role" SET NOT NULL;
