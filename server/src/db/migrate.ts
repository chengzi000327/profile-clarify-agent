import postgres from 'postgres'
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
  const migrations = (await readdir(migrationDirectory))
    .filter((name) => name.endsWith('.sql'))
    .sort()
  for (const name of migrations) {
    const migration = await readFile(resolve(migrationDirectory, name), 'utf8')
    await sql.unsafe(migration)
  }
  console.info('Database migration completed')
} finally {
  await sql.end()
}
