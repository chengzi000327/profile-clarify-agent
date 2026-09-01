import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import postgres from '../apps/api/node_modules/postgres/src/index.js'

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
const databaseUrl = process.env.DATABASE_TUNNEL_PORT
  ? `postgres://${encodeURIComponent(config.PGUSER)}:${encodeURIComponent(config.PGPASSWORD)}@127.0.0.1:${process.env.DATABASE_TUNNEL_PORT}/${encodeURIComponent(config.PGDATABASE)}`
  : config.DATABASE_PUBLIC_URL ?? config.DATABASE_URL
if (!databaseUrl) throw new Error('Railway Postgres connection URL is unavailable')

const outputDir = process.argv[2]
  ? resolve(process.argv[2])
  : resolve(root, '..', 'outputs', 'database-governance-20260816')
await mkdir(outputDir, { recursive: true })

const sql = postgres(databaseUrl, { max: 1, prepare: false })
let snapshot
try {
  snapshot = await sql.begin(async (tx) => {
    const columns = await tx.unsafe(`
      SELECT cls.relname AS table_name, att.attnum AS ordinal_position,
             att.attname AS column_name,
             pg_catalog.format_type(att.atttypid, att.atttypmod) AS data_type,
             NOT att.attnotnull AS nullable,
             pg_catalog.pg_get_expr(def.adbin, def.adrelid) AS column_default
      FROM pg_catalog.pg_class cls
      JOIN pg_catalog.pg_namespace ns ON ns.oid = cls.relnamespace
      JOIN pg_catalog.pg_attribute att ON att.attrelid = cls.oid
      LEFT JOIN pg_catalog.pg_attrdef def ON def.adrelid = cls.oid AND def.adnum = att.attnum
      WHERE ns.nspname = current_schema() AND cls.relkind = 'r'
        AND att.attnum > 0 AND NOT att.attisdropped
      ORDER BY cls.relname, att.attnum
    `)
    const constraints = await tx.unsafe(`
      SELECT cls.relname AS table_name, con.conname AS constraint_name,
             con.contype AS constraint_type,
             pg_catalog.pg_get_constraintdef(con.oid) AS definition
      FROM pg_catalog.pg_constraint con
      JOIN pg_catalog.pg_class cls ON cls.oid = con.conrelid
      JOIN pg_catalog.pg_namespace ns ON ns.oid = cls.relnamespace
      WHERE ns.nspname = current_schema()
      ORDER BY cls.relname, con.conname
    `)
    const names = [...new Set(columns.map((row) => row.table_name))]
    const tables = []
    for (const name of names) {
      if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`Unexpected table name: ${name}`)
      const rows = await tx.unsafe(`SELECT * FROM "${name}"`)
      tables.push({
        name,
        columns: columns.filter((row) => row.table_name === name),
        constraints: constraints.filter((row) => row.table_name === name),
        rows,
      })
    }
    return {
      exported_at: new Date().toISOString(),
      database: 'railway-production',
      table_count: tables.length,
      row_count: tables.reduce((sum, table) => sum + table.rows.length, 0),
      tables,
    }
  })
} finally {
  await sql.end()
}

const payload = `${JSON.stringify(snapshot)}\n`
const timestamp = snapshot.exported_at.replace(/[:.]/g, '-').replace('Z', 'Z')
const outputPath = resolve(outputDir, `pre-governance-backup-${timestamp}.json`)
await writeFile(outputPath, payload, 'utf8')
await chmod(outputPath, 0o600)
const checksum = createHash('sha256').update(payload).digest('hex')
console.log(JSON.stringify({
  output_path: outputPath,
  table_count: snapshot.table_count,
  row_count: snapshot.row_count,
  sha256: checksum,
}))
