import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const readMigration = (name) => readFile(resolve(root, 'apps/api/drizzle', name), 'utf8')
const baseSql = [
  await readMigration('0000_initial.sql'),
  await readMigration('0001_conversation_admin.sql'),
  await readMigration('0003_external_channels.sql'),
].join('\n')
const governanceSql = (await readMigration('0004_database_governance_expand.sql'))
  .replace(/^BEGIN;\s*/m, '')
  .replace(/\s*COMMIT;\s*$/m, '')

const seedSql = `
INSERT INTO users (id, tenant_id, display_name, role, active) VALUES
  ('manager-test', 'tenant-test', '迁移测试经理', 'MANAGER', true);
INSERT INTO role_sessions (id, tenant_id, title, department, stage, revision, state) VALUES
  ('11111111-1111-4111-8111-111111111111', 'tenant-test', '测试岗位', '测试部门', 'CREATED', 0,
   '{"id":"11111111-1111-4111-8111-111111111111","tenant_id":"tenant-test","title":"测试岗位","department":"测试部门","stage":"CREATED","revision":0,"hc_status":"APPROVED","facts":[],"conflicts":[],"latest_artifacts":{},"candidate_count":0,"candidate_channels":[],"calibration_status":"OBSERVING","created_at":"2026-08-16T00:00:00.000Z","updated_at":"2026-08-16T00:00:00.000Z"}');
INSERT INTO clarification_policies (role_session_id, initial_budget, granted_rounds, extension_size, completed_rounds, opened_rounds, open_round_id, status, updated_by, policy) VALUES
  ('11111111-1111-4111-8111-111111111111', 6, 2, 2, 1, 2, null, 'ACTIVE', 'manager-test',
   '{"role_session_id":"11111111-1111-4111-8111-111111111111","initial_budget":6,"granted_rounds":2,"extension_size":2,"completed_rounds":1,"opened_rounds":2,"open_round_id":null,"status":"ACTIVE","updated_by":"manager-test","updated_at":"2026-08-16T00:01:00.000Z"}');
INSERT INTO artifacts (id, role_session_id, type, version, status, content_hash, envelope) VALUES
  ('44444444-4444-4444-8444-444444444444', '11111111-1111-4111-8111-111111111111', 'ROLE_PROFILE', 1, 'DRAFT', 'hash-1234567890123456',
   '{"id":"44444444-4444-4444-8444-444444444444","role_session_id":"11111111-1111-4111-8111-111111111111","type":"ROLE_PROFILE","version":1,"status":"DRAFT","content":{"summary":"测试"},"content_hash":"hash-1234567890123456","based_on_hash":null,"created_by":"manager-test","created_at":"2026-08-16T00:02:00.000Z","confirmed_by":null,"confirmed_at":null}');
INSERT INTO agent_runs (id, role_session_id, actor_user_id, status, run) VALUES
  ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 'manager-test', 'COMPLETED',
   '{"id":"22222222-2222-4222-8222-222222222222","role_session_id":"11111111-1111-4111-8111-111111111111","actor_user_id":"manager-test","status":"COMPLETED","model_tier":"FLASH","task":"CLARIFY_MESSAGE","harness_session_id":"session-test","prompt_version":"v1","model_name":"deepseek-test","tool_count":1,"input_tokens":10,"output_tokens":5,"started_at":"2026-08-16T00:03:00.000Z","completed_at":"2026-08-16T00:04:00.000Z","error_code":null,"input_message_id":null,"output_message_id":null}');
INSERT INTO agent_run_events (id, run_id, sequence, type, event) VALUES
  ('33333333-3333-4333-8333-333333333333', '22222222-2222-4222-8222-222222222222', 1, 'run.started',
   '{"id":"33333333-3333-4333-8333-333333333333","run_id":"22222222-2222-4222-8222-222222222222","sequence":1,"type":"run.started","payload":{"task":"CLARIFY_MESSAGE"},"created_at":"2026-08-16T00:03:00.000Z"}');
INSERT INTO conversation_messages (id, tenant_id, role_session_id, run_id, sender_type, sender_user_id, sender_role, sender_name, content, structured_content, status, sequence, message) VALUES
  ('55555555-5555-4555-8555-555555555555', 'tenant-test', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'HUMAN', 'manager-test', 'MANAGER', '迁移测试经理', '测试消息', null, 'COMPLETED', 1,
   '{"id":"55555555-5555-4555-8555-555555555555","tenant_id":"tenant-test","role_session_id":"11111111-1111-4111-8111-111111111111","run_id":"22222222-2222-4222-8222-222222222222","clarification_round_id":null,"sender_type":"HUMAN","sender_user_id":"manager-test","sender_role":"MANAGER","sender_name":"迁移测试经理","content":"测试消息","structured_content":null,"status":"COMPLETED","sequence":1,"created_at":"2026-08-16T00:05:00.000Z","completed_at":"2026-08-16T00:05:00.000Z"}');
INSERT INTO clarification_rounds (id, role_session_id, ordinal, status, question, opened_by_run_id, resolved_by_message_id, round) VALUES
  ('66666666-6666-4666-8666-666666666666', '11111111-1111-4111-8111-111111111111', 1, 'COMPLETED', '测试问题', '22222222-2222-4222-8222-222222222222', '55555555-5555-4555-8555-555555555555',
   '{"id":"66666666-6666-4666-8666-666666666666","role_session_id":"11111111-1111-4111-8111-111111111111","ordinal":1,"status":"COMPLETED","question":"测试问题","opened_by_run_id":"22222222-2222-4222-8222-222222222222","resolved_by_message_id":"55555555-5555-4555-8555-555555555555","created_at":"2026-08-16T00:06:00.000Z","completed_at":"2026-08-16T00:07:00.000Z"}');
INSERT INTO calibration_signals (id, role_session_id, status, proposed_change, evidence_summary) VALUES
  ('99999999-9999-4999-8999-999999999999', '11111111-1111-4111-8111-111111111111', 'MANAGER_REVIEW', '{"change":"测试"}', '{"count":10}');
INSERT INTO manager_tasks (id, role_session_id, signal_id, assignee_user_id, status, due_at) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', '99999999-9999-4999-8999-999999999999', 'manager-test', 'OPEN', '2026-08-20T00:00:00.000Z');
INSERT INTO decision_logs (id, role_session_id, actor_user_id, action, target_type, target_id, metadata) VALUES
  ('77777777-7777-4777-8777-777777777777', '11111111-1111-4111-8111-111111111111', 'manager-test', 'CONFIRM', 'ARTIFACT', '44444444-4444-4444-8444-444444444444', '{}');
INSERT INTO trace_access_audits (id, tenant_id, actor_user_id, run_id, action, reason) VALUES
  ('88888888-8888-4888-8888-888888888888', 'tenant-test', 'manager-test', '22222222-2222-4222-8222-222222222222', 'VIEW', '迁移验证');
`

