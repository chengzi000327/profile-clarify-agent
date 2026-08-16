BEGIN;

CREATE TABLE IF NOT EXISTS "recruiting_context_imports" (
  "id" text PRIMARY KEY,
  "tenant_id" text NOT NULL,
  "source_revision" text NOT NULL,
  "source_file" text NOT NULL,
  "excluded_sheets" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "record_counts" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "imported_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "recruiting_context_imports_tenant_idx"
  ON "recruiting_context_imports" ("tenant_id", "imported_at");

CREATE TABLE IF NOT EXISTS "recruiting_context_records" (
  "tenant_id" text NOT NULL,
  "record_type" text NOT NULL,
  "external_id" text NOT NULL,
  "team_id" text,
  "role_title" text,
  "conversation_id" text,
  "source_system" text NOT NULL,
  "data_classification" text NOT NULL,
  "effective_at" timestamptz,
  "content" jsonb NOT NULL,
  "import_id" text NOT NULL REFERENCES "recruiting_context_imports"("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("tenant_id", "record_type", "external_id")
);

CREATE INDEX IF NOT EXISTS "recruiting_context_records_type_idx"
  ON "recruiting_context_records" ("tenant_id", "record_type");
CREATE INDEX IF NOT EXISTS "recruiting_context_records_team_idx"
  ON "recruiting_context_records" ("tenant_id", "team_id", "record_type");
CREATE INDEX IF NOT EXISTS "recruiting_context_records_role_idx"
  ON "recruiting_context_records" ("tenant_id", "role_title", "record_type");
CREATE INDEX IF NOT EXISTS "recruiting_context_records_conversation_idx"
  ON "recruiting_context_records" ("tenant_id", "conversation_id", "record_type");

COMMIT;
