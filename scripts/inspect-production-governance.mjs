import { spawnSync } from 'node:child_process'
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
const sql = postgres(databaseUrl, { max: 1, prepare: false })
try {
  const tables = await sql.unsafe(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `)
  const migrations = await sql.unsafe(`
    SELECT name, applied_at FROM schema_migrations ORDER BY name
  `)
  const counts = await sql.unsafe(`
    SELECT 'role_sessions' AS table_name, count(*)::int AS rows FROM role_sessions
    UNION ALL SELECT 'conversation_messages', count(*)::int FROM conversation_messages
    UNION ALL SELECT 'agent_runs', count(*)::int FROM agent_runs
    UNION ALL SELECT 'agent_run_events', count(*)::int FROM agent_run_events
    UNION ALL SELECT 'artifacts', count(*)::int FROM artifacts
    UNION ALL SELECT 'audit_logs', count(*)::int FROM audit_logs
    UNION ALL SELECT 'calibration_cases', count(*)::int FROM calibration_cases
    ORDER BY table_name
  `)
  const legacyColumns = await sql.unsafe(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND (table_name, column_name) IN (
        ('role_sessions', 'state'),
        ('artifacts', 'envelope'),
        ('agent_runs', 'run'),
        ('agent_run_events', 'event'),
        ('conversation_messages', 'message'),
        ('conversation_messages', 'sender_type'),
        ('conversation_messages', 'sender_role'),
        ('clarification_rounds', 'round')
      )
    ORDER BY table_name, column_name
  `)
  console.log(JSON.stringify({
    tables: tables.map((row) => row.table_name),
    migrations: migrations.map((row) => row.name),
    counts: Object.fromEntries(counts.map((row) => [row.table_name, Number(row.rows)])),
    legacy_columns: legacyColumns.map((row) => `${row.table_name}.${row.column_name}`),
  }))
} finally {
  await sql.end()
}
