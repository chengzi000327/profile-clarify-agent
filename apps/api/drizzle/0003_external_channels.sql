CREATE TABLE IF NOT EXISTS "external_event_receipts" (
  "channel" text NOT NULL,
  "event_id" text NOT NULL,
  "received_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("channel", "event_id")
);