const remoteCode = `
import postgres from '/app/apps/api/node_modules/postgres/src/index.js';
const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
const decode = (value) => Buffer.from(value, 'base64').toString('utf8');
const [baseSql, governanceSql, seedSql] = process.argv.slice(1).map(decode);
const rollbackMarker = 'ROLLBACK_GOVERNANCE_VALIDATION';
try {
  await sql.begin(async (tx) => {
    await tx.unsafe('CREATE SCHEMA governance_validation');
    await tx.unsafe('SET LOCAL search_path TO governance_validation');
    await tx.unsafe(baseSql);
    await tx.unsafe(seedSql);
    await tx.unsafe(governanceSql);
    const [result] = await tx.unsafe(\`
      SELECT
        (SELECT business_state ->> 'hc_status' FROM role_sessions LIMIT 1) AS hc_status,
        (SELECT clarification_granted_rounds FROM role_sessions LIMIT 1) AS granted_rounds,
        (SELECT content ->> 'summary' FROM artifacts LIMIT 1) AS artifact_summary,
        (SELECT model_name FROM agent_runs LIMIT 1) AS model_name,
        (SELECT payload ->> 'task' FROM agent_run_events LIMIT 1) AS event_task,
        (SELECT sender_kind FROM conversation_messages LIMIT 1) AS sender_kind,
        (SELECT manager_task_id::text FROM calibration_cases LIMIT 1) AS manager_task_id,
        (SELECT count(*)::int FROM audit_logs) AS audit_count
    \`);
    console.log(JSON.stringify(result));
    if (result.hc_status !== 'APPROVED' || Number(result.granted_rounds) !== 2 ||
        result.artifact_summary !== '测试' || result.model_name !== 'deepseek-test' ||
        result.event_task !== 'CLARIFY_MESSAGE' || result.sender_kind !== 'MANAGER' ||
        result.manager_task_id !== 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' ||
        Number(result.audit_count) !== 2) {
      throw new Error('GOVERNANCE_VALIDATION_ASSERTION_FAILED');
    }
    throw new Error(rollbackMarker);
  });
} catch (error) {
  if (!(error instanceof Error) || error.message !== rollbackMarker) throw error;
} finally {
  await sql.end();
}
`

const encode = (value) => Buffer.from(value).toString('base64')
const identityArgs = process.env.GOVERNANCE_SSH_KEY
  ? ['-i', process.env.GOVERNANCE_SSH_KEY]
  : []
const result = spawnSync(
  'railway',
  [
    'ssh', '-s', 'api', ...identityArgs,
    'node', '--input-type=module', '-e', remoteCode,
    encode(baseSql), encode(governanceSql), encode(seedSql),
  ],
  { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
)
process.stdout.write(result.stdout)
process.stderr.write(result.stderr)
if (result.status !== 0) process.exit(result.status ?? 1)
