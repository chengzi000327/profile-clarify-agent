import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import postgres from '../server/node_modules/postgres/src/index.js'

const root = resolve(import.meta.dirname, '..')
const variables = spawnSync(
  'railway',
  ['variable', 'list', '--service', 'Postgres', '--json'],
  { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
)
if (variables.status !== 0) {
  process.stderr.write(variables.stderr)
  process.exit(variables.status ?? 1)
}
const config = JSON.parse(variables.stdout)
const port = process.env.DATABASE_TUNNEL_PORT
if (!port) throw new Error('DATABASE_TUNNEL_PORT is required')
const databaseUrl = `postgres://${encodeURIComponent(config.PGUSER)}:${encodeURIComponent(config.PGPASSWORD)}@127.0.0.1:${port}/${encodeURIComponent(config.PGDATABASE)}`
const migration = await readFile(
  resolve(root, 'server/drizzle/0004_database_governance_expand.sql'),
  'utf8',
)

const sql = postgres(databaseUrl, { max: 1, prepare: false })
try {
  await sql.unsafe(migration)
  const [counts] = await sql.unsafe(`
    SELECT
      (SELECT count(*)::int FROM role_sessions WHERE business_state IS NOT NULL) AS role_sessions,
      (SELECT count(*)::int FROM artifacts WHERE content IS NOT NULL) AS artifacts,
      (SELECT count(*)::int FROM agent_runs WHERE model_tier IS NOT NULL) AS agent_runs,
      (SELECT count(*)::int FROM agent_run_events WHERE payload IS NOT NULL) AS agent_run_events,
      (SELECT count(*)::int FROM conversation_messages WHERE sender_kind IS NOT NULL) AS conversation_messages,
      (SELECT count(*)::int FROM calibration_cases) AS calibration_cases,
      (SELECT count(*)::int FROM audit_logs) AS audit_logs
  `)
  const [missing] = await sql.unsafe(`
    SELECT
      (SELECT count(*)::int FROM role_sessions WHERE business_state IS NULL) AS role_sessions,
      (SELECT count(*)::int FROM artifacts WHERE content IS NULL OR created_by IS NULL) AS artifacts,
      (SELECT count(*)::int FROM agent_runs WHERE model_tier IS NULL OR task IS NULL OR model_name IS NULL) AS agent_runs,
      (SELECT count(*)::int FROM agent_run_events WHERE payload IS NULL) AS agent_run_events,
      (SELECT count(*)::int FROM conversation_messages WHERE sender_kind IS NULL) AS conversation_messages
  `)
  if (Object.values(missing).some((value) => Number(value) !== 0)) {
    throw new Error(`Governance backfill incomplete: ${JSON.stringify(missing)}`)
  }
  console.log(JSON.stringify({ status: 'expanded', counts }))
} finally {
  await sql.end()
}
