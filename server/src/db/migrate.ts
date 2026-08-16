import postgres from 'postgres'
import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadConfig } from '../config.js'

const config = loadConfig()
if (!config.DATABASE_URL) throw new Error('DATABASE_URL is required for migrations')

const here = dirname(fileURLToPath(import.meta.url))
const migrationDirectory = resolve(here, '../../drizzle')
const sql = postgres(config.DATABASE_URL, { max: 1 })

try {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS "schema_migrations" (
      "name" text PRIMARY KEY,
      "checksum" text NOT NULL,
      "applied_at" timestamptz NOT NULL DEFAULT now()
    )
  `)
  const migrations = (await readdir(migrationDirectory))
    .filter((name) => name.endsWith('.sql'))
    .sort()
  for (const name of migrations) {
    const migration = await readFile(resolve(migrationDirectory, name), 'utf8')
    const checksum = createHash('sha256').update(migration).digest('hex')
    const [applied] = await sql<{ checksum: string }[]>`
      SELECT "checksum" FROM "schema_migrations" WHERE "name" = ${name}
    `
    if (applied) {
      if (applied.checksum !== checksum) {
        throw new Error(`Applied migration checksum mismatch: ${name}`)
      }
      continue
    }
    await sql.unsafe(migration)
    await sql`
      INSERT INTO "schema_migrations" ("name", "checksum")
      VALUES (${name}, ${checksum})
    `
    console.info(`Applied database migration: ${name}`)
  }
  console.info('Database migration completed')
} finally {
  await sql.end()
}
