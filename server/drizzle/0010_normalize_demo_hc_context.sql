-- Normalize the legacy Railway demo role to the HC approval reference already
-- present in its confirmed facts. Keep the update tenant- and record-scoped so
-- no other demo or customer role is rewritten.
UPDATE "role_sessions"
SET "business_state" = jsonb_set(
  "business_state",
  '{hc_context,request_id}',
  '"HC-2026-EP-001"'::jsonb,
  false
)
WHERE "tenant_id" = 'tenant-demo'
  AND "title" = '企业产品经理'
  AND "business_state"->'hc_context'->>'request_id' = 'HC-2026-001'
  AND "business_state"->'hc_approval'->>'approval_id' = 'HC-2026-EP-001';
