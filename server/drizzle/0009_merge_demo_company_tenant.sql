BEGIN;

-- A short-lived demo login screen accepted an arbitrary workspace id. Entering
-- `demo-company` created this deterministic tenant and split one demo company
-- into two data silos. Move those rows back to the canonical demo tenant so the
-- fixed manager, HR and admin accounts see the same approved HC, conversations
-- and Agent Trace history again.
UPDATE "users"
SET "tenant_id" = 'tenant-demo'
WHERE "tenant_id" = 'tenant-b73ae855287578d112806eac';

UPDATE "role_sessions"
SET "tenant_id" = 'tenant-demo'
WHERE "tenant_id" = 'tenant-b73ae855287578d112806eac';

UPDATE "conversation_messages"
SET "tenant_id" = 'tenant-demo'
WHERE "tenant_id" = 'tenant-b73ae855287578d112806eac';

UPDATE "audit_logs"
SET "tenant_id" = 'tenant-demo'
WHERE "tenant_id" = 'tenant-b73ae855287578d112806eac';

COMMIT;
