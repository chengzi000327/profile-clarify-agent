import postgres from 'postgres'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadConfig } from '../config.js'

const config = loadConfig()
if (!config.DATABASE_URL) throw new Error('DATABASE_URL is required for migrations')

const here = dirname(fileURLToPath(import.meta.url))
const migrationPath = resolve(here, '../../drizzle/0000_initial.sql')
const sql = postgres(config.DATABASE_URL, { max: 1 })

try {
  const migration = await readFile(migrationPath, 'utf8')
  await sql.unsafe(migration)
  console.info('Database migration completed')
} finally {
  await sql.end()
}
